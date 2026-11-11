import { beforeEach, describe, expect, it } from 'vitest'
import { disableTile, enableTile, forgetTile, loadLayout, renameTile, saveLayout, setHidden, defaultLayout } from './tiles'
import { matchesPreset, presetLayout, PERSONAS } from './persona'

beforeEach(() => localStorage.clear())

describe('역할 구성에 없는 프로젝트 타일: 프로젝트가 생기면 저절로 보인다(auto)', () => {
  const student = () => presetLayout('student', defaultLayout(), [])
  it('학생 구성은 프로젝트 타일을 숨겨 두되 auto 로 표시한다', () => {
    const l = student()
    expect(l.hidden).toContain('projects')
    expect(l.auto).toEqual(['projects'])
  })
  it('프로젝트 타일이 있는 역할(기획자 등)에는 auto 가 없다', () => {
    for (const p of PERSONAS.filter((x) => x !== 'student')) expect(presetLayout(p, defaultLayout(), []).auto, p).toBeUndefined()
  })
  it('사용자가 직접 켜면 auto 에서 빠진다(그 뒤로는 사용자의 뜻)', () => {
    expect(enableTile(student(), [], 'projects').auto).toBeUndefined()
  })
  it('직접 끄거나 숨김을 바꿔도 auto 에서 빠진다(끈 타일이 다시 저절로 나타나지 않는다)', () => {
    expect(disableTile(student(), [], 'projects').auto).toBeUndefined()
    expect(setHidden(student(), 'projects', true).auto).toBeUndefined()
    expect(setHidden(student(), 'projects', false).auto).toBeUndefined()
  })
  it('다른 타일을 켜고 꺼도 auto 는 그대로', () => {
    expect(enableTile(student(), [], 'doing').auto).toEqual(['projects'])
    expect(disableTile(student(), [], 'today').auto).toEqual(['projects'])
  })
  it('사용자 타일 이름 바꾸기·지우기가 auto 를 지우지 않는다', () => {
    const l = { ...student(), order: [...student().order, 'view:내 타일'] }
    expect(renameTile(l, '내 타일', '새 이름').auto).toEqual(['projects'])
    expect(forgetTile(l, '내 타일').auto).toEqual(['projects'])
  })
  it('저장했다 읽어도 유지된다(없으면 필드가 생기지 않는다)', () => {
    saveLayout(student())
    expect(loadLayout().auto).toEqual(['projects'])
    saveLayout(defaultLayout())
    expect('auto' in loadLayout()).toBe(false)
  })
  it('깨진 auto 값은 무시한다', () => {
    localStorage.setItem('nosidian.worklayout', JSON.stringify({ order: [], hidden: [], collapsed: [], limit: {}, auto: [1, null, 'projects'] }))
    expect(loadLayout().auto).toEqual(['projects'])
  })
  it('역할 프리셋과 같은지 보는 기능에는 영향이 없다', () => {
    expect(matchesPreset('student', student())).toBe(true)
  })
})
