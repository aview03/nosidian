import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO, autoSyncDue, backoffMs, createAutoSync, type AutoDeps, type AutoInput } from './autoSync'
import { useApp } from './app'
import type { NoteFile } from './types'

const base: AutoInput = { now: 10_000_000, enabled: true, hasRemote: true, syncing: false, online: true, visible: true, lastSync: 10_000_000 - 60_000, dirty: false, lastEditAt: 0, failures: 0, lastAttemptAt: 0 }
const due = (o: Partial<AutoInput>) => autoSyncDue({ ...base, ...o })

describe('autoSyncDue: 언제 자동으로 맞추나', () => {
  it('방금 맞췄고 고친 것도 없으면 하지 않는다', () => {
    expect(due({})).toBeNull()
  })
  it('5분 넘게 안 맞췄으면 맞춘다(stale), 아직 5분 전이면 안 한다', () => {
    expect(due({ lastSync: base.now - AUTO.staleMs })).toBe('stale')
    expect(due({ lastSync: base.now - AUTO.staleMs + 1000 })).toBeNull()
  })
  it('한 번도 맞춘 적이 없으면 맞춘다', () => {
    expect(due({ lastSync: null })).toBe('stale')
  })
  it('고친 뒤 30초가 지나 조용해지면 올린다(edit), 그 전(고치는 중)에는 안 한다', () => {
    expect(due({ dirty: true, lastEditAt: base.now - AUTO.settleMs })).toBe('edit')
    expect(due({ dirty: true, lastEditAt: base.now - AUTO.settleMs + 1000 })).toBeNull()
  })
  it('올리지 못한 변경이 남아 있어도(읽기 전용 등) 마지막 시도 뒤에 새로 고친 게 아니면 편집 사유로 되풀이하지 않는다', () => {
    const lastAttemptAt = base.now - 40_000
    expect(due({ dirty: true, lastEditAt: lastAttemptAt - 5_000, lastAttemptAt })).toBeNull()
    expect(due({ dirty: true, lastEditAt: lastAttemptAt + 1_000, lastAttemptAt })).toBe('edit') // 그 뒤에 또 고쳤다
  })
  it('꺼 두었거나, 저장소가 없거나, 동기화 중이거나, 오프라인이거나, 화면이 안 보이면 하지 않는다', () => {
    const stale = { lastSync: null }
    expect(due({ ...stale, enabled: false })).toBeNull()
    expect(due({ ...stale, hasRemote: false })).toBeNull()
    expect(due({ ...stale, syncing: true })).toBeNull()
    expect(due({ ...stale, online: false })).toBeNull()
    expect(due({ ...stale, visible: false })).toBeNull()
  })
  it('시도 사이에는 최소 간격(30초)을 둔다', () => {
    expect(due({ lastSync: null, lastAttemptAt: base.now - 10_000 })).toBeNull()
    expect(due({ lastSync: null, lastAttemptAt: base.now - AUTO.minGapMs })).toBe('stale')
  })
  it('실패가 이어지면 물러난다: 1·2·4…분, 최대 30분', () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffMs)).toEqual([0, 60_000, 120_000, 240_000, 480_000, AUTO.maxBackoffMs])
    expect(due({ lastSync: null, failures: 3, lastAttemptAt: base.now - 239_000 })).toBeNull()
    expect(due({ lastSync: null, failures: 3, lastAttemptAt: base.now - 240_000 })).toBe('stale')
  })
})

describe('createAutoSync: 타이머·이벤트 연결', () => {
  let t = 1_000_000
  let online = true
  let visible = true
  let tickFn: () => void = () => {}
  let eventFn: () => void = () => {}
  let cleared = 0
  const syncMock = vi.fn(async (_r?: boolean, o?: { auto?: boolean }) => { void o })
  const deps: AutoDeps = {
    now: () => t,
    online: () => online,
    visible: () => visible,
    setInterval: (fn) => { tickFn = fn; return 1 },
    clearInterval: () => { cleared++ },
    listen: (fn) => { eventFn = fn; return () => { cleared++ } },
  }
  const note = (path: string, dirty: boolean): NoteFile => ({ path, content: 'x', sha: null, dirty, mtime: 1 })
  let stop: () => void = () => {}
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
  beforeEach(() => {
    t = 1_000_000
    online = true
    visible = true
    cleared = 0
    syncMock.mockClear()
    syncMock.mockImplementation(async () => {})
    useApp.setState({ files: {}, assets: {}, syncing: false, syncError: null, sync: syncMock as never, settings: { ...useApp.getState().settings, remote: { kind: 'github' } as never, lastSync: t, autoSync: true } })
    stop = createAutoSync(deps)
  })
  afterEach(() => stop())

  it('오래 안 맞췄으면 주기 확인(tick)에서 자동(auto) 옵션으로 맞춘다', async () => {
    t += AUTO.staleMs
    tickFn()
    await flush()
    expect(syncMock).toHaveBeenCalledTimes(1)
    expect(syncMock.mock.calls[0][1]).toEqual({ auto: true })
  })
  it('다시 보이거나 네트워크가 돌아오는 이벤트도 같은 판단을 거친다(필요 없으면 안 한다)', async () => {
    eventFn()
    await flush()
    expect(syncMock).not.toHaveBeenCalled() // 방금 맞췄다
    t += AUTO.staleMs
    eventFn()
    await flush()
    expect(syncMock).toHaveBeenCalledTimes(1)
  })
  it('고치고 30초가 지나면 올린다 — 고치는 도중에는 안 한다', async () => {
    useApp.setState({ files: { 'a.md': note('a.md', true) } }) // 편집
    t += 10_000
    tickFn(); await flush()
    expect(syncMock).not.toHaveBeenCalled()
    t += AUTO.settleMs
    tickFn(); await flush()
    expect(syncMock).toHaveBeenCalledTimes(1)
  })
  it('실패(syncError)가 이어지면 간격을 늘리고, 성공하면 처음으로 돌아간다', async () => {
    syncMock.mockImplementation(async () => { useApp.setState({ syncError: 'down' }) })
    t += AUTO.staleMs
    tickFn(); await flush()
    expect(syncMock).toHaveBeenCalledTimes(1)
    t += 30_000
    tickFn(); await flush()
    expect(syncMock).toHaveBeenCalledTimes(1) // 1분은 기다린다
    t += 40_000
    tickFn(); await flush()
    expect(syncMock).toHaveBeenCalledTimes(2)
    t += 100_000 // 두 번째 실패 뒤 2분이 필요한데 1분 40초
    tickFn(); await flush()
    expect(syncMock).toHaveBeenCalledTimes(2)
    // 사람이 직접 맞춰 성공하면 물러남이 사라진다
    syncMock.mockImplementation(async () => { useApp.setState({ syncError: null }) })
    useApp.setState({ syncError: null })
    tickFn(); await flush()
    expect(syncMock).toHaveBeenCalledTimes(3)
  })
  it('설정에서 끄면 하지 않는다', async () => {
    useApp.setState({ settings: { ...useApp.getState().settings, autoSync: false } })
    t += AUTO.staleMs * 3
    tickFn(); await flush()
    expect(syncMock).not.toHaveBeenCalled()
  })
  it('멈추면 타이머·이벤트 연결을 모두 푼다', () => {
    stop()
    expect(cleared).toBe(2)
    stop = createAutoSync(deps)
  })
})
