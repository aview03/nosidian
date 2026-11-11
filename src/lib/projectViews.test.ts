import { describe, expect, it } from 'vitest'
import { buildWork } from './work'
import { filterTasks, isMineTask, loadRatio, ownerLanes, ownersAfterDrop, rowStateOf, sortTasks } from './projectViews'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const TODAY = '2026-11-11'
const tasksOf = (lines: string[]) => {
  const files = [note('행사/프로젝트 개요.md', '---\ntype: project\nstatus: active\n---\n# 행사\n'), note('행사/할 일.md', lines.join('\n') + '\n')]
  return buildWork(Object.fromEntries(files.map((f) => [f.path, f]))).tasks
}
const LINES = [
  '- [ ] 가 장소 due:2026-11-20 owner:민수 p:2',
  '- [ ] 나 케이터링 due:2026-11-10 owner:지현 p:1 status:doing',
  '- [ ] 다 현수막 owner:민수',
  '- [ ] 라 정산',
  '- [x] 마 예약 due:2026-11-05 owner:지현',
  '- [ ] 바 공동 owner:민수,지현 due:2026-11-15 status:waiting',
]
const titles = (l: { title: string }[]) => l.map((x) => x.title.slice(0, 1))

describe('표 정렬', () => {
  const tasks = tasksOf(LINES)
  it('마감 빠른 순: 마감 없는 일은 맨 뒤', () => {
    expect(titles(sortTasks(tasks, 'due', 'asc'))).toEqual(['마', '나', '바', '가', '다', '라'])
  })
  it('내림차순이어도 마감 없는 일은 맨 뒤에 둔다', () => {
    expect(titles(sortTasks(tasks, 'due', 'desc'))).toEqual(['가', '바', '나', '마', '다', '라'])
  })
  it('우선순위: 높음(1)이 먼저, 없는 일은 뒤', () => {
    expect(titles(sortTasks(tasks, 'p', 'asc')).slice(0, 2)).toEqual(['나', '가'])
  })
  it('담당 정렬: 담당 없는 일은 뒤', () => {
    const r = sortTasks(tasks, 'owner', 'asc')
    expect(r[r.length - 1].title).toContain('정산')
  })
  it('상태 정렬: 진행 중 → 대기 → 할 일 → 완료', () => {
    expect(titles(sortTasks(tasks, 'state', 'asc'))).toEqual(['나', '바', '가', '다', '라', '마'])
  })
  it('제목 정렬(가나다)이고 원본 배열은 바뀌지 않는다', () => {
    const copy = [...tasks]
    expect(titles(sortTasks(tasks, 'title', 'asc'))).toEqual(['가', '나', '다', '라', '마', '바'])
    expect(tasks).toEqual(copy)
  })
  it('행 상태: 완료는 따로', () => {
    expect(tasks.map(rowStateOf)).toEqual(['todo', 'doing', 'todo', 'todo', 'done', 'waiting'])
  })
})

describe('필터', () => {
  const tasks = tasksOf(LINES)
  it('기본은 열린 일만: 완료 제외', () => {
    expect(filterTasks(tasks, { mineOnly: false, showDone: false, me: [] })).toHaveLength(5)
    expect(filterTasks(tasks, { mineOnly: false, showDone: true, me: [] })).toHaveLength(6)
  })
  it('내 것만: 담당 이름 일부가 맞는 일(여러 명 중 한 명이어도), 담당 없는 일은 내 것이 아니다', () => {
    expect(titles(filterTasks(tasks, { mineOnly: true, showDone: true, me: ['민수'] }))).toEqual(['가', '다', '바'])
    expect(isMineTask(tasks[3], ['민수'])).toBe(false)
    expect(isMineTask(tasks[0], [])).toBe(false)
  })
})

describe('담당자별 구역', () => {
  const lanes = ownerLanes(tasksOf(LINES), ['지현'], TODAY)
  it('나 → 담당 없음 → 나머지 순', () => {
    expect(lanes.map((l) => l.key)).toEqual(['지현', '', '민수'])
    expect(lanes[0].isMe).toBe(true)
    expect(lanes[1].name).toBeNull()
  })
  it('여러 명이 맡은 일은 맡은 사람마다 나온다', () => {
    expect(titles(lanes[0].tasks)).toEqual(['나', '마', '바'])
    expect(titles(lanes[2].tasks)).toEqual(['가', '다', '바'])
  })
  it('열린 일·진행·지난 마감 수(완료는 제외)', () => {
    expect(lanes[0]).toMatchObject({ open: 2, doing: 1, late: 1 })
    expect(lanes[2]).toMatchObject({ open: 3, doing: 0, late: 0 })
  })
  it('담당 없는 일이 없으면 담당 없음 구역을 만들지 않는다', () => {
    expect(ownerLanes(tasksOf(['- [ ] 가 owner:민수']), [], TODAY).map((l) => l.key)).toEqual(['민수'])
  })
  it('내 이름이 없으면 나 구역이 없다', () => {
    expect(ownerLanes(tasksOf(LINES), [], TODAY).some((l) => l.isMe)).toBe(false)
  })
  it('끌어 놓은 뒤 담당: 사람 구역이면 그 사람 한 명, 담당 없음 구역이면 비움', () => {
    expect(ownersAfterDrop(lanes[2])).toEqual(['민수'])
    expect(ownersAfterDrop(lanes[1])).toEqual([])
  })
  it('업무량 막대: 가장 많은 사람이 1', () => {
    expect(loadRatio(lanes[2], lanes)).toBe(1)
    expect(loadRatio(lanes[0], lanes)).toBeCloseTo(2 / 3)
    expect(loadRatio({ open: 0 }, [{ open: 0 }])).toBe(0)
  })
})
