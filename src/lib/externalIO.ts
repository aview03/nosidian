import { t } from './i18n'
import { registerPlugin } from '@capacitor/core'

/** vault 밖에서 연 문서의 원본 위치 (저장할 때 여기에 다시 쓴다) */
export type ExternalSource = { kind: 'desktop'; path: string } | { kind: 'android'; uri: string }

export interface Pending {
  name?: string
  content?: string
  uri?: string
}

export const OpenFile = registerPlugin<{
  getPending(): Promise<Pending>
  save(o: { uri: string; content: string }): Promise<void>
  addListener(ev: 'fileOpened', cb: () => void): Promise<{ remove(): void }>
}>('OpenFile')

export interface WidgetState {
  enabled: boolean
  mode: 'month' | 'agenda' | 'today'
  layer: 'desktop' | 'top'
  opacity: number // 'top' 일 때만 적용
  tint: number // 'desktop' 일 때 배경화면 위에 얹는 어두운 정도 (0~0.9)
  display: { x: number; y: number; width: number; height: number } // 위젯이 놓인 모니터(DIP)
  wall: { x: number; y: number; w: number; h: number } | null // 측정한 배경화면의 그려진 위치·크기(DIP, 모니터 기준). 없으면 가운데 정렬
  autostart: boolean
  desktopSupported: boolean
  bounds: { x: number; y: number; width: number; height: number }
}
export interface WidgetApi {
  get(): Promise<WidgetState>
  set(patch: Partial<Pick<WidgetState, 'enabled' | 'mode' | 'layer' | 'opacity' | 'tint' | 'autostart'>>): Promise<WidgetState>
  onState(cb: (s: WidgetState) => void): () => void
  // 위젯 창 안에서만
  dragStart(kind: 'move' | 'resize', edge?: string): void
  dragEnd(): void
  onDragEnd(cb: () => void): () => void
  onDragSize(cb: (w: number, h: number) => void): () => void
  fit(): void
  popup(kind: 'note' | 'editor', args: Record<string, string>, anchor: { left: number; top: number; width: number; height: number } | null): void
  openNote(path: string): void
  openApp(): void
}
export interface McpStatus {
  enabled: boolean
  running: boolean
  port: number
  token: string
  error: string | null
  stdioPath: string
}
export interface McpApi {
  get(): Promise<McpStatus>
  set(patch: { enabled?: boolean; regenerate?: boolean }): Promise<McpStatus>
  reply(id: string, result: { ok: unknown } | { error: string }): Promise<void>
  onCall(cb: (call: { id: string; tool: string; args: unknown; client: string; internal?: boolean; readOnly?: boolean; forceApproval?: boolean }) => void): () => void
}
export interface ClaudeStatus {
  found: boolean
  /** npm 설치(claude.cmd)만 있어 지원하지 않는 경우 */
  onlyCmd?: boolean
  path?: string
  version?: string | null
  loggedIn?: boolean
  authMethod?: string | null
}
export type ClaudeEvent =
  | { type: 'tool'; name: string; input: string }
  | { type: 'text'; text: string }
  | { type: 'result'; ok: boolean; text: string; turns: number; costUsd: number }
  | { type: 'error'; code: string; message: string }
export interface ClaudeApi {
  detect(): Promise<ClaudeStatus>
  /** mode: ask = 읽기 전용(변경 제안 도구 없음), edit = 변경 제안 허용 */
  run(req: { prompt: string; model?: string; mode?: 'ask' | 'edit'; forceApproval?: boolean }): Promise<{ ok: boolean }>
  cancel(): Promise<boolean>
  onEvent(cb: (e: ClaudeEvent) => void): () => void
}
export interface DesktopApi {
  claude?: ClaudeApi
  mcp?: McpApi
  widget?: WidgetApi
  takeOpenNotes?(): Promise<string[]>
  onOpenNote?(cb: () => void): () => void
  takeFiles(): Promise<{ name: string; content: string; path?: string }[]>
  onFiles(cb: () => void): () => void
  saveFile(path: string, content: string): Promise<void>
  pathForFile(f: File): string
}
export const desktop = () => (window as unknown as { amsidianDesktop?: DesktopApi }).amsidianDesktop

/** 원본 파일에 덮어쓴다. 쓰기 권한이 없으면 예외 */
export async function writeSource(src: ExternalSource, content: string) {
  if (src.kind === 'desktop') {
    const api = desktop()
    if (!api) throw new Error(t('데스크톱 앱이 아닙니다'))
    await api.saveFile(src.path, content)
  } else {
    await OpenFile.save({ uri: src.uri, content })
  }
}

/** 원본 위치를 모르는 문서(공유받은 텍스트 등)는 파일로 내려받는다 */
export function downloadText(name: string, content: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
