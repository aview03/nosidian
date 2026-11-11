// "기기 추가" 모달의 순수 로직. 연결 QR·코드는 평소에 보이지 않고, 사용자가 요청한 뒤 5분 동안만 모달에 나온다.
// 세 서버(AI 중계·폴더 공유·호스트 동기화)의 상태를 같은 모양(PairState)으로 맞추고, 지금 어느 단계인지(pairPhase)를 판정한다.
import type { HostServerStatus, RelayStatus, ShareStatus } from './externalIO'

export interface PairState {
  /** 지금 유효한 6자리 코드(없으면 null) */
  code: string | null
  /** 코드가 만료되는 시각(ms) */
  expiresAt: number | null
  /** QR 에 넣을 연결 문자열 */
  pair: string | null
  /** 손으로 입력하거나 복사할 글자 */
  typed: string
  /** 같은 와이파이 주소가 없음 */
  noNetwork: boolean
  devices: { id: string; name: string; createdAt: number }[]
}

export type PairPhase = 'loading' | 'waiting' | 'connected' | 'expired'

/** 새 코드를 만들기 직전의 기기들(id → 연결한 시각). 그 뒤에 생기거나 다시 연결된 기기가 "방금 연결된 기기" */
export type PairBase = Map<string, number>
export const baselineIds = (s: PairState | null): PairBase => new Map((s?.devices ?? []).map((d) => [d.id, d.createdAt]))

/** 방금 연결된 기기. 같은 기기가 다시 연결하면 서버가 같은 항목의 토큰·연결 시각만 바꾸므로(기기 하나에 링크 하나) 시각이 달라진 것도 찾는다 */
export const newcomer = (s: PairState | null, base: PairBase) => s?.devices.find((d) => base.get(d.id) !== d.createdAt) ?? null

export function pairPhase(s: PairState | null, base: PairBase, now: number): PairPhase {
  if (!s) return 'loading'
  if (newcomer(s, base)) return 'connected'
  if (!s.code || !s.expiresAt || s.expiresAt <= now) return 'expired'
  return 'waiting'
}

/** 남은 시간을 m:ss 로 */
export function remaining(expiresAt: number | null, now: number): string {
  const sec = Math.max(0, Math.ceil(((expiresAt ?? 0) - now) / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export const relayState = (s: RelayStatus): PairState => ({
  code: s.code,
  expiresAt: s.codeExpiresAt,
  pair: s.pairs[0] ?? null,
  typed: s.ips[0] && s.code ? `${s.ips[0]}:${s.port}/${s.code}` : '',
  noNetwork: s.ips.length === 0,
  devices: s.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt })),
})

export const shareState = (s: ShareStatus): PairState => ({
  code: s.code,
  expiresAt: s.codeExpiresAt,
  pair: s.pair,
  typed: s.pair ?? '',
  noNetwork: s.ips.length === 0,
  devices: s.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt })),
})

export const hostState = (s: HostServerStatus): PairState => ({
  code: s.code,
  expiresAt: s.codeExpiresAt,
  pair: s.pair,
  typed: s.pair ?? '',
  noNetwork: s.ips.length === 0,
  devices: s.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt })),
})
