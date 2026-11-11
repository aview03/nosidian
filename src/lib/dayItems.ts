// 홈의 "이번 주"·"기한이 지난 일" 타일에 함께 보일 "날짜가 있는 종일 체크리스트"(과제·제출처럼 시간 없는 일)를 고른다.
// 배경: 학생이 빠른 입력이나 Daily 노트로 적은 과제는 "업무(due: 꼬리표나 프로젝트 소속)"가 아니라서 이 타일들에 나오지 않았다(페르소나 F21).
// 규칙(사용자 결정, 2026-11-11): 시간 없는(종일) 날짜 체크리스트만 — 미체크, 반복·기간·시간 있는 약속은 제외. 지난 일은 최근 7일만(체크 안 한 줄이 쌓여 소음이 되지 않게).
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

/**
 * cal: 날짜 → 일정 목록, taskIds: 이미 업무 대기열에 있는 항목(두 번 보이지 않게 뺀다), today: 오늘.
 * week = 내일 ~ 7일 뒤(오늘 것은 "오늘 일정"에 이미 있다), overdue = 7일 전 ~ 어제. 둘 다 날짜순.
 */
export function buildDayItems(cal: Map<string, CalEvent[]>, taskIds: Set<string>, today: string): { week: DayItem[]; overdue: DayItem[] } {
  const pick = (date: string): CalEvent[] => (cal.get(date) ?? []).filter((e) => isDeadlineLike(e) && !taskIds.has(e.id))
  const overdue: DayItem[] = []
  for (let i = LOOKBACK_DAYS; i >= 1; i--) {
    const d = addDays(today, -i)
    for (const ev of pick(d)) overdue.push({ ev, reason: 'overdue', days: dayDiff(d, today) })
  }
  const week: DayItem[] = []
  for (let i = 1; i <= LOOKAHEAD_DAYS; i++) {
    const d = addDays(today, i)
    for (const ev of pick(d)) week.push({ ev, reason: 'week', days: dayDiff(today, d) })
  }
  return { week, overdue }
}
