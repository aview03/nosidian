import { beforeAll, describe, expect, it } from 'vitest'
import { setLang } from './i18n'
import { buildPrompt, errorText, PRESETS, readiness, toolLabel } from './aiAssistant'

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
