// 업무 편집 연산: work.ts 의 순수 함수로 한 줄을 만들고, 노트(저장소)에 쓴다. 화면 상태(편집기·허브)도 여기서 관리한다.
import { create } from 'zustand'
import { registerScreen, useApp } from './app'
import { t } from './i18n'
import { buildWork, findTaskLine, rewriteTaskLine, tokensForState, uiStateOf, type Task, type TaskEdit, type UiState } from './work'
import { formatWorkTokens } from './taskTokens'
import { moveTaskBlock } from './taskOrder'
import { forgetTile, loadLayout, renameTile, saveLayout, type Layout } from './tiles'
import { removeView, upsertView, VIEWS_PATH, viewsNoteHeader, type View } from './views'

interface WorkUi {
  /** 업무 편집기: task 가 있으면 수정, 없으면 새 업무(project = 넣을 프로젝트 노트 경로) */
  editor: null | { task?: Task; project?: string | null; closing?: boolean }
  /** closing: 결정 안건을 닫으려는 경우 — 완료로 미리 체크하고 결론을 묻는다 */
  openEditor(task?: Task, project?: string | null, closing?: boolean): void
  closeEditor(): void
  /** 프로젝트 허브에서 보고 있는 프로젝트 노트 경로 */
  hub: string | null
  /** 새 프로젝트 마법사가 열려 있나 */
  wizard: boolean
  /** 내 업무 타일 배치(순서·숨김·접기·줄 수). 개인 취향이라 기기에 기억한다 */
  layout: Layout
  patchLayout(f: (l: Layout) => Layout): void
  /** 화면 편집 중(타일 순서·숨기기·추가) */
  editing: boolean
  /** 화면 편집을 끝내면 돌아갈 곳(설정에서 들어왔으면 'settings'). 없으면 내 업무에 그대로 있는다 */
  returnTo: 'settings' | null
  /** 사용자 타일 편집기: view 가 있으면 수정, 없으면 새 타일 */
  viewEditor: null | { view?: View }
  /** 노트 "업무 정리" 화면이 열려 있는 노트 경로(회의록의 후속 업무 담당·마감을 한 번에 정한다) */
  tidy: string | null
  openTidy(path: string): void
  closeTidy(): void
  openHub(path: string): void
}

export const useWorkUi = create<WorkUi>((set) => ({
  editor: null,
  openEditor: (task, project = null, closing = false) => set({ editor: { task, project, closing } }),
  closeEditor: () => set({ editor: null }),
  tidy: null,
  openTidy: (path) => set({ tidy: path }),
  closeTidy: () => set({ tidy: null }),
  hub: null,
  wizard: false,
  layout: loadLayout(),
  patchLayout: (f) =>
    set((st) => {
      const layout = f(st.layout)
      saveLayout(layout)
      return { layout }
    }),
  editing: false,
  returnTo: null,
  viewEditor: null,
  openHub: (path) => {
    set({ hub: path })
    useApp.getState().go('project')
  },
}))

const say = (m: string) => useApp.getState().say(m)

// 프로젝트 허브에서 노트 등으로 갔다가 뒤로 오면 보던 프로젝트로 돌아온다
registerScreen('project', {
  capture: () => ({ hub: useWorkUi.getState().hub }),
  restore: (s) => useWorkUi.setState({ hub: (s.hub as string | null) ?? null }),
})

/** 체크박스를 눌렀을 때: 결정 안건을 닫을 땐 결론을 받아야 하므로 편집기를 열고, 나머지는 그냥 체크한다 */
export function toggleOrClose(task: Task) {
  if (task.kind === 'decision' && !task.done) useWorkUi.getState().openEditor(task, null, true)
  else if (!task.done) completeWithUndo(task.path, task.line, task.title)
  else useApp.getState().toggleTask(task.path, task.line)
}

/**
 * 체크리스트 줄을 완료로 바꾸고 '완료했어요 · 되돌리기'(5초)를 띄운다. 완료하면 목록에서 사라지므로(디자이너 P3).
 * 결정 안건 거부 등으로 줄이 안 바뀌면 알림 없음. 되돌릴 때 그새 노트가 바뀌었으면 덮어쓰지 않는다.
 */
export function completeWithUndo(path: string, line: number, title: string) {
  const before = useApp.getState().files[path]?.content
  useApp.getState().toggleTask(path, line)
  const after = useApp.getState().files[path]?.content
  if (before === undefined || after === before) return
  useApp.getState().sayUndo(t('"{name}" 완료했어요', { name: title }), () => {
    if (useApp.getState().files[path]?.content !== after) {
      say(t('그새 노트가 바뀌어서 되돌리지 못했어요'))
      return
    }
    useApp.getState().setContent(path, before)
    say(t('되돌렸어요'))
  })
}

/** 업무 한 줄을 수정한다. 노트가 그새 바뀌어 줄을 못 찾으면 false */
export function updateTask(task: Task, edit: TaskEdit): boolean {
  const app = useApp.getState()
  const f = app.files[task.path]
  if (!f || f.deleted) return false
  const idx = findTaskLine(f.content, task)
  if (idx < 0) {
    say(t('노트가 바뀌어서 이 업무를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.'))
    return false
  }
  const lines = f.content.split('\n')
  const next = rewriteTaskLine(lines[idx], edit)
  if (next === null) return false
  lines[idx] = next
  app.setContent(task.path, lines.join('\n'))
  return true
}

export function deleteTask(task: Task): boolean {
  const app = useApp.getState()
  const f = app.files[task.path]
  if (!f || f.deleted) return false
  const idx = findTaskLine(f.content, task)
  if (idx < 0) return false
  const lines = f.content.split('\n')
  lines.splice(idx, 1)
  app.setContent(task.path, lines.join('\n'))
  return true
}

/** 새 업무를 노트에 추가한다. 프로젝트가 있으면 그 폴더의 '할 일' 노트(없으면 프로젝트 노트), 없으면 '받은 업무' 노트. 쓴 노트의 경로를 돌려준다 */
export function addTask(edit: TaskEdit, projectPath: string | null): string {
  const app = useApp.getState()
  const work = buildWork(app.files)
  const proj = projectPath ? work.projects.find((p) => p.path === projectPath) : undefined
  const line = `- [${edit.done ? 'x' : ' '}] ${[edit.title.replace(/\s+/g, ' ').trim(), formatWorkTokens(edit.tokens)].filter(Boolean).join(' ')}`

  let path: string
  let header: string
  if (proj) {
    if (proj.folder) {
      const names = [t('할 일'), '할 일', 'Tasks']
      const existing = names.map((n) => `${proj.folder}/${n}.md`).find((p) => app.files[p] && !app.files[p].deleted)
      path = existing ?? `${proj.folder}/${t('할 일')}.md`
      header = `# ${t('할 일')}\n\n`
    } else {
      path = proj.path // 프로젝트 노트가 폴더 밖에 있으면 그 노트 끝에 붙인다
      header = ''
    }
  } else {
    const names = [t('받은 업무'), '받은 업무', 'Inbox']
    const existing = names.map((n) => `${n}.md`).find((p) => app.files[p] && !app.files[p].deleted)
    path = existing ?? `${t('받은 업무')}.md`
    header = `# ${t('받은 업무')}\n\n`
  }
  const f = app.files[path]
  if (f && !f.deleted) {
    const sep = f.content.endsWith('\n') ? '' : '\n'
    app.setContent(path, f.content + sep + line + '\n')
  } else {
    app.createNote(path, header + line + '\n', false)
  }
  return path
}

/** 보드에서 업무를 다른 칸으로 옮긴다. 'done' 은 완료 체크, 나머지는 status 꼬리표만 바꾼다(다른 값은 그대로) */
export function moveTask(task: Task, to: UiState | 'done'): boolean {
  const base = { kind: task.kind, start: task.start ?? undefined, due: task.due ?? undefined, owner: task.owner.length ? task.owner : undefined, p: task.p ?? undefined, impact: task.impact ?? undefined, conclusion: task.conclusion ?? undefined, proj: task.explicitProj ?? undefined }
  const ui: UiState = to === 'done' ? 'todo' : to
  return updateTask(task, { title: task.title, done: to === 'done', tokens: tokensForState(ui, base) })
}

/** 업무의 시작일·마감·담당·우선순위만 바꾼다(null = 지움, 안 적으면 그대로). 상태·종류·영향·결론·프로젝트 꼬리표는 그대로 둔다 */
export function patchTask(task: Task, patch: { start?: string | null; due?: string | null; owner?: string[] | null; p?: 1 | 2 | 3 | null }): boolean {
  const pick = <T,>(v: T | null | undefined, cur: T | undefined): T | undefined => (v === undefined ? cur : v === null ? undefined : v)
  const owner = pick(patch.owner, task.owner.length ? task.owner : undefined)
  const base = {
    kind: task.kind,
    start: pick(patch.start, task.start ?? undefined),
    due: pick(patch.due, task.due ?? undefined),
    owner: owner && owner.length ? owner : undefined,
    p: pick(patch.p, task.p ?? undefined),
    impact: task.impact ?? undefined,
    conclusion: task.conclusion ?? undefined,
    proj: task.explicitProj ?? undefined,
  }
  return updateTask(task, { title: task.title, done: task.done, tokens: tokensForState(uiStateOf(task), base) })
}

/**
 * 보기(표·담당자별 등)에서 한 변경을 "되돌리기" 알림과 함께 한다. run 이 성공하면 알림을 띄우고, 누르면 그 노트를 변경 전 내용으로 되돌린다.
 * 그새 노트가 또 바뀌었으면(동기화·다른 편집) 덮어쓰지 않고 이유를 알린다.
 */
export function withUndo(task: Pick<Task, 'path'>, message: string, run: () => boolean): boolean {
  const before = useApp.getState().files[task.path]?.content
  if (before === undefined || !run()) return false
  const after = useApp.getState().files[task.path]?.content
  useApp.getState().sayUndo(message, () => {
    const now = useApp.getState().files[task.path]?.content
    if (now !== after) {
      say(t('그새 노트가 바뀌어서 되돌리지 못했어요'))
      return
    }
    useApp.getState().setContent(task.path, before)
    say(t('되돌렸어요'))
  })
  return true
}

/** 같은 노트 안에서 task 의 줄(과 그 아래 들여쓴 줄)을 target 업무의 앞/뒤로 옮긴다. 다른 노트이거나 바뀌는 게 없으면 false */
export function reorderTask(task: Task, target: Task, where: 'before' | 'after'): boolean {
  if (task.path !== target.path) return false
  const app = useApp.getState()
  const f = app.files[task.path]
  if (!f || f.deleted) return false
  const next = moveTaskBlock(f.content, task, target, where)
  if (next === null) return false
  app.setContent(task.path, next)
  return true
}

/** 프로젝트 밖(받은 업무 등)에 있는 업무를 프로젝트의 '할 일' 노트로 옮긴다: 새 위치에 먼저 쓰고, 성공하면 원래 줄을 지운다 */
export function moveToProject(task: Task, projectPath: string): boolean {
  const tokens = { kind: task.kind, start: task.start ?? undefined, due: task.due ?? undefined, owner: task.owner.length ? task.owner : undefined, p: task.p ?? undefined, impact: task.impact ?? undefined, conclusion: task.conclusion ?? undefined, status: task.state === 'todo' ? undefined : task.state, side: task.side === 'other' ? ('other' as const) : undefined }
  const to = addTask({ title: task.title, done: task.done, tokens }, projectPath)
  if (to === task.path) return false
  return deleteTask(task)
}

/** 보기를 보기 노트(_workspace/보기.md)에 저장한다. 노트가 없으면 설명과 함께 만든다. oldName: 이름을 바꾸는 수정일 때 원래 이름 */
export function saveView(v: View, oldName?: string): void {
  const app = useApp.getState()
  const f = app.files[VIEWS_PATH]
  if (f && !f.deleted) app.setContent(VIEWS_PATH, upsertView(f.content, v, oldName))
  else app.createNote(VIEWS_PATH, upsertView(viewsNoteHeader(), v), false)
  if (oldName && oldName.toLowerCase() !== v.name.toLowerCase()) useWorkUi.getState().patchLayout((l) => renameTile(l, oldName, v.name)) // 이름이 바뀌면 자리·설정이 따라간다
}

export function deleteView(name: string): void {
  const app = useApp.getState()
  const f = app.files[VIEWS_PATH]
  if (f && !f.deleted) app.setContent(VIEWS_PATH, removeView(f.content, name))
  useWorkUi.getState().patchLayout((l) => forgetTile(l, name))
}
