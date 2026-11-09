// 바탕화면 위젯 창 관리: 생성/삭제, 위치·크기 저장, 바탕화면 레이어 붙이기, 트레이, 본 창과의 연결(IPC)
const { BrowserWindow, ipcMain, screen, Tray, Menu, app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const layer = require('./desktopLayer.cjs')
const wallFit = require('./wallpaperFit.cjs')

const MIN_W = 280
const MIN_H = 300
const DEFAULTS = { enabled: false, mode: 'month', layer: 'desktop', opacity: 0.92, tint: 0.25, autostart: false, bounds: null }

let ctx = null // { origin, root, preload, getMain(), openMain() }
let wwin = null
let tray = null
let keepTimer = null
let state = { ...DEFAULTS }
const pendingNotes = []
let drag = null
let popup = null // 메모창/일정 편집기: 바탕화면 레이어 안에서는 한글 입력기가 동작하지 않아 별도의 일반 창으로 띄운다
let wall = null // 배경화면이 그려진 위치·크기 측정 결과 (없으면 가운데 정렬로 대체)
let wallStamp = 0

function tickDrag() {
  if (!drag || !wwin || wwin.isDestroyed()) return endDrag(false)
  if (layer.leftDown() === false) return endDrag(true) // 렌더러가 버튼 뗌을 못 알려도 여기서 끝낸다
  const c = screen.getCursorScreenPoint()
  const dx = c.x - drag.c.x
  const dy = c.y - drag.c.y
  const b = { ...drag.b }
  if (drag.kind === 'move') {
    b.x += dx
    b.y += dy
  } else {
    const e = drag.edge
    if (e.includes('e')) b.width = Math.max(MIN_W, drag.b.width + dx)
    if (e.includes('s')) b.height = Math.max(MIN_H, drag.b.height + dy)
    if (e.includes('w')) {
      b.width = Math.max(MIN_W, drag.b.width - dx)
      b.x = drag.b.x + (drag.b.width - b.width) // 왼쪽 변을 끌면 오른쪽 변은 그대로
    }
    if (e.includes('n')) {
      b.height = Math.max(MIN_H, drag.b.height - dy)
      b.y = drag.b.y + (drag.b.height - b.height)
    }
  }
  if (b.x === state.bounds.x && b.y === state.bounds.y && b.width === state.bounds.width && b.height === state.bounds.height) return
  state.bounds = b
  apply()
  if (drag.kind === 'resize') wwin.webContents.send('widget:drag-size', b.width, b.height)
}

function endDrag(commit) {
  if (!drag) return
  clearInterval(drag.timer)
  drag = null
  if (commit && wwin && !wwin.isDestroyed()) {
    save()
    broadcast() // 다른 모니터로 옮겼을 수 있으니 배경화면 기준을 다시 알린다
    wwin.webContents.send('widget:drag-end')
  }
}

const file = () => path.join(app.getPath('userData'), 'widget.json')
function load() {
  try {
    state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }
  } catch {
    state = { ...DEFAULTS }
  }
}
function save() {
  try {
    fs.writeFileSync(file(), JSON.stringify(state))
  } catch {
    /* 저장 실패는 다음 변경 때 다시 시도 */
  }
}

const desktopOk = () => layer.supported()
const useDesktop = () => state.layer === 'desktop' && desktopOk()

/** 화면에 크게: 바탕화면 아이콘 줄(왼쪽)을 남기고 나머지를 채운다 */
function bigBounds(display) {
  const wa = (display ?? screen.getPrimaryDisplay()).workArea
  const left = Math.min(130, Math.round(wa.width * 0.1))
  return { x: wa.x + left, y: wa.y + 6, width: wa.width - left - 8, height: wa.height - 12 }
}
const defaultBounds = () => bigBounds()
/** 저장된 위치가 지금 연결된 모니터 안에 있는가 (모니터를 뺀 경우 기본 위치로) */
function validBounds(b) {
  if (!b) return defaultBounds()
  const ok = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y < a.y + a.height - 40 && b.y + b.height > a.y + 40
  })
  return ok ? b : defaultBounds()
}

function publicState() {
  const bounds = state.bounds ?? defaultBounds()
  return { ...state, bounds, display: screen.getDisplayMatching(bounds).bounds, desktopSupported: desktopOk(), wall }
}
function broadcast() {
  const s = publicState()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('widget:state', s)
}

/** 현재 state.bounds(DIP, 화면 좌표)를 창에 반영 */
function apply() {
  if (!wwin || wwin.isDestroyed()) return
  const b = state.bounds
  if (useDesktop() && layer.isAttached(wwin)) layer.place(wwin, screen.dipToScreenRect(wwin, b))
  else wwin.setBounds(b)
}

function attachOrFallback() {
  if (!wwin || wwin.isDestroyed()) return
  if (useDesktop()) {
    const ok = layer.attach(wwin, screen.dipToScreenRect(wwin, state.bounds))
    if (!ok) wwin.setAlwaysOnTop(false)
  } else {
    wwin.setAlwaysOnTop(state.layer === 'top', 'floating')
    wwin.setOpacity(state.layer === 'top' ? state.opacity : 1)
  }
}

/** 배경화면의 실제 배치를 측정 (캡처하는 동안만 위젯을 숨긴다) */
let measuring = false
async function calibrate() {
  if (measuring || !wwin || wwin.isDestroyed() || !useDesktop() || state.mode !== 'month') return
  measuring = true
  try {
    const d = screen.getDisplayMatching(state.bounds)
    const m = await wallFit.measure(
      d,
      async () => wwin && !wwin.isDestroyed() && wwin.hide(),
      async () => {
        if (!wwin || wwin.isDestroyed()) return
        wwin.showInactive()
        if (useDesktop() && !layer.isAttached(wwin)) attachOrFallback()
      },
    )
    wall = m
    wallStamp = wallFit.wallpaperMtime()
    broadcast()
  } catch (e) {
    console.error('wallpaper measure failed', e && e.message)
  } finally {
    measuring = false
  }
}

function createWidget() {
  if (wwin && !wwin.isDestroyed()) return
  state.bounds = validBounds(state.bounds)
  const b = state.bounds
  wwin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    minWidth: MIN_W, minHeight: MIN_H,
    frame: false, thickFrame: false, resizable: false, skipTaskbar: true, show: false, hasShadow: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    title: 'Nosidian Widget',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: ctx.preload },
  })
  wwin.setMenuBarVisibility(false)
  wwin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  wwin.once('ready-to-show', () => {
    wwin.showInactive()
    attachOrFallback()
    setTimeout(() => void calibrate(), 2500) // 화면이 자리 잡은 뒤 측정
  })
  wwin.on('closed', () => {
    wwin = null
    clearInterval(keepTimer)
  })
  void wwin.loadURL(`${ctx.origin}/?widget=1`)
  // 탐색기가 다시 시작되거나 아이콘 목록이 위로 올라오면 다시 붙이고/올린다
  clearInterval(keepTimer)
  let tick = 0
  keepTimer = setInterval(() => {
    if (!wwin || wwin.isDestroyed() || !useDesktop()) return
    if (!layer.isAttached(wwin)) attachOrFallback()
    else layer.raise(wwin)
    if (++tick % 6 === 0 && wallFit.wallpaperMtime() !== wallStamp && !drag) void calibrate() // 30초마다 배경화면 변경 확인
  }, 5000)
}

function destroyWidget() {
  clearInterval(keepTimer)
  if (popup && !popup.isDestroyed()) popup.destroy()
  if (wwin && !wwin.isDestroyed()) {
    if (layer.isAttached(wwin)) layer.detach(wwin) // 부모(Progman)와 함께 파괴되지 않게 먼저 분리
    wwin.destroy()
  }
  wwin = null
}

function ensureTray() {
  if (!state.enabled) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return
  let icon = nativeImage.createFromPath(path.join(ctx.root, 'logo.png'))
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Nosidian')
  tray.on('click', () => ctx.openMain())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: ctx.label.open, click: () => ctx.openMain() },
      { label: ctx.label.widget, type: 'checkbox', checked: true, click: () => patch({ enabled: false }) },
      { type: 'separator' },
      { label: ctx.label.quit, click: () => app.quit() },
    ]),
  )
}

function patch(p) {
  const prev = { ...state }
  for (const k of ['enabled', 'mode', 'layer', 'opacity', 'tint', 'autostart']) if (k in p) state[k] = p[k]
  state.opacity = Math.min(1, Math.max(0.3, Number(state.opacity) || DEFAULTS.opacity))
  state.tint = Math.min(0.9, Math.max(0, Number.isFinite(Number(state.tint)) ? Number(state.tint) : DEFAULTS.tint))
  if (state.enabled !== prev.enabled) state.enabled ? createWidget() : destroyWidget()
  else if (state.layer !== prev.layer && wwin) {
    destroyWidget() // 레이어를 바꿀 때는 새 창으로 (부모 관계·스타일을 깔끔하게)
    createWidget()
  } else if (state.opacity !== prev.opacity && wwin && state.layer === 'top') wwin.setOpacity(state.opacity)
  if (state.autostart !== prev.autostart || state.enabled !== prev.enabled) {
    app.setLoginItemSettings({ openAtLogin: state.enabled && state.autostart, args: ['--widget-only'] })
  }
  ensureTray()
  save()
  broadcast()
  return publicState()
}

function setup(c) {
  ctx = c
  load()
  ipcMain.handle('widget:get', () => publicState())
  ipcMain.handle('widget:set', (_e, p) => patch(p && typeof p === 'object' ? p : {}))
  // 끌기: 렌더러의 마우스 좌표(창이 움직이면 흔들림)를 쓰지 않고 메인이 실제 커서 위치를 직접 읽는다.
  // 시작 시점의 커서·창 위치를 기준으로 하므로 오차가 쌓이지 않고, 이벤트도 한 틱(16ms)에 한 번뿐이다.
  ipcMain.on('widget:drag-start', (_e, kind, edge) => {
    if (!wwin || (kind !== 'move' && kind !== 'resize')) return
    endDrag(false)
    if (kind === 'resize' && !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return
    drag = { kind, edge, c: screen.getCursorScreenPoint(), b: { ...state.bounds }, timer: setInterval(tickDrag, 16) }
  })
  ipcMain.on('widget:drag-end', () => endDrag(true))
  // 입력용 작은 창 열기. kind: 'note'(날짜 메모창) | 'editor'(일정 편집기). anchor: 위젯 안의 칸 위치(DIP) 또는 null
  ipcMain.on('widget:popup', (_e, kind, args, anchor) => {
    if (!wwin || (kind !== 'note' && kind !== 'editor')) return
    if (popup && !popup.isDestroyed()) popup.destroy()
    const b = state.bounds
    const wa = screen.getDisplayMatching(b).workArea
    const size = kind === 'note' ? { w: 300, h: 380 } : { w: 460, h: 720 }
    let x = Math.round(b.x + (b.width - size.w) / 2)
    let y = Math.round(b.y + (b.height - size.h) / 3)
    if (kind === 'note' && anchor && Number.isFinite(anchor.left) && Number.isFinite(anchor.top)) {
      x = Math.round(b.x + anchor.left + anchor.width + 6) // 칸 오른쪽, 모자라면 왼쪽
      if (x + size.w > wa.x + wa.width - 8) x = Math.round(b.x + anchor.left - size.w - 6)
      y = Math.round(b.y + anchor.top)
    }
    size.h = Math.min(size.h, wa.height - 16)
    x = Math.min(Math.max(wa.x + 8, x), wa.x + wa.width - size.w - 8)
    y = Math.min(Math.max(wa.y + 8, y), wa.y + wa.height - size.h - 8)
    const q = new URLSearchParams({ widget: '1', popup: kind })
    for (const [k, v] of Object.entries(args && typeof args === 'object' ? args : {})) if (typeof v === 'string') q.set(k, v)
    popup = new BrowserWindow({
      x, y, width: size.w, height: size.h,
      frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
      minimizable: false, maximizable: false, fullscreenable: false, hasShadow: true,
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: ctx.preload },
    })
    popup.setMenuBarVisibility(false)
    popup.setAlwaysOnTop(true, 'floating')
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    popup.once('ready-to-show', () => {
      popup.show()
      popup.focus()
    })
    popup.on('closed', () => (popup = null))
    void popup.loadURL(`${ctx.origin}/?${q.toString()}`)
  })
  ipcMain.on('widget:fit', () => {
    if (!wwin) return
    state.bounds = bigBounds(screen.getDisplayMatching(state.bounds))
    apply()
    save()
    broadcast()
  })
  // 위젯에서 일정을 눌러 본 창에서 노트 열기 (본 창이 없으면 새로 띄운다)
  ipcMain.on('widget:open-note', (_e, p) => {
    if (typeof p === 'string' && p) pendingNotes.push(p)
    ctx.openMain()
    const m = ctx.getMain()
    if (m && !m.isDestroyed() && !m.webContents.isLoading()) m.webContents.send('open-note:new')
  })
  ipcMain.on('widget:open-app', () => ctx.openMain())
  ipcMain.handle('open-note:take', () => pendingNotes.splice(0))
  screen.on('display-metrics-changed', () => {
    if (wwin) {
      state.bounds = validBounds(state.bounds)
      apply()
      setTimeout(() => void calibrate(), 1500)
    }
  })
  app.on('before-quit', () => destroyWidget())
}

/** 앱이 준비되면 저장된 설정대로 위젯을 띄운다 */
function start() {
  if (state.enabled) {
    createWidget()
    ensureTray()
  }
}

module.exports = { setup, start, isEnabled: () => state.enabled }
