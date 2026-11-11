// 휴대폰 → 이 PC 의 공유 폴더(읽기 전용) 클라이언트. PC 앱의 "내 휴대폰에서 이 PC의 폴더 보기"(electron/fileShare.cjs)와 짝을 맺고 목록·내려받기를 한다.
//  - 모든 통신은 HTTPS + 인증서 지문 고정(PinnedHttp 네이티브 플러그인). 지문은 QR/연결 문자열(nsf1:…)로만 받는다 — 지문 없이 연결하는 방법이 없다.
//  - 내려받은 파일은 PC 가 보낸 SHA-256·크기와 맞는지 확인한 뒤에만 사용자에게 건넨다(attachments.handOver).
//  - 읽기 전용: 이 파일에는 PC 에 쓰는 요청이 없다.
import { create } from 'zustand'
import { pinnedRequest } from './pinnedHttp'
import { clearSecretRecord, onSecretsReady, readSecretRecord, registerSecret, writeSecretRecord, type SecretSpec } from './secureStore'
import { t } from './i18n'
import { clientId } from './deviceId'

const KEY = 'nosidian.pcshare'
/** 파일 공유 토큰은 안드로이드 보안 저장소(Keystore)에 둔다 */
const SECRET: SecretSpec = { storageKey: KEY, field: 'token', secretName: 'pcshare.token', required: true }
registerSecret(SECRET)
export const DEFAULT_SHARE_PORT = 47411
/** 받을 수 있는 파일 한 개의 최대 크기(PC 와 같다) */
export const MAX_SHARE_FILE = 25 * 1024 * 1024

export interface PcShare {
  host: string
  port: number
  token: string
  /** 고정한 PC 인증서 지문(SHA-256 소문자 16진 64자) */
  fp: string
  name: string
  dirName: string | null
}

export function loadPcShare(): PcShare | null {
  try {
    const v = readSecretRecord<Partial<PcShare>>(SECRET)
    if (!v || typeof v.host !== 'string' || typeof v.token !== 'string' || typeof v.fp !== 'string' || !/^[0-9a-f]{64}$/.test(v.fp) || !Number.isInteger(v.port)) return null
    return { host: v.host, port: v.port as number, token: v.token, fp: v.fp, name: String(v.name ?? 'PC'), dirName: typeof v.dirName === 'string' ? v.dirName : null }
  } catch {
    return null
  }
}
export function savePcShare(s: PcShare | null) {
  if (s) writeSecretRecord(SECRET, { ...s })
  else clearSecretRecord(SECRET)
  usePcFilesUi.setState({ link: s })
}

/** 화면 상태: 연결 정보와 "내 PC의 파일" 시트가 열려 있는지 */
export const usePcFilesUi = create<{ link: PcShare | null; open: boolean }>(() => ({ link: loadPcShare(), open: false }))
// 앱 시작 때 보안 저장소 복호화가 끝나면 연결 정보를 다시 읽는다(모듈이 로드될 때는 아직 토큰을 읽을 수 없다)
onSecretsReady(() => usePcFilesUi.setState({ link: loadPcShare() }))

export interface SharePairing {
  host: string
  hosts: string[]
  port: number
  code: string
  fp: string
}

/** 연결 문자열 해석: "nsf1:ip,ip:포트:코드:지문(64자)" — QR 과 복사한 문자열이 같다 */
export function parseSharePairing(raw: string): SharePairing | null {
  const m = /^nsf1:([\d.,]+):(\d{2,5}):(\d{6}):([0-9a-fA-F]{64})$/.exec(raw.trim())
  if (!m) return null
  const hosts = m[1].split(',')
  const okIp = (h: string) => {
    const ip = h.split('.')
    return ip.length === 4 && ip.every((x) => x !== '' && Number(x) <= 255)
  }
  const port = Number(m[2])
  if (hosts.length > 6 || !hosts.every(okIp) || port < 1024 || port > 65535) return null
  return { host: hosts[0], hosts, port, code: m[3], fp: m[4].toLowerCase() }
}

export class ShareError extends Error {
  status: number
  constructor(msg: string, status = 0) {
    super(msg)
    this.status = status
  }
}

export function shareErrorText(e: unknown): string {
  const status = (e as { status?: number }).status ?? 0
  const msg = e instanceof Error ? e.message : String(e)
  if (/pin mismatch/i.test(msg)) return t('이 PC의 인증서가 연결할 때와 달라요. 다른 기기가 끼어들었거나 PC에서 새로 설정했을 수 있어요. 연결을 해제하고 QR로 다시 연결해 주세요')
  if (status === 403) return t('연결 코드가 맞지 않거나 만료됐어요. PC에서 새 코드를 만들어 주세요')
  if (status === 429) return t('시도가 너무 많아 잠시 막혔어요. 1분 뒤에 다시 해 주세요')
  if (status === 409) return /too many devices/.test(msg) ? t('이 PC에 연결할 수 있는 기기 수(5대)를 넘었어요. PC에서 안 쓰는 기기를 해제해 주세요') : t('PC에서 공유할 폴더를 아직 고르지 않았어요')
  if (status === 401) return t('이 PC에서 연결이 해제됐어요. 새 코드로 다시 연결해 주세요')
  if (status === 413) return t('파일이 너무 커서 받을 수 없어요(최대 25MB)')
  if (status === 404) return t('PC에서 그 파일을 찾을 수 없어요')
  if (/integrity/i.test(msg)) return t('받은 파일이 PC의 파일과 달라서 버렸어요. 다시 시도해 주세요')
  return t('PC에 연결하지 못했어요. PC 앱이 켜져 있고 같은 와이파이인지 확인해 주세요')
}

async function call(l: { host: string; port: number; fp: string; token?: string }, path: string, body: unknown, timeoutMs = 30000): Promise<Record<string, unknown>> {
  const r = await pinnedRequest({ url: `https://${l.host}:${l.port}${path}`, method: 'POST', headers: { 'Content-Type': 'application/json', ...(l.token ? { Authorization: `Bearer ${l.token}` } : {}) }, body: JSON.stringify(body ?? {}), pin: l.fp, timeoutMs })
  let j: Record<string, unknown> = {}
  try {
    j = JSON.parse(r.text) as Record<string, unknown>
  } catch {
    /* JSON 이 아니면 상태로 판단 */
  }
  if (r.status < 200 || r.status >= 300) throw new ShareError(typeof j.error === 'string' ? j.error : `HTTP ${r.status}`, r.status)
  return j
}

/** QR/연결 문자열로 짝을 맺는다. 주소 후보를 차례로 시도하고(4초씩), 성공하면 저장한다 */
export async function pairShare(p: SharePairing, deviceName: string): Promise<PcShare> {
  let last: unknown = new Error('no host')
  for (const host of p.hosts) {
    try {
      const j = (await Promise.race([call({ host, port: p.port, fp: p.fp }, '/pair', { code: p.code, name: deviceName, clientId: clientId() }, 6000), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4500))])) as { token: string; name: string; dirName: string | null }
      const link: PcShare = { host, port: p.port, token: j.token, fp: p.fp, name: j.name || 'PC', dirName: j.dirName ?? null }
      savePcShare(link)
      return link
    } catch (e) {
      last = e
      if ((e as { status?: number }).status || /pin mismatch/i.test(String((e as Error).message))) break // 서버가 답했거나 지문이 다르면 다른 주소를 더 시도하지 않는다
    }
  }
  throw new ShareError(shareErrorText(last), (last as { status?: number }).status ?? 0)
}

export interface ShareEntry {
  path: string
  size: number
  mtime: number
}

export async function listShare(l: PcShare): Promise<{ name: string; entries: ShareEntry[]; truncated: boolean }> {
  try {
    const j = await call(l, '/list', {})
    const entries = Array.isArray(j.entries) ? (j.entries as ShareEntry[]).filter((e) => e && typeof e.path === 'string' && Number.isFinite(e.size)) : []
    return { name: String(j.name ?? l.dirName ?? ''), entries, truncated: j.truncated === true }
  } catch (e) {
    throw new ShareError(shareErrorText(e), (e as { status?: number }).status ?? 0)
  }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')
export const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

/** 파일을 받고 PC 가 보낸 크기·SHA-256 과 맞는지 확인한다. 맞지 않으면 버린다. 반환: base64 */
export async function getShareFile(l: PcShare, path: string): Promise<string> {
  let j: Record<string, unknown>
  try {
    j = await call(l, '/get', { path }, 120000)
  } catch (e) {
    throw new ShareError(shareErrorText(e), (e as { status?: number }).status ?? 0)
  }
  const b64 = typeof j.b64 === 'string' ? j.b64 : ''
  const bytes = b64ToBytes(b64)
  if (bytes.length !== j.size || (await sha256Hex(bytes)) !== j.sha256) throw new ShareError(shareErrorText(new Error('integrity')), 0)
  return b64
}

export function forgetPcShare() {
  savePcShare(null)
}

export interface ShareDirView {
  folders: { name: string; path: string; count: number }[]
  files: { name: string; path: string; size: number; mtime: number }[]
}
/** 전체 목록에서 dir 바로 아래의 폴더·파일(순수) */
export function entriesIn(entries: ShareEntry[], dir: string): ShareDirView {
  const prefix = dir ? dir + '/' : ''
  const folders = new Map<string, { name: string; path: string; count: number }>()
  const files: ShareDirView['files'] = []
  for (const e of entries) {
    if (!e.path.startsWith(prefix)) continue
    const rest = e.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) files.push({ name: rest, path: e.path, size: e.size, mtime: e.mtime })
    else {
      const name = rest.slice(0, slash)
      const fp = prefix + name
      folders.set(fp, { name, path: fp, count: (folders.get(fp)?.count ?? 0) + 1 })
    }
  }
  return { folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')), files: files.sort((a, b) => a.name.localeCompare(b.name, 'ko')) }
}
