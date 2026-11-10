// MCP 서버를 앱에 붙인다: 설정(켜짐·포트·토큰) 보관, 서버 시작/중지, 도구 호출을 본 창(렌더러)에 중계.
//
// 기본은 꺼짐이다. 켜면 127.0.0.1 에만 열리고 토큰이 있어야 쓸 수 있다. 문서 데이터는 렌더러(IndexedDB)에 있어서
// 도구 호출을 본 창으로 넘기고(mcp:call), 렌더러가 vault 범위 확인·정책 엔진·승인 흐름을 거쳐 답한다(mcp:reply).
// 이 파일에는 문서를 읽거나 쓰는 코드가 없다.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { createMcpServer } = require('./mcp.cjs')

const DEFAULT_PORT = 47322
const REPLY_TIMEOUT_MS = 25_000

function register({ ipcMain, app, getWindow }) {
  const file = path.join(app.getPath('userData'), 'mcp.json')
  const newToken = () => crypto.randomBytes(24).toString('hex')

  function load() {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { enabled: v.enabled === true, port: Number.isInteger(v.port) && v.port > 1023 && v.port < 65536 ? v.port : DEFAULT_PORT, token: typeof v.token === 'string' && v.token.length >= 32 ? v.token : newToken() }
    } catch {
      return { enabled: false, port: DEFAULT_PORT, token: newToken() }
    }
  }
  const save = () => {
    try {
      fs.writeFileSync(file, JSON.stringify(cfg), { mode: 0o600 })
    } catch {
      /* 저장 실패: 이번 실행에서만 유지 */
    }
  }

  let cfg = load()
  let srv = null
  let error = null
  const pending = new Map()

  /** 본 창(렌더러)에 도구 호출을 넘기고 답을 기다린다 */
  function callRenderer(tool, args, client, internal, readOnly, forceApproval) {
    const win = getWindow()
    if (!win || win.isDestroyed()) return Promise.reject(new Error('The Nosidian window is closed. Open the Nosidian app (and keep it open) to use these tools.'))
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Nosidian did not answer in time'))
      }, REPLY_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      win.webContents.send('mcp:call', { id, tool, args, client, internal: internal === true, readOnly: readOnly === true, forceApproval: forceApproval === true })
    })
  }

  ipcMain.handle('mcp:reply', (_e, id, result) => {
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    clearTimeout(p.timer)
    if (result && typeof result === 'object' && typeof result.error === 'string') p.reject(new Error(result.error))
    else p.resolve(result ? result.ok : undefined)
  })

  async function start() {
    if (srv) return
    error = null
    const s = createMcpServer({ token: cfg.token, version: app.getVersion(), callTool: callRenderer })
    try {
      await s.listen(cfg.port)
    } catch (e) {
      if (e && e.code === 'EADDRINUSE') {
        try {
          await s.listen(0) // 정해 둔 포트가 쓰이는 중이면 빈 포트(이번 실행만)
        } catch (e2) {
          error = e2.message
          return
        }
      } else {
        error = e && e.message
        return
      }
    }
    srv = s
  }
  async function stop() {
    const s = srv
    srv = null
    if (s) await s.close()
    for (const [id, p] of pending) {
      clearTimeout(p.timer)
      p.reject(new Error('MCP server stopped'))
      pending.delete(id)
    }
  }

  // stdio 만 쓰는 클라이언트용 중계 스크립트의 위치(설치본은 asar 밖으로 풀어 둔다)
  const stdioPath = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'mcp-stdio.cjs') : path.join(__dirname, 'mcp-stdio.cjs')
  const status = () => ({ enabled: cfg.enabled, running: !!srv, port: srv ? srv.port : cfg.port, token: cfg.token, error, stdioPath })

  ipcMain.handle('mcp:get', () => status())
  ipcMain.handle('mcp:set', async (_e, patch) => {
    if (patch && typeof patch.enabled === 'boolean') cfg.enabled = patch.enabled
    if (patch && patch.regenerate === true) {
      cfg.token = newToken()
      await stop() // 바뀐 토큰으로 다시 시작
    }
    save()
    if (cfg.enabled) await start()
    else await stop()
    return status()
  })

  /**
   * 앱 안 AI(claude CLI) 한 번 실행 동안만 여는 임시 MCP 서버: 무작위 포트·토큰, 지금 열려 있는 vault 하나에만 닿는다(internal).
   * 사용자가 외부 AI 용 MCP 를 켜 두지 않아도 쓸 수 있고, 외부 연결 설정(vault 선택·토큰)과 섞이지 않는다.
   */
  async function startInternal(opts) {
    const readOnly = !!(opts && opts.readOnly)
    const forceApproval = !!(opts && opts.forceApproval)
    const token = crypto.randomBytes(24).toString('hex')
    const s = createMcpServer({ token, version: app.getVersion(), callTool: (tool, args, client) => callRenderer(tool, args, client, true, readOnly, forceApproval) })
    const port = await s.listen(0)
    return { url: `http://127.0.0.1:${port}/mcp`, token, close: () => s.close() }
  }

  if (cfg.enabled) void start()
  app.on('before-quit', () => void stop())
  return { startInternal }
}

module.exports = { register, DEFAULT_PORT }
