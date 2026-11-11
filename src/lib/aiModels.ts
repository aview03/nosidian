// 연결마다 "쓸 수 있는 모델 목록"과 AI 패널의 `연결 › 모델` 선택. 설계: docs/AI-CONNECTIONS.md §5
//  - 목록은 연결 서버가 알려 주는 것(listModels)을 연결 레코드에 캐시해 둔다(`models: { list, at }`). 오프라인이어도 마지막 목록을 보여 준다.
//  - 하루가 지났거나 없으면 백그라운드로 새로 가져온다(실패는 조용히 건너뛰고 10분 안에는 다시 시도하지 않는다). 설정에서는 직접 새로 고칠 수 있다.
//  - 지금 쓰는 모델은 목록에 없어도(서버가 안 알려 줬거나 직접 입력) 항상 목록에 넣는다.
import { connectionById, listConnections, setSelected, updateConnection, type AiConnection, type Selected } from './aiConnections'
import { supportsTools, toLlmConfig, type LlmConfig } from './llm'
import { listModels } from './llmNet'
import { connectionTitle, engineShortName, type EngineChoice } from './aiWizard'
import { t } from './i18n'

/** 모델 목록을 다시 가져오는 간격 */
export const MODELS_TTL_MS = 24 * 3600_000
/** 실패한 연결을 다시 시도하기까지의 최소 간격 */
export const RETRY_MS = 10 * 60_000
/** 한 연결에서 패널 목록에 보여 주는 모델 수(OpenAI 처럼 아주 긴 목록 방지) */
export const MAX_SHOWN = 60

/** AI 패널 선택 상자의 항목(Select 의 Option 과 같은 모양) */
export interface PanelOption {
  value: string
  label: string
  hint?: string
  group?: string
  disabled?: boolean
  buttonLabel?: string
}

export const optionValue = (connId: string, model: string) => `${connId}::${model}`
/** 'claude' 또는 `연결id::모델` */
export function parseOptionValue(v: string): { claude: true } | { claude: false; conn: string; model: string } | null {
  if (v === 'claude') return { claude: true }
  const i = v.indexOf('::')
  if (i <= 0) return null
  return { claude: false, conn: v.slice(0, i), model: v.slice(i + 2) }
}

/** 한 연결에서 보여 줄 모델들: 서버가 알려 준 순서를 지키되 지금 쓰는 모델은 꼭 넣는다 */
export function modelList(c: AiConnection): string[] {
  const cur = c.model.trim()
  let shown = (c.models?.list ?? []).slice(0, MAX_SHOWN)
  if (cur && !shown.includes(cur)) shown = [cur, ...shown.slice(0, MAX_SHOWN - 1)]
  return shown
}

/** 패널 선택 상자의 항목들: (Claude 구독) + 연결마다 묶음(제목=연결 이름, 항목=모델). 도구 호출을 못 하는 연결은 비활성 + 이유 */
export function panelOptions(claudeAvailable: boolean, conns: AiConnection[]): PanelOption[] {
  const out: PanelOption[] = []
  if (claudeAvailable) out.push({ value: 'claude', label: t('Claude (구독)') })
  for (const c of conns) {
    const cfg = toLlmConfig(c)
    if (!cfg) continue
    const group = connectionTitle(cfg)
    const tools = supportsTools(cfg.kind)
    const list = modelList(c)
    if (!list.length) {
      out.push({ value: optionValue(c.id, ''), label: t('모델 안 고름'), group, disabled: true })
      continue
    }
    for (const m of list) {
      out.push({ value: optionValue(c.id, m), label: m, group, buttonLabel: `${engineShortName(cfg)} ${m}`, ...(tools ? {} : { disabled: true, hint: t('도구 호출 미지원') }) })
    }
  }
  return out
}

/** 지금 선택돼 있는 항목의 값 */
export function selectedValue(engine: EngineChoice, conns: AiConnection[], selected: Selected | null): string {
  if (engine === 'claude') return 'claude'
  const c = conns.find((x) => x.id === selected?.conn) ?? conns[0]
  if (!c) return ''
  return optionValue(c.id, selected && selected.conn === c.id && selected.model ? selected.model : c.model)
}

/** 이 연결에서 쓸 모델을 정한다: 연결의 기본 모델로 저장하고 그 연결을 선택한다 */
export function chooseModel(connId: string, model: string) {
  updateConnection(connId, { model })
  setSelected(connId, model)
}

// ── 목록 가져오기 ──
export const isStale = (c: AiConnection, now: number) => !c.models || now - c.models.at > MODELS_TTL_MS

/** 서버에서 모델 목록을 가져와 연결에 저장한다. 실패하면 던진다(저장돼 있던 목록은 그대로) */
export async function refreshModels(id: string): Promise<string[]> {
  const cfg: LlmConfig | null = toLlmConfig(connectionById(id))
  if (!cfg) throw new Error('no connection')
  const list = await listModels(cfg)
  updateConnection(id, { models: { list, at: Date.now() } })
  return list
}

const lastTry = new Map<string, number>()
/** 낡았거나 없는 연결의 목록만 순서대로 새로 가져온다. 실패는 삼키고, 같은 연결은 RETRY_MS 안에 다시 시도하지 않는다 */
export async function refreshStaleModels(now = Date.now(), refresh: (id: string) => Promise<unknown> = refreshModels): Promise<void> {
  for (const c of listConnections()) {
    if (!isStale(c, now)) continue
    if (now - (lastTry.get(c.id) ?? -Infinity) < RETRY_MS) continue
    lastTry.set(c.id, now)
    try {
      await refresh(c.id)
    } catch {
      /* 연결이 안 되면(꺼진 PC·오프라인) 마지막 목록(또는 현재 모델)만 보여 준다 */
    }
  }
}
/** 시험용 */
export const _resetRetry = () => lastTry.clear()
