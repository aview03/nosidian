import { afterEach, describe, expect, it } from 'vitest'
import { depthOf, wordsOf } from './projectKind'
import { defaultTemplateId } from './projectTemplates'
import { setLang } from './i18n'

afterEach(() => setLang('ko'))

describe('프로젝트 깊이·용어 (첫 걸음)', () => {
  it('depth: light(와 가볍게·simple·간단히)만 가볍게, 없거나 다른 값은 표준', () => {
    expect(depthOf({ depth: 'light' })).toBe('light')
    expect(depthOf({ depth: ' Light ' })).toBe('light')
    expect(depthOf({ depth: '가볍게' })).toBe('light')
    expect(depthOf({ depth: 'simple' })).toBe('light')
    expect(depthOf({ depth: 'standard' })).toBe('standard')
    expect(depthOf({ depth: 'full' })).toBe('standard')
    expect(depthOf({})).toBe('standard')
    expect(depthOf(undefined)).toBe('standard')
    expect(depthOf(null)).toBe('standard')
  })
  it('기본 용어: 할 일·진행 중·대기·완료·취소됨', () => {
    setLang('ko')
    expect(wordsOf({})).toEqual({ todo: '할 일', doing: '진행 중', waiting: '대기', done: '완료', dropped: '취소됨' })
    expect(wordsOf(undefined)).toEqual(wordsOf({}))
    expect(wordsOf({ words: 'unknown' })).toEqual(wordsOf({}))
  })
  it('words: design(또는 디자인): 시작 전·시안 중·검토 요청·확정', () => {
    setLang('ko')
    const d = { todo: '시작 전', doing: '시안 중', waiting: '검토 요청', done: '확정', dropped: '취소됨' }
    expect(wordsOf({ words: 'design' })).toEqual(d)
    expect(wordsOf({ words: '디자인' })).toEqual(d)
    expect(wordsOf({ words: ' Design ' })).toEqual(d)
  })
  it('영어에서도 용어가 나온다', () => {
    setLang('en')
    const w = wordsOf({ words: 'design' })
    expect(w.todo).toBe('Not started')
    expect(w.waiting).toBe('In review')
    expect(wordsOf({}).doing).toBe('In progress')
  })
  it('마법사의 기본 템플릿: 디자이너 → 디자인 일정, 기획자 → 기획 정식, 그 밖 → 첫 번째. 없는 템플릿이면 첫 번째', () => {
    const ids = ['general', 'event', 'content', 'design', 'planning']
    expect(defaultTemplateId('designer', ids)).toBe('design')
    expect(defaultTemplateId('planner', ids)).toBe('planning')
    expect(defaultTemplateId('developer', ids)).toBe('general')
    expect(defaultTemplateId(null, ids)).toBe('general')
    expect(defaultTemplateId(undefined, ids)).toBe('general')
    expect(defaultTemplateId('designer', ['general', 'event'])).toBe('general')
  })
})
