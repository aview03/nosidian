// AI 자동 문서 관리 — 트리거 판단(순수 함수). docs/AUTOMATION.md
//
// 규칙 검사(doclint)는 항상 돌고, AI 분석은 "이전에 없던 문제"가 조건에 맞을 때만 대기열에 오른다.
// v1.28 은 대기열·알림까지(AI 호출 없음). 여기의 모든 함수는 시간·저장소를 직접 쓰지 않는다.
import { contentHash } from './docpolicy'
import { DOCRULES_PATH, profileFor, type DocRules } from './docrules'
import { lintProject, type LintKind } from './doclint'
import type { LinkIndex } from './links'
import { MAX_READ } from './mcpTools'
import type { NoteFile } from './types'
import type { Project } from './work'

// ── 설정(기기별) ──────────────────────────────────────────────
export type AutoMode = 'off' | 'notify' | 'analyze'
export interface AutoSettings {
  mode: AutoMode
  triggers: { duplicate: boolean; roleIssue: boolean }
  /** Claude 로 자동 분석해도 되는지(노트 내용이 Anthropic 으로 나간다). 기본 꺼짐 */
  claudeConsent: boolean
  engine: 'panel' | 'ollama'
  dailyCap: number
  debounceSec: number
  holdOnBattery: boolean
  paused: boolean
  /** 자동 관리에서 뺀 프로젝트(프로젝트 노트 경로) */
  excluded: string[]
}
export const CAPS = [1, 3, 5, 10]
export const DEBOUNCES = [30, 120, 300]
export const DEFAULT_AUTO: AutoSettings = {
  mode: 'off',
  triggers: { duplicate: true, roleIssue: true },
  claudeConsent: false,
  engine: 'panel',
  dailyCap: 3,
  debounceSec: 30,
  holdOnBattery: false,
  paused: false,
  excluded: [],
}
export function normalizeSettings(raw: unknown): AutoSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tr = (r.triggers && typeof r.triggers === 'object' ? r.triggers : {}) as Record<string, unknown>
  const pick = (v: unknown, list: number[], d: number) => (typeof v === 'number' && list.includes(v) ? v : d)
  return {
    mode: r.mode === 'notify' || r.mode === 'analyze' ? r.mode : 'off',
    triggers: { duplicate: tr.duplicate !== false, roleIssue: tr.roleIssue !== false },
    claudeConsent: r.claudeConsent === true,
    engine: r.engine === 'ollama' ? 'ollama' : 'panel',
    dailyCap: pick(r.dailyCap, CAPS, DEFAULT_AUTO.dailyCap),
    debounceSec: pick(r.debounceSec, DEBOUNCES, DEFAULT_AUTO.debounceSec),
    holdOnBattery: r.holdOnBattery === true,
    paused: r.paused === true,
    excluded: Array.isArray(r.excluded) ? r.excluded.filter((x): x is string => typeof x === 'string') : [],
  }
}

// ── 문제(Finding) ────────────────────────────────────────────
/** AI 판단이 필요한 종류만 트리거가 된다. 제목·status·링크 같은 기계적 문제는 알려 주기만 한다 */
export type Trigger = 'duplicate' | 'roleIssue'
const TRIGGER_OF: Partial<Record<LintKind, Trigger>> = {
  duplicate: 'duplicate',
  singletonDup: 'roleIssue',
  roleConflict: 'roleIssue',
  roleMisplaced: 'roleIssue',
}

export interface Finding {
  /** 문제의 정체성: 종류 + 프로젝트 + 관련 노트 + 값. 노트 내용이 바뀌어도 같은 문제는 같은 id */
  id: string
  kind: LintKind
  project: string
  projectName: string
  paths: string[]
  text?: string
  text2?: string
  /** 분석 시점의 노트 버전(내용 해시) */
  hashes: Record<string, string>
  truncated: boolean
  trigger: Trigger | null
}

export const rulesHash = (files: Record<string, NoteFile>) => contentHash(files[DOCRULES_PATH]?.content ?? '')

/** 분석 캐시 키: 정체성 + 관련 노트 버전 + 규칙 버전 */
export const cacheKeyOf = (f: Finding, rules: string) => `${f.id}#${Object.keys(f.hashes).sort().map((p) => f.hashes[p]).join(',')}#${rules}`

export interface ProjectScan {
  /** 점검 대상 프로젝트(문서 규칙 프로필이 있는 것) */
  active: string[]
  findings: Finding[]
}

export function collectFindings(projects: Project[], files: Record<string, NoteFile>, rules: DocRules, index: LinkIndex): ProjectScan {
  const active: string[] = []
  const byId = new Map<string, Finding>()
  for (const project of projects) {
    const profile = profileFor(rules, project.fm)
    if (!profile) continue
    active.push(project.path)
    for (const it of lintProject(project, files, rules, profile, index).items) {
      const paths = [...new Set([it.path, ...(it.others ?? [])])].sort()
      const id = [it.kind, project.path, paths.join('+'), it.text ?? '', it.text2 ?? ''].join('|')
      if (byId.has(id)) continue // 중복 후보는 짝의 양쪽에서 보고될 수 있다
      const hashes: Record<string, string> = {}
      let truncated = false
      for (const p of paths) {
        const f = files[p]
        if (!f || f.deleted) continue
        hashes[p] = contentHash(f.content)
        if (f.content.length > MAX_READ) truncated = true
      }
      byId.set(id, { id, kind: it.kind, project: project.path, projectName: project.name, paths, text: it.text, text2: it.text2, hashes, truncated, trigger: TRIGGER_OF[it.kind] ?? null })
    }
  }
  return { active, findings: mergeDuplicateClusters([...byId.values()], files) }
}

/** 서로 겹치는 중복 후보 쌍들(A↔B, B↔C, A↔C)은 한 묶음으로 합친다 — 같은 문제를 여러 번 분석하지 않도록 */
function mergeDuplicateClusters(findings: Finding[], files: Record<string, NoteFile>): Finding[] {
  const dups = findings.filter((f) => f.kind === 'duplicate')
  if (dups.length < 2) return findings
  const out = findings.filter((f) => f.kind !== 'duplicate')
  const byProject = new Map<string, Finding[]>()
  for (const d of dups) byProject.set(d.project, [...(byProject.get(d.project) ?? []), d])
  for (const [project, list] of byProject) {
    const groups: Finding[][] = []
    for (const d of list) {
      const hit = groups.filter((g) => g.some((x) => x.paths.some((p) => d.paths.includes(p))))
      const merged = [d, ...hit.flat()]
      for (const g of hit) groups.splice(groups.indexOf(g), 1)
      groups.push(merged)
    }
    for (const g of groups) {
      const paths = [...new Set(g.flatMap((x) => x.paths))].sort()
      const hashes: Record<string, string> = {}
      for (const p of paths) if (files[p] && !files[p].deleted) hashes[p] = contentHash(files[p].content)
      out.push({ ...g[0], id: ['duplicate', project, paths.join('+'), '', ''].join('|'), paths, hashes, truncated: g.some((x) => x.truncated) })
    }
  }
  return out
}

// ── 상태(vault 별, 기기에 저장) ──────────────────────────────
export interface SeenEntry { first: number; origin: 'baseline' | 'detected' }
export type ItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'dismissed' | 'resolved'
export interface QueueItem {
  id: string
  cacheKey: string
  kind: LintKind
  project: string
  projectName: string
  paths: string[]
  text?: string
  text2?: string
  /** 대기열에 올린 시점의 노트 버전 */
  hashes: Record<string, string>
  createdAt: number
  status: ItemStatus
  /** 실패한 시도 횟수(사용자의 중단은 세지 않는다) */
  attempts: number
  interrupted: number
  /** 실패한 뒤 이 시각 전에는 다시 시도하지 않는다 */
  retryAt?: number
  /** v1.29: AI 분석 결과. 분석한 때의 노트 버전을 함께 보관한다 */
  result?: { plan: string; at: number; hashes: Record<string, string> }
}
export interface UsageEntry {
  at: number
  id: string
  outcome: 'done' | 'failed' | 'interrupted'
  ms: number
  costUsd?: number
}
export type SkipReason = 'baseline' | 'known' | 'analyzed' | 'aiExcluded' | 'truncated' | 'mechanical' | 'triggerOff' | 'projectOff' | 'capReached'
export interface ScanEvent {
  at: number
  type: 'baseline' | 'finding'
  count?: number
  id?: string
  kind?: LintKind
  projectName?: string
  paths?: string[]
  decision?: 'queue' | 'wait' | 'skip'
  reason?: SkipReason
}
export interface AutoState {
  v: 1
  /** 처음 점검해 기준선을 만든 시각(없으면 아직 안 만듦) */
  initializedAt: number | null
  /** 이미 알고 있는 문제. 사라지면 지운다(다시 생기면 새 문제) */
  seen: Record<string, SeenEntry>
  /** 기준선을 확정한 프로젝트(규칙을 새로 켠 프로젝트의 기존 문제가 새 문제가 되지 않게) */
  baselined: string[]
  analyzed: Record<string, number>
  queue: QueueItem[]
  usage: UsageEntry[]
  /** AI 가 바꾼(사용자가 승인해 반영한) 경로와 시각 */
  aiTouched: Record<string, number>
  log: ScanEvent[]
  lastScan: number
}
export const emptyState = (): AutoState => ({ v: 1, initializedAt: null, seen: {}, baselined: [], analyzed: {}, queue: [], usage: [], aiTouched: {}, log: [], lastScan: 0 })

export const AI_EXCLUDE_MS = 24 * 3600_000
export const RETRY_MS = 3600_000
export const MAX_FAILS = 3
const KEEP = { log: 200, usage: 30 * 24 * 3600_000, queue: 200, queueAge: 30 * 24 * 3600_000 }

const dayOf = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
/** 오늘 소모한 분석 횟수. 사용자의 중단은 세지 않는다 */
export const usedToday = (usage: UsageEntry[], now: number) => usage.filter((u) => u.outcome !== 'interrupted' && dayOf(u.at) === dayOf(now)).length
/** 가장 최근부터 끊김 없이 이어진 실패 횟수(중단은 건너뛰고, 성공에서 멈춘다) */
export function consecutiveFailures(usage: UsageEntry[]): number {
  let n = 0
  for (let i = usage.length - 1; i >= 0; i--) {
    if (usage[i].outcome === 'interrupted') continue
    if (usage[i].outcome === 'failed') n++
    else break
  }
  return n
}

// ── 판정 ────────────────────────────────────────────────────
export interface Verdict {
  finding: Finding
  decision: 'queue' | 'wait' | 'skip'
  reason?: SkipReason
}
export interface ClassifyCtx {
  st: AutoState
  settings: AutoSettings
  rules: string
  now: number
  /** 이미 대기열에 있거나 이번 점검에서 올린 수 */
  ahead: number
  /** 시험 실행용: 알고 있던 문제도 새 문제인 것처럼 판정 */
  ignoreSeen?: boolean
}

export function classify(f: Finding, c: ClassifyCtx): Verdict {
  const skip = (reason: SkipReason): Verdict => ({ finding: f, decision: 'skip', reason })
  if (c.settings.excluded.includes(f.project)) return skip('projectOff')
  const seen = c.st.seen[f.id]
  if (seen && !c.ignoreSeen) return skip(seen.origin === 'baseline' ? 'baseline' : 'known')
  if (!f.trigger) return skip('mechanical')
  if (!c.settings.triggers[f.trigger]) return skip('triggerOff')
  if (c.st.analyzed[cacheKeyOf(f, c.rules)]) return skip('analyzed')
  if (f.paths.some((p) => c.now - (c.st.aiTouched[p] ?? -Infinity) < AI_EXCLUDE_MS)) return skip('aiExcluded')
  if (f.truncated) return skip('truncated')
  if (c.ahead >= c.settings.dailyCap - usedToday(c.st.usage, c.now)) return { finding: f, decision: 'wait', reason: 'capReached' }
  return { finding: f, decision: 'queue' }
}

/** 시험 실행: 상태를 바꾸지 않고 지금 문제 전체에 판정을 매긴다 */
export function dryRun(st: AutoState, scan: ProjectScan, settings: AutoSettings, rules: string, now: number, ignoreSeen: boolean): Verdict[] {
  const now0 = new Set(scan.findings.map((f) => f.id))
  let ahead = st.queue.filter((q) => (q.status === 'queued' || q.status === 'running') && !now0.has(q.id)).length // 지금 문제에 해당하는 대기 항목은 아래에서 다시 판정한다
  return scan.findings.map((f) => {
    const v = classify(f, { st, settings, rules, now, ahead, ignoreSeen })
    if (v.decision !== 'skip') ahead++
    return v
  })
}

export interface ScanOptions {
  /** 지금 있는 문제를 전부 기준선으로 */
  baselineAll?: boolean
}
export interface ScanResult {
  state: AutoState
  /** 새로 대기열에 오른 항목 */
  queued: QueueItem[]
  events: ScanEvent[]
}

/** 점검 결과를 상태에 반영한다: 새 문제를 판정해 대기열에 올리고, 사라진 문제를 정리한다 */
export function scan(prev: AutoState, input: ProjectScan, settings: AutoSettings, rules: string, now: number, opt: ScanOptions = {}): ScanResult {
  const st: AutoState = { ...prev, seen: { ...prev.seen }, queue: prev.queue.map((q) => ({ ...q })), log: [...prev.log], aiTouched: { ...prev.aiTouched } }
  const events: ScanEvent[] = []
  const queued: QueueItem[] = []
  const firstRun = prev.initializedAt === null
  const newProjects = input.active.filter((p) => !prev.baselined.includes(p))
  let baselineCount = 0
  let ahead = st.queue.filter((q) => q.status === 'queued' || q.status === 'running').length

  for (const f of input.findings) {
    if (st.seen[f.id]) continue
    // 처음 점검하거나, 이 프로젝트의 점검을 처음 시작했거나, 켤 때 지금 있는 문제를 기준선으로 확정한다
    if (opt.baselineAll || firstRun || newProjects.includes(f.project)) {
      st.seen[f.id] = { first: now, origin: 'baseline' }
      baselineCount++
      continue
    }
    const v = classify(f, { st, settings, rules, now, ahead })
    st.seen[f.id] = { first: now, origin: 'detected' }
    const ev: ScanEvent = { at: now, type: 'finding', id: f.id, kind: f.kind, projectName: f.projectName, paths: f.paths, decision: v.decision, reason: v.reason }
    events.push(ev)
    if (v.decision !== 'skip') {
      const item: QueueItem = { id: f.id, cacheKey: cacheKeyOf(f, rules), kind: f.kind, project: f.project, projectName: f.projectName, paths: f.paths, text: f.text, text2: f.text2, hashes: f.hashes, createdAt: now, status: 'queued', attempts: 0, interrupted: 0 }
      st.queue = [...st.queue.filter((q) => q.id !== f.id), item]
      queued.push(item)
      ahead++
    }
  }
  if (baselineCount) events.unshift({ at: now, type: 'baseline', count: baselineCount })

  // 사라진 문제 정리: 알고 있던 문제에서 빼고(다시 생기면 새 문제), 아직 분석 전인 대기 항목은 해결됨으로
  const live = new Set(input.findings.map((f) => f.id))
  for (const id of Object.keys(st.seen)) if (!live.has(id)) delete st.seen[id]
  st.queue = st.queue.map((q) => (!live.has(q.id) && (q.status === 'queued' || q.status === 'failed') ? { ...q, status: 'resolved' as const } : q))

  st.baselined = [...input.active]
  st.initializedAt = prev.initializedAt ?? now
  st.lastScan = now
  st.log = [...st.log, ...events].slice(-KEEP.log)
  return { state: prune(st, now), queued, events }
}

export function prune(st: AutoState, now: number): AutoState {
  const aiTouched: Record<string, number> = {}
  for (const [p, at] of Object.entries(st.aiTouched)) if (now - at < AI_EXCLUDE_MS * 2) aiTouched[p] = at
  const open = (q: QueueItem) => q.status === 'queued' || q.status === 'running' || (q.result !== undefined && q.status === 'done')
  const queue = st.queue.filter((q) => open(q) || now - q.createdAt < KEEP.queueAge).slice(-KEEP.queue)
  return { ...st, aiTouched, queue, usage: st.usage.filter((u) => now - u.at < KEEP.usage) }
}

// ── 실행 기록(v1.29 가 쓴다. 중단과 실패를 구분한다) ────────────
export function startRun(st: AutoState, id: string): AutoState {
  return { ...st, queue: st.queue.map((q) => (q.id === id ? { ...q, status: 'running' as const } : q)) }
}
export interface RunInfo { ms: number; costUsd?: number; plan?: string; hashes?: Record<string, string> }
export function finishRun(st: AutoState, id: string, outcome: UsageEntry['outcome'], info: RunInfo, now: number): AutoState {
  const q = st.queue.find((x) => x.id === id)
  if (!q) return st
  // 이미 발생한 사용량은 결과와 상관없이 기록한다
  const usage = [...st.usage, { at: now, id, outcome, ms: info.ms, ...(info.costUsd !== undefined ? { costUsd: info.costUsd } : {}) }]
  let next: QueueItem
  let analyzed = st.analyzed
  if (outcome === 'done') {
    next = { ...q, status: 'done', result: { plan: info.plan ?? '', at: now, hashes: info.hashes ?? q.hashes } }
    analyzed = { ...st.analyzed, [q.cacheKey]: now }
  } else if (outcome === 'interrupted') {
    next = { ...q, status: 'queued', interrupted: q.interrupted + 1 } // 실패도 한도도 소모하지 않고 나중에 이어서
  } else {
    const attempts = q.attempts + 1
    next = attempts >= 2 ? { ...q, status: 'failed', attempts } : { ...q, status: 'queued', attempts, retryAt: now + RETRY_MS }
  }
  return { ...st, usage, analyzed, queue: st.queue.map((x) => (x.id === id ? next : x)) }
}

/** 다음에 분석할 항목(한도·재시도 대기·자동화 일시정지 반영). 없으면 null */
export function nextRunnable(st: AutoState, settings: AutoSettings, now: number): QueueItem | null {
  if (settings.paused || settings.mode !== 'analyze') return null
  if (consecutiveFailures(st.usage) >= MAX_FAILS) return null
  if (usedToday(st.usage, now) >= settings.dailyCap) return null
  return st.queue.find((q) => q.status === 'queued' && (q.retryAt ?? 0) <= now) ?? null
}

// ── 문서 버전 ───────────────────────────────────────────────
/** 분석(또는 대기열 등록) 뒤 관련 노트가 바뀌었는가 */
export function changedPaths(hashes: Record<string, string>, files: Record<string, NoteFile>): string[] {
  return Object.keys(hashes).filter((p) => {
    const f = files[p]
    return !f || f.deleted || contentHash(f.content) !== hashes[p]
  })
}
/** AI 분석 결과가 오래됐는가: 오래된 정리 계획은 그대로 실행하지 않는다 */
export const isStale = (q: QueueItem, files: Record<string, NoteFile>) => !!q.result && changedPaths(q.result.hashes, files).length > 0
export const canExecutePlan = (q: QueueItem, files: Record<string, NoteFile>) => !!q.result && !isStale(q, files)

/** 사용자가 승인해 AI 변경이 반영된 경로를 기록한다(AI → 변경 → 재분석 반복 방지) */
export function noteAiChange(st: AutoState, paths: string[], now: number): AutoState {
  const aiTouched = { ...st.aiTouched }
  for (const p of paths) aiTouched[p] = now
  return { ...st, aiTouched }
}

export function dismissItem(st: AutoState, id: string): AutoState {
  return { ...st, queue: st.queue.map((q) => (q.id === id ? { ...q, status: 'dismissed' as const } : q)) }
}

/** 설정 화면에 보여 줄 "이 설정이면 이렇게 동작해요" 한 줄 */
export function describePolicy(s: AutoSettings): string {
  if (s.mode === 'off') return '자동 관리를 쓰지 않아요. 문서 점검 탭에서 직접 [AI로 고치기]를 누를 때만 AI 가 일해요.'
  const names = [s.triggers.duplicate && '새 중복 후보', s.triggers.roleIssue && '역할 충돌'].filter(Boolean).join('·') || '선택된 트리거 없음'
  const wait = s.debounceSec >= 60 ? `${s.debounceSec / 60}분` : `${s.debounceSec}초`
  if (s.mode === 'notify') return `문서가 바뀌고 ${wait} 뒤 점검해서 ${names} 문제가 새로 생기면 알려 줘요. AI 는 부르지 않아요.`
  return `문서가 바뀌고 ${wait} 뒤 점검해서 ${names} 문제가 새로 생기면 하루 최대 ${s.dailyCap}회 AI 가 읽기 전용으로 분석해 정리 계획을 만들어요. 문서는 자동으로 수정하지 않아요.`
}
