import { describe, expect, it } from 'vitest'
import { DOCRULES_PATH, parseRules, readRules } from './docrules'
import { checkAiWrite, contentHash, projectOf, resolveForApply, type AiRequest } from './docpolicy'
import { buildWork } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const RULES = (fm = '') => `---
rules: on
${fm}---
## 프로필: 기본
- 개요 :: file=README.md; official; entry
- 정책 :: file=SPEC.md; official; singleton
- 옛 정책 :: dir=old; official; singleton
- 보조 :: dir=보조/; aux
`
function ctx(fm = '', extra: Record<string, string> = {}, project = 'type: project\ndocs: 기본\n') {
  const files: Record<string, NoteFile> = {}
  const put = (p: string, c: string) => { files[p] = note(p, c) }
  put('p/프로젝트.md', `---\n${project}---\n# P\n`)
  put('p/SPEC.md', '# 정책\n')
  put('p/보조/메모.md', '# 메모\n')
  put('일상/메모.md', '# x\n')
  put(DOCRULES_PATH, RULES(fm))
  for (const [k, c] of Object.entries(extra)) put(k, c)
  return { files, rules: readRules(files), projects: buildWork(files).projects }
}
type C = ReturnType<typeof ctx>
/** 현재 내용으로 해시를 채워 요청한다(AI 가 읽은 직후라고 가정) */
const ask = (c: C, r: AiRequest) => checkAiWrite({ baseHash: r.action === 'create' ? undefined : contentHash(c.files[r.path]?.content ?? ''), ...r }, c.rules, c.projects, c.files)

describe('보호 경로', () => {
  it('_workspace/ 는 다른 정책과 관계없이, 규칙이 꺼져 있어도 모든 쓰기가 거절', () => {
    const c = ctx('ai_write: direct\nai_new_file: template-only\n')
    for (const action of ['create', 'modify', 'delete'] as const) expect(ask(c, { action, path: DOCRULES_PATH, content: 'x' })).toMatchObject({ decision: 'deny', reason: 'protected' })
    expect(checkAiWrite({ action: 'modify', path: DOCRULES_PATH }, parseRules('---\nrules: off\n---\n'), [], {})).toMatchObject({ decision: 'deny', reason: 'protected' })
    expect(ask(c, { action: 'create', path: '_workspace/새.md', content: 'x' }).reason).toBe('protected')
  })
  it('이동·이름 바꾸기로 우회하지 못한다: 출발지든 도착지든 보호 경로면 거절', () => {
    const c = ctx('ai_write: direct\n')
    expect(ask(c, { action: 'move', path: DOCRULES_PATH, to: 'p/보조/규칙.md' })).toMatchObject({ decision: 'deny', reason: 'protected' })
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md', to: '_workspace/문서규칙.md' })).toMatchObject({ decision: 'deny', reason: 'protected' })
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md', to: '_workspace/보기.md' }).reason).toBe('protected')
  })
})

describe('기본값은 안전하게', () => {
  it('규칙이 없거나 꺼져 있으면 AI 자동 쓰기는 승인 대기', () => {
    const off = parseRules('---\nrules: off\n---\n')
    for (const action of ['create', 'modify', 'delete', 'move'] as const) {
      expect(checkAiWrite({ action, path: 'a.md', to: 'b.md' }, off, [], {})).toMatchObject({ decision: 'require_approval', reason: 'noRules' })
    }
    expect(checkAiWrite({ action: 'modify', path: 'a.md' }, readRules({}), [], {}).decision).toBe('require_approval')
  })
  it('규칙을 적용하지 않는 프로젝트·프로젝트 밖도 자동 쓰기는 승인 대기', () => {
    expect(ask(ctx(), { action: 'modify', path: '일상/메모.md' })).toMatchObject({ decision: 'require_approval', reason: 'outside' })
    const notApplied = ctx('', {}, 'type: project\n') // opt-in 인데 docs: 없음
    expect(ask(notApplied, { action: 'modify', path: 'p/SPEC.md' })).toMatchObject({ decision: 'require_approval', reason: 'outside' })
  })
  it('프로젝트가 가리키는 프로필을 못 읽으면 noProfile(자동 쓰기 불가)', () => {
    const c = ctx('', {}, 'type: project\ndocs: 없는프로필\n')
    expect(ask(c, { action: 'modify', path: 'p/SPEC.md' })).toMatchObject({ decision: 'require_approval', reason: 'noProfile' })
  })
  it('ai_write: read 는 생성·수정·삭제·이동을 모두 거절(ai_new_file 과 무관)', () => {
    const c = ctx('ai_write: read\nai_new_file: template-only\n')
    for (const action of ['create', 'modify', 'delete'] as const) expect(ask(c, { action, path: 'p/보조/메모.md' })).toMatchObject({ decision: 'deny', reason: 'readOnly' })
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md', to: 'p/보조/다른.md' }).reason).toBe('readOnly')
  })
})

describe('버전 검사', () => {
  it('읽은 시점의 해시가 지금과 다르면 거절, 없어도 거절', () => {
    const c = ctx('ai_write: direct\n')
    expect(ask(c, { action: 'modify', path: 'p/SPEC.md' }).decision).toBe('allow')
    expect(ask(c, { action: 'modify', path: 'p/SPEC.md', baseHash: contentHash('# 옛날 정책\n') })).toMatchObject({ decision: 'deny', reason: 'stale' })
    expect(checkAiWrite({ action: 'modify', path: 'p/SPEC.md' }, c.rules, c.projects, c.files)).toMatchObject({ decision: 'deny', reason: 'noBase' })
    expect(checkAiWrite({ action: 'delete', path: 'p/보조/메모.md' }, c.rules, c.projects, c.files).reason).toBe('noBase')
  })
  it('없는 문서를 고치려 하면 거절, 이미 있는 자리에 만들려 해도 거절', () => {
    const c = ctx('ai_write: direct\nai_new_file: template-only\n')
    expect(checkAiWrite({ action: 'modify', path: 'p/없음.md', baseHash: 'x' }, c.rules, c.projects, c.files).reason).toBe('missing')
    expect(ask(c, { action: 'create', path: 'p/SPEC.md', content: '# x' })).toMatchObject({ decision: 'deny', reason: 'exists' })
  })
  it('해시는 내용이 같으면 같고 한 글자만 달라도 다르다', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'))
    expect(contentHash('abc')).not.toBe(contentHash('abd'))
    expect(contentHash('')).not.toBe(contentHash(' '))
  })
})

describe('수정·삭제', () => {
  it('propose: 공식 문서 수정은 승인 대기, 보조 문서 수정은 허용', () => {
    const c = ctx('ai_write: propose\n')
    expect(ask(c, { action: 'modify', path: 'p/SPEC.md' })).toMatchObject({ decision: 'require_approval', reason: 'officialApprove', text: '정책' })
    expect(ask(c, { action: 'modify', path: 'p/보조/메모.md' })).toMatchObject({ decision: 'allow' })
  })
  it('direct: 검증을 통과한 공식 문서 수정은 바로 반영', () => {
    expect(ask(ctx('ai_write: direct\n'), { action: 'modify', path: 'p/SPEC.md' })).toMatchObject({ decision: 'allow' })
  })
  it('삭제: 공식 문서는 거절, 나머지는 지우지 않고 보관하라는 허용', () => {
    const c = ctx('ai_write: direct\n')
    expect(ask(c, { action: 'delete', path: 'p/SPEC.md' })).toMatchObject({ decision: 'deny', reason: 'officialDelete' })
    expect(ask(c, { action: 'delete', path: 'p/보조/메모.md' })).toMatchObject({ decision: 'allow', effect: 'archive' })
  })
  it('role: 로 공식 문서를 사칭한 문서는 공식으로 취급하지 않는다', () => {
    const c = ctx('ai_write: propose\n', { 'p/보조/사칭.md': '---\nrole: 정책\n---\n# x\n' })
    expect(ask(c, { action: 'modify', path: 'p/보조/사칭.md' })).toMatchObject({ decision: 'allow' })
  })
})

describe('새 문서', () => {
  it('approve 는 승인 대기, deny 는 금지, template-only 는 등록된 이름만', () => {
    expect(ask(ctx('ai_new_file: approve\n'), { action: 'create', path: 'p/보조/새.md' })).toMatchObject({ decision: 'require_approval', reason: 'newFileApprove' })
    expect(ask(ctx('ai_new_file: deny\n'), { action: 'create', path: 'p/보조/새.md' })).toMatchObject({ decision: 'deny', reason: 'newFileDenied' })
    const t = ctx('ai_write: direct\nai_new_file: template-only\n')
    expect(ask(t, { action: 'create', path: 'p/README.md' })).toMatchObject({ decision: 'allow' })
    expect(ask(t, { action: 'create', path: 'p/보조/새.md' })).toMatchObject({ decision: 'deny', reason: 'notInTemplate' })
  })
  it('template-only + propose: 등록된 공식 문서를 만들어도 승인 대기', () => {
    expect(ask(ctx('ai_write: propose\nai_new_file: template-only\n'), { action: 'create', path: 'p/README.md' })).toMatchObject({ decision: 'require_approval', reason: 'officialApprove' })
  })
  it('하나뿐이어야 하는 역할의 문서가 이미 있으면 새로 만들 수 없다', () => {
    const c = ctx('ai_write: direct\nai_new_file: approve\n', { 'p/old/a.md': '# a\n' })
    expect(ask(c, { action: 'create', path: 'p/old/b.md', content: '# b\n' })).toMatchObject({ decision: 'deny', reason: 'singletonExists', text: 'p/old/a.md' })
    // role: 로 정책 역할을 주장해도 자리가 달라 공식으로 인정되지 않으므로 이 규칙에 걸리지 않는다
    expect(ask(c, { action: 'create', path: 'p/보조/또.md', content: '---\nrole: 정책\n---\n' }).reason).toBe('newFileApprove')
  })
})

describe('이동·이름 바꾸기', () => {
  it('공식 문서는 옮기거나 이름을 바꿀 수 없다', () => {
    expect(ask(ctx('ai_write: direct\n'), { action: 'move', path: 'p/SPEC.md', to: 'p/보조/SPEC.md' })).toMatchObject({ decision: 'deny', reason: 'officialMove' })
  })
  it('보조 문서끼리의 이동은 허용, 이미 있는 자리는 거절', () => {
    const c = ctx('ai_write: direct\n', { 'p/보조/b.md': '# b\n' })
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md', to: 'p/보조/c.md' })).toMatchObject({ decision: 'allow' })
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md', to: 'p/보조/b.md' })).toMatchObject({ decision: 'deny', reason: 'exists' })
  })
  it('이름을 공식 문서 이름으로 바꿔 우회하지 못한다', () => {
    // 보조 문서를 SPEC.md 로 바꾸면 정책 문서가 둘이 되므로 거절(이미 정책 문서가 있을 때)
    const c = ctx('ai_write: direct\n', { 'p/old/a.md': '# a\n' })
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md', to: 'p/old/b.md' })).toMatchObject({ decision: 'deny', reason: 'singletonExists' })
    // 하나뿐이어야 하지 않은 공식 역할(README.md)로 바꾸면 propose 에서는 승인 대기
    const p = ctx('ai_write: propose\n')
    expect(ask(p, { action: 'move', path: 'p/보조/메모.md', to: 'p/README.md' })).toMatchObject({ decision: 'require_approval', reason: 'officialApprove' })
  })
  it('다른 프로젝트·적용 범위 밖으로 옮기면 자동으로 하지 않는다', () => {
    const c = ctx('ai_write: direct\n')
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md', to: '일상/메모2.md' })).toMatchObject({ decision: 'require_approval', reason: 'leavesProject' })
  })
  it('도착지가 없거나 출발지와 같으면 거절', () => {
    const c = ctx('ai_write: direct\n')
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md' }).decision).toBe('deny')
    expect(ask(c, { action: 'move', path: 'p/보조/메모.md', to: 'p/보조/메모.md' }).decision).toBe('deny')
  })
})

describe('승인과 실행 분리', () => {
  it('require_approval 은 허가가 아니다: 승인 전에는 반영하지 않는다', () => {
    const c = ctx('ai_write: propose\n')
    const req: AiRequest = { action: 'modify', path: 'p/SPEC.md', baseHash: contentHash(c.files['p/SPEC.md'].content) }
    expect(resolveForApply(req, false, c.rules, c.projects, c.files)).toMatchObject({ ok: false, why: 'pending' })
    expect(resolveForApply(req, true, c.rules, c.projects, c.files)).toMatchObject({ ok: true })
  })
  it('승인된 뒤에도 반영 직전에 다시 검증한다: 그새 문서가 바뀌었거나 규칙이 막으면 거절', () => {
    const c = ctx('ai_write: propose\n')
    const req: AiRequest = { action: 'modify', path: 'p/SPEC.md', baseHash: contentHash(c.files['p/SPEC.md'].content) }
    // 승인 대기 중에 사람이 문서를 고침
    const edited = { ...c.files, 'p/SPEC.md': note('p/SPEC.md', '# 사람이 고친 정책\n') }
    expect(resolveForApply(req, true, c.rules, c.projects, edited)).toMatchObject({ ok: false, why: 'denied', verdict: { reason: 'stale' } })
    // 승인 대기 중에 규칙이 read 로 바뀜
    const locked = ctx('ai_write: read\n')
    expect(resolveForApply({ ...req, baseHash: contentHash(locked.files['p/SPEC.md'].content) }, true, locked.rules, locked.projects, locked.files)).toMatchObject({ ok: false, why: 'denied' })
  })
  it('deny 는 승인해도 뒤집히지 않는다', () => {
    const c = ctx('ai_write: direct\n')
    expect(resolveForApply({ action: 'modify', path: DOCRULES_PATH, baseHash: contentHash(c.files[DOCRULES_PATH].content) }, true, c.rules, c.projects, c.files)).toMatchObject({ ok: false, why: 'denied' })
  })
  it('allow 는 승인 없이 통과', () => {
    const c = ctx('ai_write: direct\n')
    expect(resolveForApply({ action: 'modify', path: 'p/보조/메모.md', baseHash: contentHash(c.files['p/보조/메모.md'].content) }, false, c.rules, c.projects, c.files)).toMatchObject({ ok: true })
  })
})

describe('프로젝트 소속 판정', () => {
  it('가장 깊은 폴더', () => {
    const files = { 'a/프로젝트.md': note('a/프로젝트.md', '---\ntype: project\n---\n'), 'a/b/프로젝트.md': note('a/b/프로젝트.md', '---\ntype: project\n---\n') }
    const ps = buildWork(files).projects
    expect(projectOf(ps, 'a/b/x.md')?.path).toBe('a/b/프로젝트.md')
    expect(projectOf(ps, 'a/x.md')?.path).toBe('a/프로젝트.md')
    expect(projectOf(ps, 'z.md')).toBeNull()
  })
})
