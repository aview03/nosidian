// 설정 > AI 연결 마법사의 순수 로직: 지금 연결 상태 요약과 모델 고르기.
import { providerOf, supportsTools, type LlmConfig, type ProviderKind } from './llm'
import type { ClaudeStatus } from './externalIO'
import type { PcLink } from './pcLink'
import { t } from './i18n'

export type EngineChoice = 'claude' | 'ollama'

export interface AiSummary {
  connected: boolean
  title: string
  sub?: string
}

/** 지금 AI 패널이 쓰는 연결을 한 줄로 */
export function aiSummary(engine: EngineChoice, claude: ClaudeStatus | null, cfg: LlmConfig | null, pc?: PcLink | null): AiSummary {
  if (engine === 'claude' && pc?.claude && !claude) return { connected: true, title: t('내 PC의 Claude로 연결됨'), sub: `${pc.name} · Claude Code` }
  if (engine === 'claude') {
    if (claude?.found && claude.loggedIn) return { connected: true, title: t('내 Claude 계정으로 연결됨'), sub: claude.version ? `Claude Code ${claude.version}` : 'Claude Code' }
    // 로컬 모델이 준비돼 있으면 그쪽 설명으로
    if (cfg && cfg.model && supportsTools(cfg.kind)) return { connected: false, title: t('아직 연결 안 됨'), sub: t('{name} 설정은 있어요. 연결을 바꿔 주세요.', { name: (cfg.kind === 'custom' ? t('내 서버') : providerOf(cfg.kind).label.split(' ')[0]) }) }
    return { connected: false, title: t('아직 연결 안 됨'), sub: t('AI를 연결하면 노트에 대해 묻고 정리를 맡길 수 있어요') }
  }
  if (cfg && cfg.model && supportsTools(cfg.kind)) {
    const local = cfg.kind === 'ollama' || cfg.kind === 'custom'
    if (cfg.viaPc) return { connected: true, title: t('내 PC의 AI로 연결됨'), sub: `${pc?.name ?? 'PC'} · ${cfg.model}` }
    return { connected: true, title: local ? t('내 컴퓨터의 AI로 연결됨') : t('API 키로 연결됨'), sub: `${(cfg.kind === 'custom' ? t('내 서버') : providerOf(cfg.kind).label.split(' ')[0])} · ${cfg.model}` }
  }
  return { connected: false, title: t('아직 연결 안 됨'), sub: t('AI를 연결하면 노트에 대해 묻고 정리를 맡길 수 있어요') }
}

/** 서버가 알려 준 모델 중 처음 쓰기 좋은 것(없으면 첫 번째). 제공자별 선호 순서 */
export function pickModel(kind: ProviderKind, models: string[]): string {
  if (!models.length) return ''
  const prefer: RegExp[] =
    kind === 'openai' ? [/^gpt-4\.1-mini$/, /^gpt-4o-mini$/, /^gpt-4\.1$/, /^gpt-4o$/, /^gpt-5-mini/]
    : kind === 'ollama' ? [/qwen3/, /llama3\.[1-3]/, /qwen2\.5/, /mistral/]
    : []
  for (const re of prefer) {
    const hit = models.find((m) => re.test(m))
    if (hit) return hit
  }
  return models[0]
}

/** 연결 방식 선택지 */
export type WizardWay = 'claude' | 'local' | 'key' | 'pc'

/** API 키로 연결할 수 있는 제공자(AI 패널이 도구 호출을 쓰므로 지원하는 것만) */
export const KEY_PROVIDERS: { kind: ProviderKind; ready: boolean }[] = [
  { kind: 'openai', ready: true },
  { kind: 'gemini', ready: false },
  { kind: 'anthropic', ready: false },
]

/** 내 컴퓨터에서 돌리는 AI */
export const LOCAL_PROVIDERS: { kind: ProviderKind; label: string; url: string }[] = [
  { kind: 'ollama', label: 'Ollama', url: 'http://localhost:11434' },
  { kind: 'custom', label: 'LM Studio', url: 'http://localhost:1234/v1' },
]

/** 연결 하나의 화면 이름: 직접 지은 이름이 있으면 그것, 없으면 "종류 · 주소" */
export function connectionTitle(c: LlmConfig): string {
  if (c.label?.trim()) return c.label.trim()
  const kindName = c.kind === 'custom' ? t('내 서버') : providerOf(c.kind).label.split(' ')[0]
  if (c.viaPc) return `PC · ${kindName}`
  if (c.kind === 'ollama' || c.kind === 'custom') {
    try {
      return `${kindName} · ${new URL(c.baseUrl).host}`
    } catch {
      return kindName
    }
  }
  return kindName
}

/** 연결의 종류 이름표 */
export function connectionBadge(c: LlmConfig): string {
  if (c.viaPc) return t('PC 경유')
  if (c.kind === 'ollama' || c.kind === 'custom') return t('내 컴퓨터')
  return t('API 키')
}

/** 연결의 설명 줄: 모델과(도구 호출을 못 하면) 이유 */
export function connectionSub(c: LlmConfig): string {
  const model = c.model || t('모델 안 고름')
  return supportsTools(c.kind) ? model : `${model} · ${t('도구 호출을 지원하지 않아 AI 패널에서는 쓸 수 없어요')}`
}

/** 지금 연결돼 있는 AI 개수: Claude 구독(있으면 1) + 연결 목록 */
export function countConnected(claudeReady: boolean, conns: LlmConfig[]): number {
  return (claudeReady ? 1 : 0) + conns.length
}

/** 목록 행이 "지금 사용 중"인지. Claude 는 엔진이 claude 일 때, 연결은 엔진이 ollama 이고 선택된 연결일 때 */
export const isInUse = (engine: EngineChoice, selectedId: string | null, rowId: string | 'claude') => (rowId === 'claude' ? engine === 'claude' : engine === 'ollama' && selectedId === rowId)

/** 패널 선택 상자 버튼에 보일 짧은 이름: "Ollama", "OpenAI", "Claude API", "PC Ollama" */
export function engineShortName(c: LlmConfig): string {
  const name = c.kind === 'ollama' ? 'Ollama' : c.kind === 'custom' ? t('내 서버') : c.kind === 'anthropic' ? 'Claude API' : c.kind === 'gemini' ? 'Gemini' : 'OpenAI'
  return (c.viaPc ? 'PC ' : '') + name
}
