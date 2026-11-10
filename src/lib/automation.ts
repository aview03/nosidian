// AI 자동 문서 관리 — 스케줄러와 상태 저장소(PC 전용). 설계: docs/AUTOMATION.md
//
// v1.28: 문서 변경 → (모아서) 규칙 점검 → 새 문제 판정 → 분석 대기열 → 알림·시험 실행. AI 는 부르지 않는다.
// 앱이 켜져 있을 때만 돈다. 다시 열면 기준선과 비교해 쌓인 변경을 한 번 점검한다.
import { create } from 'zustand'
import { useApp } from './app'
import { onAiChange } from './aiChangeHook'
import {
  collectFindings, dismissItem, dryRun, noteAiChange, normalizeSettings, rulesHash, scan,
  type AutoSettings, type AutoState, type ProjectScan, type ScanOptions, type Verdict,
} from './autoTriggers'
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
}

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
  }
})

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
    later(3000) // 노트·링크 색인이 자리 잡은 뒤 점검(처음이면 기준선)
  }
  const sync = (s: ReturnType<typeof useApp.getState>) => {
    if (!s.ready) return
    const v = s.settings.activeVault
    if (!v) return
    if (v !== loadedVault) {
      loadedVault = v
      lastFiles = s.files
      clearTimeout(timer)
      useAutomation.setState({ vault: null, st: null }) // 불러오는 동안 이전 vault 의 상태를 쓰지 않는다
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
    unApp()
    unAi()
  }
}
