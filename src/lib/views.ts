// 저장된 보기(필터): 조건을 골라 이름을 붙여 두고 내 업무에서 한 번에 불러온다.
//
// 팀이 함께 쓰는 값이므로 기기 설정이 아니라 vault 안의 노트(_workspace/보기.md)에 사람이 읽는 줄로 저장한다:
//   - 이번 주 민수 일 :: owner=민수; due=week
//   - 대기만 :: status=waiting
//   - 행사 준비의 결정 :: project=행사 준비; status=decision
// 직접 고쳐도 되고(줄 하나가 보기 하나), 앱의 보기 편집기로 만들고 고치고 지워도 같은 줄이 된다.
import { addDaysYmd, uiStateOf, type Task, type WorkIndex } from './work'
import type { NoteFile } from './types'

export const VIEWS_PATH = '_workspace/보기.md'

export type ViewStatus = 'todo' | 'doing' | 'waiting' | 'decision'
export type ViewDue = 'overdue' | 'today' | 'week' | 'none'

export interface View {
  name: string
  /** 담당자 이름(부분 일치). 'me' = 설정의 내 이름, 'none' = 담당자 없음 */
  owner?: string
  /** 프로젝트 이름. 'none' = 프로젝트 없음 */
  project?: string
  status?: ViewStatus
  due?: ViewDue
  /** 제목에 들어 있는 글 */
  q?: string
}

const STATUSES: ViewStatus[] = ['todo', 'doing', 'waiting', 'decision']
const DUES: ViewDue[] = ['overdue', 'today', 'week', 'none']
const SEP = ' :: '

const clean = (s: string) => s.replace(/[;\n\r]/g, ',').replace(/\s+/g, ' ').trim()

export function formatView(v: View): string {
  const parts: string[] = []
  if (v.owner) parts.push(`owner=${clean(v.owner)}`)
  if (v.project) parts.push(`project=${clean(v.project)}`)
  if (v.status) parts.push(`status=${v.status}`)
  if (v.due) parts.push(`due=${v.due}`)
  if (v.q) parts.push(`q=${clean(v.q)}`)
  return `- ${clean(v.name).replace(/ :: /g, ' : ')}${SEP}${parts.join('; ')}`
}

export function parseViewLine(line: string): View | null {
  const m = /^\s*[-*+]\s+(.+?) :: (.*)$/.exec(line)
  if (!m) return null
  const view: View = { name: m[1].trim() }
  for (const part of m[2].split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const val = part.slice(i + 1).trim()
    if (!val) continue
    if (k === 'owner') view.owner = val
    else if (k === 'project') view.project = val
    else if (k === 'q') view.q = val
    else if (k === 'status' && (STATUSES as string[]).includes(val)) view.status = val as ViewStatus
    else if (k === 'due' && (DUES as string[]).includes(val)) view.due = val as ViewDue
  }
  return view.name ? view : null
}

/** 보기 노트에서 보기 목록을 읽는다 (없으면 빈 목록) */
export function readViews(files: Record<string, NoteFile>): View[] {
  const f = files[VIEWS_PATH]
  if (!f || f.deleted) return []
  const out: View[] = []
  for (const line of f.content.split('\n')) {
    const v = parseViewLine(line)
    if (v) out.push(v)
  }
  return out
}

export const viewsNoteHeader = () =>
  `# 저장된 보기\n\n내 업무의 "보기"에 나오는 필터입니다. 한 줄이 하나의 보기예요. 앱의 보기 편집기로 만들거나 직접 고쳐도 됩니다.\n\n형식: \`- 이름 :: owner=담당자; project=프로젝트; status=todo|doing|waiting|decision; due=overdue|today|week|none; q=제목에 들어갈 글\`\n(owner=me 는 설정의 "내 이름", owner=none·project=none 은 "없음")\n\n`

/** 노트 내용에 보기를 넣는다(같은 이름이 있으면 그 줄을 바꾸고, 없으면 끝에 추가). oldName 을 주면 이름을 바꾸는 편집이다 */
export function upsertView(content: string, v: View, oldName?: string): string {
  const lines = content.split('\n')
  const target = (oldName ?? v.name).toLowerCase()
  const idx = lines.findIndex((l) => parseViewLine(l)?.name.toLowerCase() === target)
  const line = formatView(v)
  if (idx >= 0) lines[idx] = line
  else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push(line, '')
  }
  return lines.join('\n')
}

export function removeView(content: string, name: string): string {
  const key = name.toLowerCase()
  return content.split('\n').filter((l) => parseViewLine(l)?.name.toLowerCase() !== key).join('\n')
}

/** 보기를 적용해 열린 업무를 고른다. me: 설정의 내 이름들 */
export function applyView(work: WorkIndex, v: View, today: string, me: string[] = []): Task[] {
  const projName = new Map(work.projects.map((p) => [p.path, p.name.toLowerCase()]))
  const weekEnd = addDaysYmd(today, 7)
  const q = v.q?.toLowerCase()
  const out = work.tasks.filter((t) => {
    if (t.done || t.state === 'dropped') return false
    if (v.owner === 'none') {
      if (t.owner.length) return false
    } else if (v.owner) {
      const names = v.owner === 'me' ? me : [v.owner]
      if (names.length && !t.owner.some((o) => names.some((n) => o.toLowerCase().includes(n.toLowerCase())))) return false
    }
    if (v.project === 'none') {
      if (t.project) return false
    } else if (v.project && (t.project ? projName.get(t.project) : undefined) !== v.project.toLowerCase()) return false
    if (v.status) {
      const decision = t.kind === 'decision'
      if (v.status === 'decision') {
        if (!decision) return false
      } else if (decision || uiStateOf(t) !== v.status) return false
    }
    if (v.due === 'overdue' && !(t.due && t.due < today)) return false
    if (v.due === 'today' && t.due !== today) return false
    if (v.due === 'week' && !(t.due && t.due >= today && t.due <= weekEnd)) return false
    if (v.due === 'none' && t.due) return false
    if (q && !t.title.toLowerCase().includes(q)) return false
    return true
  })
  return out.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.p ?? 9) - (b.p ?? 9) || a.title.localeCompare(b.title))
}

/** 보기 조건을 사람이 읽는 말로 (화면 요약용 조각들) */
export const isEmptyView = (v: View) => !v.owner && !v.project && !v.status && !v.due && !v.q
