import { describe, expect, it } from 'vitest'
import { buildTimeline, groupByDate } from './timeline'
import { buildWork } from './work'
import type { CalEvent } from './calendar'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const world = (lines: string) =>
  buildWork({
    'p/개요.md': note('p/개요.md', '---\ntype: project\ndue: 2026-12-09\n---\n# 봄 행사\n'),
    'p/할 일.md': note('p/할 일.md', '# 할 일\n\n' + lines),
  })
const ev = (id: string, date: string, extra: Partial<CalEvent> = {}): CalEvent => ({ id, date, title: id, done: false, kind: 'note', path: 'p/개요.md', line: 0, ...extra })

describe('프로젝트 타임라인', () => {
  const lines = [
    '- [ ] 예약 due:2026-11-20',
    '- [x] 날짜 확정 kind:decision due:2026-11-05 => 토요일로 결정',
    '- [ ] 정하기 kind:decision due:2026-11-25',
    '- [ ] 날짜 없는 일',
    '- [ ] 접은 일 status:dropped due:2026-11-21',
  ].join('\n') + '\n'
  const w = world(lines)
  const tl = buildTimeline(w.projects[0], w.tasks, [])

  it('마감일이 있는 업무·결정과 프로젝트 마감을 날짜순으로', () => {
    expect(tl.entries.map((e) => `${e.date}:${e.type}`)).toEqual(['2026-11-05:task', '2026-11-20:task', '2026-11-25:task', '2026-12-09:milestone'])
  })
  it('완료된 결정도 자리에 남고(결론 포함), 취소된 일은 빠진다', () => {
    const first = tl.entries[0]
    expect(first.type === 'task' && first.task.done && first.task.conclusion).toBe('토요일로 결정')
    expect(tl.entries.some((e) => e.type === 'task' && e.task.title === '접은 일')).toBe(false)
  })
  it('날짜 없는 열린 업무는 개수만 센다', () => {
    expect(tl.undated).toBe(1)
  })
  it('업무에서 나온 일정은 중복으로 넣지 않고, 노트 일정은 같은 날 업무보다 앞에', () => {
    const t = w.tasks.find((x) => x.title === '예약')!
    const out = buildTimeline(w.projects[0], w.tasks, [ev(t.id, '2026-11-20', { kind: 'task' }), ev('회식', '2026-11-20', { start: '19:00' }), ev('회식', '2026-11-20', { start: '19:00' })])
    const day = out.entries.filter((e) => e.date === '2026-11-20')
    expect(day.map((e) => e.type)).toEqual(['event', 'task'])
  })
  it('오늘을 기준으로 지난 것/앞으로를 나눈다', () => {
    const g = groupByDate(tl.entries, '2026-11-09')
    expect(g.days.map((d) => d.date)).toEqual(['2026-11-05', '2026-11-20', '2026-11-25', '2026-12-09'])
    expect(g.todayIndex).toBe(1) // 11-05 는 지남, 11-20 부터 앞으로
    expect(groupByDate(tl.entries, '2027-01-01').todayIndex).toBe(4)
    expect(groupByDate([], '2026-11-09')).toEqual({ days: [], todayIndex: 0 })
  })
})
