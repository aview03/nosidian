// 업무 편집 연산: work.ts 의 순수 함수로 한 줄을 만들고, 노트(저장소)에 쓴다. 화면 상태(편집기·허브)도 여기서 관리한다.
import { create } from 'zustand'
import { useApp } from './app'
import { t } from './i18n'
import { buildWork, findTaskLine, rewriteTaskLine, tokensForState, type Task, type TaskEdit, type UiState } from './work'
import { formatWorkTokens } from './taskTokens'

interface WorkUi {
  /** 업무 편집기: task 가 있으면 수정, 없으면 새 업무(project = 넣을 프로젝트 노트 경로) */
  editor: null | { task?: Task; project?: string | null }
  openEditor(task?: Task, project?: string | null): void
  closeEditor(): void
  /** 프로젝트 허브에서 보고 있는 프로젝트 노트 경로 */
  hub: string | null
  /** 새 프로젝트 마법사가 열려 있나 */
  wizard: boolean
  openHub(path: string): void
}

export const useWorkUi = create<WorkUi>((set) => ({
  editor: null,
  openEditor: (task, project = null) => set({ editor: { task, project } }),
  closeEditor: () => set({ editor: null }),
  hub: null,
  wizard: false,
  openHub: (path) => {
    set({ hub: path })
    useApp.getState().go('project')
  },
}))

const say = (m: string) => useApp.getState().say(m)

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
  const base = { due: task.due ?? undefined, owner: task.owner.length ? task.owner : undefined, p: task.p ?? undefined, impact: task.impact ?? undefined, conclusion: task.conclusion ?? undefined, proj: task.explicitProj ?? undefined }
  const ui: UiState = to === 'done' ? 'todo' : to
  return updateTask(task, { title: task.title, done: to === 'done', tokens: tokensForState(ui, base) })
}
