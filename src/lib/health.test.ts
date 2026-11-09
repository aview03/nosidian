import { describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS, projectHealth, readThresholds, SETTINGS_PATH, settingsNoteContent } from './health'
import { buildWork } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const TODAY = '2026-11-09'
const tasksOf = (lines: string) => {
  const w = buildWork({ 'p/개요.md': note('p/개요.md', '---\ntype: project\n---\n# P\n'), 'p/할 일.md': note('p/할 일.md', '# 할 일\n\n' + lines) })
  return w.tasks
}

describe('프로젝트 건강도', () => {
  it('열린 일이 없으면 판단하지 않는다(null)', () => {
    expect(projectHealth([], TODAY)).toBeNull()
    expect(projectHealth(tasksOf('- [x] 끝 owner:a due:2026-11-01\n'), TODAY)).toBeNull()
  })
  it('문제가 없으면 ok', () => {
    expect(projectHealth(tasksOf('- [ ] a owner:x due:2026-11-20\n'), TODAY)).toEqual({ level: 'ok', signals: [] })
  })
  it('기한 지난 일 1개는 주의, 3개는 위험', () => {
    const one = projectHealth(tasksOf('- [ ] a owner:x due:2026-11-01\n'), TODAY)!
    expect(one.level).toBe('warn')
    expect(one.signals).toEqual([{ key: 'overdue', count: 1, level: 'warn' }])
    const three = projectHealth(tasksOf('- [ ] a owner:x due:2026-11-01\n- [ ] b owner:x due:2026-11-02\n- [ ] c owner:x due:2026-11-03\n'), TODAY)!
    expect(three.level).toBe('risk')
  })
  it('대기·결정은 기한 초과와 섞지 않고 각자의 신호로 센다', () => {
    const h = projectHealth(tasksOf('- [ ] 답 status:waiting side:other owner:x due:2026-11-01\n- [ ] 정하기 kind:decision owner:x due:2026-11-02\n'), TODAY)!
    expect(h.signals.map((s) => s.key).sort()).toEqual(['decisionLate', 'waitingLate'])
    expect(h.signals.some((s) => s.key === 'overdue')).toBe(false)
  })
  it('담당자 없는 일은 2개부터 주의', () => {
    expect(projectHealth(tasksOf('- [ ] a due:2026-11-20\n'), TODAY)!.level).toBe('ok')
    expect(projectHealth(tasksOf('- [ ] a due:2026-11-20\n- [ ] b due:2026-11-21\n'), TODAY)!.level).toBe('warn')
  })
  it('문턱은 vault 설정 노트에서 읽고, 잘못된 값은 기본값', () => {
    expect(readThresholds({})).toEqual(DEFAULT_THRESHOLDS)
    const th = readThresholds({ [SETTINGS_PATH]: note(SETTINGS_PATH, '---\nhealth_overdue_warn: 2\nhealth_overdue_risk: 5\nhealth_unowned_warn: abc\n---\n') })
    expect(th.overdue).toEqual([2, 5])
    expect(th.unowned).toEqual(DEFAULT_THRESHOLDS.unowned)
    const h = projectHealth(tasksOf('- [ ] a owner:x due:2026-11-01\n'), TODAY, th)!
    expect(h.level).toBe('ok') // 문턱을 올렸으니 1개는 정상
  })
  it('설정 노트 첫 내용은 자기 자신이 읽어도 기본값과 같다', () => {
    expect(readThresholds({ [SETTINGS_PATH]: note(SETTINGS_PATH, settingsNoteContent()) })).toEqual(DEFAULT_THRESHOLDS)
  })
})
