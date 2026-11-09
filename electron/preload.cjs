// 렌더러(화면)에 열어야 할 파일 전달만 노출한다. Node 접근은 열지 않는다.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('amsidianDesktop', {
  /** 탐색기에서 "연결 프로그램"으로 열었거나 실행 인자로 받은 파일들 (읽은 뒤 비워진다) */
  takeFiles: () => ipcRenderer.invoke('open-file:take'),
  /** 열어 본 문서를 원본 파일에 저장 */
  saveFile: (p, content) => ipcRenderer.invoke('open-file:save', p, content),
  /** 끌어다 놓은 파일의 실제 경로 */
  pathForFile: (f) => webUtils.getPathForFile(f),
  /** 위젯에서 눌러 본 창에서 열어야 할 노트들 (읽은 뒤 비워진다) */
  takeOpenNotes: () => ipcRenderer.invoke('open-note:take'),
  onOpenNote: (cb) => {
    const h = () => cb()
    ipcRenderer.on('open-note:new', h)
    return () => ipcRenderer.removeListener('open-note:new', h)
  },
  widget: {
    get: () => ipcRenderer.invoke('widget:get'),
    set: (patch) => ipcRenderer.invoke('widget:set', patch),
    onState: (cb) => {
      const h = (_e, s) => cb(s)
      ipcRenderer.on('widget:state', h)
      return () => ipcRenderer.removeListener('widget:state', h)
    },
    dragStart: (kind, edge) => ipcRenderer.send('widget:drag-start', kind, edge),
    dragEnd: () => ipcRenderer.send('widget:drag-end'),
    onDragEnd: (cb) => {
      const h = () => cb()
      ipcRenderer.on('widget:drag-end', h)
      return () => ipcRenderer.removeListener('widget:drag-end', h)
    },
    onDragSize: (cb) => {
      const h = (_e, w, hh) => cb(w, hh)
      ipcRenderer.on('widget:drag-size', h)
      return () => ipcRenderer.removeListener('widget:drag-size', h)
    },
    fit: () => ipcRenderer.send('widget:fit'),
    popup: (kind, args, anchor) => ipcRenderer.send('widget:popup', kind, args, anchor),
    openNote: (p) => ipcRenderer.send('widget:open-note', p),
    openApp: () => ipcRenderer.send('widget:open-app'),
  },
  /** 앱이 이미 켜져 있을 때 새 파일이 들어오면 알려 준다 */
  onFiles: (cb) => {
    const h = () => cb()
    ipcRenderer.on('open-file:new', h)
    return () => ipcRenderer.removeListener('open-file:new', h)
  },
})
