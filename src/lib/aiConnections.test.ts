import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hydrateSecrets, setSecureBackend, type SecureBackend } from './secureStore'
import { _resetForTests, addConnection, connectionById, getSelected, LEGACY_ID, listConnections, MAX_CONNECTIONS, migrateLegacy, removeConnection, selectedConnection, setSelected, updateConnection } from './aiConnections'
import { loadLlmConfig, saveLlmConfig } from './llm'

/** Keystore 를 흉내 낸 보안 저장소 */
function fakeKeystore() {
  const store = new Map<string, string>()
  const backend: SecureBackend = {
    async set({ key, value }) { store.set(key, value) },
    async get({ key }) { return { value: store.get(key) ?? null } },
    async remove({ key }) { store.delete(key) },
  }
  return { store, backend }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const oll = { kind: 'ollama', baseUrl: 'http://192.168.0.5:11434', model: 'qwen3:4b' }
const oai = { kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }

beforeEach(() => {
  _resetForTests()
  setSecureBackend(null)
})
afterEach(() => {
  _resetForTests()
  setSecureBackend(null)
})

describe('예전 한 칸 설정 → 연결 1개 (이름만 바꾼다)', () => {
  it('옮기면 연결 1개(c_legacy)가 선택되고, 옛 레코드는 비밀 없는 사본으로만 남는다', () => {
    localStorage.setItem('nosidian.llm', JSON.stringify({ ...oai, apiKey: 'sk-plain-1' }))
    expect(migrateLegacy()).toBe(true)
    expect(localStorage.getItem('nosidian.llm')).toBeNull()
    expect(localStorage.getItem('nosidian.llm.bak')).not.toContain('sk-plain-1')
    expect(listConnections()).toHaveLength(1)
    expect(selectedConnection()).toMatchObject({ id: LEGACY_ID, kind: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-plain-1' })
    expect(getSelected()).toEqual({ conn: LEGACY_ID, model: 'gpt-4o-mini' })
  })
  it('두 번 불러도 중복이 생기지 않는다', () => {
    localStorage.setItem('nosidian.llm', JSON.stringify(oll))
    expect(migrateLegacy()).toBe(true)
    expect(migrateLegacy()).toBe(false)
    expect(listConnections()).toHaveLength(1)
  })
  it('깨진 옛 설정은 건드리지 않고 연결 없음', () => {
    localStorage.setItem('nosidian.llm', '{깨짐')
    expect(migrateLegacy()).toBe(false)
    expect(localStorage.getItem('nosidian.llm')).toBe('{깨짐')
    expect(listConnections()).toHaveLength(0)
  })
  it('보안 저장소의 키(llm.apiKey)는 움직이지 않고 이전 뒤에도 같은 키가 읽힌다', async () => {
    const k = fakeKeystore()
    k.store.set('llm.apiKey', 'sk-from-keystore')
    localStorage.setItem('nosidian.llm', JSON.stringify(oai)) // 안드로이드: 레코드에는 키가 없다
    migrateLegacy()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    expect(loadLlmConfig()?.apiKey).toBe('sk-from-keystore')
    expect([...k.store.keys()]).toEqual(['llm.apiKey']) // 새 비밀이 생기지도, 옛 것이 지워지지도 않았다
  })
  it('평문 키는 보안 저장소로 확인 후 옮겨진다(웹→앱 업그레이드 경로)', async () => {
    const k = fakeKeystore()
    localStorage.setItem('nosidian.llm', JSON.stringify({ ...oai, apiKey: 'sk-plain-2' }))
    migrateLegacy()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    expect(k.store.get('llm.apiKey')).toBe('sk-plain-2')
    expect(localStorage.getItem('nosidian.llm.c_legacy')).not.toContain('sk-plain-2')
    expect(loadLlmConfig()?.apiKey).toBe('sk-plain-2')
  })
})

describe('여러 연결', () => {
  it('둘을 추가하면 둘 다 남고, 마지막에 추가한 것이 선택된다', () => {
    const a = addConnection({ ...oll, label: '내 PC' })
    const b = addConnection({ ...oai, apiKey: 'sk-b' })
    expect(a.id).not.toBe(b.id)
    expect(listConnections().map((c) => c.id)).toEqual([a.id, b.id])
    expect(selectedConnection()?.id).toBe(b.id)
    expect(connectionById(a.id)).toMatchObject({ label: '내 PC', kind: 'ollama' })
  })
  it('선택을 바꾸면(모델 포함) 선택된 연결의 모델로 보인다', () => {
    const a = addConnection(oll)
    addConnection(oai)
    setSelected(a.id, 'llama3.1:8b')
    expect(selectedConnection()).toMatchObject({ id: a.id, model: 'llama3.1:8b' })
    expect(loadLlmConfig()).toMatchObject({ id: a.id, model: 'llama3.1:8b' })
    setSelected('c_nope')
    expect(selectedConnection()?.id).toBe(a.id) // 없는 연결로는 바뀌지 않는다
  })
  it('연결마다 비밀 이름이 달라 서로의 키를 덮어쓰지 않고, 해제하면 그 키만 지운다', async () => {
    const k = fakeKeystore()
    setSecureBackend(k.backend)
    await hydrateSecrets()
    const a = addConnection({ ...oai, apiKey: 'sk-AAA' })
    const b = addConnection({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x', apiKey: 'sk-BBB' })
    await tick()
    expect(k.store.get(`llm.apiKey.${a.id}`)).toBe('sk-AAA')
    expect(k.store.get(`llm.apiKey.${b.id}`)).toBe('sk-BBB')
    expect(connectionById(a.id)?.apiKey).toBe('sk-AAA')
    expect(connectionById(b.id)?.apiKey).toBe('sk-BBB')
    for (const id of [a.id, b.id]) expect(localStorage.getItem(`nosidian.llm.${id}`)).not.toMatch(/sk-AAA|sk-BBB/)
    removeConnection(a.id)
    await tick()
    expect(k.store.has(`llm.apiKey.${a.id}`)).toBe(false)
    expect(k.store.get(`llm.apiKey.${b.id}`)).toBe('sk-BBB')
  })
  it('선택된 연결을 해제하면 남은 첫 연결로 넘어가고, 모두 지우면 선택도 없다', () => {
    const a = addConnection(oll)
    const b = addConnection(oai)
    removeConnection(b.id)
    expect(selectedConnection()?.id).toBe(a.id)
    removeConnection(a.id)
    expect(selectedConnection()).toBeNull()
    expect(getSelected()).toBeNull()
  })
  it(`상한(${MAX_CONNECTIONS}개)을 넘으면 거절한다`, () => {
    for (let i = 0; i < MAX_CONNECTIONS; i++) addConnection({ ...oll, baseUrl: `http://10.0.0.${i + 1}:11434` })
    expect(() => addConnection(oll)).toThrow()
    expect(listConnections()).toHaveLength(MAX_CONNECTIONS)
  })
  it('주소나 종류가 바뀌면 모델 목록 캐시를 버리고, 모델만 바뀌면 유지한다', () => {
    const a = addConnection({ ...oll, models: { list: ['a', 'b'], at: 1 } })
    updateConnection(a.id, { model: 'b' })
    expect(connectionById(a.id)?.models?.list).toEqual(['a', 'b'])
    updateConnection(a.id, { baseUrl: 'http://10.0.0.9:11434' })
    expect(connectionById(a.id)?.models).toBeUndefined()
  })
  it('목록·선택 인덱스에 이상한 id 가 섞여 있어도 무시한다', () => {
    const a = addConnection(oll)
    localStorage.setItem('nosidian.aiConnections', JSON.stringify({ v: 2, ids: [a.id, '../evil', 5, a.id], selected: { conn: '../evil' } }))
    expect(listConnections().map((c) => c.id)).toEqual([a.id])
    expect(getSelected()).toBeNull()
    expect(selectedConnection()?.id).toBe(a.id) // 선택이 이상하면 첫 연결
  })
})

describe('예전 코드가 쓰던 창구(loadLlmConfig / saveLlmConfig)', () => {
  it('저장하면 선택된 연결을 고치고(새로 만들지 않고), null 이면 그 연결만 지운다', () => {
    const a = addConnection(oll)
    const b = addConnection(oai)
    saveLlmConfig({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1' })
    expect(listConnections()).toHaveLength(2)
    expect(connectionById(b.id)?.model).toBe('gpt-4.1')
    expect(connectionById(a.id)?.model).toBe('qwen3:4b')
    saveLlmConfig(null)
    expect(listConnections().map((c) => c.id)).toEqual([a.id])
  })
  it('연결이 없을 때 저장하면 새 연결이 생긴다', () => {
    saveLlmConfig({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'm' })
    expect(listConnections()).toHaveLength(1)
    expect(loadLlmConfig()).toMatchObject({ kind: 'ollama', model: 'm' })
  })
  it('id 를 주면 그 연결을 고친다(선택돼 있지 않아도)', () => {
    const a = addConnection(oll)
    addConnection(oai)
    saveLlmConfig({ id: a.id, kind: 'ollama', baseUrl: oll.baseUrl, model: 'other' })
    expect(connectionById(a.id)?.model).toBe('other')
  })
})
