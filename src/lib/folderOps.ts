// 메모 탭(모바일)의 폴더·노트 목록과 이동·이름 바꾸기·삭제 계획. 순수 함수 — 저장소를 쓰지 않는다.
// 폴더는 따로 저장되지 않고 노트 경로에서 생긴다(노트가 없으면 폴더도 사라진다).
import type { NoteFile } from './types'

export const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const stem = (path: string) => nameOf(path).replace(/\.md$/i, '')
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
const live = (files: Record<string, NoteFile>) => Object.values(files).filter((f) => !f.deleted)

/** 파일 이름에 쓸 수 없는 글자를 걷어낸다 */
export const cleanName = (s: string) => s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()

export interface MemoNote { path: string; title: string; snippet: string; mtime: number; untitled: boolean }
export interface MemoFolder { path: string; name: string; /** 안에 든 노트 수(하위 폴더 포함) */ count: number; mtime: number }

/** 새로 쓰기로 만든 노트의 기본 이름: "새 메모", "새 메모 (2)" … */
export const UNTITLED = '새 메모'
export const isUntitled = (path: string) => new RegExp(`^${UNTITLED}( \\(\\d+\\))?$`).test(stem(path))

/** 본문에서 목록에 보일 첫 줄(제목)과 그다음 한 줄(미리보기) */
export function firstLines(content: string): { title: string; snippet: string } {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') // 속성(frontmatter)은 건너뛴다
  const lines = body.split(/\r?\n/).map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*]\s+(\[[ xX]\]\s+)?/, '').replace(/[*_`>]/g, '').trim()).filter(Boolean)
  return { title: lines[0] ?? '', snippet: lines[1] ?? '' }
}

/** 한 폴더 안의 하위 폴더와 노트(노트는 최근 수정순) */
export function listDir(files: Record<string, NoteFile>, dir: string): { folders: MemoFolder[]; notes: MemoNote[] } {
  const prefix = dir ? dir + '/' : ''
  const folders = new Map<string, MemoFolder>()
  const notes: MemoNote[] = []
  for (const f of live(files)) {
    if (!f.path.startsWith(prefix)) continue
    const rest = f.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      const un = isUntitled(f.path)
      const { title, snippet } = firstLines(f.content)
      notes.push({ path: f.path, title: un ? title || stem(f.path) : stem(f.path), snippet: un ? snippet : title === stem(f.path) ? snippet : title, mtime: f.mtime, untitled: un })
    } else {
      const name = rest.slice(0, slash)
      const p = prefix + name
      const cur = folders.get(p)
      folders.set(p, { path: p, name, count: (cur?.count ?? 0) + 1, mtime: Math.max(cur?.mtime ?? 0, f.mtime) })
    }
  }
  return {
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    notes: notes.sort((a, b) => b.mtime - a.mtime),
  }
}

/** 이동할 수 있는 폴더 목록(상위 폴더 포함, 가나다순) */
export function allFolders(files: Record<string, NoteFile>): string[] {
  const set = new Set<string>()
  for (const f of live(files)) {
    const parts = f.path.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'))
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
}

/** 같은 이름이 이미 있으면 " (2)" 를 붙여 비어 있는 경로를 찾는다 */
function freePath(path: string, taken: Set<string>): string {
  if (!taken.has(path)) return path
  const m = /^(.*?)(\.md)?$/i.exec(path)!
  const base = m[1]
  const ext = m[2] ?? ''
  for (let n = 2; ; n++) {
    const p = `${base} (${n})${ext}`
    if (!taken.has(p)) return p
  }
}

export type PlanError = 'intoSelf' | 'exists' | 'empty' | 'badName'
export interface MovePlan { moves: [string, string][]; error?: PlanError }

/** 선택한 노트와 폴더를 dest 폴더('' = 맨 위)로 옮기는 계획. 폴더는 안의 노트를 모두 따라 옮긴다 */
export function planMove(files: Record<string, NoteFile>, notes: string[], folders: string[], dest: string): MovePlan {
  if (folders.some((f) => dest === f || dest.startsWith(f + '/'))) return { moves: [], error: 'intoSelf' } // 폴더를 자기 안으로는 못 옮긴다
  const taken = new Set(live(files).map((f) => f.path))
  const moves: [string, string][] = []
  const planned = (from: string, to: string) => {
    if (from === to) return
    taken.delete(from)
    const target = freePath(to, taken)
    taken.add(target)
    moves.push([from, target])
  }
  for (const p of notes) if (files[p] && !files[p].deleted) planned(p, join(dest, nameOf(p)))
  for (const folder of folders) {
    const name = folder.slice(folder.lastIndexOf('/') + 1)
    const newDir = join(dest, name)
    if (newDir === folder) continue
    for (const f of live(files)) if (f.path.startsWith(folder + '/')) planned(f.path, newDir + f.path.slice(folder.length))
  }
  return { moves }
}

/** 폴더 이름 바꾸기. 같은 이름의 폴더가 이미 있으면 합치지 않고 거절한다 */
export function planRenameFolder(files: Record<string, NoteFile>, folder: string, newName: string): MovePlan {
  const name = cleanName(newName)
  if (!name || name === '.' || name === '..') return { moves: [], error: 'badName' }
  const newDir = join(dirOf(folder), name)
  if (newDir === folder) return { moves: [] }
  if (live(files).some((f) => f.path.startsWith(newDir + '/'))) return { moves: [], error: 'exists' }
  const moves: [string, string][] = live(files).filter((f) => f.path.startsWith(folder + '/')).map((f) => [f.path, newDir + f.path.slice(folder.length)] as [string, string])
  return moves.length ? { moves } : { moves: [], error: 'empty' }
}

/** 지울 노트 경로들: 선택한 노트 + 선택한 폴더 안의 모든 노트 */
export function planDelete(files: Record<string, NoteFile>, notes: string[], folders: string[]): { paths: string[]; inFolders: number } {
  const out = new Set<string>()
  let inFolders = 0
  for (const p of notes) if (files[p] && !files[p].deleted) out.add(p)
  for (const folder of folders) for (const f of live(files)) if (f.path.startsWith(folder + '/') && !out.has(f.path)) { out.add(f.path); inFolders++ }
  return { paths: [...out], inFolders }
}

/** 이름을 따로 짓지 않고 [쓰기]로 만든 노트 정리: 내용이 있으면 첫 줄을 이름으로, 비었으면 지운다. 열려 있는 노트는 건드리지 않는다 */
export function untitledCleanup(files: Record<string, NoteFile>, current: string | null): { remove: string[]; rename: [string, string][] } {
  const remove: string[] = []
  const rename: [string, string][] = []
  const taken = new Set(live(files).map((f) => f.path))
  for (const f of live(files)) {
    if (!isUntitled(f.path) || f.path === current) continue
    const { title } = firstLines(f.content)
    if (!title) {
      if (!f.content.trim()) remove.push(f.path)
      continue
    }
    const name = cleanName(title).slice(0, 40).trim()
    if (!name) continue
    const to = freePath(join(dirOf(f.path), name + '.md'), taken)
    taken.delete(f.path)
    taken.add(to)
    rename.push([f.path, to])
  }
  return { remove, rename }
}

/** 새로 쓰기: 이 폴더 안에서 비어 있는 "새 메모" 경로 */
export function newMemoPath(files: Record<string, NoteFile>, dir: string): string {
  return freePath(join(dir, UNTITLED + '.md'), new Set(live(files).map((f) => f.path)))
}

/** 앱이 쓰는 최상위 폴더: 지우거나 이름을 바꾸거나 옮기면 프로젝트·일정·규칙이 끊긴다 */
export function protectedFolder(path: string, dailyFolder: string): 'projects' | 'daily' | 'system' | null {
  if (path.includes('/')) return null // 하위 폴더는 지울 수 있다(지울 때 경고)
  if (path === '프로젝트' || path === 'Projects') return 'projects'
  if (dailyFolder.trim() && path === dailyFolder.trim().replace(/\/$/, '')) return 'daily'
  if (path === '_workspace' || path === '_보관' || path === 'Templates') return 'system'
  return null
}

/** 폴더 안의 프로젝트(type: project 노트) 수 — 폴더를 지울 때 "프로젝트가 통째로 사라진다"고 경고하는 데 쓴다 */
export function projectsIn(files: Record<string, NoteFile>, folder: string): number {
  const re = /^---\r?\n[\s\S]*?\btype:\s*['"]?project\b/i
  return live(files).filter((f) => f.path.startsWith(folder + '/') && re.test(f.content)).length
}
