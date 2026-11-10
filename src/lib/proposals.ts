// AI 변경 제안: 정책 엔진(docpolicy)이 "승인 대기"로 돌린 쓰기를 사람이 검토하고 반영하는 흐름의 순수 부분.
//
// 흐름: AI 도구가 제안을 내면 → triage(정책 판정) → allow 면 바로 반영 계획, require_approval 이면 제안으로 보관, deny 면 거절.
//       사람이 승인하면 → resolveForApply 로 **반영 직전에 다시 검증**(문서가 그새 바뀌었는지, 규칙이 바뀌었는지) → 통과하면 계획대로 반영.
// 이 파일은 파일을 고치지 않는다. 반영은 "무엇을 할지(FileOp)"만 계산하고, 실제 쓰기는 proposalStore 가 한다.
import { contentHash, checkAiWrite, resolveForApply, type AiRequest, type ApplyResult, type Reason, type Verdict } from './docpolicy'
import type { DocRules } from './docrules'
import type { NoteFile } from './types'
import type { Project } from './work'

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed'

export interface Proposal {
  id: string
  createdAt: number
  /** 제안한 쪽(예: "Claude Code") */
  by: string
  /** 사람이 읽을 한 줄 설명(선택) */
  summary?: string
  /** 요청. create·modify 의 content 는 쓰려는 전체 내용 */
  req: AiRequest
  /** 승인이 필요했던 이유 */
  reason: Reason
  text?: string
  status: ProposalStatus
  /** 반영 못 했거나 거절된 이유 */
  failReason?: Reason
  decidedAt?: number
}

/** 실제로 할 쓰기 한 건 */
export type FileOp =
  | { op: 'create'; path: string; content: string }
  | { op: 'set'; path: string; content: string }
  | { op: 'delete'; path: string }
  | { op: 'rename'; path: string; to: string }

export const ARCHIVE_DIR = '_보관'

/** 지우는 대신 옮길 보관 경로. 이미 있으면 번호를 붙인다 */
export function archivePath(path: string, files: Record<string, NoteFile>): string {
  const base = `${ARCHIVE_DIR}/${path}`
  const taken = (p: string) => !!files[p] && !files[p].deleted
  if (!taken(base)) return base
  const m = /^(.*?)(\.md)?$/i.exec(base)!
  for (let i = 2; i < 1000; i++) {
    const p = `${m[1]} (${i})${m[2] ?? ''}`
    if (!taken(p)) return p
  }
  return base
}

/** 요청을 실제 쓰기 목록으로 바꾼다. allow + delete 는 지우지 않고 보관함으로 옮긴다 */
export function planOps(req: AiRequest, verdict: Verdict, files: Record<string, NoteFile>): FileOp[] {
  switch (req.action) {
    case 'create': return [{ op: 'create', path: req.path, content: req.content ?? '' }]
    case 'modify': return [{ op: 'set', path: req.path, content: req.content ?? '' }]
    case 'move': return req.to ? [{ op: 'rename', path: req.path, to: req.to }] : []
    case 'delete': return verdict.effect === 'archive' ? [{ op: 'rename', path: req.path, to: archivePath(req.path, files) }] : [{ op: 'delete', path: req.path }]
  }
}

export type Triage =
  | { kind: 'apply'; verdict: Verdict; ops: FileOp[] } // 바로 반영해도 됨
  | { kind: 'pending'; verdict: Verdict } // 제안으로 보관하고 사람의 승인을 기다림
  | { kind: 'denied'; verdict: Verdict } // 거절

/** AI 쓰기 요청을 받아 어떻게 다룰지 정한다(정책 엔진 판정 + 반영 계획) */
export function triage(req: AiRequest, rules: DocRules, projects: Project[], files: Record<string, NoteFile>): Triage {
  const verdict = checkAiWrite(req, rules, projects, files)
  if (verdict.decision === 'deny') return { kind: 'denied', verdict }
  if (verdict.decision === 'require_approval') return { kind: 'pending', verdict }
  return { kind: 'apply', verdict, ops: planOps(req, verdict, files) }
}

export function newProposal(req: AiRequest, verdict: Verdict, by: string, summary: string | undefined, now: number, id: string): Proposal {
  return { id, createdAt: now, by, summary, req, reason: verdict.reason, text: verdict.text, status: 'pending' }
}

export type Approval = { ok: true; ops: FileOp[] } | { ok: false; reason: Reason; text?: string }

/** 승인 버튼: 반영 직전에 판정을 다시 한다. 그새 문서가 바뀌었거나 규칙이 막으면 반영하지 않는다 */
export function approve(p: Proposal, rules: DocRules, projects: Project[], files: Record<string, NoteFile>): Approval {
  if (p.status !== 'pending') return { ok: false, reason: 'stale' }
  const r: ApplyResult = resolveForApply(p.req, true, rules, projects, files)
  if (!r.ok) return { ok: false, reason: r.verdict.reason, text: r.verdict.text }
  return { ok: true, ops: planOps(p.req, r.verdict, files) }
}

/** 제안을 검토 화면에서 어떻게 보일지: 지금 문서가 읽은 뒤 바뀌었는지(바뀌었으면 승인해도 반영되지 않는다) */
export function isStale(p: Proposal, files: Record<string, NoteFile>): boolean {
  if (p.req.action === 'create') return !!files[p.req.path] && !files[p.req.path].deleted
  const cur = files[p.req.path]
  return !cur || cur.deleted || p.req.baseHash === undefined || p.req.baseHash !== contentHash(cur.content)
}

/** 오래된 제안 정리: 처리된 것은 최근 20건만, 대기 중인 것은 모두 남긴다 */
export function prune(list: Proposal[], keepDone = 20): Proposal[] {
  const done = list.filter((p) => p.status !== 'pending').sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt)).slice(0, keepDone)
  const keep = new Set([...list.filter((p) => p.status === 'pending'), ...done])
  return list.filter((p) => keep.has(p))
}
