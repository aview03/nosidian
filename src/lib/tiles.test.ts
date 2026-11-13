import { beforeEach, describe, expect, it } from 'vitest'
import { BUILTIN_TILES, customId, defaultLayout, forgetTile, loadLayout, moveBefore, moveTile, renameTile, resolveTiles, saveLayout, setCollapsed, setHidden, setLimit } from './tiles'

const ids = (l: ReturnType<typeof defaultLayout>, customs: string[] = []) => resolveTiles(l, customs).map((x) => x.id)
const visible = (l: ReturnType<typeof defaultLayout>, customs: string[] = []) => resolveTiles(l, customs).filter((x) => !x.hidden).map((x) => x.id)

describe('내 업무 타일 배치', () => {
  beforeEach(() => localStorage.clear())

  it('처음에는 기본 타일 10개, 이번 주·진행 중·담당자 없는 일은 숨김', () => {
    const l = defaultLayout()
    expect(ids(l)).toEqual([...BUILTIN_TILES])
    expect(visible(l)).toEqual(['overdue', 'today', 'decisions', 'dueToday', 'waiting', 'triage', 'projects'])
  })
  it('사용자 타일은 뒤에 붙고, 없어진 타일은 무시한다', () => {
    const l = { ...defaultLayout(), order: [...BUILTIN_TILES, customId('옛 타일')] }
    expect(ids(l, ['민수 일'])).toEqual([...BUILTIN_TILES, customId('민수 일')])
  })
  it('줄 수 기본값: 오늘 일정·프로젝트는 전부, 나머지는 5줄', () => {
    const t = Object.fromEntries(resolveTiles(defaultLayout(), []).map((x) => [x.id, x.limit]))
    expect(t.today).toBe(0)
    expect(t.projects).toBe(0)
    expect(t.overdue).toBe(5)
    expect(resolveTiles(setLimit(defaultLayout(), 'overdue', 10), []).find((x) => x.id === 'overdue')!.limit).toBe(10)
  })
  it('위/아래 이동은 숨긴 타일을 건너뛴다', () => {
    let l = defaultLayout()
    l = moveTile(l, [], 'dueToday', -1) // decisions 와 맞바꿈
    expect(visible(l).slice(0, 4)).toEqual(['overdue', 'today', 'dueToday', 'decisions'])
    l = moveTile(l, [], 'waiting', -1) // 사이의 숨긴 week 를 건너뛰고 decisions 와 맞바꿈
    expect(visible(l).slice(0, 5)).toEqual(['overdue', 'today', 'dueToday', 'waiting', 'decisions'])
    expect(moveTile(l, [], 'overdue', -1)).toBe(l) // 맨 위는 그대로
    expect(moveTile(l, [], 'projects', 1)).toBe(l) // 맨 아래는 그대로
  })
  it('끌어 놓기: 대상 바로 앞으로', () => {
    const l = moveBefore(defaultLayout(), [], 'projects', 'today')
    expect(visible(l).slice(0, 3)).toEqual(['overdue', 'projects', 'today'])
    expect(moveBefore(defaultLayout(), [], 'today', 'today')).toEqual(defaultLayout())
  })
  it('숨기기·다시 보이기·접기', () => {
    let l = setHidden(defaultLayout(), 'overdue', true)
    expect(visible(l)).not.toContain('overdue')
    l = setHidden(l, 'week', false)
    expect(visible(l)).toContain('week')
    l = setCollapsed(l, 'waiting', true)
    expect(resolveTiles(l, []).find((x) => x.id === 'waiting')!.collapsed).toBe(true)
    expect(resolveTiles(setCollapsed(l, 'waiting', false), []).find((x) => x.id === 'waiting')!.collapsed).toBe(false)
  })
  it('사용자 타일 이름을 바꾸면 자리와 설정이 따라가고, 지우면 치운다', () => {
    let l = setLimit(setHidden(moveBefore({ ...defaultLayout(), order: [...BUILTIN_TILES, customId('A')] }, ['A'], customId('A'), 'today'), customId('A'), true), customId('A'), 3)
    l = renameTile(l, 'A', 'B')
    expect(ids(l, ['B']).indexOf(customId('B'))).toBe(1)
    expect(l.hidden).toContain(customId('B'))
    expect(l.limit[customId('B')]).toBe(3)
    expect(l.order).not.toContain(customId('A'))
    l = forgetTile(l, 'B')
    expect(l.order).not.toContain(customId('B'))
    expect(l.hidden).not.toContain(customId('B'))
    expect(l.limit[customId('B')]).toBeUndefined()
  })
  it('저장·읽기 왕복, 깨진 값은 기본값', () => {
    const l = setHidden(defaultLayout(), 'overdue', true)
    saveLayout(l)
    expect(loadLayout()).toEqual(l)
    localStorage.setItem('nosidian.worklayout', '{깨짐')
    expect(loadLayout()).toEqual(defaultLayout())
    localStorage.setItem('nosidian.worklayout', JSON.stringify({ order: 3, hidden: ['a', 1], limit: { x: -1, y: 4 } }))
    expect(loadLayout()).toEqual({ order: [], hidden: ['a'], collapsed: [], limit: { y: 4 } })
  })
})
