// MCP 도구 구현(렌더러 쪽): 외부 AI 에이전트가 부르는 6개 도구. 정의(이름·입력 형식)는 electron/mcp.cjs 의 TOOLS 와 같은 이름이다.
//
// 원칙
//  - 읽기 도구(검색·읽기·프로젝트·규칙)와 변경안 제출(propose_change)·상태 조회뿐이다. **노트를 직접 쓰는 도구는 없다.**
//  - propose_change 는 기존 제안 처리(proposalStore.submit → 정책 엔진 triage)를 그대로 거친다. 바로 반영(applied)이든 승인 대기든 거절이든 판정은 정책 엔진이 한다.
//  - 연결된 vault 하나만 연다: 사용자가 설정에서 고른 vault 가 지금 열려 있는 vault 와 같을 때만 동작하고, 아니면 모든 도구가 오류를 돌려준다(다른 vault 에 자동으로 닿지 않는다).
//  - 이 파일은 순수하다: 저장소·검색·제안 처리는 env 로 받는다(시험하기 쉽게).
import { contentHash, type AiRequest, type Reason } from './docpolicy'
import { isProtectedPath, profileFor, readRules } from './docrules'
import { baseName } from './links'
import type { Proposal } from './proposals'
import type { NoteFile } from './types'
import { buildWork } from './work'

export const MCP_TOOL_NAMES = ['search_notes', 'read_note', 'list_projects', 'get_document_rules', 'propose_change', 'get_proposal_status'] as const

export class ToolError extends Error {}

export interface McpEnv {
  /** 지금 열려 있는 vault */
  vault: { id: string | null; name: string }
  /** 외부 AI 에 열어 준 vault(설정). 없으면 접근 불가 */
  allowedVault: string | null
  files: Record<string, NoteFile>
  search(query: string, limit: number): { path: string; score: number; snippet: string }[]
  submit(req: AiRequest, by: string, summary?: string, forceApproval?: boolean): { kind: 'apply' | 'pending' | 'denied'; verdict: { decision: string; reason: Reason; effect?: 'archive'; text?: string }; ops?: { op: string; path: string; to?: string }[]; id?: string }
  find(id: string): Proposal | undefined
  /** 읽기 전용 대화(묻기): 변경안 제출·제안 조회를 거절한다 */
  readOnly?: boolean
  /** 정책이 허용(allow)한 변경도 바로 반영하지 않고 사람의 승인을 기다리게 한다("AI로 고치기" 계획 실행). 거절(deny)은 그대로다 */
  forceApproval?: boolean
  /** 앞부분만 읽은 노트(모델에게 일부만 줬다). 이 노트의 수정(modify)은 거절한다 — 잘린 내용으로 덮어쓰지 않게 */
  partialPaths?: Set<string>
}

export const MAX_READ = 200_000

const str = (v: unknown, name: string, opts: { required?: boolean; max?: number } = {}): string | undefined => {
  if (v === undefined || v === null) {
    if (opts.required) throw new ToolError(`\`${name}\` is required`)
    return undefined
  }
  if (typeof v !== 'string') throw new ToolError(`\`${name}\` must be a string`)
  if (opts.required && !v.trim()) throw new ToolError(`\`${name}\` must not be empty`)
  if (opts.max && v.length > opts.max) throw new ToolError(`\`${name}\` is too long (max ${opts.max} characters)`)
  return v
}

/** 경로 정리: 앞의 ./ · 역슬래시 · 앞 슬래시. 상위 폴더(..)·빈 조각은 거절한다 */
export function cleanPath(p: string): string {
  const v = p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (!v || v.split('/').some((seg) => seg === '..' || seg === '')) throw new ToolError('Invalid path')
  return v
}

const live = (env: McpEnv, path: string) => {
  const f = env.files[path]
  return f && !f.deleted ? f : undefined
}

/** 도구 하나를 실행한다. 오류는 ToolError(사람이 읽을 문장)로 던진다 */
export function callTool(name: string, rawArgs: unknown, env: McpEnv, client: string): unknown {
  if (!env.allowedVault) throw new ToolError('No vault is connected to external AI tools. In Nosidian: Settings > External AI (MCP) > choose a vault.')
  if (env.allowedVault !== env.vault.id) throw new ToolError(`The connected vault is not the one open in Nosidian right now (open vault: "${env.vault.name}"). Open the connected vault in Nosidian, or change it in Settings > External AI (MCP).`)
  if (env.readOnly && (name === 'propose_change' || name === 'get_proposal_status')) throw new ToolError('This conversation is read-only (ask mode): changes cannot be proposed. Answer from what you read.')
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const vault = env.vault.name

  switch (name) {
    case 'search_notes': {
      const query = str(args.query, 'query', { required: true, max: 500 })!
      const n = args.limit === undefined ? 20 : Number(args.limit)
      if (!Number.isInteger(n) || n < 1 || n > 50) throw new ToolError('`limit` must be an integer from 1 to 50')
      const hits = env.search(query, n).filter((h) => live(env, h.path))
      return { vault, count: hits.length, results: hits.map((h) => ({ path: h.path, title: baseName(h.path), snippet: h.snippet, score: h.score })) }
    }
    case 'read_note': {
      const path = cleanPath(str(args.path, 'path', { required: true, max: 500 })!)
      const f = live(env, path)
      if (!f) throw new ToolError(`Note not found: ${path}`)
      const truncated = f.content.length > MAX_READ
      return { vault, path, title: baseName(path), content: truncated ? f.content.slice(0, MAX_READ) : f.content, truncated, content_hash: contentHash(f.content), protected: isProtectedPath(path) }
    }
    case 'list_projects': {
      const rules = readRules(env.files)
      const work = buildWork(env.files)
      return {
        vault,
        projects: work.projects.map((p) => ({ name: p.name, path: p.path, folder: p.folder, status: p.status ?? null, owner: p.owner, due: p.due ?? null, document_rules_profile: profileFor(rules, p.fm)?.name ?? null })),
      }
    }
    case 'get_document_rules': {
      const r = readRules(env.files)
      return {
        vault,
        rules_enabled: r.enabled,
        apply: r.apply,
        ai_write: r.aiWrite,
        ai_new_file: r.aiNewFile,
        profiles: r.profiles.map((p) => ({ name: p.name, roles: p.roles.map((x) => ({ name: x.name, file: x.file ?? null, dir: x.dir ?? null, kind: x.official ? 'official' : 'aux', singleton: x.singleton, entry: x.entry, must: x.must, required_headings: x.required })) })),
        statuses: r.statuses,
        protected_paths: ['_workspace/'],
        notes: [
          'You cannot write notes directly; propose_change is the only way and it goes through this policy.',
          'When rules are off, or a note is outside a project that uses the rules, every change needs a person\'s approval.',
          'ai_write: read = no writes at all; propose = official documents need approval; direct = checked changes apply at once.',
          'Files under _workspace/ (including the rules note) can never be changed by AI.',
        ],
      }
    }
    case 'propose_change': {
      const action = str(args.action, 'action', { required: true })!
      if (!['create', 'modify', 'delete', 'move'].includes(action)) throw new ToolError('`action` must be one of create, modify, delete, move')
      const path = cleanPath(str(args.path, 'path', { required: true, max: 500 })!)
      const to = args.to === undefined ? undefined : cleanPath(str(args.to, 'to', { max: 500 })!)
      const content = str(args.content, 'content', { max: 1_000_000 })
      const baseHash = str(args.base_hash, 'base_hash', { max: 100 })
      const summary = str(args.summary, 'summary', { max: 300 })
      if ((action === 'create' || action === 'modify') && content === undefined) throw new ToolError(`\`content\` is required for ${action}`)
      if (action === 'move' && !to) throw new ToolError('`to` is required for move')
      if (action === 'modify' && env.partialPaths?.has(path)) throw new ToolError('You only read the beginning of this note (it was truncated), so modifying it would delete the rest. Do not modify it; explain the change to the user instead.')
      const req: AiRequest = { action: action as AiRequest['action'], path, ...(to ? { to } : {}), ...(content !== undefined ? { content } : {}), ...(baseHash ? { baseHash } : {}) }
      const r = env.submit(req, client ? `MCP · ${client}` : 'MCP', summary, env.forceApproval)
      const hint = HINT[r.verdict.reason]
      if (r.kind === 'apply') return { outcome: 'applied', reason: r.verdict.reason, ...(r.verdict.effect === 'archive' ? { archived: true } : {}), applied: r.ops ?? [] }
      if (r.kind === 'pending') return { outcome: 'pending_approval', reason: r.verdict.reason, proposal_id: r.id, message: 'A person must approve this in Nosidian. Check get_proposal_status with proposal_id.', ...(hint ? { hint } : {}) }
      return { outcome: 'denied', reason: r.verdict.reason, ...(r.verdict.text ? { detail: r.verdict.text } : {}), ...(hint ? { hint } : {}) }
    }
    case 'get_proposal_status': {
      const id = str(args.proposal_id, 'proposal_id', { required: true, max: 100 })!
      const p = env.find(id)
      if (!p) throw new ToolError('Unknown proposal_id (it may belong to another vault, or it was cleaned up as an old, handled proposal)')
      return { proposal_id: p.id, status: p.status, action: p.req.action, path: p.req.path, ...(p.status === 'failed' && p.failReason ? { reason: p.failReason, hint: HINT[p.failReason] } : {}), ...(p.decidedAt ? { decided_at: new Date(p.decidedAt).toISOString() } : {}) }
    }
    default:
      throw new ToolError(`Unknown tool: ${name}`)
  }
}

/** 에이전트가 다음에 무엇을 해야 하는지 알려 주는 짧은 안내 */
const HINT: Partial<Record<Reason, string>> = {
  protected: 'Files under _workspace/ can never be changed by AI.',
  noRules: 'Document rules are off, so AI changes always need approval.',
  outside: 'This note is outside a project that uses the document rules, so a person must approve changes.',
  noProfile: 'The project points to a rules profile that cannot be read; a person must approve.',
  readOnly: 'The vault rules do not allow AI to write (ai_write: read).',
  noBase: 'Call read_note first and send its content_hash as base_hash.',
  stale: 'The note changed after you read it. Read it again and redo the change on the latest text.',
  exists: 'A note already exists there. Use modify, or choose another path.',
  missing: 'The note does not exist. Use create, or check the path with search_notes.',
  singletonExists: 'Only one such document is allowed and it already exists. Modify the existing one instead.',
  newFileDenied: 'The vault rules do not allow AI to create notes.',
  notInTemplate: 'Only files named in the rules profile may be created by AI. See get_document_rules.',
  newFileApprove: 'New notes need a person\'s approval.',
  officialApprove: 'Official documents need a person\'s approval (ai_write: propose).',
  planApprove: 'This change comes from an approved cleanup plan, so it still needs the person\'s final approval in Nosidian.',
  officialDelete: 'Official documents cannot be deleted by AI.',
  officialMove: 'Official documents cannot be moved or renamed by AI.',
  leavesProject: 'Moving a note out of its project (or the rules\' scope) needs approval.',
}
