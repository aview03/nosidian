// AI 패널의 대화(스레드) 상태: 열림·폭·모드·메시지·실행 중 여부. 패널 컴포넌트가 아니라 여기에 두어서 패널을 닫아도 실행과 기록이 이어진다.
//
// - 대화는 이 기기에 vault 별로 보관한다(localStorage). vault·동기화에는 넣지 않는다. 최근 40개 메시지만 남긴다.
// - 실행은 PC 의 Claude Code CLI(electron/claudeCli.cjs). CLI 는 매번 새로 실행되므로 후속 질문에는 최근 3번의 대화를 맥락으로 함께 보낸다(buildPrompt).
// - 모드: ask(묻기, 읽기 전용 — 변경 제안 도구 자체를 주지 않는다) / edit(변경 제안 — 문서 규칙과 승인을 거친다).
// - 이번 실행으로 생긴 변경 제안은 그 답변 메시지에 붙여 패널 안에서 바로 검토·승인한다.
import { create } from 'zustand'
import { useApp } from './app'
import { buildPrompt, errorText, type AiMode, type Turn } from './aiAssistant'
import { desktop, type ClaudeEvent } from './externalIO'
import { useProposals } from './proposalStore'

export interface Step {
  name: string
  input: string
}

export interface Msg {
  id: string
  role: 'user' | 'ai'
  /** 사용자: 질문 · AI: 답변(진행 중에는 빈 글) */
  text: string
  at: number
  /** 사용자 메시지: 함께 보낸 노트와 모드 */
  note?: string | null
  mode?: AiMode
  /** AI 메시지 */
  steps?: Step[]
  status?: 'running' | 'done' | 'error'
  error?: string
  turns?: number
  /** 이번 실행으로 생긴 변경 제안 id */
  proposals?: string[]
}

export const PANEL_MIN = 320
export const PANEL_DEFAULT = 380
const MAX_MSGS = 40

const key = (vault: string | null, kind: string) => `nosidian.ai.${kind}.${vault ?? 'local'}`

function loadMsgs(vault: string | null): Msg[] {
  try {
    const raw = localStorage.getItem(key(vault, 'thread'))
    const v = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(v)) return []
    // 실행 중이던 메시지는 앱이 꺼지면서 끊긴 것이므로 오류로 바꾼다
    return (v as Msg[])
      .filter((m) => m && typeof m.id === 'string' && (m.role === 'user' || m.role === 'ai') && typeof m.text === 'string')
      .map((m) => (m.status === 'running' ? { ...m, status: 'error' as const, error: errorText('cancelled') } : m))
  } catch {
    return []
  }
}
function saveMsgs(vault: string | null, msgs: Msg[]) {
  try {
    localStorage.setItem(key(vault, 'thread'), JSON.stringify(msgs.slice(-MAX_MSGS)))
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}

const loadPref = <T>(k: string, dflt: T, ok: (v: unknown) => boolean): T => {
  try {
    const raw = localStorage.getItem('nosidian.ai.' + k)
    if (raw === null) return dflt
    const v = JSON.parse(raw) as unknown
    return ok(v) ? (v as T) : dflt
  } catch {
    return dflt
  }
}
const savePref = (k: string, v: unknown) => {
  try {
    localStorage.setItem('nosidian.ai.' + k, JSON.stringify(v))
  } catch {
    /* noop */
  }
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 대화에서 후속 질문의 맥락이 될 완료된 (질문, 답변) 쌍 */
export function turnsOf(msgs: Msg[]): Turn[] {
  const out: Turn[] = []
  for (let i = 0; i + 1 < msgs.length; i++) {
    const q = msgs[i]
    const a = msgs[i + 1]
    if (q.role === 'user' && a.role === 'ai' && a.status === 'done' && a.text.trim()) out.push({ q: q.text, a: a.text })
  }
  return out
}

interface AiThread {
  open: boolean
  /** 넓게 보기(기본 폭의 약 1.7배) */
  wide: boolean
  /** 끌어서 조절한 폭(px) */
  width: number
  mode: AiMode
  /** 열려 있는 노트를 이번 질문에 함께 보낼지 */
  withNote: boolean
  messages: Msg[]
  /** 입력 중인 글(패널을 닫았다 열어도 유지) */
  draft: string
  running: boolean
  vault: string | null
  loaded: boolean
  /** 지금 vault 의 대화를 불러온다(vault 가 바뀌었을 때만) */
  ensure(): void
  setOpen(open: boolean): void
  toggle(): void
  setWide(w: boolean): void
  setWidth(px: number): void
  setMode(m: AiMode): void
  setWithNote(v: boolean): void
  setDraft(t: string): void
  /** 질문을 보낸다 */
  send(question: string): Promise<void>
  cancel(): void
  /** 새 채팅 */
  clear(): void
}

/** 실행을 시작할 때 이미 있던 변경 제안 id(이번 실행으로 생긴 것만 답변에 붙이려고) */
let snapshot = new Set<string>()

export const useAiThread = create<AiThread>((set, get) => {
  const commit = (messages: Msg[]) => {
    set({ messages })
    saveMsgs(get().vault, messages)
  }
  /** 마지막 AI 메시지를 고친다 */
  const patchLast = (f: (m: Msg) => Msg) => {
    const msgs = get().messages
    const i = msgs.length - 1
    if (i < 0 || msgs[i].role !== 'ai') return
    commit([...msgs.slice(0, i), f(msgs[i]), ...msgs.slice(i + 1)])
  }
  return {
    open: false,
    wide: false,
    width: loadPref('width', PANEL_DEFAULT, (v) => typeof v === 'number' && v >= PANEL_MIN && v <= 1200),
    mode: loadPref<AiMode>('mode', 'ask', (v) => v === 'ask' || v === 'edit'),
    withNote: true,
    messages: [],
    draft: '',
    running: false,
    vault: null,
    loaded: false,

    ensure: () => {
      const vault = useApp.getState().settings.activeVault
      if (get().loaded && get().vault === vault) return
      set({ vault, loaded: true, messages: loadMsgs(vault), running: false })
    },
    setOpen: (open) => {
      if (open) get().ensure()
      set({ open })
    },
    toggle: () => get().setOpen(!get().open),
    setWide: (wide) => set({ wide }),
    setWidth: (px) => {
      const width = Math.max(PANEL_MIN, Math.min(1200, Math.round(px)))
      savePref('width', width)
      set({ width })
    },
    setMode: (mode) => {
      savePref('mode', mode)
      set({ mode })
    },
    setWithNote: (withNote) => set({ withNote }),
    setDraft: (draft) => set({ draft }),

    send: async (question) => {
      const claude = desktop()?.claude
      const q = question.trim()
      if (!claude || !q || get().running) return
      get().ensure()
      set({ draft: '' })
      const note = get().withNote ? useApp.getState().current : null
      const mode = get().mode
      const history = turnsOf(get().messages)
      snapshot = new Set(useProposals.getState().items.map((p) => p.id))
      const now = Date.now()
      commit([...get().messages, { id: uid(), role: 'user', text: q, at: now, note, mode }, { id: uid(), role: 'ai', text: '', at: now, status: 'running', steps: [] }])
      set({ running: true })
      try {
        await claude.run({ prompt: buildPrompt({ question: q, note, mode, history }), mode })
      } catch (e) {
        set({ running: false })
        patchLast((m) => ({ ...m, status: 'error', error: e instanceof Error ? e.message : String(e) }))
      }
    },
    cancel: () => void desktop()?.claude?.cancel(),
    clear: () => {
      if (get().running) return
      commit([])
    },
  }
})

/** 이번 실행으로 새로 생긴 변경 제안 id */
function newProposals(before: Set<string>): string[] {
  return useProposals.getState().items.filter((p) => !before.has(p.id)).map((p) => p.id)
}

/** Claude CLI 이벤트(진행·결과·오류)를 스레드에 반영하기 시작한다. 반환값은 해제 함수 */
export function startAiThread(): (() => void) | undefined {
  const claude = desktop()?.claude
  if (!claude) return undefined
  return claude.onEvent((e: ClaudeEvent) => {
    const st = useAiThread.getState()
    const msgs = st.messages
    const last = msgs[msgs.length - 1]
    if (!last || last.role !== 'ai' || last.status !== 'running') return // 실행 중인 답변이 없으면(예: 다른 창의 호출) 무시
    const replace = (m: Msg) => {
      const next = [...msgs.slice(0, -1), m]
      useAiThread.setState({ messages: next })
      try {
        localStorage.setItem(key(st.vault, 'thread'), JSON.stringify(next.slice(-MAX_MSGS)))
      } catch {
        /* noop */
      }
    }
    if (e.type === 'tool') replace({ ...last, steps: [...(last.steps ?? []), { name: e.name, input: e.input }] })
    else if (e.type === 'result') {
      useAiThread.setState({ running: false })
      const proposals = newProposals(snapshot)
      replace(e.ok ? { ...last, status: 'done', text: e.text, turns: e.turns, proposals } : { ...last, status: 'error', error: e.text || errorText('exit'), proposals })
    } else if (e.type === 'error') {
      useAiThread.setState({ running: false })
      replace({ ...last, status: 'error', error: errorText(e.code, e.message), proposals: newProposals(snapshot) })
    }
  })
}

