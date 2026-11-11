import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_HUB_VIEW, HUB_VIEWS, loadHubView, saveHubView } from './hubViews'

beforeEach(() => localStorage.clear())

describe('프로젝트 허브 보기 기억', () => {
  it('기억이 없으면 기본 보기', () => expect(loadHubView('a.md')).toBe(DEFAULT_HUB_VIEW))
  it('프로젝트마다 따로 저장하고 불러온다', () => {
    saveHubView('a.md', 'timeline')
    saveHubView('b.md', 'board')
    expect(loadHubView('a.md')).toBe('timeline')
    expect(loadHubView('b.md')).toBe('board')
  })
  it('깨진 값이나 이제 없는 보기 이름이면 기본으로 돌아간다', () => {
    localStorage.setItem('nosidian.hubViews', '{not json')
    expect(loadHubView('a.md')).toBe(DEFAULT_HUB_VIEW)
    localStorage.setItem('nosidian.hubViews', JSON.stringify({ 'a.md': 'kanban2000', 'b.md': 5 }))
    expect(loadHubView('a.md')).toBe(DEFAULT_HUB_VIEW)
    expect(loadHubView('b.md')).toBe(DEFAULT_HUB_VIEW)
  })
  it('보기 키가 겹치지 않고 기본 보기가 목록에 있다', () => {
    const keys = HUB_VIEWS.map((v) => v.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain(DEFAULT_HUB_VIEW)
  })
})
