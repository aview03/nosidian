import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from './app'
import { PERSONAS, PERSONA_INFO, TILE_GROUPS, TILE_HINT, groupOfTile, isPersona, matchesPreset, presetLayout } from './persona'
import { applyPersonaLayout, personaOf, setPersona } from './personaApply'
import { BUILTIN_TILES, customId, defaultLayout, disableTile, enableTile, reorderVisible, resolveTiles } from './tiles'
import { useWorkUi } from './workOps'

const shown = (l: ReturnType<typeof defaultLayout>, customs: string[] = []) => resolveTiles(l, customs).filter((x) => !x.hidden).map((x) => x.id)

describe('역할 프리셋', () => {
  it('모든 역할은 실제 있는 타일만 켜고 "오늘 일정"이 맨 앞이다', () => {
    for (const p of PERSONAS) {
      const tiles = PERSONA_INFO[p].tiles
      expect(tiles[0]).toBe('today')
      expect(new Set(tiles).size).toBe(tiles.length)
      for (const id of tiles) expect(BUILTIN_TILES).toContain(id)
    }
  })
  it('프리셋은 켜 둔 타일을 위에, 나머지를 꺼서 아래에 둔다', () => {
    const l = presetLayout('planner', defaultLayout(), [])
    expect(shown(l)).toEqual(['today', 'decisions', 'overdue', 'waiting', 'projects'])
    expect(l.order.slice(5).sort()).toEqual(BUILTIN_TILES.filter((x) => !PERSONA_INFO.planner.tiles.includes(x)).sort())
    expect(l.hidden.sort()).toEqual(l.order.slice(5).sort())
    expect(l.collapsed).toEqual([])
    expect(l.limit).toEqual({})
  })
  it('내가 만든 타일은 지금 보이는/숨긴 상태 그대로 둔다(보이는 것은 프리셋 타일 뒤)', () => {
    const cur = { ...defaultLayout(), hidden: [customId('B')] }
    const l = presetLayout('student', cur, ['A', 'B'])
    expect(shown(l, ['A', 'B'])).toEqual([...PERSONA_INFO.student.tiles, customId('A')])
    expect(l.hidden).toContain(customId('B'))
  })
  it('학생은 프로젝트·결정·기다림이 꺼져 있고, 개발자는 진행 중·받은 업무가 켜져 있다', () => {
    const st = shown(presetLayout('student', defaultLayout(), []))
    expect(st).not.toContain('projects')
    expect(st).not.toContain('decisions')
    expect(shown(presetLayout('developer', defaultLayout(), []))).toEqual(expect.arrayContaining(['doing', 'triage']))
  })
  it('matchesPreset: 프리셋 그대로면 true, 내가 바꾸면 false(만든 타일은 보지 않는다)', () => {
    const l = presetLayout('marketer', defaultLayout(), [])
    expect(matchesPreset('marketer', l)).toBe(true)
    expect(matchesPreset('planner', l)).toBe(false)
    expect(matchesPreset('marketer', enableTile(l, [], 'unowned'))).toBe(false)
    expect(matchesPreset('marketer', { ...l, order: [...l.order, customId('X')] })).toBe(true)
  })
  it('isPersona/personaOf: 모르는 값은 정하지 않음', () => {
    expect(isPersona('student')).toBe(true)
    expect(isPersona('x')).toBe(false)
    expect(personaOf('x')).toBeNull()
    expect(personaOf(null)).toBeNull()
  })
})

describe('타일 분류와 설명', () => {
  it('모든 내장 타일은 분류와 한 줄 설명이 있고 한 분류에만 속한다', () => {
    const all = TILE_GROUPS.flatMap((g) => g.tiles)
    expect([...all].sort()).toEqual([...BUILTIN_TILES].sort())
    for (const id of BUILTIN_TILES) expect(TILE_HINT[id].length).toBeGreaterThan(3)
    expect(groupOfTile('overdue')).toBe('attention')
    expect(groupOfTile(customId('x'))).toBe('custom')
  })
})

describe('켜진 것 위, 꺼진 것 아래', () => {
  it('끄면 켜 둔 목록에서 빠져 꺼 둔 목록 맨 앞으로, 켜면 켜 둔 목록의 맨 끝으로 간다', () => {
    const l0 = presetLayout('planner', defaultLayout(), [])
    const off = disableTile(l0, [], 'decisions')
    expect(shown(off)).toEqual(['today', 'overdue', 'waiting', 'projects'])
    const rest = resolveTiles(off, []).map((x) => x.id)
    expect(rest.slice(4, 5)).toEqual(['decisions']) // 켜 둔 4개 바로 뒤
    const on = enableTile(off, [], 'unowned')
    expect(shown(on)).toEqual(['today', 'overdue', 'waiting', 'projects', 'unowned'])
    expect(on.hidden).not.toContain('unowned')
  })
  it('켜 둔 타일의 순서를 바꿔도 꺼 둔 타일은 아래에 그대로', () => {
    const l0 = presetLayout('planner', defaultLayout(), [])
    const l = reorderVisible(l0, [], ['projects', 'today', 'overdue', 'waiting', 'decisions'])
    expect(shown(l)).toEqual(['projects', 'today', 'overdue', 'waiting', 'decisions'])
    const all = resolveTiles(l, []).map((x) => x.id)
    expect(all.slice(0, 5)).toEqual(['projects', 'today', 'overdue', 'waiting', 'decisions'])
    expect(resolveTiles(l, []).slice(5).every((x) => x.hidden)).toBe(true)
  })
})

describe('역할 저장(설정)', () => {
  beforeEach(() => {
    localStorage.clear()
    useApp.setState({ settings: { ...useApp.getState().settings, persona: null, personaApply: true }, files: {} })
    useWorkUi.setState({ layout: defaultLayout() })
  })
  it('역할을 고르면 저장되고, 자동 적용이 켜져 있으면 내 업무 구성도 바뀐다', () => {
    setPersona('student')
    expect(useApp.getState().settings.persona).toBe('student')
    expect(shown(useWorkUi.getState().layout)).toEqual(PERSONA_INFO.student.tiles)
  })
  it('자동 적용을 끄면 역할만 저장하고 구성은 그대로 둔다. 버튼으로는 언제든 적용할 수 있다', () => {
    useApp.getState().patchSettings({ personaApply: false })
    const before = useWorkUi.getState().layout
    setPersona('developer')
    expect(useApp.getState().settings.persona).toBe('developer')
    expect(useWorkUi.getState().layout).toEqual(before)
    applyPersonaLayout('developer')
    expect(shown(useWorkUi.getState().layout)).toEqual(PERSONA_INFO.developer.tiles)
  })
  it('"정하지 않음"(null)은 구성을 바꾸지 않는다', () => {
    setPersona('planner')
    const l = useWorkUi.getState().layout
    setPersona(null)
    expect(useApp.getState().settings.persona).toBeNull()
    expect(useWorkUi.getState().layout).toEqual(l)
  })
})
