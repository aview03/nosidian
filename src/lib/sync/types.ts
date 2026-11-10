export interface RemoteEntry {
  path: string
  /** 내용이 바뀌면 달라지는 값 (GitHub blob sha / Drive md5 / OneDrive cTag) */
  rev: string
  /** 프로바이더 내부 식별자 (Drive·OneDrive 파일 id) */
  id?: string
  /** 바이트 크기(알 수 있을 때). 노트가 아닌 파일의 목록·다운로드 확인에 쓴다 */
  size?: number
}

export interface PushChange {
  path: string
  content: string | null // null이면 삭제
  /** 바이너리 파일(.docx·.zip …)이면 base64 내용. 이때 content 는 쓰지 않는다 */
  b64?: string
}

export interface Provider {
  label: string
  test(): Promise<void>
  list(): Promise<{ entries: RemoteEntry[]; truncated?: boolean }>
  readText(e: RemoteEntry): Promise<string>
  readBase64(e: RemoteEntry): Promise<string>
  /** 변경분을 올리고 path → 새 rev 맵을 반환 */
  push(changes: PushChange[], message: string): Promise<Map<string, string>>
}

export class SyncError extends Error {
  status: number
  constructor(msg: string, status = 0) {
    super(msg)
    this.status = status
  }
}

export const isNote = (p: string) => /\.md$/i.test(p)
export const isImage = (p: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p)
/** 노트도 이미지도 아닌 파일(.py·.docx·.pdf·.zip·.exe …): 목록만 동기화하고 눌렀을 때 내려받는다 */
export const isOther = (p: string) => !isNote(p) && !isImage(p)
/** 목록에 올릴 다른 파일의 최대 개수(코드 저장소를 vault 로 쓸 때 목록이 폭발하지 않게) */
export const MAX_OTHERS = 3000
export const isHidden = (p: string) => p.split('/').some((s) => s.startsWith('.'))
export const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

export function bytesToB64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
