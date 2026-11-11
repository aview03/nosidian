import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listModelsMock = vi.fn<(cfg: { baseUrl: string }) => Promise<string[]>>()
vi.mock('./llmNet', () => ({ listModels: (cfg: { baseUrl: string }) => listModelsMock(cfg) }))

import { _resetForTests, addConnection, connectionById, getSelected, selectedConnection, type AiConnection } from './aiConnections'
import { MAX_SHOWN, MODELS_TTL_MS, RETRY_MS, _resetRetry, chooseModel, isStale, modelList, optionValue, panelOptions, parseOptionValue, refreshModels, refreshStaleModels, selectedValue } from './aiModels'
import { supportsTools } from './llm'
import { stepActive } from '../components/Select'
import { t } from './i18n'

const oll = { kind: 'ollama', baseUrl: 'http://192.168.0.5:11434', model: 'qwen3:4b' }
const oai = { kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
const conn = (o: Partial<AiConnection> = {}): AiConnection => ({ id: 'c_x', ...oll, ...o })

beforeEach(() => {
  _resetForTests()
  _resetRetry()
  listModelsMock.mockReset()
})
afterEach(() => _resetForTests())

describe('연결 하나의 모델 목록', () => {
  it('서버가 알려 준 순서를 지키고, 지금 쓰는 모델이 없으면 맨 앞에 넣는다', () => {
    expect(modelList(conn({ models: { list: ['a', 'qwen3:4b', 'b'], at: 1 } }))).toEqual(['a', 'qwen3:4b', 'b'])
    expect(modelList(conn({ models: { list: ['a', 'b'], at: 1 } }))).toEqual(['qwen3:4b', 'a', 'b'])
  })
  it('목록이 없어도 지금 쓰는 모델은 쓸 수 있고, 모델도 없으면 빈 목록', () => {
    expect(modelList(conn())).toEqual(['qwen3:4b'])
    expect(modelList(conn({ model: '' }))).toEqual([])
  })
  it(`너무 긴 목록은 ${MAX_SHOWN}개로 자르되 지금 쓰는 모델은 남긴다`, () => {
    const list = Array.from({ length: 200 }, (_, i) => `m${i}`)
    const shown = modelList(conn({ model: 'm150', models: { list, at: 1 } }))
    expect(shown).toHaveLength(MAX_SHOWN)
    expect(shown[0]).toBe('m150')
  })
})

describe('AI 패널 선택 목록', () => {
  it('Claude 구독이 맨 위, 연결마다 묶음(제목=연결 이름, 항목=모델)', () => {
    const a = addConnection({ ...oll, models: { list: ['qwen3:4b', 'llama3.1:8b'], at: 1 } })
    const opts = panelOptions(true, [connectionById(a.id)!])
    expect(opts[0]).toMatchObject({ value: 'claude', label: t('Claude (구독)') })
    expect(opts.slice(1).map((o) => o.label)).toEqual(['qwen3:4b', 'llama3.1:8b'])
    expect(new Set(opts.slice(1).map((o) => o.group)).size).toBe(1)
    expect(opts[1].value).toBe(optionValue(a.id, 'qwen3:4b'))
    expect(opts[1].buttonLabel).toBe('Ollama qwen3:4b')
  })
  it('Claude 가 없으면 연결만, 연결이 없으면 Claude 만', () => {
    const a = addConnection(oll)
    expect(panelOptions(false, [connectionById(a.id)!]).map((o) => o.label)).toEqual(['qwen3:4b'])
    expect(panelOptions(true, []).map((o) => o.value)).toEqual(['claude'])
  })
  it('도구 호출을 못 하는 종류는 모델이 보이되 고를 수 없다(이유 표시)', () => {
    for (const kind of ['openai', 'anthropic', 'gemini'] as const) {
      const c = conn({ kind, baseUrl: 'https://x.example', model: 'm' })
      const [o] = panelOptions(false, [c])
      expect(!!o.disabled).toBe(!supportsTools(kind))
      if (!supportsTools(kind)) expect(o.hint).toBe(t('도구 호출 미지원'))
    }
  })
  it('모델을 안 고른 연결은 비활성 한 줄로 보인다', () => {
    const [o] = panelOptions(false, [conn({ model: '' })])
    expect(o).toMatchObject({ disabled: true, label: t('모델 안 고름') })
  })
})

describe('선택 값', () => {
  it('엔진이 claude 면 claude, 아니면 선택된 연결·모델', () => {
    const a = addConnection(oll)
    const b = addConnection(oai)
    const conns = [connectionById(a.id)!, connectionById(b.id)!]
    expect(selectedValue('claude', conns, getSelected())).toBe('claude')
    expect(selectedValue('ollama', conns, getSelected())).toBe(optionValue(b.id, 'gpt-4o-mini'))
    expect(selectedValue('ollama', conns, { conn: a.id, model: 'llama3.1:8b' })).toBe(optionValue(a.id, 'llama3.1:8b'))
    expect(selectedValue('ollama', [], null)).toBe('')
  })
  it('값 해석: claude / 연결::모델(모델 이름에 콜론이 있어도) / 이상한 값은 null', () => {
    expect(parseOptionValue('claude')).toEqual({ claude: true })
    expect(parseOptionValue('c_ab12::qwen3.5:4b')).toEqual({ claude: false, conn: 'c_ab12', model: 'qwen3.5:4b' })
    expect(parseOptionValue('nope')).toBeNull()
    expect(parseOptionValue('::m')).toBeNull()
  })
  it('chooseModel: 그 연결의 기본 모델로 저장하고 그 연결을 선택한다', () => {
    const a = addConnection(oll)
    addConnection(oai) // 마지막에 추가한 oai 가 선택돼 있다
    chooseModel(a.id, 'llama3.1:8b')
    expect(connectionById(a.id)?.model).toBe('llama3.1:8b')
    expect(selectedConnection()).toMatchObject({ id: a.id, model: 'llama3.1:8b' })
  })
})

describe('목록 가져오기', () => {
  it('refreshModels: 서버가 준 목록을 연결에 저장한다', async () => {
    const a = addConnection(oll)
    listModelsMock.mockResolvedValue(['a', 'b'])
    expect(await refreshModels(a.id)).toEqual(['a', 'b'])
    expect(connectionById(a.id)?.models?.list).toEqual(['a', 'b'])
  })
  it('실패하면 던지고, 저장돼 있던 목록은 그대로', async () => {
    const a = addConnection({ ...oll, models: { list: ['old'], at: 5 } })
    listModelsMock.mockRejectedValue(new Error('연결하지 못했어요'))
    await expect(refreshModels(a.id)).rejects.toThrow('연결하지 못했어요')
    expect(connectionById(a.id)?.models).toEqual({ list: ['old'], at: 5 })
  })
  it('낡은 것만(없거나 하루 지난 것) 가져온다', () => {
    const now = 10 * MODELS_TTL_MS
    expect(isStale(conn(), now)).toBe(true)
    expect(isStale(conn({ models: { list: [], at: now - 1000 } }), now)).toBe(false)
    expect(isStale(conn({ models: { list: [], at: now - MODELS_TTL_MS - 1 } }), now)).toBe(true)
  })
  it('refreshStaleModels: 낡은 연결만 한 번씩, 실패는 삼키고, 10분 안에는 다시 시도하지 않는다', async () => {
    const now = 100 * MODELS_TTL_MS
    const stale = addConnection({ ...oll })
    const fresh = addConnection({ ...oai, models: { list: ['x'], at: now - 1000 } })
    const bad = addConnection({ ...oll, baseUrl: 'http://10.9.9.9:11434' })
    const calls: string[] = []
    const refresh = async (id: string) => {
      calls.push(id)
      if (id === bad.id) throw new Error('offline')
    }
    await refreshStaleModels(now, refresh)
    expect(calls.sort()).toEqual([stale.id, bad.id].sort())
    expect(calls).not.toContain(fresh.id)
    await refreshStaleModels(now + RETRY_MS - 1, refresh)
    expect(calls).toHaveLength(2) // 쿨다운
    await refreshStaleModels(now + RETRY_MS + 1, refresh)
    expect(calls).toHaveLength(4)
  })
})

describe('선택 상자: 키보드 이동은 비활성 항목을 건너뛴다', () => {
  const o = (d?: boolean) => ({ disabled: d })
  it('아래·위로 다음 활성 항목', () => {
    const opts = [o(), o(true), o(true), o(), o(true)]
    expect(stepActive(opts, 0, 1)).toBe(3)
    expect(stepActive(opts, 3, -1)).toBe(0)
  })
  it('끝이면 그대로', () => {
    const opts = [o(), o(true)]
    expect(stepActive(opts, 0, 1)).toBe(0)
    expect(stepActive(opts, 0, -1)).toBe(0)
  })
})
