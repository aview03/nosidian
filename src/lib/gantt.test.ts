import { describe, expect, it } from 'vitest'
import { buildWork } from './work'
import { MAX_DAYS, barOf, boxOf, buildGantt, dayDiff, dragResult, groupBars, isWeekend, monthSegments } from './gantt'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const TODAY = '2026-11-11' // 수요일
const tasksOf = (lines: string[]) => {
  const files = [note('행사/프로젝트 개요.md', '---\ntype: project\n---\n# 행사\n'), note('행사/할 일.md', lines.join('\n') + '\n')]
  return buildWork(Object.fromEntries(files.map((f) => [f.path, f]))).tasks
}
const one = (line: string) => tasksOf([line])[0]

describe('날짜 차이', () => {
  it('일 수를 센다(월·해·윤년 경계 포함)', () => {
    expect(dayDiff('2026-11-11', '2026-11-11')).toBe(0)
    expect(dayDiff('2026-11-11', '2026-11-20')).toBe(9)
    expect(dayDiff('2026-12-25', '2027-01-05')).toBe(11)
    expect(dayDiff('2028-02-28', '2028-03-01')).toBe(2)
    expect(dayDiff('2026-11-20', '2026-11-11')).toBe(-9)
  })
})

describe('막대/점/일정 없음', () => {
  it('시작일과 마감이 있으면 막대', () => {
    expect(barOf(one('- [ ] 가 start:2026-11-20 due:2026-11-25'))).toMatchObject({ kind: 'bar', start: '2026-11-20', end: '2026-11-25' })
  })
  it('마감만 있으면 마감일의 점(끌면 due 가 바뀐다)', () => {
    expect(barOf(one('- [ ] 가 due:2026-11-25'))).toMatchObject({ kind: 'point', start: '2026-11-25', end: '2026-11-25', field: 'due' })
  })
  it('시작일만 있으면 시작일의 점(끌면 start 가 바뀐다)', () => {
    expect(barOf(one('- [ ] 가 start:2026-11-20'))).toMatchObject({ kind: 'point', field: 'start', start: '2026-11-20' })
  })
  it('날짜가 없으면 null', () => expect(barOf(one('- [ ] 가'))).toBeNull())
  it('시작일이 마감보다 늦은 잘못된 값도 버리지 않고 뒤집어 막대로', () => {
    expect(barOf(one('- [ ] 가 start:2026-12-01 due:2026-11-20'))).toMatchObject({ kind: 'bar', start: '2026-11-20', end: '2026-12-01' })
  })
})

describe('간트 모델', () => {
  const lines = ['- [ ] 가 start:2026-11-20 due:2026-11-25', '- [ ] 나 due:2026-11-15', '- [ ] 다', '- [ ] 라 start:2026-11-12 due:2026-11-14']
  const g = buildGantt(tasksOf(lines), TODAY)
  it('막대는 시작일 순이고 날짜 없는 일은 따로', () => {
    expect(g.bars.map((b) => b.task.title)).toEqual(['라', '나', '가'])
    expect(g.undated.map((x) => x.title)).toEqual(['다'])
  })
  it('범위는 오늘 −7일 ~ 오늘 +28일(+여유 7일)이 최소', () => {
    expect(g.from).toBe('2026-11-04')
    expect(g.to).toBe('2026-12-16')
    expect(g.days).toBe(dayDiff(g.from, g.to) + 1)
  })
  it('먼 날짜가 있으면 범위가 늘어난다(프로젝트 마감 포함)', () => {
    const far = buildGantt(tasksOf(['- [ ] 가 start:2026-10-01 due:2026-10-05']), TODAY, '2027-01-20')
    expect(far.from).toBe('2026-10-01')
    expect(far.to >= '2027-01-20').toBe(true)
  })
  it('너무 길면 오늘 기준으로 자른다', () => {
    const huge = buildGantt(tasksOf(['- [ ] 가 start:2020-01-01 due:2030-01-01']), TODAY)
    expect(huge.days).toBeLessThanOrEqual(MAX_DAYS)
    expect(huge.from <= TODAY && huge.to >= TODAY).toBe(true)
  })
  it('일정이 하나도 없어도 오늘 주변 범위가 있다', () => {
    const empty = buildGantt([], TODAY)
    expect(empty.bars).toEqual([])
    expect(empty.days).toBeGreaterThan(30)
  })
})

describe('막대 위치', () => {
  const from = '2026-11-04'
  it('왼쪽 끝과 길이(px)', () => {
    expect(boxOf({ start: '2026-11-06', end: '2026-11-08' }, from, 40, 28)).toEqual({ left: 56, width: 84, clipLeft: false, clipRight: false })
  })
  it('하루짜리도 한 칸', () => {
    expect(boxOf({ start: '2026-11-04', end: '2026-11-04' }, from, 40, 10)).toMatchObject({ left: 0, width: 10 })
  })
  it('범위 밖으로 걸치면 잘라서 표시', () => {
    expect(boxOf({ start: '2026-10-30', end: '2026-11-06' }, from, 40, 10)).toEqual({ left: 0, width: 30, clipLeft: true, clipRight: false })
    expect(boxOf({ start: '2026-12-10', end: '2026-12-20' }, from, 40, 10)).toMatchObject({ clipRight: true })
  })
  it('전부 밖이면 null', () => {
    expect(boxOf({ start: '2026-10-01', end: '2026-10-05' }, from, 40, 10)).toBeNull()
    expect(boxOf({ start: '2027-01-01', end: '2027-01-05' }, from, 40, 10)).toBeNull()
  })
})

describe('끌어서 날짜 바꾸기', () => {
  const bar = barOf(one('- [ ] 가 start:2026-11-20 due:2026-11-25'))!
  it('가운데를 끌면 시작·마감이 같이 움직인다', () => {
    expect(dragResult('move', 3, bar)).toEqual({ start: '2026-11-23', due: '2026-11-28' })
    expect(dragResult('move', -2, bar)).toEqual({ start: '2026-11-18', due: '2026-11-23' })
  })
  it('왼쪽 끝은 시작만, 오른쪽 끝은 마감만', () => {
    expect(dragResult('start', -2, bar)).toEqual({ start: '2026-11-18', due: '2026-11-25' })
    expect(dragResult('end', 4, bar)).toEqual({ start: '2026-11-20', due: '2026-11-29' })
  })
  it('끝을 반대쪽 끝을 넘겨 끌어도 뒤집히지 않고 그 자리에서 멈춘다', () => {
    expect(dragResult('start', 30, bar)).toEqual({ start: '2026-11-25', due: '2026-11-25' })
    expect(dragResult('end', -30, bar)).toEqual({ start: '2026-11-20', due: '2026-11-20' })
  })
  it('움직이지 않았으면 null', () => {
    expect(dragResult('move', 0, bar)).toBeNull()
    const oneDay = barOf(one('- [ ] 나 start:2026-11-20 due:2026-11-20'))!
    expect(dragResult('end', -3, oneDay)).toBeNull()
    expect(dragResult('start', 3, oneDay)).toBeNull()
  })
  it('점은 옮기기만 되고, 원래 마감이면 due·시작이면 start 가 바뀐다', () => {
    const due = barOf(one('- [ ] 나 due:2026-11-25'))!
    expect(dragResult('move', 2, due)).toEqual({ due: '2026-11-27' })
    expect(dragResult('end', 2, due)).toBeNull()
    const st = barOf(one('- [ ] 다 start:2026-11-25'))!
    expect(dragResult('move', -1, st)).toEqual({ start: '2026-11-24' })
  })
})

describe('묶기', () => {
  const g = buildGantt(tasksOf(['- [ ] 가 due:2026-11-15 owner:지현', '- [ ] 나 due:2026-11-16 owner:민수 status:doing', '- [ ] 다 due:2026-11-17', '- [ ] 라 due:2026-11-18 owner:민수']), TODAY)
  it('묶지 않으면 한 묶음', () => expect(groupBars(g.bars, 'none')).toHaveLength(1))
  it('담당자별: 가나다, 담당 없음은 맨 뒤', () => {
    expect(groupBars(g.bars, 'owner').map((x) => x.key)).toEqual(['민수', '지현', ''])
    expect(groupBars(g.bars, 'owner')[0].bars.map((b) => b.task.title)).toEqual(['나', '라'])
  })
  it('상태별: 진행 중이 먼저', () => {
    expect(groupBars(g.bars, 'state').map((x) => x.key)).toEqual(['doing', 'todo'])
  })
})

describe('머리줄', () => {
  it('달 구간을 나눈다', () => {
    expect(monthSegments('2026-11-28', 6)).toEqual([
      { month: '2026-11', idx: 0, span: 3 },
      { month: '2026-12', idx: 3, span: 3 },
    ])
  })
  it('주말 판정', () => {
    expect(isWeekend('2026-11-07', 0)).toBe(true) // 토
    expect(isWeekend('2026-11-07', 1)).toBe(true) // 일
    expect(isWeekend('2026-11-07', 2)).toBe(false) // 월
  })
})
