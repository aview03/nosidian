import { describe, expect, it } from 'vitest'
import { buildIndex } from './links'
import { readRules } from './docrules'
import { buildWork } from './work'
import type { NoteFile } from './types'
import {
  AI_EXCLUDE_MS, DEFAULT_AUTO, canExecutePlan, changedPaths, classify, collectFindings, consecutiveFailures, describePolicy, dismissItem, dryRun,
  emptyState, finishRun, isStale, nextRunnable, noteAiChange, normalizeSettings, prune, rulesHash, scan, startRun, usedToday,
  type AutoSettings, type AutoState, type Finding,
} from './autoTriggers'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const BODY = '인증 정책: 세션은 로그인 후 유지된다. 비밀번호는 해시로 저장하고 실패 5회 시 잠근다. 토큰은 만료 시간을 가진다. 로그아웃하면 토큰을 폐기한다. 관리자 계정은 2단계 인증을 쓴다. '.repeat(3)
const RULES = '---\nrules: on\nai_write: propose\n---\n## 프로필: 기본\n- 정책 :: file=SPEC.md; official; singleton\n- 보조 :: dir=보조/; aux\n'
const NOW = Date.UTC(2026, 10, 10, 3, 0, 0)

function vault(extra: Record<string, string> = {}) {
  const raw: Record<string, string> = {
    'p/프로젝트.md': '---\ntype: project\ndocs: 기본\n---\n# P\n[[auth-final]]\n',
    'p/보조/auth-final.md': '# 인증\n' + BODY,
    '_workspace/문서규칙.md': RULES,
    ...extra,
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, note(k, v)]))
}
function scanOf(files: Record<string, NoteFile>) {
  const rules = readRules(files)
  const projects = buildWork(files).projects
  const index = buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content })))
  return { input: collectFindings(projects, files, rules, index), rules: rulesHash(files) }
}
const ON: AutoSettings = { ...DEFAULT_AUTO, mode: 'notify' }
const AN: AutoSettings = { ...ON, mode: 'analyze' }
const DUP_FILE = { 'p/보조/auth-final-v2.md': '# 인증 v2\n' + BODY }
const find = (inp: ReturnType<typeof scanOf>, kind: string) => inp.input.findings.find((f) => f.kind === kind)

describe('점검 결과 → 문제', () => {
  it('중복 후보는 짝의 양쪽에서 보고돼도 한 건이고, 노트 버전(해시)을 가진다', () => {
    const s = scanOf(vault(DUP_FILE))
    const dups = s.input.findings.filter((f) => f.kind === 'duplicate')
    expect(dups).toHaveLength(1)
    expect(dups[0].trigger).toBe('duplicate')
    expect(Object.keys(dups[0].hashes).sort()).toEqual(['p/보조/auth-final-v2.md', 'p/보조/auth-final.md'])
    expect(s.input.active).toEqual(['p/프로젝트.md'])
  })
  it('세 문서가 서로 겹치면 쌍 3개가 아니라 한 묶음(문제 1건)이다', () => {
    const s = scanOf(vault({ ...DUP_FILE, 'p/보조/auth-final-v3.md': '# 인증 v3' + String.fromCharCode(10) + BODY }))
    const dups = s.input.findings.filter((f) => f.kind === 'duplicate')
    expect(dups).toHaveLength(1)
    expect(dups[0].paths).toHaveLength(3)
    expect(Object.keys(dups[0].hashes)).toHaveLength(3)
  })
  it('문서 규칙이 없으면 점검 대상이 없다', () => {
    const f = vault(DUP_FILE)
    delete f['_workspace/문서규칙.md']
    expect(scanOf(f).input).toEqual({ active: [], findings: [] })
  })
  it('같은 문제는 노트 내용이 바뀌어도 같은 id, 버전은 달라진다', () => {
    const a = find(scanOf(vault(DUP_FILE)), 'duplicate')!
    const b = find(scanOf(vault({ 'p/보조/auth-final-v2.md': '# 인증 v2\n' + BODY + '\n한 줄 추가' })), 'duplicate')!
    expect(b.id).toBe(a.id)
    expect(b.hashes['p/보조/auth-final-v2.md']).not.toBe(a.hashes['p/보조/auth-final-v2.md'])
  })
})

describe('기준선(최초 실행·켤 때·새 프로젝트)', () => {
  it('최초 점검은 지금 있는 문제를 전부 기준선으로 확정하고 대기열에 올리지 않는다', () => {
    const s = scanOf(vault(DUP_FILE))
    const r = scan(emptyState(), s.input, ON, s.rules, NOW)
    expect(r.queued).toHaveLength(0)
    expect(r.state.initializedAt).toBe(NOW)
    expect(Object.values(r.state.seen).every((e) => e.origin === 'baseline')).toBe(true)
    expect(r.events[0]).toMatchObject({ type: 'baseline' })
  })
  it('재시작·vault 전환 후에도(같은 상태를 다시 불러와) 기존 문제는 새 문제가 되지 않는다', () => {
    const s = scanOf(vault(DUP_FILE))
    const first = scan(emptyState(), s.input, ON, s.rules, NOW).state
    const reloaded = JSON.parse(JSON.stringify(first)) as AutoState
    const again = scan(reloaded, s.input, ON, s.rules, NOW + 1000)
    expect(again.queued).toHaveLength(0)
    expect(again.events).toHaveLength(0)
  })
  it('기준선 뒤에 새로 생긴 중복 후보만 대기열에 오른다', () => {
    const base = scanOf(vault())
    const st0 = scan(emptyState(), base.input, ON, base.rules, NOW).state
    const next = scanOf(vault(DUP_FILE))
    const r = scan(st0, next.input, ON, next.rules, NOW + 60_000)
    expect(r.queued.map((q) => q.kind)).toEqual(['duplicate'])
    expect(r.queued[0]).toMatchObject({ status: 'queued', attempts: 0 })
    expect(r.events.find((e) => e.kind === 'duplicate')).toMatchObject({ decision: 'queue' })
  })
  it('알고 있는 문제에서 노트를 더 고쳐도(내용 해시가 바뀌어도) 다시 새 문제가 되지 않는다', () => {
    const base = scanOf(vault(DUP_FILE))
    const st0 = scan(emptyState(), base.input, ON, base.rules, NOW).state
    const edited = scanOf(vault({ 'p/보조/auth-final-v2.md': '# 인증 v2\n' + BODY + '\n추가' }))
    expect(scan(st0, edited.input, ON, edited.rules, NOW + 1).queued).toHaveLength(0)
  })
  it('문제가 사라졌다가 다시 생기면 새 문제이고, 사라질 때 대기 항목은 해결됨으로 바뀐다', () => {
    const base = scanOf(vault())
    const st0 = scan(emptyState(), base.input, ON, base.rules, NOW).state
    const withDup = scanOf(vault(DUP_FILE))
    const st1 = scan(st0, withDup.input, ON, withDup.rules, NOW + 1).state
    expect(st1.queue[0].status).toBe('queued')
    const gone = scan(st1, base.input, ON, base.rules, NOW + 2).state
    expect(gone.queue[0].status).toBe('resolved')
    expect(Object.keys(gone.seen).some((k) => k.startsWith('duplicate'))).toBe(false)
    const back = scan(gone, withDup.input, ON, withDup.rules, NOW + 3)
    expect(back.queued).toHaveLength(1)
  })
  it('규칙을 새로 켠 프로젝트의 기존 문제는 기준선이다', () => {
    const none = vault(DUP_FILE)
    delete none['_workspace/문서규칙.md']
    const s0 = scanOf(none)
    const st0 = scan(emptyState(), s0.input, ON, s0.rules, NOW).state
    expect(st0.baselined).toEqual([])
    const on = scanOf(vault(DUP_FILE))
    const r = scan(st0, on.input, ON, on.rules, NOW + 1)
    expect(r.queued).toHaveLength(0)
    expect(r.state.baselined).toEqual(['p/프로젝트.md'])
  })
  it('baselineAll(자동 관리를 켤 때)은 꺼져 있는 동안 생긴 문제도 기준선으로 한다', () => {
    const base = scanOf(vault())
    const st0 = scan(emptyState(), base.input, { ...ON, mode: 'off' }, base.rules, NOW).state
    const later = scanOf(vault(DUP_FILE))
    expect(scan(st0, later.input, ON, later.rules, NOW + 1, { baselineAll: true }).queued).toHaveLength(0)
  })
})

describe('트리거 판정과 건너뛴 이유', () => {
  const f = (over: Partial<Finding> = {}): Finding => ({ id: 'x', kind: 'duplicate', project: 'p/프로젝트.md', projectName: 'P', paths: ['a.md', 'b.md'], hashes: { 'a.md': '1', 'b.md': '2' }, truncated: false, trigger: 'duplicate', ...over })
  const ctx = (over = {}) => ({ st: emptyState(), settings: ON, rules: 'r', now: NOW, ahead: 0, ...over })

  it('새 중복 후보는 대기열', () => expect(classify(f(), ctx())).toMatchObject({ decision: 'queue' }))
  it('기계적 문제(누락 제목·status 등)는 AI 불필요', () => expect(classify(f({ kind: 'noStatus', trigger: null }), ctx())).toMatchObject({ decision: 'skip', reason: 'mechanical' }))
  it('트리거를 끄면 건너뛴다', () => expect(classify(f(), ctx({ settings: { ...ON, triggers: { duplicate: false, roleIssue: true } } }))).toMatchObject({ reason: 'triggerOff' }))
  it('자동 관리에서 뺀 프로젝트', () => expect(classify(f(), ctx({ settings: { ...ON, excluded: ['p/프로젝트.md'] } }))).toMatchObject({ reason: 'projectOff' }))
  it('기준선·알고 있는 문제', () => {
    const base = { ...emptyState(), seen: { x: { first: 1, origin: 'baseline' as const } } }
    expect(classify(f(), ctx({ st: base }))).toMatchObject({ reason: 'baseline' })
    const known = { ...emptyState(), seen: { x: { first: 1, origin: 'detected' as const } } }
    expect(classify(f(), ctx({ st: known }))).toMatchObject({ reason: 'known' })
  })
  it('같은 노트 버전을 이미 분석했으면 중복 분석을 막는다(문제가 사라졌다 다시 생겨도)', () => {
    const fi = f()
    const st = { ...emptyState(), analyzed: { 'x#1,2#r': NOW - 1000 } }
    expect(classify(fi, ctx({ st }))).toMatchObject({ reason: 'analyzed' })
    expect(classify({ ...fi, hashes: { 'a.md': '9', 'b.md': '2' } }, ctx({ st }))).toMatchObject({ decision: 'queue' })
  })
  it('AI 가 바꾼 문서는 24시간 동안 자동 분석에서 제외, 지나면 풀린다', () => {
    const st = noteAiChange(emptyState(), ['b.md'], NOW - 1000)
    expect(classify(f(), ctx({ st }))).toMatchObject({ reason: 'aiExcluded' })
    expect(classify(f(), ctx({ st, now: NOW + AI_EXCLUDE_MS }))).toMatchObject({ decision: 'queue' })
  })
  it('잘린(너무 긴) 문서가 걸리면 제외', () => expect(classify(f({ truncated: true }), ctx())).toMatchObject({ reason: 'truncated' }))
  it('하루 한도를 넘으면 대기(내일 이후)', () => {
    expect(classify(f(), ctx({ ahead: 3 }))).toMatchObject({ decision: 'wait', reason: 'capReached' })
    expect(classify(f(), ctx({ ahead: 2 }))).toMatchObject({ decision: 'queue' })
  })
  it('실제 문서로 만든 중복 후보가 트리거에 걸린다', () => {
    const s = scanOf(vault(DUP_FILE))
    const v = dryRun(emptyState(), s.input, ON, s.rules, NOW, true)
    expect(v.find((x) => x.finding.kind === 'duplicate')).toMatchObject({ decision: 'queue' })
  })
})

describe('시험 실행(dry-run)', () => {
  it('상태를 바꾸지 않고, 알고 있는 문제는 이유(기준선)와 함께 보여 준다', () => {
    const s = scanOf(vault(DUP_FILE))
    const st = scan(emptyState(), s.input, ON, s.rules, NOW).state
    const before = JSON.stringify(st)
    const v = dryRun(st, s.input, ON, s.rules, NOW, false)
    expect(v.find((x) => x.finding.kind === 'duplicate')).toMatchObject({ decision: 'skip', reason: 'baseline' })
    expect(JSON.stringify(st)).toBe(before)
  })
  it('ignoreSeen 이면 새 문제인 것처럼 판정해 트리거 정책을 검증할 수 있다', () => {
    const s = scanOf(vault(DUP_FILE))
    const st = scan(emptyState(), s.input, ON, s.rules, NOW).state
    expect(dryRun(st, s.input, ON, s.rules, NOW, true).some((x) => x.decision === 'queue')).toBe(true)
  })
  it('한도 초과를 시뮬레이션한다(기존 대기 + 이번 항목)', () => {
    const fs = ['a', 'b', 'c', 'd'].map((n) => ({ id: n, kind: 'duplicate' as const, project: 'p', projectName: 'P', paths: [n], hashes: { [n]: n }, truncated: false, trigger: 'duplicate' as const }))
    const v = dryRun(emptyState(), { active: ['p'], findings: fs }, ON, 'r', NOW, true)
    expect(v.map((x) => x.reason ?? x.decision)).toEqual(['queue', 'queue', 'queue', 'capReached'])
  })
})

describe('실행 기록: 실패와 사용자의 중단을 구분한다', () => {
  const queued = () => {
    const s = scanOf(vault(DUP_FILE))
    const st0 = scan(emptyState(), scanOf(vault()).input, ON, s.rules, NOW).state
    return scan(st0, s.input, AN, s.rules, NOW + 1).state
  }

  it('중단은 한도·실패 횟수를 쓰지 않고 대기열로 돌아가며, 사용량은 기록한다', () => {
    let st = queued()
    const id = st.queue[0].id
    st = startRun(st, id)
    expect(st.queue[0].status).toBe('running')
    st = finishRun(st, id, 'interrupted', { ms: 4000, costUsd: 0.02 }, NOW + 10)
    expect(st.queue[0]).toMatchObject({ status: 'queued', attempts: 0, interrupted: 1 })
    expect(st.queue[0].retryAt).toBeUndefined()
    expect(usedToday(st.usage, NOW + 10)).toBe(0)
    expect(consecutiveFailures(st.usage)).toBe(0)
    expect(st.usage[0]).toMatchObject({ outcome: 'interrupted', ms: 4000, costUsd: 0.02 })
    expect(nextRunnable(st, AN, NOW + 20)?.id).toBe(id)
  })
  it('실패는 한도와 실패 횟수를 쓰고 1시간 뒤 1회만 재시도, 두 번째 실패는 failed', () => {
    let st = queued()
    const id = st.queue[0].id
    st = finishRun(startRun(st, id), id, 'failed', { ms: 1000 }, NOW + 10)
    expect(st.queue[0]).toMatchObject({ status: 'queued', attempts: 1 })
    expect(usedToday(st.usage, NOW + 10)).toBe(1)
    expect(nextRunnable(st, AN, NOW + 20)).toBeNull()
    expect(nextRunnable(st, AN, NOW + 3600_000 + 11)?.id).toBe(id)
    st = finishRun(st, id, 'failed', { ms: 1000 }, NOW + 3600_000 + 20)
    expect(st.queue[0].status).toBe('failed')
  })
  it('연속 실패 3회면 자동 실행을 멈추고, 사이의 중단은 연속을 끊지 않는다', () => {
    const usage = (o: ('failed' | 'interrupted' | 'done')[]) => o.map((outcome, i) => ({ at: NOW + i, id: 'x', outcome, ms: 1 }))
    expect(consecutiveFailures(usage(['failed', 'interrupted', 'failed', 'failed']))).toBe(3)
    expect(consecutiveFailures(usage(['failed', 'failed', 'done', 'failed']))).toBe(1)
    const st = { ...queued(), usage: usage(['failed', 'failed', 'failed']) }
    expect(nextRunnable(st, AN, NOW + 100)).toBeNull()
  })
  it('하루 한도를 채우면 실행하지 않고, 알림만 모드·일시정지에서도 실행하지 않는다', () => {
    const st = { ...queued(), usage: [1, 2, 3].map((i) => ({ at: NOW + i, id: 'x', outcome: 'done' as const, ms: 1 })) }
    expect(nextRunnable(st, AN, NOW + 100)).toBeNull()
    expect(nextRunnable(queued(), { ...AN, mode: 'notify' }, NOW + 100)).toBeNull()
    expect(nextRunnable(queued(), { ...AN, paused: true }, NOW + 100)).toBeNull()
    expect(nextRunnable(queued(), AN, NOW + 100)).not.toBeNull()
  })
  it('성공하면 분석 캐시가 생겨 같은 버전은 다시 분석하지 않는다', () => {
    let st = queued()
    const q = st.queue[0]
    st = finishRun(startRun(st, q.id), q.id, 'done', { ms: 1, plan: '계획' }, NOW + 10)
    expect(st.queue[0]).toMatchObject({ status: 'done', result: { plan: '계획' } })
    expect(Object.keys(st.analyzed)).toEqual([q.cacheKey])
  })
})

describe('분석 결과의 문서 버전', () => {
  it('분석 뒤 원본이 바뀌면 오래된 계획이라 실행할 수 없다', () => {
    const files = vault(DUP_FILE)
    const s = scanOf(files)
    const st0 = scan(emptyState(), scanOf(vault()).input, ON, s.rules, NOW).state
    let st = scan(st0, s.input, ON, s.rules, NOW + 1).state
    const q0 = st.queue[0]
    st = finishRun(startRun(st, q0.id), q0.id, 'done', { ms: 1, plan: '계획' }, NOW + 2)
    const q = st.queue[0]
    expect(isStale(q, files)).toBe(false)
    expect(canExecutePlan(q, files)).toBe(true)
    const edited = { ...files, 'p/보조/auth-final.md': note('p/보조/auth-final.md', '# 인증\n사람이 고침') }
    expect(isStale(q, edited)).toBe(true)
    expect(canExecutePlan(q, edited)).toBe(false)
    expect(changedPaths(q.result!.hashes, edited)).toEqual(['p/보조/auth-final.md'])
    const gone = { ...files, 'p/보조/auth-final.md': { ...files['p/보조/auth-final.md'], deleted: true } }
    expect(isStale(q, gone)).toBe(true)
  })
  it('결과가 없는 항목은 오래됨도 실행 가능도 아니다', () => {
    const q = { id: 'x', hashes: { 'a.md': '1' } } as never
    expect(isStale(q, {})).toBe(false)
    expect(canExecutePlan(q, {})).toBe(false)
  })
})

describe('기타', () => {
  it('설정 정규화: 잘못된 값은 기본값, 모드는 기본 꺼짐, Claude 동의는 기본 꺼짐', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_AUTO)
    expect(normalizeSettings({ mode: 'x', dailyCap: 7, debounceSec: 1, claudeConsent: 'yes' })).toMatchObject({ mode: 'off', dailyCap: 3, debounceSec: 30, claudeConsent: false })
    expect(normalizeSettings({ mode: 'analyze', dailyCap: 10, claudeConsent: true })).toMatchObject({ mode: 'analyze', dailyCap: 10, claudeConsent: true })
  })
  it('무시한 항목은 dismissed, 오래된 기록은 정리된다', () => {
    const q = { id: 'x', status: 'queued', createdAt: NOW } as never
    expect(dismissItem({ ...emptyState(), queue: [q] }, 'x').queue[0].status).toBe('dismissed')
    const old = { ...emptyState(), aiTouched: { a: NOW - 3 * AI_EXCLUDE_MS, b: NOW }, usage: [{ at: NOW - 40 * 86400_000, id: 'x', outcome: 'done' as const, ms: 1 }] }
    const p = prune(old, NOW)
    expect(Object.keys(p.aiTouched)).toEqual(['b'])
    expect(p.usage).toEqual([])
  })
  it('정책 설명 문구', () => {
    expect(describePolicy(DEFAULT_AUTO)).toContain('쓰지 않아요')
    expect(describePolicy({ ...DEFAULT_AUTO, mode: 'notify' })).toContain('AI 는 부르지 않아요')
    expect(describePolicy({ ...DEFAULT_AUTO, mode: 'analyze', dailyCap: 5, debounceSec: 120 })).toMatch(/2분.*하루 최대 5회.*자동으로 수정하지 않아요/)
  })
})
