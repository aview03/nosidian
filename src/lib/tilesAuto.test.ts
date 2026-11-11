import { beforeEach, describe, expect, it } from 'vitest'
import { disableTile, enableTile, forgetTile, loadLayout, renameTile, saveLayout, setHidden, defaultLayout } from './tiles'
import { matchesPreset, presetLayout, PERSONAS } from './persona'

beforeEach(() => localStorage.clear())

describe('역할 구성에 없는 프로젝트 타일: 프로젝트가 생기면 저절로 보인다(auto)', () => {
  const student = () => presetLayout('student', defaultLayout(), [])
  it('학생 구성은 프로젝트·정리할 업무 타일을 숨겨 두되 auto 로 표시한다', () => {
    const l = student()
    expect(l.hidden).toContain('projects')
    expect(l.auto).toEqual(['projects', 'triage'])
  })
  it('역할 구성에 없는 타일만 auto 가 된다(구성에 있는 타일은 auto 가 아니다)', () => {
    for (const p of PERSONAS) {
      const l = presetLayout(p, defaultLayout(), [])
      const auto = l.auto ?? []
      for (const id of ['projects', 'triage']) expect(auto.includes(id), `${p}:${id}`).toBe(l.hidden.includes(id))
    }
    expect(presetLayout('developer', defaultLayout(), []).auto).toBeUndefined() // 둘 다 구성에 있다
    expect(presetLayout('planner', defaultLayout(), []).auto).toEqual(['triage'])
  })
  it('사용자가 직접 켜면 auto 에서 빠진다(그 뒤로는 사용자의 뜻)', () => {
    expect(enableTile(student(), [], 'projects').auto).toEqual(['triage']) // 켠 타일만 빠진다
    expect(enableTile(enableTile(student(), [], 'projects'), [], 'triage').auto).toBeUndefined()
  })
  it('직접 끄거나 숨김을 바꿔도 auto 에서 빠진다(끈 타일이 다시 저절로 나타나지 않는다)', () => {
    expect(disableTile(student(), [], 'projects').auto).toEqual(['triage'])
    expect(setHidden(student(), 'projects', true).auto).toEqual(['triage'])
    expect(setHidden(student(), 'projects', false).auto).toEqual(['triage'])
  })
  it('다른 타일을 켜고 꺼도 auto 는 그대로', () => {
    expect(enableTile(student(), [], 'doing').auto).toEqual(['projects', 'triage'])
    expect(disableTile(student(), [], 'today').auto).toEqual(['projects', 'triage'])
  })
  it('사용자 타일 이름 바꾸기·지우기가 auto 를 지우지 않는다', () => {
    const l = { ...student(), order: [...student().order, 'view:내 타일'] }
    expect(renameTile(l, '내 타일', '새 이름').auto).toEqual(['projects', 'triage'])
    expect(forgetTile(l, '내 타일').auto).toEqual(['projects', 'triage'])
  })
  it('저장했다 읽어도 유지된다(없으면 필드가 생기지 않는다)', () => {
    saveLayout(student())
    expect(loadLayout().auto).toEqual(['projects', 'triage'])
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
