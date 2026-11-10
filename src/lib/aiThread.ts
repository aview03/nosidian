// AI 패널의 대화(스레드) 상태: 열림·폭·모드·메시지·실행 중 여부. 패널 컴포넌트가 아니라 여기에 두어서 패널을 닫아도 실행과 기록이 이어진다.
//
// - 대화는 이 기기에 vault 별로 보관한다(localStorage). vault·동기화에는 넣지 않는다. 최근 40개 메시지만 남긴다.
// - 엔진 둘: claude(PC 의 Claude Code CLI, electron/claudeCli.cjs) / ollama(설정 > AI 연결에서 고른 Ollama·OpenAI 호환 모델 — 앱이 도구 호출 반복을 돌린다, lib/aiAgent.ts).
//   둘 다 같은 도구(MCP 도구 6개)·정책 엔진·승인 흐름을 쓴다. 매번 새로 실행되므로 후속 질문에는 최근 3번의 대화를 맥락으로 함께 보낸다.
// - 모드: ask(묻기, 읽기 전용 — 변경 제안 도구 자체를 주지 않는다) / edit(변경 제안 — 문서 규칙과 승인을 거친다).
// - 이번 실행으로 생긴 변경 제안은 그 답변 메시지에 붙여 패널 안에서 바로 검토·승인한다.
import { create } from 'zustand'
import { useApp } from './app'
import { buildPrompt, errorText, type AiMode, type Turn } from './aiAssistant'
import { desktop, type ClaudeEvent } from './externalIO'
import { useProposals } from './proposalStore'
import { AgentError, runAgent } from './aiAgent'
import { isPrivateHost, loadLlmConfig, providerOf, supportsTools, type LlmConfig } from './llm'
import { chatTurn } from './llmNet'
import { callTool } from './mcpTools'
import { buildEnv } from './mcpBridge'

export type Engine = 'claude' | 'ollama'

export interface LocalEngine {
  ready: boolean
  /** 화면에 보일 이름(예: "Ollama · qwen3.5:4b") */
  label: string
  /** 노트가 내 기기 밖(클라우드)으로 나가는가 */
  cloud: boolean
  /** 쓸 수 없는 이유(설정 안내용) */
  problem?: 'noConfig' | 'noTools' | 'noModel'
}

/** 설정 > AI 연결에 저장된 모델로 앱 안 AI 를 돌릴 수 있는지 */
export function localEngine(cfg: LlmConfig | null = loadLlmConfig()): LocalEngine {
  if (!cfg) return { ready: false, label: '', cloud: false, problem: 'noConfig' }
  const name = cfg.kind === 'ollama' ? 'Ollama' : cfg.kind === 'custom' ? providerOf('custom').label.split(' ')[0] : providerOf(cfg.kind).label
  let cloud = true
  try {
    cloud = !isPrivateHost(new URL(cfg.baseUrl).hostname)
  } catch {
    /* 주소가 잘못되면 클라우드로 간주(보수적) */
  }
  const label = `${name}${cfg.model ? ` · ${cfg.model}` : ''}`
  if (!supportsTools(cfg.kind)) return { ready: false, label, cloud, problem: 'noTools' }
  if (!cfg.model.trim()) return { ready: false, label, cloud, problem: 'noModel' }
  return { ready: true, label, cloud }
}

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
  /** 사용자 메시지: 함께 보낸 노트와 모드·엔진 */
  note?: string | null
  mode?: AiMode
  engine?: Engine
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
  /** 어느 엔진으로 답할지 */
  engine: Engine
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
  setEngine(e: Engine): void
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
/** 진행 중인 앱 안 모델(Ollama 등) 실행을 중단하는 컨트롤러 */
let abortLocal: AbortController | null = null

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
  /** 설정에 저장된 모델(Ollama 등)로 에이전트 루프를 돌린다. 도구는 Claude CLI 와 같은 것(mcpTools)을 같은 정책으로 실행한다 */
  const runLocal = async (q: string, note: string | null, mode: AiMode, history: Turn[]) => {
    const finish = (f: (m: Msg) => Msg) => {
      set({ running: false })
      abortLocal = null
      patchLast(f)
    }
    const cfg = loadLlmConfig()
    const info = localEngine(cfg)
    if (!cfg || !info.ready) {
      finish((m) => ({ ...m, status: 'error', error: errorText('noEngine') }))
      return
    }
    const ac = new AbortController()
    abortLocal = ac
    const ro = mode === 'ask'
    const partial = new Set<string>()
    const client = `앱 안 ${cfg.model}`
    try {
      const out = await runAgent(
        { question: q, note, mode, history, signal: ac.signal },
        {
          turn: (messages, tools, signal) => chatTurn(cfg, messages, { tools, think: false, numCtx: 16384, temperature: 0.2, maxTokens: 2048 }, signal),
          // 도구 호출마다 최신 노트·vault 로 환경을 새로 만든다(열린 vault 하나, 묻기면 읽기 전용)
          exec: (name, args) => callTool(name, args, { ...buildEnv(true, ro), partialPaths: partial }, client),
          onStep: (step) => patchLast((m) => ({ ...m, steps: [...(m.steps ?? []), step] })),
          markPartial: (path) => partial.add(path),
        },
      )
      if (ac.signal.aborted) return
      finish((m) => ({ ...m, status: 'done', text: out.text, turns: out.rounds, proposals: newProposals(snapshot) }))
    } catch (e) {
      if (e instanceof AgentError) finish((m) => ({ ...m, status: 'error', error: errorText(e.code, e.code === 'cancelled' ? undefined : e.message), proposals: newProposals(snapshot) }))
      else finish((m) => ({ ...m, status: 'error', error: ac.signal.aborted ? errorText('cancelled') : e instanceof Error ? e.message : String(e), proposals: newProposals(snapshot) }))
    }
  }

  return {
    open: false,
    wide: false,
    width: loadPref('width', PANEL_DEFAULT, (v) => typeof v === 'number' && v >= PANEL_MIN && v <= 1200),
    mode: loadPref<AiMode>('mode', 'ask', (v) => v === 'ask' || v === 'edit'),
    engine: loadPref<Engine>('engine', 'claude', (v) => v === 'claude' || v === 'ollama'),
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
    setEngine: (engine) => {
      savePref('engine', engine)
      set({ engine })
    },
    setWithNote: (withNote) => set({ withNote }),
    setDraft: (draft) => set({ draft }),

    send: async (question) => {
      const claude = desktop()?.claude
      const engine = get().engine
      const q = question.trim()
      if (!q || get().running) return
      if (engine === 'claude' && !claude) return
      get().ensure()
      set({ draft: '' })
      const note = get().withNote ? useApp.getState().current : null
      const mode = get().mode
      const history = turnsOf(get().messages)
      snapshot = new Set(useProposals.getState().items.map((p) => p.id))
      const now = Date.now()
      commit([...get().messages, { id: uid(), role: 'user', text: q, at: now, note, mode, engine }, { id: uid(), role: 'ai', text: '', at: now, status: 'running', steps: [] }])
      set({ running: true })
      if (engine === 'ollama') return runLocal(q, note, mode, history)
      try {
        await claude!.run({ prompt: buildPrompt({ question: q, note, mode, history }), mode })
      } catch (e) {
        set({ running: false })
        patchLast((m) => ({ ...m, status: 'error', error: e instanceof Error ? e.message : String(e) }))
      }
    },
    cancel: () => {
      if (get().engine === 'ollama') abortLocal?.abort()
      else void desktop()?.claude?.cancel()
    },
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

