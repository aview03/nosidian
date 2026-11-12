// PC 호스트 동기화 서버(v1.41): 페어링한 휴대폰이 호스트 폴더(Vault 저장소)를 **읽고**, PC 에서 허용한 기기만 **쓴다**. 폰 쪽 Provider 는 v1.42.
//  - HTTPS(자체 서명 인증서, 폰이 지문을 고정) 전용. 공유 폴더 서버(fileShare.cjs)와 같은 PC 인증서를 쓰지만 **별도 서버·별도 연결 코드·별도 기기 토큰**이다.
//  - 권한(기기별, PC 에서만 바꾼다): 읽기(기본) · 쓰기(PC 에서 명시적으로 켜야 함, 기본 꺼짐) · 삭제(별도 권한, 이번 버전에서는 꺼 둠 — allowDelete 가 꺼져 있으면 켤 수 없다).
//    해제·권한 회수는 다음 요청부터 즉시 적용된다. 기기는 자신의 권한을 올릴 수 없다(그런 요청 자체가 없다).
//  - 쓰기는 조건부(baseRev: 내가 마지막으로 본 rev 가 그대로일 때만, 다르면 409 + 현재 rev)이고 원자적이다 — hostStore.put 이 한다(tmp → journal → rename → manifest).
//  - 쓰기 거부: 권한 없음 403 · 실행 파일(확장자 또는 PE/ELF/Mach-O 머리) 403 · 경로 우회·링크 403/400 · 25MB 초과 413 · 공간 부족 507 · 너무 잦은 쓰기 429.
//  - 호스트는 어떤 파일도 열거나 실행하지 않는다. 폰이 보낸 파일은 그대로 저장만 한다.
// 폴더 접근은 hostStore 인스턴스(getHost)가 한다 — PC 앱(IPC)과 같은 인스턴스라 한 프로세스에서 순서대로 처리된다.
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { isPrivateAddress, lanAddresses } = require('./aiRelay.cjs')
const { looksExecutable, HostError, MAX_FILE } = require('./hostStore.cjs')

const DEFAULT_PORT = 47412
const CODE_TTL_MS = 5 * 60_000
const MAX_DEVICES = 5
const SMALL_BODY = 64 * 1024
const PUT_BODY = Math.ceil((MAX_FILE * 4) / 3) + 4096 // base64 25MB
const WRITES_PER_MIN = 120
/** 삭제는 더 느리게: 폰의 로컬 데이터가 잘못되어 한꺼번에 지우라고 해도 분당 이만큼만 지운다(휴지통으로 가지만 PC 사용자가 알아챌 시간을 준다) */
const DELETES_PER_MIN = 30
const MIN_FREE = 200 * 1024 * 1024

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

function createHostServer(deps) {
  const { store, tls, getHost } = deps
  const now = deps.now || (() => Date.now())
  const allowDelete = deps.allowDelete === true
  const freeBytes = deps.freeBytes || ((root) => {
    const sf = fs.statfsSync(root)
    return Number(sf.bavail) * Number(sf.bsize)
  })
  let state = { enabled: false, port: DEFAULT_PORT, devices: [] }
  try {
    const v = store.read()
    if (v)
      state = {
        enabled: v.enabled === true,
        port: Number.isInteger(v.port) && v.port > 1023 && v.port < 65536 ? v.port : DEFAULT_PORT,
        devices: Array.isArray(v.devices)
          ? v.devices
              .filter((d) => d && typeof d.id === 'string' && typeof d.hash === 'string')
              .map((d) => ({ ...d, perms: { write: d.perms && d.perms.write === true, delete: allowDelete && d.perms && d.perms.write === true && d.perms.delete === true } })) // 삭제는 쓰기가 켜져 있을 때만 의미가 있다
          : [],
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
  const fails = new Map()
  const authFails = new Map()
  const writeLog = new Map() // 기기 id → 최근 쓰기 시각들
  const delLog = new Map() // 기기 id → 최근 삭제 시각들
  let srv = null
  let lastSnapshotAt = 0
  const socks = new Set()
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
  const json = (req, limit) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
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
    const b = await json(req, SMALL_BODY)
    const c = code
    const ok = c && c.exp > now() && typeof b.code === 'string' && b.code.length === 6 && crypto.timingSafeEqual(Buffer.from(b.code), Buffer.from(c.value))
    if (!ok) {
      const base = f && !(f.until && f.until <= now()) ? f.n : 0
      const n = base + 1
      fails.set(remote, { n, until: n >= 5 ? now() + 60_000 : 0 })
      return send(res, 403, { error: 'invalid code' })
    }
    let host
    try {
      host = getHost()
    } catch (e) {
      return send(res, (e && e.status) || 412, { error: 'no host folder', code: 'noFolder' })
    }
    // 기기 하나에 연결 링크(토큰) 하나: 같은 기기(clientId)가 다시 맺으면 기존 항목의 토큰을 바꿔 끼운다(중복 없음, 옛 토큰은 즉시 무효)
    const cid = typeof b.clientId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(b.clientId) ? b.clientId : null
    const prev = cid ? state.devices.find((d) => d.clientId === cid) : null
    if (!prev && state.devices.length >= MAX_DEVICES) return send(res, 409, { error: 'too many devices' })
    code = null
    fails.delete(remote)
    const token = crypto.randomBytes(24).toString('hex')
    const name = String(b.name || '휴대폰').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40).trim() || '휴대폰'
    const id = prev ? prev.id : crypto.randomUUID() // 같은 기기는 같은 id 를 유지(삭제 기록 반영 확인·기기 목록이 갈라지지 않게)
    // 기본은 읽기 전용: 쓰기·삭제 권한은 PC 에서 명시적으로 켠다. 다시 맺으면 권한도 처음(읽기만)으로 돌아간다
    if (prev) Object.assign(prev, { name, hash: sha(token), createdAt: now(), lastSeen: now(), perms: { write: false, delete: false } })
    else state.devices.push({ id, ...(cid ? { clientId: cid } : {}), name, hash: sha(token), createdAt: now(), lastSeen: now(), perms: { write: false, delete: false }, writes: 0, lastWriteAt: 0 })
    save()
    host.registerDevice(id, { name })
    send(res, 200, { token, deviceId: id, name: deps.hostName || 'PC', folder: path.basename(host.root), fp: tls.fp, perms: { write: false, delete: false } })
  }

  const hostOr412 = () => {
    try {
      return getHost()
    } catch (e) {
      throw Object.assign(new Error('no host folder'), { status: (e && e.status) || 412, code: 'noFolder' })
    }
  }
  const by = (d) => `device:${d.id.slice(0, 8)}`

  async function put(req, res, dev) {
    // 쓰기 권한은 요청마다 확인한다(PC 에서 끄면 다음 요청부터 바로 막힌다). 본문을 읽기 전에 거절해 큰 파일을 받지 않는다
    if (!dev.perms.write) return send(res, 403, { error: 'write is not allowed for this device', code: 'noWrite' })
    const b = await json(req, PUT_BODY)
    if (typeof b.path !== 'string' || typeof b.b64 !== 'string') return send(res, 400, { error: 'bad request', code: 'badRequest' })
    const baseRev = typeof b.baseRev === 'string' ? b.baseRev : null
    const bytes = Buffer.from(b.b64, 'base64')
    if (bytes.length > MAX_FILE) return send(res, 413, { error: 'file too large', code: 'tooLarge' })
    if (looksExecutable(b.path, bytes.subarray(0, 8))) return send(res, 403, { error: 'executable files cannot be written from a phone', code: 'executable' })
    const t = now()
    const log = (writeLog.get(dev.id) || []).filter((x) => t - x < 60_000)
    if (log.length >= WRITES_PER_MIN) return send(res, 429, { error: 'too many writes', code: 'rate' })
    const host = hostOr412()
    let free = Infinity
    try {
      free = freeBytes(host.root)
    } catch {
      /* 공간을 알 수 없으면 쓰기 자체의 성공 여부로 */
    }
    if (free < bytes.length + MIN_FREE) return send(res, 507, { error: 'not enough free space on the PC', code: 'noSpace' })
    const r = host.put(b.path, bytes, baseRev, by(dev))
    log.push(t)
    writeLog.set(dev.id, log)
    dev.writes = (dev.writes || 0) + 1
    dev.lastWriteAt = t
    save()
    send(res, 200, { rev: r.rev, seq: r.seq })
  }

  async function del(req, res, dev) {
    if (!allowDelete || !dev.perms.write || !dev.perms.delete) return send(res, 403, { error: 'delete is not allowed for this device', code: 'noDelete' })
    const t = now()
    const log = (delLog.get(dev.id) || []).filter((x) => t - x < 60_000)
    if (log.length >= DELETES_PER_MIN) return send(res, 429, { error: 'too many deletes', code: 'rate' })
    const b = await json(req, SMALL_BODY)
    if (typeof b.path !== 'string') return send(res, 400, { error: 'bad request', code: 'badRequest' })
    const r = hostOr412().del(b.path, typeof b.baseRev === 'string' ? b.baseRev : null, by(dev))
    log.push(t)
    delLog.set(dev.id, log)
    dev.lastWriteAt = now()
    save()
    send(res, 200, { rev: r.rev, seq: r.seq })
  }

  function revokeDevice(id) {
    state.devices = state.devices.filter((d) => d.id !== id)
    writeLog.delete(id)
    delLog.delete(id)
    save()
    try {
      getHost().removeDevice(id) // 해제한 기기는 삭제 기록 정리에서 더 기다리지 않는다
    } catch {
      /* 호스트 폴더가 없으면 건너뛴다 */
    }
  }

  async function handle(req, res) {
    const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    try {
      if (!isPrivateAddress(remote)) return send(res, 403, { error: 'private network only' })
      const url = new URL(req.url || '/', 'https://host')
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
      if (req.method === 'POST' && url.pathname === '/unpair') {
        revokeDevice(dev.id)
        return send(res, 200, { ok: true })
      }
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' })
      switch (url.pathname) {
        case '/ping': {
          const h = hostOr412()
          // ips: 이 PC 의 현재 주소 후보. IP 가 바뀌어도 폰이 다시 찾을 수 있게 알려 준다(기기 식별은 IP 가 아니라 기기 ID·인증서 지문)
          return send(res, 200, { name: deps.hostName || 'PC', folder: path.basename(h.root), perms: dev.perms, epoch: h.info().epoch, ips: (deps.lanAddresses || lanAddresses)() })
        }
        case '/list':
          return send(res, 200, hostOr412().list())
        case '/get': {
          const b = await json(req, SMALL_BODY)
          const r = hostOr412().read(String(b.path ?? ''))
          return send(res, 200, { rev: r.rev, size: r.bytes.length, sha256: r.hash, b64: r.bytes.toString('base64') })
        }
        case '/snapshot': {
          // 최초 연결 직전에 호스트 폴더를 스냅샷으로 남긴다. 디스크를 쓰므로 쓰기 권한이 있는 기기만, 1분에 한 번만
          if (!dev.perms.write) return send(res, 403, { error: 'write is not allowed for this device', code: 'noWrite' })
          const t = now()
          if (lastSnapshotAt && t - lastSnapshotAt < 60_000) return send(res, 429, { error: 'snapshot too frequent', code: 'rate' })
          const b = await json(req, SMALL_BODY)
          const host = hostOr412()
          let free = Infinity
          try {
            free = freeBytes(host.root)
          } catch {
            /* 알 수 없으면 복사의 성공 여부로 */
          }
          if (free < MIN_FREE) return send(res, 507, { error: 'not enough free space on the PC', code: 'noSpace' })
          const r = host.snapshot({ label: typeof b.label === 'string' ? b.label.slice(0, 40) : `device:${dev.id.slice(0, 8)}` })
          lastSnapshotAt = t
          return send(res, 200, r)
        }
        case '/ack': {
          const b = await json(req, SMALL_BODY)
          hostOr412().ack(dev.id, Number(b.seq) || 0)
          return send(res, 200, { ok: true })
        }
        case '/put':
          return await put(req, res, dev)
        case '/delete':
          return await del(req, res, dev)
        default:
          return send(res, 404, { error: 'not found' })
      }
    } catch (e) {
      if (res.headersSent) return
      if (e instanceof HostError || (e && e.status && e.code)) {
        return send(res, e.status, { error: String(e.message), code: e.code, currentRev: e.currentRev ?? undefined, deleted: e.deleted === true ? true : undefined })
      }
      send(res, e && e.status ? e.status : 500, { error: e && e.status ? String(e.message) : 'internal error' })
    }
  }

  async function listen(port, host = '0.0.0.0') {
    if (srv) return srv.address().port
    const s = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2', handshakeTimeout: 10_000 }, (req, res) => void handle(req, res))
    s.requestTimeout = 120_000
    s.on('connection', (c) => {
      socks.add(c)
      c.on('close', () => socks.delete(c))
    })
    s.on('tlsClientError', () => {})
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
    allowDelete,
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
    /** 기기별 권한. PC 화면에서만 부른다. 삭제 권한은 allowDelete 가 꺼져 있으면 켤 수 없다 */
    setPerms(id, patch) {
      const d = state.devices.find((x) => x.id === id)
      if (!d) return false
      if (patch && typeof patch.write === 'boolean') {
        d.perms.write = patch.write
        if (!patch.write) d.perms.delete = false // 쓰기를 끄면 삭제도 함께 꺼진다
      }
      if (patch && typeof patch.delete === 'boolean') {
        if (patch.delete && !allowDelete) throw Object.assign(new Error('delete permission is not available yet'), { status: 403, code: 'noDelete' })
        if (patch.delete && !d.perms.write) throw Object.assign(new Error('allow writing before allowing delete'), { status: 412, code: 'needWrite' })
        d.perms.delete = patch.delete
      }
      save()
      return true
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

module.exports = { createHostServer, DEFAULT_PORT, lanAddresses }
