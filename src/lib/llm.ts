// LLM 연결 인터페이스: 어떤 AI 서버든 같은 모양으로 부르기 위한 순수 부분(요청 만들기·응답 읽기·설정 검증).
//
// 지원: Ollama(내 PC·홈 서버) · OpenAI 호환 API(LM Studio·vLLM 등 "사용자 지정" 포함) · OpenAI · Anthropic · Gemini.
//  - 실제 네트워크 호출은 llmNet.ts 가 한다(PC 는 메인 프로세스, Android 는 네이티브 HTTP). 여기서는 요청 객체만 만든다.
//  - 사용자가 서버 주소(baseUrl)까지 직접 정한다 — 특정 업체에 묶이지 않고, 운영자가 중앙 AI 서버를 둘 필요가 없다.
//  - OpenAI·Anthropic·Gemini 의 요청 형식은 공식 문서 기준으로 만들었지만 실제 서버로는 시험하지 못했다(키가 없음). Ollama·OpenAI 호환은 가짜 서버로 시험했다.
//  - API 키는 이 기기에만 둔다(vault·동기화에 넣지 않는다).

import { addConnection, listConnections, removeConnection, selectedConnection, updateConnection, type AiConnection } from './aiConnections'

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
  /** 이 PC 앱의 중계를 통해 쓰는 AI 서버(apiKey 는 PC 가 준 토큰). 폰 전용 */
  viaPc?: boolean
  /** 이 설정이 속한 연결의 id(aiConnections). 보안 저장소의 키를 연결별로 찾는 데 쓴다. 저장할 때 없으면 "지금 선택된 연결"을 고친다 */
  id?: string
  /** 연결의 화면 이름 */
  label?: string
}

/** 요청 헤더에 넣는 키 자리표시자. 메인 프로세스가 보안 저장소의 실제 키로 바꿔 보낸다 */
export const KEY_PLACEHOLDER = '{{KEY}}'

/** 요청을 만들 때 쓸 설정: 키가 보안 저장소에 있으면 자리표시자를 쓴다. 연결 id 가 있으면 `{{KEY:id}}` — 메인 프로세스가 그 연결의 키를 찾는다 */
export const forRequest = (cfg: LlmConfig): LlmConfig => (cfg.keyStored ? { ...cfg, apiKey: cfg.id ? `{{KEY:${cfg.id}}}` : KEY_PLACEHOLDER } : cfg)

/** 모델이 부르려는 도구 한 번 */
export interface ToolCall {
  /** OpenAI 호환 서버가 주는 호출 id(결과를 이 id 로 돌려줘야 한다). Ollama 는 없다 */
  id?: string
  name: string
  args: Record<string, unknown>
}

/** 모델에게 알려 주는 도구 정의(이름·설명·JSON Schema) */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** assistant: 이 턴에 모델이 부른 도구들 */
  toolCalls?: ToolCall[]
  /** tool: 어느 호출의 결과인지(OpenAI 호환: 호출 id, Ollama: 도구 이름) */
  toolCallId?: string
  toolName?: string
}

/** 모델의 한 턴: 글과(있다면) 도구 호출들 */
export interface ModelTurn {
  text: string
  toolCalls: ToolCall[]
}

/** 도구 호출(function calling)을 지원하는 제공자: Ollama · OpenAI 호환(OpenAI·사용자 지정) */
export const supportsTools = (kind: ProviderKind) => kind === 'ollama' || kind === 'openai' || kind === 'custom'

export interface HttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  /** 응답을 기다릴 최대 시간(ms). 느린 로컬 모델용. 없으면 기본(2분). 메인 프로세스가 1초~10분으로 제한한다 */
  timeoutMs?: number
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
  /** 도구 호출을 허용할 도구들(Ollama·OpenAI 호환만) */
  tools?: ToolSpec[]
  /** Ollama: 생각(thinking) 모델의 사고 과정을 켜고 끈다(끄면 훨씬 빠르다) */
  think?: boolean
  /** Ollama: 문맥 길이(num_ctx). 기본값이 작아 노트를 읽으면 잘릴 수 있다 */
  numCtx?: number
  /** 응답을 기다릴 최대 시간(ms) */
  timeoutMs?: number
}

const hasToolBits = (messages: ChatMessage[], opts: ChatOpts) => !!opts.tools?.length || messages.some((m) => m.role === 'tool' || m.toolCalls?.length)

/** 제공자에 보낼 메시지 모양으로. 일반 메시지는 {role, content} 그대로다 */
function wireMessages(kind: ProviderKind, messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') return kind === 'ollama' ? { role: 'tool', content: m.content, ...(m.toolName ? { tool_name: m.toolName } : {}) } : { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return kind === 'ollama'
        ? { role: 'assistant', content: m.content, tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }
        : { role: 'assistant', content: m.content, tool_calls: m.toolCalls.map((c) => ({ id: c.id ?? '', type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
    }
    return { role: m.role, content: m.content }
  })
}

const wireTools = (tools: ToolSpec[]) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))

/** 대화 요청을 제공자 형식으로 */
export function buildChat(cfg: LlmConfig, messages: ChatMessage[], opts: ChatOpts = {}): HttpRequest {
  const base = trim(cfg.baseUrl)
  const key = cfg.apiKey?.trim()
  const model = cfg.model.trim()
  const common = { 'Content-Type': 'application/json' }
  if (!supportsTools(cfg.kind) && hasToolBits(messages, opts)) throw new LlmError('이 제공자는 아직 도구 호출을 지원하지 않아요 (Ollama·OpenAI 호환만)')
  switch (cfg.kind) {
    case 'ollama':
      return {
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        url: `${base}/api/chat`,
        method: 'POST',
        headers: { ...common, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: json({
          model,
          messages: wireMessages('ollama', messages),
          stream: false,
          ...(opts.tools?.length ? { tools: wireTools(opts.tools) } : {}),
          ...(opts.think !== undefined ? { think: opts.think } : {}),
          options: { ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}), ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}), ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}) },
        }),
      }
    case 'openai':
    case 'custom':
      return {
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        url: `${base}/chat/completions`,
        method: 'POST',
        headers: { ...common, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: json({ model, messages: wireMessages(cfg.kind, messages), ...(opts.tools?.length ? { tools: wireTools(opts.tools) } : {}), ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}), ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}) }),
      }
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

/** 인자가 JSON 글자로 오면 객체로. 깨졌으면 원문을 __raw 에 담아 돌려준다(도구 쪽이 오류로 알려 준다) */
function parseArgs(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === 'string') {
    if (!v.trim()) return {}
    try {
      const j = JSON.parse(v) as unknown
      if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>
    } catch {
      /* 아래에서 처리 */
    }
    return { __raw: v }
  }
  return {}
}

/** 응답에서 모델의 한 턴(글 + 도구 호출들)을 꺼낸다. 글도 도구 호출도 없으면 LlmError */
export function parseTurn(cfg: LlmConfig, body: unknown): ModelTurn {
  if (!supportsTools(cfg.kind)) return { text: parseChat(cfg, body), toolCalls: [] }
  const b = obj(body)
  const msg = cfg.kind === 'ollama' ? obj(b.message) : obj(obj(arr(b.choices)[0]).message)
  const text = typeof msg.content === 'string' ? msg.content : ''
  const toolCalls: ToolCall[] = arr(msg.tool_calls)
    .map((c) => {
      const f = obj(obj(c).function)
      return { ...(typeof obj(c).id === 'string' && obj(c).id ? { id: String(obj(c).id) } : {}), name: String(f.name ?? ''), args: parseArgs(f.arguments) }
    })
    .filter((c) => c.name)
  if (!text.trim() && !toolCalls.length) throw new LlmError(errorText(body) || '응답이 비어 있어요')
  return { text, toolCalls }
}

/** 서버에 있는 모델 목록 요청(연결 확인을 겸한다) */
export function buildListModels(cfg: LlmConfig): HttpRequest {
  const base = trim(cfg.baseUrl)
  const key = cfg.apiKey?.trim()
  switch (cfg.kind) {
    case 'ollama': return { url: `${base}/api/tags`, method: 'GET', headers: key ? { Authorization: `Bearer ${key}` } : {} }
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

/**
 * 호환 창구: 예전 코드(한 칸 설정)가 그대로 쓰도록 "지금 선택된 연결"을 옛 모양으로 돌려주고 쓴다.
 * 여러 연결을 다루는 코드는 aiConnections.ts 를 직접 쓴다. 비밀 보관은 거기서(연결별 이름) 한다.
 */

/** 연결 하나를 옛 설정 모양으로(종류를 알 수 없으면 null) */
export function toLlmConfig(v: AiConnection | null): LlmConfig | null {
  if (!v || !PROVIDERS.some((p) => p.kind === v.kind)) return null
  return { id: v.id, ...(v.label ? { label: v.label } : {}), kind: v.kind as ProviderKind, baseUrl: v.baseUrl, model: v.model, apiKey: v.apiKey, ...(v.keyStored ? { keyStored: true } : {}), ...(v.viaPc ? { viaPc: true } : {}) }
}

/** 기기에 저장된 연결 설정(지금 선택된 연결, 없으면 null). vault 와 동기화에 넣지 않는다 */
export function loadLlmConfig(): LlmConfig | null {
  try {
    return toLlmConfig(selectedConnection())
  } catch {
    return null
  }
}

/** 연결해 둔 모든 AI(종류를 알 수 없는 것은 뺀다) */
export function loadAllLlmConfigs(): LlmConfig[] {
  try {
    return listConnections().map(toLlmConfig).filter((c): c is LlmConfig => c !== null)
  } catch {
    return []
  }
}
/** 지금 선택된 연결의 내용을 cfg 로 바꾼다(cfg.id 가 있으면 그 연결을, 연결이 하나도 없으면 새로 추가). null 이면 선택된 연결을 지운다 */
export function saveLlmConfig(cfg: LlmConfig | null) {
  try {
    const cur = selectedConnection()
    if (!cfg) {
      if (cur) removeConnection(cur.id)
      return
    }
    const { id, label, ...rest } = cfg
    const target = id ?? cur?.id
    const body = { kind: rest.kind, baseUrl: rest.baseUrl, model: rest.model, apiKey: rest.apiKey, keyStored: rest.keyStored ? true : undefined, viaPc: rest.viaPc ? true : undefined }
    if (target && updateConnection(target, { ...body, ...(label ? { label } : {}) })) return
    addConnection({ ...body, ...(label ? { label } : {}), ...(target ? { id: target } : {}) })
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}
