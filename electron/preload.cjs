// 렌더러(화면)에 열어야 할 파일 전달만 노출한다. Node 접근은 열지 않는다.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('amsidianDesktop', {
  /** AI 서버(Ollama 등) 요청을 메인 프로세스가 대신 보낸다(CORS 회피, 주소 규칙은 메인에서 다시 검사) */
  llmRequest: (req, id) => ipcRenderer.invoke('llm:request', req, id),
  /** 진행 중인 AI 서버 요청을 id 로 취소 */
  llmCancel: (id) => ipcRenderer.invoke('llm:cancel', id),
  /** AI 서버 API 키 보관(운영체제 보안 저장소). 키는 메인 프로세스에서만 읽힌다 — 렌더러는 저장·삭제·있는지만 안다 */
  llmKey: {
    status: () => ipcRenderer.invoke('llm:key:status'),
    set: (key) => ipcRenderer.invoke('llm:key:set', key),
    clear: () => ipcRenderer.invoke('llm:key:clear'),
  },
  /** 앱 안 AI(PC 의 Claude Code CLI): 찾기·로그인 확인, 한 번 실행(진행·결과는 이벤트), 취소 */
  claude: {
    detect: () => ipcRenderer.invoke('claude:detect'),
    run: (req) => ipcRenderer.invoke('claude:run', req),
    cancel: () => ipcRenderer.invoke('claude:cancel'),
    onEvent: (cb) => {
      const h = (_e, ev) => cb(ev)
      ipcRenderer.on('claude:event', h)
      return () => ipcRenderer.removeListener('claude:event', h)
    },
  },
  /** 외부 AI 연결(MCP): 설정 조회·변경, 도구 호출 수신·응답. 문서 데이터는 렌더러가 처리한다 */
  mcp: {
    get: () => ipcRenderer.invoke('mcp:get'),
    set: (patch) => ipcRenderer.invoke('mcp:set', patch),
    reply: (id, result) => ipcRenderer.invoke('mcp:reply', id, result),
    onCall: (cb) => {
      const h = (_e, call) => cb(call)
      ipcRenderer.on('mcp:call', h)
      return () => ipcRenderer.removeListener('mcp:call', h)
    },
  },
  /** 휴대폰에서 이 PC 의 AI 쓰기(중계): 켜기·연결 코드·기기 목록·PC 에 저장된 AI 연결 알림 */
  relay: {
    get: () => ipcRenderer.invoke('relay:get'),
    set: (patch) => ipcRenderer.invoke('relay:set', patch),
    newCode: () => ipcRenderer.invoke('relay:newCode'),
    revoke: (id) => ipcRenderer.invoke('relay:revoke', id),
    upstream: (cfg) => ipcRenderer.invoke('relay:upstream', cfg),
  },
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
