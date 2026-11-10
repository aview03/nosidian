// 앱이 쓰는 두 폴더(날짜별 노트 폴더, 프로젝트 폴더)의 자리 규칙. 순수 함수.
//  - 날짜별 노트 폴더: 날짜 이름(YYYY-MM-DD)의 노트만, 하위 폴더 없음.
//  - 프로젝트 폴더(프로젝트/Projects): 바로 아래에는 노트를 두지 않는다 — 프로젝트(개요 노트가 있는 폴더)만 만든다.
// 규칙은 "사람이 직접 만들거나 옮길 때"만 막는다. 동기화·가져오기·AI 가 가져온 파일은 막지 않고 정리하도록 안내한다.
import { t } from './i18n'
import type { NoteFile } from './types'

const DATE_BASE = /^\d{4}-\d{2}-\d{2}$/
export const isDateNote = (path: string) => DATE_BASE.test(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, ''))

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const live = (files: Record<string, NoteFile>) => Object.values(files).filter((f) => !f.deleted)

export interface FolderCtx {
  /** 날짜별 노트 폴더(설정). 비어 있으면 날짜 노트가 맨 위에 있으므로 규칙을 적용하지 않는다 */
  daily: string
}
export const dailyOf = (raw: string) => raw.trim().replace(/\/$/, '')
export const isProjectsRoot = (dir: string) => dir === '프로젝트' || dir === 'Projects'

export type PlaceError = 'dailyOnlyDate' | 'dailyNoFolders' | 'projectsRootNote' | 'projectsRootFolder'

/** 이 폴더 안에 새 노트를 만들 때: today = 날짜 노트(오늘)로 대신 열기, wizard = 새 프로젝트 마법사로, null = 자유 */
export function newNoteIn(dir: string, ctx: FolderCtx): 'today' | 'wizard' | null {
  if (ctx.daily && dir === ctx.daily) return 'today'
  if (isProjectsRoot(dir)) return 'wizard'
  return null
}

/** 이 폴더 안에 새 폴더를 만들 때 막는 이유 */
export function newFolderIn(dir: string, ctx: FolderCtx): PlaceError | null {
  if (ctx.daily && (dir === ctx.daily || dir.startsWith(ctx.daily + '/'))) return 'dailyNoFolders'
  if (isProjectsRoot(dir)) return 'projectsRootFolder'
  return null
}

/** 노트를 이 경로로 이름 바꾸거나 옮길 때 막는 이유 */
export function checkNotePath(path: string, ctx: FolderCtx): PlaceError | null {
  const dir = dirOf(path)
  if (ctx.daily && dir === ctx.daily) return isDateNote(path) ? null : 'dailyOnlyDate'
  if (ctx.daily && dir.startsWith(ctx.daily + '/')) return 'dailyNoFolders'
  if (isProjectsRoot(dir)) return 'projectsRootNote'
  return null
}

/** 선택한 노트·폴더를 dest 로 옮겨도 되는가 */
export function checkMove(notes: string[], folders: string[], dest: string, ctx: FolderCtx): PlaceError | null {
  for (const n of notes) {
    const e = checkNotePath((dest ? dest + '/' : '') + n.slice(n.lastIndexOf('/') + 1), ctx)
    if (e) return e
  }
  if (folders.length) {
    if (ctx.daily && (dest === ctx.daily || dest.startsWith(ctx.daily + '/'))) return 'dailyNoFolders'
  }
  return null
}

/** 날짜별 노트 폴더 안의 날짜 이름이 아닌 노트들(동기화·가져오기로 들어온 것) */
export function strayInDaily(files: Record<string, NoteFile>, ctx: FolderCtx): string[] {
  if (!ctx.daily) return []
  return live(files).filter((f) => f.path.startsWith(ctx.daily + '/') && !(dirOf(f.path) === ctx.daily && isDateNote(f.path))).map((f) => f.path).sort()
}

const OVERVIEW_RE = /^---\r?\n[\s\S]*?\btype:\s*['"]?project\b/i
/** 프로젝트 폴더 바로 아래 폴더 중 프로젝트 노트(type: project)가 하나도 없는 것 */
export function projectsWithoutOverview(files: Record<string, NoteFile>, root: string): string[] {
  const has = new Set<string>()
  const all = new Set<string>()
  for (const f of live(files)) {
    if (!f.path.startsWith(root + '/')) continue
    const rest = f.path.slice(root.length + 1)
    const i = rest.indexOf('/')
    if (i < 0) continue // 프로젝트 폴더 바로 아래의 일반 노트
    const folder = root + '/' + rest.slice(0, i)
    all.add(folder)
    if (OVERVIEW_RE.test(f.content)) has.add(folder)
  }
  return [...all].filter((x) => !has.has(x)).sort()
}

/** 프로젝트 개요 노트를 새로 만든다: 경로와 내용 */
export function overviewNote(folder: string, ko: boolean): { path: string; content: string } {
  const name = folder.slice(folder.lastIndexOf('/') + 1)
  return { path: `${folder}/${ko ? '프로젝트 개요' : 'Project Overview'}.md`, content: `---\ntype: project\nstatus: ${ko ? '진행 중' : 'active'}\n---\n# ${name}\n\n` }
}

export function placeMessage(e: PlaceError, folder: string): string {
  switch (e) {
    case 'dailyOnlyDate': return t('"{name}" 폴더에는 날짜 이름(YYYY-MM-DD)의 노트만 둘 수 있어요.', { name: folder })
    case 'dailyNoFolders': return t('"{name}" 폴더 안에는 폴더를 만들 수 없어요.', { name: folder })
    case 'projectsRootNote': return t('"{name}" 폴더 바로 아래에는 노트를 둘 수 없어요. 프로젝트 폴더 안에 두거나 새 프로젝트로 만들어 주세요.', { name: folder })
    case 'projectsRootFolder': return t('"{name}" 폴더 아래에는 새 프로젝트로 만들어야 해요.', { name: folder })
  }
}
