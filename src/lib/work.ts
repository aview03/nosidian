// 업무 인덱스: 노트에서 프로젝트·업무를 "파생"한다. 새로 저장하는 데이터는 없다(내 업무 대기열도 매번 계산).
//
//  - 프로젝트: 프론트매터에 `type: project` 가 있는 노트
//  - 업무: 노트 안의 체크리스트 한 줄 중 업무 토큰(due/owner/p/status/side/proj)이 있거나, 프로젝트에 속한 것
//    → 토큰도 없고 프로젝트에도 안 속한 평범한 체크리스트(장보기 목록 등)는 업무가 아니다 (대기열이 의미를 잃지 않게)
//  - 소속: ① 줄의 proj: / 노트의 프론트매터 project:  ② 프로젝트 노트가 있는 폴더 아래  ③ 프로젝트 노트 자신
import { baseName, dirName, splitFrontmatter } from './links'
import { isTemplatePath } from './templatePaths'
import { formatWorkTokens, splitWorkTokens, type Kind, type Side, type WorkStatus, type WorkTokens } from './taskTokens'
import type { NoteFile } from './types'

export type TaskState = 'todo' | WorkStatus

export interface Task {
  id: string // path:line
  path: string
  line: number
  title: string
  done: boolean
  state: TaskState // todo | doing | waiting | dropped
  due?: string
  owner: string[]
  p?: 1 | 2 | 3
  side?: Side
  kind?: Kind // 'decision' 이면 결정 안건
  impact?: string
  conclusion?: string
  explicitProj?: string // 줄에 적힌 proj
  project: string | null // 소속 프로젝트 노트 경로 (판정 결과)
  hasTokens: boolean // 업무 토큰이 하나라도 있나
}

export interface Project {
  path: string
  name: string
  folder: string // 프로젝트 노트가 있는 폴더 ('' 이면 폴더 규칙 없음)
  fm: Record<string, unknown>
  status?: string
  owner: string[]
  due?: string
  health?: string // 사람이 입력한 상태 (시스템 건강도와 별개)
}

export interface WorkIndex {
  projects: Project[]
  tasks: Task[] // 업무로 인정된 것만
  byProject: Map<string, Task[]>
}

/** 받은 업무 노트(루트): 꼬리표 없이 적은 줄도 업무로 센다 */
export const INBOX = /^(받은 업무|Inbox)\.md$/i

const TASK_LINE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/

interface RawTask {
  line: number
  title: string
  done: boolean
  tokens: ReturnType<typeof splitWorkTokens>['tokens']
  has: boolean
}
interface FileInfo {
  content: string
  fm: Record<string, unknown>
  tasks: RawTask[]
}

const cache = new Map<string, FileInfo>()

function infoOf(f: NoteFile): FileInfo {
  const c = cache.get(f.path)
  if (c && c.content === f.content) return c
  const fm = f.content.startsWith('---') ? splitFrontmatter(f.content).fm : {}
  const tasks: RawTask[] = []
  let fence = false
  f.content.split('\n').forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence
    if (fence) return
    const m = TASK_LINE.exec(raw)
    if (!m) return
    const { rest, tokens, has } = splitWorkTokens(m[2])
    // 일정 토큰(@날짜·end:·repeat:·until:·시간)은 제목에서 걷어 낸다 — 일정 쪽(calendar.ts)이 따로 읽는다
    const title = rest
      .replace(/(?:^|\s)@\d{4}-\d{2}-\d{2}(?=\s|$)/g, ' ')
      .replace(/(?:^|\s)(?:end|until):\d{4}-\d{2}-\d{2}(?=\s|$)/g, ' ')
      .replace(/(?:^|\s)repeat:\S+(?=\s|$)/g, ' ')
      .replace(/^\d{1,2}:\d{2}(?:\s*[-–~]\s*\d{1,2}:\d{2})?\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!title) return
    tasks.push({ line: i, title, done: m[1] !== ' ', tokens, has })
  })
  const info = { content: f.content, fm, tasks }
  cache.set(f.path, info)
  return info
}

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[,，]/).map((x) => x.trim()).filter(Boolean) : []

const linkName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const m = /\[\[([^\]|#]+)/.exec(v)
  return (m ? m[1] : v).trim() || null
}

const dateOf = (v: unknown): string | undefined => {
  if (v instanceof Date && !isNaN(+v)) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}` // js-yaml 은 날짜를 UTC 로 읽는다
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return undefined
}

/** 본문의 첫 번째 `# 제목` (프론트매터 뒤) */
function firstHeading(content: string): string | null {
  const body = content.startsWith('---') ? splitFrontmatter(content).body : content
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(body)
  return m ? m[1].trim() : null
}

export function buildWork(files: Record<string, NoteFile>): WorkIndex {
  const live = Object.values(files).filter((f) => !f.deleted && /\.md$/i.test(f.path) && !isTemplatePath(f.path)) // Templates/ 안은 틀이라 업무가 아니다
  const seen = new Set<string>()

  // 1) 프로젝트
  const projects: Project[] = []
  for (const f of live) {
    seen.add(f.path)
    const { fm } = infoOf(f)
    if (String(fm.type ?? '').toLowerCase() !== 'project') continue
    projects.push({
      path: f.path,
      name: typeof fm.title === 'string' && fm.title ? fm.title : firstHeading(f.content) ?? baseName(f.path),
      folder: dirName(f.path),
      fm,
      status: typeof fm.status === 'string' ? fm.status : undefined,
      owner: asList(fm.owner),
      due: dateOf(fm.due),
      health: typeof fm.health === 'string' ? fm.health : undefined,
    })
  }
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)

  const byName = new Map<string, Project>()
  for (const p of projects) {
    byName.set(p.name.toLowerCase(), p)
    byName.set(baseName(p.path).toLowerCase(), p)
  }
  // 폴더 규칙: 가장 깊은 프로젝트 폴더가 이긴다
  const folders = projects.filter((p) => p.folder).sort((a, b) => b.folder.length - a.folder.length)

  const resolve = (path: string, fm: Record<string, unknown>, explicit?: string): string | null => {
    const byLink = (n: string | null) => (n ? byName.get(n.toLowerCase())?.path ?? null : null)
    const a = byLink(explicit ?? null) ?? byLink(linkName(fm.project))
    if (a) return a
    if (projects.some((p) => p.path === path)) return path
    const dir = dirName(path)
    const hit = folders.find((p) => dir === p.folder || dir.startsWith(p.folder + '/'))
    return hit ? hit.path : null
  }

  // 2) 업무
  const tasks: Task[] = []
  const byProject = new Map<string, Task[]>()
  for (const f of live) {
    const info = infoOf(f)
    for (const r of info.tasks) {
      const project = resolve(f.path, info.fm, r.tokens.proj)
      if (!r.has && !project && !INBOX.test(f.path)) continue // 평범한 체크리스트는 업무가 아니다 (받은 업무 노트는 예외: 거기 적은 건 전부 정리할 업무)
      const t: Task = {
        id: `${f.path}:${r.line}`,
        path: f.path,
        line: r.line,
        title: r.title,
        done: r.done,
        state: r.tokens.status ?? 'todo',
        due: r.tokens.due,
        owner: r.tokens.owner ?? [],
        p: r.tokens.p,
        side: r.tokens.side,
        kind: r.tokens.kind,
        impact: r.tokens.impact,
        conclusion: r.tokens.conclusion,
        explicitProj: r.tokens.proj,
        project,
        hasTokens: r.has,
      }
      tasks.push(t)
      if (project) (byProject.get(project) ?? byProject.set(project, []).get(project)!).push(t)
    }
  }
  return { projects, tasks, byProject }
}

// ── 내 업무 대기열 (모두 파생) ──
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDaysYmd = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}
export const diffDays = (a: string, b: string) => {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((+new Date(y1, m1 - 1, d1) - +new Date(y2, m2 - 1, d2)) / 864e5)
}

export interface QueueItem {
  task: Task
  reason: string // 왜 여기 있나 (화면에서 번역해 보여 준다): overdue | today | week | waiting | doing | unowned
  days?: number // overdue: 지난 일수 / week: 남은 일수 / waiting: 기다린 날(due 기준)
}
export interface Queues {
  overdue: QueueItem[]
  today: QueueItem[]
  week: QueueItem[]
  waiting: QueueItem[]
  doing: QueueItem[]
  unowned: QueueItem[]
  /** 열린 결정 안건(결론을 적어야 닫힌다). 다른 대기열과 겹치지 않는다 */
  decisions: QueueItem[]
  total: number
}

const byDueThenP = (a: QueueItem, b: QueueItem) =>
  (a.task.due ?? '9999').localeCompare(b.task.due ?? '9999') || (a.task.p ?? 9) - (b.task.p ?? 9) || a.task.title.localeCompare(b.task.title)

/** me: 내 이름들(비면 전체). 담당자 없는 일은 누구에게나 보인다(배정해야 하므로) */
export function buildQueues(work: WorkIndex, today: string, me: string[] = []): Queues {
  const mine = (t: Task) => !me.length || t.owner.length === 0 || t.owner.some((o) => me.some((m) => o.toLowerCase().includes(m.toLowerCase())))
  const open = work.tasks.filter((t) => !t.done && t.state !== 'dropped' && mine(t))
  const weekEnd = addDaysYmd(today, 7)
  const q: Queues = { overdue: [], today: [], week: [], waiting: [], doing: [], unowned: [], decisions: [], total: 0 }
  for (const t of open) {
    if (t.kind === 'decision') {
      q.decisions.push({ task: t, reason: 'decision', days: t.due ? diffDays(today, t.due) : undefined }) // days>0: 다시 확인할 날이 지남
      continue
    }
    if (t.state === 'waiting' || t.side === 'other') {
      q.waiting.push({ task: t, reason: 'waiting', days: t.due ? diffDays(today, t.due) : undefined })
      continue // 상대 차례는 내 기한 초과와 섞지 않는다
    }
    if (t.due && t.due < today) q.overdue.push({ task: t, reason: 'overdue', days: diffDays(today, t.due) })
    else if (t.due === today) q.today.push({ task: t, reason: 'today' })
    else if (t.due && t.due <= weekEnd) q.week.push({ task: t, reason: 'week', days: diffDays(t.due, today) })
    else if (t.state === 'doing') q.doing.push({ task: t, reason: 'doing' })
    if (t.owner.length === 0 && (t.due || t.project)) q.unowned.push({ task: t, reason: 'unowned' })
  }
  for (const k of ['overdue', 'today', 'week', 'waiting', 'doing', 'unowned', 'decisions'] as const) q[k].sort(byDueThenP)
  q.total = q.overdue.length + q.today.length + q.week.length + q.waiting.length + q.decisions.length
  return q
}

/** 설정의 내 이름("홍길동, 길동")을 목록으로 */
export const parseMe = (s: string | undefined): string[] => (s ?? '').split(/[,，]/).map((x) => x.trim()).filter(Boolean)

// ── 한 줄 편집 (순수 함수: 저장소를 건드리지 않는다. 쓰는 일은 workOps.ts) ──
export interface TaskEdit {
  title: string
  done: boolean
  tokens: WorkTokens
}

const LINE = /^(\s*[-*+]\s+)\[([ xX])\]\s+(.*)$/
const SCHEDULE_TAIL = [
  /(?:^|\s)(@\d{4}-\d{2}-\d{2})(?=\s|$)/,
  /(?:^|\s)(end:\d{4}-\d{2}-\d{2})(?=\s|$)/,
  /(?:^|\s)(repeat:\S+)(?=\s|$)/,
  /(?:^|\s)(until:\d{4}-\d{2}-\d{2})(?=\s|$)/,
]

/** 줄의 제목(업무·일정 꼬리표를 걷어 낸 글). 체크리스트 줄이 아니면 null */
export function titleOfLine(line: string): string | null {
  const m = LINE.exec(line)
  if (!m) return null
  let body = splitWorkTokens(m[3]).rest
  body = body.replace(/^\d{1,2}:\d{2}(?:\s*[-–~]\s*\d{1,2}:\d{2})?\s+/, '')
  for (const re of SCHEDULE_TAIL) body = body.replace(re, ' ')
  return body.replace(/\s+/g, ' ').trim()
}

/** 업무가 있는 줄 번호. 줄 번호가 밀렸으면(다른 사람이 위에 줄을 추가했을 때 등) 같은 제목을 찾는다. 없으면 -1 */
export function findTaskLine(content: string, task: { line: number; title: string }): number {
  const lines = content.split('\n')
  if (lines[task.line] !== undefined && titleOfLine(lines[task.line]) === task.title) return task.line
  return lines.findIndex((l) => titleOfLine(l) === task.title)
}

/**
 * 한 줄을 편집 내용으로 다시 쓴다. 들여쓰기·불릿, 일정 꼬리표(시간·@날짜·end·repeat·until)와
 * 모르는 status:/side: 값은 그대로 보존하고, 제목과 업무 꼬리표만 바꾼다. 체크리스트 줄이 아니면 null.
 */
export function rewriteTaskLine(line: string, edit: TaskEdit): string | null {
  const m = LINE.exec(line)
  if (!m) return null
  let body = splitWorkTokens(m[3]).rest
  let time = ''
  const tm = /^(\d{1,2}:\d{2}(?:\s*[-–~]\s*\d{1,2}:\d{2})?)\s+/.exec(body)
  if (tm) {
    time = tm[1]
    body = body.slice(tm[0].length)
  }
  const keep: string[] = []
  for (const re of SCHEDULE_TAIL) {
    const x = re.exec(body)
    if (x) {
      keep.push(x[1])
      body = body.replace(x[0], ' ')
    }
  }
  for (const x of body.matchAll(/(?:^|\s)((?:status|side|kind):\S+)/g)) keep.push(x[1]) // 모르는 값은 지우지 않는다
  const title = edit.title.replace(/\s+/g, ' ').trim()
  const parts = [time, title, ...keep, formatWorkTokens(edit.tokens)].filter(Boolean)
  return `${m[1]}[${edit.done ? 'x' : ' '}] ${parts.join(' ')}`
}

/** 화면에서 고르는 상태: 상대 차례(status:waiting 또는 side:other)는 '대기' 하나로 보여 준다 */
export type UiState = 'todo' | 'doing' | 'waiting' | 'dropped'
export const uiStateOf = (t: Pick<Task, 'state' | 'side'>): UiState => (t.state === 'waiting' || t.side === 'other' ? 'waiting' : t.state)
export const tokensForState = (ui: UiState, base: WorkTokens): WorkTokens => {
  const { status: _s, side: _d, ...rest } = base
  void _s
  void _d
  if (ui === 'doing') return { ...rest, status: 'doing' }
  if (ui === 'waiting') return { ...rest, status: 'waiting', side: 'other' }
  if (ui === 'dropped') return { ...rest, status: 'dropped' }
  return rest
}
