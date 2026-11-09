import { describe, expect, it } from 'vitest'
import { buildCalendar } from './calendar'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const mk = (...ns: NoteFile[]) => Object.fromEntries(ns.map((n) => [n.path, n]))

describe('일정 파서와 업무 토큰의 공존', () => {
  it('Daily 노트의 일정 줄은 그대로 (업무 토큰이 있어도 제목은 깨끗)', () => {
    const m = buildCalendar(mk(note('Daily/2026-11-10.md', '- [ ] 14:00-15:00 치과 owner:홍길동 p:2')))
    const e = m.get('2026-11-10')![0]
    expect(e).toMatchObject({ title: '치과', start: '14:00', end: '15:00' })
  })

  it('날짜가 없는 업무는 due: 날짜에 일정으로 나타난다', () => {
    const m = buildCalendar(mk(note('프로젝트/할 일.md', '- [ ] 견적서 수정 due:2026-11-12 owner:홍길동')))
    expect(m.get('2026-11-12')?.[0]).toMatchObject({ title: '견적서 수정', kind: 'task' })
  })

  it('@날짜 가 있으면 그 날짜가 우선, due 는 일정 날짜를 바꾸지 않는다', () => {
    const m = buildCalendar(mk(note('프로젝트/할 일.md', '- [ ] 회의 @2026-11-11 due:2026-11-30')))
    expect(m.get('2026-11-11')?.[0].title).toBe('회의')
    expect(m.get('2026-11-30')).toBeUndefined()
  })

  it('결론(=>)은 일정 제목에 섞이지 않는다', () => {
    const m = buildCalendar(mk(note('프로젝트/결정.md', '- [x] 정책 확정 due:2026-11-12 => 불가로 결정')))
    expect(m.get('2026-11-12')?.[0].title).toBe('정책 확정')
  })

  it('토큰도 날짜도 없는 체크리스트는 일정이 아니다', () => {
    const m = buildCalendar(mk(note('개인/장보기.md', '- [ ] 우유\n- [ ] 계란')))
    expect([...m.values()].flat()).toHaveLength(0)
  })

  it('기존 반복·기간 문법은 그대로', () => {
    const m = buildCalendar(mk(note('Daily/2026-11-09.md', '- [ ] 요가 repeat:weekly until:2026-11-23\n- [ ] 출장 end:2026-11-11')))
    expect(m.get('2026-11-16')?.some((e) => e.title === '요가')).toBe(true)
    expect(m.get('2026-11-10')?.some((e) => e.title === '출장')).toBe(true)
  })
})
