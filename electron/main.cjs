// Windows(데스크톱) 셸: 빌드된 dist 를 고정 포트의 로컬 서버로 서빙하고 창에 띄운다.
// 고정 origin(http://localhost:47321) 덕분에 노트(IndexedDB)·설정이 실행할 때마다 유지되고,
// OAuth 리디렉션(/oauth)도 이 서버가 받는다.
const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const widget = require('./widget.cjs')

// 저장 위치(%APPDATA%\Amsidian)가 패키지 이름(app)이 아니라 이 이름을 따르도록 한다.
// 앱 표시 이름은 Nosidian 으로 바뀌었지만, 이 값을 바꾸면 기존 노트·설정이 있는 폴더가 달라져 사라진 것처럼 보이므로 그대로 둔다.
app.setName('Amsidian')

const PORT = Number(process.env.NOSIDIAN_PORT) || 47321 // 환경 변수는 시험용(설치된 앱과 동시에 띄울 때)
const ORIGIN = `http://localhost:${PORT}`
const ROOT = path.join(__dirname, '..', 'dist')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

let win = null

// ── 탐색기/연결 프로그램으로 열린 파일 ──
const NOTE_EXT = /\.(md|markdown|txt)$/i
const MAX_BYTES = 5 * 1024 * 1024
let pendingFiles = []

/** 실행 인자 중 읽을 수 있는 마크다운 파일만 골라 대기열에 넣는다 */
function queueFiles(argv) {
  let added = false
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-') || !NOTE_EXT.test(a)) continue
    try {
      const st = fs.statSync(a)
      if (!st.isFile() || st.size > MAX_BYTES) continue
      pendingFiles.push({ name: path.basename(a), content: fs.readFileSync(a, 'utf8'), path: path.resolve(a) })
      added = true
    } catch {
      /* 못 읽는 파일은 무시 */
    }
  }
  return added
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN)

    // 시스템 브라우저에서 로그인을 마치고 돌아오는 주소 → 앱 창에 결과를 넘긴다
    if (url.pathname === '/oauth') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><body style="font:16px sans-serif;padding:40px">로그인이 끝났어요. 이 탭은 닫고 Nosidian 앱으로 돌아가세요.</body>')
      if (win) {
        win.loadURL(`${ORIGIN}/?${url.searchParams.toString()}`)
        if (win.isMinimized()) win.restore()
        win.focus()
      }
      return
    }

    // 위젯이 "배경이 비치는 달력"을 그리려고 쓰는 현재 바탕화면 이미지 (이 PC 안에서만, 로컬 서버가 읽어 준다)
    if (url.pathname === '/__wallpaper') {
      const wp = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
      return fs.readFile(wp, (err, data) => {
        if (err) return res.writeHead(404).end()
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }).end(data)
      })
    }

    let rel = decodeURIComponent(url.pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    const file = path.join(ROOT, rel)
    if (!file.startsWith(ROOT)) return res.writeHead(403).end()
    fs.readFile(file, (err, data) => {
      if (err) {
        // SPA: 없는 경로는 index.html
        return fs.readFile(path.join(ROOT, 'index.html'), (e2, d2) => {
          if (e2) return res.writeHead(404).end()
          res.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(d2)
        })
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' }).end(data)
    })
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 480,
    title: 'Nosidian',
    icon: path.join(ROOT, 'logo.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  })
  // 외부 링크·로그인 페이지는 시스템 브라우저로 (Google 은 임베디드 창 로그인을 막는다)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  win.on('closed', () => (win = null))
  void win.loadURL(ORIGIN + '/')
}

function openMain() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } else {
    createWindow()
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  queueFiles(process.argv)
  require('./llm.cjs').registerLlm(ipcMain, { file: path.join(app.getPath('userData'), 'llm-key.bin'), safeStorage })
  require('./mcpHost.cjs').register({ ipcMain, app, getWindow: () => win })
  ipcMain.handle('open-file:take', () => pendingFiles.splice(0))
  // 열어 본 문서를 원본 위치에 저장 (마크다운/텍스트 확장자의 절대 경로만)
  ipcMain.handle('open-file:save', (_e, p, content) => {
    if (typeof p !== 'string' || typeof content !== 'string' || !path.isAbsolute(p) || !NOTE_EXT.test(p)) throw new Error('저장할 수 없는 경로입니다')
    fs.writeFileSync(p, content, 'utf8')
  })
  app.on('second-instance', (_e, argv) => {
    // 이미 켜져 있을 때 다른 .md 를 열면 이 창으로 전달
    if (queueFiles(argv) && win) win.webContents.send('open-file:new')
    // 로그인 자동 시작(--widget-only)으로 또 실행된 경우가 아니면 본 창을 앞으로
    if (!argv.includes('--widget-only')) openMain()
  })
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    const server = createServer()
    server.on('error', (e) => {
      console.error('서버 시작 실패:', e.message)
      app.quit()
    })
    const ko = /^ko/i.test(app.getLocale())
    widget.setup({
      origin: ORIGIN,
      root: ROOT,
      preload: path.join(__dirname, 'preload.cjs'),
      getMain: () => win,
      openMain,
      label: ko ? { open: 'Nosidian 열기', widget: '바탕화면 위젯', quit: '종료' } : { open: 'Open Nosidian', widget: 'Desktop widget', quit: 'Quit' },
    })
    server.listen(PORT, '127.0.0.1', () => {
      // 로그인 때 위젯만 시작(--widget-only)이고 위젯이 켜져 있으면 본 창은 띄우지 않는다
      const widgetOnly = process.argv.includes('--widget-only') && widget.isEnabled()
      if (!widgetOnly) createWindow()
      widget.start()
    })
  })
  // 위젯이 떠 있는 동안은 본 창을 닫아도 앱(위젯)이 계속 실행된다. 종료는 트레이 메뉴에서.
  app.on('window-all-closed', () => app.quit())
}
