import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chatTurn } from './llmNet'
import { setLang } from './i18n'
import { useApp } from './app'
import { PANEL_DEFAULT, startAiThread, turnsOf, useAiThread, type Msg } from './aiThread'
import { useProposals } from './proposalStore'
import type { ClaudeEvent } from './externalIO'
import type { Proposal } from './proposals'

setLang('ko')

// 모델 호출(네트워크)만 가짜로 바꾼다. 도구 실행·정책·제안 처리는 실제 코드가 돈다.
vi.mock('./llmNet', () => ({ chatTurn: vi.fn(), migrateLlmKey: async () => false, listModels: vi.fn(), chat: vi.fn(), keyStoreStatus: async () => ({ available: false, has: false }), storeKey: vi.fn(), clearStoredKey: vi.fn() }))
const turnMock = vi.mocked(chatTurn)

type Handler = (e: ClaudeEvent) => void
let handler: Handler | null = null
const run = vi.fn(async (_req: { prompt: string; mode?: 'ask' | 'edit'; forceApproval?: boolean }) => ({ ok: true }))
const cancel = vi.fn(async () => true)

function install() {
  handler = null
  run.mockClear()
  cancel.mockClear()
  ;(window as unknown as { amsidianDesktop: unknown }).amsidianDesktop = {
    claude: { detect: async () => ({ found: true, loggedIn: true }), run, cancel, onEvent: (cb: Handler) => { handler = cb; return () => { handler = null } } },
  }
}
const emit = (e: ClaudeEvent) => handler!(e)
const prop = (id: string, over: Partial<Proposal> = {}): Proposal => ({ id, createdAt: 1, by: 'MCP · 앱 안 Claude', req: { action: 'modify', path: 'a.md' }, reason: 'officialApprove', status: 'pending', ...over })

beforeEach(() => {
  localStorage.clear()
  install()
  useApp.setState({ current: 'p/개요.md' })
  useAiThread.setState({ open: false, wide: false, width: PANEL_DEFAULT, mode: 'ask', engine: 'claude', withNote: true, messages: [], draft: '', running: false, vault: null, loaded: false })
  turnMock.mockReset()
  useProposals.setState({ items: [], vault: null, loaded: true })
  startAiThread()
})

describe('AI 스레드: 보내기와 이벤트', () => {
  it('질문을 보내면 사용자·AI(진행 중) 메시지가 생기고, 열린 노트·모드와 함께 CLI 를 부른다', async () => {
    await useAiThread.getState().send('  요약해 줘  ')
    const s = useAiThread.getState()
    expect(s.running).toBe(true)
    expect(s.messages.map((m) => [m.role, m.text, m.status])).toEqual([['user', '요약해 줘', undefined], ['ai', '', 'running']])
    expect(s.messages[0]).toMatchObject({ note: 'p/개요.md', mode: 'ask' })
    expect(run).toHaveBeenCalledTimes(1)
    const req = run.mock.calls[0][0]
    expect(req.mode).toBe('ask')
    expect(req.prompt).toContain('요약해 줘')
    expect(req.prompt).toContain('p/개요.md')
    expect(req.prompt).toContain('read-only')
  })
  it('진행(tool)은 단계로 쌓이고, 결과는 답변이 되며 실행이 끝난다', async () => {
    await useAiThread.getState().send('q')
    emit({ type: 'tool', name: 'search_notes', input: '행사' })
    emit({ type: 'tool', name: 'read_note', input: 'a.md' })
    expect(useAiThread.getState().messages[1].steps).toEqual([{ name: 'search_notes', input: '행사' }, { name: 'read_note', input: 'a.md' }])
    emit({ type: 'result', ok: true, text: '답변이에요', turns: 3, costUsd: 0.02 })
    const m = useAiThread.getState().messages[1]
    expect(m).toMatchObject({ status: 'done', text: '답변이에요', turns: 3 })
    expect(useAiThread.getState().running).toBe(false)
  })
  it('오류 이벤트는 오류 메시지로, 결과가 실패(ok:false)여도 오류로 표시', async () => {
    await useAiThread.getState().send('q')
    emit({ type: 'error', code: 'timeout', message: 'AI 가 너무 오래 걸려서 멈췄어요' })
    expect(useAiThread.getState().messages[1]).toMatchObject({ status: 'error', error: 'AI 가 너무 오래 걸려서 멈췄어요' })
    expect(useAiThread.getState().running).toBe(false)
    await useAiThread.getState().send('q2')
    emit({ type: 'result', ok: false, text: '실패 사유', turns: 1, costUsd: 0 })
    expect(useAiThread.getState().messages[3]).toMatchObject({ status: 'error', error: '실패 사유' })
  })
  it('이번 실행으로 생긴 변경 제안만 답변에 붙는다(이전부터 있던 제안은 제외)', async () => {
    useProposals.setState({ items: [prop('old')] })
    await useAiThread.getState().send('바꿔 줘')
    useProposals.setState({ items: [prop('old'), prop('new1'), prop('new2')] })
    emit({ type: 'result', ok: true, text: '제안했어요', turns: 4, costUsd: 0 })
    expect(useAiThread.getState().messages[1].proposals).toEqual(['new1', 'new2'])
  })
  it('실행 중인 답변이 없을 때 온 이벤트는 무시한다', () => {
    emit({ type: 'tool', name: 'search_notes', input: '' })
    emit({ type: 'result', ok: true, text: 'x', turns: 1, costUsd: 0 })
    expect(useAiThread.getState().messages).toEqual([])
  })
  it('실행 중에 또 보내면 무시하고, 빈 질문도 무시, 중지는 CLI 에 전달', async () => {
    await useAiThread.getState().send('q')
    await useAiThread.getState().send('또')
    await useAiThread.getState().send('   ')
    expect(run).toHaveBeenCalledTimes(1)
    expect(useAiThread.getState().messages).toHaveLength(2)
    useAiThread.getState().cancel()
    expect(cancel).toHaveBeenCalled()
  })
  it('CLI 호출 자체가 실패하면 오류로 끝낸다', async () => {
    run.mockRejectedValueOnce(new Error('연결 끊김'))
    await useAiThread.getState().send('q')
    expect(useAiThread.getState().messages[1]).toMatchObject({ status: 'error', error: '연결 끊김' })
    expect(useAiThread.getState().running).toBe(false)
  })
})

describe('AI 스레드: 모드·맥락', () => {
  it('변경 제안 모드는 mode:edit 로 보내고 선택은 기억한다', async () => {
    useAiThread.getState().setMode('edit')
    await useAiThread.getState().send('고쳐 줘')
    expect(run.mock.calls[0][0].mode).toBe('edit')
    expect(run.mock.calls[0][0].prompt).toContain('propose_change')
    expect(localStorage.getItem('nosidian.ai.mode')).toBe('"edit"')
  })
  it('열린 노트 칩을 끄면 노트 경로를 보내지 않는다', async () => {
    useAiThread.getState().setWithNote(false)
    await useAiThread.getState().send('q')
    expect(run.mock.calls[0][0].prompt).not.toContain('p/개요.md')
    expect(useAiThread.getState().messages[0].note).toBeNull()
  })
  it('후속 질문에는 앞선 완료된 대화가 맥락으로 붙고, 오류로 끝난 대화는 빠진다', async () => {
    await useAiThread.getState().send('첫 질문')
    emit({ type: 'result', ok: true, text: '첫 답변', turns: 1, costUsd: 0 })
    await useAiThread.getState().send('실패할 질문')
    emit({ type: 'error', code: 'exit', message: '실패' })
    await useAiThread.getState().send('둘째 질문')
    const prompt = run.mock.calls[2][0].prompt
    expect(prompt).toContain('Q: 첫 질문')
    expect(prompt).toContain('A: 첫 답변')
    expect(prompt).not.toContain('실패할 질문')
  })
  it('로컬 모델이 도구를 쓰지 않고 한 답변은 맥락에서 뺀다(근거 없는 "읽었어요"를 따라 하지 않게), 도구를 쓴 답변과 Claude 의 답변은 유지', () => {
    const u = (text: string, engine: 'claude' | 'ollama'): Msg => ({ id: text, role: 'user', text, at: 1, engine })
    const a = (text: string, steps: number): Msg => ({ id: 'a' + text, role: 'ai', text, at: 1, status: 'done', steps: Array.from({ length: steps }, () => ({ name: 'read_note', input: '' })) })
    const msgs = [u('q1', 'ollama'), a('A1', 0), u('q2', 'ollama'), a('A2', 2), u('q3', 'claude'), a('A3', 0)]
    expect(turnsOf(msgs)).toEqual([{ q: 'q2', a: 'A2' }, { q: 'q3', a: 'A3' }])
  })
  it('turnsOf: 완료된 (질문, 답변) 쌍만', () => {
    const m = (role: 'user' | 'ai', text: string, status?: Msg['status']): Msg => ({ id: text, role, text, at: 1, status })
    expect(turnsOf([m('user', 'a'), m('ai', 'A', 'done'), m('user', 'b'), m('ai', '', 'running')])).toEqual([{ q: 'a', a: 'A' }])
  })
})

describe('AI 스레드: 문서 점검 → AI로 고치기', () => {
  it('askFix: 패널을 열고, 화면에는 점검 제목을 보이고, 모델에는 분석 프롬프트를 읽기 전용으로 보낸다(저장된 모드 선택은 그대로)', async () => {
    useAiThread.setState({ mode: 'edit' })
    await useAiThread.getState().askFix('점검 · 중복 문서 후보: a.md ↔ b.md', '[Task] 분석하라 do NOT call propose_change')
    const s = useAiThread.getState()
    expect(s.open).toBe(true)
    expect(s.mode).toBe('edit') // 사용자가 고른 모드는 바뀌지 않는다
    expect(s.messages[0]).toMatchObject({ role: 'user', text: '점검 · 중복 문서 후보: a.md ↔ b.md', mode: 'ask', note: null })
    expect(s.messages[1]).toMatchObject({ role: 'ai', fix: 'plan', status: 'running' })
    const req = run.mock.calls[0][0]
    expect(req.mode).toBe('ask')
    expect(req.prompt).toContain('[Task] 분석하라')
    expect(req.prompt).not.toContain('p/개요.md') // 열린 노트 칩은 보내지 않는다(문제에 포함된 노트만)
  })
  it('applyPlan: 계획(분석 답변)이 끝난 뒤에만, 변경 제안 모드로 계획 전체를 보낸다', async () => {
    await useAiThread.getState().askFix('점검 · 필수 제목 누락: SPEC.md', 'P')
    const planId = useAiThread.getState().messages[1].id
    await useAiThread.getState().applyPlan(planId) // 아직 실행 중 → 무시
    expect(run).toHaveBeenCalledTimes(1)
    emit({ type: 'result', ok: true, text: '1. 규칙 절을 채운다\n2. 결정 필요: 범위', turns: 3, costUsd: 0 })
    await useAiThread.getState().applyPlan(planId)
    expect(run).toHaveBeenCalledTimes(2)
    const req = run.mock.calls[1][0]
    expect(req.mode).toBe('edit')
    expect(req.prompt).toContain('1. 규칙 절을 채운다')
    expect(req.prompt).toContain('Submit ALL steps')
    const msgs = useAiThread.getState().messages
    expect(msgs[2]).toMatchObject({ role: 'user', text: '정리 계획대로 변경 제안 만들기', mode: 'edit' })
    expect(msgs[3]).toMatchObject({ role: 'ai', fix: 'apply', status: 'running' })
  })
  it('분석에는 승인 강제를 쓰지 않고, 계획 실행에는 쓴다(Claude)', async () => {
    await useAiThread.getState().askFix('t', 'p')
    expect(run.mock.calls[0][0].forceApproval).toBeFalsy()
    emit({ type: 'result', ok: true, text: '계획', turns: 1, costUsd: 0 })
    await useAiThread.getState().applyPlan(useAiThread.getState().messages[1].id)
    expect(run.mock.calls[1][0].forceApproval).toBe(true)
  })
  it('계획 바로 다음의 읽기 전용 후속 질문(결정을 알려 주는 말)은 계획의 연장이라 고친 계획에도 실행 버튼이 붙고, 변경 제안 모드를 고르거나 일반 질문으로 시작하면 연장이 아니다', async () => {
    await useAiThread.getState().askFix('t', 'p')
    emit({ type: 'result', ok: true, text: '계획 v1 (결정 필요: 어느 쪽?)', turns: 1, costUsd: 0 })
    await useAiThread.getState().send('v2 가 맞아요')
    expect(useAiThread.getState().messages[3]).toMatchObject({ role: 'ai', fix: 'plan' })
    expect(run.mock.calls[1][0].mode).toBe('ask') // 후속 질문도 읽기 전용
    emit({ type: 'result', ok: true, text: '계획 v2', turns: 1, costUsd: 0 })
    expect(useAiThread.getState().messages[3].status).toBe('done')
    // 변경 제안 모드의 질문은 계획의 연장이 아니다
    useAiThread.setState({ mode: 'edit' })
    await useAiThread.getState().send('그냥 바꿔 줘')
    expect(useAiThread.getState().messages[5].fix).toBeUndefined()
    emit({ type: 'result', ok: true, text: '답', turns: 1, costUsd: 0 })
    // 직전이 계획이 아닌 일반 답변이면(묻기여도) 연장이 아니다
    useAiThread.setState({ mode: 'ask' })
    await useAiThread.getState().send('일반 질문')
    expect(useAiThread.getState().messages[7].fix).toBeUndefined()
  })
  it('applyPlan 은 분석 답변이 아닌 메시지·실패한 분석에는 동작하지 않는다', async () => {
    await useAiThread.getState().send('그냥 질문')
    emit({ type: 'result', ok: true, text: '답', turns: 1, costUsd: 0 })
    await useAiThread.getState().applyPlan(useAiThread.getState().messages[1].id) // fix 가 아님
    expect(run).toHaveBeenCalledTimes(1)
    await useAiThread.getState().askFix('t', 'p')
    emit({ type: 'error', code: 'exit', message: '실패' })
    await useAiThread.getState().applyPlan(useAiThread.getState().messages[3].id) // 실패한 분석
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('분석 중에는 또 askFix 를 보내지 않는다', async () => {
    await useAiThread.getState().askFix('a', 'p')
    await useAiThread.getState().askFix('b', 'p')
    expect(run).toHaveBeenCalledTimes(1)
    expect(useAiThread.getState().messages).toHaveLength(2)
  })
})

describe('AI 스레드: 보관과 패널 상태', () => {
  it('대화는 vault 별로 이 기기에 저장되고 다시 불러온다', async () => {
    useAiThread.getState().ensure()
    await useAiThread.getState().send('q')
    emit({ type: 'result', ok: true, text: '답', turns: 1, costUsd: 0 })
    expect(localStorage.getItem('nosidian.ai.thread.local')).toContain('"답"')
    useAiThread.setState({ messages: [], loaded: false })
    useAiThread.getState().ensure()
    expect(useAiThread.getState().messages.map((m) => m.text)).toEqual(['q', '답'])
  })
  it('실행 중에 끊긴 대화는 다시 열 때 오류로 바뀐다', () => {
    localStorage.setItem('nosidian.ai.thread.local', JSON.stringify([{ id: '1', role: 'user', text: 'q', at: 1 }, { id: '2', role: 'ai', text: '', at: 1, status: 'running' }]))
    useAiThread.getState().ensure()
    expect(useAiThread.getState().messages[1]).toMatchObject({ status: 'error' })
    expect(useAiThread.getState().running).toBe(false)
  })
  it('깨진 저장값은 빈 대화, 메시지는 최근 40개만 보관', async () => {
    localStorage.setItem('nosidian.ai.thread.local', '{깨짐')
    useAiThread.getState().ensure()
    expect(useAiThread.getState().messages).toEqual([])
    for (let i = 0; i < 25; i++) {
      await useAiThread.getState().send('q' + i)
      emit({ type: 'result', ok: true, text: 'a' + i, turns: 1, costUsd: 0 })
    }
    expect(JSON.parse(localStorage.getItem('nosidian.ai.thread.local')!)).toHaveLength(40)
  })
  it('새 채팅은 비우고(실행 중에는 안 비움), 입력 초안은 보낼 때 비워진다', async () => {
    useAiThread.getState().setDraft('쓰는 중')
    await useAiThread.getState().send('q')
    expect(useAiThread.getState().draft).toBe('')
    useAiThread.getState().clear() // 실행 중 → 무시
    expect(useAiThread.getState().messages).toHaveLength(2)
    emit({ type: 'result', ok: true, text: 'a', turns: 1, costUsd: 0 })
    useAiThread.getState().clear()
    expect(useAiThread.getState().messages).toEqual([])
  })
  it('열고 닫기·폭 제한과 기억', () => {
    useAiThread.getState().toggle()
    expect(useAiThread.getState().open).toBe(true)
    useAiThread.getState().setOpen(false)
    expect(useAiThread.getState().open).toBe(false)
    useAiThread.getState().setWidth(100)
    expect(useAiThread.getState().width).toBe(320)
    useAiThread.getState().setWidth(5000)
    expect(useAiThread.getState().width).toBe(1200)
    useAiThread.getState().setWidth(444.4)
    expect(localStorage.getItem('nosidian.ai.width')).toBe('444')
  })
  it('CLI 가 없는 환경(안드로이드·웹)에서는 아무것도 하지 않는다', async () => {
    ;(window as unknown as { amsidianDesktop: unknown }).amsidianDesktop = undefined
    expect(startAiThread()).toBeUndefined()
    await useAiThread.getState().send('q')
    expect(useAiThread.getState().messages).toEqual([])
  })
})

describe('로컬 모델(Ollama) 엔진', () => {
  const OLLAMA = { kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3.5:4b' }
  const note = (path: string, content: string) => ({ path, content, sha: null, dirty: false, mtime: 0 })
  function setup(files: Record<string, string> = { 'p/개요.md': '# 개요\n견적서 초안', '_workspace/문서규칙.md': '---\nrules: on\nai_write: propose\n---\n' }) {
    localStorage.setItem('nosidian.llm', JSON.stringify(OLLAMA))
    useApp.setState({
      files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, note(k, v)])),
      settings: { ...useApp.getState().settings, activeVault: 'v1', vaults: [{ id: 'v1', name: '테스트', remote: null, bookmarks: [], recent: [], lastSync: null }] as never },
    })
    useAiThread.setState({ engine: 'ollama', vault: 'v1', loaded: false })
    useProposals.setState({ items: [], vault: 'v1', loaded: true })
  }

  it('엔진 선택은 기억되고, 저장된 모델 정보로 사용 가능 여부와 전송 위치를 알려 준다', async () => {
    const { localEngine } = await import('./aiThread')
    expect(localEngine(null)).toMatchObject({ ready: false, problem: 'noConfig' })
    expect(localEngine(OLLAMA as never)).toEqual({ ready: true, label: 'Ollama · qwen3.5:4b', cloud: false })
    expect(localEngine({ ...OLLAMA, baseUrl: 'https://llm.example.com' } as never).cloud).toBe(true)
    expect(localEngine({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'm', apiKey: 'k' })).toMatchObject({ ready: false, problem: 'noTools' })
    expect(localEngine({ ...OLLAMA, model: '' } as never)).toMatchObject({ ready: false, problem: 'noModel' })
    useAiThread.getState().setEngine('ollama')
    expect(localStorage.getItem('nosidian.ai.engine')).toBe('"ollama"')
  })
  it('도구를 부르고 답하는 한 번의 흐름: 검색 → 답변, 진행 단계와 도구 결과가 모델에 돌아간다', async () => {
    setup()
    turnMock
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'search_notes', args: { query: '견적서' } }] })
      .mockResolvedValueOnce({ text: '`p/개요.md` 에 있어요', toolCalls: [] })
    await useAiThread.getState().send('견적서 어디 있어?')
    await vi.waitFor(() => expect(useAiThread.getState().running).toBe(false))
    const [user, ai] = useAiThread.getState().messages
    expect(user).toMatchObject({ engine: 'ollama', mode: 'ask' })
    expect(ai).toMatchObject({ status: 'done', text: '`p/개요.md` 에 있어요', turns: 2 })
    expect(ai.steps).toEqual([{ name: 'search_notes', input: '견적서' }])
    expect(run).not.toHaveBeenCalled() // Claude CLI 는 부르지 않는다
    // 두 번째 모델 호출에는 첫 도구 결과가 들어 있다(실제 mcpTools.search_notes 가 실행되어 열린 vault 에서 찾았다)
    const msgs = turnMock.mock.calls[1][1]
    expect(JSON.parse(msgs.at(-1)!.content)).toMatchObject({ vault: '테스트', count: 1 })
    expect(turnMock.mock.calls[0][2]).toMatchObject({ think: false, numCtx: 16384, timeoutMs: 300000 })
  })
  it('묻기에서는 변경 제안 도구를 모델에게 주지 않는다', async () => {
    setup()
    turnMock.mockResolvedValueOnce({ text: '답', toolCalls: [] })
    await useAiThread.getState().send('q')
    await vi.waitFor(() => expect(useAiThread.getState().running).toBe(false))
    expect(turnMock.mock.calls[0][2]!.tools!.map((t) => t.name)).toEqual(['search_notes', 'read_note', 'list_projects', 'get_document_rules'])
  })
  it('변경 제안 모드: 공식 문서가 아니어도 규칙 밖이므로 승인 대기 제안이 만들어져 답변에 붙는다', async () => {
    setup()
    useAiThread.setState({ mode: 'edit' })
    const content = '# 개요\n견적서 초안\n새 줄'
    turnMock
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'read_note', args: { path: 'p/개요.md' } }] })
      .mockImplementationOnce(async (_c, messages) => {
        const read = JSON.parse(messages.at(-1)!.content)
        return { text: '', toolCalls: [{ name: 'propose_change', args: { action: 'modify', path: 'p/개요.md', content, base_hash: read.content_hash, summary: '새 줄 추가' } }] }
      })
      .mockResolvedValueOnce({ text: '제안했어요. 승인이 필요해요.', toolCalls: [] })
    await useAiThread.getState().send('새 줄을 추가해 줘')
    await vi.waitFor(() => expect(useAiThread.getState().running).toBe(false))
    const ai = useAiThread.getState().messages[1]
    expect(ai.status).toBe('done')
    expect(ai.proposals).toHaveLength(1)
    const p = useProposals.getState().items[0]
    expect(p).toMatchObject({ status: 'pending', req: { action: 'modify', path: 'p/개요.md' }, summary: '새 줄 추가' })
    expect(p.by).toContain('qwen3.5:4b')
    expect(useApp.getState().files['p/개요.md'].content).not.toContain('새 줄') // 승인 전에는 반영되지 않는다
  })
  it('긴 노트는 앞부분만 읽게 되고, 그 노트의 수정 제안은 막힌다(잘린 내용으로 덮어쓰지 않는다) — 같은 상황의 다른 노트는 영향 없음', async () => {
    const big = '# 큰 노트\n' + '줄\n'.repeat(9000) // 12,000자를 넘는다
    setup({ 'p/큰.md': big, 'p/작은.md': '# 작음\n', '_workspace/문서규칙.md': '---\nrules: on\nai_write: direct\n---\n' })
    useAiThread.setState({ mode: 'edit' })
    let readResult: Record<string, unknown> = {}
    turnMock
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'read_note', args: { path: 'p/큰.md' } }] })
      .mockImplementationOnce(async (_c, messages) => {
        const read = JSON.parse(messages.at(-1)!.content)
        readResult = read
        return { text: '', toolCalls: [{ name: 'propose_change', args: { action: 'modify', path: 'p/큰.md', content: '# 큰 노트\n앞부분만', base_hash: read.content_hash } }] }
      })
      .mockImplementationOnce(async (_c, messages) => {
        const result = JSON.parse(messages.at(-1)!.content)
        expect(result.error).toMatch(/truncated/) // 모델에게 거절 이유가 돌아간다
        return { text: '', toolCalls: [{ name: 'propose_change', args: { action: 'modify', path: 'p/작은.md', content: '# 작음\n추가\n', base_hash: '' } }] }
      })
      .mockResolvedValueOnce({ text: '큰 노트는 수정하지 못했어요', toolCalls: [] })
    await useAiThread.getState().send('큰 노트 맨 아래에 추가해 줘')
    await vi.waitFor(() => expect(useAiThread.getState().running).toBe(false))
    expect(readResult).toMatchObject({ truncated: true, notice: expect.stringContaining('Do not modify') })
    expect(readResult.content_hash).toBeTruthy()
    // 큰 노트의 수정 제안은 만들어지지 않았다(원본 그대로)
    expect(useProposals.getState().items.filter((p) => p.req.path === 'p/큰.md')).toEqual([])
    expect(useApp.getState().files['p/큰.md'].content).toBe(big)
    expect(useAiThread.getState().messages[1].text).toContain('수정하지 못했어요')
  })
  it('계획 실행(로컬 모델): 정책이 허용하는 보조 문서 수정도 승인 대기 제안이 된다', async () => {
    setup({ 'p/보조/A.md': '# A\n내용\n', 'p/프로젝트.md': '---\ntype: project\ndocs: 기본\n---\n', '_workspace/문서규칙.md': '---\nrules: on\nai_write: direct\n---\n## 프로필: 기본\n- 보조 :: dir=보조/; aux\n' })
    // 1) 분석 — 도구 없이 계획만 낸다
    turnMock.mockResolvedValueOnce({ text: '1. A 를 고친다', toolCalls: [] })
    await useAiThread.getState().askFix('점검', '분석')
    await vi.waitFor(() => expect(useAiThread.getState().running).toBe(false))
    expect(useAiThread.getState().messages[1]).toMatchObject({ fix: 'plan', status: 'done' })
    // 2) 실행 — 모델이 보조 문서를 수정하려 한다
    const content = '# A\n고침\n'
    turnMock
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'read_note', args: { path: 'p/보조/A.md' } }] })
      .mockImplementationOnce(async (_c, messages) => ({ text: '', toolCalls: [{ name: 'propose_change', args: { action: 'modify', path: 'p/보조/A.md', content, base_hash: JSON.parse(messages.at(-1)!.content).content_hash } }] }))
      .mockResolvedValueOnce({ text: '제안했어요', toolCalls: [] })
    await useAiThread.getState().applyPlan(useAiThread.getState().messages[1].id)
    await vi.waitFor(() => expect(useAiThread.getState().running).toBe(false))
    expect(useApp.getState().files['p/보조/A.md'].content).toBe('# A\n내용\n') // 바로 반영되지 않았다
    expect(useProposals.getState().items[0]).toMatchObject({ status: 'pending', reason: 'planApprove' })
    expect(useAiThread.getState().messages[3].proposals).toHaveLength(1)
  })
  it('설정에 모델이 없으면 오류 메시지로 안내하고 모델을 부르지 않는다', async () => {
    useAiThread.setState({ engine: 'ollama' })
    await useAiThread.getState().send('q')
    expect(useAiThread.getState().messages[1]).toMatchObject({ status: 'error' })
    expect(useAiThread.getState().messages[1].error).toMatch(/AI 연결/)
    expect(useAiThread.getState().running).toBe(false)
    expect(turnMock).not.toHaveBeenCalled()
  })
  it('중지하면 진행 중인 모델 호출을 끊고 취소로 끝난다', async () => {
    setup()
    let signal: AbortSignal | undefined
    turnMock.mockImplementationOnce((_c, _m, _o, s) => new Promise((_resolve, reject) => { signal = s; s!.addEventListener('abort', () => reject(new Error('취소했어요'))) }))
    const sent = useAiThread.getState().send('q') // 화면처럼 기다리지 않고 부른다(끝날 때까지 이어진다)
    await vi.waitFor(() => expect(signal).toBeDefined())
    useAiThread.getState().cancel()
    await sent
    expect(useAiThread.getState().running).toBe(false)
    expect(useAiThread.getState().messages[1]).toMatchObject({ status: 'error', error: '취소했어요' })
    expect(cancel).not.toHaveBeenCalled() // Claude CLI 쪽 취소는 부르지 않는다
  })
  it('모델 오류(서버 꺼짐 등)는 오류 메시지로 끝난다', async () => {
    setup()
    turnMock.mockRejectedValueOnce(new Error('연결하지 못했어요'))
    await useAiThread.getState().send('q')
    await vi.waitFor(() => expect(useAiThread.getState().running).toBe(false))
    expect(useAiThread.getState().messages[1]).toMatchObject({ status: 'error', error: '연결하지 못했어요' })
  })
  it('Claude CLI 가 없어도(안드로이드 아님·PC 에서 CLI 미설치) 로컬 모델로는 보낼 수 있다', async () => {
    setup()
    ;(window as unknown as { amsidianDesktop: unknown }).amsidianDesktop = {}
    turnMock.mockResolvedValueOnce({ text: '답', toolCalls: [] })
    await useAiThread.getState().send('q')
    await vi.waitFor(() => expect(useAiThread.getState().messages[1]?.status).toBe('done'))
  })
})
