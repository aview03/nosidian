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
import { planApplyPrompt } from './aiFix'
import { desktop, type ClaudeEvent } from './externalIO'
import { useProposals } from './proposalStore'
import { AgentError, runAgent } from './aiAgent'
import { isPrivateHost, loadLlmConfig, supportsTools, type LlmConfig } from './llm'
import { chatTurn } from './llmNet'
import { callTool } from './mcpTools'
import { buildEnv } from './mcpBridge'
import { t } from './i18n'
import { autoBusy, yieldToUser } from './autoGate'
import { changedPaths } from './autoTriggers'

export type Engine = 'claude' | 'ollama'

/** 실제로 쓰는 엔진: Claude Code 는 PC 앱에만 있으므로, 없는 기기(폰·웹)는 항상 연결한 모델(ollama 경로)로 답한다 */
export const currentEngine = (e: Engine): Engine => (desktop()?.claude ? e : 'ollama')

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
  // 패널 선택 상자에 보일 짧은 이름: "Ollama qwen3.5:4b", "OpenAI gpt-4o-mini", "Claude API"
  const name = cfg.kind === 'ollama' ? 'Ollama' : cfg.kind === 'custom' ? t('내 서버') : cfg.kind === 'anthropic' ? 'Claude API' : cfg.kind === 'gemini' ? 'Gemini' : 'OpenAI'
  let cloud = true
  try {
    cloud = !isPrivateHost(new URL(cfg.baseUrl).hostname)
  } catch {
    /* 주소가 잘못되면 클라우드로 간주(보수적) */
  }
  const label = cfg.kind === 'anthropic' ? name : `${name}${cfg.model ? ` ${cfg.model}` : ''}`
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
  /** plan = 문서 점검 분석(정리 계획) 답변, apply = 계획을 변경 제안으로 낸 답변 */
  fix?: 'plan' | 'apply'
  /** 자동 분석이 만든 정리 계획이면: 분석할 때의 문서 버전(원본이 바뀌면 실행을 막는다)과 대기열 항목 */
  source?: { hashes: Record<string, string>; itemId: string }
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

/**
 * 대화에서 후속 질문의 맥락이 될 완료된 (질문, 답변) 쌍.
 * 로컬 모델이 도구를 하나도 쓰지 않고 한 답변은 뺀다: "노트를 읽었어요" 같은 근거 없는 말이 다음 질문의 본보기가 되어 모델이 그대로 따라 하기 때문이다.
 */
export function turnsOf(msgs: Msg[]): Turn[] {
  const out: Turn[] = []
  for (let i = 0; i + 1 < msgs.length; i++) {
    const q = msgs[i]
    const a = msgs[i + 1]
    if (q.role !== 'user' || a.role !== 'ai' || a.status !== 'done' || !a.text.trim()) continue
    if (q.engine === 'ollama' && !(a.steps?.length)) continue
    out.push({ q: q.text, a: a.text })
  }
  return out
}

export interface SendOpts {
  /** 모델에게 실제로 보낼 글(없으면 question) */
  prompt?: string
  /** 이번 한 번만 쓸 모드(저장된 모드 선택은 바꾸지 않는다) */
  mode?: AiMode
  /** 열려 있는 노트를 함께 보낼지(없으면 칩 설정) */
  withNote?: boolean
  fix?: 'plan' | 'apply'
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
  /** 질문을 보낸다. question 은 화면에 보이는 글, opts.prompt 가 있으면 그것을 모델에게 보낸다 */
  send(question: string, opts?: SendOpts): Promise<void>
  /** 문서 점검 문제를 AI 로 분석한다(읽기 전용으로 정리 계획까지) — 패널을 열고 보낸다 */
  askFix(title: string, prompt: string): Promise<void>
  /** 자동 분석이 만든 정리 계획을 대화에 올린다(패널을 연다). 이미 일하는 중이면 false */
  injectPlan(title: string, text: string, source: { hashes: Record<string, string>; itemId: string }, engine?: Engine): boolean
  /** 분석한 정리 계획을 변경 제안으로 낸다(변경 제안 모드로 한 번) */
  applyPlan(msgId: string): Promise<void>
  /** 마지막 답변을 지우고 같은 질문을 다시 보낸다(분석·계획 실행 답변은 제외) */
  regenerate(): Promise<void>
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
  const runLocal = async (q: string, note: string | null, mode: AiMode, history: Turn[], force = false) => {
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
          turn: (messages, tools, signal) => chatTurn(cfg, messages, { tools, think: false, numCtx: 16384, temperature: 0.2, maxTokens: 2048, timeoutMs: 300_000 }, signal),
          // 도구 호출마다 최신 노트·vault 로 환경을 새로 만든다(열린 vault 하나, 묻기면 읽기 전용)
          exec: (name, args) => callTool(name, args, { ...buildEnv(true, ro, force), partialPaths: partial }, client),
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

    send: async (question, opts) => {
      const claude = desktop()?.claude
      const engine = currentEngine(get().engine)
      const q = question.trim()
      if (!q || get().running) return
      if (engine === 'claude' && !claude) return
      if (autoBusy()) await yieldToUser() // 자동 분석이 돌고 있으면 사용자의 질문이 먼저: 분석을 멈추고(중단으로 기록) 기다린다
      if (get().running) return
      get().ensure()
      set({ draft: '' })
      const note = (opts?.withNote ?? get().withNote) ? useApp.getState().current : null
      const mode = opts?.mode ?? get().mode
      const history = turnsOf(get().messages)
      const asked = opts?.prompt ?? q
      snapshot = new Set(useProposals.getState().items.map((p) => p.id))
      const now = Date.now()
      // 정리 계획 바로 다음의 후속 질문(결정을 알려 주거나 계획을 고쳐 달라는 말)은 계획의 연장이다: 고친 계획에도 실행 버튼이 붙는다
      const prev = get().messages.at(-1)
      const fix = opts?.fix ?? (prev?.role === 'ai' && prev.fix === 'plan' && prev.status === 'done' && mode === 'ask' ? ('plan' as const) : undefined)
      commit([...get().messages, { id: uid(), role: 'user', text: q, at: now, note, mode, engine }, { id: uid(), role: 'ai', text: '', at: now, status: 'running', steps: [], ...(fix ? { fix } : {}), ...(fix === 'plan' && prev?.source ? { source: prev.source } : {}) }])
      set({ running: true })
      const force = opts?.fix === 'apply' // 계획 실행: 정책이 허용해도 최종 승인을 받는다
      if (engine === 'ollama') return runLocal(asked, note, mode, history, force)
      try {
        await claude!.run({ prompt: buildPrompt({ question: asked, note, mode, history }), mode, forceApproval: force })
      } catch (e) {
        set({ running: false })
        patchLast((m) => ({ ...m, status: 'error', error: e instanceof Error ? e.message : String(e) }))
      }
    },
    askFix: async (title, prompt) => {
      get().setOpen(true)
      if (get().running) return
      await get().send(title, { prompt, mode: 'ask', withNote: false, fix: 'plan' })
    },
    injectPlan: (title, text, source, engine) => {
      get().setOpen(true)
      if (get().running) {
        useApp.getState().say(t('AI 가 답하는 중이에요. 끝난 뒤에 열어 주세요'))
        return false
      }
      const now = Date.now()
      commit([...get().messages, { id: uid(), role: 'user', text: title, at: now, note: null, mode: 'ask', engine: engine ?? get().engine }, { id: uid(), role: 'ai', text, at: now, status: 'done', steps: [], fix: 'plan', source }])
      return true
    },
    applyPlan: async (msgId) => {
      const m = get().messages.find((x) => x.id === msgId)
      if (!m || m.fix !== 'plan' || m.status !== 'done' || get().running) return
      // 분석한 뒤 원본이 바뀌었으면 오래된 계획이라 실행하지 않는다
      if (m.source && changedPaths(m.source.hashes, useApp.getState().files).length > 0) {
        useApp.getState().say(t('문서가 변경되어 재검토가 필요합니다'))
        return
      }
      await get().send('정리 계획대로 변경 제안 만들기', { prompt: planApplyPrompt(m.text), mode: 'edit', withNote: false, fix: 'apply' })
    },
    regenerate: async () => {
      const msgs = get().messages
      const n = msgs.length
      if (get().running || n < 2) return
      const ai = msgs[n - 1]
      const u = msgs[n - 2]
      if (ai.role !== 'ai' || u.role !== 'user' || ai.fix || ai.status === 'running') return
      commit(msgs.slice(0, n - 2))
      await get().send(u.text, { mode: u.mode, withNote: u.note != null })
    },
    cancel: () => {
      if (currentEngine(get().engine) === 'ollama') abortLocal?.abort()
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

