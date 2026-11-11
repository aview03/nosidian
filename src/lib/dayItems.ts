// 홈의 "이번 주"·"기한이 지난 일" 타일에 함께 보일 "날짜가 있는 종일 체크리스트"(과제·제출처럼 시간 없는 일)를 고른다.
// 배경: 학생이 빠른 입력이나 Daily 노트로 적은 과제는 "업무(due: 꼬리표나 프로젝트 소속)"가 아니라서 이 타일들에 나오지 않았다(페르소나 F21).
// 규칙(사용자 결정, 2026-11-11): 시간 없는(종일) 날짜 체크리스트만 — 미체크, 반복·기간·시간 있는 약속은 제외. 지난 일은 최근 7일만이고, 매일 적는 루틴(같은 제목이 여러 날, 매주 과제 제외)은 지난 일에서 뺀다(체크 안 한 줄이 쌓여 소음이 되지 않게).
import { addDays, type CalEvent } from './calendar'
import { dayDiff } from './gantt'

export const LOOKBACK_DAYS = 7
export const LOOKAHEAD_DAYS = 7

export interface DayItem {
  ev: CalEvent
  reason: 'week' | 'overdue'
  /** week: 남은 일(1=내일) / overdue: 지난 일 */
  days: number
}

/** 과제·제출처럼 "그날까지 할 일"로 볼 수 있는 일정인가 */
export const isDeadlineLike = (ev: CalEvent): boolean => ev.kind === 'task' && !ev.start && !ev.done && !ev.inst && !ev.repeat && !ev.span && !ev.cont

const titleKey = (ev: CalEvent) => ev.title.trim().toLowerCase()

/**
 * 습관·루틴처럼 매일 적는 줄(`물 한 잔 마시기`)의 제목들. 같은 제목이 서로 다른 날짜에 2번 이상 있고(끝낸 날 포함), 그 간격이 모두 7의 배수(= 매주 과제)가 아니면 루틴으로 본다.
 * 체크하지 않는 루틴이 `기한이 지난 일`에 쌓여 소음이 되는 것을 막으려는 것(F21 후속). 일정 전체를 한 번 훑는다.
 */
export function routineTitles(cal: Map<string, CalEvent[]>): Set<string> {
  const dates = new Map<string, Set<string>>()
  for (const [date, list] of cal) {
    for (const ev of list) {
      if (ev.kind !== 'task' || ev.start || ev.span || ev.inst || ev.repeat || ev.cont) continue
      const k = titleKey(ev)
      if (!k) continue
      if (!dates.has(k)) dates.set(k, new Set())
      dates.get(k)!.add(date)
    }
  }
  const out = new Set<string>()
  for (const [k, set] of dates) {
    if (set.size < 2) continue
    const days = [...set].sort()
    const weekly = days.every((d, i) => i === 0 || dayDiff(days[i - 1], d) % 7 === 0)
    if (!weekly) out.add(k)
  }
  return out
}

/**
 * cal: 날짜 → 일정 목록, taskIds: 이미 업무 대기열에 있는 항목(두 번 보이지 않게 뺀다), today: 오늘.
 * week = 내일 ~ 7일 뒤(오늘 것은 "오늘 일정"에 이미 있다), overdue = 7일 전 ~ 어제(루틴 제목은 제외). 둘 다 날짜순.
 */
export function buildDayItems(cal: Map<string, CalEvent[]>, taskIds: Set<string>, today: string): { week: DayItem[]; overdue: DayItem[] } {
  const pick = (date: string): CalEvent[] => (cal.get(date) ?? []).filter((e) => isDeadlineLike(e) && !taskIds.has(e.id))
  const routine = routineTitles(cal)
  const overdue: DayItem[] = []
  for (let i = LOOKBACK_DAYS; i >= 1; i--) {
    const d = addDays(today, -i)
    for (const ev of pick(d)) if (!routine.has(titleKey(ev))) overdue.push({ ev, reason: 'overdue', days: dayDiff(d, today) })
  }
  const week: DayItem[] = []
  for (let i = 1; i <= LOOKAHEAD_DAYS; i++) {
    const d = addDays(today, i)
    for (const ev of pick(d)) week.push({ ev, reason: 'week', days: dayDiff(today, d) })
  }
  return { week, overdue }
}
