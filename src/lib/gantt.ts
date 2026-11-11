// 프로젝트 허브 "간트" 보기의 순수 계산: 어떤 업무가 막대/점/일정 없음인지, 보이는 날짜 범위, 끌어서 바꿀 때의 새 날짜. 화면은 components/HubGantt.tsx.
// 설계: docs/PROJECT-VIEWS.md §4.1 — 시작일(start:)과 마감(due:)이 있으면 막대, 하나만 있으면 점(마름모), 없으면 "일정 없음".
import { addDays, parseYmd } from './calendar'
import { rowStateOf, type RowState } from './projectViews'
import type { Task } from './work'

export type GanttScale = 'week' | 'month'
/** 하루의 가로 길이(px) */
export const DAY_PX: Record<GanttScale, number> = { week: 28, month: 10 }
/** 한 번에 그리는 날짜 상한(넘으면 오늘 기준으로 자른다) */
export const MAX_DAYS = 400

export interface GanttBar {
  task: Task
  /** bar: 시작~마감 기간, point: 날짜 한 점(기간을 모르는 일) */
  kind: 'bar' | 'point'
  start: string
  end: string
  /** point 일 때 그 날짜가 마감인지 시작인지(끌어서 옮기면 그 필드가 바뀐다) */
  field?: 'due' | 'start'
}

/** 두 날짜(YYYY-MM-DD) 사이의 일 수(b - a). 서머타임에 흔들리지 않게 UTC 로 센다 */
export function dayDiff(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

/** 업무 하나를 막대/점으로. 날짜가 없으면 null. 시작이 마감보다 늦은 잘못된 값도 막대로 그려(뒤집어서) 버리지 않는다 */
export function barOf(task: Task): GanttBar | null {
  const { start, due } = task
  if (start && due) {
    const [a, b] = start <= due ? [start, due] : [due, start]
    return { task, kind: 'bar', start: a, end: b }
  }
  if (due) return { task, kind: 'point', start: due, end: due, field: 'due' }
  if (start) return { task, kind: 'point', start, end: start, field: 'start' }
  return null
}

export interface GanttModel {
  bars: GanttBar[]
  /** 날짜가 하나도 없는 일 */
  undated: Task[]
  /** 보이는 날짜 범위(양 끝 포함)와 일 수 */
  from: string
  to: string
  days: number
}

/**
 * 간트 모델. 범위는 [가장 이른 날짜, 오늘−7일] ~ [가장 늦은 날짜, 오늘+28일]에 일주일 여유를 더한 것이고, MAX_DAYS 를 넘으면 오늘 기준으로 자른다.
 * 막대는 시작일 → 마감 → 제목 순.
 */
export function buildGantt(tasks: Task[], today: string, projectDue?: string): GanttModel {
  const bars: GanttBar[] = []
  const undated: Task[] = []
  for (const tk of tasks) {
    const b = barOf(tk)
    if (b) bars.push(b)
    else undated.push(tk)
  }
  bars.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.task.title.localeCompare(b.task.title, 'ko'))
  let from = addDays(today, -7)
  let to = addDays(today, 28)
  const stretch = (d?: string) => {
    if (!d) return
    if (d < from) from = d
    if (d > to) to = d
  }
  for (const b of bars) {
    stretch(b.start)
    stretch(b.end)
  }
  stretch(projectDue)
  to = addDays(to, 7)
  if (dayDiff(from, to) + 1 > MAX_DAYS) {
    from = from < addDays(today, -120) ? addDays(today, -120) : from
    to = to > addDays(today, 279) ? addDays(today, 279) : to
  }
  return { bars, undated, from, to, days: dayDiff(from, to) + 1 }
}

export interface BarBox {
  left: number
  width: number
  /** 보이는 범위 밖으로 잘렸나(왼쪽/오른쪽) */
  clipLeft: boolean
  clipRight: boolean
}

/** 막대의 가로 위치·길이(px). 범위 밖은 잘라서, 모두 밖이면 null */
export function boxOf(bar: Pick<GanttBar, 'start' | 'end'>, from: string, days: number, dw: number): BarBox | null {
  const s = dayDiff(from, bar.start)
  const e = dayDiff(from, bar.end)
  if (e < 0 || s > days - 1) return null
  const cs = Math.max(0, s)
  const ce = Math.min(days - 1, e)
  return { left: cs * dw, width: (ce - cs + 1) * dw, clipLeft: s < 0, clipRight: e > days - 1 }
}

export type DragMode = 'move' | 'start' | 'end'

/**
 * 끌어서(하루 단위로 delta 일) 바꾼 뒤의 값. 바뀐 게 없으면 null.
 *  - 막대: move = 시작·마감을 같이, start/end = 한쪽 끝만(반대쪽을 넘지 않게 막는다)
 *  - 점: move 만, 원래 그 점이 마감이면 due, 시작이면 start 를 바꾼다
 */
export function dragResult(mode: DragMode, delta: number, bar: GanttBar): { start?: string; due?: string } | null {
  if (delta === 0) return null
  if (bar.kind === 'point') {
    if (mode !== 'move') return null
    const to = addDays(bar.start, delta)
    return bar.field === 'start' ? { start: to } : { due: to }
  }
  if (mode === 'move') return { start: addDays(bar.start, delta), due: addDays(bar.end, delta) }
  if (mode === 'start') {
    const s = addDays(bar.start, delta)
    const next = s > bar.end ? bar.end : s
    return next === bar.start ? null : { start: next, due: bar.end }
  }
  const e = addDays(bar.end, delta)
  const next = e < bar.start ? bar.start : e
  return next === bar.end ? null : { start: bar.start, due: next }
}

export type GroupBy = 'none' | 'owner' | 'state'
export interface BarGroup {
  /** 묶음 식별자: owner → 담당자 이름('' = 담당 없음), state → RowState */
  key: string
  bars: GanttBar[]
}

/** 막대를 묶는다. owner 는 첫 담당자 기준(여러 명이어도 한 번만 나온다), 담당 없음은 맨 뒤. state 는 진행 중→대기→할 일→완료 순 */
export function groupBars(bars: GanttBar[], by: GroupBy): BarGroup[] {
  if (by === 'none') return [{ key: '', bars }]
  const map = new Map<string, GanttBar[]>()
  for (const b of bars) {
    const key = by === 'owner' ? b.task.owner[0] ?? '' : rowStateOf(b.task)
    map.set(key, [...(map.get(key) ?? []), b])
  }
  const order: RowState[] = ['doing', 'waiting', 'todo', 'done', 'dropped']
  const keys = [...map.keys()].sort((a, b) =>
    by === 'state'
      ? order.indexOf(a as RowState) - order.indexOf(b as RowState)
      : a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko'),
  )
  return keys.map((key) => ({ key, bars: map.get(key)! }))
}

export interface MonthSeg {
  /** 'YYYY-MM' */
  month: string
  /** 범위 안에서 이 달이 시작하는 칸 번호와 칸 수 */
  idx: number
  span: number
}

/** 머리줄의 달 구간 */
export function monthSegments(from: string, days: number): MonthSeg[] {
  const segs: MonthSeg[] = []
  for (let i = 0; i < days; i++) {
    const m = addDays(from, i).slice(0, 7)
    const last = segs[segs.length - 1]
    if (last && last.month === m) last.span++
    else segs.push({ month: m, idx: i, span: 1 })
  }
  return segs
}

/** i 번째 칸이 주말인가 */
export const isWeekend = (from: string, i: number) => {
  const wd = parseYmd(addDays(from, i)).getDay()
  return wd === 0 || wd === 6
}
