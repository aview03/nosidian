// AI 쓰기 정책 판정(검증 엔진): AI 가 Nosidian 의 도구로 문서를 만들거나 고치거나 지우거나 옮기려 할 때 어떻게 다룰지 정한다.
//
// 원칙
//  - 순수 함수: 요청·현재 문서 상태·규칙을 받아 판정만 돌려준다. 파일을 고치지 않는다.
//  - 판정은 allow(바로 반영) · require_approval(승인 대기 — 허가가 아니다) · deny(거절) 셋뿐이다.
//  - 모든 쓰기를 본다: 생성·수정·삭제·이동·이름 바꾸기. 이동·이름 바꾸기는 출발지와 도착지를 모두 검사해 보호 경로를 우회할 수 없다.
//  - 보호 경로(_workspace/)가 가장 먼저다. 다른 정책·규칙 on/off 와 관계없이 AI 는 쓸 수 없다.
//  - 버전 검사: AI 가 읽은 문서의 해시(baseHash)가 지금 해시와 다르거나 없으면 거절한다.
//  - 기본값은 안전하게: 규칙이 없거나 꺼져 있거나 프로필을 못 읽으면 AI 의 **자동** 쓰기는 허용하지 않는다(승인 대기). 사람이 직접 하는 편집은 이 엔진과 무관하게 그대로다.
//  - 승인과 실행 분리: require_approval 은 "사람이 승인하면 반영할 수 있다"는 뜻일 뿐이다. 실제로 반영하기 직전에 resolveForApply 로 권한·버전을 다시 검증한다.
//
// 아직 어떤 AI(MCP·LLM)에도 연결되어 있지 않다. 나중에 그 도구들이 쓰기 전에 이 판정을 부른다.
import { isProtectedPath, profileFor, type DocRules, type Profile } from './docrules'
import { resolveRole } from './doclint'
import { parseNote } from './links'
import type { NoteFile } from './types'
import type { Project } from './work'

export type AiAction = 'create' | 'modify' | 'delete' | 'move'

export interface AiRequest {
  action: AiAction
  path: string
  /** move(이름 바꾸기 포함): 옮겨 갈 경로 */
  to?: string
  /** modify·delete·move: AI 가 읽었던 시점의 내용 해시(contentHash). 없거나 지금과 다르면 거절한다 */
  baseHash?: string
  /** create·modify: 쓰려는 전체 내용(create 는 역할을 role: 속성에서 읽는 데도 쓴다) */
  content?: string
}

export type Reason =
  | 'protected' // 규칙 파일 등 _workspace/ 는 AI 가 못 쓴다(이동·이름 바꾸기의 출발지·도착지 포함)
  | 'noRules' // 규칙이 없거나 꺼져 있음 → 자동 쓰기 불가
  | 'outside' // 규칙을 적용하는 프로젝트 밖 → 자동 쓰기 불가
  | 'noProfile' // 프로젝트가 가리키는 프로필을 읽지 못함 → 자동 쓰기 불가
  | 'readOnly' // ai_write: read
  | 'noBase' // 읽은 시점의 해시가 없음
  | 'stale' // 읽은 뒤 문서가 바뀜
  | 'exists' // 만들려는(옮겨 갈) 자리에 이미 문서가 있음
  | 'missing' // 고치려는 문서가 없음
  | 'singletonExists' // 하나뿐이어야 하는 역할의 문서가 이미 있음
  | 'newFileDenied' // ai_new_file: deny
  | 'notInTemplate' // ai_new_file: template-only 인데 등록된 역할 파일이 아님
  | 'newFileApprove' // 새 문서는 승인 필요
  | 'officialApprove' // 공식 문서 변경은 승인 필요
  | 'officialDelete' // 공식 문서는 AI 가 지울 수 없음
  | 'officialMove' // 공식 문서는 AI 가 옮기거나 이름을 바꿀 수 없음
  | 'leavesProject' // 다른 프로젝트·적용 범위 밖으로 옮김
  | 'planApprove' // 문서 점검 "AI로 고치기" 계획 실행으로 낸 변경: 정책이 허용하더라도 사람의 최종 승인을 받는다
  | 'ok'

export interface Verdict {
  decision: 'allow' | 'require_approval' | 'deny'
  reason: Reason
  /** allow + delete: 실제로 지우지 않고 _보관/ 으로 옮기라는 뜻 */
  effect?: 'archive'
  /** 이유에 곁들일 값(역할 이름, 이미 있는 문서 경로 등) */
  text?: string
}

const out = (decision: Verdict['decision'], reason: Reason, extra: Pick<Verdict, 'effect' | 'text'> = {}): Verdict => ({ decision, reason, ...extra })

/** 내용 해시(FNV-1a 32비트 + 길이). AI 도구가 문서를 읽어 줄 때 함께 주고, 쓸 때 돌려받아 비교한다 */
export function contentHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length
}

/** 경로가 속한 프로젝트(가장 깊은 폴더). 프로젝트 노트 자신도 포함 */
export function projectOf(projects: Project[], path: string): Project | null {
  let best: Project | null = null
  for (const p of projects) {
    const inside = p.path === path || (p.folder !== '' && path.startsWith(p.folder + '/'))
    if (inside && (!best || p.folder.length > best.folder.length)) best = p
  }
  return best
}

const roleAttr = (path: string, content: string): string => {
  const r = parseNote(path, content).fm.role
  return typeof r === 'string' ? r.trim() : ''
}

interface Ctx {
  rules: DocRules
  projects: Project[]
  files: Record<string, NoteFile>
}

/** 경로 하나가 놓이는 곳: 프로젝트·프로필·역할(충돌·위치 불일치면 역할 없음 = 공식으로 인정하지 않음) */
function place(c: Ctx, path: string, content: string) {
  const project = projectOf(c.projects, path)
  const profile: Profile | null = project ? profileFor(c.rules, project.fm) : null
  if (!project || !profile) return { project, profile: null as Profile | null, role: undefined, rel: path }
  const rel = project.folder ? path.slice(project.folder.length + 1) : path
  return { project, profile, role: resolveRole(profile, rel, roleAttr(path, content)).role, rel }
}

/** 같은 프로젝트 안에서 이 역할로 인정되는 다른 문서(하나뿐이어야 하는 역할의 중복 확인용) */
function sameRoleDoc(c: Ctx, project: Project, profile: Profile, role: NonNullable<ReturnType<typeof place>['role']>, except: string[]): string | undefined {
  for (const f of Object.values(c.files)) {
    if (f.deleted || except.includes(f.path)) continue
    if (!(f.path === project.path || (project.folder !== '' && f.path.startsWith(project.folder + '/')))) continue
    const rel = project.folder ? f.path.slice(project.folder.length + 1) : f.path
    if (resolveRole(profile, rel, roleAttr(f.path, f.content)).role === role) return f.path
  }
  return undefined
}

export function checkAiWrite(req: AiRequest, rules: DocRules, projects: Project[], files: Record<string, NoteFile>): Verdict {
  const c: Ctx = { rules, projects, files }
  const paths = req.action === 'move' ? [req.path, req.to ?? ''] : [req.path]

  // 1) 보호 경로가 가장 먼저: 이동·이름 바꾸기는 출발지·도착지 모두. 다른 어떤 정책·규칙 on/off 와도 관계없다
  if (paths.some((p) => !p || isProtectedPath(p))) return out('deny', 'protected')
  if (req.action === 'move' && (!req.to || req.to === req.path)) return out('deny', 'exists')

  // 2) 규칙이 없거나 꺼져 있으면 AI 의 자동 쓰기는 허용하지 않는다(승인 대기). 사람 편집에는 영향이 없다
  if (!rules.enabled) return out('require_approval', 'noRules')
  // AI 쓰기 전체의 상한
  if (rules.aiWrite === 'read') return out('deny', 'readOnly')

  const cur = files[req.path]
  const exists = !!cur && !cur.deleted
  if (req.action === 'create') {
    if (exists) return out('deny', 'exists')
  } else if (!exists) {
    return out('deny', 'missing')
  } else {
    // 3) 버전 검사: 읽은 뒤 사람이 고쳤거나, 읽은 기록이 없으면 거절
    if (req.baseHash === undefined) return out('deny', 'noBase')
    if (req.baseHash !== contentHash(cur.content)) return out('deny', 'stale')
  }

  const here = place(c, req.path, req.action === 'create' ? req.content ?? '' : cur.content)
  if (!here.project) return out('require_approval', 'outside')
  if (!here.profile) {
    // 적용하지 않는 프로젝트(opt-in 인데 docs: 없음, docs: off)는 범위 밖, 적용하려는데 프로필을 못 읽으면 noProfile
    const d = here.project.fm.docs
    const off = ['off', 'false', 'no'].includes(String(d ?? '').trim().toLowerCase())
    const wants = !off && ((d !== undefined && d !== null && d !== '') || rules.apply === 'all-projects')
    return out('require_approval', wants ? 'noProfile' : 'outside')
  }
  const official = !!here.role?.official

  if (req.action === 'delete') return official ? out('deny', 'officialDelete', { text: here.role!.name }) : out('allow', 'ok', { effect: 'archive' })

  if (req.action === 'modify') return official && rules.aiWrite === 'propose' ? out('require_approval', 'officialApprove', { text: here.role!.name }) : out('allow', 'ok')

  if (req.action === 'move') {
    if (official) return out('deny', 'officialMove', { text: here.role!.name })
    const to = req.to!
    if (files[to] && !files[to].deleted) return out('deny', 'exists')
    // 도착지: 다른 프로젝트·적용 범위 밖이면 자동으로 옮기지 않는다
    const dest = place(c, to, cur.content)
    if (!dest.project || !dest.profile || dest.project.path !== here.project.path) return out('require_approval', 'leavesProject')
    if (dest.role?.singleton) {
      const dup = sameRoleDoc(c, dest.project, dest.profile, dest.role, [req.path, to])
      if (dup) return out('deny', 'singletonExists', { text: dup })
    }
    // 옮겨 가는 자리가 공식 역할(이름·role:)이면 새 공식 문서를 만드는 것과 같다
    if (dest.role?.official) return rules.aiWrite === 'propose' ? out('require_approval', 'officialApprove', { text: dest.role.name }) : out('allow', 'ok')
    return out('allow', 'ok')
  }

  // create
  if (here.role?.singleton) {
    const dup = sameRoleDoc(c, here.project, here.profile, here.role, [req.path])
    if (dup) return out('deny', 'singletonExists', { text: dup })
  }
  if (rules.aiNewFile === 'deny') return out('deny', 'newFileDenied')
  if (rules.aiNewFile === 'approve') return out('require_approval', 'newFileApprove')
  // template-only: 프로필에 등록된 이름의 파일만
  const rel = here.rel.toLowerCase()
  if (!here.profile.roles.some((r) => r.file && r.file.toLowerCase() === rel)) return out('deny', 'notInTemplate')
  return official && rules.aiWrite === 'propose' ? out('require_approval', 'officialApprove', { text: here.role!.name }) : out('allow', 'ok')
}

export type ApplyResult = { ok: true; verdict: Verdict } | { ok: false; why: 'denied' | 'pending'; verdict: Verdict }

/**
 * 승인된(또는 승인이 필요 없는) 쓰기를 실제로 반영하기 직전의 재검증.
 * 승인이 난 뒤 규칙이 바뀌었거나 사람이 문서를 고쳤을 수 있으므로 판정을 처음부터 다시 한다.
 *  - deny → 승인과 상관없이 거절 · require_approval → approved 일 때만 통과 · allow → 통과
 */
export function resolveForApply(req: AiRequest, approved: boolean, rules: DocRules, projects: Project[], files: Record<string, NoteFile>): ApplyResult {
  const verdict = checkAiWrite(req, rules, projects, files)
  if (verdict.decision === 'deny') return { ok: false, why: 'denied', verdict }
  if (verdict.decision === 'require_approval' && !approved) return { ok: false, why: 'pending', verdict }
  return { ok: true, verdict }
}
