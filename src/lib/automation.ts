// AI 자동 문서 관리 — 스케줄러와 상태 저장소(PC 전용). 설계: docs/AUTOMATION.md
//
// v1.28: 문서 변경 → (모아서) 규칙 점검 → 새 문제 판정 → 분석 대기열 → 알림·시험 실행. AI 는 부르지 않는다.
// 앱이 켜져 있을 때만 돈다. 다시 열면 기준선과 비교해 쌓인 변경을 한 번 점검한다.
import { create } from 'zustand'
import { useApp } from './app'
import { onAiChange } from './aiChangeHook'
import {
  collectFindings, consecutiveFailures, dismissItem, dryRun, finishRun, markSeen, MAX_FAILS, nextRunnable, noteAiChange, normalizeSettings,
  requeue, resumeFailures, rulesHash, scan, startRun, usedToday,
  type AutoSettings, type AutoState, type ProjectScan, type ScanOptions, type Verdict,
} from './autoTriggers'
import { setAutoGate } from './autoGate'
import { promptOf, startAnalysis, titleOf, type Analysis } from './autoRunner'
import { contentHash } from './docpolicy'
import { localEngine, useAiThread } from './aiThread'
import { loadAuto, loadAutoSettings, saveAuto, saveAutoSettings } from './autoStore'
import { readRules } from './docrules'
import { desktop } from './externalIO'
import { t } from './i18n'
import { buildWork } from './work'

interface AutoStore {
  settings: AutoSettings
  vault: string | null
  st: AutoState | null
  setSettings(patch: Partial<AutoSettings>): void
  /** 프로젝트를 자동 관리에서 빼거나 다시 넣는다 */
  setExcluded(project: string, excluded: boolean): void
  dismiss(id: string): void
  scanNow(opt?: ScanOptions): void
  /** 분석 결과(정리 계획)를 AI 패널에서 검토한다 */
  review(id: string): void
  /** 오래된 분석 결과를 지우고 최신 문서로 다시 분석하도록 대기열로 되돌린다 */
  reanalyze(id: string): void
  /** 연속 실패로 멈춘 자동 분석을 다시 시작한다 */
  resume(): void
  /** 지금 자동 분석을 못 하는 이유(없으면 null) */
  hold: HoldReason | null
}

export type HoldReason = 'paused' | 'consent' | 'noEngine' | 'userBusy' | 'battery' | 'cap' | 'failures'

export const useAutomation = create<AutoStore>((set, get) => {
  const commit = (st: AutoState) => {
    const v = get().vault
    set({ st })
    if (v) void saveAuto(v, st)
  }
  return {
    settings: loadAutoSettings(),
    vault: null,
    st: null,
    setSettings(patch) {
      const prev = get().settings
      const next = normalizeSettings({ ...prev, ...patch, triggers: { ...prev.triggers, ...(patch.triggers ?? {}) } })
      set({ settings: next })
      saveAutoSettings(next)
      // 꺼져 있던 자동 관리를 켜면, 그동안 생긴 문제를 포함해 지금 있는 문제를 기준선으로 확정한다
      if (prev.mode === 'off' && next.mode !== 'off') get().scanNow({ baselineAll: true })
      if (next.mode !== 'analyze') cancelActive() // 자동 분석을 끄면 진행 중인 분석도 멈춘다(중단으로 기록)
      tickSoon()
    },
    setExcluded(project, excluded) {
      const cur = get().settings.excluded
      get().setSettings({ excluded: excluded ? [...new Set([...cur, project])] : cur.filter((p) => p !== project) })
    },
    dismiss(id) {
      const st = get().st
      if (st) commit(dismissItem(st, id))
    },
    scanNow(opt) {
      runScan(opt)
    },
    hold: null,
    review(id) {
      const st = get().st
      const q = st?.queue.find((x) => x.id === id)
      if (!st || !q?.result) return
      if (!useAiThread.getState().injectPlan(titleOf(q), q.result.plan, { hashes: q.result.hashes, itemId: id }, q.engine)) return
      commit(markSeen(st, id, Date.now()))
    },
    reanalyze(id) {
      const st = get().st
      const q = st?.queue.find((x) => x.id === id)
      if (!st || !q) return
      commit(requeue(st, id, hashesOf(q.paths)))
      tickSoon()
    },
    resume() {
      const st = get().st
      if (st) commit(resumeFailures(st, Date.now()))
      tickSoon()
    },
  }
})

const hashesOf = (paths: string[]): Record<string, string> => {
  const files = useApp.getState().files
  const h: Record<string, string> = {}
  for (const p of paths) if (files[p] && !files[p].deleted) h[p] = contentHash(files[p].content)
  return h
}

// ── 자동 분석 실행(v1.29) ────────────────────────────────────
interface Active {
  id: string
  vault: string
  run: Analysis
  done: Promise<void>
  /** 사용자·설정 변경 등으로 우리가 멈췄나(실패가 아니라 중단으로 기록한다) */
  stopped: boolean
}
let active: Active | null = null
let charging: boolean | null = null // 배터리 정보를 알 수 없으면 null(보류하지 않는다)
let tickTimer: ReturnType<typeof setTimeout> | undefined
const tickSoon = (ms = 1500) => {
  clearTimeout(tickTimer)
  tickTimer = setTimeout(() => void tick(), ms)
}

/** 이 설정으로 쓸 엔진: 패널에서 고른 것 또는 로컬 모델 */
export const analysisEngine = (s: AutoSettings): 'claude' | 'ollama' => (s.engine === 'ollama' ? 'ollama' : useAiThread.getState().engine)

export function holdReason(st: AutoState, s: AutoSettings, now = Date.now()): HoldReason | null {
  if (s.mode !== 'analyze') return null
  if (s.paused) return 'paused'
  if (consecutiveFailures(st.usage, st.failResetAt) >= MAX_FAILS) return 'failures'
  const engine = analysisEngine(s)
  if (engine === 'claude' && !s.claudeConsent) return 'consent' // 노트 내용이 사용자가 누르지 않아도 Anthropic 으로 나가므로 별도 동의가 있어야 한다
  if (engine === 'claude' ? !desktop()?.claude : !localEngine().ready) return 'noEngine'
  if (useAiThread.getState().running) return 'userBusy'
  if (s.holdOnBattery && charging === false) return 'battery'
  if (usedToday(st.usage, now) >= s.dailyCap) return 'cap'
  return null
}

function cancelActive() {
  if (!active) return
  active.stopped = true
  active.run.cancel()
}

/** vault 가 바뀐 뒤에도 그 vault 의 상태에 결과를 기록한다 */
async function mutate(vault: string, f: (st: AutoState) => AutoState) {
  const au = useAutomation.getState()
  if (au.vault === vault && au.st) {
    const next = f(au.st)
    useAutomation.setState({ st: next })
    await saveAuto(vault, next)
  } else await saveAuto(vault, f(await loadAuto(vault)))
}

export async function tick() {
  if (active) return
  const app = useApp.getState()
  const au = useAutomation.getState()
  const v = app.settings.activeVault
  if (!app.ready || !v || au.vault !== v || !au.st || app.syncing) return
  const hold = holdReason(au.st, au.settings)
  if (au.hold !== hold) useAutomation.setState({ hold })
  if (hold || au.settings.mode !== 'analyze') return
  const item = nextRunnable(au.st, au.settings, Date.now())
  if (!item) return
  // 관련 노트가 사라졌으면 분석하지 않고 해결된 것으로 본다
  const hashes = hashesOf(item.paths)
  if (Object.keys(hashes).length < item.paths.length) {
    await mutate(v, (st) => ({ ...st, queue: st.queue.map((q) => (q.id === item.id ? { ...q, status: 'resolved' as const } : q)) }))
    return tickSoon(200)
  }
  const engine = analysisEngine(au.settings)
  await mutate(v, (st) => startRun({ ...st, queue: st.queue.map((q) => (q.id === item.id ? { ...q, hashes, engine } : q)) }, item.id))
  const run = startAnalysis(promptOf(item), engine)
  const a: Active = { id: item.id, vault: v, run, stopped: false, done: Promise.resolve() }
  active = a
  a.done = (async () => {
    const o = await run.done
    active = null
    const now = Date.now()
    if (o.cancelled || a.stopped) await mutate(a.vault, (st) => finishRun(st, a.id, 'interrupted', { ms: o.ms, costUsd: o.costUsd }, now))
    else if (o.ok && o.text.trim()) {
      // 분석을 시작할 때의 문서 버전을 결과와 함께 기록한다(분석 중에 문서가 바뀌었으면 바로 오래된 계획이 된다)
      await mutate(a.vault, (st) => finishRun(st, a.id, 'done', { ms: o.ms, costUsd: o.costUsd, plan: o.text, hashes }, now))
      useApp.getState().say(t('AI 문서 관리: 정리 계획이 준비됐어요 — 설정에서 확인하세요'))
    } else await mutate(a.vault, (st) => finishRun(st, a.id, 'failed', { ms: o.ms, costUsd: o.costUsd, error: o.error }, now))
    tickSoon(2000) // 다음 항목
  })()
  await a.done
}

/** 지금 vault 의 점검 결과(시험 실행·화면용) */
export function currentScan(): { input: ProjectScan; rules: string } {
  const { files, index } = useApp.getState()
  const rules = readRules(files)
  return { input: collectFindings(buildWork(files).projects, files, rules, index), rules: rulesHash(files) }
}

export function runDry(ignoreSeen: boolean): Verdict[] {
  const { st, settings } = useAutomation.getState()
  if (!st) return []
  const { input, rules } = currentScan()
  return dryRun(st, input, settings, rules, Date.now(), ignoreSeen)
}

function runScan(opt?: ScanOptions) {
  const app = useApp.getState()
  const au = useAutomation.getState()
  const v = app.settings.activeVault
  if (!app.ready || !v || au.vault !== v || !au.st || app.syncing) return
  const first = au.st.initializedAt === null
  if (au.settings.mode === 'off' && !first && !opt?.baselineAll) return // 꺼져 있으면 점검하지 않는다(처음 한 번 기준선만 만든다)
  const { input, rules } = currentScan()
  const r = scan(au.st, input, au.settings, rules, Date.now(), opt)
  useAutomation.setState({ st: r.state })
  void saveAuto(v, r.state)
  if (r.queued.length && au.settings.mode !== 'off') {
    useApp.getState().say(t('AI 문서 관리: 새 문제 {n}건을 분석 대기열에 올렸어요', { n: r.queued.length }))
    tickSoon()
  }
}

export function startAutomation(): (() => void) | undefined {
  if (!desktop()) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let loadedVault: string | null = null
  let lastFiles: unknown = null
  const later = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => runScan(), ms)
  }
  const load = async (v: string) => {
    const st = await loadAuto(v)
    if (useApp.getState().settings.activeVault !== v) return // 그 사이 다른 vault 로 바뀌었다
    useAutomation.setState({ vault: v, st })
    later(3000)
    setTimeout(() => void tick(), 4000) // 노트·링크 색인이 자리 잡은 뒤 점검(처음이면 기준선)
  }
  const sync = (s: ReturnType<typeof useApp.getState>) => {
    if (!s.ready) return
    const v = s.settings.activeVault
    if (!v) return
    if (v !== loadedVault) {
      loadedVault = v
      lastFiles = s.files
      clearTimeout(timer)
      cancelActive() // 다른 vault 로 가면 진행 중인 분석을 멈춘다(그 vault 에는 중단으로 기록)
      useAutomation.setState({ vault: null, st: null, hold: null }) // 불러오는 동안 이전 vault 의 상태를 쓰지 않는다
      void load(v)
      return
    }
    if (s.files !== lastFiles) {
      lastFiles = s.files
      if (useAutomation.getState().settings.mode !== 'off') later(useAutomation.getState().settings.debounceSec * 1000)
    }
  }
  sync(useApp.getState())
  const unApp = useApp.subscribe(sync)
  // 사용자가 AI 와 대화를 마치면 자동 분석을 이어서 한다
  const unIdle = useAiThread.subscribe((s, p) => {
    if (p.running && !s.running) tickSoon(3000)
  })
  setAutoGate({
    busy: () => !!active,
    // 사용자의 질문이 먼저: 자동 분석을 멈추고(중단으로 기록) 끝날 때까지 잠깐 기다린다
    interrupt: async () => {
      const a = active
      if (!a) return
      cancelActive()
      await Promise.race([a.done, new Promise((r) => setTimeout(r, 8000))])
    },
  })
  const poll = setInterval(() => void tick(), 60_000) // 재시도 대기·다음 날 한도 같은 시간 조건
  type Battery = { charging: boolean; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void }
  const bat = (navigator as Navigator & { getBattery?: () => Promise<Battery> }).getBattery?.()
  let offBat = () => {}
  void bat?.then((b) => {
    charging = b.charging
    const on = () => {
      charging = b.charging
      tickSoon()
    }
    b.addEventListener('chargingchange', on)
    offBat = () => b.removeEventListener('chargingchange', on)
  }).catch(() => {})
  const unAi = onAiChange((paths) => {
    const st = useAutomation.getState().st
    if (!st) return
    const next = noteAiChange(st, paths, Date.now())
    useAutomation.setState({ st: next })
    const v = useAutomation.getState().vault
    if (v) void saveAuto(v, next)
  })
  return () => {
    clearTimeout(timer)
    clearTimeout(tickTimer)
    clearInterval(poll)
    cancelActive()
    setAutoGate(null)
    offBat()
    unApp()
    unAi()
    unIdle()
  }
}
