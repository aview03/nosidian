// AI 자동 분석 실행기(PC): 대기열 항목 하나를 읽기 전용으로 분석한다. AI 패널의 대화와 별개이며 노트를 수정하지 않는다.
// - Claude: Claude Code CLI 를 묻기(mode: 'ask') 로 — 변경 제안 도구가 아예 없다.
// - Ollama 등: 앱 안 에이전트 루프를 읽기 전용 환경(readOnly)으로 — propose_change 는 도구 단계에서 거절된다.
import { AgentError, runAgent } from './aiAgent'
import { buildPrompt } from './aiAssistant'
import { fixPrompt, fixTitle } from './aiFix'
import type { QueueItem } from './autoTriggers'
import type { LintItem } from './doclint'
import { desktop, type ClaudeEvent } from './externalIO'
import { loadLlmConfig } from './llm'
import { chatTurn } from './llmNet'
import { buildEnv } from './mcpBridge'
import { callTool } from './mcpTools'

const lintOf = (q: QueueItem): LintItem => ({ kind: q.kind, severity: 'warn', path: q.paths[0], others: q.paths.slice(1), text: q.text, text2: q.text2 })
const folderOf = (project: string) => (project.includes('/') ? project.slice(0, project.lastIndexOf('/')) : '')
const relOf = (q: QueueItem) => {
  const folder = folderOf(q.project)
  return (p: string) => (folder && p.startsWith(folder + '/') ? p.slice(folder.length + 1) : p)
}
/** AI 패널에 보일 한 줄(사용자 쪽 말풍선) */
export const titleOf = (q: QueueItem) => fixTitle(lintOf(q), relOf(q))
/** 분석 프롬프트: 문서 점검 → AI로 고치기 1단계와 같다(분석·계획만, 변경 제출 금지) */
export const promptOf = (q: QueueItem) => fixPrompt(lintOf(q), { projectName: q.projectName, folder: folderOf(q.project) }, relOf(q))

export interface Outcome {
  ok: boolean
  text: string
  ms: number
  costUsd: number
  cancelled: boolean
  error?: string
}
export interface Analysis {
  cancel(): void
  done: Promise<Outcome>
}

export function startAnalysis(prompt: string, engine: 'claude' | 'ollama'): Analysis {
  const t0 = Date.now()
  const out = (o: Partial<Outcome>): Outcome => ({ ok: false, text: '', ms: Date.now() - t0, costUsd: 0, cancelled: false, ...o })

  if (engine === 'claude') {
    const claude = desktop()?.claude
    if (!claude) return { cancel() {}, done: Promise.resolve(out({ error: 'Claude Code 를 쓸 수 없어요' })) }
    let result: Extract<ClaudeEvent, { type: 'result' }> | null = null
    let err: Extract<ClaudeEvent, { type: 'error' }> | null = null
    let aborted = false
    // run() 은 실행을 시작하면 곧바로 돌아오고, 결과·오류는 이벤트로 뒤늦게 온다 — 끝 이벤트를 기다린다
    let finish: () => void = () => {}
    const terminal = new Promise<void>((r) => { finish = r })
    const off = claude.onEvent((e) => {
      if (e.type === 'result') result = e
      else if (e.type === 'error') err = e
      else return
      finish()
    })
    const done = (async (): Promise<Outcome> => {
      try {
        const started = await claude.run({ prompt: buildPrompt({ question: prompt, note: null, mode: 'ask', history: [] }), mode: 'ask' }) // 묻기: 변경 제안 도구가 없다
        // 시작하지 못했으면(이미 실행 중 등) 곧 오는 오류 이벤트만 잠깐 기다리고, 시작했으면 끝날 때까지 기다린다(취소하면 cancelled 오류가 온다)
        if (started && started.ok === false) await Promise.race([terminal, new Promise((r) => setTimeout(r, 3000))])
        else await terminal
      } catch (e) {
        return out({ error: e instanceof Error ? e.message : String(e), cancelled: aborted })
      } finally {
        off()
      }
      const r = result as Extract<ClaudeEvent, { type: 'result' }> | null
      const er = err as Extract<ClaudeEvent, { type: 'error' }> | null
      if (aborted || er?.code === 'cancelled') return out({ cancelled: true, costUsd: r?.costUsd ?? 0 })
      if (r?.ok) return out({ ok: true, text: r.text, costUsd: r.costUsd })
      return out({ error: er?.message ?? r?.text ?? 'Claude 가 답하지 못했어요', costUsd: r?.costUsd ?? 0 })
    })()
    return { cancel: () => { aborted = true; void claude.cancel() }, done }
  }

  const cfg = loadLlmConfig()
  const ac = new AbortController()
  const done = (async (): Promise<Outcome> => {
    if (!cfg) return out({ error: '설정에 로컬 모델이 없어요' })
    const partial = new Set<string>()
    try {
      const r = await runAgent(
        { question: prompt, note: null, mode: 'ask', history: [], signal: ac.signal },
        {
          turn: (messages, tools, signal) => chatTurn(cfg, messages, { tools, think: false, numCtx: 16384, temperature: 0.2, maxTokens: 2048, timeoutMs: 300_000 }, signal),
          // 읽기 전용 환경: propose_change 는 도구 단계에서 거절된다
          exec: (name, args) => callTool(name, args, { ...buildEnv(true, true, false), partialPaths: partial }, '앱 안 자동 분석'),
          onStep: () => {},
          markPartial: (p) => partial.add(p),
        },
      )
      return out({ ok: true, text: r.text })
    } catch (e) {
      if (ac.signal.aborted || (e instanceof AgentError && e.code === 'cancelled')) return out({ cancelled: true })
      return out({ error: e instanceof Error ? e.message : String(e) })
    }
  })()
  return { cancel: () => ac.abort(), done }
}
