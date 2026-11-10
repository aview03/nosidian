import { describe, expect, it } from 'vitest'
import { DOCRULES_PATH, readRules } from './docrules'
import { contentHash, type AiRequest } from './docpolicy'
import { approve, approveAll, archivePath, isStale, newProposal, planOps, prune, triage, type Proposal } from './proposals'
import { buildWork } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const RULES = (fm: string) => `---\nrules: on\n${fm}---\n## 프로필: 기본\n- 정책 :: file=SPEC.md; official; singleton\n- 보조 :: dir=보조/; aux\n`
function ctx(fm = 'ai_write: propose\nai_new_file: approve\n') {
  const files: Record<string, NoteFile> = {}
  for (const [p, c] of Object.entries({
    'p/프로젝트.md': '---\ntype: project\ndocs: 기본\n---\n# P\n',
    'p/SPEC.md': '# 정책\n옛 내용\n',
    'p/보조/메모.md': '# 메모\n',
    [DOCRULES_PATH]: RULES(fm),
  })) files[p] = note(p, c)
  return { files, rules: readRules(files), projects: buildWork(files).projects }
}
const hashOf = (f: Record<string, NoteFile>, p: string) => contentHash(f[p].content)

describe('트리아지: 정책 판정 → 반영 / 제안 / 거절', () => {
  it('허용은 바로 반영 계획, 승인 대기는 제안, 거절은 거절', () => {
    const c = ctx()
    const memo: AiRequest = { action: 'modify', path: 'p/보조/메모.md', baseHash: hashOf(c.files, 'p/보조/메모.md'), content: '# 메모\n추가\n' }
    expect(triage(memo, c.rules, c.projects, c.files)).toMatchObject({ kind: 'apply', ops: [{ op: 'set', path: 'p/보조/메모.md' }] })
    const spec: AiRequest = { action: 'modify', path: 'p/SPEC.md', baseHash: hashOf(c.files, 'p/SPEC.md'), content: '# 새 정책\n' }
    expect(triage(spec, c.rules, c.projects, c.files)).toMatchObject({ kind: 'pending', verdict: { reason: 'officialApprove' } })
    expect(triage({ action: 'modify', path: DOCRULES_PATH, baseHash: 'x', content: '' }, c.rules, c.projects, c.files).kind).toBe('denied')
  })
  it('삭제는 지우지 않고 보관함으로 옮기는 계획', () => {
    const c = ctx('ai_write: direct\n')
    const t = triage({ action: 'delete', path: 'p/보조/메모.md', baseHash: hashOf(c.files, 'p/보조/메모.md') }, c.rules, c.projects, c.files)
    expect(t).toMatchObject({ kind: 'apply', ops: [{ op: 'rename', path: 'p/보조/메모.md', to: '_보관/p/보조/메모.md' }] })
  })
  it('보관 경로가 이미 있으면 번호를 붙인다', () => {
    const files = { '_보관/a.md': note('_보관/a.md', ''), '_보관/a (2).md': note('_보관/a (2).md', '') }
    expect(archivePath('a.md', files)).toBe('_보관/a (3).md')
    expect(archivePath('b.md', files)).toBe('_보관/b.md')
  })
  it('계획: 새 문서·이동', () => {
    const c = ctx()
    expect(planOps({ action: 'create', path: 'p/보조/새.md', content: 'x' }, { decision: 'allow', reason: 'ok' }, c.files)).toEqual([{ op: 'create', path: 'p/보조/새.md', content: 'x' }])
    expect(planOps({ action: 'move', path: 'a.md', to: 'b.md' }, { decision: 'allow', reason: 'ok' }, c.files)).toEqual([{ op: 'rename', path: 'a.md', to: 'b.md' }])
  })
})

describe('승인: 반영 직전 재검증', () => {
  const pending = (c: ReturnType<typeof ctx>, content = '# 새 정책\n'): Proposal => {
    const req: AiRequest = { action: 'modify', path: 'p/SPEC.md', baseHash: hashOf(c.files, 'p/SPEC.md'), content }
    const t = triage(req, c.rules, c.projects, c.files)
    if (t.kind !== 'pending') throw new Error('pending 이어야 함')
    return newProposal(req, t.verdict, 'Claude Code', '정책 갱신', 1000, 'id1')
  }
  it('문서가 그대로면 승인되어 반영 계획이 나온다', () => {
    const c = ctx()
    const p = pending(c)
    expect(isStale(p, c.files)).toBe(false)
    expect(approve(p, c.rules, c.projects, c.files)).toEqual({ ok: true, ops: [{ op: 'set', path: 'p/SPEC.md', content: '# 새 정책\n' }] })
  })
  it('승인 대기 중에 사람이 문서를 고치면 승인해도 반영하지 않는다', () => {
    const c = ctx()
    const p = pending(c)
    const edited = { ...c.files, 'p/SPEC.md': note('p/SPEC.md', '# 사람이 고침\n') }
    expect(isStale(p, edited)).toBe(true)
    expect(approve(p, c.rules, c.projects, edited)).toMatchObject({ ok: false, reason: 'stale' })
  })
  it('승인 대기 중에 규칙이 바뀌어 막히면 반영하지 않는다', () => {
    const c = ctx()
    const p = pending(c)
    const locked = ctx('ai_write: read\n')
    expect(approve(p, locked.rules, locked.projects, locked.files)).toMatchObject({ ok: false, reason: 'readOnly' })
  })
  it('이미 처리된 제안은 다시 승인할 수 없다', () => {
    const c = ctx()
    const p = { ...pending(c), status: 'applied' as const }
    expect(approve(p, c.rules, c.projects, c.files).ok).toBe(false)
  })
  it('새 문서 제안은 그 자리에 문서가 생기면 오래된 것으로 본다', () => {
    const c = ctx()
    const req: AiRequest = { action: 'create', path: 'p/보조/새.md', content: 'x' }
    const t = triage(req, c.rules, c.projects, c.files)
    expect(t.kind).toBe('pending')
    const p = newProposal(req, t.verdict, 'AI', undefined, 1, 'n1')
    expect(isStale(p, c.files)).toBe(false)
    expect(isStale(p, { ...c.files, 'p/보조/새.md': note('p/보조/새.md', 'y') })).toBe(true)
    expect(approve(p, c.rules, c.projects, { ...c.files, 'p/보조/새.md': note('p/보조/새.md', 'y') })).toMatchObject({ ok: false, reason: 'exists' })
  })
})

describe('정리', () => {
  it('대기 중인 것은 모두 남기고 처리된 것은 최근 N건만', () => {
    const mk = (id: string, status: Proposal['status'], at: number): Proposal => ({ id, createdAt: at, decidedAt: at, by: 'x', req: { action: 'create', path: id }, reason: 'ok', status })
    const list = [mk('a', 'pending', 1), mk('b', 'applied', 2), mk('c', 'rejected', 3), mk('d', 'failed', 4)]
    expect(prune(list, 2).map((p) => p.id)).toEqual(['a', 'c', 'd'])
  })
})

describe('묶음 승인: 전부 아니면 전무', () => {
  /** 한 작업이 만든 제안 세 건: B 수정 + A 보관 + 링크 노트 수정 */
  function group(fm = 'ai_write: propose\nai_new_file: approve\n') {
    const files: Record<string, NoteFile> = {}
    for (const [p, c] of Object.entries({
      'p/프로젝트.md': '---\ntype: project\ndocs: 기본\n---\n# P\n',
      'p/SPEC.md': '# 정책\n옛\n',
      'p/보조/A.md': '# A\nA 내용\n',
      'p/보조/B.md': '# B\nB 내용\n',
      [DOCRULES_PATH]: RULES(fm),
    })) files[p] = note(p, c)
    const rules = readRules(files)
    const projects = buildWork(files).projects
    const mk = (id: string, req: AiRequest) => {
      const t = triage(req, rules, projects, files)
      return newProposal(req, t.verdict, 'AI', undefined, 1, id)
    }
    const h = (path: string) => contentHash(files[path].content)
    const list = [
      mk('p1', { action: 'modify', path: 'p/보조/B.md', baseHash: h('p/보조/B.md'), content: '# B\nB 내용\nA 내용(합침)\n' }),
      mk('p2', { action: 'delete', path: 'p/보조/A.md', baseHash: h('p/보조/A.md') }),
      mk('p3', { action: 'modify', path: 'p/SPEC.md', baseHash: h('p/SPEC.md'), content: '# 정책\n[[B]] 로 이동\n' }),
    ]
    return { files, rules, projects, list }
  }
  it('모두 통과하면 반영 계획을 순서대로 합쳐 돌려준다(보관은 삭제가 아니라 이동)', () => {
    const g = group('ai_write: direct\nai_new_file: approve\n')
    // direct 에서는 바로 반영(allow)되므로 승인 대기 제안으로 만든다
    const list = g.list.map((p) => ({ ...p, status: 'pending' as const }))
    const r = approveAll(list, g.rules, g.projects, g.files)
    expect(r).toMatchObject({ ok: true, ids: ['p1', 'p2', 'p3'] })
    if (r.ok) expect(r.ops).toEqual([{ op: 'set', path: 'p/보조/B.md', content: '# B\nB 내용\nA 내용(합침)\n' }, { op: 'rename', path: 'p/보조/A.md', to: '_보관/p/보조/A.md' }, { op: 'set', path: 'p/SPEC.md', content: '# 정책\n[[B]] 로 이동\n' }])
  })
  it('한 건이라도 그새 문서가 바뀌었으면 전체를 반영하지 않고, 어느 제안이 문제인지 알려 준다', () => {
    const g = group('ai_write: direct\nai_new_file: approve\n')
    const list = g.list.map((p) => ({ ...p, status: 'pending' as const }))
    const edited = { ...g.files, 'p/보조/A.md': note('p/보조/A.md', '# A\n사람이 고침\n') }
    expect(approveAll(list, g.rules, g.projects, edited)).toEqual({ ok: false, id: 'p2', reason: 'stale', text: undefined })
  })
  it('규칙이 그새 막으면 전체 거절', () => {
    const g = group('ai_write: direct\n')
    const list = g.list.map((p) => ({ ...p, status: 'pending' as const }))
    const locked = group('ai_write: read\n')
    const r = approveAll(list, locked.rules, locked.projects, locked.files)
    expect(r).toMatchObject({ ok: false, reason: 'readOnly' })
  })
  it('같은 노트를 바꾸는 제안이 둘 이상이면(순서에 따라 결과가 달라지므로) 거절한다', () => {
    const g = group('ai_write: direct\nai_new_file: approve\n')
    const h = contentHash(g.files['p/보조/B.md'].content)
    const mk = (id: string, content: string): Proposal => ({ id, createdAt: 1, by: 'AI', req: { action: 'modify', path: 'p/보조/B.md', baseHash: h, content }, reason: 'officialApprove', status: 'pending' })
    expect(approveAll([mk('x1', '첫째'), mk('x2', '둘째')], g.rules, g.projects, g.files)).toMatchObject({ ok: false, reason: 'overlap', text: 'p/보조/B.md' })
  })
  it('이동 도착지가 다른 제안의 대상과 겹쳐도 거절', () => {
    const g = group('ai_write: direct\nai_new_file: approve\n')
    const hA = contentHash(g.files['p/보조/A.md'].content)
    const hB = contentHash(g.files['p/보조/B.md'].content)
    const a: Proposal = { id: 'm1', createdAt: 1, by: 'AI', req: { action: 'move', path: 'p/보조/A.md', to: 'p/보조/C.md', baseHash: hA }, reason: 'ok', status: 'pending' }
    const b: Proposal = { id: 'm2', createdAt: 1, by: 'AI', req: { action: 'move', path: 'p/보조/B.md', to: 'p/보조/C.md', baseHash: hB }, reason: 'ok', status: 'pending' }
    expect(approveAll([a, b], g.rules, g.projects, g.files)).toMatchObject({ ok: false, reason: 'overlap', text: 'p/보조/C.md' })
  })
  it('이미 처리된 제안은 빼고 대기 중인 것만 본다, 대기 중인 것이 없으면 실패', () => {
    const g = group('ai_write: direct\nai_new_file: approve\n')
    const list = g.list.map((p, i) => ({ ...p, status: i === 0 ? ('applied' as const) : ('pending' as const) }))
    const r = approveAll(list, g.rules, g.projects, g.files)
    expect(r).toMatchObject({ ok: true, ids: ['p2', 'p3'] })
    expect(approveAll(g.list.map((p) => ({ ...p, status: 'applied' as const })), g.rules, g.projects, g.files).ok).toBe(false)
  })
})
