// LLM 연결 인터페이스: 어떤 AI 서버든 같은 모양으로 부르기 위한 순수 부분(요청 만들기·응답 읽기·설정 검증).
//
// 지원: Ollama(내 PC·홈 서버) · OpenAI 호환 API(LM Studio·vLLM 등 "사용자 지정" 포함) · OpenAI · Anthropic · Gemini.
//  - 실제 네트워크 호출은 llmNet.ts 가 한다(PC 는 메인 프로세스, Android 는 네이티브 HTTP). 여기서는 요청 객체만 만든다.
//  - 사용자가 서버 주소(baseUrl)까지 직접 정한다 — 특정 업체에 묶이지 않고, 운영자가 중앙 AI 서버를 둘 필요가 없다.
//  - OpenAI·Anthropic·Gemini 의 요청 형식은 공식 문서 기준으로 만들었지만 실제 서버로는 시험하지 못했다(키가 없음). Ollama·OpenAI 호환은 가짜 서버로 시험했다.
//  - API 키는 이 기기에만 둔다(vault·동기화에 넣지 않는다).

export type ProviderKind = 'ollama' | 'openai' | 'custom' | 'anthropic' | 'gemini'

export interface LlmConfig {
  kind: ProviderKind
  /** 서버 주소. 예) http://192.168.0.10:11434 · https://api.openai.com/v1 */
  baseUrl: string
  model: string
  /** 클라우드 API 키(없어도 되는 서버도 있다). PC 는 보안 저장소로 옮기므로 보통 비어 있다 */
  apiKey?: string
  /** 키가 운영체제 보안 저장소(메인 프로세스)에 있다. 화면은 키를 모르고, 요청에는 자리표시자만 넣는다 */
  keyStored?: boolean
}

/** 요청 헤더에 넣는 키 자리표시자. 메인 프로세스가 보안 저장소의 실제 키로 바꿔 보낸다 */
export const KEY_PLACEHOLDER = '{{KEY}}'

/** 요청을 만들 때 쓸 설정: 키가 보안 저장소에 있으면 자리표시자를 쓴다 */
export const forRequest = (cfg: LlmConfig): LlmConfig => (cfg.keyStored ? { ...cfg, apiKey: KEY_PLACEHOLDER } : cfg)

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface HttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

export const PROVIDERS: { kind: ProviderKind; label: string; url: string; needsKey: boolean; hint: string }[] = [
  { kind: 'ollama', label: 'Ollama (내 PC · 홈 서버)', url: 'http://localhost:11434', needsKey: false, hint: '다른 기기에서 쓰려면 PC 의 Ollama 를 OLLAMA_HOST=0.0.0.0:11434 로 실행하고, 방화벽에서 같은 사설망만 허용하세요.' },
  { kind: 'custom', label: '사용자 지정 (OpenAI 호환: LM Studio · vLLM …)', url: 'http://localhost:1234/v1', needsKey: false, hint: '/v1 까지 포함한 주소를 적어 주세요.' },
  { kind: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', needsKey: true, hint: '' },
  { kind: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com', needsKey: true, hint: '' },
  { kind: 'gemini', label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com', needsKey: true, hint: '' },
]
export const providerOf = (kind: ProviderKind) => PROVIDERS.find((p) => p.kind === kind)!

export class LlmError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/** 사설망·내 기기 주소인가: localhost · 사설 IPv4(10/172.16-31/192.168) · 링크로컬 · Tailscale(100.64/10) · *.local */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.localhost')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
}

export type ConfigProblem = 'url' | 'httpPublic' | 'model' | 'key'

/** 설정이 쓸 수 있는지: 주소 형식, 공개 인터넷으로 http 금지(키·글이 평문으로 나감), 모델, 클라우드 키 */
export function validateConfig(cfg: LlmConfig, opts: { needModel?: boolean } = { needModel: true }): ConfigProblem[] {
  const out: ConfigProblem[] = []
  let u: URL | null = null
  try {
    u = new URL(cfg.baseUrl.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') u = null
  } catch {
    u = null
  }
  if (!u) out.push('url')
  else if (u.protocol === 'http:' && !isPrivateHost(u.hostname)) out.push('httpPublic')
  if (opts.needModel !== false && !cfg.model.trim()) out.push('model')
  if (providerOf(cfg.kind).needsKey && !cfg.apiKey?.trim() && !cfg.keyStored) out.push('key')
  return out
}

const trim = (s: string) => s.trim().replace(/\/+$/, '')
const json = (o: unknown) => JSON.stringify(o)

export interface ChatOpts {
  temperature?: number
  maxTokens?: number
}

/** 대화 요청을 제공자 형식으로 */
export function buildChat(cfg: LlmConfig, messages: ChatMessage[], opts: ChatOpts = {}): HttpRequest {
  const base = trim(cfg.baseUrl)
  const key = cfg.apiKey?.trim()
  const model = cfg.model.trim()
  const common = { 'Content-Type': 'application/json' }
  switch (cfg.kind) {
    case 'ollama':
      return { url: `${base}/api/chat`, method: 'POST', headers: common, body: json({ model, messages, stream: false, options: { ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}), ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) } }) }
    case 'openai':
    case 'custom':
      return { url: `${base}/chat/completions`, method: 'POST', headers: { ...common, ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: json({ model, messages, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}), ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}) }) }
    case 'anthropic': {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      return {
        url: `${base}/v1/messages`,
        method: 'POST',
        headers: { ...common, 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' },
        body: json({ model, max_tokens: opts.maxTokens ?? 1024, ...(system ? { system } : {}), messages: messages.filter((m) => m.role !== 'system'), ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) }),
      }
    }
    case 'gemini': {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      return {
        url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        method: 'POST',
        headers: { ...common, 'x-goog-api-key': key ?? '' },
        body: json({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}), ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}) },
        }),
      }
    }
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** 서버가 준 오류 문장을 꺼낸다(제공자마다 모양이 다르다) */
export function errorText(body: unknown): string {
  const b = obj(body)
  const e = b.error
  if (typeof e === 'string') return e
  const m = obj(e).message
  return typeof m === 'string' ? m : ''
}

/** 응답에서 답변 글을 꺼낸다. 비어 있으면 LlmError */
export function parseChat(cfg: LlmConfig, body: unknown): string {
  const b = obj(body)
  let text = ''
  switch (cfg.kind) {
    case 'ollama': text = String(obj(b.message).content ?? ''); break
    case 'openai':
    case 'custom': text = String(obj(obj(arr(b.choices)[0]).message).content ?? ''); break
    case 'anthropic': text = arr(b.content).map((c) => (obj(c).type === 'text' ? String(obj(c).text ?? '') : '')).join(''); break
    case 'gemini': text = arr(obj(obj(arr(b.candidates)[0]).content).parts).map((p) => String(obj(p).text ?? '')).join(''); break
  }
  if (!text.trim()) throw new LlmError(errorText(body) || '응답이 비어 있어요')
  return text
}

/** 서버에 있는 모델 목록 요청(연결 확인을 겸한다) */
export function buildListModels(cfg: LlmConfig): HttpRequest {
  const base = trim(cfg.baseUrl)
  const key = cfg.apiKey?.trim()
  switch (cfg.kind) {
    case 'ollama': return { url: `${base}/api/tags`, method: 'GET', headers: {} }
    case 'openai':
    case 'custom': return { url: `${base}/models`, method: 'GET', headers: key ? { Authorization: `Bearer ${key}` } : {} }
    case 'anthropic': return { url: `${base}/v1/models`, method: 'GET', headers: { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' } }
    case 'gemini': return { url: `${base}/v1beta/models`, method: 'GET', headers: { 'x-goog-api-key': key ?? '' } }
  }
}

export function parseModels(cfg: LlmConfig, body: unknown): string[] {
  const b = obj(body)
  let names: string[] = []
  switch (cfg.kind) {
    case 'ollama': names = arr(b.models).map((m) => String(obj(m).name ?? obj(m).model ?? '')); break
    case 'openai':
    case 'custom':
    case 'anthropic': names = arr(b.data).map((m) => String(obj(m).id ?? '')); break
    case 'gemini': names = arr(b.models).filter((m) => arr(obj(m).supportedGenerationMethods).includes('generateContent')).map((m) => String(obj(m).name ?? '').replace(/^models\//, '')); break
  }
  return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** 오류 응답을 사람이 읽을 문장으로 */
export function describeFailure(status: number, body: unknown): string {
  const detail = errorText(body)
  if (status === 401 || status === 403) return `인증에 실패했어요 (${status})${detail ? ` — ${detail}` : ''}`
  if (status === 404) return `주소나 모델을 찾을 수 없어요 (404)${detail ? ` — ${detail}` : ''}`
  if (status === 429) return '요청이 너무 많아요 (429)'
  return `서버가 오류를 돌려줬어요 (${status})${detail ? ` — ${detail}` : ''}`
}

const KEY = 'nosidian.llm'

/** 기기에 저장된 연결 설정(없으면 null). vault 와 동기화에 넣지 않는다 */
export function loadLlmConfig(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<LlmConfig>
    if (!v || !PROVIDERS.some((p) => p.kind === v.kind)) return null
    return { kind: v.kind!, baseUrl: String(v.baseUrl ?? ''), model: String(v.model ?? ''), apiKey: v.apiKey ? String(v.apiKey) : undefined, ...(v.keyStored ? { keyStored: true } : {}) }
  } catch {
    return null
  }
}
export function saveLlmConfig(cfg: LlmConfig | null) {
  try {
    if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg))
    else localStorage.removeItem(KEY)
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}
