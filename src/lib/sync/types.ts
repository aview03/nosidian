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
  /** 마지막으로 본 rev(없으면 null = 새 파일). 조건부 쓰기를 하는 저장소(PC 호스트 폴더)만 쓰고, 클라우드는 무시한다 */
  baseRev?: string | null
}

export interface Provider {
  label: string
  test(): Promise<void>
  list(): Promise<{ entries: RemoteEntry[]; truncated?: boolean }>
  readText(e: RemoteEntry): Promise<string>
  readBase64(e: RemoteEntry): Promise<string>
  /** 변경분을 올리고 path → 새 rev 맵을 반환 */
  push(changes: PushChange[], message: string): Promise<Map<string, string>>
  /** 동기화가 끝났을 때(받기·올리기 성공 뒤) 불린다. PC 호스트 폴더가 "이 기기가 여기까지 반영했다"는 확인(ack)을 남기는 데 쓴다 */
  afterSync?(): Promise<void>
  /** 동기화 중 알려야 할 일(예: 삭제를 전파하지 못했다). 없으면 null */
  notice?(): string | null
}

/**
 * 조건부 쓰기(PC 호스트 폴더)의 충돌 정보. 409 + code 'conflict'(내가 본 rev 와 지금 rev 가 다름 / 지워짐) · 'case'(대소문자만 다른 경로가 이미 있음).
 * 바이너리 충돌 선택 화면이 쓴다. 충돌이 아니면 null(GitHub 의 409·422 처럼 code 가 없는 오류는 여기 해당하지 않는다)
 */
export interface WriteConflict {
  code: 'conflict' | 'case'
  /** PC 의 현재 rev(덮어쓰기 때 baseRev 로 쓴다). 지워졌으면 삭제 기록의 rev */
  currentRev: string | null
  deleted: boolean
}
export function conflictOf(e: unknown): WriteConflict | null {
  const x = e as { status?: number; code?: string; currentRev?: string | null; deleted?: boolean } | null
  if (!x || x.status !== 409 || (x.code !== 'conflict' && x.code !== 'case')) return null
  return { code: x.code, currentRev: x.currentRev ?? null, deleted: x.deleted === true }
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
