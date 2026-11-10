import { describe, expect, it } from 'vitest'
import { DOCRULES_PATH, readRules } from './docrules'
import { contentHash } from './docpolicy'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mcpMain from '../../electron/mcp.cjs'
import { callTool, cleanPath, MCP_TOOL_NAMES, ToolError, type McpEnv } from './mcpTools'
import { newProposal, triage, type Proposal } from './proposals'
import { buildWork } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const RULES = (fm: string) => `---\nrules: on\n${fm}---\n## 프로필: 기본\n- 정책 :: file=SPEC.md; official; singleton\n- 보조 :: dir=보조/; aux\n\n## 상태\ndraft, final\n`

/** 시험용 환경: 제안 처리는 실제 triage 를 쓰고, 반영(execute)은 하지 않고 기록만 한다 */
function env(fm = 'ai_write: propose\nai_new_file: approve\n', over: Partial<McpEnv> = {}) {
  const files: Record<string, NoteFile> = {}
  for (const [p, c] of Object.entries({
    'p/프로젝트.md': '---\ntype: project\ndocs: 기본\nstatus: active\nowner: 민수\n---\n# P\n',
    'p/SPEC.md': '# 정책\n옛 내용\n',
    'p/보조/메모.md': '# 메모\n견적서 초안\n',
    '일상/메모.md': '# 일상\n견적서 얘기\n',
    [DOCRULES_PATH]: RULES(fm),
  })) files[p] = note(p, c)
  const proposals: Proposal[] = []
  const log: unknown[] = []
  const e: McpEnv = {
    vault: { id: 'v1', name: '내 vault' },
    allowedVault: 'v1',
    files,
    search: (q, limit) => Object.values(files).filter((f) => f.content.includes(q) || f.path.includes(q)).slice(0, limit).map((f) => ({ path: f.path, score: 10, snippet: f.content.slice(0, 40) })),
    submit: (req, by, summary) => {
      const rules = readRules(files)
      const t = triage(req, rules, buildWork(files).projects, files)
      log.push({ req, by, summary, kind: t.kind })
      if (t.kind === 'pending') {
        const p = newProposal(req, t.verdict, by, summary, 1000, 'pid' + proposals.length)
        proposals.push(p)
        return { kind: 'pending', verdict: t.verdict, id: p.id }
      }
      if (t.kind === 'apply') return { kind: 'apply', verdict: t.verdict, ops: t.ops }
      return { kind: 'denied', verdict: t.verdict }
    },
    find: (id) => proposals.find((p) => p.id === id),
    ...over,
  }
  return { e, files, proposals, log }
}
const call = (x: ReturnType<typeof env>, name: string, args: unknown = {}) => callTool(name, args, x.e, 'Claude Code') as Record<string, any>

describe('연결된 vault 만 연다', () => {
  it('연결된 vault 가 없으면 모든 도구가 거절', () => {
    const x = env('', { allowedVault: null })
    for (const n of MCP_TOOL_NAMES) expect(() => callTool(n, {}, x.e, 'c'), n).toThrow(/No vault is connected/)
  })
  it('지금 열려 있는 vault 가 연결된 vault 가 아니면 거절(다른 vault 에 자동으로 닿지 않는다)', () => {
    const x = env('', { vault: { id: 'v2', name: '회사' } })
    expect(() => callTool('search_notes', { query: 'a' }, x.e, 'c')).toThrow(/not the one open/)
    expect(() => callTool('propose_change', { action: 'create', path: 'a.md', content: 'x' }, x.e, 'c')).toThrow(ToolError)
    expect(x.log).toHaveLength(0) // 제안 처리까지 가지 않는다
  })
})

describe('읽기 도구', () => {
  it('search_notes: 결과·개수 제한·인자 검사', () => {
    const x = env()
    const r = call(x, 'search_notes', { query: '견적서' })
    expect(r.vault).toBe('내 vault')
    expect(r.results.map((h: { path: string }) => h.path).sort()).toEqual(['p/보조/메모.md', '일상/메모.md'])
    expect(r.results[0].title).toBe('메모')
    expect(call(x, 'search_notes', { query: '견적서', limit: 1 }).count).toBe(1)
    expect(() => call(x, 'search_notes', {})).toThrow(/query/)
    expect(() => call(x, 'search_notes', { query: 'a', limit: 99 })).toThrow(/limit/)
    expect(() => call(x, 'search_notes', { query: 5 })).toThrow(/string/)
  })
  it('read_note: 내용과 content_hash, 없는 노트·상위 경로는 오류, 보호 경로 표시', () => {
    const x = env()
    const r = call(x, 'read_note', { path: 'p/SPEC.md' })
    expect(r.content).toBe('# 정책\n옛 내용\n')
    expect(r.content_hash).toBe(contentHash('# 정책\n옛 내용\n'))
    expect(r.truncated).toBe(false)
    expect(call(x, 'read_note', { path: './p/SPEC.md' }).path).toBe('p/SPEC.md')
    expect(call(x, 'read_note', { path: DOCRULES_PATH }).protected).toBe(true)
    expect(() => call(x, 'read_note', { path: 'p/없음.md' })).toThrow(/not found/)
    expect(() => call(x, 'read_note', { path: '../secret.md' })).toThrow(/Invalid path/)
  })
  it('삭제된 노트는 읽히지도 검색되지도 않는다', () => {
    const x = env()
    x.files['p/SPEC.md'].deleted = true
    expect(() => call(x, 'read_note', { path: 'p/SPEC.md' })).toThrow(/not found/)
    expect(call(x, 'search_notes', { query: '옛 내용' }).count).toBe(0)
  })
  it('큰 노트는 잘라서 truncated 표시', () => {
    const x = env()
    x.files['p/보조/큰.md'] = note('p/보조/큰.md', 'a'.repeat(250_000))
    const r = call(x, 'read_note', { path: 'p/보조/큰.md' })
    expect(r.truncated).toBe(true)
    expect(r.content).toHaveLength(200_000)
  })
  it('list_projects: 프로젝트와 문서 규칙 적용 여부', () => {
    const r = call(env(), 'list_projects')
    expect(r.projects).toEqual([{ name: 'P', path: 'p/프로젝트.md', folder: 'p', status: 'active', owner: ['민수'], due: null, document_rules_profile: '기본' }])
  })
  it('get_document_rules: 규칙·정책·보호 경로', () => {
    const r = call(env('ai_write: direct\nai_new_file: deny\n'), 'get_document_rules')
    expect(r).toMatchObject({ rules_enabled: true, ai_write: 'direct', ai_new_file: 'deny', statuses: ['draft', 'final'], protected_paths: ['_workspace/'] })
    expect(r.profiles[0].roles.map((x: { name: string; kind: string }) => [x.name, x.kind])).toEqual([['정책', 'official'], ['보조', 'aux']])
    expect(call({ ...env(), e: { ...env().e, files: {} } }, 'get_document_rules').rules_enabled).toBe(false)
  })
})

describe('propose_change: 정책 엔진을 그대로 거친다', () => {
  it('공식 문서 수정 → 승인 대기(proposal_id), 상태 조회', () => {
    const x = env()
    const base = call(x, 'read_note', { path: 'p/SPEC.md' }).content_hash
    const r = call(x, 'propose_change', { action: 'modify', path: 'p/SPEC.md', content: '# 새 정책\n', base_hash: base, summary: '정책 갱신' })
    expect(r).toMatchObject({ outcome: 'pending_approval', reason: 'officialApprove', proposal_id: 'pid0' })
    expect(x.log[0]).toMatchObject({ by: 'MCP · Claude Code', summary: '정책 갱신' })
    expect(call(x, 'get_proposal_status', { proposal_id: 'pid0' })).toMatchObject({ status: 'pending', action: 'modify', path: 'p/SPEC.md' })
  })
  it('보조 문서 수정은 허용(applied)', () => {
    const x = env()
    const base = contentHash(x.files['p/보조/메모.md'].content)
    expect(call(x, 'propose_change', { action: 'modify', path: 'p/보조/메모.md', content: '# 메모\n추가\n', base_hash: base })).toMatchObject({ outcome: 'applied', applied: [{ op: 'set', path: 'p/보조/메모.md' }] })
  })
  it('보조 문서 삭제는 보관(archived)으로 반영', () => {
    const x = env('ai_write: direct\n')
    const base = contentHash(x.files['p/보조/메모.md'].content)
    expect(call(x, 'propose_change', { action: 'delete', path: 'p/보조/메모.md', base_hash: base })).toMatchObject({ outcome: 'applied', archived: true, applied: [{ op: 'rename', to: '_보관/p/보조/메모.md' }] })
  })
  it('보호 경로·base_hash 없음·오래된 해시는 거절하고 다음 행동을 안내', () => {
    const x = env('ai_write: direct\n')
    expect(call(x, 'propose_change', { action: 'create', path: '_workspace/문서규칙.md', content: 'x' })).toMatchObject({ outcome: 'denied', reason: 'protected' })
    const noBase = call(x, 'propose_change', { action: 'modify', path: 'p/SPEC.md', content: 'x' })
    expect(noBase).toMatchObject({ outcome: 'denied', reason: 'noBase' })
    expect(noBase.hint).toMatch(/read_note/)
    const stale = call(x, 'propose_change', { action: 'modify', path: 'p/SPEC.md', content: 'x', base_hash: contentHash('옛날') })
    expect(stale).toMatchObject({ outcome: 'denied', reason: 'stale' })
    expect(stale.hint).toMatch(/Read it again/)
  })
  it('규칙이 꺼져 있으면 승인 대기(기본값은 안전하게)', () => {
    const x = env()
    delete x.files[DOCRULES_PATH]
    expect(call(x, 'propose_change', { action: 'create', path: 'a.md', content: 'x' })).toMatchObject({ outcome: 'pending_approval', reason: 'noRules' })
  })
  it('이동: 이동 대상 필수·보호 경로로 이동은 거절', () => {
    const x = env('ai_write: direct\n')
    const base = contentHash(x.files['p/보조/메모.md'].content)
    expect(() => call(x, 'propose_change', { action: 'move', path: 'p/보조/메모.md', base_hash: base })).toThrow(/`to`/)
    expect(call(x, 'propose_change', { action: 'move', path: 'p/보조/메모.md', to: '_workspace/보기.md', base_hash: base })).toMatchObject({ outcome: 'denied', reason: 'protected' })
  })
  it('인자 검사: action·content·경로', () => {
    const x = env()
    expect(() => call(x, 'propose_change', { action: 'overwrite', path: 'a.md' })).toThrow(/action/)
    expect(() => call(x, 'propose_change', { action: 'create', path: 'a.md' })).toThrow(/content/)
    expect(() => call(x, 'propose_change', { action: 'create', path: '../a.md', content: 'x' })).toThrow(/Invalid path/)
    expect(() => call(x, 'propose_change', { action: 'create', path: '  ', content: 'x' })).toThrow(/empty/)
    expect(x.log).toHaveLength(0)
  })
  it('get_proposal_status: 모르는 id 는 오류', () => {
    expect(() => call(env(), 'get_proposal_status', { proposal_id: 'nope' })).toThrow(/Unknown proposal_id/)
  })
  it('알 수 없는 도구는 오류', () => {
    expect(() => callTool('write_note', {}, env().e, 'c')).toThrow(/Unknown tool/)
  })
})

describe('읽기 전용 대화(묻기)', () => {
  it('변경안 제출과 제안 조회는 거절하고, 읽기 도구는 그대로 쓴다(제안 처리까지 가지 않는다)', () => {
    const x = env('ai_write: direct\n', { readOnly: true })
    expect(() => callTool('propose_change', { action: 'create', path: 'a.md', content: 'x' }, x.e, 'c')).toThrow(/read-only/)
    expect(() => callTool('get_proposal_status', { proposal_id: 'p' }, x.e, 'c')).toThrow(/read-only/)
    expect(x.log).toHaveLength(0)
    expect(callTool('read_note', { path: 'p/SPEC.md' }, x.e, 'c')).toMatchObject({ path: 'p/SPEC.md' })
    expect(callTool('search_notes', { query: '견적서' }, x.e, 'c')).toMatchObject({ count: expect.any(Number) })
    expect(callTool('list_projects', {}, x.e, 'c')).toMatchObject({ projects: expect.any(Array) })
    expect(callTool('get_document_rules', {}, x.e, 'c')).toMatchObject({ rules_enabled: true })
  })
})

describe('승인 강제(forceApproval)', () => {
  it('propose_change 는 env.forceApproval 을 제안 처리에 그대로 넘긴다(기본은 넘기지 않는다)', () => {
    const calls: unknown[] = []
    const mk = (force?: boolean) => {
      const x = env('ai_write: direct\n', { forceApproval: force })
      const inner = x.e.submit
      x.e.submit = (req, by, summary, f) => { calls.push(f); return inner(req, by, summary, f) }
      return x
    }
    const a = mk(true)
    callTool('propose_change', { action: 'create', path: 'p/보조/새.md', content: 'x' }, a.e, 'c')
    const b = mk(undefined)
    callTool('propose_change', { action: 'create', path: 'p/보조/새2.md', content: 'x' }, b.e, 'c')
    expect(calls).toEqual([true, undefined])
  })
})

describe('일부만 읽은 노트', () => {
  it('앞부분만 읽은 노트의 수정은 거절하고(나머지를 지우지 않게), 다른 작업은 그대로', () => {
    const x = env('ai_write: direct\n', { partialPaths: new Set(['p/보조/메모.md']) })
    const base = contentHash(x.files['p/보조/메모.md'].content)
    expect(() => callTool('propose_change', { action: 'modify', path: 'p/보조/메모.md', content: '앞부분만', base_hash: base }, x.e, 'c')).toThrow(/truncated/)
    expect(x.log).toHaveLength(0)
    // 다른 노트의 수정·이 노트의 삭제(보관)는 막지 않는다
    expect(callTool('propose_change', { action: 'modify', path: 'p/SPEC.md', content: '새', base_hash: contentHash(x.files['p/SPEC.md'].content) }, x.e, 'c')).toMatchObject({ outcome: expect.any(String) })
    expect(callTool('propose_change', { action: 'delete', path: 'p/보조/메모.md', base_hash: base }, x.e, 'c')).toMatchObject({ outcome: 'applied' })
  })
})

describe('경로 정리', () => {
  it('앞의 ./·역슬래시·앞 슬래시를 정리하고 .. 와 빈 조각은 거절', () => {
    expect(cleanPath('./a/b.md')).toBe('a/b.md')
    expect(cleanPath('a\\b.md')).toBe('a/b.md')
    expect(cleanPath('/a/b.md')).toBe('a/b.md')
    for (const bad of ['..', 'a/../b', 'a//b', '']) expect(() => cleanPath(bad), bad).toThrow(ToolError)
  })
})

describe('도구 정의와 구현이 같은 이름', () => {
  it('electron/mcp.cjs 의 TOOLS 와 MCP_TOOL_NAMES 가 일치', () => {
    const names = (mcpMain as { TOOLS: { name: string }[] }).TOOLS.map((t) => t.name)
    expect([...names].sort()).toEqual([...MCP_TOOL_NAMES].sort())
    expect(names).toHaveLength(7)
  })
  it('모든 도구는 연결된 vault 검사를 거친다(구현이 이름마다 vault 가드를 먼저 부른다)', () => {
    const x = env('', { allowedVault: 'other' })
    for (const n of MCP_TOOL_NAMES) expect(() => callTool(n, {}, x.e, 'c'), n).toThrow(/not the one open/)
  })
})
