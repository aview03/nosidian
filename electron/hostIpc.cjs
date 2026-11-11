// PC 호스트 폴더의 IPC 연결(메인 프로세스): 화면(렌더러)의 "호스트 폴더 Provider"가 hostStore 를 부른다.
//  - 폴더는 사용자가 PC 에서 직접 고른다(창에서 선택). 공유 폴더(fileShare)와 겹치는 폴더는 지정할 수 없다.
//  - 여기에는 **원격(폰) 쓰기 API 가 없다** — 폰의 쓰기는 v1.41. 이 IPC 는 이 PC 의 앱 화면만 부른다(preload 로 연결된 창).
//  - 모든 응답은 { ok, ... } 로 감싼다(IPC 예외는 상태 코드를 잃으므로).
const fs = require('fs')
const path = require('path')
const os = require('os')
const { openHost, overlaps } = require('./hostStore.cjs')
const { badShareDir } = require('./fileShare.cjs')
const { createHostServer, lanAddresses } = require('./hostServer.cjs')

function register({ ipcMain, app, dialog, BrowserWindow, getTls, allowDelete }) {
  const userData = app.getPath('userData')
  const cfgFile = path.join(userData, 'host.json')
  const shareFile = path.join(userData, 'share.json')
  let cfg = { dir: null }
  try {
    const v = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    if (v && typeof v.dir === 'string') cfg = { dir: v.dir }
  } catch {
    /* 아직 지정하지 않았다 */
  }
  let host = null
  const saveCfg = () => fs.writeFileSync(cfgFile, JSON.stringify(cfg), { mode: 0o600 })
  const shareDir = () => {
    try {
      const v = JSON.parse(fs.readFileSync(shareFile, 'utf8'))
      return v && typeof v.dir === 'string' ? v.dir : null
    } catch {
      return null
    }
  }
  const getHost = () => {
    if (!cfg.dir) throw Object.assign(new Error('no host folder'), { status: 412, code: 'noFolder' }) // 409(충돌)와 구분한다: 동기화가 "원격이 먼저 변경됨"으로 오해하지 않게
    if (!host) host = openHost(cfg.dir)
    return host
  }
  const closeHost = () => {
    if (host) host.close()
    host = null
  }
  /** 결과를 { ok:true, ... } / { ok:false, status, code, error, ... } 로 감싼다 */
  const wrap =
    (fn) =>
    async (_e, ...args) => {
      try {
        return { ok: true, ...(await fn(...args)) }
      } catch (e) {
        return { ok: false, status: (e && e.status) || 500, code: e && e.code, error: e && e.message ? String(e.message) : 'error', currentRev: e && e.currentRev, deleted: e && e.deleted }
      }
    }

  const status = () => {
    if (!cfg.dir) return { configured: false, dir: null }
    try {
      const h = getHost()
      return { configured: true, dir: cfg.dir, ...h.info(), snapshots: h.snapshots().length, devices: h.devices().length }
    } catch (e) {
      return { configured: true, dir: cfg.dir, unavailable: true, error: e && e.message ? String(e.message) : 'error' }
    }
  }

  // ── 휴대폰과 맞추기(이 PC 가 호스트): 호스트 동기화 서버. 켜기·기기 권한은 이 PC 의 화면에서만 바꾼다 ──
  const srvFile = path.join(userData, 'hostsrv.json')
  let server = null
  let serverInit = null
  const ensureServer = () => {
    if (server) return Promise.resolve(server)
    if (!serverInit) {
      serverInit = (async () => {
        const tls = await getTls()
        server = createHostServer({
          store: {
            read: () => {
              try {
                return JSON.parse(fs.readFileSync(srvFile, 'utf8'))
              } catch {
                return null
              }
            },
            write: (v) => fs.writeFileSync(srvFile, JSON.stringify(v), { mode: 0o600 }),
          },
          tls,
          hostName: os.hostname(),
          getHost, // 폴더가 없으면 412
          allowDelete: allowDelete === true,
        })
        return server
      })().finally(() => {
        serverInit = null
      })
    }
    return serverInit
  }
  const startServer = async () => {
    const s = await ensureServer()
    if (s.isRunning() || !cfg.dir) return
    s.setError(null)
    try {
      await s.listen(s.state().port)
    } catch (e) {
      if (e && e.code === 'EADDRINUSE') {
        try {
          await s.listen(0) // 정해 둔 포트가 쓰이는 중이면 빈 포트(이번 실행만)
        } catch (e2) {
          s.setError(e2.message)
        }
      } else s.setError(e && e.message)
    }
  }
  const srvStatus = async () => {
    const s = await ensureServer()
    const ips = lanAddresses()
    const port = s.port()
    const configured = !!cfg.dir
    const c = s.state().enabled && configured ? s.codeActive() : null
    return {
      hostConfigured: configured,
      enabled: s.state().enabled,
      running: s.isRunning(),
      port,
      ips,
      code: c ? c.value : null,
      codeExpiresAt: c ? c.exp : null,
      // 주소 후보·포트·코드·인증서 지문. 폰은 QR 스캔 또는 붙여 넣기로 짝을 맺는다(지문이 들어 있어 가로채기를 막는다)
      pair: c && ips.length ? `nsh1:${ips.join(',')}:${port}:${c.value}:${s.fingerprint()}` : null,
      fingerprint: s.fingerprint(),
      allowDelete: s.allowDelete,
      devices: s.state().devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen, perms: d.perms, writes: d.writes || 0, lastWriteAt: d.lastWriteAt || 0 })),
      error: s.error(),
    }
  }
  ipcMain.handle('hostsrv:get', wrap(srvStatus))
  ipcMain.handle(
    'hostsrv:set',
    wrap(async (patch) => {
      const s = await ensureServer()
      if (patch && typeof patch.enabled === 'boolean') {
        if (patch.enabled && !cfg.dir) throw Object.assign(new Error('no host folder'), { status: 412, code: 'noFolder' })
        s.setEnabled(patch.enabled)
        if (patch.enabled) await startServer()
        else await s.close()
      }
      return srvStatus()
    }),
  )
  ipcMain.handle('hostsrv:revokeCode', wrap(async () => (await ensureServer()).revokeCode() ?? srvStatus()))
  ipcMain.handle('hostsrv:newCode', wrap(async () => (await ensureServer()).newCode() && srvStatus()))
  ipcMain.handle(
    'hostsrv:revoke',
    wrap(async (id) => {
      const s = await ensureServer()
      if (typeof id === 'string') s.revoke(id)
      return srvStatus()
    }),
  )
  /** 기기별 권한(쓰기·삭제). 이 PC 의 화면에서만 부른다 — 폰이 스스로 권한을 올리는 요청은 서버에 없다 */
  ipcMain.handle(
    'hostsrv:setPerms',
    wrap(async (id, patch) => {
      const s = await ensureServer()
      if (typeof id !== 'string' || !s.setPerms(id, { write: patch && patch.write, delete: patch && patch.delete })) throw Object.assign(new Error('unknown device'), { status: 404, code: 'noDevice' })
      return srvStatus()
    }),
  )

  ipcMain.handle('host:status', wrap(status))
  ipcMain.handle(
    'host:pickDir',
    wrap(async () => {
      const win = BrowserWindow.getFocusedWindow()
      const res = await dialog.showOpenDialog(win || undefined, { properties: ['openDirectory', 'createDirectory'], title: 'Nosidian' })
      if (res.canceled || !res.filePaths[0]) return status()
      const chosen = res.filePaths[0]
      const bad = badShareDir(chosen, [userData, app.getPath('home')])
      if (bad) return { ...status(), pickError: bad }
      const sd = shareDir()
      if (sd && overlaps(chosen, sd)) return { ...status(), pickError: 'overlaps share' } // 공유 폴더와 겹치면 안 된다
      if (overlaps(chosen, userData)) return { ...status(), pickError: 'too broad' }
      closeHost()
      cfg = { dir: fs.realpathSync.native(chosen) }
      saveCfg()
      return status()
    }),
  )
  // 연결 해제: 설정만 지운다. 폴더와 그 안의 파일·.nosidian 은 그대로 둔다(되돌릴 수 있게)
  ipcMain.handle(
    'host:clear',
    wrap(async () => {
      if (server) {
        server.setEnabled(false) // 폴더가 없으면 폰이 맞출 곳이 없다 — 서버를 끈다
        await server.close()
      }
      closeHost()
      cfg = { dir: null }
      saveCfg()
      return status()
    }),
  )
  ipcMain.handle('host:list', wrap(() => ({ ...getHost().list() })))
  ipcMain.handle(
    'host:read',
    wrap((p) => {
      const r = getHost().read(p)
      return { b64: r.bytes.toString('base64'), rev: r.rev, hash: r.hash }
    }),
  )
  /** 이 PC 앱의 변경을 반영한다: [{ path, del?, b64?, baseRev }] 를 차례로. 앞의 변경이 반영된 뒤 실패하면 거기서 멈춘다 */
  ipcMain.handle(
    'host:push',
    wrap((changes) => {
      if (!Array.isArray(changes) || changes.length > 5000) throw Object.assign(new Error('bad request'), { status: 400 })
      const h = getHost()
      const revs = {}
      for (const c of changes) {
        if (!c || typeof c.path !== 'string') throw Object.assign(new Error('bad request'), { status: 400 })
        const baseRev = typeof c.baseRev === 'string' ? c.baseRev : null
        try {
          revs[c.path] = c.del === true ? h.del(c.path, baseRev, 'pc-app').rev : h.put(c.path, Buffer.from(String(c.b64 || ''), 'base64'), baseRev, 'pc-app').rev
        } catch (e) {
          if (e && typeof e === 'object') e.failedPath = c.path
          throw e
        }
      }
      return { revs }
    }),
  )
  ipcMain.handle(
    'host:ack',
    wrap((seq) => {
      const h = getHost()
      h.registerDevice('pc-app', { name: 'PC' })
      h.ack('pc-app', Number(seq) || 0)
      return {}
    }),
  )
  ipcMain.handle('host:snapshot', wrap((extra) => ({ ...getHost().snapshot({ vaultNotes: extra && extra.vaultNotes, label: extra && extra.label }) })))
  ipcMain.handle('host:snapshots', wrap(() => ({ snapshots: getHost().snapshots() })))
  ipcMain.handle('host:snapshotVault', wrap((id) => ({ vault: getHost().readSnapshotVault(String(id)) })))
  ipcMain.handle('host:gc', wrap(() => ({ ...getHost().gc() })))

  // 켜 두었다면 앱이 준비된 뒤 서버를 다시 연다(호스트 폴더가 지정돼 있을 때만)
  if (getTls) {
    void app.whenReady().then(async () => {
      const s = await ensureServer()
      if (s.state().enabled && cfg.dir) await startServer()
    })
  }
  app.on('before-quit', () => {
    if (server) void server.close()
    closeHost()
  })
  return { dir: () => cfg.dir, getServer: ensureServer }
}

/** 공유 폴더 쪽에서 호스트 폴더와 겹치는지 확인할 때 쓴다 */
function readHostDir(userData) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(userData, 'host.json'), 'utf8'))
    return v && typeof v.dir === 'string' ? v.dir : null
  } catch {
    return null
  }
}

module.exports = { register, readHostDir }
