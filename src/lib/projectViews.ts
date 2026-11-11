// 프로젝트 허브 보기(표·담당자별)의 순수 계산. 화면은 components/HubTable.tsx · HubOwners.tsx. 설계: docs/PROJECT-VIEWS.md
import { uiStateOf, type Task } from './work'

export type SortKey = 'title' | 'state' | 'owner' | 'due' | 'p'
export type SortDir = 'asc' | 'desc'

/** 표의 상태 칸 값: 완료는 따로, 나머지는 보드와 같은 상태 */
export type RowState = 'todo' | 'doing' | 'waiting' | 'dropped' | 'done'
export const rowStateOf = (tk: Task): RowState => (tk.done ? 'done' : uiStateOf(tk))

/** 상태로 정렬할 때의 순서: 지금 하는 일이 위로 */
const STATE_ORDER: Record<RowState, number> = { doing: 0, waiting: 1, todo: 2, done: 3, dropped: 4 }

/** 비어 있는 값(마감·담당·우선순위 없음)은 오름·내림차순과 상관없이 항상 맨 아래 */
function cmp(a: Task, b: Task, key: SortKey): number | null {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title, 'ko')
    case 'state':
      return STATE_ORDER[rowStateOf(a)] - STATE_ORDER[rowStateOf(b)]
    case 'owner': {
      const x = a.owner.join(', ')
      const y = b.owner.join(', ')
      if (!x || !y) return x === y ? 0 : null
      return x.localeCompare(y, 'ko')
    }
    case 'due':
      if (!a.due || !b.due) return a.due === b.due ? 0 : null
      return a.due.localeCompare(b.due)
    case 'p':
      if (!a.p || !b.p) return a.p === b.p ? 0 : null
      return a.p - b.p // 1(높음)이 먼저
  }
}
const isEmpty = (tk: Task, key: SortKey) => (key === 'due' ? !tk.due : key === 'owner' ? tk.owner.length === 0 : key === 'p' ? !tk.p : false)

/** 표 정렬. 같으면 마감 → 우선순위 → 제목 순으로 안정적으로 이어 정한다 */
export function sortTasks(tasks: Task[], key: SortKey, dir: SortDir): Task[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...tasks].sort((a, b) => {
    const ea = isEmpty(a, key)
    const eb = isEmpty(b, key)
    if (ea !== eb) return ea ? 1 : -1 // 빈 값은 항상 뒤
    const c = cmp(a, b, key)
    if (c) return c * sign
    return (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.p ?? 9) - (b.p ?? 9) || a.title.localeCompare(b.title, 'ko')
  })
}

/** 내 담당인가(이름 일부가 맞으면). 담당자가 비어 있는 일은 "내 것"으로 세지 않는다 */
export const isMineTask = (tk: Task, me: string[]) => me.length > 0 && tk.owner.some((o) => me.some((m) => o.toLowerCase().includes(m.toLowerCase())))

/** 표·담당자별 공통 필터: 내 것만, 완료(·취소) 포함 */
export function filterTasks(tasks: Task[], opt: { mineOnly: boolean; showDone: boolean; me: string[] }): Task[] {
  return tasks.filter((tk) => {
    if (!opt.showDone && (tk.done || uiStateOf(tk) === 'dropped')) return false
    if (opt.mineOnly && !isMineTask(tk, opt.me)) return false
    return true
  })
}

export interface Lane {
  /** 구역 식별자: 담당자 이름, 담당이 없으면 '' */
  key: string
  /** 담당자 이름(담당 없음이면 null) */
  name: string | null
  isMe: boolean
  tasks: Task[]
  /** 열린 일(완료·취소 제외) / 진행 중 / 마감 지남 */
  open: number
  doing: number
  late: number
}

/**
 * 담당자별 구역: 나 → 담당 없음 → 나머지 가나다. 여러 사람이 맡은 일은 맡은 사람마다 나온다.
 * 담당 없음 구역은 일이 있을 때만 만든다(그게 "아직 아무도 안 맡은 일" 신호다).
 */
export function ownerLanes(tasks: Task[], me: string[], today: string): Lane[] {
  const by = new Map<string, Task[]>()
  const none: Task[] = []
  for (const tk of tasks) {
    if (tk.owner.length === 0) none.push(tk)
    else for (const o of new Set(tk.owner)) by.set(o, [...(by.get(o) ?? []), tk])
  }
  const mk = (key: string, name: string | null, list: Task[]): Lane => {
    const live = list.filter((x) => !x.done && uiStateOf(x) !== 'dropped')
    return {
      key,
      name,
      isMe: name !== null && me.some((m) => name.toLowerCase().includes(m.toLowerCase())),
      tasks: list,
      open: live.length,
      doing: live.filter((x) => uiStateOf(x) === 'doing').length,
      late: live.filter((x) => !!x.due && x.due < today).length,
    }
  }
  const named = [...by].map(([n, l]) => mk(n, n, l))
  const mine = named.filter((l) => l.isMe).sort((a, b) => a.key.localeCompare(b.key, 'ko'))
  const others = named.filter((l) => !l.isMe).sort((a, b) => a.key.localeCompare(b.key, 'ko'))
  return [...mine, ...(none.length ? [mk('', null, none)] : []), ...others]
}

/** 다른 사람 구역으로 옮긴 뒤의 담당자 목록: 담당 없음 구역이면 비움, 아니면 그 사람 한 명 */
export const ownersAfterDrop = (lane: Pick<Lane, 'name'>): string[] => (lane.name ? [lane.name] : [])

/** 업무량 막대 길이(0~1): 가장 많은 사람이 1. 모두 0 이면 0 */
export function loadRatio(lane: Pick<Lane, 'open'>, lanes: Pick<Lane, 'open'>[]): number {
  const max = Math.max(0, ...lanes.map((l) => l.open))
  return max === 0 ? 0 : lane.open / max
}
