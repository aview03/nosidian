// PC 호스트 폴더의 IPC 연결(메인 프로세스): 화면(렌더러)의 "호스트 폴더 Provider"가 hostStore 를 부른다.
//  - 폴더는 사용자가 PC 에서 직접 고른다(창에서 선택). 공유 폴더(fileShare)와 겹치는 폴더는 지정할 수 없다.
//  - 여기에는 **원격(폰) 쓰기 API 가 없다** — 폰의 쓰기는 v1.41. 이 IPC 는 이 PC 의 앱 화면만 부른다(preload 로 연결된 창).
//  - 모든 응답은 { ok, ... } 로 감싼다(IPC 예외는 상태 코드를 잃으므로).
const fs = require('fs')
const path = require('path')
const { openHost, overlaps } = require('./hostStore.cjs')
const { badShareDir } = require('./fileShare.cjs')

function register({ ipcMain, app, dialog, BrowserWindow }) {
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
    wrap(() => {
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

  app.on('before-quit', closeHost)
  return { dir: () => cfg.dir }
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
