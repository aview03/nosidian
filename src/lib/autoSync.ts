// 자동 동기화(저장소가 연결된 보관함): 앱을 켤 때(app.ts), 다시 열 때, 5분마다, 고친 뒤 잠시 있다가, 네트워크가 돌아왔을 때.
// 규칙은 순수 함수(autoSyncDue)에 모았고, 타이머·이벤트 연결(createAutoSync)은 부품을 주입받아 시험한다.
//  - 자동 실행은 조용하다(app.ts sync 의 auto 옵션): 성공은 알리지 않고, 실패는 알림 대신 syncError 로 남긴다.
//  - 실패가 이어지면 간격을 늘린다(1·2·4…분, 최대 30분): 꺼진 PC 를 계속 찌르며 배터리·네트워크를 쓰지 않는다. 성공하거나 사람이 직접 동기화하면 처음으로 돌아간다.
//  - 사람이 고치는 도중에는 하지 않는다: 마지막 편집 뒤 30초가 지나야 올린다.
import { useApp } from './app'

export const AUTO = {
  /** 이만큼 동기화한 적이 없으면 다시 맞춘다 */
  staleMs: 5 * 60_000,
  /** 마지막 편집 뒤 이만큼 조용해야 올린다 */
  settleMs: 30_000,
  /** 시도 사이 최소 간격 */
  minGapMs: 30_000,
  /** 얼마나 자주 해야 할 때인지 살핀다 */
  tickMs: 30_000,
  maxBackoffMs: 30 * 60_000,
} as const

export interface AutoInput {
  now: number
  enabled: boolean
  hasRemote: boolean
  syncing: boolean
  online: boolean
  visible: boolean
  lastSync: number | null
  /** 올리지 않은 변경이 있나 */
  dirty: boolean
  lastEditAt: number
  /** 연속 실패 횟수 */
  failures: number
  lastAttemptAt: number
}

/** 실패가 이어질 때 기다릴 시간: 1·2·4…분, 최대 30분 */
export const backoffMs = (failures: number): number => (failures <= 0 ? 0 : Math.min(AUTO.maxBackoffMs, 60_000 * 2 ** (failures - 1)))

export type AutoReason = 'edit' | 'stale'

/** 지금 자동으로 동기화해야 하나. 이유(edit: 고친 뒤 / stale: 오래 안 맞춤)를 돌려주고, 아니면 null */
export function autoSyncDue(i: AutoInput): AutoReason | null {
  if (!i.enabled || !i.hasRemote || i.syncing || !i.online || !i.visible) return null
  const since = i.now - i.lastAttemptAt
  if (since < backoffMs(i.failures)) return null // 실패가 이어지면 물러난다
  if (since < AUTO.minGapMs) return null
  // 마지막 시도 뒤에 새로 고친 것만 "고쳤으니 올린다"로 본다 — 쓰기 권한이 없어 계속 남는 변경이 30초마다 되풀이되지 않게
  if (i.dirty && i.lastEditAt > i.lastAttemptAt && i.now - i.lastEditAt >= AUTO.settleMs) return 'edit'
  if (i.lastSync == null || i.now - i.lastSync >= AUTO.staleMs) return 'stale'
  return null
}

export interface AutoDeps {
  now(): number
  online(): boolean
  visible(): boolean
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(h: unknown): void
  /** 'visible'(다시 보임)·'online'(네트워크 복구) 이벤트를 듣는다. 해제 함수를 돌려준다 */
  listen(onEvent: () => void): () => void
}

const realDeps: AutoDeps = {
  now: () => Date.now(),
  online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  visible: () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  listen: (onEvent) => {
    const v = () => document.visibilityState === 'visible' && onEvent()
    document.addEventListener('visibilitychange', v)
    window.addEventListener('online', onEvent)
    return () => {
      document.removeEventListener('visibilitychange', v)
      window.removeEventListener('online', onEvent)
    }
  },
}

/** 시작한다. 돌려주는 함수로 멈춘다. */
export function createAutoSync(deps: AutoDeps = realDeps): () => void {
  let failures = 0
  let lastAttemptAt = 0
  let lastEditAt = 0
  let running = false

  // 편집 시각을 기억한다: 올리지 않은 변경이 있는 상태에서 files 가 바뀔 때마다 갱신
  let prevFiles = useApp.getState().files
  const unsub = useApp.subscribe((s) => {
    if (s.files === prevFiles) return
    prevFiles = s.files
    if (Object.values(s.files).some((f) => f.dirty)) lastEditAt = deps.now()
  })

  const input = (): AutoInput => {
    const s = useApp.getState()
    return {
      now: deps.now(),
      enabled: s.settings.autoSync !== false,
      hasRemote: !!s.settings.remote,
      syncing: s.syncing || running,
      online: deps.online(),
      visible: deps.visible(),
      lastSync: s.settings.lastSync,
      dirty: Object.values(s.files).some((f) => f.dirty && !f.conflict) || Object.values(s.assets).some((a) => a.pending),
      lastEditAt,
      failures,
      lastAttemptAt,
    }
  }

  const tick = async () => {
    if (!autoSyncDue(input())) return
    running = true
    lastAttemptAt = deps.now()
    try {
      await useApp.getState().sync(false, { auto: true })
    } finally {
      running = false
    }
    failures = useApp.getState().syncError ? failures + 1 : 0
  }

  // 사람이 직접 동기화해 성공하면(syncError 가 사라지면) 물러남을 처음으로 돌린다
  const unsubErr = useApp.subscribe((s, prev) => {
    if (prev.syncError && !s.syncError) failures = 0
  })

  const h = deps.setInterval(() => void tick(), AUTO.tickMs)
  const stopListen = deps.listen(() => void tick())
  return () => {
    deps.clearInterval(h)
    stopListen()
    unsub()
    unsubErr()
  }
}
