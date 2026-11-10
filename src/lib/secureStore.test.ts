import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateSecrets, onSecretsReady, secureAvailable, setSecureBackend, type SecureBackend } from './secureStore'
import { loadPcShare, savePcShare, usePcFilesUi, type PcShare } from './pcFiles'
import { loadPcLink, savePcLink, type PcLink } from './pcLink'
import { loadLlmConfig, saveLlmConfig } from './llm'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'
const FP = 'ab'.repeat(32)

/** Keystore 를 흉내 낸 보안 저장소: 실패·불일치·키 무효를 시험에서 켤 수 있다 */
function fakeKeystore() {
  const store = new Map<string, string>()
  const flags = { failSet: false, wrongRead: false, invalid: new Set<string>() }
  const backend: SecureBackend = {
    async set({ key, value }) {
      if (flags.failSet) throw new Error('encrypt failed')
      store.set(key, value)
    },
    async get({ key }) {
      if (flags.invalid.has(key)) {
        store.delete(key)
        return { value: null, invalid: true }
      }
      const v = store.get(key) ?? null
      return { value: flags.wrongRead && v ? v + 'x' : v }
    },
    async remove({ key }) {
      store.delete(key)
    },
  }
  return { backend, store, flags }
}

const share = (over: Partial<PcShare> = {}): PcShare => ({ host: '192.168.0.10', port: 47411, token: TOKEN, fp: FP, name: 'PC', dirName: 'docs', ...over })
const link = (over: Partial<PcLink> = {}): PcLink => ({ host: '192.168.0.10', port: 47410, token: TOKEN, name: 'PC', claude: true, upstream: null, ...over })
const rawShare = () => localStorage.getItem('nosidian.pcshare') ?? ''
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  setSecureBackend(null)
})
afterEach(() => {
  setSecureBackend(null)
  vi.restoreAllMocks()
})

describe('보안 저장소가 없는 환경(웹·PC 앱)', () => {
  it('지금까지처럼 localStorage 에 그대로 저장한다', () => {
    setSecureBackend(null)
    expect(secureAvailable()).toBe(false)
    savePcShare(share())
    expect(rawShare()).toContain(TOKEN)
    expect(loadPcShare()?.token).toBe(TOKEN)
    savePcShare(null)
    expect(loadPcShare()).toBeNull()
  })
})

describe('새로 저장: 토큰은 보안 저장소에만', () => {
  it('localStorage 에는 토큰이 남지 않고, 읽으면 합쳐서 돌려주며, 재시작(캐시 비움 → 다시 읽기) 후에도 유지된다', async () => {
    const k = fakeKeystore()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    savePcShare(share())
    await tick()
    expect(rawShare()).not.toContain(TOKEN)
    expect(JSON.parse(rawShare())).toMatchObject({ host: '192.168.0.10', fp: FP, name: 'PC' }) // 비밀이 아닌 정보는 그대로
    expect(k.store.get('pcshare.token')).toBe(TOKEN)
    expect(loadPcShare()).toMatchObject({ token: TOKEN, fp: FP })
    // 앱 재시작: 메모리 캐시가 사라진 뒤 보안 저장소에서 다시 읽는다
    setSecureBackend(k.backend)
    expect(loadPcShare()).toBeNull() // 복호화 전에는 토큰이 없어서 쓸 수 없다(연결 안 됨으로 보인다)
    await hydrateSecrets()
    expect(loadPcShare()).toMatchObject({ token: TOKEN, fp: FP })
  })
  it('AI 중계 연결(nosidian.pc)과 폰의 API 키(nosidian.llm)도 같다', async () => {
    const k = fakeKeystore()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    savePcLink(link())
    saveLlmConfig({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test-SECRET-1234567890' })
    await tick()
    expect(localStorage.getItem('nosidian.pc')).not.toContain(TOKEN)
    expect(localStorage.getItem('nosidian.llm')).not.toContain('SECRET')
    expect(loadPcLink()?.token).toBe(TOKEN)
    expect(loadLlmConfig()?.apiKey).toBe('sk-test-SECRET-1234567890')
    expect([...k.store.keys()].sort()).toEqual(['llm.apiKey', 'pc.token'])
  })
  it('키가 필요 없는 로컬 서버 설정은 비밀 없이도 유효하고, 키를 지우면 보안 저장소에서도 지운다', async () => {
    const k = fakeKeystore()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    saveLlmConfig({ kind: 'ollama', baseUrl: 'http://192.168.0.5:11434', model: 'qwen' })
    expect(loadLlmConfig()).toMatchObject({ kind: 'ollama', model: 'qwen' })
    expect(loadLlmConfig()?.apiKey).toBeUndefined()
    saveLlmConfig({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: 'sk-x' })
    await tick()
    expect(k.store.has('llm.apiKey')).toBe(true)
    saveLlmConfig({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm' })
    await tick()
    expect(k.store.has('llm.apiKey')).toBe(false)
    saveLlmConfig(null)
    expect(loadLlmConfig()).toBeNull()
  })
  it('연결 해제하면 보안 저장소의 토큰도 지운다', async () => {
    const k = fakeKeystore()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    savePcShare(share())
    await tick()
    savePcShare(null)
    await tick()
    expect(k.store.size).toBe(0)
    expect(rawShare()).toBe('')
  })
})

describe('기존 평문 토큰·키의 안전한 이전', () => {
  it('평문을 보안 저장소로 옮기고(확인 후) localStorage 에서 지운다 — 이후 읽기·재시작도 된다', async () => {
    localStorage.setItem('nosidian.pcshare', JSON.stringify(share()))
    localStorage.setItem('nosidian.pc', JSON.stringify(link()))
    localStorage.setItem('nosidian.llm', JSON.stringify({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: 'sk-legacy-KEY' }))
    const k = fakeKeystore()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    for (const key of ['nosidian.pcshare', 'nosidian.pc', 'nosidian.llm']) expect(localStorage.getItem(key), key).not.toMatch(/a1b2c3d4|sk-legacy/)
    expect(k.store.get('pcshare.token')).toBe(TOKEN)
    expect(k.store.get('pc.token')).toBe(TOKEN)
    expect(k.store.get('llm.apiKey')).toBe('sk-legacy-KEY')
    expect(loadPcShare()?.token).toBe(TOKEN)
    expect(loadLlmConfig()?.apiKey).toBe('sk-legacy-KEY')
    setSecureBackend(k.backend)
    await hydrateSecrets()
    expect(loadPcShare()?.token).toBe(TOKEN) // 재시작 후에도
    expect(loadPcLink()?.token).toBe(TOKEN)
  })
  it('이전 전(복호화 전)에도 평문 값은 읽을 수 있다 — 값을 잃지 않는다', () => {
    localStorage.setItem('nosidian.pcshare', JSON.stringify(share()))
    setSecureBackend(fakeKeystore().backend)
    expect(loadPcShare()?.token).toBe(TOKEN)
  })
  it('보안 저장소에 쓰지 못하면 평문을 그대로 둔다(다음 시작 때 다시 시도)', async () => {
    localStorage.setItem('nosidian.pcshare', JSON.stringify(share()))
    const k = fakeKeystore()
    k.flags.failSet = true
    setSecureBackend(k.backend)
    await hydrateSecrets()
    expect(rawShare()).toContain(TOKEN)
    expect(loadPcShare()?.token).toBe(TOKEN)
    k.flags.failSet = false
    setSecureBackend(k.backend)
    await hydrateSecrets() // 다음 시작: 이번엔 옮겨진다
    expect(rawShare()).not.toContain(TOKEN)
    expect(k.store.get('pcshare.token')).toBe(TOKEN)
  })
  it('쓴 값을 다시 읽어 확인했을 때 다르면 평문을 지우지 않는다', async () => {
    localStorage.setItem('nosidian.pcshare', JSON.stringify(share()))
    const k = fakeKeystore()
    k.flags.wrongRead = true
    setSecureBackend(k.backend)
    await hydrateSecrets()
    expect(rawShare()).toContain(TOKEN)
    expect(loadPcShare()?.token).toBe(TOKEN)
  })
})

describe('키 무효(백업 복원·기기 이전)와 저장 실패', () => {
  it('Keystore 키가 무효가 되면 연결을 정리하고(평문으로 되돌리지 않고) 연결 안 됨으로 돌아간다', async () => {
    const k = fakeKeystore()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    savePcShare(share())
    await tick()
    k.flags.invalid.add('pcshare.token') // 복원된 기기: 암호문은 있지만 키가 없다
    setSecureBackend(k.backend)
    await hydrateSecrets()
    expect(loadPcShare()).toBeNull()
    expect(rawShare()).toBe('') // 쓸 수 없는 레코드는 지운다
    expect(usePcFilesUi.getState().link).toBeNull()
  })
  it('저장할 때 보안 저장소 쓰기가 실패하면 값을 잃지 않도록 평문으로 되돌리고 경고를 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const k = fakeKeystore()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    k.flags.failSet = true
    savePcShare(share())
    await tick()
    await tick()
    expect(warn).toHaveBeenCalled()
    expect(loadPcShare()?.token).toBe(TOKEN)
  })
})

describe('시작 흐름', () => {
  it('복호화가 끝나면 알린다 — 모듈 로드 때 만든 화면 상태(연결 정보)가 다시 읽힌다', async () => {
    const k = fakeKeystore()
    k.store.set('pcshare.token', TOKEN)
    localStorage.setItem('nosidian.pcshare', JSON.stringify({ host: '192.168.0.10', port: 47411, fp: FP, name: 'PC', dirName: 'docs' })) // 토큰 없는(이전을 마친) 레코드
    setSecureBackend(k.backend)
    usePcFilesUi.setState({ link: loadPcShare() })
    expect(usePcFilesUi.getState().link).toBeNull() // 복호화 전
    const ready = vi.fn()
    const off = onSecretsReady(ready)
    await hydrateSecrets()
    off()
    expect(ready).toHaveBeenCalledTimes(1)
    expect(usePcFilesUi.getState().link).toMatchObject({ token: TOKEN, host: '192.168.0.10' })
  })
  it('보안 저장소가 오류를 내도 시작은 막히지 않는다', async () => {
    localStorage.setItem('nosidian.pcshare', JSON.stringify(share()))
    setSecureBackend({
      set: () => Promise.reject(new Error('boom')),
      get: () => Promise.reject(new Error('boom')),
      remove: () => Promise.reject(new Error('boom')),
    })
    await expect(hydrateSecrets()).resolves.toBeUndefined()
    expect(loadPcShare()?.token).toBe(TOKEN) // 평문이 있으면 그대로 쓴다
  })
})
