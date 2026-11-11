import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetForTests, addConnection, listConnections, selectedConnection, type AiConnection } from './aiConnections'
import { _resetSync, adoptUpstream, forgetPc, llmConfigVia, loadPcLink, savePcLink, syncPcUpstreams, upstreamsOf, type PcLink } from './pcLink'

const pingMock = vi.fn<(path: string) => Promise<unknown>>()
vi.mock('./llmNet', async (orig) => ({
  ...(await orig<typeof import('./llmNet')>()),
  send: async (req: { url: string }) => {
    const j = await pingMock(new URL(req.url).pathname)
    return { status: 200, text: JSON.stringify(j) }
  },
}))

const link = (o: Partial<PcLink> = {}): PcLink => ({ host: '192.168.0.2', port: 47410, token: 'a'.repeat(48), name: 'MY-PC', claude: false, upstream: null, upstreams: [], ...o })
const A = { id: 'c_aaaa1111', kind: 'ollama', model: 'qwen' }
const B = { id: 'c_bbbb2222', kind: 'openai', model: 'gpt-4o-mini' }
const viaPc = () => listConnections().filter((c) => c.viaPc)

beforeEach(() => {
  _resetForTests()
  _resetSync()
  pingMock.mockReset()
})
afterEach(() => {
  forgetPc()
  _resetForTests()
})

describe('PC 가 빌려주는 AI 목록', () => {
  it('새 PC 는 목록, 예전 PC 는 하나(id default)로 본다', () => {
    expect(upstreamsOf(link({ upstreams: [A, B] })).map((u) => u.id)).toEqual([A.id, B.id])
    expect(upstreamsOf(link({ upstream: { kind: 'ollama', model: 'q' } }))).toEqual([{ id: 'default', kind: 'ollama', model: 'q' }])
    expect(upstreamsOf(link())).toEqual([])
  })
  it('중계 주소: 새 PC 는 /u/<id> 아래, 예전 PC 는 루트', () => {
    expect(llmConfigVia(link(), A)?.baseUrl).toBe('http://192.168.0.2:47410/u/c_aaaa1111')
    expect(llmConfigVia(link(), B)?.baseUrl).toBe('http://192.168.0.2:47410/u/c_bbbb2222/v1') // OpenAI 계열은 /v1 로
    expect(llmConfigVia(link(), { id: 'default', kind: 'ollama', model: 'q' })?.baseUrl).toBe('http://192.168.0.2:47410')
    expect(llmConfigVia(link(), { id: 'c_x', kind: 'ollama', model: '' })).toBeNull() // 모델을 모르면 만들 수 없다
  })
  it('저장한 연결에서 목록이 살아난다(손상된 항목은 버린다)', () => {
    savePcLink(link({ upstreams: [A, B] }))
    expect(loadPcLink()?.upstreams?.map((u) => u.id)).toEqual([A.id, B.id])
    localStorage.setItem('nosidian.pc', JSON.stringify({ ...link({ upstreams: [A] }), upstreams: [A, { id: '../x', kind: 'ollama' }, 5, null] }))
    expect(loadPcLink()?.upstreams?.map((u) => u.id)).toEqual([A.id])
  })
})

describe('폰의 PC 경유 연결 맞추기', () => {
  it('빌려주는 AI 마다 연결이 하나씩 생기고, 내 연결은 그대로', () => {
    const mine = addConnection({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'mine', apiKey: 'sk-mine' })
    expect(adoptUpstream(link({ upstreams: [A, B] }))).toBe(true)
    const via = viaPc()
    expect(via.map((c) => c.remoteId).sort()).toEqual([A.id, B.id])
    expect(listConnections().find((c) => c.id === mine.id)).toMatchObject({ apiKey: 'sk-mine', model: 'mine' })
    expect(selectedConnection()?.remoteId).toBe(A.id) // 첫 번째를 쓴다
  })
  it('다시 맞춰도 중복이 없고, PC 가 더는 빌려주지 않는 AI 는 지워진다', () => {
    adoptUpstream(link({ upstreams: [A, B] }))
    adoptUpstream(link({ upstreams: [A] }))
    expect(viaPc().map((c) => c.remoteId)).toEqual([A.id])
  })
  it('PC 가 하나도 안 빌려주면 PC 경유 연결이 모두 사라지고 false', () => {
    adoptUpstream(link({ upstreams: [A, B] }))
    expect(adoptUpstream(link({ upstreams: [] }))).toBe(false)
    expect(viaPc()).toHaveLength(0)
  })
  it('keepModel: 폰에서 고른 모델을 자동 맞춤이 덮어쓰지 않고, 짝을 맺을 때는 PC 가 알려 준 모델로 맞춘다', () => {
    adoptUpstream(link({ upstreams: [A] }))
    const id = viaPc()[0].id
    const patch = (model: string) => listConnections().find((c) => c.id === id)!.model === model
    // 폰에서 다른 모델을 골랐다고 하자
    const mid = listConnections().find((c) => c.id === id) as AiConnection
    localStorage.setItem(`nosidian.llm.${id}`, JSON.stringify({ ...mid, model: 'phone-choice', id: undefined }))
    expect(patch('phone-choice')).toBe(true)
    adoptUpstream(link({ upstreams: [{ ...A, model: 'pc-new-model' }] }), { keepModel: true })
    expect(patch('phone-choice')).toBe(true)
    adoptUpstream(link({ upstreams: [{ ...A, model: 'pc-new-model' }] }))
    expect(patch('pc-new-model')).toBe(true)
  })
  it('예전 방식으로 저장된 연결(remoteId 없음)은 PC 가 하나만 빌려줄 때 그 하나로 이어받는다', () => {
    addConnection({ kind: 'ollama', baseUrl: 'http://192.168.0.2:47410', model: 'qwen', apiKey: 'old', viaPc: true })
    adoptUpstream(link({ upstreams: [A] }))
    expect(viaPc()).toHaveLength(1)
    expect(viaPc()[0].remoteId).toBe(A.id)
  })
  it('토큰이 바뀌면(다시 짝을 맺으면) 모든 PC 경유 연결의 토큰이 새 것으로 바뀐다', () => {
    adoptUpstream(link({ upstreams: [A, B], token: 'a'.repeat(48) }))
    adoptUpstream(link({ upstreams: [A, B], token: 'b'.repeat(48) }))
    expect(viaPc().every((c) => c.apiKey === 'b'.repeat(48))).toBe(true)
  })
  it('PC 연결을 해제하면 PC 경유 연결만 모두 지워진다', () => {
    const mine = addConnection({ kind: 'ollama', baseUrl: 'http://192.168.0.9:11434', model: 'mine' })
    adoptUpstream(link({ upstreams: [A, B] }))
    forgetPc()
    expect(listConnections().map((c) => c.id)).toEqual([mine.id])
  })
})

describe('열 때 PC 에서 목록 다시 받기(syncPcUpstreams)', () => {
  it('PC 가 새로 빌려주기 시작하면 폰 목록에 생기고, 폰에서 고른 모델은 유지', async () => {
    savePcLink(link({ upstreams: [A] }))
    adoptUpstream(link({ upstreams: [A] }))
    pingMock.mockResolvedValue({ name: 'MY-PC', claude: false, busy: false, upstream: { kind: A.kind, model: A.model }, upstreams: [A, B] })
    expect(await syncPcUpstreams(1_000_000)).toBe(true)
    expect(viaPc().map((c) => c.remoteId).sort()).toEqual([A.id, B.id])
    expect(loadPcLink()?.upstreams).toHaveLength(2)
  })
  it('PC 에 닿지 않으면 조용히 그대로(연결을 지우지 않는다)', async () => {
    savePcLink(link({ upstreams: [A] }))
    adoptUpstream(link({ upstreams: [A] }))
    pingMock.mockRejectedValue(new Error('offline'))
    expect(await syncPcUpstreams(1_000_000)).toBe(false)
    expect(viaPc()).toHaveLength(1)
  })
  it('같은 PC 에는 1분에 한 번만 묻는다', async () => {
    savePcLink(link({ upstreams: [A] }))
    pingMock.mockResolvedValue({ name: 'MY-PC', claude: false, busy: false, upstream: null, upstreams: [A] })
    await syncPcUpstreams(1_000_000)
    await syncPcUpstreams(1_000_000 + 59_000)
    expect(pingMock).toHaveBeenCalledTimes(1)
    await syncPcUpstreams(1_000_000 + 61_000)
    expect(pingMock).toHaveBeenCalledTimes(2)
  })
  it('연결해 둔 PC 가 없으면 아무것도 안 한다', async () => {
    expect(await syncPcUpstreams(1_000_000)).toBe(false)
    expect(pingMock).not.toHaveBeenCalled()
  })
})
