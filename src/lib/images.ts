// 이미지 넣기(붙여넣기·끌어놓기·이미지 버튼)의 순수 부분. 설계: docs/IMAGES.md
//  - 어떤 파일을 받을지(형식·크기), 어떤 이름·경로로 둘지, 본문에 어떤 마크다운을 넣을지, 줄일지.
//  - 저장·동기화는 app.ts(attachImages), 편집기 연결은 Editor.tsx.
import { t } from './i18n'
import { dirName } from './links'

/** 넣을 수 있는 이미지 형식(svg 는 스크립트를 담을 수 있어 뺀다) */
export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
}
const EXT_OF_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif' }

/** 원본 크기 상한(기존 "파일 올리기"와 같다) */
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024
/** 이보다 크거나(바이트) 긴 변이 이보다 길면 줄여서 저장한다 */
export const SHRINK_BYTES = 3 * 1024 * 1024
export const SHRINK_EDGE = 2048
/** 노트 옆 이미지 폴더 이름 */
export const ASSETS_DIR = '_assets'

/** 파일 이름·형식에서 확장자(소문자). 이미지로 받을 수 없으면 null */
export function imageExt(name: string, mime = ''): string | null {
  const dot = name.lastIndexOf('.')
  const fromName = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (fromName in IMAGE_MIME) return fromName === 'jpeg' ? 'jpg' : fromName
  if (fromName === '') return EXT_OF_MIME[mime.toLowerCase()] ?? null // 이름에 확장자가 없으면(클립보드) 형식으로
  return null // 다른 확장자(pdf·svg·heic 등)는 이미지로 받지 않는다
}

/** 이미지로 받을 수 있는 파일인가(형식만 본다) */
export const isImageFile = (f: { name: string; type?: string }) => imageExt(f.name, f.type ?? '') !== null

/** 넣을 수 없으면 이유(문장), 넣어도 되면 null */
export function imageProblem(name: string, size: number, mime = ''): string | null {
  if (imageExt(name, mime) === null) return t('{name}은(는) 넣을 수 없는 형식이에요(png·jpg·gif·webp·bmp·avif만)', { name })
  if (size === 0) return t('빈 파일({name})은 넣을 수 없어요', { name })
  if (size > IMAGE_MAX_BYTES) return t('{name}은(는) 너무 커요(최대 25MB)', { name })
  return null
}

const p2 = (n: number) => String(n).padStart(2, '0')
/** 붙여넣은(이름이 없는) 이미지의 파일 이름: 이미지-20261111-101500.png */
export const pastedName = (now: Date, ext: string) => `${t('이미지')}-${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}.${ext}`

/** 클립보드·카메라가 붙이는 흔한 이름(`image.png`, `Screenshot…`가 아닌 단순 이름)이면 날짜 이름으로 바꾼다 */
export const isGenericName = (name: string) => name === '' || /^(image|img|photo|blob|pasted[ _-]?image|clipboard)$/i.test(name.replace(/\.[^.]+$/, ''))

/**
 * 파일 이름을 링크에 그대로 쓸 수 있게 다듬는다: 공백은 `-`, 마크다운 링크를 깨는 문자(`()[]<>#?%`)와 금지 문자는 `_`. 확장자는 ext 로.
 * 이름이 비면 `이미지`.
 */
export function imageFileName(name: string, ext: string): string {
  const dot = name.lastIndexOf('.')
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|()[\]#%]/g, '_')
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
  return `${stem || t('이미지')}.${ext}`
}

/** 이 노트의 이미지를 둘 폴더: 노트와 같은 폴더의 `_assets` */
export const assetsDirOf = (notePath: string) => {
  const d = dirName(notePath)
  return d ? `${d}/${ASSETS_DIR}` : ASSETS_DIR
}

/** 노트 기준 상대 경로(같은 폴더 아래면 앞 폴더를 뗀다) */
export function relativeTo(assetPath: string, notePath: string): string {
  const d = dirName(notePath)
  return d && assetPath.startsWith(d + '/') ? assetPath.slice(d.length + 1) : assetPath
}

/** 본문에 넣을 마크다운 한 줄: ![이름](_assets/파일.png) */
export function imageMarkdown(assetPath: string, notePath: string): string {
  const file = assetPath.slice(assetPath.lastIndexOf('/') + 1)
  const alt = file.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '')
  return `![${alt}](${relativeTo(assetPath, notePath)})`
}

/** 줄여서 저장할 것인가: gif 는 그대로(움직임이 사라진다), 그 밖에는 크기·긴 변이 기준을 넘을 때 */
export function shouldShrink(ext: string, size: number, w: number, h: number): boolean {
  if (ext === 'gif') return false
  return size > SHRINK_BYTES || Math.max(w, h) > SHRINK_EDGE
}

/** 긴 변이 edge 이하가 되도록 비율을 지켜 줄인 크기(이미 작으면 그대로) */
export function fitSize(w: number, h: number, edge = SHRINK_EDGE): { w: number; h: number } {
  const m = Math.max(w, h)
  if (m <= edge) return { w, h }
  const k = edge / m
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** 줄인 결과의 형식: png·webp 는 그대로(투명 유지), 그 밖(jpg·bmp·avif)은 jpg */
export const shrunkExt = (ext: string) => (ext === 'png' || ext === 'webp' ? ext : 'jpg')

export interface PreparedImage {
  bytes: ArrayBuffer
  ext: string
  shrunk: boolean
}

/**
 * 파일을 저장할 모양으로 준비한다. 크거나 긴 변이 길면 캔버스로 줄이고, 줄일 수 없는 환경(캔버스 없음)이나 실패하면 원본 그대로.
 * 줄인 결과가 원본보다 크면 원본을 쓴다.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const ext = imageExt(file.name, file.type) ?? 'png'
  const original = async (): Promise<PreparedImage> => ({ bytes: await file.arrayBuffer(), ext, shrunk: false })
  try {
    if (ext === 'gif' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return await original()
    const bmp = await createImageBitmap(file)
    if (!shouldShrink(ext, file.size, bmp.width, bmp.height)) {
      bmp.close?.()
      return await original()
    }
    const { w, h } = fitSize(bmp.width, bmp.height)
    const out = shrunkExt(ext)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return await original()
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, IMAGE_MIME[out === 'jpg' ? 'jpg' : out], 0.85))
    if (!blob || blob.size >= file.size) return await original()
    return { bytes: await blob.arrayBuffer(), ext: out, shrunk: true }
  } catch {
    return await original()
  }
}
