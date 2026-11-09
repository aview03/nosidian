// Windows 바탕화면 레이어: 위젯 창을 Progman(바탕화면 창)의 자식으로 붙여
// 일반 창 아래, 바탕화면 아이콘 위에 놓는다. (Win+D 로 바탕화면 보기를 해도 남아 있다)
// 아이콘 "뒤"(WorkerW)가 아니라 Progman 자식으로 두는 이유: 그쪽은 마우스 입력을 받지 못한다.
// koffi 를 못 불러오거나 Windows 가 아니면 supported() 가 false → 호출 쪽이 일반 창 모드로 대체한다.
let K = null
let fn = null

function init() {
  if (fn || process.platform !== 'win32') return !!fn
  try {
    K = require('koffi')
    const u = K.load('user32.dll')
    const RECT = K.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    fn = {
      FindWindowW: u.func('intptr_t __stdcall FindWindowW(str16 c, str16 n)'),
      SetParent: u.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
      GetParent: u.func('intptr_t __stdcall GetParent(intptr_t h)'),
      GetWindowRect: u.func('int __stdcall GetWindowRect(intptr_t h, _Out_ RECT *r)'),
      SetWindowPos: u.func('int __stdcall SetWindowPos(intptr_t h, intptr_t after, int x, int y, int cx, int cy, uint32 flags)'),
      GetWindowLongPtrW: u.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t h, int idx)'),
      SetWindowLongPtrW: u.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t h, int idx, intptr_t v)'),
      RECT,
    }
  } catch (e) {
    console.error('desktopLayer: koffi 로드 실패', e && e.message)
    fn = null
  }
  return !!fn
}

const GWL_STYLE = -16
const GWL_EXSTYLE = -20
// 자식 창이 되면서 남는 제목줄/두꺼운 테두리 스타일 (이게 남으면 클라이언트 영역이 창보다 작아져 가장자리에 띠가 생긴다)
const FRAME_BITS = 0xc00000 | 0x40000 | 0x20000 | 0x10000 | 0x800000 // CAPTION | THICKFRAME | MINIMIZEBOX | MAXIMIZEBOX | BORDER
const FRAME_EX_BITS = 0x1 | 0x100 | 0x200 | 0x20000 // DLGMODALFRAME | WINDOWEDGE | CLIENTEDGE | STATICEDGE
const WS_CHILD = 0x40000000
const WS_POPUP = 0x80000000
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40

const hwndOf = (win) => {
  const b = win.getNativeWindowHandle()
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0)
}
const rectOf = (h) => {
  const r = {}
  fn.GetWindowRect(h, r)
  return r
}
const progman = () => Number(fn.FindWindowW('Progman', null))

exports.supported = () => init() && progman() !== 0

/** 창이 지금 바탕화면 레이어에 붙어 있는가 */
exports.isAttached = (win) => {
  if (!init() || win.isDestroyed()) return false
  const p = progman()
  return p !== 0 && Number(fn.GetParent(hwndOf(win))) === p
}

/** 화면 좌표(물리 px)의 rect 위치로 옮긴다. 붙어 있으면 Progman 클라이언트 좌표로 바꿔서 */
exports.place = (win, rect, { top = false } = {}) => {
  if (!init() || win.isDestroyed()) return false
  const h = hwndOf(win)
  const p = progman()
  const pr = rectOf(p)
  const flags = SWP_NOACTIVATE | (top ? 0 : 0)
  return !!fn.SetWindowPos(h, 0, rect.x - pr.left, rect.y - pr.top, rect.width, rect.height, flags)
}

/** 바탕화면에 붙인다. rect: 붙인 뒤 둘 위치·크기 (물리 px, 화면 좌표) */
exports.attach = (win, rect) => {
  if (!init()) return false
  const p = progman()
  if (!p) return false
  const h = hwndOf(win)
  fn.SetParent(h, p)
  const style = Number(fn.GetWindowLongPtrW(h, GWL_STYLE))
  fn.SetWindowLongPtrW(h, GWL_STYLE, ((style & ~WS_POPUP & ~FRAME_BITS) | WS_CHILD) >>> 0)
  fn.SetWindowLongPtrW(h, GWL_EXSTYLE, (Number(fn.GetWindowLongPtrW(h, GWL_EXSTYLE)) & ~FRAME_EX_BITS) >>> 0)
  const pr = rectOf(p)
  // HWND_TOP(0): Progman 의 자식들(아이콘 목록) 위 → 클릭을 받는다. 일반 창보다는 항상 아래.
  fn.SetWindowPos(h, 0, rect.x - pr.left, rect.y - pr.top, rect.width, rect.height, SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)
  return Number(fn.GetParent(h)) === p
}

exports.detach = (win) => {
  if (!init() || win.isDestroyed()) return
  const h = hwndOf(win)
  fn.SetParent(h, 0)
  const style = Number(fn.GetWindowLongPtrW(h, GWL_STYLE))
  fn.SetWindowLongPtrW(h, GWL_STYLE, ((style & ~WS_CHILD) | WS_POPUP) >>> 0)
  fn.SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED)
}

/** 아이콘 목록보다 위로 다시 올린다 (탐색기가 순서를 바꾸는 경우 대비) */
exports.raise = (win) => {
  if (!init() || win.isDestroyed()) return
  fn.SetWindowPos(hwndOf(win), 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
}

/** 마우스 왼쪽 버튼이 눌려 있는가. 알 수 없으면(비 Windows 등) null */
exports.leftDown = () => {
  if (!init()) return null
  try {
    if (!fn.GetAsyncKeyState) fn.GetAsyncKeyState = K.load('user32.dll').func('int16 __stdcall GetAsyncKeyState(int vKey)')
    return (fn.GetAsyncKeyState(0x01) & 0x8000) !== 0
  } catch {
    return null
  }
}
