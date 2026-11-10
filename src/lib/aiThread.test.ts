import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from './i18n'
import { useApp } from './app'
import { PANEL_DEFAULT, startAiThread, turnsOf, useAiThread, type Msg } from './aiThread'
import { useProposals } from './proposalStore'
import type { ClaudeEvent } from './externalIO'
import type { Proposal } from './proposals'

setLang('ko')

type Handler = (e: ClaudeEvent) => void
let handler: Handler | null = null
const run = vi.fn(async (_req: { prompt: string; mode?: 'ask' | 'edit' }) => ({ ok: true }))
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
  useAiThread.setState({ open: false, wide: false, width: PANEL_DEFAULT, mode: 'ask', withNote: true, messages: [], draft: '', running: false, vault: null, loaded: false })
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
  it('turnsOf: 완료된 (질문, 답변) 쌍만', () => {
    const m = (role: 'user' | 'ai', text: string, status?: Msg['status']): Msg => ({ id: text, role, text, at: 1, status })
    expect(turnsOf([m('user', 'a'), m('ai', 'A', 'done'), m('user', 'b'), m('ai', '', 'running')])).toEqual([{ q: 'a', a: 'A' }])
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
