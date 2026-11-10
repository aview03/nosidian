import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from './app'
import { useAutomation, startAutomation, runDry } from './automation'
import { dropAuto, loadAuto, loadAutoSettings, saveAuto, saveAutoSettings } from './autoStore'
import { DEFAULT_AUTO, emptyState } from './autoTriggers'
import { emitAiChange } from './aiChangeHook'
import { buildIndex } from './links'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const BODY = '인증 정책: 세션은 로그인 후 유지된다. 비밀번호는 해시로 저장하고 실패 5회 시 잠근다. 토큰은 만료 시간을 가진다. 로그아웃하면 토큰을 폐기한다. 관리자 계정은 2단계 인증을 쓴다. '.repeat(3)
const RULES = '---\nrules: on\nai_write: propose\n---\n## 프로필: 기본\n- 정책 :: file=SPEC.md; official; singleton\n- 보조 :: dir=보조/; aux\n'
const BASE: Record<string, string> = {
  'p/프로젝트.md': '---\ntype: project\ndocs: 기본\n---\n# P\n[[auth-final]]\n',
  'p/보조/auth-final.md': '# 인증\n' + BODY,
  '_workspace/문서규칙.md': RULES,
}
const DUP = { ...BASE, 'p/보조/auth-final-v2.md': '# 인증 v2\n' + BODY }

function setFiles(raw: Record<string, string>, vault = 'v1') {
  const files = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, note(k, v)]))
  useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, syncing: false, settings: { ...useApp.getState().settings, activeVault: vault } })
}
const flush = async (ms = 30) => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 6; i++) await Promise.resolve() // IndexedDB 의 비동기 읽기·쓰기
  await vi.advanceTimersByTimeAsync(5)
}
const real = () => new Promise((r) => setTimeout(r, 25))

let stop: (() => void) | undefined
beforeEach(async () => {
  localStorage.clear()
  ;(window as never as { amsidianDesktop: unknown }).amsidianDesktop = {}
  await dropAuto('v1')
  await dropAuto('v2')
  useAutomation.setState({ settings: { ...DEFAULT_AUTO, mode: 'notify' }, vault: null, st: null })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  delete (window as never as { amsidianDesktop?: unknown }).amsidianDesktop
})

describe('저장소(IndexedDB)', () => {
  it('상태는 vault 마다 따로 저장되고, 다시 불러와도 그대로이며, 깨진 값은 빈 상태', async () => {
    const st = { ...emptyState(), initializedAt: 5, seen: { a: { first: 1, origin: 'baseline' as const } } }
    await saveAuto('v1', st)
    expect((await loadAuto('v1')).seen).toEqual(st.seen)
    expect((await loadAuto('v2')).initializedAt).toBeNull()
    await dropAuto('v1')
    expect((await loadAuto('v1')).initializedAt).toBeNull()
  })
  it('설정은 기기별(localStorage)로 저장·복원된다', () => {
    saveAutoSettings({ ...DEFAULT_AUTO, mode: 'analyze', dailyCap: 10 })
    expect(loadAutoSettings()).toMatchObject({ mode: 'analyze', dailyCap: 10 })
    localStorage.setItem('nosidian.auto.settings', '{깨짐')
    expect(loadAutoSettings()).toEqual(DEFAULT_AUTO)
  })
})

describe('스케줄러', () => {
  it('최초 실행: 기존 중복 문제는 기준선이 되어 알림·대기열이 없다 — 앱을 껐다 켜도 마찬가지', async () => {
    setFiles(DUP)
    stop = startAutomation()
    await flush(3100)
    await real()
    expect(useAutomation.getState().st).toMatchObject({ queue: [] })
    expect(useAutomation.getState().st!.initializedAt).not.toBeNull()
    expect(Object.values(useAutomation.getState().st!.seen).every((e) => e.origin === 'baseline')).toBe(true)
    // 재시작: 저장된 상태를 불러와 다시 점검
    stop?.()
    useAutomation.setState({ vault: null, st: null })
    stop = startAutomation()
    await flush(3100)
    await real()
    expect(useAutomation.getState().st!.queue).toEqual([])
    expect(useAutomation.getState().st!.log.filter((e) => e.type === 'finding')).toEqual([])
  })

  it('자동 관리가 꺼져 있어도 처음 한 번은 기준선을 만든다. 이후 점검은 하지 않고, 켜면 그동안 생긴 문제도 기준선', async () => {
    useAutomation.setState({ settings: { ...DEFAULT_AUTO, mode: 'off' } })
    setFiles(BASE)
    stop = startAutomation()
    await flush(3100)
    await real()
    expect(useAutomation.getState().st!.initializedAt).not.toBeNull()
    // 꺼진 채로 문서가 바뀌어도 점검하지 않는다
    setFiles(DUP)
    await flush(60_000)
    expect(useAutomation.getState().st!.log).toEqual([])
    // 켜는 순간 지금 있는 문제는 기준선
    useAutomation.getState().setSettings({ mode: 'notify' })
    await real()
    expect(useAutomation.getState().st!.queue).toEqual([])
    expect(Object.keys(useAutomation.getState().st!.seen).some((k) => k.startsWith('duplicate'))).toBe(true)
  })

  it('기준선 뒤 새 중복 후보가 생기면 변경을 모은 뒤(debounce) 한 번만 대기열에 오른다', async () => {
    setFiles(BASE)
    stop = startAutomation()
    await flush(3100)
    await real()
    setFiles({ ...BASE, 'p/보조/x.md': '# 임시\n' })
    await flush(10_000)
    setFiles(DUP) // 변경이 계속되면 대기 시간이 다시 시작된다
    await flush(20_000)
    expect(useAutomation.getState().st!.queue).toEqual([]) // 마지막 변경 뒤 30초가 아직 안 됐다
    await flush(11_000)
    await real()
    const q = useAutomation.getState().st!.queue
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ kind: 'duplicate', status: 'queued' })
    await flush(60_000)
    setFiles({ ...DUP, 'p/보조/y.md': '# 또\n' }) // 같은 문제가 이어져도 다시 올리지 않는다
    await flush(31_000)
    await real()
    expect(useAutomation.getState().st!.queue).toHaveLength(1)
  })

  it('저장된 상태는 vault 전환·재시작 후 복원되고, vault 별로 섞이지 않는다', async () => {
    setFiles(BASE, 'v1')
    stop = startAutomation()
    await flush(3100)
    await real()
    setFiles({ ...DUP }, 'v1')
    await flush(31_000)
    await real()
    expect(useAutomation.getState().st!.queue).toHaveLength(1)
    // 다른 vault 로 전환: 그 vault 는 자기 기준선을 따로 만든다
    setFiles(DUP, 'v2')
    await flush(3100)
    await real()
    expect(useAutomation.getState().vault).toBe('v2')
    expect(useAutomation.getState().st!.queue).toEqual([])
    // 돌아오면 v1 의 대기열이 그대로
    setFiles(DUP, 'v1')
    await flush(3100)
    await real()
    expect(useAutomation.getState().vault).toBe('v1')
    expect(useAutomation.getState().st!.queue).toHaveLength(1)
  })

  it('AI 변경이 반영되면 그 경로를 기록해 시험 실행에서 24시간 제외로 보인다', async () => {
    setFiles(BASE)
    stop = startAutomation()
    await flush(3100)
    await real()
    emitAiChange(['p/보조/auth-final.md'])
    await real()
    expect(useAutomation.getState().st!.aiTouched['p/보조/auth-final.md']).toBeGreaterThan(0)
    setFiles(DUP)
    const v = runDry(true).find((x) => x.finding.kind === 'duplicate')
    expect(v).toMatchObject({ decision: 'skip', reason: 'aiExcluded' })
  })

  it('PC 가 아니면(폰·웹) 시작하지 않는다', () => {
    delete (window as never as { amsidianDesktop?: unknown }).amsidianDesktop
    expect(startAutomation()).toBeUndefined()
  })

  it('동기화 중에는 점검하지 않는다', async () => {
    setFiles(BASE)
    stop = startAutomation()
    await flush(3100)
    await real()
    useApp.setState({ syncing: true })
    setFiles(DUP)
    useApp.setState({ syncing: true })
    await flush(31_000)
    await real()
    expect(useAutomation.getState().st!.queue).toEqual([])
  })
})
