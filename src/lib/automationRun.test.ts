import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from './app'
import { useAiThread } from './aiThread'
import type { Outcome } from './autoRunner'
import { yieldToUser } from './autoGate'
import { dropAuto } from './autoStore'
import { DEFAULT_AUTO, emptyState, isStale, type AutoSettings } from './autoTriggers'
import { holdReason, startAutomation, useAutomation } from './automation'
import { buildIndex } from './links'
import { contentHash } from './docpolicy'
import type { NoteFile } from './types'

const runner = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./autoRunner', async (orig) => ({ ...(await orig<typeof import('./autoRunner')>()), startAnalysis: runner.start }))

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const BODY = '인증 정책: 세션은 로그인 후 유지된다. 비밀번호는 해시로 저장하고 실패 5회 시 잠근다. 토큰은 만료 시간을 가진다. 로그아웃하면 토큰을 폐기한다. 관리자 계정은 2단계 인증을 쓴다. '.repeat(3)
const RULES = '---\nrules: on\nai_write: propose\n---\n## 프로필: 기본\n- 정책 :: file=SPEC.md; official; singleton\n- 보조 :: dir=보조/; aux\n'
const BASE: Record<string, string> = {
  'p/프로젝트.md': '---\ntype: project\ndocs: 기본\n---\n# P\n[[auth-final]]\n',
  'p/보조/auth-final.md': '# 인증\n' + BODY,
  '_workspace/문서규칙.md': RULES,
}
const DUP = { ...BASE, 'p/보조/auth-final-v2.md': '# 인증 v2\n' + BODY }
const AN: AutoSettings = { ...DEFAULT_AUTO, mode: 'analyze', claudeConsent: true }

function setFiles(raw: Record<string, string>) {
  const files = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, note(k, v)]))
  useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, syncing: false, settings: { ...useApp.getState().settings, activeVault: 'v1' } })
}
const flush = async (ms = 30) => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(5)
}
const real = () => new Promise((r) => setTimeout(r, 25))
const OK: Outcome = { ok: true, text: '계획\n결정 필요: 만료 시간\n이 계획대로 변경 제안을 만들까요?', ms: 5000, costUsd: 0.1, cancelled: false }

let resolveRun: (o: Outcome) => void
let cancel: ReturnType<typeof vi.fn>
let stop: (() => void) | undefined

/** 기준선을 만든 뒤 새 중복 후보를 만들어 대기열에 올린다 */
async function queueOne() {
  setFiles(BASE)
  stop = startAutomation()
  await flush(3100)
  await real()
  setFiles(DUP)
  await flush(31_000) // 변경 모으기(30초) → 점검 → 대기열
  await real()
  await flush(2000) // 잠시 뒤 분석 시작
  await real()
}
const st = () => useAutomation.getState().st!
const q0 = () => st().queue[0]

beforeEach(async () => {
  localStorage.clear()
  ;(window as never as { amsidianDesktop: unknown }).amsidianDesktop = { claude: {} }
  await dropAuto('v1')
  useAiThread.setState({ engine: 'claude', running: false })
  useAutomation.setState({ settings: { ...AN }, vault: null, st: null, hold: null })
  cancel = vi.fn()
  runner.start.mockReset()
  runner.start.mockImplementation(() => ({ cancel, done: new Promise<Outcome>((r) => { resolveRun = r }) }))
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(async () => {
  stop?.() // 진행 중인 분석을 멈춘다 — 가짜 실행기는 스스로 끝나지 않으므로 여기서 마무리한다
  stop = undefined
  resolveRun?.({ ok: false, text: '', ms: 0, costUsd: 0, cancelled: true })
  await flush(10)
  await real()
  vi.useRealTimers()
  delete (window as never as { amsidianDesktop?: unknown }).amsidianDesktop
})

describe('보류 조건(holdReason)', () => {
  const st0 = emptyState()
  it('분석 모드가 아니면 보류가 아니다', () => expect(holdReason(st0, { ...AN, mode: 'notify' })).toBeNull())
  it('Claude 는 동의가 있어야 한다(로컬 모델은 필요 없다)', () => {
    expect(holdReason(st0, { ...AN, claudeConsent: false })).toBe('consent')
    expect(holdReason(st0, AN)).toBeNull()
  })
  it('일시정지·AI 와 대화 중·하루 한도·연속 실패', () => {
    expect(holdReason(st0, { ...AN, paused: true })).toBe('paused')
    useAiThread.setState({ running: true })
    expect(holdReason(st0, AN)).toBe('userBusy')
    useAiThread.setState({ running: false })
    const now = Date.now()
    const used = { ...st0, usage: [1, 2, 3].map((i) => ({ at: now - i, id: 'x', outcome: 'done' as const, ms: 1 })) }
    expect(holdReason(used, AN, now)).toBe('cap')
    const failed = { ...st0, usage: [1, 2, 3].map((i) => ({ at: now - 10 + i, id: 'x', outcome: 'failed' as const, ms: 1 })) }
    expect(holdReason(failed, AN, now)).toBe('failures')
  })
  it('Claude Code 가 없으면 보류', () => {
    delete (window as never as { amsidianDesktop?: unknown }).amsidianDesktop
    ;(window as never as { amsidianDesktop: unknown }).amsidianDesktop = {}
    expect(holdReason(st0, AN)).toBe('noEngine')
  })
})

describe('자동 분석 실행', () => {
  it('동의가 없으면 Claude 를 부르지 않는다', async () => {
    useAutomation.setState({ settings: { ...AN, claudeConsent: false } })
    await queueOne()
    expect(st().queue).toHaveLength(1)
    expect(runner.start).not.toHaveBeenCalled()
    expect(useAutomation.getState().hold).toBe('consent')
  })

  it('새 문제를 읽기 전용 분석으로 돌려 결과를 문서 버전과 함께 보관한다(문서는 그대로)', async () => {
    await queueOne()
    expect(runner.start).toHaveBeenCalledTimes(1)
    const [prompt, engine] = runner.start.mock.calls[0]
    expect(engine).toBe('claude')
    expect(prompt).toContain('do NOT call propose_change')
    expect(q0().status).toBe('running')
    const before = JSON.stringify(Object.values(useApp.getState().files).map((f) => f.content))
    resolveRun(OK)
    await flush(10)
    await real()
    expect(q0()).toMatchObject({ status: 'done', result: { plan: expect.stringContaining('결정 필요') } })
    expect(Object.keys(q0().result!.hashes).sort()).toEqual(['p/보조/auth-final-v2.md', 'p/보조/auth-final.md'])
    expect(st().usage.at(-1)).toMatchObject({ outcome: 'done', ms: 5000, costUsd: 0.1 })
    expect(Object.keys(st().analyzed)).toEqual([q0().cacheKey])
    expect(JSON.stringify(Object.values(useApp.getState().files).map((f) => f.content))).toBe(before) // 문서 수정 없음
  })

  it('분석하는 동안 문서가 바뀌면 결과는 바로 오래된 계획이다(시작 시점 버전 기록)', async () => {
    await queueOne()
    useApp.getState().setContent('p/보조/auth-final.md', '# 인증\n사람이 먼저 고침')
    resolveRun(OK)
    await flush(10)
    await real()
    expect(isStale(q0(), useApp.getState().files)).toBe(true)
  })

  it('사용자가 AI 에 질문하면 분석을 멈추고 중단으로 기록한다: 한도·실패를 쓰지 않고 이어서 한다', async () => {
    await queueOne()
    cancel.mockImplementation(() => resolveRun({ ok: false, text: '', ms: 2000, costUsd: 0.05, cancelled: true }))
    const waited = yieldToUser()
    await flush(10)
    await waited
    await real()
    expect(cancel).toHaveBeenCalled()
    expect(q0()).toMatchObject({ status: 'queued', attempts: 0, interrupted: 1 })
    expect(q0().retryAt).toBeUndefined()
    expect(st().usage.at(-1)).toMatchObject({ outcome: 'interrupted', ms: 2000, costUsd: 0.05 }) // 이미 쓴 사용량은 기록
    expect(holdReason(st(), AN)).toBeNull() // 한도를 쓰지 않았다
    // 사용자가 AI 와 대화하는 동안은 새로 시작하지 않고, 끝나면 이어서 분석한다
    runner.start.mockClear()
    useAiThread.setState({ running: true })
    await flush(70_000)
    expect(runner.start).not.toHaveBeenCalled()
    useAiThread.setState({ running: false })
    await flush(3100)
    await real()
    expect(runner.start).toHaveBeenCalledTimes(1)
  })

  it('실패하면 한도·실패 횟수를 쓰고 1시간 뒤 다시 시도한다', async () => {
    await queueOne()
    resolveRun({ ok: false, text: '', ms: 1000, costUsd: 0, cancelled: false, error: '연결 거부' })
    await flush(10)
    await real()
    expect(q0()).toMatchObject({ status: 'queued', attempts: 1 })
    expect(q0().retryAt).toBeGreaterThan(Date.now())
    expect(st().usage.at(-1)).toMatchObject({ outcome: 'failed' })
    runner.start.mockClear()
    await flush(30 * 60_000)
    expect(runner.start).not.toHaveBeenCalled()
    await flush(31 * 60_000)
    await real()
    expect(runner.start).toHaveBeenCalledTimes(1)
  })

  it('자동 분석을 끄면(알림만) 진행 중인 분석도 멈춘다', async () => {
    await queueOne()
    cancel.mockImplementation(() => resolveRun({ ok: false, text: '', ms: 10, costUsd: 0, cancelled: true }))
    useAutomation.getState().setSettings({ mode: 'notify' })
    await flush(10)
    await real()
    expect(cancel).toHaveBeenCalled()
    expect(q0().status).toBe('queued')
  })

  it('결과를 검토하면 정리 계획이 AI 패널 대화에 올라가고, 원본이 바뀐 뒤에는 실행할 수 없다', async () => {
    await queueOne()
    resolveRun(OK)
    await flush(10)
    await real()
    expect(useAutomation.getState().st!.queue[0].seenAt).toBeUndefined()
    useAutomation.getState().review(q0().id)
    const m = useAiThread.getState().messages
    expect(m.at(-1)).toMatchObject({ role: 'ai', status: 'done', fix: 'plan', source: { itemId: q0().id } })
    expect(m.at(-2)).toMatchObject({ role: 'user' })
    expect(q0().seenAt).toBeGreaterThan(0)
    // 원본이 바뀌면 applyPlan 은 아무것도 하지 않는다
    useApp.getState().setContent('p/보조/auth-final.md', '# 인증\n바뀜')
    const run = vi.fn()
    ;(window as never as { amsidianDesktop: { claude: { run: unknown } } }).amsidianDesktop.claude.run = run
    await useAiThread.getState().applyPlan(m.at(-1)!.id)
    expect(run).not.toHaveBeenCalled()
  })

  it('다시 분석하면 결과를 지우고 최신 문서 버전으로 대기열에 돌아간다', async () => {
    await queueOne()
    resolveRun(OK)
    await flush(10)
    await real()
    const old = q0().cacheKey
    useApp.getState().setContent('p/보조/auth-final.md', '# 인증\n바뀜')
    runner.start.mockClear()
    useAutomation.getState().reanalyze(q0().id)
    expect(q0()).toMatchObject({ status: 'queued', attempts: 0 })
    expect(q0().result).toBeUndefined()
    expect(st().analyzed[old]).toBeUndefined()
    expect(q0().hashes['p/보조/auth-final.md']).toBe(contentHash('# 인증\n바뀜'))
    await flush(3100)
    await real()
    expect(runner.start).toHaveBeenCalledTimes(1)
  })
})
