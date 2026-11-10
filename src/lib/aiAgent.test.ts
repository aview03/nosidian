import { describe, expect, it } from 'vitest'
import { AgentError, AGENT_TOOLS, MAX_ROUNDS, RESULT_CAP, runAgent, summarizeInput, toolsFor, type AgentDeps } from './aiAgent'
import { MCP_TOOL_NAMES } from './mcpTools'
import type { ChatMessage, ModelTurn, ToolSpec } from './llm'

/** 시험용 모델: 준비해 둔 턴을 차례로 돌려주고, 받은 메시지·도구를 기록한다 */
function harness(turns: (ModelTurn | Error)[], exec: AgentDeps['exec'] = () => ({ ok: true })) {
  const seen: { messages: ChatMessage[]; tools: ToolSpec[] }[] = []
  const steps: { name: string; input: string }[] = []
  const partial: string[] = []
  let i = 0
  const deps: AgentDeps = {
    turn: async (messages, tools) => {
      seen.push({ messages: messages.map((m) => ({ ...m })), tools })
      const t = turns[Math.min(i++, turns.length - 1)]
      if (t instanceof Error) throw t
      return t
    },
    exec,
    onStep: (s) => steps.push(s),
    markPartial: (p) => partial.push(p),
  }
  const run = (over: Partial<Parameters<typeof runAgent>[0]> = {}, signal = new AbortController().signal) =>
    runAgent({ question: '요약해 줘', note: null, mode: 'edit', history: [], signal, ...over }, deps)
  return { run, seen, steps, partial }
}
const call = (name: string, args: Record<string, unknown> = {}, id?: string) => ({ ...(id ? { id } : {}), name, args })
const says = (text: string): ModelTurn => ({ text, toolCalls: [] })
const uses = (...calls: ReturnType<typeof call>[]): ModelTurn => ({ text: '', toolCalls: calls })

describe('도구 정의', () => {
  it('MCP 서버와 같은 정의(한 파일)를 쓴다', () => {
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort())
    expect(AGENT_TOOLS.every((t) => t.description && (t.inputSchema as { type: string }).type === 'object')).toBe(true)
  })
  it('묻기는 읽기 도구 4개만 준다', () => {
    expect(toolsFor('ask').map((t) => t.name)).toEqual(['search_notes', 'read_note', 'list_projects', 'get_document_rules'])
    expect(toolsFor('edit')).toHaveLength(6)
  })
  it('진행 표시용 입력 요약: 긴 본문은 싣지 않는다', () => {
    expect(summarizeInput({ query: '행사', limit: 5 })).toBe('행사')
    expect(summarizeInput({ action: 'modify', path: 'a.md', content: '비밀'.repeat(500) })).toBe('modify a.md')
  })
})

describe('에이전트 루프', () => {
  it('도구 없이 바로 답하면 한 번 만에 끝난다', async () => {
    const h = harness([says('  바로 답  ')])
    expect(await h.run()).toEqual({ text: '바로 답', rounds: 1 })
    expect(h.seen[0].messages[0].role).toBe('system')
    expect(h.seen[0].messages.at(-1)).toMatchObject({ role: 'user' })
    expect(h.seen[0].messages.at(-1)!.content).toContain('요약해 줘')
  })
  it('도구를 부르면 실행해 결과(tool 메시지)를 돌려주고, 다음 턴에서 답한다', async () => {
    const h = harness([uses(call('search_notes', { query: '행사' }, 'c1')), says('찾았어요')], (name, args) => ({ name, args, count: 2 }))
    const out = await h.run()
    expect(out).toEqual({ text: '찾았어요', rounds: 2 })
    expect(h.steps).toEqual([{ name: 'search_notes', input: '행사' }])
    const second = h.seen[1].messages
    expect(second.at(-2)).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'c1', name: 'search_notes' }] })
    expect(second.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'c1', toolName: 'search_notes' })
    expect(JSON.parse(second.at(-1)!.content)).toMatchObject({ count: 2 })
  })
  it('도구 오류는 모델에게 {error} 로 돌려줘 스스로 고치게 한다(루프를 끊지 않는다)', async () => {
    const h = harness([uses(call('read_note', { path: 'x.md' })), says('없네요')], () => { throw new Error('Note not found: x.md') })
    await h.run()
    expect(JSON.parse(h.seen[1].messages.at(-1)!.content)).toEqual({ error: 'Note not found: x.md' })
  })
  it('깨진 인자(__raw)는 실행하지 않고 다시 부르라고 알린다', async () => {
    let ran = 0
    const h = harness([uses(call('read_note', { __raw: '{깨짐' })), says('끝')], () => { ran++; return {} })
    await h.run()
    expect(ran).toBe(0)
    expect(JSON.parse(h.seen[1].messages.at(-1)!.content).error).toMatch(/valid JSON/)
  })
  it('묻기에서 제공하지 않은 도구를 부르면 실행하지 않고 쓸 수 있는 도구를 알려 준다', async () => {
    let ran = 0
    const h = harness([uses(call('propose_change', { action: 'create', path: 'a.md', content: 'x' })), says('못 해요')], () => { ran++; return {} })
    await h.run({ mode: 'ask' })
    expect(ran).toBe(0)
    expect(h.seen[0].tools.map((t) => t.name)).not.toContain('propose_change')
    expect(JSON.parse(h.seen[1].messages.at(-1)!.content).error).toMatch(/not available/)
    expect(h.steps).toEqual([]) // 진행 표시에도 올리지 않는다
  })
  it('도구 호출이 한 턴에 여러 개여도 모두 실행하고 각각 결과를 돌려준다', async () => {
    const h = harness([uses(call('read_note', { path: 'a.md' }, 'x'), call('read_note', { path: 'b.md' }, 'y')), says('둘 다 읽음')], (_n, a) => ({ path: a.path }))
    await h.run()
    const tail = h.seen[1].messages.slice(-2)
    expect(tail.map((m) => m.toolCallId)).toEqual(['x', 'y'])
    expect(h.steps.map((s) => s.input)).toEqual(['a.md', 'b.md'])
  })
  it('이전 대화는 질문·답변 메시지로 앞에 붙는다', async () => {
    const h = harness([says('ok')])
    await h.run({ history: [{ q: '앞 질문', a: '앞 답' }] })
    const m = h.seen[0].messages
    expect(m.slice(1, 3)).toEqual([{ role: 'user', content: '앞 질문' }, { role: 'assistant', content: '앞 답' }])
  })
  it('같은 호출만 되풀이하면 멈춘다', async () => {
    const h = harness([uses(call('search_notes', { query: 'a' }))])
    await expect(h.run()).rejects.toMatchObject({ code: 'loop' })
    expect(h.seen.length).toBeLessThan(MAX_ROUNDS) // 상한까지 가지 않고 먼저 끊는다
  })
  it('빈 답이면 오류', async () => {
    await expect(harness([says('   ')]).run()).rejects.toMatchObject({ code: 'empty' })
  })
  it('라운드를 다 쓰면 도구 없이 지금까지로 답하게 한 번 더 시킨다', async () => {
    const turns: ModelTurn[] = Array.from({ length: MAX_ROUNDS }, (_, i) => uses(call('search_notes', { query: 'q' + i })))
    const h = harness([...turns, says('여기까지 알아낸 것')])
    const out = await h.run()
    expect(out).toEqual({ text: '여기까지 알아낸 것', rounds: MAX_ROUNDS + 1 })
    const wrap = h.seen.at(-1)!
    expect(wrap.tools).toEqual([]) // 마지막 턴은 도구 없이
    expect(wrap.messages.at(-1)!.content).toMatch(/Stop calling tools/)
  })
  it('모델 호출 오류는 그대로 올라온다', async () => {
    await expect(harness([new Error('서버 꺼짐')]).run()).rejects.toThrow('서버 꺼짐')
  })
})

describe('취소', () => {
  it('이미 취소된 신호면 모델을 부르지 않는다', async () => {
    const ac = new AbortController()
    ac.abort()
    const h = harness([says('x')])
    await expect(h.run({}, ac.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(h.seen).toHaveLength(0)
  })
  it('도구를 실행하는 중에 취소하면 더 진행하지 않는다', async () => {
    const ac = new AbortController()
    const h = harness([uses(call('search_notes', { query: 'a' })), says('이건 안 나와야 함')], () => { ac.abort(); return {} })
    await expect(h.run({}, ac.signal)).rejects.toBeInstanceOf(AgentError)
    expect(h.seen).toHaveLength(1)
  })
})

describe('도구 결과 크기와 잘린 노트', () => {
  it('긴 노트는 앞부분만 주고 truncated 와 수정 금지 안내를 붙이며, 그 노트를 "일부만 읽음"으로 기록한다', async () => {
    const big = '가'.repeat(RESULT_CAP * 2)
    const h = harness([uses(call('read_note', { path: 'big.md' })), says('요약')], () => ({ path: 'big.md', content: big, content_hash: 'h' }))
    await h.run()
    const sent = JSON.parse(h.seen[1].messages.at(-1)!.content)
    expect(sent.truncated).toBe(true)
    expect(sent.content.length).toBeLessThan(RESULT_CAP)
    expect(sent.notice).toMatch(/Do not modify/)
    expect(sent.content_hash).toBe('h')
    expect(h.partial).toEqual(['big.md'])
  })
  it('짧은 노트는 그대로, 다른 큰 결과는 글자 수만 자른다', async () => {
    const small = harness([uses(call('read_note', { path: 's.md' })), says('x')], () => ({ path: 's.md', content: '짧음', content_hash: 'h' }))
    await small.run()
    expect(JSON.parse(small.seen[1].messages.at(-1)!.content).content).toBe('짧음')
    expect(small.partial).toEqual([])
    const list = harness([uses(call('search_notes', { query: 'a' })), says('x')], () => ({ results: 'r'.repeat(RESULT_CAP * 2) }))
    await list.run()
    const text = list.seen[1].messages.at(-1)!.content
    expect(text.length).toBeLessThan(RESULT_CAP + 200)
    expect(text).toContain('truncated')
  })
})
