import { describe, expect, it } from 'vitest'
import { answerNote, answersFolder, titleOfAnswer } from './aiExport'

describe('AI 답변 내보내기', () => {
  it('제목은 답변의 첫 의미 있는 줄(제목 기호·특수문자 제거, 40자)', () => {
    expect(titleOfAnswer('## 정리 결과\n\n본문', '질문')).toBe('정리 결과')
    expect(titleOfAnswer('', '질문 하나')).toBe('질문 하나')
    expect(titleOfAnswer('a/b:c*d', 'q')).toBe('a b c d')
    expect(titleOfAnswer('x'.repeat(80), 'q')).toHaveLength(40)
    expect(titleOfAnswer('', '')).toBe('AI')
  })
  it('언어별 폴더, 이름이 겹치면 (2), 질문은 인용으로, 출처 표시', () => {
    expect(answersFolder('ko')).toBe('AI 답변')
    expect(answersFolder('en')).toBe('AI Answers')
    const n = answerNote('# 결과\n내용', '무엇을 했나요?\n두 줄', 'ko', new Set(['AI 답변/결과.md']), '2026-11-10')
    expect(n.path).toBe('AI 답변/결과 (2).md')
    expect(n.content).toBe('---\nsource: ai\ndate: 2026-11-10\n---\n# 결과\n\n> 무엇을 했나요?\n> 두 줄\n\n# 결과\n내용\n')
    expect(answerNote('답', '', 'en', new Set(), '2026-01-01').content).not.toContain('>')
  })
})
