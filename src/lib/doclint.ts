// 문서 점검: 프로젝트 문서가 문서 규칙(docrules.ts)에 얼마나 맞는지 노트에서 매번 계산한다. 저장하지 않는다.
//
// 원칙
//  - 점검은 "알려 주기"만 한다. 노트를 고치거나 저장을 막지 않는다(사람의 편집·동기화 문서 모두).
//  - 중복은 단정하지 않고 "후보 + 근거"만 낸다. 의미가 같고 글자가 다른 중복은 LLM 없이는 못 찾는다.
//  - 역할이 서로 충돌하거나 위치가 어긋나면 역할을 확정하지 않고 그대로 표시한다(role: 속성으로 공식 문서를 사칭하지 못하게).
//  - 메시지 문장은 화면(UI)에서 만든다. 여기서는 종류(kind)와 대상·값만 돌려준다.
import { baseName, dirName, parseNote, slugAnchor, type LinkIndex } from './links'
import type { Role, DocRules, Profile } from './docrules'
import { isTemplatePath } from './templatePaths'
import type { NoteFile } from './types'
import type { Project } from './work'

export type LintKind =
  | 'unknownRole' // role: 가 프로필에 없는 이름
  | 'roleConflict' // 파일 이름이 가리키는 역할과 role: 가 다름
  | 'roleMisplaced' // 공식 역할인데 정해진 자리(file=)나 보조 폴더 밖/안이 아님
  | 'singletonDup' // 하나뿐이어야 하는 역할이 둘 이상
  | 'missingDoc' // must 로 지정한 역할의 문서(file=)가 아직 없음
  | 'missingSection' // 필수 제목이 없음
  | 'emptySection' // 필수 제목은 있는데 내용이 비어 있음
  | 'badStatus' // status 가 허용 값이 아님
  | 'noStatus' // 공식 문서에 status 가 없음
  | 'brokenLink' // 가리키는 노트가 없음
  | 'brokenAnchor' // 노트는 있는데 그 제목(#앵커)이 없음
  | 'orphan' // 다른 어떤 노트에서도 링크되지 않음
  | 'unreachable' // 진입 문서에서 링크를 따라 닿을 수 없음
  | 'duplicate' // 겹칠 수 있는 문서(후보)

export interface LintItem {
  kind: LintKind
  severity: 'warn' | 'info'
  /** 대상 노트 */
  path: string
  /** 같이 보여 줄 다른 노트(중복 후보의 짝, 하나뿐이어야 하는 역할의 나머지 등) */
  others?: string[]
  /** 역할·제목·링크 대상·status 값 등 종류별 값 */
  text?: string
  /** 두 번째 값(충돌하는 역할 등) */
  text2?: string
  /** 중복 후보의 근거: stem(이름 꼬리 제외 같음) · headings(제목 구성 겹침) · body(본문 유사) */
  reasons?: ('stem' | 'headings' | 'body')[]
}

export interface DocInfo {
  path: string
  /** 프로젝트 폴더 기준 상대 경로 */
  rel: string
  /** 확정된 역할(충돌·어긋남이면 없음) */
  role?: Role
  status?: string
  archived: boolean
}

export interface LintReport {
  profile: string
  docs: DocInfo[]
  items: LintItem[]
  /** 역할이 없는 문서(오류가 아니다. 규칙 밖의 일반 문서) */
  unclassified: string[]
}

/** 중복 후보 판정 기준(초기 실험값). 실제 노트로 돌려 보며 조정한다 */
export const DUP = { headings: 0.7, body: 0.6, minChars: 200, shingle: 5 }

const lc = (s: string) => s.toLowerCase()
const compact = (s: string) => lc(s).replace(/\s+/g, '')
const ARCHIVE_DIR = /(^|\/)_보관(\/|$)/

const TAIL = /[\s._-]*(?:v\d+|ver\d*|finalfinal|final|revised|최종본|최종|수정본|수정|복사본|사본|copy|new|old|draft|초안|\(\d+\)|\d+)$/i
/** 이름에서 v2·final·최종·복사본·숫자 같은 꼬리를 뗀 뿌리. 너무 짧으면 비교하지 않는다 */
export function stemOf(name: string): string {
  let s = lc(name).trim()
  for (let i = 0; i < 6; i++) {
    const n = s.replace(TAIL, '')
    if (n === s) break
    s = n
  }
  return s.length >= 2 ? s : ''
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

function shingles(text: string, n: number): Set<string> {
  const words = lc(text).match(/[\p{L}\p{N}]+/gu) ?? []
  const out = new Set<string>()
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '))
  return out
}

/** 프로젝트 문서 목록: 프로젝트 폴더 아래 노트(템플릿·보관함 제외). 폴더가 없으면 프로젝트 노트 하나 */
export function projectDocs(project: Project, files: Record<string, NoteFile>): string[] {
  const out: string[] = []
  for (const f of Object.values(files)) {
    if (f.deleted || !/\.md$/i.test(f.path) || isTemplatePath(f.path) || ARCHIVE_DIR.test(f.path)) continue
    if (f.path === project.path || (project.folder !== '' && f.path.startsWith(project.folder + '/'))) out.push(f.path)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

export interface Resolved {
  role?: Role
  issue?: Pick<LintItem, 'kind' | 'text' | 'text2'>
}

/** 문서 하나의 역할을 정한다. 이름 규칙과 role: 가 어긋나면 정하지 않고 문제로 돌려준다 */
export function resolveRole(profile: Profile, rel: string, fmRole: string): Resolved {
  const relL = lc(rel)
  const byName = profile.roles.find((r) => r.file && lc(r.file) === relL)
  const byDir = [...profile.roles].filter((r) => r.dir && relL.startsWith(lc(r.dir) + '/')).sort((a, b) => b.dir!.length - a.dir!.length)[0]
  if (!fmRole) return { role: byName ?? byDir }
  const declared = profile.roles.find((r) => lc(r.name) === lc(fmRole))
  if (!declared) return { issue: { kind: 'unknownRole', text: fmRole } }
  if (byName && byName !== declared) return { issue: { kind: 'roleConflict', text: byName.name, text2: declared.name } }
  if (declared.official) {
    if (declared.file && lc(declared.file) !== relL) return { issue: { kind: 'roleMisplaced', text: declared.name, text2: declared.file } }
    if (byDir && !byDir.official) return { issue: { kind: 'roleMisplaced', text: declared.name, text2: byDir.dir } }
  }
  return { role: declared }
}

/** 제목 아래가 비어 있나: 다음 같은/상위 제목 전까지 글자가 하나도 없으면 비어 있다 */
function sectionEmpty(lines: string[], headings: { level: number; line: number }[], i: number): boolean {
  const h = headings[i]
  const next = headings.slice(i + 1).find((x) => x.level <= h.level)
  const end = next ? next.line : lines.length
  for (let k = h.line + 1; k < end; k++) if (lines[k]?.trim() && !/^<!--.*-->$/.test(lines[k].trim())) return false
  return true
}

export function lintProject(project: Project, files: Record<string, NoteFile>, rules: DocRules, profile: Profile, index: LinkIndex): LintReport {
  const items: LintItem[] = []
  const folderLen = project.folder ? project.folder.length + 1 : 0
  const paths = projectDocs(project, files)
  const docs: DocInfo[] = []
  const roleOf = new Map<string, Role>()
  const noteOf = (p: string) => index.notes.get(p) ?? parseNote(p, files[p].content)

  // 1) 역할
  for (const path of paths) {
    const note = noteOf(path)
    const rel = path.slice(folderLen)
    const fmRole = typeof note.fm.role === 'string' ? note.fm.role.trim() : ''
    const r = resolveRole(profile, rel, fmRole)
    const status = note.fm.status === undefined || note.fm.status === null ? undefined : String(note.fm.status)
    const archived = lc(status ?? '') === 'archived'
    if (r.issue) items.push({ kind: r.issue.kind, severity: 'warn', path, text: r.issue.text, text2: r.issue.text2 })
    if (r.role) roleOf.set(path, r.role)
    docs.push({ path, rel, role: r.role, status, archived })
  }
  const live = docs.filter((d) => !d.archived)

  // 하나뿐이어야 하는 역할이 둘 이상
  for (const role of profile.roles.filter((r) => r.singleton)) {
    const hit = live.filter((d) => d.role === role).map((d) => d.path)
    if (hit.length > 1) items.push({ kind: 'singletonDup', severity: 'warn', path: hit[0], others: hit.slice(1), text: role.name })
  }
  // must 로 지정한 문서가 아직 없음
  for (const role of profile.roles.filter((r) => r.must && r.file)) {
    if (!live.some((d) => d.role === role)) items.push({ kind: 'missingDoc', severity: 'info', path: project.path, text: role.name, text2: role.file })
  }

  // 2) 필수 제목·status (공식 문서만. 프로젝트 노트의 status 는 프로젝트 상태라서 검사하지 않는다)
  for (const d of live) {
    if (!d.role?.official) continue
    const note = noteOf(d.path)
    const lines = files[d.path].content.split('\n')
    for (const need of d.role.required) {
      const i = note.headings.findIndex((h) => compact(h.text) === compact(need))
      if (i < 0) items.push({ kind: 'missingSection', severity: 'warn', path: d.path, text: need, text2: d.role.name })
      else if (sectionEmpty(lines, note.headings, i)) items.push({ kind: 'emptySection', severity: 'warn', path: d.path, text: need, text2: d.role.name })
    }
    if (d.path !== project.path && rules.statuses.length) {
      if (d.status === undefined) items.push({ kind: 'noStatus', severity: 'info', path: d.path, text2: d.role.name })
      else if (!rules.statuses.some((s) => lc(s) === lc(d.status!))) items.push({ kind: 'badStatus', severity: 'warn', path: d.path, text: d.status })
    }
  }

  // 3) 끊어진 링크 · 앵커
  for (const d of live) {
    for (const target of index.unresolved.get(d.path) ?? []) items.push({ kind: 'brokenLink', severity: 'warn', path: d.path, text: target })
    const seen = new Set<string>()
    for (const l of noteOf(d.path).links) {
      if (!l.anchor || l.anchor.startsWith('^')) continue
      const to = index.resolve(l.target, d.path)
      if (!to) continue
      const target = index.notes.get(to)
      if (!target) continue
      const want = slugAnchor(l.anchor)
      const key = `${to}#${want}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!target.headings.some((h) => slugAnchor(h.text) === want)) items.push({ kind: 'brokenAnchor', severity: 'info', path: d.path, text: l.target, text2: l.anchor })
    }
  }

  // 4) 고아(들어오는 링크 없음) / 진입 문서에서 닿을 수 없음
  const inbound = (p: string) => (index.back.get(p) ?? []).filter((x) => x !== p).length
  const entries = new Set<string>([project.path, ...live.filter((d) => d.role?.entry).map((d) => d.path)])
  const reach = new Set<string>(entries)
  const queue = [...entries]
  while (queue.length) {
    const cur = queue.pop()!
    for (const nx of index.out.get(cur) ?? []) if (!reach.has(nx)) { reach.add(nx); queue.push(nx) }
  }
  for (const d of live) {
    if (entries.has(d.path)) continue
    const orphan = inbound(d.path) === 0
    if (orphan && !d.role?.official) items.push({ kind: 'orphan', severity: 'info', path: d.path })
    else if (!reach.has(d.path)) items.push({ kind: 'unreachable', severity: 'info', path: d.path }) // 링크는 받지만 진입 문서에서 닿지 않음(공식 문서는 링크가 없어도 여기서 잡는다)
  }

  // 5) 중복 후보: 같은 폴더 안에서 이름 뿌리·제목 구성이 겹치는 쌍만 본문을 비교한다(전체 쌍 비교를 피한다)
  const ignored = new Set(rules.ignorePairs.map(([a, b]) => pairKey(a, b)))
  const byDir = new Map<string, DocInfo[]>()
  for (const d of live) byDir.set(dirName(d.path), [...(byDir.get(dirName(d.path)) ?? []), d])
  const cache = new Map<string, { stem: string; heads: Set<string>; shingles?: Set<string>; text: string }>()
  const info = (d: DocInfo) => {
    let v = cache.get(d.path)
    if (!v) {
      const note = noteOf(d.path)
      v = { stem: stemOf(baseName(d.path)), heads: new Set(note.headings.map((h) => compact(h.text))), text: note.body }
      cache.set(d.path, v)
    }
    return v
  }
  for (const group of byDir.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (ignored.has(pairKey(a.rel, b.rel)) || ignored.has(pairKey(a.path, b.path))) continue
        if (a.role?.singleton && a.role === b.role) continue // 이미 '하나뿐이어야 하는 역할' 충돌로 표시됨
        const x = info(a)
        const y = info(b)
        const reasons: ('stem' | 'headings' | 'body')[] = []
        if (x.stem && x.stem === y.stem) reasons.push('stem')
        if (x.heads.size >= 2 && y.heads.size >= 2 && jaccard(x.heads, y.heads) >= DUP.headings) reasons.push('headings')
        if (reasons.length && x.text.length >= DUP.minChars && y.text.length >= DUP.minChars) {
          x.shingles ??= shingles(x.text, DUP.shingle)
          y.shingles ??= shingles(y.text, DUP.shingle)
          if (jaccard(x.shingles, y.shingles) >= DUP.body) reasons.push('body')
        }
        if (reasons.length >= 2) items.push({ kind: 'duplicate', severity: 'info', path: a.path, others: [b.path], reasons })
      }
    }
  }

  const unclassified = live.filter((d) => !d.role && d.path !== project.path && !items.some((it) => it.path === d.path && (it.kind === 'roleConflict' || it.kind === 'roleMisplaced' || it.kind === 'unknownRole'))).map((d) => d.path)
  const rank = { warn: 0, info: 1 }
  items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
  return { profile: profile.name, docs, items, unclassified }
}

function pairKey(a: string, b: string): string {
  const x = lc(a)
  const y = lc(b)
  return x < y ? `${x}\n${y}` : `${y}\n${x}`
}
