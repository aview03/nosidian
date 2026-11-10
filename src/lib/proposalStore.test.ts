import { beforeEach, describe, expect, it } from 'vitest'
import { setLang } from './i18n'
import { useApp } from './app'
import { contentHash } from './docpolicy'
import { useProposals } from './proposalStore'
import type { NoteFile } from './types'

setLang('ko')

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const RULES = '---\nrules: on\nai_write: propose\nai_new_file: approve\n---\n## 프로필: 기본\n- 정책 :: file=SPEC.md; official; singleton\n- 보조 :: dir=보조/; aux\n'

function setup() {
  localStorage.clear()
  useApp.setState({
    files: Object.fromEntries(
      Object.entries({
        'p/프로젝트.md': '---\ntype: project\ndocs: 기본\n---\n# P\n',
        'p/SPEC.md': '# 정책\n옛\n',
        'p/보조/A.md': '# A\nA 내용\n',
        'p/보조/B.md': '# B\nB 내용\n',
        '_workspace/문서규칙.md': RULES,
      }).map(([k, v]) => [k, note(k, v)]),
    ),
    settings: { ...useApp.getState().settings, activeVault: 'v1' },
  })
  useProposals.setState({ items: [], vault: 'v1', loaded: true })
}
const file = (p: string) => useApp.getState().files[p]
const h = (p: string) => contentHash(file(p).content)

/** 한 작업이 낸 제안 세 건: B 에 A 를 합치고, A 를 보관하고, 정책 노트의 링크를 고친다. 규칙(propose)상 보조 문서 수정은 바로 반영되므로 공식 문서(SPEC)·새 문서 쪽으로 승인 대기를 만든다 */
function submitGroup() {
  const s = useProposals.getState()
  const r1 = s.submit({ action: 'modify', path: 'p/SPEC.md', baseHash: h('p/SPEC.md'), content: '# 정책\n[[B]] 로 이동\n' }, 'AI', '링크 수정')
  const r2 = s.submit({ action: 'create', path: 'p/보조/C.md', content: '# C\n새 문서\n' }, 'AI', '새 문서')
  const r3 = s.submit({ action: 'create', path: 'p/보조/D.md', content: '# D\n또 새 문서\n' }, 'AI', '또 새 문서')
  return [r1, r2, r3].map((r) => r.id!)
}

beforeEach(setup)

describe('묶음 승인(저장소)', () => {
  it('모두 통과하면 한꺼번에 반영하고 전부 applied', () => {
    const ids = submitGroup()
    expect(useProposals.getState().items.map((p) => p.status)).toEqual(['pending', 'pending', 'pending'])
    expect(useProposals.getState().approveGroup(ids)).toBe(true)
    expect(file('p/SPEC.md').content).toContain('[[B]] 로 이동')
    expect(file('p/보조/C.md')?.content).toContain('새 문서')
    expect(file('p/보조/D.md')?.content).toContain('또 새 문서')
    expect(useProposals.getState().items.map((p) => p.status)).toEqual(['applied', 'applied', 'applied'])
  })
  it('하나라도 안 되면(그새 사람이 고침) 아무것도 반영하지 않고, 문제 제안만 failed 로 표시한다', () => {
    const ids = submitGroup()
    useApp.getState().setContent('p/SPEC.md', '# 정책\n사람이 먼저 고침\n')
    expect(useProposals.getState().approveGroup(ids)).toBe(false)
    expect(file('p/SPEC.md').content).toBe('# 정책\n사람이 먼저 고침\n')
    expect(file('p/보조/C.md')).toBeUndefined() // 문제없는 제안도 반영되지 않았다
    expect(file('p/보조/D.md')).toBeUndefined()
    const st = useProposals.getState().items.map((p) => [p.summary, p.status, p.failReason])
    expect(st).toEqual([['링크 수정', 'failed', 'stale'], ['새 문서', 'pending', undefined], ['또 새 문서', 'pending', undefined]])
  })
  it('나머지는 대기 상태로 남아 있어 하나씩 검토할 수 있다', () => {
    const ids = submitGroup()
    useApp.getState().setContent('p/SPEC.md', '# 정책\n사람이 먼저 고침\n')
    useProposals.getState().approveGroup(ids)
    useProposals.getState().approve(ids[1])
    expect(file('p/보조/C.md')?.content).toContain('새 문서')
    expect(useProposals.getState().find(ids[1])!.status).toBe('applied')
    expect(useProposals.getState().find(ids[2])!.status).toBe('pending')
  })
  it('같은 노트를 바꾸는 제안이 겹치면 묶음 승인은 거절하고 아무것도 바뀌지 않는다', () => {
    const s = useProposals.getState()
    const a = s.submit({ action: 'create', path: 'p/보조/X.md', content: '첫째' }, 'AI')
    const b = s.submit({ action: 'create', path: 'p/보조/X.md', content: '둘째' }, 'AI') // 같은 자리에 두 번
    expect(useProposals.getState().approveGroup([a.id!, b.id!])).toBe(false)
    expect(file('p/보조/X.md')).toBeUndefined()
    expect(useProposals.getState().items.map((p) => p.status)).toEqual(['pending', 'pending'])
  })
  it('모두 거절', () => {
    const ids = submitGroup()
    useProposals.getState().rejectGroup(ids)
    expect(useProposals.getState().items.map((p) => p.status)).toEqual(['rejected', 'rejected', 'rejected'])
    expect(file('p/보조/C.md')).toBeUndefined()
  })
  it('이미 처리된 제안이 섞여 있어도 대기 중인 것만 처리한다', () => {
    const ids = submitGroup()
    useProposals.getState().reject(ids[0])
    expect(useProposals.getState().approveGroup(ids)).toBe(true)
    expect(useProposals.getState().items.map((p) => p.status)).toEqual(['rejected', 'applied', 'applied'])
    expect(file('p/SPEC.md').content).toBe('# 정책\n옛\n') // 거절한 것은 반영되지 않았다
  })
})

describe('계획 실행 제안은 정책이 허용해도 최종 승인을 받는다(forceApproval)', () => {
  it('보조 문서 수정은 원래 바로 반영되지만, forceApproval 이면 대기 제안이 되고 승인해야 반영된다', () => {
    const base = { action: 'modify' as const, path: 'p/보조/A.md', baseHash: h('p/보조/A.md'), content: '# A\n바뀜\n' }
    const direct = useProposals.getState().submit(base, 'AI')
    expect(direct.kind).toBe('apply') // 정책: 보조 문서 수정은 허용
    expect(file('p/보조/A.md').content).toBe('# A\n바뀜\n')
    setup()
    const forced = useProposals.getState().submit(base, 'AI', '계획 실행', true)
    expect(forced).toMatchObject({ kind: 'pending', verdict: { decision: 'require_approval', reason: 'planApprove' } })
    expect(file('p/보조/A.md').content).toBe('# A\nA 내용\n') // 아직 반영되지 않았다
    expect(useProposals.getState().items[0]).toMatchObject({ status: 'pending', reason: 'planApprove', summary: '계획 실행' })
    useProposals.getState().approve(forced.id!)
    expect(file('p/보조/A.md').content).toBe('# A\n바뀜\n')
  })
  it('삭제(보관)·새 문서도 마찬가지이고, 정책이 거절한 것은 forceApproval 이어도 거절이다', () => {
    const del = useProposals.getState().submit({ action: 'delete', path: 'p/보조/A.md', baseHash: h('p/보조/A.md') }, 'AI', undefined, true)
    expect(del.kind).toBe('pending')
    expect(file('p/보조/A.md')).toBeDefined() // 아직 보관되지 않았다
    const prot = useProposals.getState().submit({ action: 'create', path: '_workspace/문서규칙.md', content: 'x' }, 'AI', undefined, true)
    expect(prot.kind).toBe('denied')
    expect(useProposals.getState().items).toHaveLength(1) // 거절은 제안으로 남지 않는다
  })
  it('묶음 승인과 함께 쓰면 계획 전체가 한 번에 반영되거나 전혀 반영되지 않는다', () => {
    const s = useProposals.getState()
    const a = s.submit({ action: 'modify', path: 'p/보조/B.md', baseHash: h('p/보조/B.md'), content: '# B\n합침\n' }, 'AI', 'B 에 합침', true)
    const b = s.submit({ action: 'delete', path: 'p/보조/A.md', baseHash: h('p/보조/A.md') }, 'AI', 'A 보관', true)
    expect(useProposals.getState().approveGroup([a.id!, b.id!])).toBe(true)
    expect(file('p/보조/B.md').content).toBe('# B\n합침\n')
    expect(file('p/보조/A.md')?.deleted ?? true).toBe(true) // 원래 자리에는 없다
    expect(useApp.getState().files['_보관/p/보조/A.md']?.content).toBe('# A\nA 내용\n') // 보관함으로 옮겨졌다
  })
})
