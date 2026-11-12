// 휴대폰 → 이 PC 의 "공유 폴더" 읽기 전용 파일 공유(PC 앱). 기본은 꺼짐.
//  - HTTPS(자체 서명 인증서) 전용. 폰은 짝을 맺을 때 인증서 지문(SHA-256)을 QR 로 받아 고정(pin)하고, 이후 지문이 다르면 연결하지 않는다.
//  - AI 중계(aiRelay.cjs, 평문 http)와 완전히 분리: 별도 서버·별도 연결 코드·별도 기기 토큰. AI 중계의 토큰으로는 파일에 닿을 수 없다.
//  - 사용자가 지정한 폴더 하나 안의 파일만 **읽는다**: 목록(/list)과 내려받기(/get). 쓰기·삭제·이름 바꾸기·실행·임의 경로 접근 기능이 없다.
//  - 경로 방어: 상대 경로만, ".." · 숨김 · ":" · 역슬래시 · 윈도 예약 이름 · 끝의 점/공백 거절, 심볼릭 링크·정션은 목록에서 빼고 내려받기도 거절(realpath 가 달라지면 거절).
//  - 보안: 사설망 주소만, 토큰(해시로 보관) 필수, 연결 코드 6자리·5분·한 번만·5번 틀리면 1분 잠금, 기기 5대, 토큰 실패 반복 제한, 파일 1개 25MB.
// 노트(vault)에는 닿지 않는다. 폴더 지정·저장·인증서는 호스트(register)가 맡고 서버 본체(createShare)는 주입받는다 — 시험하기 쉽게.
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { isPrivateAddress, lanAddresses } = require('./aiRelay.cjs')

const DEFAULT_PORT = 47411
const CODE_TTL_MS = 5 * 60_000
const MAX_DEVICES = 5
const MAX_BODY = 64 * 1024
const MAX_FILE = 25 * 1024 * 1024
const MAX_ENTRIES = 5000
const MAX_DEPTH = 20

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const SKIP_DIRS = new Set(['node_modules'])

/** 인증서 PEM → 지문(SHA-256, 소문자 16진 64자) */
const fingerprintOf = (certPem) => new crypto.X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase()

/** 새 자체 서명 인증서(10년). 폰은 이 인증서의 지문을 페어링 때 고정한다 */
async function makeTls() {
  const ss = require('selfsigned')
  const r = await ss.generate([{ name: 'commonName', value: 'Nosidian PC' }], { keySize: 2048, days: 3650, algorithm: 'sha256' })
  return { key: r.private, cert: r.cert, fp: fingerprintOf(r.cert) }
}

/** 요청 경로 정리. 안전하지 않으면 null (상대 경로만, 숨김·상위·특수 문자 불가) */
function cleanRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 1000) return null
  if (rel.includes('\0') || rel.includes('\\') || rel.includes(':') || rel.startsWith('/')) return null
  const segs = rel.split('/')
  for (const s of segs) {
    if (!s || s === '.' || s === '..' || s.startsWith('.')) return null
    if (/[<>"|?*\u0000-\u001f]/.test(s) || /[. ]$/.test(s) || WIN_RESERVED.test(s)) return null
  }
  return segs.join('/')
}

/** 공유 폴더로 지정할 수 없는 곳(드라이브 루트·홈 폴더 자체·앱 데이터 등) */
function badShareDir(dir, extra = []) {
  try {
    const real = fs.realpathSync.native(dir)
    if (!fs.statSync(real).isDirectory()) return 'not a directory'
    const norm = (p) => path.resolve(p).toLowerCase()
    const r = norm(real)
    if (path.parse(real).root.toLowerCase() === r || r === path.parse(real).root.toLowerCase()) return 'drive root'
    for (const bad of [os.homedir(), ...extra]) if (bad && norm(bad) === r) return 'too broad'
    for (const w of [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]) if (w && (r === norm(w) || r.startsWith(norm(w) + path.sep))) return 'system folder'
    return null
  } catch {
    return 'not found'
  }
}

function createShare(deps) {
  const { store, tls } = deps
  const now = deps.now || (() => Date.now())
  let state = { enabled: false, port: DEFAULT_PORT, dir: null, devices: [] }
  try {
    const v = store.read()
    if (v)
      state = {
        enabled: v.enabled === true,
        port: Number.isInteger(v.port) && v.port > 1023 && v.port < 65536 ? v.port : DEFAULT_PORT,
        dir: typeof v.dir === 'string' && v.dir ? v.dir : null,
        devices: Array.isArray(v.devices) ? v.devices.filter((d) => d && typeof d.id === 'string' && typeof d.hash === 'string') : [],
      }
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
  let code = null
  const fails = new Map() // 원격 주소 → 연결 코드 실패 { n, until }
  const authFails = new Map() // 원격 주소 → 토큰 실패 { n, since }
  let srv = null
  const socks = new Set() // TLS 핸드셰이크를 끝내지 않은 연결까지 닫을 수 있게 모든 소켓을 기억한다
  let error = null

  const issueCode = () => {
    code = { value: newCode(), exp: now() + CODE_TTL_MS }
    return code
  }
  // 화면용: 지금 유효한 코드(없으면 null). 화면이 열 때마다 코드를 만들어 내지 않는다 — 사용자가 '기기 추가'를 눌렀을 때만 issueCode
  const codeActive = () => (code && code.exp > now() ? code : null)
  // 시험용: 유효한 코드가 없으면 발급한다
  const codeNow = () => codeActive() || issueCode()

  const send = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(obj))
  }
  const json = (req) =>
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
      req.on('end', () => {
        const t = Buffer.concat(chunks).toString('utf8')
        if (!t) return resolve({})
        try {
          const v = JSON.parse(t)
          resolve(v && typeof v === 'object' ? v : {})
        } catch {
          reject(Object.assign(new Error('bad json'), { status: 400 }))
        }
      })
      req.on('error', reject)
    })

  function authDevice(req) {
    const m = /^Bearer\s+([A-Za-z0-9]{32,128})$/.exec(String(req.headers.authorization || ''))
    if (!m) return null
    const a = Buffer.from(sha(m[1]))
    for (const d of state.devices) {
      const b = Buffer.from(d.hash)
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return d
    }
    return null
  }

  async function pair(req, res, remote) {
    const f = fails.get(remote)
    if (f && f.until > now()) return send(res, 429, { error: 'too many attempts' })
    const b = await json(req)
    const c = code
    const ok = c && c.exp > now() && typeof b.code === 'string' && b.code.length === 6 && crypto.timingSafeEqual(Buffer.from(b.code), Buffer.from(c.value))
    if (!ok) {
      const base = f && !(f.until && f.until <= now()) ? f.n : 0
      const n = base + 1
      fails.set(remote, { n, until: n >= 5 ? now() + 60_000 : 0 })
      return send(res, 403, { error: 'invalid code' })
    }
    // 기기 하나에 연결 링크(토큰) 하나: 같은 기기(clientId)가 다시 맺으면 기존 항목의 토큰을 바꿔 끼운다(중복 없음, 옛 토큰은 즉시 무효)
    const cid = typeof b.clientId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(b.clientId) ? b.clientId : null
    const prev = cid ? state.devices.find((d) => d.clientId === cid) : null
    if (!prev && state.devices.length >= MAX_DEVICES) return send(res, 409, { error: 'too many devices' })
    code = null
    fails.delete(remote)
    const token = crypto.randomBytes(24).toString('hex')
    const name = String(b.name || '휴대폰').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40).trim() || '휴대폰'
    if (prev) Object.assign(prev, { name, hash: sha(token), createdAt: now(), lastSeen: now() })
    else state.devices.push({ id: crypto.randomUUID(), ...(cid ? { clientId: cid } : {}), name, hash: sha(token), createdAt: now(), lastSeen: now() })
    save()
    send(res, 200, { token, name: deps.hostName || 'PC', dirName: state.dir ? path.basename(state.dir) : null, fp: tls.fp })
  }

  // ── 읽기 전용 파일 접근 ──
  const rootReal = () => {
    if (!state.dir) throw Object.assign(new Error('no shared folder'), { status: 409 })
    try {
      return fs.realpathSync.native(state.dir)
    } catch {
      throw Object.assign(new Error('shared folder is not available'), { status: 409 })
    }
  }
  const sameFile = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

  function walk(root) {
    const entries = []
    let truncated = false
    const visit = (dirAbs, rel, depth) => {
      if (depth > MAX_DEPTH || truncated) return
      let items
      try {
        items = fs.readdirSync(dirAbs, { withFileTypes: true })
      } catch {
        return
      }
      for (const it of items) {
        if (truncated) return
        const name = it.name
        if (!cleanRel(name)) continue // 숨김·특수 이름
        if (it.isSymbolicLink()) continue // 심볼릭 링크·정션은 따라가지 않는다
        const childRel = rel ? `${rel}/${name}` : name
        const abs = path.join(dirAbs, name)
        if (it.isDirectory()) {
          if (!SKIP_DIRS.has(name)) visit(abs, childRel, depth + 1)
        } else if (it.isFile()) {
          try {
            const st = fs.statSync(abs)
            if (entries.length >= MAX_ENTRIES) {
              truncated = true
              return
            }
            entries.push({ path: childRel, size: st.size, mtime: Math.round(st.mtimeMs) })
          } catch {
            /* 읽을 수 없는 파일은 뺀다 */
          }
        }
      }
    }
    visit(root, '', 0)
    entries.sort((a, b) => a.path.localeCompare(b.path, 'ko'))
    return { entries, truncated }
  }

  async function list(res) {
    const root = rootReal()
    const { entries, truncated } = walk(root)
    send(res, 200, { name: path.basename(state.dir), entries, truncated })
  }

  async function get(req, res) {
    const b = await json(req)
    const rel = cleanRel(b.path)
    if (!rel) return send(res, 400, { error: 'bad path' })
    const root = rootReal()
    const full = path.join(root, ...rel.split('/'))
    let real
    try {
      real = fs.realpathSync.native(full)
    } catch {
      return send(res, 404, { error: 'not found' })
    }
    // 중간에 심볼릭 링크·정션이 있으면 실제 경로가 요청 경로와 달라진다 → 거절
    if (!sameFile(real, full) || !(real.toLowerCase() + path.sep).startsWith(root.toLowerCase() + path.sep)) return send(res, 403, { error: 'forbidden' })
    let fd
    try {
      if (!fs.lstatSync(full).isFile()) return send(res, 404, { error: 'not a file' })
      fd = fs.openSync(full, 'r')
      const st = fs.fstatSync(fd)
      if (!st.isFile()) return send(res, 404, { error: 'not a file' })
      if (st.size > MAX_FILE) return send(res, 413, { error: 'file too large' })
      const buf = Buffer.alloc(st.size)
      let off = 0
      while (off < st.size) {
        const n = fs.readSync(fd, buf, off, st.size - off, off)
        if (n <= 0) break
        off += n
      }
      const data = buf.subarray(0, off)
      send(res, 200, { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), b64: data.toString('base64') })
    } catch {
      send(res, 404, { error: 'not found' })
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  function revokeDevice(id) {
    state.devices = state.devices.filter((d) => d.id !== id)
    save()
  }

  async function handle(req, res) {
    const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    try {
      if (!isPrivateAddress(remote)) return send(res, 403, { error: 'private network only' })
      const url = new URL(req.url || '/', 'https://share')
      if (req.method === 'POST' && url.pathname === '/pair') return await pair(req, res, remote)
      const af = authFails.get(remote)
      if (af && af.n >= 20 && now() - af.since < 60_000) return send(res, 429, { error: 'too many attempts' })
      const dev = authDevice(req)
      if (!dev) {
        const base = af && now() - af.since < 60_000 ? af : { n: 0, since: now() }
        authFails.set(remote, { n: base.n + 1, since: base.since })
        return send(res, 401, { error: 'unauthorized' })
      }
      dev.lastSeen = now()
      // 휴대폰이 스스로 연결을 해제한다(자기 자신만 — 토큰으로 인증된 기기). 폰에서 해제해도 이 PC 의 "연결된 휴대폰" 목록에 남던 것을 막는다(5-c)
      if (req.method === 'POST' && url.pathname === '/unpair') {
        revokeDevice(dev.id)
        return send(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/ping') return send(res, 200, { name: deps.hostName || 'PC', dirName: state.dir ? path.basename(state.dir) : null, shared: !!state.dir })
      if (req.method === 'POST' && url.pathname === '/list') return await list(res)
      if (req.method === 'POST' && url.pathname === '/get') return await get(req, res)
      send(res, 404, { error: 'not found' })
    } catch (e) {
      if (!res.headersSent) send(res, e && e.status ? e.status : 500, { error: e && e.status ? String(e.message) : 'internal error' })
    }
  }

  async function listen(port, host = '0.0.0.0') {
    if (srv) return srv.address().port
    const s = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2', handshakeTimeout: 10_000 }, (req, res) => void handle(req, res))
    s.requestTimeout = 30_000
    s.on('connection', (c) => {
      socks.add(c)
      c.on('close', () => socks.delete(c))
    })
    s.on('tlsClientError', () => {}) // 평문 http 등 TLS 가 아닌 접속은 조용히 버린다
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
      for (const c of socks) c.destroy()
    })
  }

  return {
    state: () => state,
    fingerprint: () => tls.fp,
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
    /** 공유 폴더 지정(null 이면 해제). 지정할 수 없는 곳이면 이유를 돌려준다 */
    setDir(dir, extraBad = []) {
      if (dir === null) {
        state.dir = null
        save()
        return null
      }
      const bad = badShareDir(dir, extraBad)
      if (bad) return bad
      state.dir = fs.realpathSync.native(dir)
      save()
      return null
    },
    revoke(id) {
      revokeDevice(id)
    },
    setError(e) {
      error = e
    },
    error: () => error,
  }
}

/** Electron 호스트: 설정·인증서 보관, 폴더 선택 창, 창과의 IPC 연결 */
function register({ ipcMain, app, dialog, safeStorage, BrowserWindow }) {
  const dirU = app.getPath('userData')
  const file = path.join(dirU, 'share.json')
  const tlsFile = path.join(dirU, 'share-tls.json')
  let relay = null

  /** 인증서(개인키 포함)는 가능하면 운영체제 보안 저장소로 암호화해서 둔다 */
  async function loadTls() {
    try {
      const v = JSON.parse(fs.readFileSync(tlsFile, 'utf8'))
      const key = v.enc ? safeStorage.decryptString(Buffer.from(v.key, 'base64')) : v.key
      if (v.cert && key) return { key, cert: v.cert, fp: fingerprintOf(v.cert) }
    } catch {
      /* 없거나 읽을 수 없으면 새로 만든다 */
    }
    const t = await makeTls()
    const enc = safeStorage && safeStorage.isEncryptionAvailable()
    fs.writeFileSync(tlsFile, JSON.stringify({ cert: t.cert, enc, key: enc ? safeStorage.encryptString(t.key).toString('base64') : t.key }), { mode: 0o600 })
    return t
  }

  /** 이 PC 의 인증서(공유 폴더 서버와 호스트 동기화 서버가 같은 것을 쓴다 → 폰이 고정한 지문이 하나). 앱이 준비된 뒤에만 읽고, 한 번만 만든다 */
  let tlsPromise = null
  const getTls = () => {
    if (!tlsPromise) {
      tlsPromise = (async () => {
        await app.whenReady()
        return loadTls()
      })()
      tlsPromise.catch(() => {
        tlsPromise = null // 실패하면 다음에 다시 시도한다
      })
    }
    return tlsPromise
  }

  let initializing = null
  /** 서버 상태를 한 번만 만든다(동시에 여러 곳에서 불려도 인증서는 하나). 앱이 준비되기 전에는 인증서 개인키를 복호화하지 않는다 —
   *  실패하면 인증서가 새로 만들어져 이미 짝을 맺은 폰의 고정 지문이 깨진다 */
  function ensure() {
    if (relay) return Promise.resolve(relay)
    if (!initializing) {
      initializing = (async () => {
        const tls = await getTls()
        relay = createShare({
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
          tls,
          hostName: os.hostname(),
        })
        return relay
      })().finally(() => {
        initializing = null
      })
    }
    return initializing
  }

  async function start() {
    const r = await ensure()
    if (r.isRunning()) return
    r.setError(null)
    try {
      await r.listen(r.state().port)
    } catch (e) {
      if (e && e.code === 'EADDRINUSE') {
        try {
          await r.listen(0)
        } catch (e2) {
          r.setError(e2.message)
        }
      } else r.setError(e && e.message)
    }
  }
  const status = async () => {
    const r = await ensure()
    const ips = lanAddresses()
    const port = r.port()
    const c = r.state().enabled && r.state().dir ? r.codeActive() : null
    return {
      enabled: r.state().enabled,
      running: r.isRunning(),
      port,
      ips,
      dir: r.state().dir,
      code: c ? c.value : null,
      codeExpiresAt: c ? c.exp : null,
      // 주소 후보·포트·코드·인증서 지문. 폰의 QR 스캔 또는 붙여 넣기 — 지문까지 들어 있어 가로채기를 막는다
      pair: c && ips.length ? `nsf1:${ips.join(',')}:${port}:${c.value}:${r.fingerprint()}` : null,
      fingerprint: r.fingerprint(),
      devices: r.state().devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen })),
      error: r.error(),
    }
  }
  ipcMain.handle('share:get', status)
  ipcMain.handle('share:set', async (_e, patch) => {
    const r = await ensure()
    if (patch && typeof patch.enabled === 'boolean') {
      r.setEnabled(patch.enabled)
      if (patch.enabled) await start()
      else await r.close()
    }
    return status()
  })
  ipcMain.handle('share:pickDir', async () => {
    const r = await ensure()
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win || undefined, { properties: ['openDirectory'], title: 'Nosidian' })
    if (res.canceled || !res.filePaths[0]) return { ...(await status()), pickError: null }
    const hostDir = require('./hostIpc.cjs').readHostDir(dirU)
    if (hostDir && require('./hostStore.cjs').overlaps(res.filePaths[0], hostDir)) return { ...(await status()), pickError: 'overlaps host' } // 호스트 폴더(Vault 저장소)와 겹치면 안 된다
    const bad = r.setDir(res.filePaths[0], [dirU, app.getPath('home')])
    return { ...(await status()), pickError: bad }
  })
  ipcMain.handle('share:clearDir', async () => {
    const r = await ensure()
    r.setDir(null)
    return status()
  })
  ipcMain.handle('share:newCode', async () => {
    const r = await ensure()
    r.newCode()
    return status()
  })
  ipcMain.handle('share:revokeCode', async () => {
    const r = await ensure()
    r.revokeCode()
    return status()
  })
  ipcMain.handle('share:revoke', async (_e, id) => {
    const r = await ensure()
    if (typeof id === 'string') r.revoke(id)
    return status()
  })
  // safeStorage(인증서 개인키 복호화)는 앱이 준비된 뒤에만 쓸 수 있다 — 먼저 부르면 복호화가 실패해 인증서가 새로 만들어져 폰의 고정 지문이 깨진다
  void app.whenReady().then(async () => {
    const r = await ensure()
    if (r.state().enabled) await start()
  })
  app.on('before-quit', () => void relay?.close())
  return { getTls }
}

module.exports = { createShare, register, makeTls, cleanRel, badShareDir, fingerprintOf, DEFAULT_PORT, MAX_FILE }
