// 폰 → PC 호스트 동기화 클라이언트(v1.42). PC 앱의 "휴대폰과 맞추기"(electron/hostServer.cjs)와 짝을 맺고, 호스트 폴더를 Vault 의 동기화 대상으로 쓴다.
//  - 통신은 HTTPS + 인증서 지문 고정(PinnedHttp). 지문은 QR/연결 문자열(nsh1:…)로만 받는다.
//  - 토큰은 Android Keystore(v1.39)에 둔다. 기기 식별은 기기 ID·인증서 지문이고 IP 는 **힌트**일 뿐이다 — 주소가 바뀌면 후보를 차례로 시도하고,
//    연결에 성공하면 PC 가 알려 주는 현재 주소 목록으로 갱신한다. 지문이 다르면 자동으로 다시 연결하지 않는다.
//  - 쓰기 권한은 PC 에서 기기별로 허용해야 한다(기본 읽기 전용). 권한이 없으면 받기만 하고 올리기는 안내한다.
import { pinnedRequest } from './pinnedHttp'
import { clearSecretRecord, readSecretRecord, registerSecret, writeSecretRecord, type SecretSpec } from './secureStore'
import { t } from './i18n'
import { SyncError } from './sync/types'
import { clientId } from './deviceId'

const KEY = 'nosidian.pchost'
const SECRET: SecretSpec = { storageKey: KEY, field: 'token', secretName: 'pchost.token', required: true }
registerSecret(SECRET)

export interface PcHostLink {
  /** 마지막으로 연결에 성공한 주소 */
  host: string
  /** 알려진 주소 후보(PC 에 어댑터가 여러 개일 수 있고, IP 가 바뀔 수 있다) */
  hosts: string[]
  port: number
  /** 고정한 PC 인증서 지문(SHA-256 소문자 16진 64자) */
  fp: string
  token: string
  deviceId: string
  name: string
  folder: string
}

export function loadPcHost(): PcHostLink | null {
  const v = readSecretRecord<Partial<PcHostLink>>(SECRET)
  if (!v || typeof v.host !== 'string' || typeof v.token !== 'string' || typeof v.fp !== 'string' || !/^[0-9a-f]{64}$/.test(v.fp) || !Number.isInteger(v.port)) return null
  const hosts = Array.isArray(v.hosts) ? v.hosts.filter((h): h is string => typeof h === 'string') : []
  return { host: v.host, hosts: hosts.length ? hosts : [v.host], port: v.port as number, fp: v.fp, token: v.token, deviceId: String(v.deviceId ?? ''), name: String(v.name ?? 'PC'), folder: String(v.folder ?? '') }
}
export function savePcHost(l: PcHostLink | null) {
  if (l) writeSecretRecord(SECRET, { ...l })
  else clearSecretRecord(SECRET)
}
export const forgetPcHost = () => savePcHost(null)

export interface HostPairing {
  host: string
  hosts: string[]
  port: number
  code: string
  fp: string
}

/** 연결 문자열 해석: "nsh1:ip,ip:포트:코드:지문(64자)" — QR 과 복사한 문자열이 같다 */
export function parseHostPairing(raw: string): HostPairing | null {
  const m = /^nsh1:([\d.,]+):(\d{2,5}):(\d{6}):([0-9a-fA-F]{64})$/.exec(raw.trim())
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

export class HostCallError extends SyncError {
  code?: string
  currentRev?: string | null
  deleted?: boolean
  constructor(msg: string, status: number, extra: { code?: string; currentRev?: string | null; deleted?: boolean } = {}) {
    super(msg, status)
    Object.assign(this, extra)
  }
}

/** 오류를 사람이 읽는 문장으로. code 는 서버가 준 코드 */
export function hostErrorText(status: number, code: string | undefined, fallback: string): string {
  if (/pin mismatch/i.test(fallback)) return t('이 PC의 인증서가 연결할 때와 달라요. 다른 기기가 끼어들었거나 PC에서 새로 설정했을 수 있어요. 연결을 해제하고 QR로 다시 연결해 주세요')
  switch (code) {
    case 'noWrite': return t('이 PC에서 이 휴대폰의 쓰기를 허용해야 올릴 수 있어요')
    case 'noDelete': return t('이 PC가 삭제를 허용하지 않아요')
    case 'executable': return t('실행 파일은 폰에서 PC로 올릴 수 없어요')
    case 'tooLarge': return t('파일이 너무 커서 올릴 수 없어요(최대 25MB)')
    case 'noSpace': return t('PC의 저장 공간이 부족해요')
    case 'rate': return t('너무 자주 보내서 잠시 막혔어요. 잠시 뒤에 다시 해 주세요')
    case 'noFolder': return t('PC에서 호스트 폴더가 지정돼 있지 않아요')
    case 'conflict': case 'case': return t('PC에서 먼저 바뀌었어요')
    case 'badPath': return t('이 이름은 PC 폴더에 둘 수 없어요')
    case 'busy': return t('PC의 호스트 폴더를 다른 프로그램이 쓰고 있어요')
  }
  if (status === 401) return t('이 PC에서 연결이 해제됐어요. 새 코드로 다시 연결해 주세요')
  if (status === 403) return t('연결 코드가 맞지 않거나 만료됐어요. PC에서 새 코드를 만들어 주세요')
  if (status === 429) return t('시도가 너무 많아 잠시 막혔어요. 1분 뒤에 다시 해 주세요')
  if (status === 409) return t('이 PC에 연결할 수 있는 기기 수(5대)를 넘었어요. PC에서 안 쓰는 기기를 해제해 주세요')
  if (status === 0 || status >= 500) return t('PC에 연결하지 못했어요. PC 앱이 켜져 있고 같은 와이파이인지 확인해 주세요')
  return fallback
}

type Raw = { status: number; json: Record<string, unknown> }
async function raw(l: { port: number; fp: string; token?: string }, host: string, path: string, body: unknown, timeoutMs: number): Promise<Raw> {
  const r = await pinnedRequest({ url: `https://${host}:${l.port}${path}`, method: 'POST', headers: { 'Content-Type': 'application/json', ...(l.token ? { Authorization: `Bearer ${l.token}` } : {}) }, body: JSON.stringify(body ?? {}), pin: l.fp, timeoutMs })
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(r.text) as Record<string, unknown>
  } catch {
    /* JSON 이 아니면 상태로 판단 */
  }
  return { status: r.status, json }
}
const isNetworkFailure = (e: unknown) => !/pin mismatch|pin required|https only/i.test(e instanceof Error ? e.message : String(e))

function toError(r: Raw): HostCallError {
  const code = typeof r.json.code === 'string' ? r.json.code : undefined
  const msg = typeof r.json.error === 'string' ? r.json.error : `HTTP ${r.status}`
  return new HostCallError(hostErrorText(r.status, code, msg), r.status, { code, currentRev: (r.json.currentRev as string | null | undefined) ?? undefined, deleted: r.json.deleted === true })
}

/**
 * 호스트 서버를 부른다. 마지막으로 성공한 주소로 먼저, 네트워크 실패(연결 안 됨)이면 다른 후보 주소를 차례로 시도한다(5초씩).
 * 서버가 HTTP 로 답했으면(오류 포함) 주소는 맞는 것이므로 더 시도하지 않는다. 인증서 지문이 다르면 즉시 중단한다.
 */
export async function callHost(link: PcHostLink, path: string, body?: unknown, timeoutMs = 30000): Promise<Record<string, unknown>> {
  const order = [link.host, ...link.hosts.filter((h) => h !== link.host)]
  let lastErr: unknown = null
  for (let i = 0; i < order.length; i++) {
    const host = order[i]
    try {
      const r = await raw(link, host, path, body, i === 0 ? timeoutMs : Math.min(timeoutMs, 5000))
      if (r.status < 200 || r.status >= 300) throw toError(r)
      if (host !== link.host) savePcHost({ ...link, host }) // 마지막 성공 주소를 기억한다
      return r.json
    } catch (e) {
      if (e instanceof HostCallError) throw e
      lastErr = e
      if (!isNetworkFailure(e)) break
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new HostCallError(hostErrorText(0, undefined, msg), 0, { code: /pin mismatch/i.test(msg) ? 'pin' : 'network' })
}

/** 연결 문자열로 짝을 맺는다. 성공하면 저장한다(토큰은 Keystore) */
export async function pairHost(p: HostPairing, deviceName: string): Promise<PcHostLink> {
  let last: unknown = new Error('no host')
  for (const host of p.hosts) {
    try {
      const r = await Promise.race([raw({ port: p.port, fp: p.fp }, host, '/pair', { code: p.code, name: deviceName, clientId: clientId() }, 6000), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 6500))])
      if (r.status !== 200) throw toError(r)
      const link: PcHostLink = { host, hosts: p.hosts, port: p.port, fp: p.fp, token: String(r.json.token), deviceId: String(r.json.deviceId ?? ''), name: String(r.json.name ?? 'PC'), folder: String(r.json.folder ?? '') }
      savePcHost(link)
      return link
    } catch (e) {
      last = e
      if (e instanceof HostCallError || !isNetworkFailure(e)) break // 서버가 답했거나 지문이 다르면 다른 주소를 더 시도하지 않는다
    }
  }
  if (last instanceof HostCallError) throw last
  const msg = last instanceof Error ? last.message : String(last)
  throw new HostCallError(hostErrorText(0, undefined, msg), 0, { code: /pin mismatch/i.test(msg) ? 'pin' : 'network' })
}

export interface PcHostPing {
  name: string
  folder: string
  perms: { write: boolean; delete: boolean }
  epoch: string
  ips: string[]
}
/** PC 의 상태·내 권한·현재 주소. 주소 후보가 달라졌으면 저장해 둔다 */
export async function pingHost(link: PcHostLink): Promise<PcHostPing> {
  const j = (await callHost(link, '/ping', {}, 15000)) as unknown as PcHostPing
  const ips = Array.isArray(j.ips) ? j.ips.filter((x): x is string => typeof x === 'string' && /^[\d.]+$/.test(x)).slice(0, 6) : []
  if (ips.length) {
    const cur = loadPcHost() ?? link
    const merged = [cur.host, ...ips.filter((x) => x !== cur.host)].slice(0, 6)
    if (merged.join() !== cur.hosts.join()) savePcHost({ ...cur, hosts: merged, name: j.name || cur.name, folder: j.folder || cur.folder })
  }
  return { name: String(j.name ?? ''), folder: String(j.folder ?? ''), perms: { write: j.perms?.write === true, delete: j.perms?.delete === true }, epoch: String(j.epoch ?? ''), ips }
}
