import { describe, expect, it } from 'vitest'
import { buildCalendar } from './calendar'
import { buildDayItems, isDeadlineLike } from './dayItems'
import { buildWork } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const TODAY = '2026-11-11' // 수요일
const daily = (date: string, lines: string[]) => note(`Daily/${date}.md`, `# ${date}\n\n## 할 일\n${lines.join('\n')}\n`)
const calOf = (files: NoteFile[]) => {
  const rec = Object.fromEntries(files.map((f) => [f.path, f]))
  return { cal: buildCalendar(rec), taskIds: new Set(buildWork(rec).tasks.map((x) => x.id)) }
}
const titles = (l: { ev: { title: string } }[]) => l.map((x) => x.ev.title)

describe('홈에 함께 보일 종일 체크리스트(과제)', () => {
  const files = [
    daily('2026-11-13', ['- [ ] 영어 에세이 제출']),
    daily('2026-11-16', ['- [ ] 수학 과제 제출', '- [ ] 15:00 치과 예약']),
    daily('2026-11-20', ['- [ ] 먼 과제']),
    daily('2026-11-10', ['- [ ] 국어 숙제 제출', '- [x] 끝낸 숙제']),
    daily('2026-11-02', ['- [ ] 너무 오래된 일']),
    daily('2026-11-11', ['- [ ] 오늘 할 일']),
  ]
  const { cal, taskIds } = calOf(files)
  const r = buildDayItems(cal, taskIds, TODAY)

  it('이번 주: 내일부터 7일 뒤까지의 종일 체크리스트(날짜순). 오늘 것·시간 있는 약속·7일보다 먼 일은 뺀다', () => {
    expect(titles(r.week)).toEqual(['영어 에세이 제출', '수학 과제 제출'])
    expect(r.week.map((x) => x.days)).toEqual([2, 5])
  })
  it('기한이 지난 일: 어제까지 7일 안의 체크 안 한 종일 체크리스트만(끝낸 것·너무 오래된 것 제외)', () => {
    expect(titles(r.overdue)).toEqual(['국어 숙제 제출'])
    expect(r.overdue[0].days).toBe(1)
  })
  it('오늘 날짜 항목은 어느 쪽에도 없다("오늘 일정"에 이미 있다)', () => {
    expect([...titles(r.week), ...titles(r.overdue)]).not.toContain('오늘 할 일')
  })
})

describe('제외 규칙', () => {
  it('반복·기간·시간 있는 일정과 노트 일정은 과제가 아니다', () => {
    const base = { id: 'x', date: '2026-11-13', title: 't', done: false, kind: 'task' as const, path: 'p', line: 0 }
    expect(isDeadlineLike(base)).toBe(true)
    expect(isDeadlineLike({ ...base, start: '15:00' })).toBe(false)
    expect(isDeadlineLike({ ...base, repeat: 'weekly' })).toBe(false)
    expect(isDeadlineLike({ ...base, inst: true })).toBe(false)
    expect(isDeadlineLike({ ...base, span: ['2026-11-13', '2026-11-15'] })).toBe(false)
    expect(isDeadlineLike({ ...base, cont: true })).toBe(false)
    expect(isDeadlineLike({ ...base, done: true })).toBe(false)
    expect(isDeadlineLike({ ...base, kind: 'note' })).toBe(false)
  })
  it('이미 업무(due: 꼬리표)로 잡힌 항목은 두 번 나오지 않게 뺀다', () => {
    const f = [note('행사/프로젝트 개요.md', '---\ntype: project\n---\n# 행사\n'), note('행사/할 일.md', '- [ ] 케이크 주문 due:2026-11-14\n'), daily('2026-11-13', ['- [ ] 영어 에세이 제출'])]
    const { cal, taskIds } = calOf(f)
    expect(titles(buildDayItems(cal, taskIds, TODAY).week)).toEqual(['영어 에세이 제출'])
  })
  it('일정이 하나도 없으면 빈 목록', () => {
    const { cal, taskIds } = calOf([])
    expect(buildDayItems(cal, taskIds, TODAY)).toEqual({ week: [], overdue: [] })
  })
})
