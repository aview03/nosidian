// 문서 규칙: 프로젝트 문서의 "역할"(개요·정책·할 일 …)과 지켜야 할 구조를 사람이 읽는 노트로 정의한다.
//
// 원칙
//  - 규칙은 일반 Markdown 노트(_workspace/문서규칙.md)에 둔다. 별도 DB·전용 형식 없음. 팀이 같이 쓰고 노트와 함께 동기화된다.
//  - 기본은 꺼짐: 파일이 없거나 `rules: off` 이면 앱은 지금과 똑같이 동작한다.
//  - 이 규칙은 "점검"에 쓰인다. 사람의 편집·동기화로 들어온 문서는 저장을 막거나 고치지 않는다(경고만).
//  - AI 쓰기 정책(ai_write / ai_new_file)은 여기서 해석만 한다. 실제로 막는 쪽(MCP·LLM 연동)은 아직 없고, 나중에 같은 값을 읽는다.
//  - 규칙 파일 자체는 AI 가 고칠 수 없다(isProtectedPath). 자기 행동을 제한하는 규칙을 스스로 풀지 못하게 하기 위해서다.
//
// 줄 형식은 보기.md 와 같다: `- 이름 :: key=값; key=값; 플래그`
import { splitFrontmatter } from './links'
import { getLang } from './i18n'
import type { NoteFile } from './types'

export const DOCRULES_PATH = '_workspace/문서규칙.md'
/** AI 가 읽을 수는 있어도 고치거나 지울 수 없는 경로 */
export const isProtectedPath = (p: string) => p === DOCRULES_PATH || p.startsWith('_workspace/')

export type AiWrite = 'read' | 'propose' | 'direct'
export type AiNewFile = 'approve' | 'template-only' | 'deny'
export type Apply = 'opt-in' | 'all-projects'

export interface Role {
  name: string
  /** 프로젝트 폴더 기준 상대 경로(대소문자 무시). 있으면 이 이름·위치의 문서가 이 역할 */
  file?: string
  /** 프로젝트 폴더 기준 폴더. 이 아래의 문서가 이 역할(보조 문서용) */
  dir?: string
  /** 공식 문서인가(아니면 보조) */
  official: boolean
  /** 프로젝트에 하나만 있어야 하는가 */
  singleton: boolean
  /** 진입 문서: 여기서 링크를 따라 닿을 수 있어야 하는 출발점 */
  entry: boolean
  /** 이 역할의 문서가 꼭 있어야 하는가(없으면 점검에 알린다). 기본은 아니다 */
  must: boolean
  /** 필수 제목 */
  required: string[]
  /** 해석만 하고 아직 점검하지 않는다(변경 전후 비교가 필요해서) */
  appendOnly: boolean
}

export interface Profile {
  name: string
  roles: Role[]
}

export interface DocRules {
  /** 규칙 파일이 있고 rules: on 인가 */
  enabled: boolean
  /** 파일이 있는가(꺼져 있어도) */
  present: boolean
  apply: Apply
  aiWrite: AiWrite
  aiNewFile: AiNewFile
  profiles: Profile[]
  /** 유효한 status 값. 비어 있으면 값을 검사하지 않는다 */
  statuses: string[]
  /** 중복 후보에서 뺄 쌍(경로 두 개) */
  ignorePairs: [string, string][]
  /** 해석하지 못한 줄(1부터) */
  problems: { line: number; text: string }[]
}

export const DEFAULT_PROFILE = '기본'

const truthy = (v: unknown) => v === true || ['on', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase())
const pick = <T extends string>(v: unknown, all: readonly T[], dflt: T): T => {
  const s = String(v ?? '').trim().toLowerCase()
  return (all as readonly string[]).includes(s) ? (s as T) : dflt
}
const stripComment = (s: string) => s.replace(/\s+#\s.*$/, '').replace(/\s+#$/, '').trim()
const norm = (s: string) => s.trim().replace(/\\/g, '/').replace(/^\.\//, '')
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

/** 역할 한 줄: `이름 :: file=README.md; official; required=목적,범위` */
export function parseRoleLine(line: string): Role | null {
  const text = line.replace(/^\s*[-*]\s+/, '')
  const i = text.indexOf(' :: ')
  if (i < 0) return null
  const name = text.slice(0, i).trim()
  if (!name) return null
  const role: Role = { name, official: false, singleton: false, entry: false, must: false, required: [], appendOnly: false }
  let aux = false
  for (const part of text.slice(i + 4).split(';')) {
    const p = part.trim()
    if (!p) continue
    const eq = p.indexOf('=')
    const key = (eq < 0 ? p : p.slice(0, eq)).trim().toLowerCase()
    const val = eq < 0 ? '' : p.slice(eq + 1).trim()
    switch (key) {
      case 'file': if (val) role.file = norm(val); break
      case 'dir': if (val) role.dir = norm(val).replace(/\/+$/, ''); break
      case 'official': role.official = true; break
      case 'aux': aux = true; break
      case 'singleton': role.singleton = true; break
      case 'entry': role.entry = true; break
      case 'must': role.must = true; break
      case 'append-only': role.appendOnly = true; break
      case 'required': role.required = list(val); break
      default: break // 모르는 키는 무시한다(앞으로 키가 늘어도 이전 버전이 깨지지 않게)
    }
  }
  if (aux) role.official = false
  return role
}

export function formatRoleLine(r: Role): string {
  const parts: string[] = []
  if (r.file) parts.push(`file=${r.file}`)
  if (r.dir) parts.push(`dir=${r.dir}/`)
  parts.push(r.official ? 'official' : 'aux')
  if (r.singleton) parts.push('singleton')
  if (r.entry) parts.push('entry')
  if (r.must) parts.push('must')
  if (r.appendOnly) parts.push('append-only')
  if (r.required.length) parts.push(`required=${r.required.join(',')}`)
  return `- ${r.name} :: ${parts.join('; ')}`
}

const EMPTY: DocRules = { enabled: false, present: false, apply: 'opt-in', aiWrite: 'propose', aiNewFile: 'approve', profiles: [], statuses: [], ignorePairs: [], problems: [] }

/** 규칙 노트를 읽는다. 없거나 잘못되면 "꺼짐" */
export function readRules(files: Record<string, NoteFile>): DocRules {
  const f = files[DOCRULES_PATH]
  if (!f || f.deleted) return { ...EMPTY, profiles: [], statuses: [], ignorePairs: [], problems: [] }
  return parseRules(f.content)
}

export function parseRules(content: string): DocRules {
  const { fm, body, lines: fmLines } = splitFrontmatter(content)
  const out: DocRules = {
    enabled: truthy(fm.rules),
    present: true,
    apply: pick(fm.apply, ['opt-in', 'all-projects'] as const, 'opt-in'),
    aiWrite: pick(fm.ai_write, ['read', 'propose', 'direct'] as const, 'propose'),
    aiNewFile: pick(fm.ai_new_file, ['approve', 'template-only', 'deny'] as const, 'approve'),
    profiles: [],
    statuses: [],
    ignorePairs: [],
    problems: [],
  }
  let section: 'none' | 'profile' | 'status' | 'ignore' | 'other' = 'none'
  let profile: Profile | null = null
  body.split('\n').forEach((raw, i) => {
    const lineNo = fmLines + i + 1
    const line = raw.replace(/\r$/, '')
    const h = /^##\s+(.+?)\s*$/.exec(line)
    if (h) {
      const title = h[1]
      const pm = /^(?:프로필|profile)\s*[:：]\s*(.+)$/i.exec(title)
      if (pm) {
        section = 'profile'
        profile = { name: pm[1].trim(), roles: [] }
        out.profiles.push(profile)
      } else if (/^(상태|status)$/i.test(title)) { section = 'status'; profile = null }
      else if (/^(무시|ignore)$/i.test(title)) { section = 'ignore'; profile = null }
      else { section = 'other'; profile = null }
      return
    }
    if (/^#\s/.test(line)) { section = 'none'; profile = null; return }
    const text = stripComment(line.replace(/^\s*[-*]\s+/, ''))
    if (!text || /^<!--/.test(text)) return
    if (section === 'profile' && profile) {
      if (!/^\s*[-*]\s+/.test(line)) return // 설명 문장은 무시
      const r = parseRoleLine(text)
      if (r) profile.roles.push(r)
      else out.problems.push({ line: lineNo, text })
    } else if (section === 'status') {
      out.statuses.push(...list(text))
    } else if (section === 'ignore') {
      const m = /^(.+?)\s*<>\s*(.+)$/.exec(text)
      if (m) out.ignorePairs.push([norm(m[1]), norm(m[2])])
      else out.problems.push({ line: lineNo, text })
    }
  })
  return out
}

/** 이 프로젝트에 적용되는 프로필(없으면 null = 점검하지 않음). docs: 속성 > apply 규칙 */
export function profileFor(rules: DocRules, projectFm: Record<string, unknown>): Profile | null {
  if (!rules.enabled) return null
  const d = projectFm.docs
  const off = d === false || ['off', 'false', 'no'].includes(String(d ?? '').trim().toLowerCase())
  if (off) return null
  let name: string | null = null
  if (typeof d === 'string' && d.trim() && !truthy(d)) name = d.trim()
  else if (d !== undefined && d !== null && d !== '') name = DEFAULT_PROFILE // docs: on / true
  else if (rules.apply === 'all-projects') name = DEFAULT_PROFILE
  if (!name) return null
  return rules.profiles.find((p) => p.name.toLowerCase() === name!.toLowerCase()) ?? null
}

/** 처음 만드는 규칙 노트(설명 포함). 기본 프로필은 앱의 프로젝트 템플릿이 만드는 파일 이름을 따른다 */
export function rulesNoteTemplate(): string {
  const ko = getLang() === 'ko'
  const [overview, tasks, minutes] = ko ? ['프로젝트 개요.md', '할 일.md', '회의록.md'] : ['Project Overview.md', 'Tasks.md', 'Meeting Notes.md']
  return `---
rules: on
apply: opt-in
ai_write: propose
ai_new_file: approve
---
# 문서 규칙

프로젝트 문서의 역할과 구조를 정해 두는 노트예요. 아래 줄을 앱이 읽고, 직접 고쳐도 돼요. 이 규칙은 **점검**에만 쓰이고, 노트를 막거나 자동으로 고치지 않아요.

- 적용: 프로젝트 노트의 속성에 \`docs: 기본\` 을 적으면 그 프로젝트에 적용돼요(\`docs: off\` 는 끄기). \`apply: all-projects\` 로 바꾸면 모든 프로젝트에 적용돼요.
- 문서의 역할은 이름(\`file=\`)이나 노트 속성 \`role: 정책\` 으로 정해요. 둘이 서로 다르면 역할을 정하지 않고 점검에 표시해요.
- 역할 줄의 플래그: \`official\`(공식 문서) · \`aux\`(보조) · \`singleton\`(하나만) · \`entry\`(여기서 링크를 따라 닿아야 하는 시작 문서) · \`must\`(꼭 있어야 함) · \`required=제목,제목\`(필수 제목).
- \`ai_write\` · \`ai_new_file\` 은 앞으로 AI 가 문서를 쓸 때 지킬 정책이에요(read / propose / direct, approve / template-only / deny). 이 파일은 AI 가 고칠 수 없어요.

## 프로필: ${DEFAULT_PROFILE}
- 개요 :: file=${overview}; official; entry; singleton
- 할 일 :: file=${tasks}; official; singleton
- 회의록 :: file=${minutes}; official
- 보조 :: dir=보조/; aux

## 상태
draft, review, final, archived

## 무시

## 예시 (적용되지 않아요. 개발 프로젝트라면 이런 식으로 프로필을 만들어 보세요)
- 개요 :: file=README.md; official; entry; must; required=목적,현재 상태
- 정책 :: file=SPEC.md; official; singleton
- 결정 :: file=DECISIONS.md; official; singleton
`
}

/** 노트 맨 위 속성(프론트매터)의 한 키를 바꾼다. value 가 null 이면 지운다. 다른 줄은 그대로 둔다 */
export function setFmKey(content: string, key: string, value: string | null): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const keyRe = new RegExp(`^${key}\\s*:.*$`, 'm')
  if (!m) {
    if (value === null) return content
    return `---${eol}${key}: ${value}${eol}---${eol}${content}`
  }
  let fm = m[1]
  if (keyRe.test(fm)) fm = value === null ? fm.replace(new RegExp(`^${key}\\s*:.*(\\r?\\n)?`, 'm'), '').replace(/\r?\n$/, '') : fm.replace(keyRe, `${key}: ${value}`)
  else if (value !== null) fm = fm.length ? `${fm}${eol}${key}: ${value}` : `${key}: ${value}`
  const rest = content.slice(m[0].length)
  return `---${eol}${fm}${eol}---${eol}${rest}`
}
