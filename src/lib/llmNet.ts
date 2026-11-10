// LLM 서버로 요청을 실제로 보낸다(llm.ts 가 만든 요청 객체를 전달).
//  - PC(Electron): 메인 프로세스가 대신 보낸다(CORS 회피, 주소 규칙 재검사).
//  - Android: Capacitor 네이티브 HTTP(웹뷰의 https 출처에서 http 사설망 서버로 보낼 때 막히는 혼합 콘텐츠·CORS 를 피한다).
//  - 그 밖(브라우저): fetch — 서버가 CORS 를 허용해야 한다.
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { buildChat, buildListModels, describeFailure, LlmError, parseChat, parseModels, validateConfig, type ChatMessage, type ChatOpts, type HttpRequest, type LlmConfig } from './llm'

interface DesktopLlm {
  llmRequest?: (req: HttpRequest) => Promise<{ status: number; text: string; error?: string }>
}

export interface RawResponse {
  status: number
  text: string
}

export async function send(req: HttpRequest): Promise<RawResponse> {
  const desktop = (window as unknown as { amsidianDesktop?: DesktopLlm }).amsidianDesktop
  if (desktop?.llmRequest) {
    const r = await desktop.llmRequest(req)
    if (r.error) throw new LlmError(r.error)
    return { status: r.status, text: r.text }
  }
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({ url: req.url, method: req.method, headers: req.headers, data: req.body ? JSON.parse(req.body) : undefined, responseType: 'text', connectTimeout: 15000, readTimeout: 120000 })
    return { status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) }
  }
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body })
    return { status: res.status, text: await res.text() }
  } catch {
    throw new LlmError('연결하지 못했어요 (브라우저에서는 서버가 CORS 를 허용해야 해요)')
  }
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function problemText(p: ReturnType<typeof validateConfig>[number]): string {
  switch (p) {
    case 'url': return '서버 주소가 올바르지 않아요'
    case 'httpPublic': return '공개 인터넷 주소는 https 로만 연결할 수 있어요 (http 는 같은 사설망·내 기기만)'
    case 'model': return '모델을 골라 주세요'
    case 'key': return 'API 키가 필요해요'
  }
}

async function call(req: HttpRequest): Promise<unknown> {
  const r = await send(req)
  const body = parse(r.text)
  if (r.status < 200 || r.status >= 300) throw new LlmError(describeFailure(r.status, body), r.status)
  return body
}

/** 서버에 있는 모델 목록. 연결 확인을 겸한다(모델은 아직 안 골랐어도 된다) */
export async function listModels(cfg: LlmConfig): Promise<string[]> {
  const bad = validateConfig(cfg, { needModel: false })
  if (bad.length) throw new LlmError(problemText(bad[0]))
  return parseModels(cfg, await call(buildListModels(cfg)))
}

/** 대화 한 번(스트리밍 없음) */
export async function chat(cfg: LlmConfig, messages: ChatMessage[], opts?: ChatOpts): Promise<string> {
  const bad = validateConfig(cfg)
  if (bad.length) throw new LlmError(problemText(bad[0]))
  return parseChat(cfg, await call(buildChat(cfg, messages, opts)))
}
