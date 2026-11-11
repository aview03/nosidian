// 내 업무 화면의 "타일" 배치: 어떤 타일을 어떤 순서로 보일지, 무엇을 숨기고 접을지, 타일마다 몇 줄까지 보일지.
//
// 타일 = 화면의 한 덩어리(오늘 일정, 기한 지난 일, 프로젝트 …). 기본 타일 10개와, 사용자가 조건을 골라 만든 타일(`view:이름`)이 있다.
// 타일 내용은 노트에서 계산한 값이고, 여기서 저장하는 것은 **배치뿐**이다. 배치는 개인 취향이라 기기(localStorage)에 두고,
// 사용자가 만든 타일의 조건은 팀이 같이 쓰도록 vault 노트(_workspace/보기.md)에 둔다(views.ts).

export const BUILTIN_TILES = ['today', 'overdue', 'decisions', 'dueToday', 'week', 'waiting', 'doing', 'unowned', 'triage', 'projects'] as const
export type BuiltinTile = (typeof BUILTIN_TILES)[number]

/** 처음에는 숨겨 두는 타일(필요하면 "타일 추가"로 꺼낸다). triage 는 받은 업무가 생길 때만 내용이 있어 숨기지 않는다 */
export const DEFAULT_HIDDEN: string[] = ['week', 'doing', 'unowned']

export const customId = (name: string) => `view:${name}`
export const isCustom = (id: string) => id.startsWith('view:')
export const customName = (id: string) => id.slice(5)

/** 타일마다 처음 보일 줄 수. 0 = 전부 */
export const DEFAULT_LIMIT = 5
export const LIMIT_CHOICES = [3, 5, 10, 0] as const
const UNLIMITED: string[] = ['today', 'projects']

export interface Layout {
  /** 보이는 순서(숨긴 것 포함). 모르는 타일은 무시하고, 새 타일은 뒤에 붙는다 */
  order: string[]
  hidden: string[]
  collapsed: string[]
  /** 타일별 처음 보일 줄 수(없으면 기본값) */
  limit: Record<string, number>
  /** 숨겨 두었지만 **내용이 생기면 저절로 보이는** 타일(역할 구성에 없는 프로젝트 타일 — 프로젝트를 만든 사람이 길을 잃지 않게). 사용자가 직접 켜거나 끄면 여기서 빠진다 */
  auto?: string[]
}

export const defaultLayout = (): Layout => ({ order: [...BUILTIN_TILES], hidden: [...DEFAULT_HIDDEN], collapsed: [], limit: {} })

export interface ResolvedTile {
  id: string
  hidden: boolean
  collapsed: boolean
  /** 0 = 전부 */
  limit: number
}

/** 저장된 배치를 지금 있는 타일(기본 + 사용자 타일)에 맞춰 정리한다 */
export function resolveTiles(layout: Layout, customs: string[]): ResolvedTile[] {
  const known = new Set<string>([...BUILTIN_TILES, ...customs.map(customId)])
  const order = layout.order.filter((id, i) => known.has(id) && layout.order.indexOf(id) === i)
  for (const id of BUILTIN_TILES) if (!order.includes(id)) order.push(id)
  for (const c of customs) if (!order.includes(customId(c))) order.push(customId(c))
  return order.map((id) => ({
    id,
    hidden: layout.hidden.includes(id),
    collapsed: layout.collapsed.includes(id),
    limit: id in layout.limit ? layout.limit[id] : UNLIMITED.includes(id) ? 0 : DEFAULT_LIMIT,
  }))
}

/** 보이는 타일 사이에서 한 칸 위(-1)/아래(+1)로. 숨긴 타일은 건너뛴다 */
export function moveTile(layout: Layout, customs: string[], id: string, dir: -1 | 1): Layout {
  const tiles = resolveTiles(layout, customs)
  const visible = tiles.filter((x) => !x.hidden).map((x) => x.id)
  const i = visible.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= visible.length) return layout
  const full = tiles.map((x) => x.id)
  // visible[i] 와 visible[j] 의 자리를 맞바꾼다(사이의 숨긴 타일은 그대로)
  const a = full.indexOf(visible[i])
  const b = full.indexOf(visible[j])
  ;[full[a], full[b]] = [full[b], full[a]]
  return { ...layout, order: full }
}

/** 끌어 놓기: id 를 target 바로 앞으로 */
export function moveBefore(layout: Layout, customs: string[], id: string, target: string): Layout {
  if (id === target) return layout
  const full = resolveTiles(layout, customs).map((x) => x.id).filter((x) => x !== id)
  const k = full.indexOf(target)
  if (k < 0) return layout
  full.splice(k, 0, id)
  return { ...layout, order: full }
}

/** 사용자가 직접 켜고 끈 타일은 더 이상 "내용이 생기면 저절로" 대상이 아니다 */
const noAuto = (layout: Layout, id: string): string[] | undefined => {
  const a = (layout.auto ?? []).filter((x) => x !== id)
  return a.length ? a : undefined
}
const withAuto = (l: Layout, auto: string[] | undefined): Layout => {
  const { auto: _drop, ...rest } = l
  void _drop
  return auto ? { ...rest, auto } : rest
}

export const setHidden = (layout: Layout, id: string, hidden: boolean): Layout =>
  withAuto({ ...layout, hidden: hidden ? [...new Set([...layout.hidden, id])] : layout.hidden.filter((x) => x !== id) }, noAuto(layout, id))

export const setCollapsed = (layout: Layout, id: string, collapsed: boolean): Layout => ({
  ...layout,
  collapsed: collapsed ? [...new Set([...layout.collapsed, id])] : layout.collapsed.filter((x) => x !== id),
})

export const setLimit = (layout: Layout, id: string, limit: number): Layout => ({ ...layout, limit: { ...layout.limit, [id]: limit } })

/** 사용자 타일 이름을 바꿀 때 배치에 남은 이전 이름을 새 이름으로 옮긴다 */
export function renameTile(layout: Layout, oldName: string, newName: string): Layout {
  const from = customId(oldName)
  const to = customId(newName)
  if (from === to) return layout
  const map = (ids: string[]) => ids.map((x) => (x === from ? to : x))
  const limit = { ...layout.limit }
  if (from in limit) {
    limit[to] = limit[from]
    delete limit[from]
  }
  return withAuto({ order: map(layout.order), hidden: map(layout.hidden), collapsed: map(layout.collapsed), limit }, layout.auto)
}

/** 지운 사용자 타일을 배치에서 치운다 */
export function forgetTile(layout: Layout, name: string): Layout {
  const id = customId(name)
  const limit = { ...layout.limit }
  delete limit[id]
  return withAuto({ order: layout.order.filter((x) => x !== id), hidden: layout.hidden.filter((x) => x !== id), collapsed: layout.collapsed.filter((x) => x !== id), limit }, layout.auto)
}

const KEY = 'nosidian.worklayout'

/** 저장된 배치를 읽는다(없거나 깨졌으면 기본값) */
export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultLayout()
    const v = JSON.parse(raw) as Partial<Layout>
    const arr = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : [])
    const limit: Record<string, number> = {}
    if (v.limit && typeof v.limit === 'object') for (const [k, n] of Object.entries(v.limit)) if (typeof n === 'number' && n >= 0) limit[k] = n
    return withAuto({ order: arr(v.order), hidden: arr(v.hidden), collapsed: arr(v.collapsed), limit }, arr(v.auto).length ? arr(v.auto) : undefined)
  } catch {
    return defaultLayout()
  }
}

export function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout))
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}

/** 켜 둔 타일의 순서를 바꾼다. 꺼 둔 타일은 그 뒤(아래)에 그대로 둔다 */
export function reorderVisible(layout: Layout, customs: string[], ids: string[]): Layout {
  const tiles = resolveTiles(layout, customs)
  const hidden = tiles.filter((x) => x.hidden).map((x) => x.id)
  return { ...layout, order: [...ids.filter((id) => !hidden.includes(id)), ...hidden] }
}

/** 타일을 켠다: 켜 둔 타일들의 맨 끝에 붙는다(꺼 둔 타일 위) */
export function enableTile(layout: Layout, customs: string[], id: string): Layout {
  const tiles = resolveTiles(layout, customs)
  const visible = tiles.filter((x) => !x.hidden && x.id !== id).map((x) => x.id)
  const hidden = tiles.filter((x) => x.hidden && x.id !== id).map((x) => x.id)
  return withAuto({ ...layout, order: [...visible, id, ...hidden], hidden: layout.hidden.filter((x) => x !== id) }, noAuto(layout, id))
}

/** 타일을 끈다: 꺼 둔 타일들의 맨 앞으로 간다(방금 끈 것이 아래 목록에서 먼저 보이게) */
export function disableTile(layout: Layout, customs: string[], id: string): Layout {
  const tiles = resolveTiles(layout, customs)
  const visible = tiles.filter((x) => !x.hidden && x.id !== id).map((x) => x.id)
  const hidden = tiles.filter((x) => x.hidden && x.id !== id).map((x) => x.id)
  return withAuto({ ...layout, order: [...visible, id, ...hidden], hidden: [...new Set([...layout.hidden, id])] }, noAuto(layout, id))
}
