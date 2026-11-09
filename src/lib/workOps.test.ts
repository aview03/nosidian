import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from './app'
import { setLang } from './i18n'
import { addTask, deleteTask, moveTask, updateTask } from './workOps'
import { buildWork, tokensForState } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const load = (...ns: NoteFile[]) => useApp.setState({ files: Object.fromEntries(ns.map((n) => [n.path, n])) })
const text = (p: string) => useApp.getState().files[p]?.content
const edit = (title: string, tokens = {}, done = false) => ({ title, done, tokens })

const PROJECT = note('행사/프로젝트 개요.md', '---\ntype: project\n---\n# 행사 준비\n')

beforeEach(() => {
  setLang('ko') // 새 노트 이름(할 일·받은 업무)은 UI 언어를 따른다
  load(PROJECT, note('행사/할 일.md', '# 할 일\n\n- [ ] 장소 예약 due:2026-11-06 owner:민수\n- [ ] 케이크 주문\n'))
})

describe('업무 연산이 노트를 고친다', () => {
  it('updateTask: 그 줄만 바뀌고 나머지 줄은 그대로', () => {
    const task = buildWork(useApp.getState().files).tasks.find((t) => t.title === '장소 예약')!
    expect(updateTask(task, edit('장소 예약 완료 확인', tokensForState('doing', { due: '2026-11-09', owner: ['지현'] })))).toBe(true)
    expect(text('행사/할 일.md')).toBe('# 할 일\n\n- [ ] 장소 예약 완료 확인 status:doing due:2026-11-09 owner:지현\n- [ ] 케이크 주문\n')
  })

  it('updateTask: 그새 노트 위에 줄이 생겨도 제목으로 찾아서 고친다', () => {
    const task = buildWork(useApp.getState().files).tasks.find((t) => t.title === '케이크 주문')!
    useApp.getState().setContent('행사/할 일.md', '새 줄\n' + text('행사/할 일.md'))
    expect(updateTask(task, edit('케이크 주문', { due: '2026-11-20' }, true))).toBe(true)
    expect(text('행사/할 일.md')).toContain('- [x] 케이크 주문 due:2026-11-20')
  })

  it('updateTask: 줄이 사라졌으면 false (아무것도 쓰지 않는다)', () => {
    const task = buildWork(useApp.getState().files).tasks[0]
    useApp.getState().setContent('행사/할 일.md', '# 비었음\n')
    const before = text('행사/할 일.md')
    expect(updateTask(task, edit(task.title))).toBe(false)
    expect(text('행사/할 일.md')).toBe(before)
  })

  it('deleteTask: 그 줄만 지운다', () => {
    const task = buildWork(useApp.getState().files).tasks.find((t) => t.title === '케이크 주문')!
    expect(deleteTask(task)).toBe(true)
    expect(text('행사/할 일.md')).toBe('# 할 일\n\n- [ ] 장소 예약 due:2026-11-06 owner:민수\n')
  })

  it('addTask(프로젝트): 프로젝트 폴더의 기존 "할 일" 노트 끝에 추가', () => {
    const path = addTask(edit('현수막 인쇄', { due: '2026-11-10', owner: ['민수'] }), '행사/프로젝트 개요.md')
    expect(path).toBe('행사/할 일.md')
    expect(text(path)!.endsWith('- [ ] 케이크 주문\n- [ ] 현수막 인쇄 due:2026-11-10 owner:민수\n')).toBe(true)
    // 폴더 규칙으로 소속되므로 proj: 꼬리표는 필요 없다
    expect(buildWork(useApp.getState().files).tasks.find((t) => t.title === '현수막 인쇄')?.project).toBe('행사/프로젝트 개요.md')
  })

  it('addTask(프로젝트에 할 일 노트가 없으면): 새로 만든다', () => {
    load(PROJECT)
    const path = addTask(edit('첫 업무'), '행사/프로젝트 개요.md')
    expect(path).toBe('행사/할 일.md')
    expect(text(path)).toBe('# 할 일\n\n- [ ] 첫 업무\n')
  })

  it('addTask(프로젝트 없음): "받은 업무" 노트에 모은다 (두 번째부터는 이어 붙임)', () => {
    load(PROJECT)
    expect(addTask(edit('세금 신고', { due: '2026-11-16' }), null)).toBe('받은 업무.md')
    addTask(edit('우체국 가기'), null)
    expect(text('받은 업무.md')).toBe('# 받은 업무\n\n- [ ] 세금 신고 due:2026-11-16\n- [ ] 우체국 가기\n')
    // 프로젝트 밖이지만 꼬리표가 있는 것만 업무로 센다
    expect(buildWork(useApp.getState().files).tasks.map((t) => t.title)).toEqual(['세금 신고'])
  })

  it('moveTask: 칸을 옮기면 status 만 바뀌고 나머지는 그대로 (대기는 side:other 도)', () => {
    const find = (title: string) => buildWork(useApp.getState().files).tasks.find((t) => t.title === title)!
    moveTask(find('장소 예약'), 'doing')
    expect(text('행사/할 일.md')).toContain('- [ ] 장소 예약 status:doing due:2026-11-06 owner:민수')
    moveTask(find('장소 예약'), 'waiting')
    expect(text('행사/할 일.md')).toContain('- [ ] 장소 예약 status:waiting side:other due:2026-11-06 owner:민수')
    moveTask(find('장소 예약'), 'done')
    expect(text('행사/할 일.md')).toContain('- [x] 장소 예약 due:2026-11-06 owner:민수')
    moveTask(find('장소 예약'), 'todo')
    expect(text('행사/할 일.md')).toContain('- [ ] 장소 예약 due:2026-11-06 owner:민수')
  })
})
