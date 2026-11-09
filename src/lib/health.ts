// 프로젝트 건강도(시스템 점검): 업무에서 매번 계산하는 파생 값이다. 저장하지 않는다.
//
// 원칙
//  - 사람이 프로젝트 노트에 적은 `health:`(판단)와 따로 보여 준다. 이 값은 "기계가 센 것"일 뿐이다.
//  - 문턱은 한 곳에 둔다: vault 안의 설정 노트(_workspace/설정.md 의 프론트매터). 기기별 설정이 아니라서 팀원 모두 같은 값을 쓰고 노트와 함께 동기화된다.
//  - 정의가 불확실한 지표(업무량, 며칠째 멈춘 일 등)는 만들지 않는다. 변경 시각을 줄 단위로 믿을 수 없기 때문이다.
import { diffDays, type Task } from './work'
import type { NoteFile } from './types'
import { splitFrontmatter } from './links'

export const SETTINGS_PATH = '_workspace/설정.md'

export type SignalKey = 'overdue' | 'decisionLate' | 'waitingLate' | 'unowned'
export type Level = 'ok' | 'warn' | 'risk'
/** [주의 문턱, 위험 문턱]: 개수가 이 값 이상이면 해당 단계 */
export type Thresholds = Record<SignalKey, [number, number]>

export const DEFAULT_THRESHOLDS: Thresholds = {
  overdue: [1, 3],
  decisionLate: [1, 2],
  waitingLate: [1, 3],
  unowned: [2, 5],
}

const FM_KEY: Record<SignalKey, string> = { overdue: 'overdue', decisionLate: 'decision_late', waitingLate: 'waiting_late', unowned: 'unowned' }

/** 설정 노트에서 문턱을 읽는다. 없거나 잘못된 값은 기본값 */
export function readThresholds(files: Record<string, NoteFile>): Thresholds {
  const out: Thresholds = { overdue: [...DEFAULT_THRESHOLDS.overdue], decisionLate: [...DEFAULT_THRESHOLDS.decisionLate], waitingLate: [...DEFAULT_THRESHOLDS.waitingLate], unowned: [...DEFAULT_THRESHOLDS.unowned] }
  const f = files[SETTINGS_PATH]
  if (!f || f.deleted || !f.content.startsWith('---')) return out
  const { fm } = splitFrontmatter(f.content)
  for (const k of Object.keys(FM_KEY) as SignalKey[]) {
    const warn = Number(fm[`health_${FM_KEY[k]}_warn`])
    const risk = Number(fm[`health_${FM_KEY[k]}_risk`])
    if (Number.isFinite(warn) && warn >= 1) out[k][0] = Math.floor(warn)
    if (Number.isFinite(risk) && risk >= 1) out[k][1] = Math.floor(risk)
    if (out[k][1] < out[k][0]) out[k][1] = out[k][0] // 위험 문턱이 주의보다 낮을 수 없다
  }
  return out
}

export interface Signal {
  key: SignalKey
  count: number
  level: Exclude<Level, 'ok'>
}
export interface Health {
  level: Level
  /** 문턱을 넘은 신호만, 심각한 것부터 */
  signals: Signal[]
}

/** 프로젝트 하나의 점검. 열린 일이 없으면 null(판단할 신호가 없다) */
export function projectHealth(tasks: Task[], today: string, th: Thresholds = DEFAULT_THRESHOLDS): Health | null {
  const open = tasks.filter((x) => !x.done && x.state !== 'dropped')
  if (open.length === 0) return null
  const late = (x: Task) => !!x.due && diffDays(today, x.due) > 0
  const count: Record<SignalKey, number> = {
    decisionLate: open.filter((x) => x.kind === 'decision' && late(x)).length,
    waitingLate: open.filter((x) => x.kind !== 'decision' && (x.state === 'waiting' || x.side === 'other') && late(x)).length,
    overdue: open.filter((x) => x.kind !== 'decision' && x.state !== 'waiting' && x.side !== 'other' && late(x)).length,
    unowned: open.filter((x) => x.owner.length === 0).length,
  }
  const signals: Signal[] = []
  for (const k of Object.keys(count) as SignalKey[]) {
    const n = count[k]
    if (n >= th[k][1]) signals.push({ key: k, count: n, level: 'risk' })
    else if (n >= th[k][0]) signals.push({ key: k, count: n, level: 'warn' })
  }
  signals.sort((a, b) => Number(b.level === 'risk') - Number(a.level === 'risk') || b.count - a.count)
  const level: Level = signals.some((s) => s.level === 'risk') ? 'risk' : signals.length ? 'warn' : 'ok'
  return { level, signals }
}

/** 설정 노트의 첫 내용. 문턱마다 "왜 이 값인가"를 적을 자리를 둔다 */
export function settingsNoteContent(): string {
  const d = DEFAULT_THRESHOLDS
  return `---
type: settings
health_overdue_warn: ${d.overdue[0]}
health_overdue_risk: ${d.overdue[1]}
health_decision_late_warn: ${d.decisionLate[0]}
health_decision_late_risk: ${d.decisionLate[1]}
health_waiting_late_warn: ${d.waitingLate[0]}
health_waiting_late_risk: ${d.waitingLate[1]}
health_unowned_warn: ${d.unowned[0]}
health_unowned_risk: ${d.unowned[1]}
---
# 작업공간 설정

프로젝트 건강도(내 업무의 프로젝트 줄·허브에 나오는 "점검")를 정하는 기준입니다. 이 노트는 팀이 함께 쓰는 값이니 바꿀 때는 **이유를 같이 적어 주세요.**
숫자는 "그 개수 이상이면" 주의(warn)·위험(risk)입니다. 위 머리말의 숫자를 고치면 바로 반영됩니다.

| 신호 | 세는 것 | 기본(주의/위험) | 이 값인 이유 |
|---|---|---|---|
| overdue | 기한이 지난 일 | ${d.overdue[0]} / ${d.overdue[1]} | (이유를 적어 주세요) |
| decision_late | 다시 확인할 날이 지난 결정 안건 | ${d.decisionLate[0]} / ${d.decisionLate[1]} | (이유를 적어 주세요) |
| waiting_late | 기한이 지난 대기(상대 차례) 일 | ${d.waitingLate[0]} / ${d.waitingLate[1]} | (이유를 적어 주세요) |
| unowned | 담당자 없는 열린 일 | ${d.unowned[0]} / ${d.unowned[1]} | (이유를 적어 주세요) |

사람이 프로젝트 노트에 적는 \`health:\` 는 이 점검과 별개로 따로 표시됩니다.
`
}
