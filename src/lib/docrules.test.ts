import { describe, expect, it } from 'vitest'
import { DOCRULES_PATH, formatRoleLine, isProtectedPath, parseRoleLine, parseRules, profileFor, readRules, rulesNoteTemplate, setFmKey } from './docrules'
import { lintProject, stemOf, type LintItem, type LintKind } from './doclint'
import { buildIndex } from './links'
import { buildWork } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const vault = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([p, c]) => [p, note(p, c)]))

const RULES = `---
rules: on
---
## 프로필: 기본
- 개요 :: file=README.md; official; entry; required=목적,현재 상태
- 정책 :: file=SPEC.md; official; singleton; must
- 할 일 :: file=TASKS.md; official; must
- 보조 :: dir=보조/; aux

## 상태
draft, review, final, archived
`

/** 프로젝트 노트 + 문서들로 점검을 돌린다 */
function run(docs: Record<string, string>, rulesText = RULES, projectFm = 'type: project\ndocs: 기본\n') {
  const files = vault({ 'p/프로젝트.md': `---\n${projectFm}---\n# P\n`, ...Object.fromEntries(Object.entries(docs).map(([k, v]) => ['p/' + k, v])), [DOCRULES_PATH]: rulesText })
  const rules = readRules(files)
  const work = buildWork(files)
  const project = work.projects[0]
  const profile = profileFor(rules, project.fm)!
  const index = buildIndex(Object.values(files).filter((f) => !f.deleted))
  return { report: lintProject(project, files, rules, profile, index), rules, profile, files }
}
const kinds = (items: LintItem[], k: LintKind) => items.filter((i) => i.kind === k)

describe('문서 규칙 파일 해석', () => {
  it('파일이 없거나 rules: off 이면 꺼짐', () => {
    expect(readRules({}).enabled).toBe(false)
    expect(parseRules('---\nrules: off\n---\n').enabled).toBe(false)
    expect(parseRules('---\nrules: on\n---\n').enabled).toBe(true)
    expect(parseRules('---\nrules: true\n---\n').enabled).toBe(true)
  })
  it('모르는 값은 안전한 기본값', () => {
    const r = parseRules('---\nrules: on\napply: 이상한값\nai_write: 이상\nai_new_file: x\n---\n')
    expect([r.apply, r.aiWrite, r.aiNewFile]).toEqual(['opt-in', 'propose', 'approve'])
    const r2 = parseRules('---\nrules: on\napply: all-projects\nai_write: read\nai_new_file: deny\n---\n')
    expect([r2.apply, r2.aiWrite, r2.aiNewFile]).toEqual(['all-projects', 'read', 'deny'])
  })
  it('역할 줄: 플래그·키·모르는 키 무시, 형식화는 되돌아온다', () => {
    const r = parseRoleLine('정책 :: file=SPEC.md; official; singleton; required=규칙,범위; 새로운키=값')!
    expect(r).toMatchObject({ name: '정책', file: 'SPEC.md', official: true, singleton: true, required: ['규칙', '범위'] })
    expect(parseRoleLine(formatRoleLine(r))).toEqual(r)
    expect(parseRoleLine('설명 문장')).toBeNull()
    expect(parseRoleLine('보조 :: dir=보조/; aux')).toMatchObject({ dir: '보조', official: false })
  })
  it('프로필·상태·무시를 읽고, 이해 못 한 줄은 줄 번호와 함께 알린다', () => {
    const r = parseRules(RULES + '\n## 무시\n- 보조/a.md <> 보조/b.md\n- 이상한 줄\n')
    expect(r.profiles).toHaveLength(1)
    expect(r.profiles[0].roles.map((x) => x.name)).toEqual(['개요', '정책', '할 일', '보조'])
    expect(r.statuses).toEqual(['draft', 'review', 'final', 'archived'])
    expect(r.ignorePairs).toEqual([['보조/a.md', '보조/b.md']])
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0].text).toBe('이상한 줄')
  })
  it('설명 문장은 줄 번호 문제로 세지 않고, 처음 만드는 노트는 그대로 해석된다', () => {
    const r = parseRules(rulesNoteTemplate())
    expect(r.enabled).toBe(true)
    expect(r.problems).toEqual([])
    expect(r.profiles[0].name).toBe('기본')
    expect(r.profiles).toHaveLength(1) // 예시 섹션은 프로필이 아니다
    expect(r.profiles[0].roles.map((x) => x.name)).toEqual(['개요', '할 일', '회의록', '보조'])
  })
  it('프로젝트에 적용되는 프로필: opt-in 은 docs: 가 있어야, all-projects 는 docs: off 만 뺀다', () => {
    const optIn = parseRules(RULES)
    expect(profileFor(optIn, {})).toBeNull()
    expect(profileFor(optIn, { docs: '기본' })?.name).toBe('기본')
    expect(profileFor(optIn, { docs: true })?.name).toBe('기본')
    expect(profileFor(optIn, { docs: 'off' })).toBeNull()
    expect(profileFor(optIn, { docs: '없는 프로필' })).toBeNull()
    const all = parseRules(RULES.replace('rules: on', 'rules: on\napply: all-projects'))
    expect(profileFor(all, {})?.name).toBe('기본')
    expect(profileFor(all, { docs: 'off' })).toBeNull()
    expect(profileFor(parseRules('---\nrules: off\n---\n' + RULES.split('---\n')[2]), { docs: '기본' })).toBeNull()
  })
  it('규칙 파일(_workspace/)은 AI 가 고칠 수 없는 경로', () => {
    expect(isProtectedPath(DOCRULES_PATH)).toBe(true)
    expect(isProtectedPath('_workspace/보기.md')).toBe(true)
    expect(isProtectedPath('p/SPEC.md')).toBe(false)
  })
})

describe('setFmKey: 속성 한 줄만 바꾼다', () => {
  it('있으면 바꾸고, 없으면 더하고, 속성 칸이 없으면 만든다', () => {
    expect(setFmKey('---\ntype: project\n---\n# P\n', 'docs', '기본')).toBe('---\ntype: project\ndocs: 기본\n---\n# P\n')
    expect(setFmKey('---\ntype: project\ndocs: off\nowner: a\n---\n# P\n', 'docs', '기본')).toBe('---\ntype: project\ndocs: 기본\nowner: a\n---\n# P\n')
    expect(setFmKey('# P\n', 'docs', '기본')).toBe('---\ndocs: 기본\n---\n# P\n')
  })
  it('null 이면 지운다', () => {
    expect(setFmKey('---\ntype: project\ndocs: 기본\nowner: a\n---\nx', 'docs', null)).toBe('---\ntype: project\nowner: a\n---\nx')
    expect(setFmKey('# P\n', 'docs', null)).toBe('# P\n')
  })
})

describe('문서 점검', () => {
  it('역할: 이름 규칙으로 정하고, 규칙에 없는 문서는 미분류(오류 아님)', () => {
    const { report } = run({ 'README.md': '# 개요\n## 목적\n가\n## 현재 상태\n나\n', 'SPEC.md': '# 정책\n', 'memo.md': '# 메모\n' })
    expect(report.docs.find((d) => d.rel === 'README.md')?.role?.name).toBe('개요')
    expect(report.unclassified).toEqual(['p/memo.md'])
    expect(report.items.some((i) => i.path === 'p/memo.md' && i.severity === 'warn')).toBe(false)
  })
  it('role: 가 이름 규칙과 다르면 역할을 확정하지 않고 충돌로 표시', () => {
    const { report } = run({ 'README.md': '---\nrole: 정책\n---\n# R\n' })
    expect(kinds(report.items, 'roleConflict')).toEqual([expect.objectContaining({ path: 'p/README.md', text: '개요', text2: '정책' })])
    expect(report.docs.find((d) => d.rel === 'README.md')?.role).toBeUndefined()
  })
  it('보조 폴더 안의 문서가 공식 역할을 주장하면 위치 불일치(공식 문서가 되지 않는다)', () => {
    const { report } = run({ '보조/memo.md': '---\nrole: 정책\n---\n# x\n', 'SPEC.md': '# 정책\n' })
    expect(kinds(report.items, 'roleMisplaced').map((i) => i.path)).toEqual(['p/보조/memo.md'])
    expect(kinds(report.items, 'singletonDup')).toEqual([]) // 사칭한 문서는 정책 문서로 세지 않는다
  })
  it('정해진 자리(file=)가 아닌 곳의 role: 도 위치 불일치, 모르는 역할은 따로', () => {
    const { report } = run({ 'notes/a.md': '---\nrole: 정책\n---\n', 'b.md': '---\nrole: 없는역할\n---\n' })
    expect(kinds(report.items, 'roleMisplaced').map((i) => i.path)).toEqual(['p/notes/a.md'])
    expect(kinds(report.items, 'unknownRole').map((i) => i.text)).toEqual(['없는역할'])
  })
  it('하나뿐이어야 하는 역할이 둘이면 충돌', () => {
    const rules = RULES.replace('- 보조 ::', '- 정책 별칭 :: dir=old/; official; singleton\n- 보조 ::')
    const { report } = run({ 'SPEC.md': '# a\n', 'old/x.md': '---\nrole: 정책 별칭\n---\n# x\n', 'old/y.md': '---\nrole: 정책 별칭\n---\n# y\n' }, rules)
    const dup = kinds(report.items, 'singletonDup')
    expect(dup).toHaveLength(1)
    expect(dup[0].text).toBe('정책 별칭')
    expect(dup[0].others).toHaveLength(1)
  })
  it('must 로 지정한 문서가 없을 때만 안내(info)', () => {
    const { report } = run({ 'README.md': '# R\n## 목적\n가\n## 현재 상태\n나\n' })
    const miss = kinds(report.items, 'missingDoc')
    expect(miss.every((i) => i.severity === 'info')).toBe(true)
    expect(miss.map((i) => i.text).sort()).toEqual(['정책', '할 일'])
  })
  it('필수 제목: 없음 / 비어 있음 / 정상 (보조 문서는 검사하지 않는다)', () => {
    const { report } = run({
      'README.md': '# R\n## 목적\n\n## 다른\n내용\n',
      '보조/a.md': '# 보조\n',
    })
    expect(kinds(report.items, 'emptySection').map((i) => i.text)).toEqual(['목적'])
    expect(kinds(report.items, 'missingSection').map((i) => i.text)).toEqual(['현재 상태'])
    expect(report.items.some((i) => i.path === 'p/보조/a.md' && (i.kind === 'missingSection' || i.kind === 'emptySection'))).toBe(false)
    const ok = run({ 'README.md': '# R\n## 목적\n가\n## 현재 상태\n나\n' }).report
    expect(kinds(ok.items, 'missingSection').length + kinds(ok.items, 'emptySection').length).toBe(0)
  })
  it('status: 허용 값이 아니면 경고, 없으면 안내. 프로젝트 노트의 status 는 검사하지 않는다', () => {
    const { report } = run({ 'SPEC.md': '---\nstatus: 몰라\n---\n# s\n', 'TASKS.md': '# t\n' }, RULES, 'type: project\ndocs: 기본\nstatus: active\n')
    expect(kinds(report.items, 'badStatus').map((i) => [i.path, i.text])).toEqual([['p/SPEC.md', '몰라']])
    expect(kinds(report.items, 'noStatus').map((i) => i.path)).toEqual(['p/TASKS.md'])
  })
  it('끊어진 링크와 없는 제목 앵커', () => {
    const { report } = run({ 'a.md': '[[없는 노트]] [[b#없는 제목]] [[b#있는 제목]]\n', 'b.md': '# 있는 제목\n' })
    expect(kinds(report.items, 'brokenLink').map((i) => [i.path, i.text])).toEqual([['p/a.md', '없는 노트']])
    expect(kinds(report.items, 'brokenAnchor').map((i) => [i.text, i.text2])).toEqual([['b', '없는 제목']])
  })
  it('코드 안의 링크는 끊어진 링크로 세지 않는다', () => {
    const { report } = run({ 'a.md': '`[[예시]]`\n\n```\n[[예시2]]\n```\n' })
    expect(kinds(report.items, 'brokenLink')).toEqual([])
  })
  it('고아(들어오는 링크 없음)와 진입 문서에서 닿을 수 없음은 서로 다른 판정', () => {
    const { report } = run({
      'README.md': '# R\n## 목적\n가\n## 현재 상태\n나\n[[a]]\n',
      'a.md': '[[b]]\n', // 개요가 링크 → 닿음
      'b.md': '# b\n', // a 가 링크 → 닿음
      'x.md': '[[y]]\n', // 아무도 x 를 링크하지 않음 → 고아
      'y.md': '# y\n', // x 만 링크: 링크는 받지만 개요에서 닿지 않음
    })
    expect(kinds(report.items, 'orphan').map((i) => i.path)).toEqual(['p/x.md'])
    expect(kinds(report.items, 'unreachable').map((i) => i.path)).toEqual(['p/y.md'])
  })
  it('공식 문서는 고아로 세지 않지만, 개요에서 닿지 않으면 알린다', () => {
    const { report } = run({ 'README.md': '# R\n## 목적\n가\n## 현재 상태\n나\n', 'SPEC.md': '# s\n' })
    expect(kinds(report.items, 'orphan')).toEqual([])
    expect(kinds(report.items, 'unreachable').map((i) => i.path)).toContain('p/SPEC.md')
  })
  it('보관(status: archived) 문서는 점검 대상에서 빠진다', () => {
    const { report } = run({ 'old.md': '---\nstatus: archived\n---\n[[없는]]\n' })
    expect(report.items.some((i) => i.path === 'p/old.md')).toBe(false)
  })
})

describe('중복 후보', () => {
  const body = (extra: string) => '# 로그인 설계\n## 흐름\n' + '사용자가 이메일과 비밀번호를 입력하면 서버가 토큰을 발급하고 클라이언트는 이 토큰을 저장한 뒤 이후 요청마다 헤더에 실어 보낸다. '.repeat(4) + extra
  it('이름 뿌리가 같고 본문도 비슷하면 후보(근거 포함)', () => {
    const { report } = run({ 'auth-plan.md': body('끝.'), 'auth-plan-v2.md': body('끝!') })
    const d = kinds(report.items, 'duplicate')
    expect(d).toHaveLength(1)
    expect(d[0].reasons).toEqual(expect.arrayContaining(['stem', 'body']))
  })
  it('근거가 하나뿐이면(이름만 비슷) 후보로 올리지 않는다', () => {
    const { report } = run({ 'auth-plan.md': '# A\n짧은 글\n', 'auth-plan-v2.md': '# 완전히 다른 주제\n전혀 다른 내용의 글이다 가나다라마바사 아자차카타파하\n' })
    expect(kinds(report.items, 'duplicate')).toEqual([])
  })
  it('다른 폴더끼리는 비교하지 않고, 무시 목록의 쌍은 뺀다', () => {
    expect(kinds(run({ 'a/auth-plan.md': body('끝.'), 'b/auth-plan-v2.md': body('끝!') }).report.items, 'duplicate')).toEqual([])
    const withIgnore = RULES + '\n## 무시\n- auth-plan.md <> auth-plan-v2.md\n'
    expect(kinds(run({ 'auth-plan.md': body('끝.'), 'auth-plan-v2.md': body('끝!') }, withIgnore).report.items, 'duplicate')).toEqual([])
  })
  it('이름 뿌리: 꼬리표를 떼고, 너무 짧으면 비교하지 않는다', () => {
    expect(stemOf('auth-plan-v2')).toBe('auth-plan')
    expect(stemOf('Auth Plan (2)')).toBe('auth plan')
    expect(stemOf('보고서_최종_수정')).toBe('보고서')
    expect(stemOf('2024')).toBe('')
  })
})

describe('규칙이 꺼져 있으면 아무것도 점검하지 않는다', () => {
  it('프로필이 없다', () => {
    const files = vault({ 'p/프로젝트.md': '---\ntype: project\ndocs: 기본\n---\n' })
    expect(profileFor(readRules(files), buildWork(files).projects[0].fm)).toBeNull()
  })
})
