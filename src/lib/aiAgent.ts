// 앱 안 AI 에이전트 루프(Ollama·OpenAI 호환 모델용): 모델에게 도구(Nosidian MCP 도구 6개와 같은 정의)를 주고,
// 모델이 도구를 부르면 실행해 결과를 돌려주는 일을 답이 나올 때까지 반복한다.
//
// - 도구는 electron/mcp-tools.json 한 곳의 정의를 쓰고, 실행은 mcpTools.callTool 이다 → vault 범위·정책 엔진·승인 흐름이 Claude CLI/외부 MCP 와 똑같다.
// - 묻기(읽기 전용)에서는 변경 제안 도구를 모델에게 주지도 않는다(모델이 몰래 부르려 해도 실행 쪽이 한 번 더 거절한다).
// - 작은 로컬 모델을 위한 안전장치: 도구 결과 크기 상한, 라운드 상한, 같은 호출 반복 감지, 깨진 인자는 오류로 돌려줘 스스로 고치게 한다.
// - 긴 노트는 앞부분만 모델에게 준다. 이때 그 노트는 "일부만 읽음"으로 표시해 두고, 그 노트의 수정 제안은 막는다(잘린 내용으로 덮어쓰지 않게).
// 이 파일은 네트워크·저장소를 직접 쓰지 않는다: 모델 호출(turn)과 도구 실행(exec)은 주입받는다(시험하기 쉽게).
import toolDefs from '../../electron/mcp-tools.json'
import type { ChatMessage, ModelTurn, ToolSpec } from './llm'
import { buildPrompt, type AiMode, type Turn } from './aiAssistant'

export const AGENT_TOOLS = toolDefs as ToolSpec[]
const READ_ONLY = new Set(['search_notes', 'read_note', 'list_projects', 'get_document_rules'])

export const MAX_ROUNDS = 6
/** 도구 결과를 모델에게 돌려줄 때의 글자 수 상한(작은 모델의 문맥을 아끼려고) */
export const RESULT_CAP = 12_000
/** 도구 호출을 허용하는 라운드가 끝난 뒤 "지금까지 읽은 것으로 답하라"고 한 번 더 시킨다 */
const WRAP_UP = 'Stop calling tools. Give your best answer now using only what you have already read.'

export const AGENT_SYSTEM_PROMPT =
  'You are the assistant built into Nosidian, a Markdown notes and projects app. You can only use the provided tools ' +
  '(search_notes, read_note, list_projects, get_document_rules, and sometimes propose_change / get_proposal_status). ' +
  'Call tools one step at a time and read a note before you describe or change it. ' +
  'You cannot edit notes directly: every change must go through propose_change, and a person may have to approve it. ' +
  'Never say a change was applied unless propose_change returned outcome "applied"; if it returned "pending_approval", say the person must approve it in Nosidian. ' +
  'To change a note, read it with read_note, send its content_hash as base_hash, and send the COMPLETE new text as content. ' +
  'If read_note says a note is truncated, do NOT modify it — tell the user instead. ' +
  'Answer in the language of the user\'s question (Korean by default), briefly and concretely, and mention the note paths you relied on in backticks.'

/** 에이전트가 끝난 이유가 정상이 아닐 때 */
export class AgentError extends Error {
  code: 'cancelled' | 'empty' | 'loop'
  constructor(code: AgentError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export interface AgentDeps {
  /** 모델에게 한 턴을 시킨다(tools 가 비면 도구 없이 글만) */
  turn(messages: ChatMessage[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelTurn>
  /** 도구를 실행한다. 오류는 던진다(메시지가 모델에게 돌아가 스스로 고치게 한다) */
  exec(name: string, args: Record<string, unknown>): unknown | Promise<unknown>
  /** 진행 표시 */
  onStep(step: { name: string; input: string }): void
  /** 일부만 읽은 노트를 기록한다(그 노트의 수정 제안을 막는 데 쓴다) */
  markPartial(path: string): void
}

export interface AgentInput {
  question: string
  note?: string | null
  mode: AiMode
  history: Turn[]
  signal: AbortSignal
}

export interface AgentResult {
  text: string
  /** 모델을 부른 횟수 */
  rounds: number
}

/** 모드에 맞는 도구 목록: 묻기는 읽기 도구만 */
export const toolsFor = (mode: AiMode): ToolSpec[] => (mode === 'ask' ? AGENT_TOOLS.filter((t) => READ_ONLY.has(t.name)) : AGENT_TOOLS)

/** 도구 입력을 한 줄로(진행 표시용). 긴 본문(content)은 싣지 않는다 */
export function summarizeInput(args: Record<string, unknown>): string {
  const pick = args.query ?? args.path ?? args.proposal_id ?? args.to ?? ''
  const action = args.action ? `${String(args.action)} ` : ''
  return `${action}${String(pick)}`.slice(0, 120)
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `\n…[truncated: ${s.length - n} more characters]` : s)

/** 도구 결과를 모델에게 돌려줄 글로. read_note 는 내용만 줄이고 "일부만 읽음"을 알린다 */
function resultText(name: string, result: unknown, deps: AgentDeps): string {
  const r = result as Record<string, unknown> | null
  if (name === 'read_note' && r && typeof r.content === 'string' && r.content.length > RESULT_CAP - 1500) {
    const keep = RESULT_CAP - 1500
    deps.markPartial(String(r.path))
    return JSON.stringify({ ...r, content: r.content.slice(0, keep), truncated: true, notice: `Only the first ${keep} of ${r.content.length} characters are shown. Do not modify this note.` })
  }
  return clip(JSON.stringify(result ?? null), RESULT_CAP)
}

export async function runAgent(input: AgentInput, deps: AgentDeps): Promise<AgentResult> {
  const tools = toolsFor(input.mode)
  const messages: ChatMessage[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    ...input.history.flatMap((h): ChatMessage[] => [{ role: 'user', content: h.q }, { role: 'assistant', content: h.a }]),
    { role: 'user', content: buildPrompt({ question: input.question, note: input.note, mode: input.mode }) },
  ]
  const check = () => {
    if (input.signal.aborted) throw new AgentError('cancelled', '취소했어요')
  }
  let rounds = 0
  let lastSig = ''
  let repeats = 0

  for (; rounds < MAX_ROUNDS; ) {
    check()
    const turn = await deps.turn(messages, tools, input.signal)
    rounds++
    check()
    if (!turn.toolCalls.length) {
      const text = turn.text.trim()
      if (!text) throw new AgentError('empty', '모델이 빈 답을 줬어요')
      return { text, rounds }
    }
    messages.push({ role: 'assistant', content: turn.text, toolCalls: turn.toolCalls })
    for (const call of turn.toolCalls) {
      let out: unknown
      if (!tools.some((t) => t.name === call.name)) {
        out = { error: `Tool not available: ${call.name}. Available: ${tools.map((t) => t.name).join(', ')}` }
      } else if ('__raw' in call.args) {
        out = { error: 'The tool arguments were not valid JSON. Call the tool again with a valid JSON object.' }
      } else {
        deps.onStep({ name: call.name, input: summarizeInput(call.args) })
        try {
          out = await deps.exec(call.name, call.args)
        } catch (e) {
          out = { error: e instanceof Error ? e.message : String(e) }
        }
      }
      check()
      messages.push({ role: 'tool', content: resultText(call.name, out, deps), toolCallId: call.id, toolName: call.name })
    }
    // 같은 도구 호출만 되풀이하면 멈춘다(작은 모델이 빠지기 쉬운 반복)
    const sig = turn.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.args)}`).join('|')
    repeats = sig === lastSig ? repeats + 1 : 0
    lastSig = sig
    if (repeats >= 2) throw new AgentError('loop', '같은 도구를 계속 부르고 있어서 멈췄어요')
  }

  // 라운드를 다 썼다: 도구 없이 지금까지 읽은 것으로 답하게 한다
  check()
  messages.push({ role: 'user', content: WRAP_UP })
  const last = await deps.turn(messages, [], input.signal)
  rounds++
  const text = last.text.trim()
  if (!text) throw new AgentError('empty', '모델이 빈 답을 줬어요')
  return { text, rounds }
}
