import { describe, expect, it } from 'vitest'
import { DOCRULES_PATH, readRules } from './docrules'
import { contentHash, type AiRequest } from './docpolicy'
import { approve, archivePath, isStale, newProposal, planOps, prune, triage, type Proposal } from './proposals'
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
