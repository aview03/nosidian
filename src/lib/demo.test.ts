import { describe, expect, it } from 'vitest'
import { demoNotes } from './demo'
import { buildQueues, buildWork } from './work'
import type { NoteFile } from './types'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const filesOf = (lang: 'ko' | 'en') =>
  Object.fromEntries(Object.entries(demoNotes(lang).notes).map(([path, content]) => [path, { path, content, sha: null, dirty: false, mtime: 0 } as NoteFile]))

describe.each(['ko', 'en'] as const)('예제 vault (%s): 처음 여는 사람이 보는 내 업무', (lang) => {
  const work = buildWork(filesOf(lang))
  const q = buildQueues(work, today())

  it('프로젝트 하나와 업무 8개', () => {
    expect(work.projects).toHaveLength(1)
    expect(work.tasks).toHaveLength(8)
  })

  it('기한 초과 1 · 오늘 1 · 이번 주 1 · 대기 1 · 진행 중 1 · 담당자 없음 1 · 결정 1', () => {
    expect([q.overdue.length, q.today.length, q.week.length, q.waiting.length, q.doing.length, q.unowned.length, q.decisions.length]).toEqual([1, 1, 1, 1, 1, 1, 1])
  })

  it('끝난 일은 대기열에 없다 (결론이 적힌 완료 업무)', () => {
    const done = work.tasks.find((t) => t.done)
    expect(done?.conclusion).toBeTruthy()
    const all = [...q.overdue, ...q.today, ...q.week, ...q.waiting, ...q.doing, ...q.unowned, ...q.decisions]
    expect(all.some((x) => x.task.done)).toBe(false)
  })

  it('일상 노트(체크리스트만 있는 Daily·루틴 등)는 업무로 세지 않는다', () => {
    expect(work.tasks.every((t) => /Party Planning|행사 준비/.test(t.path))).toBe(true)
  })
})
