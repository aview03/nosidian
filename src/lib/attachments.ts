// 노트도 이미지도 아닌 파일(.py·.docx·.pdf·.zip·.exe …): 목록(이름·크기)만 동기화하고, 눌렀을 때 원격 저장소에서 내려받는다.
// 폰에는 원본을 미리 받아 두지 않는다. 폰에서 고친 내용을 다시 올리는 기능은 아직 없다(읽기·받기 전용).
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { t } from './i18n'
import { isOther } from './sync/types'

/** 이보다 크면 받기 전에 한 번 더 확인한다 */
export const LARGE_BYTES = 10 * 1024 * 1024
/** 한 파일의 올리기 상한(바이트). base64 로 한 번에 올리므로 메모리·API 한도 때문에 제한한다 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
/** 이보다 크면 폰에서는 받지 않는다(메모리 한계: base64 로 한 번에 받는다) */
export const MAX_PHONE_BYTES = 50 * 1024 * 1024

const EXEC = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|apk|jar|dmg|app|sh)$/i
export const isExecutable = (p: string) => EXEC.test(p)

export interface OtherFile {
  path: string
  name: string
  size?: number
}
export interface OtherFolder {
  path: string
  name: string
  count: number
}

/** dir 바로 아래의 다른 파일과, 그 안쪽에 다른 파일이 들어 있는 하위 폴더 */
export function othersIn(assets: Record<string, { size?: number }>, dir: string): { files: OtherFile[]; folders: OtherFolder[] } {
  const prefix = dir ? dir + '/' : ''
  const files: OtherFile[] = []
  const folders = new Map<string, OtherFolder>()
  for (const [p, a] of Object.entries(assets)) {
    if (!p.startsWith(prefix) || !isOther(p)) continue
    const rest = p.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) files.push({ path: p, name: rest, size: a.size })
    else {
      const name = rest.slice(0, slash)
      const fp = prefix + name
      folders.set(fp, { path: fp, name, count: (folders.get(fp)?.count ?? 0) + 1 })
    }
  }
  return {
    files: files.sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }
}

export function formatSize(n: number | undefined): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export type Gate = { ok: true } | { ok: false; reason: 'executable-phone' | 'too-large-phone' } | { ok: 'confirm'; reason: 'large' | 'executable' }

/** 받기 전에 확인이 필요한가. phone: 안드로이드 앱 */
export function gate(path: string, size: number | undefined, phone: boolean): Gate {
  if (phone && isExecutable(path)) return { ok: false, reason: 'executable-phone' }
  if (phone && size != null && size > MAX_PHONE_BYTES) return { ok: false, reason: 'too-large-phone' }
  if (isExecutable(path)) return { ok: 'confirm', reason: 'executable' }
  if (size != null && size > LARGE_BYTES) return { ok: 'confirm', reason: 'large' }
  return { ok: true }
}

export function gateMessage(g: Gate, name: string, size: number | undefined): string {
  if (g.ok === true) return ''
  switch (g.reason) {
    case 'executable-phone': return t('실행 파일({name})은 휴대폰에서 받지 않아요. PC에서 받아 주세요', { name })
    case 'too-large-phone': return t('파일이 너무 커서({size}) 휴대폰에서는 받을 수 없어요. PC에서 받아 주세요', { size: formatSize(size) })
    case 'executable': return t('실행 파일이에요. 출처를 아는 파일만 받아 주세요.')
    case 'large': return t('큰 파일({size})이에요. 받을까요?', { size: formatSize(size) })
  }
}

const mimeOf = (name: string) => {
  const e = name.split('.').pop()!.toLowerCase()
  return ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', json: 'application/json', csv: 'text/csv', zip: 'application/zip', py: 'text/x-python', js: 'text/javascript' } as Record<string, string>)[e] ?? 'application/octet-stream'
}
const baseName = (p: string) => p.split('/').pop()!.replace(/[\\/:*?"<>|]/g, '_')

/**
 * base64 로 받은 파일을 사용자에게 건넨다. 폰: 임시 폴더에 쓰고 공유 시트(다른 앱으로 열기·저장)를, PC·웹: 브라우저 다운로드.
 */
export async function handOver(path: string, b64: string): Promise<void> {
  const name = baseName(path)
  if (Capacitor.isNativePlatform()) {
    const w = await Filesystem.writeFile({ path: `nosidian-files/${Date.now()}-${name}`, data: b64, directory: Directory.Cache, recursive: true })
    await Share.share({ title: name, url: w.uri, dialogTitle: name })
    return
  }
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

/** 올릴 수 없는 파일이면 이유(문장), 올려도 되면 null */
export function uploadProblem(name: string, size: number): string | null {
  if (/\.md$/i.test(name)) return t('노트(.md)는 "가져오기"로 넣어 주세요')
  if (name.startsWith('.')) return t('숨김 파일({name})은 올릴 수 없어요', { name })
  if (size === 0) return t('빈 파일({name})은 올릴 수 없어요', { name })
  if (size > MAX_UPLOAD_BYTES) return t('{name}은(는) 너무 커요(최대 {max})', { name, max: formatSize(MAX_UPLOAD_BYTES) })
  return null
}

/** 올릴 경로: 폴더 + 파일 이름. 같은 이름이 있으면 "이름 (2).확장자" */
export function uploadPath(dir: string, name: string, taken: Set<string>): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'file'
  const dot = clean.lastIndexOf('.')
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const ext = dot > 0 ? clean.slice(dot) : ''
  const prefix = dir ? dir + '/' : ''
  const lower = new Set([...taken].map((p) => p.toLowerCase()))
  let p = prefix + clean
  for (let n = 2; lower.has(p.toLowerCase()); n++) p = `${prefix}${stem} (${n})${ext}`
  return p
}
