import { beforeAll, describe, expect, it } from 'vitest'
import { setLang } from './i18n'
import { buildPrompt, errorText, HISTORY_TURNS, linkifyPaths, PRESETS, readiness, toolLabel } from './aiAssistant'

beforeAll(() => setLang('ko')) // 한국어 문구를 비교한다

describe('질문 만들기', () => {
  it('열려 있는 노트가 있으면 경로만 맥락으로 덧붙인다(내용은 싣지 않는다)', () => {
    expect(buildPrompt({ question: '  요약해 줘  ', note: 'a/b.md' })).toBe('요약해 줘\n\n[Context] The note currently open in Nosidian: a/b.md')
    expect(buildPrompt({ question: '요약해 줘', note: null })).toBe('요약해 줘')
    expect(buildPrompt({ question: '요약해 줘' })).toBe('요약해 줘')
  })
  it('빠른 질문: 노트 요약은 열린 노트가 있을 때만 채워진다', () => {
    const note = PRESETS.find((p) => p.id === 'note')!
    expect(note.text(null)).toBe('')
    expect(note.text('x/y.md')).toContain('x/y.md')
    expect(PRESETS.find((p) => p.id === 'projects')!.text()).toMatch(/프로젝트/)
  })
  it('문서 규칙 점검 질문은 변경안을 내지 말라고 한다', () => {
    expect(PRESETS.find((p) => p.id === 'rules')!.text()).toMatch(/변경안은 내지 말고/)
  })
})

describe('상태 판정', () => {
  it('준비 상태', () => {
    expect(readiness(null)).toBe('unknown')
    expect(readiness({ found: false })).toBe('notFound')
    expect(readiness({ found: false, onlyCmd: true })).toBe('onlyCmd')
    expect(readiness({ found: true, loggedIn: false })).toBe('notLoggedIn')
    expect(readiness({ found: true, loggedIn: true, version: '2.1' })).toBe('ok')
  })
  it('도구 이름·오류 문장', () => {
    expect(toolLabel('search_notes')).toBe('노트 검색')
    expect(toolLabel('propose_change')).toBe('변경 제안')
    expect(toolLabel('new_tool')).toBe('new_tool')
    expect(errorText('timeout')).toMatch(/오래/)
    expect(errorText('x', '서버 메시지')).toBe('서버 메시지')
    expect(errorText('mystery')).toMatch(/실패/)
  })
})

describe('모드와 대화 맥락', () => {
  it('묻기는 읽기 전용, 변경 제안은 propose_change 허용을 알린다', () => {
    expect(buildPrompt({ question: 'q', mode: 'ask' })).toContain('read-only')
    expect(buildPrompt({ question: 'q', mode: 'edit' })).toContain('propose_change')
    expect(buildPrompt({ question: 'q' })).toBe('q')
  })
  it('앞선 대화는 최근 3번까지, 각 600자까지, 질문 앞에 붙는다', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({ q: `질문${i}`, a: i === 4 ? 'x'.repeat(900) : `답${i}` }))
    const p = buildPrompt({ question: '지금 질문', history })
    expect(HISTORY_TURNS).toBe(3)
    expect(p.startsWith('[Previous conversation')).toBe(true)
    expect(p).not.toContain('질문0')
    expect(p).not.toContain('질문1')
    expect(p).toContain('질문2')
    expect(p).toContain('질문4')
    expect(p).toContain('x'.repeat(600) + '…')
    expect(p).not.toContain('x'.repeat(601))
    expect(p.indexOf('질문4')).toBeLessThan(p.indexOf('지금 질문'))
  })
})

describe('답변 속 노트 경로 링크', () => {
  const has = (p: string) => ['a/b.md', '프로젝트/행사 준비/개요.md'].includes(p)
  it('실제 있는 노트의 `경로.md` 만 [[경로|이름]] 으로 바꾼다', () => {
    expect(linkifyPaths('근거: `a/b.md` 와 `프로젝트/행사 준비/개요.md`', has)).toBe('근거: [[a/b.md|b]] 와 [[프로젝트/행사 준비/개요.md|개요]]')
    expect(linkifyPaths('없는 노트 `x/y.md`', has)).toBe('없는 노트 `x/y.md`')
    expect(linkifyPaths('명령 `npm test` 와 `a/b.txt`', has)).toBe('명령 `npm test` 와 `a/b.txt`')
  })
  it('코드 블록 안은 바꾸지 않는다', () => {
    const t = '```\n`a/b.md`\n```\n밖: `a/b.md`'
    expect(linkifyPaths(t, has)).toBe('```\n`a/b.md`\n```\n밖: [[a/b.md|b]]')
  })
})
