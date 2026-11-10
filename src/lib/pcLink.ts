// 휴대폰 → 이 PC 의 AI(중계) 클라이언트. PC 앱이 "휴대폰 연결"을 켜 두면(electron/aiRelay.cjs), 연결 코드로 한 번 짝을 맺고 토큰을 받는다.
//  - 모델 중계: 짝을 맺을 때 PC 가 쓰는 AI 서버(Ollama·OpenAI 호환)의 종류·모델을 알려 주므로, 폰의 AI 연결 설정을 PC 주소·토큰으로 자동 채운다.
//  - Claude 구독 중계: PC 의 Claude Code 를 실행하게 하되, 노트 도구 호출은 PC 가 폰으로 되돌려 보내고 폰이 폰의 노트에서 실행한다(폴링).
// 네트워크는 llmNet.send(안드로이드는 네이티브 HTTP)를 쓴다 — 웹뷰의 https 출처에서 http 사설망으로 보내도 막히지 않는다.
import { send } from './llmNet'
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from './llm'
import { buildEnv } from './mcpBridge'
import { callTool } from './mcpTools'
import type { ClaudeEvent } from './externalIO'
import { t } from './i18n'

export const DEFAULT_RELAY_PORT = 47410
const KEY = 'nosidian.pc'

export interface PcLink {
  host: string
  port: number
  token: string
  /** PC 이름 */
  name: string
  /** PC 의 Claude Code 를 쓸 수 있는가(짝을 맺을 때 확인한 값) */
  claude: boolean
  upstream: { kind: string; model: string } | null
}

export function loadPcLink(): PcLink | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PcLink> | null
    if (!v || typeof v.host !== 'string' || typeof v.token !== 'string' || !Number.isInteger(v.port)) return null
    return { host: v.host, port: v.port as number, token: v.token, name: String(v.name ?? 'PC'), claude: v.claude === true, upstream: v.upstream && typeof v.upstream.kind === 'string' ? { kind: v.upstream.kind, model: String(v.upstream.model ?? '') } : null }
  } catch {
    return null
  }
}
export function savePcLink(l: PcLink | null) {
  try {
    if (l) localStorage.setItem(KEY, JSON.stringify(l))
    else localStorage.removeItem(KEY)
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 */
  }
}
export const pcClaude = () => loadPcLink()?.claude === true

export interface Pairing {
  /** 첫 번째 주소(표시용) */
  host: string
  /** 닿는 곳을 찾을 후보 주소들(PC 에 어댑터가 여러 개일 수 있다) */
  hosts: string[]
  port: number
  code: string
}

/**
 * 연결 코드 해석. 받아들이는 모양:
 *  - QR·복사용 "nsd1:192.168.0.10:47410:482913"
 *  - 사람이 쓰는 "192.168.0.10:47410/482913", "192.168.0.10 482913"(포트 생략 = 47410)
 */
export function parsePairing(raw: string): Pairing | null {
  const s = raw.trim()
  let m = /^nsd1:([\d.,]+):(\d{2,5}):(\d{6})$/i.exec(s)
  if (!m) m = /^([\d.]+)(?::(\d{2,5}))?\s*[/ :-]\s*(\d{6})$/.exec(s)
  if (!m) return null
  const hosts = m[1].split(',')
  const okIp = (h: string) => {
    const ip = h.split('.')
    return ip.length === 4 && ip.every((x) => x !== '' && Number(x) <= 255)
  }
  if (hosts.length > 6 || !hosts.every(okIp)) return null
  const port = m[2] ? Number(m[2]) : DEFAULT_RELAY_PORT
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return { host: hosts[0], hosts, port, code: m[3] }
}

const base = (l: { host: string; port: number }) => `http://${l.host}:${l.port}`

async function call(l: { host: string; port: number; token?: string }, path: string, body?: unknown, method: 'GET' | 'POST' = 'POST', signal?: AbortSignal): Promise<unknown> {
  const r = await send({ url: base(l) + path, method, headers: { 'Content-Type': 'application/json', ...(l.token ? { Authorization: `Bearer ${l.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, signal)
  let j: unknown = null
  try {
    j = JSON.parse(r.text)
  } catch {
    /* JSON 이 아니면 아래에서 상태로 판단 */
  }
  if (r.status < 200 || r.status >= 300) {
    const msg = j && typeof j === 'object' && 'error' in j ? String((j as { error: unknown }).error) : `HTTP ${r.status}`
    throw Object.assign(new Error(msg), { status: r.status })
  }
  return j
}

/** 연결 코드로 짝을 맺는다. 성공하면 저장하고 돌려준다 */
export async function pairWithPc(p: Pairing, deviceName: string): Promise<PcLink> {
  let last: unknown = new Error('no host')
  for (const host of p.hosts) {
    try {
      // 안 닿는 주소(가상 어댑터 등)에서 오래 기다리지 않게 4초씩만 기다리고 다음 후보로 간다. 서버가 답한 오류(HTTP 상태)는 주소가 맞다는 뜻이라 바로 알린다
      const j = (await Promise.race([call({ host, port: p.port }, '/pair', { code: p.code, name: deviceName }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))])) as { token: string; name: string; upstream: PcLink['upstream']; claude: boolean }
      const link: PcLink = { host, port: p.port, token: j.token, name: j.name || 'PC', claude: j.claude === true, upstream: j.upstream ?? null }
      savePcLink(link)
      return link
    } catch (e) {
      last = e
      if ((e as { status?: number }).status) break
    }
  }
  throw new Error(pcErrorText(last))
}

/** PC 가 지금 응답하는지, Claude·AI 서버 상태는 어떤지 */
export async function pingPc(l: PcLink): Promise<{ name: string; claude: boolean; busy: boolean; upstream: PcLink['upstream'] }> {
  try {
    const j = (await call(l, '/ping', undefined, 'GET')) as { name: string; claude: boolean; busy: boolean; upstream: PcLink['upstream'] }
    return j
  } catch (e) {
    throw new Error(pcErrorText(e))
  }
}

export function pcErrorText(e: unknown): string {
  const status = (e as { status?: number }).status
  const msg = e instanceof Error ? e.message : String(e)
  if (status === 403) return t('연결 코드가 맞지 않거나 만료됐어요. PC에서 새 코드를 만들어 주세요')
  if (status === 429) return t('코드를 여러 번 틀려서 잠시 막혔어요. 1분 뒤에 다시 해 주세요')
  if (status === 409) return t('이 PC에 연결할 수 있는 기기 수(5대)를 넘었어요. PC에서 안 쓰는 기기를 해제해 주세요')
  if (status === 401) return t('이 PC에서 연결이 해제됐어요. 새 코드로 다시 연결해 주세요')
  if (status === 503) return t('PC에서 쓸 수 있는 AI가 없어요. PC 앱에서 AI를 먼저 연결해 주세요')
  return t('PC에 연결하지 못했어요. PC 앱이 켜져 있고 같은 와이파이인지 확인해 주세요') + (msg && !/Failed|fetch|network|연결하지/i.test(msg) ? ` (${msg})` : '')
}

/** PC 의 AI 서버를 쓰는 폰의 LlmConfig(모델 중계). PC 에 AI 서버가 연결돼 있지 않으면 null */
export function llmConfigVia(l: PcLink): LlmConfig | null {
  const up = l.upstream
  if (!up || !up.model) return null
  const root = base(l)
  // Ollama 는 네이티브 경로(/api), 그 밖(OpenAI·LM Studio 등 OpenAI 호환)은 /v1 로 중계된다. 폰은 토큰만 갖고, 실제 API 키는 PC 에만 있다
  return up.kind === 'ollama' ? { kind: 'ollama', baseUrl: root, model: up.model, apiKey: l.token, viaPc: true } : { kind: 'custom', baseUrl: `${root}/v1`, model: up.model, apiKey: l.token, viaPc: true }
}

/** 짝을 맺은 뒤: PC 의 AI 서버를 폰의 AI 연결로 저장한다(이미 있던 다른 연결은 덮어쓴다) */
export function adoptUpstream(l: PcLink): boolean {
  const cfg = llmConfigVia(l)
  if (!cfg) return false
  saveLlmConfig(cfg)
  return true
}

/** 연결 해제(폰 쪽): 토큰을 지우고, PC 를 통한 AI 연결 설정도 지운다 */
export function forgetPc() {
  savePcLink(null)
  const cfg = loadLlmConfig()
  if (cfg?.viaPc) saveLlmConfig(null)
}

export interface RelayRun {
  cancel(): void
  done: Promise<void>
}

/**
 * PC 의 Claude Code 로 한 번 묻는다. 진행·결과는 onEvent 로(PC 앱 안 Claude 와 같은 이벤트), 노트 도구 호출은 이 폰에서 실행한다.
 * mode 'ask' 는 읽기 전용(변경 제안 도구 거절), forceApproval 은 계획 실행용.
 */
export function runClaudeViaPc(link: PcLink, req: { prompt: string; mode: 'ask' | 'edit'; forceApproval?: boolean }, onEvent: (e: ClaudeEvent) => void): RelayRun {
  const ac = new AbortController()
  let runId = ''
  let ended = false
  const finish = (e: ClaudeEvent) => {
    if (ended) return
    ended = true
    onEvent(e)
  }
  const handleToolCall = async (ev: { id: string; tool: string; args: Record<string, unknown>; client?: string }) => {
    try {
      const ok = callTool(ev.tool, ev.args ?? {}, buildEnv(true, req.mode === 'ask', req.forceApproval === true), '앱 안 Claude (PC)')
      await call(link, '/claude/tool', { runId, id: ev.id, ok })
    } catch (e) {
      // 도구가 거절·실패하면 그 이유가 Claude 에게 돌아가 스스로 고치게 한다
      try {
        await call(link, '/claude/tool', { runId, id: ev.id, error: e instanceof Error ? e.message : String(e) })
      } catch {
        /* PC 와 연결이 끊긴 경우: 폴링 쪽에서 처리 */
      }
    }
  }
  const done = (async () => {
    try {
      const start = (await call(link, '/claude/run', { prompt: req.prompt, mode: req.mode, forceApproval: req.forceApproval === true }, 'POST', ac.signal)) as { runId: string }
      runId = start.runId
    } catch (e) {
      if (ac.signal.aborted) return finish({ type: 'error', code: 'cancelled', message: t('취소했어요') })
      const st = (e as { status?: number }).status
      return finish({ type: 'error', code: 'pc', message: st === 409 ? t('PC에서 다른 AI 작업이 돌고 있어요. 잠시 뒤에 다시 해 주세요') : st === 503 ? t('PC의 Claude Code를 쓸 수 없어요. PC 앱에서 로그인을 확인해 주세요') : pcErrorText(e) })
    }
    let cursor = 0
    let failures = 0
    while (!ended) {
      if (ac.signal.aborted) break
      try {
        const p = (await call(link, '/claude/poll', { runId, cursor }, 'POST', ac.signal)) as { events: (ClaudeEvent | { type: 'toolcall'; id: string; tool: string; args: Record<string, unknown> } | { type: 'end' })[]; cursor: number; done: boolean }
        failures = 0
        cursor = p.cursor
        for (const ev of p.events) {
          if (ev.type === 'toolcall') void handleToolCall(ev)
          else if (ev.type === 'end') continue
          else if (ev.type === 'result' || ev.type === 'error') finish(ev)
          else onEvent(ev)
        }
        if (p.done) break
      } catch (e) {
        if (ac.signal.aborted) break
        if ((e as { status?: number }).status === 404) break // 이미 끝난 실행
        if (++failures >= 3) return finish({ type: 'error', code: 'pc', message: pcErrorText(e) })
        await new Promise((r) => setTimeout(r, 1000 * failures))
      }
    }
    if (!ended) finish(ac.signal.aborted ? { type: 'error', code: 'cancelled', message: t('취소했어요') } : { type: 'error', code: 'pc', message: t('PC가 응답을 마치지 않고 끊었어요') })
  })()
  return {
    cancel: () => {
      if (runId) void call(link, '/claude/cancel', { runId }).catch(() => {}) // PC 쪽 Claude 실행을 끝낸다
      ac.abort()
    },
    done,
  }
}
