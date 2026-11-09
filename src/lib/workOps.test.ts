import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from './app'
import { setLang } from './i18n'
import { addTask, deleteTask, moveTask, moveToProject, updateTask } from './workOps'
import { buildQueues, buildWork, tokensForState } from './work'
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
    // 받은 업무 노트의 줄은 꼬리표가 없어도 전부 업무(정리할 업무)
    expect(buildWork(useApp.getState().files).tasks.map((t) => t.title)).toEqual(['세금 신고', '우체국 가기'])
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

  it('moveToProject: 받은 업무의 줄이 프로젝트 할 일 노트로 옮겨가고 값은 그대로', () => {
    load(PROJECT, note('행사/할 일.md', '# 할 일\n'), note('받은 업무.md', '# 받은 업무\n\n- [ ] 세금 신고 due:2026-11-16 owner:민수 p:1\n- [ ] 우체국 가기 due:2026-11-17\n'))
    const task = buildWork(useApp.getState().files).tasks.find((t) => t.title === '세금 신고')!
    expect(task.project).toBeNull()
    expect(moveToProject(task, '행사/프로젝트 개요.md')).toBe(true)
    expect(text('받은 업무.md')).toBe('# 받은 업무\n\n- [ ] 우체국 가기 due:2026-11-17\n')
    expect(text('행사/할 일.md')).toBe('# 할 일\n- [ ] 세금 신고 due:2026-11-16 owner:민수 p:1\n')
    expect(buildWork(useApp.getState().files).tasks.find((t) => t.title === '세금 신고')?.project).toBe('행사/프로젝트 개요.md')
  })

  it('결정 안건: 결론 없이는 체크로 닫히지 않고, 결론이 있으면 닫힌다', () => {
    load(PROJECT, note('행사/할 일.md', '# 할 일\n\n- [ ] 장소 정하기 kind:decision due:2026-11-12\n- [ ] 케이크 kind:decision => 초코로 결정\n'))
    const app = useApp.getState()
    app.toggleTask('행사/할 일.md', 2)
    expect(text('행사/할 일.md')).toContain('- [ ] 장소 정하기') // 그대로
    app.toggleTask('행사/할 일.md', 3)
    expect(text('행사/할 일.md')).toContain('- [x] 케이크')
  })

  it('결정 안건은 결정할 일 대기열에 따로 서고, 닫으면 빠진다 (수정해도 kind 유지)', () => {
    load(PROJECT, note('행사/할 일.md', '# 할 일\n\n- [ ] 장소 정하기 kind:decision due:2026-11-08 owner:민수\n- [ ] 현수막 due:2026-11-08\n'))
    const w = buildWork(useApp.getState().files)
    const q = buildQueues(w, '2026-11-09')
    expect(q.decisions.map((x) => x.task.title)).toEqual(['장소 정하기'])
    expect(q.decisions[0].days).toBe(1) // 다시 확인할 날이 하루 지남
    expect(q.overdue.map((x) => x.task.title)).toEqual(['현수막']) // 겹치지 않는다
    const t = w.tasks.find((x) => x.title === '장소 정하기')!
    moveTask(t, 'doing')
    expect(text('행사/할 일.md')).toContain('- [ ] 장소 정하기 status:doing kind:decision')
    const t2 = buildWork(useApp.getState().files).tasks.find((x) => x.title === '장소 정하기')!
    expect(updateTask(t2, { title: t2.title, done: true, tokens: { kind: 'decision', conclusion: '식당으로 결정' } })).toBe(true)
    expect(buildQueues(buildWork(useApp.getState().files), '2026-11-09').decisions).toHaveLength(0)
  })

  it('받은 업무 노트의 줄은 꼬리표가 없어도 업무로 센다(정리할 업무)', () => {
    load(PROJECT)
    addTask(edit('세금 신고'), null) // 마감·담당 없이
    const tasks = buildWork(useApp.getState().files).tasks
    expect(tasks.map((x) => x.title)).toEqual(['세금 신고'])
    expect(tasks[0].project).toBeNull()
  })
})
