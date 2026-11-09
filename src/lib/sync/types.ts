export interface RemoteEntry {
  path: string
  /** 내용이 바뀌면 달라지는 값 (GitHub blob sha / Drive md5 / OneDrive cTag) */
  rev: string
  /** 프로바이더 내부 식별자 (Drive·OneDrive 파일 id) */
  id?: string
}

export interface PushChange {
  path: string
  content: string | null // null이면 삭제
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
export const isHidden = (p: string) => p.split('/').some((s) => s.startsWith('.'))
export const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')

export function bytesToB64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
