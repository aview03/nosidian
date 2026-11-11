// 휴대폰 → 이 PC 의 AI 중계(PC 앱). 기본은 꺼짐. 켜면 같은 사설망(와이파이)의 기기가 "연결 코드"로 한 번 짝을 맺고, 이후 토큰으로 이 PC 의 AI 를 쓴다.
//  - 모델 중계: /api/*(Ollama) · /v1/*(OpenAI 호환)을 PC 에 연결된 AI 서버로 전달한다. API 키는 PC 의 보안 저장소에만 있고 폰은 토큰만 갖는다.
//  - Claude 구독 중계: /claude/* — PC 의 Claude Code 를 실행하되, 노트 도구 호출(search_notes·read_note·propose_change …)은 PC 가 아니라
//    폰으로 되돌려 폰의 노트에서 실행한다(폰의 정책·승인 흐름 그대로). 폰은 짧은 폴링(긴 대기)으로 진행을 받는다 — 폰의 웹뷰에서는 스트리밍 응답을 못 쓰기 때문.
//  - 보안: 사설망 주소의 요청만, 토큰(기기별·해시로 보관) 필수, 연결 코드는 6자리·5분·한 번만, 코드 시도 실패는 제한, 기기 5대까지, 요청 본문 8MB.
// 이 파일에는 노트를 읽고 쓰는 코드가 없다. 의존(저장·AI 서버 호출·Claude 실행)은 모두 주입받는다 — 시험하기 쉽게.
const http = require('http')
const crypto = require('crypto')
const os = require('os')

const DEFAULT_PORT = 47410
const CODE_TTL_MS = 5 * 60_000
const MAX_DEVICES = 5
const MAX_BODY = 8 * 1024 * 1024
const POLL_WAIT_MS = 25_000
const TOOL_TIMEOUT_MS = 60_000
const RUN_KEEP_MS = 2 * 60_000

function isPrivateAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '')
  if (a === '::1' || a === '127.0.0.1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a)
  if (!m) return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a) // IPv6 사설·링크 로컬
  const x = Number(m[1])
  const y = Number(m[2])
  return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127)
}

/** 가상 어댑터(VirtualBox·VMware·Hyper-V·Docker·WSL·VPN 등)의 이름 */
const VIRTUAL_IFACE = /virtual|vmware|vbox|vethernet|hyper-v|docker|wsl|tailscale|zerotier|vpn|\btap\b|\btun\b|loopback|bluetooth/i

/** 이 PC 의 사설망 IPv4 주소들(연결 코드에 넣는다). 실제 와이파이·유선 어댑터를 앞에, 가상 어댑터는 뒤에 둔다 */
function lanAddresses(ifaces = os.networkInterfaces()) {
  const real = []
  const virt = []
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const i of list || []) {
      if (!i || i.family !== 'IPv4' || i.internal || !isPrivateAddress(i.address)) continue
      ;(VIRTUAL_IFACE.test(name) ? virt : real).push(i.address)
    }
  }
  return [...new Set([...real, ...virt])]
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

function createRelay(deps) {
  const { store, getUpstream, llmRequest, claude } = deps
  // 휴대폰에 빌려주는 AI 들. getUpstreams 가 없으면(옛 호출·시험) getUpstream 하나를 id 'default' 로 본다
  const upsList = () => {
    if (typeof deps.getUpstreams === 'function') return deps.getUpstreams() || []
    const u = getUpstream ? getUpstream() : null
    return u ? [{ id: 'default', ...u }] : []
  }
  const upsPublic = () => upsList().map((u) => ({ id: u.id, kind: u.kind, model: u.model }))
  const firstPublic = () => upsPublic()[0] || null // 예전 폰(upstream 하나만 아는 버전)을 위해 함께 알린다
  const now = deps.now || (() => Date.now())
  let state = { enabled: false, port: DEFAULT_PORT, devices: [] }
  try {
    const v = store.read()
    if (v) state = { enabled: v.enabled === true, port: Number.isInteger(v.port) && v.port > 1023 && v.port < 65536 ? v.port : DEFAULT_PORT, devices: Array.isArray(v.devices) ? v.devices.filter((d) => d && typeof d.id === 'string' && typeof d.hash === 'string') : [] }
  } catch {
    /* 새로 시작 */
  }
  const save = () => {
    try {
      store.write(state)
    } catch {
      /* 저장 실패: 이번 실행에서만 유지 */
    }
  }
  let code = null // { value, exp }
  const fails = new Map() // 원격 주소 → { n, until }
  const runs = new Map()
  let srv = null
  let error = null

  const issueCode = () => {
    code = { value: newCode(), exp: now() + CODE_TTL_MS }
    return code
  }
  // 화면용: 지금 유효한 코드(없으면 null). 화면이 열 때마다 코드를 만들어 내지 않는다 — 사용자가 '기기 추가'를 눌렀을 때만 issueCode
  const codeActive = () => (code && code.exp > now() ? code : null)
  // 시험용: 유효한 코드가 없으면 발급한다
  const codeNow = () => codeActive() || issueCode()

  // ── HTTP 도우미 ──
  const send = (res, status, obj) => {
    const body = typeof obj === 'string' ? obj : JSON.stringify(obj)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(Object.assign(new Error('too large'), { status: 413 }))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  const json = async (req) => {
    const t = await readBody(req)
    if (!t) return {}
    try {
      const v = JSON.parse(t)
      return v && typeof v === 'object' ? v : {}
    } catch {
      throw Object.assign(new Error('bad json'), { status: 400 })
    }
  }

  function authDevice(req) {
    const h = String(req.headers.authorization || '')
    const m = /^Bearer\s+([A-Za-z0-9]{32,128})$/.exec(h)
    if (!m) return null
    const hash = sha(m[1])
    const a = Buffer.from(hash)
    for (const d of state.devices) {
      const b = Buffer.from(d.hash)
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return d
    }
    return null
  }

  // ── 짝 맺기 ──
  async function pair(req, res, remote) {
    const f = fails.get(remote)
    if (f && f.until > now()) return send(res, 429, { error: 'too many attempts' })
    const b = await json(req)
    const c = code
    const ok = c && c.exp > now() && typeof b.code === 'string' && b.code.length === 6 && crypto.timingSafeEqual(Buffer.from(b.code), Buffer.from(c.value))
    if (!ok) {
      const base = f && !(f.until && f.until <= now()) ? f.n : 0 // 잠금이 끝났으면 처음부터 다시 센다
      const n = base + 1
      fails.set(remote, { n, until: n >= 5 ? now() + 60_000 : 0 })
      return send(res, 403, { error: 'invalid code' })
    }
    // 기기 하나에 연결 링크(토큰) 하나: 같은 기기(clientId)가 다시 맺으면 기존 항목의 토큰을 바꿔 끼운다(중복 없음, 옛 토큰은 즉시 무효)
    const cid = typeof b.clientId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(b.clientId) ? b.clientId : null
    const prev = cid ? state.devices.find((d) => d.clientId === cid) : null
    if (!prev && state.devices.length >= MAX_DEVICES) return send(res, 409, { error: 'too many devices' })
    code = null // 한 번만
    fails.delete(remote)
    const token = crypto.randomBytes(24).toString('hex')
    const name = String(b.name || '휴대폰').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40).trim() || '휴대폰'
    if (prev) Object.assign(prev, { name, hash: sha(token), createdAt: now(), lastSeen: now() })
    else state.devices.push({ id: crypto.randomUUID(), ...(cid ? { clientId: cid } : {}), name, hash: sha(token), createdAt: now(), lastSeen: now() })
    save()
    const first = firstPublic()
    send(res, 200, { token, name: deps.hostName || 'PC', upstream: first ? { kind: first.kind, model: first.model } : null, upstreams: upsPublic(), claude: !!claude.ready() })
  }

  // ── 모델 중계(역방향 프록시) ──
  async function proxy(req, res, url) {
    // 경로: `/u/<연결id>/api/…`·`/u/<연결id>/v1/…`(빌려준 AI 중 하나) 또는 예전처럼 `/api/…`·`/v1/…`(첫 번째)
    const list = upsList()
    const m = /^\/u\/([A-Za-z0-9_-]{1,40})(\/.*)$/.exec(url.pathname)
    const up = m ? list.find((u) => u.id === m[1]) : list[0]
    if (!up) return send(res, list.length ? 404 : 503, { error: list.length ? 'unknown upstream' : 'no upstream' })
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method' })
    const p = (m ? m[2] : url.pathname) + url.search
    let target = null
    let key = false
    if (p.startsWith('/api/') && up.kind === 'ollama') target = up.baseUrl.replace(/\/+$/, '') + p
    else if (p.startsWith('/v1/')) {
      if (up.kind === 'openai') {
        target = 'https://api.openai.com' + p
        key = true
      } else if (up.kind === 'custom') target = up.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + p
      else if (up.kind === 'ollama') target = up.baseUrl.replace(/\/+$/, '') + p
    }
    if (!target) return send(res, 404, { error: 'unsupported path for this upstream' })
    const body = req.method === 'POST' ? await readBody(req) : undefined
    const headers = { 'content-type': 'application/json' }
    if (key) headers.authorization = up.keyId ? `Bearer {{KEY:${up.keyId}}}` : 'Bearer {{KEY}}' // 자리표시자 — llm.cjs 가 PC 보안 저장소의 키로 바꾼다
    const r = await llmRequest({ url: target, method: req.method, headers, body, timeoutMs: 300_000 })
    if (r.error) return send(res, 502, { error: r.error })
    res.writeHead(r.status || 502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(r.text)
  }

  // ── Claude 구독 중계(폴링) ──
  function pushEvent(run, ev) {
    run.events.push(ev)
    const w = run.waiters.splice(0)
    for (const f of w) f()
  }
  async function claudeRun(req, res) {
    if (!claude.ready()) return send(res, 503, { error: 'claude not ready' })
    if (claude.busy()) return send(res, 409, { error: 'busy' })
    const b = await json(req)
    if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 20_000) return send(res, 400, { error: 'bad prompt' })
    const mode = b.mode === 'ask' ? 'ask' : 'edit'
    const run = { id: crypto.randomUUID(), events: [], done: false, waiters: [], pending: new Map(), mode, doneAt: 0 }
    runs.set(run.id, run)
    // 도구 호출은 폰으로 보내고 결과를 기다린다
    const callTool = (tool, args, client) =>
      new Promise((resolve, reject) => {
        const id = crypto.randomUUID()
        const timer = setTimeout(() => {
          run.pending.delete(id)
          reject(new Error('The phone did not answer in time'))
        }, TOOL_TIMEOUT_MS)
        run.pending.set(id, { resolve, reject, timer })
        pushEvent(run, { type: 'toolcall', id, tool, args, client })
      })
    void claude
      .run({ prompt: b.prompt, model: typeof b.model === 'string' ? b.model.slice(0, 80) : undefined, mode, forceApproval: b.forceApproval === true, callTool }, (ev) => pushEvent(run, ev))
      .catch((e) => pushEvent(run, { type: 'error', code: 'internal', message: e && e.message ? String(e.message) : 'error' }))
      .finally(() => {
        for (const [, p] of run.pending) {
          clearTimeout(p.timer)
          p.reject(new Error('run ended'))
        }
        run.pending.clear()
        run.done = true
        run.doneAt = now()
        pushEvent(run, { type: 'end' })
        setTimeout(() => runs.delete(run.id), RUN_KEEP_MS).unref?.()
      })
    send(res, 200, { runId: run.id })
  }
  async function claudePoll(req, res) {
    const b = await json(req)
    const run = runs.get(String(b.runId))
    if (!run) return send(res, 404, { error: 'unknown run' })
    const cursor = Number.isInteger(b.cursor) && b.cursor >= 0 ? b.cursor : 0
    if (run.events.length <= cursor && !run.done) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, deps.pollWaitMs || POLL_WAIT_MS)
        run.waiters.push(() => {
          clearTimeout(t)
          resolve()
        })
      })
    }
    send(res, 200, { events: run.events.slice(cursor), cursor: run.events.length, done: run.done })
  }
  async function claudeTool(req, res) {
    const b = await json(req)
    const run = runs.get(String(b.runId))
    const p = run && run.pending.get(String(b.id))
    if (!p) return send(res, 404, { error: 'unknown call' })
    run.pending.delete(String(b.id))
    clearTimeout(p.timer)
    if (typeof b.error === 'string') p.reject(new Error(b.error))
    else p.resolve(b.ok)
    send(res, 200, { ok: true })
  }
  async function claudeCancel(req, res) {
    const b = await json(req)
    const run = runs.get(String(b.runId))
    if (run && !run.done) claude.cancel()
    send(res, 200, { ok: true })
  }

  async function handle(req, res) {
    const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    try {
      if (!isPrivateAddress(remote)) return send(res, 403, { error: 'private network only' })
      const url = new URL(req.url || '/', 'http://relay')
      if (req.method === 'POST' && url.pathname === '/pair') return await pair(req, res, remote)
      const dev = authDevice(req)
      if (!dev) return send(res, 401, { error: 'unauthorized' })
      dev.lastSeen = now()
      if (req.method === 'GET' && url.pathname === '/ping') {
        const first = firstPublic()
        return send(res, 200, { name: deps.hostName || 'PC', upstream: first ? { kind: first.kind, model: first.model } : null, upstreams: upsPublic(), claude: !!claude.ready(), busy: !!claude.busy() })
      }
      if (req.method === 'POST' && url.pathname === '/claude/run') return await claudeRun(req, res)
      if (req.method === 'POST' && url.pathname === '/claude/poll') return await claudePoll(req, res)
      if (req.method === 'POST' && url.pathname === '/claude/tool') return await claudeTool(req, res)
      if (req.method === 'POST' && url.pathname === '/claude/cancel') return await claudeCancel(req, res)
      if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/u/')) return await proxy(req, res, url)
      send(res, 404, { error: 'not found' })
    } catch (e) {
      if (!res.headersSent) send(res, e && e.status ? e.status : 500, { error: e && e.status ? String(e.message) : 'internal error' })
    }
  }

  async function listen(port, host = '0.0.0.0') {
    if (srv) return srv.address().port
    const s = http.createServer((req, res) => void handle(req, res))
    s.requestTimeout = 0
    await new Promise((resolve, reject) => {
      s.once('error', reject)
      s.listen(port, host, resolve)
    })
    srv = s
    return s.address().port
  }
  async function close() {
    const s = srv
    srv = null
    if (!s) return
    await new Promise((r) => {
      s.close(() => r())
      s.closeAllConnections?.()
    })
  }

  return {
    state: () => state,
    codeNow,
    codeActive,
    newCode: issueCode,
    revokeCode() {
      code = null
    },
    listen,
    close,
    isRunning: () => !!srv,
    port: () => (srv ? srv.address().port : state.port),
    setEnabled(v) {
      state.enabled = v === true
      if (!state.enabled) code = null
      save()
    },
    revoke(id) {
      state.devices = state.devices.filter((d) => d.id !== id)
      save()
    },
    setError(e) {
      error = e
    },
    error: () => error,
  }
}

/** Electron 호스트: 설정 보관·창과의 IPC 연결 */
function register({ ipcMain, app, claudeRunner, llm }) {
  const fs = require('fs')
  const path = require('path')
  const file = path.join(app.getPath('userData'), 'relay.json')
  let upstreams = [] // 휴대폰에 빌려주는 AI 들(화면이 알려 준다)
  const relay = createRelay({
    store: {
      read: () => {
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8'))
        } catch {
          return null
        }
      },
      write: (v) => fs.writeFileSync(file, JSON.stringify(v), { mode: 0o600 }),
    },
    hostName: os.hostname(),
    getUpstream: () => upstreams[0] || null,
    getUpstreams: () => upstreams,
    llmRequest: (req) => llm.request(req),
    claude: {
      ready: () => claudeRunner.isReady(),
      busy: () => claudeRunner.isRunning(),
      run: (req, emit) => claudeRunner.run(req, emit),
      cancel: () => claudeRunner.cancel(),
    },
  })

  async function start() {
    if (relay.isRunning()) return
    relay.setError(null)
    const want = relay.state().port
    try {
      await relay.listen(want)
    } catch (e) {
      if (e && e.code === 'EADDRINUSE') {
        try {
          await relay.listen(0) // 정해 둔 포트가 쓰이는 중이면 빈 포트(이번 실행만)
        } catch (e2) {
          relay.setError(e2.message)
        }
      } else relay.setError(e && e.message)
    }
  }
  const status = () => {
    const ips = lanAddresses()
    const port = relay.port()
    const c = relay.state().enabled ? relay.codeActive() : null
    return {
      enabled: relay.state().enabled,
      running: relay.isRunning(),
      port,
      ips,
      code: c ? c.value : null,
      codeExpiresAt: c ? c.exp : null,
      // 주소 후보를 쉼표로 모두 넣는다 — 폰이 앞에서부터 닿는 주소를 찾는다
      pairs: c && ips.length ? [`nsd1:${ips.join(',')}:${port}:${c.value}`] : [],
      devices: relay.state().devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen })),
      upstream: upstreams[0] ? { kind: upstreams[0].kind, model: upstreams[0].model } : null,
      upstreams: upstreams.map((u) => ({ id: u.id, kind: u.kind, model: u.model })),
      claude: !!claudeRunner.isReady(),
      error: relay.error(),
    }
  }
  ipcMain.handle('relay:get', async () => {
    await claudeRunner.refreshReady()
    return status()
  })
  ipcMain.handle('relay:set', async (_e, patch) => {
    if (patch && typeof patch.enabled === 'boolean') {
      relay.setEnabled(patch.enabled)
      if (patch.enabled) await start()
      else await relay.close()
    }
    return status()
  })
  ipcMain.handle('relay:newCode', () => {
    relay.newCode()
    return status()
  })
  ipcMain.handle('relay:revokeCode', () => {
    relay.revokeCode()
    return status()
  })
  ipcMain.handle('relay:revoke', (_e, id) => {
    if (typeof id === 'string') relay.revoke(id)
    return status()
  })
  // 화면(렌더러)이 "휴대폰에 빌려주기"를 켠 AI 연결들을 알려 준다(키는 보내지 않는다 — 키는 보안 저장소에 있고 연결 id 로 찾는다)
  const ID_RE = /^c_[a-z0-9]{1,16}$/
  const cleanUp = (cfg) => {
    if (!cfg || typeof cfg.kind !== 'string' || typeof cfg.baseUrl !== 'string') return null
    const keyId = typeof cfg.keyId === 'string' && ID_RE.test(cfg.keyId) ? cfg.keyId : null
    const id = typeof cfg.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(cfg.id) ? cfg.id : keyId || 'default'
    return { id, kind: String(cfg.kind), baseUrl: String(cfg.baseUrl), model: String(cfg.model || ''), keyStored: cfg.keyStored === true, keyId }
  }
  ipcMain.handle('relay:upstreams', (_e, list) => {
    const seen = new Set()
    upstreams = (Array.isArray(list) ? list : [])
      .slice(0, 8)
      .map(cleanUp)
      .filter((u) => u && !seen.has(u.id) && seen.add(u.id))
    return true
  })
  // 예전 호출(연결 하나): 목록 하나로 본다
  ipcMain.handle('relay:upstream', (_e, cfg) => {
    const u = cleanUp(cfg)
    upstreams = u ? [u] : []
    return true
  })
  if (relay.state().enabled) void start()
  app.on('before-quit', () => void relay.close())
  return relay
}

module.exports = { createRelay, register, isPrivateAddress, lanAddresses, DEFAULT_PORT }
