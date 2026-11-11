import { describe, expect, it } from 'vitest'
import { baselineIds, hostState, newcomer, pairPhase, relayState, remaining, shareState, type PairState } from './pairModal'

const mk = (o: Partial<PairState> = {}): PairState => ({ code: '123456', expiresAt: 10_000, pair: 'nsd1:x', typed: 'x', noNetwork: false, devices: [], ...o })
const none = new Map<string, number>()

describe('기기 추가 모달: 단계 판정', () => {
  it('상태를 못 받았으면 loading', () => expect(pairPhase(null, none, 0)).toBe('loading'))
  it('코드가 유효하면 waiting', () => expect(pairPhase(mk(), none, 5_000)).toBe('waiting'))
  it('만료 시각이 지나면 expired(서버 코드가 남아 있어도)', () => expect(pairPhase(mk(), none, 10_000)).toBe('expired'))
  it('코드가 없으면 expired(폐기·소모)', () => expect(pairPhase(mk({ code: null, expiresAt: null }), none, 1)).toBe('expired'))
  it('기준에 없던 기기가 생기면 connected', () => {
    const base = baselineIds(mk({ devices: [{ id: 'a', name: '옛 폰', createdAt: 1 }] }))
    const s = mk({ code: null, expiresAt: null, devices: [{ id: 'a', name: '옛 폰', createdAt: 1 }, { id: 'b', name: '내 폰', createdAt: 2 }] })
    expect(pairPhase(s, base, 1)).toBe('connected')
    expect(newcomer(s, base)?.name).toBe('내 폰')
  })
  it('같은 기기가 다시 연결하면(같은 항목의 연결 시각만 바뀜, 기기 수 그대로) connected 로 알아챈다', () => {
    const base = baselineIds(mk({ devices: [{ id: 'a', name: '내 폰', createdAt: 100 }] }))
    const s = mk({ code: null, expiresAt: null, devices: [{ id: 'a', name: '내 폰', createdAt: 250 }] })
    expect(pairPhase(s, base, 1)).toBe('connected')
  })
  it('코드가 소모됐어도 새 연결이 없으면(기기 수 상한 등) 연결된 것으로 보지 않는다', () => {
    const base = baselineIds(mk({ devices: [{ id: 'a', name: '폰', createdAt: 1 }] }))
    expect(pairPhase(mk({ code: null, expiresAt: null, devices: [{ id: 'a', name: '폰', createdAt: 1 }] }), base, 1)).toBe('expired')
  })
})

describe('남은 시간', () => {
  it('m:ss', () => {
    expect(remaining(300_000, 0)).toBe('5:00')
    expect(remaining(65_000, 1_000)).toBe('1:04')
    expect(remaining(10_000, 20_000)).toBe('0:00')
    expect(remaining(null, 0)).toBe('0:00')
  })
})

describe('서버 상태 → 모달 상태', () => {
  const dev = [{ id: 'd1', name: 'S23', createdAt: 1, lastSeen: 2 }]
  it('AI 중계: nsd1 문자열·입력용 주소', () => {
    const s = relayState({ enabled: true, running: true, port: 47410, ips: ['192.168.0.2'], code: '111222', codeExpiresAt: 99, pairs: ['nsd1:192.168.0.2:47410:111222'], devices: dev, upstream: null, upstreams: [], claude: true, error: null })
    expect(s.pair).toBe('nsd1:192.168.0.2:47410:111222')
    expect(s.typed).toBe('192.168.0.2:47410/111222')
    expect(s.expiresAt).toBe(99)
    expect(s.noNetwork).toBe(false)
  })
  it('코드가 없으면 입력용 주소도 비운다', () => {
    const s = relayState({ enabled: true, running: true, port: 1, ips: ['10.0.0.1'], code: null, codeExpiresAt: null, pairs: [], devices: [], upstream: null, upstreams: [], claude: false, error: null })
    expect(s.typed).toBe('')
    expect(s.code).toBeNull()
  })
  it('와이파이가 없으면 noNetwork', () => {
    const s = shareState({ enabled: true, running: true, port: 1, ips: [], dir: 'C:/x', code: null, codeExpiresAt: null, pair: null, fingerprint: '', devices: [], error: null })
    expect(s.noNetwork).toBe(true)
  })
  it('호스트 서버: 연결 문자열과 기기', () => {
    const s = hostState({ hostConfigured: true, enabled: true, running: true, port: 1, ips: ['10.0.0.1'], code: '1', codeExpiresAt: 5, pair: 'nsh1:x', fingerprint: '', allowDelete: false, devices: [{ id: 'h', name: '폰', createdAt: 1, lastSeen: 1, perms: { write: false, delete: false }, writes: 0, lastWriteAt: 0 }], error: null })
    expect(s.pair).toBe('nsh1:x')
    expect(s.devices).toEqual([{ id: 'h', name: '폰', createdAt: 1 }])
  })
})
