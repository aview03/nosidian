import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from './app'
import { buildIndex } from './links'
import { buildWork } from './work'
import { patchTask, withUndo } from './workOps'
import { setLang } from './i18n'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const TASKS = '행사/할 일.md'
const load = (content: string) => {
  const files = Object.fromEntries([note('행사/프로젝트 개요.md', '---\ntype: project\n---\n# 행사\n'), note(TASKS, content)].map((f) => [f.path, f]))
  useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, toast: null, toastUndo: null })
}
const first = () => buildWork(useApp.getState().files).tasks[0]
const text = () => useApp.getState().files[TASKS].content

beforeEach(() => setLang('ko'))

describe('patchTask: 마감·담당·우선순위만 바꾼다', () => {
  it('마감을 바꿔도 상태·결론·담당 같은 나머지 꼬리표는 그대로', () => {
    load('- [ ] 결정 하나 kind:decision status:doing owner:민수 p:1 due:2026-11-20 => 결론\n')
    expect(patchTask(first(), { due: '2026-12-01' })).toBe(true)
    expect(first()).toMatchObject({ due: '2026-12-01', state: 'doing', owner: ['민수'], p: 1, kind: 'decision', conclusion: '결론' })
  })
  it('null 은 지우고, 안 적은 항목은 그대로', () => {
    load('- [ ] 일 owner:민수 p:2 due:2026-11-20\n')
    patchTask(first(), { owner: null, p: null })
    expect(first()).toMatchObject({ owner: [], due: '2026-11-20' })
    expect(first().p).toBeUndefined()
  })
  it('완료 표시는 유지', () => {
    load('- [x] 끝난 일 due:2026-11-01\n')
    patchTask(first(), { due: null })
    expect(first().done).toBe(true)
    expect(first().due).toBeUndefined()
  })
})

describe('withUndo: 되돌리기 알림', () => {
  it('성공하면 알림이 뜨고, 누르면 변경 전 노트로 돌아간다', () => {
    load('- [ ] 일 due:2026-11-20\n')
    const before = text()
    expect(withUndo(first(), '마감을 바꿨어요', () => patchTask(first(), { due: '2026-12-01' }))).toBe(true)
    expect(text()).not.toBe(before)
    expect(useApp.getState().toast).toBe('마감을 바꿨어요')
    useApp.getState().toastUndo!()
    expect(text()).toBe(before)
  })
  it('그새 노트가 또 바뀌었으면 덮어쓰지 않는다', () => {
    load('- [ ] 일 due:2026-11-20\n')
    withUndo(first(), '바꿨어요', () => patchTask(first(), { due: '2026-12-01' }))
    useApp.getState().setContent(TASKS, text() + '- [ ] 새 일\n')
    const edited = text()
    useApp.getState().toastUndo!()
    expect(text()).toBe(edited)
  })
  it('변경이 실패하면 알림도 없다', () => {
    load('- [ ] 일\n')
    expect(withUndo(first(), '바꿨어요', () => false)).toBe(false)
    expect(useApp.getState().toastUndo).toBeNull()
  })
})
