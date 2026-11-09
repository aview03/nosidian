// 프로젝트 타임라인: 프로젝트의 마감·업무·결정·일정을 날짜순으로 한 줄에 모은다.
// 노트에 적힌 날짜만 쓴다(저장하는 데이터 없음). "누가 언제 바꿨나" 같은 변경 이력은 노트에 남지 않으므로 다루지 않는다.
import type { CalEvent } from './calendar'
import type { Project, Task } from './work'

export type TimelineEntry =
  | { date: string; type: 'milestone'; name: string }
  | { date: string; type: 'task'; task: Task }
  | { date: string; type: 'event'; event: CalEvent }

export interface Timeline {
  /** 날짜순(같은 날은 마일스톤 → 시간 있는 일정 → 업무) */
  entries: TimelineEntry[]
  /** 마감일이 없는 열린 업무 수(타임라인에 못 올린 것) */
  undated: number
}

const rank = (e: TimelineEntry) => (e.type === 'milestone' ? 0 : e.type === 'event' ? 1 : 2)

/**
 * tasks: 프로젝트의 업무 전부. events: 프로젝트 노트에서 나온 일정(업무 줄에서 나온 것은 업무로 따로 오므로 제외).
 * 취소된 업무는 뺀다. 완료된 업무·결정은 마감일 자리에 남겨 "무슨 일이 있었나"를 보여 준다.
 */
export function buildTimeline(project: Pick<Project, 'name' | 'due'>, tasks: Task[], events: CalEvent[]): Timeline {
  const entries: TimelineEntry[] = []
  const taskIds = new Set(tasks.map((x) => x.id))
  if (project.due) entries.push({ date: project.due, type: 'milestone', name: project.name })
  let undated = 0
  for (const task of tasks) {
    if (task.state === 'dropped') continue
    if (task.due) entries.push({ date: task.due, type: 'task', task })
    else if (!task.done) undated++
  }
  const seen = new Set<string>()
  for (const event of events) {
    if (taskIds.has(event.id)) continue // 업무는 위에서 이미 넣었다
    const key = `${event.id}@${event.date}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ date: event.date, type: 'event', event })
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || (a.type === 'event' && b.type === 'event' ? (a.event.start ?? '').localeCompare(b.event.start ?? '') : 0))
  return { entries, undated }
}

/** 같은 날짜끼리 묶고, 오늘을 기준으로 지난 것/앞으로를 나눌 자리(todayIndex)를 알려 준다 */
export function groupByDate(entries: TimelineEntry[], today: string): { days: { date: string; items: TimelineEntry[] }[]; todayIndex: number } {
  const days: { date: string; items: TimelineEntry[] }[] = []
  for (const e of entries) {
    const last = days[days.length - 1]
    if (last && last.date === e.date) last.items.push(e)
    else days.push({ date: e.date, items: [e] })
  }
  // 오늘 이상인 첫 날짜의 위치 (없으면 끝)
  const idx = days.findIndex((d) => d.date >= today)
  return { days, todayIndex: idx < 0 ? days.length : idx }
}
