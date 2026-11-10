// AI 서버(Ollama 등) 요청 대행: 화면(렌더러)이 아니라 메인 프로세스가 대신 보낸다.
// 렌더러에서 직접 보내면 브라우저 CORS 규칙 때문에 http://localhost:11434 같은 서버가 막힌다.
//
// 열어 두는 범위를 좁게 유지한다(렌더러가 뚫려도 아무 곳이나 못 부르게):
//  - 주소: https 이거나, http 면 사설망·내 기기 주소만. (src/lib/llm.ts 의 isPrivateHost 와 같은 규칙 — 여기서 다시 검사한다)
//  - 헤더: 허용 목록만. 리다이렉트는 따라가지 않고, 시간(2분)·응답 크기(8MB)에 상한이 있다.
const ALLOWED_HEADERS = new Set(['content-type', 'authorization', 'x-api-key', 'anthropic-version', 'x-goog-api-key'])
const MAX_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 120_000

function isPrivateHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.localhost')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
}

/** 요청이 허용되는 모양인지. 문제가 있으면 이유 문장, 괜찮으면 null */
function check(req) {
  if (!req || typeof req.url !== 'string') return '잘못된 요청입니다'
  let u
  try {
    u = new URL(req.url)
  } catch {
    return '주소 형식이 올바르지 않습니다'
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'http/https 주소만 쓸 수 있습니다'
  if (u.protocol === 'http:' && !isPrivateHost(u.hostname)) return '공개 인터넷 주소는 https 로만 연결할 수 있습니다'
  if (req.method !== 'GET' && req.method !== 'POST') return '허용되지 않는 요청 방식입니다'
  if (req.body !== undefined && typeof req.body !== 'string') return '잘못된 요청 본문입니다'
  return null
}

async function request(req) {
  const bad = check(req)
  if (bad) return { status: 0, text: '', error: bad }
  const headers = {}
  for (const [k, v] of Object.entries(req.headers || {})) if (ALLOWED_HEADERS.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(req.url, { method: req.method, headers, body: req.method === 'POST' ? req.body : undefined, redirect: 'error', signal: ac.signal })
    const reader = res.body.getReader()
    const chunks = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) {
        ac.abort()
        return { status: res.status, text: '', error: '응답이 너무 커요' }
      }
      chunks.push(value)
    }
    return { status: res.status, text: Buffer.concat(chunks).toString('utf8') }
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '응답이 너무 오래 걸려요' : e && e.cause && e.cause.code ? `연결하지 못했어요 (${e.cause.code})` : '연결하지 못했어요'
    return { status: 0, text: '', error: msg }
  } finally {
    clearTimeout(timer)
  }
}

function registerLlm(ipcMain) {
  ipcMain.handle('llm:request', (_e, req) => request(req))
}

module.exports = { registerLlm, check, request, isPrivateHost }
