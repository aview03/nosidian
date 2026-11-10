// AI 서버(Ollama 등) 요청 대행: 화면(렌더러)이 아니라 메인 프로세스가 대신 보낸다.
// 렌더러에서 직접 보내면 브라우저 CORS 규칙 때문에 http://localhost:11434 같은 서버가 막힌다.
//
// 열어 두는 범위를 좁게 유지한다(렌더러가 뚫려도 아무 곳이나 못 부르게):
//  - 주소: https 이거나, http 면 사설망·내 기기 주소만. (src/lib/llm.ts 의 isPrivateHost 와 같은 규칙 — 여기서 다시 검사한다)
//  - 헤더: 허용 목록만. 리다이렉트는 따라가지 않고, 시간(2분)·응답 크기(8MB)에 상한이 있다.
const fs = require('fs')
const KEY_MARK = '{{KEY}}'
const ALLOWED_HEADERS = new Set(['content-type', 'authorization', 'x-api-key', 'anthropic-version', 'x-goog-api-key'])
const MAX_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000

function isPrivateHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.localhost')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
}

/**
 * API 키 보관소: 운영체제 자격증명 보호(Windows DPAPI 등, Electron safeStorage)로 암호화해 파일에 둔다.
 * 키는 메인 프로세스 안에서만 복호화되고, 렌더러는 읽을 수 없다(저장·삭제·있는지 여부만 안다).
 */
function createKeyStore({ file, safeStorage }) {
  const available = () => {
    try {
      return !!safeStorage && safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }
  return {
    available,
    has: () => fs.existsSync(file),
    set(key) {
      if (!available()) throw new Error('이 PC 에서는 보안 저장소를 쓸 수 없습니다')
      if (typeof key !== 'string' || !key.trim() || key.length > 2000) throw new Error('잘못된 키입니다')
      fs.writeFileSync(file, safeStorage.encryptString(key.trim()), { mode: 0o600 })
    },
    get() {
      try {
        return safeStorage.decryptString(fs.readFileSync(file))
      } catch {
        return null
      }
    },
    clear() {
      try {
        fs.unlinkSync(file)
      } catch {
        /* 없으면 그만 */
      }
    },
  }
}

/** 요청 헤더의 {{KEY}} 자리를 실제 키로 바꾼다(허용 헤더만). 자리표시자가 있는데 키가 없으면 null */
function injectKey(headers, key) {
  const out = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (typeof v !== 'string' || !ALLOWED_HEADERS.has(k.toLowerCase())) continue
    if (v.includes(KEY_MARK)) {
      if (!key) return null
      out[k] = v.split(KEY_MARK).join(key)
    } else out[k] = v
  }
  return out
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

async function request(req, keys, ac) {
  const bad = check(req)
  if (bad) return { status: 0, text: '', error: bad }
  const headers = injectKey(req.headers, keys ? keys.get() : null)
  if (!headers) return { status: 0, text: '', error: '저장된 API 키를 읽을 수 없어요. 설정에서 다시 저장해 주세요' }
  ac = ac || new AbortController()
  // 요청이 정한 시간 제한(느린 로컬 모델용). 1초~10분 안으로만 받아들인다
  const ms = Number.isFinite(req.timeoutMs) ? Math.min(Math.max(req.timeoutMs, 1000), MAX_TIMEOUT_MS) : TIMEOUT_MS
  const timer = setTimeout(() => ac.abort(), ms)
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
    if (ac.cancelled) return { status: 0, text: '', error: '취소했어요', cancelled: true }
    const msg = e && e.name === 'AbortError' ? '응답이 너무 오래 걸려요' : e && e.cause && e.cause.code ? `연결하지 못했어요 (${e.cause.code})` : '연결하지 못했어요'
    return { status: 0, text: '', error: msg }
  } finally {
    clearTimeout(timer)
  }
}

function registerLlm(ipcMain, opts) {
  const keys = opts && opts.file ? createKeyStore(opts) : null
  // 진행 중인 요청을 id 로 기억해 두었다가 취소할 수 있게 한다(앱 안 AI 의 "중지")
  const inflight = new Map()
  ipcMain.handle('llm:request', async (_e, req, id) => {
    const ac = new AbortController()
    const key = typeof id === 'string' && id.length <= 80 ? id : null
    if (key) inflight.set(key, ac)
    try {
      return await request(req, keys, ac)
    } finally {
      if (key) inflight.delete(key)
    }
  })
  ipcMain.handle('llm:cancel', (_e, id) => {
    const ac = typeof id === 'string' ? inflight.get(id) : null
    if (!ac) return false
    ac.cancelled = true
    ac.abort()
    return true
  })
  ipcMain.handle('llm:key:status', () => ({ available: !!keys && keys.available(), has: !!keys && keys.has() }))
  ipcMain.handle('llm:key:set', (_e, key) => {
    if (!keys) throw new Error('보안 저장소를 쓸 수 없습니다')
    keys.set(key)
  })
  ipcMain.handle('llm:key:clear', () => keys && keys.clear())
  // 다른 메인 프로세스 코드(휴대폰 중계)가 같은 규칙·같은 키 보관소로 요청을 보낼 때 쓴다
  return { request: (req, ac) => request(req, keys, ac) }
}

module.exports = { registerLlm, check, request, isPrivateHost, createKeyStore, injectKey, KEY_MARK }
