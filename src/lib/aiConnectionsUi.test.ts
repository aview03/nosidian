import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetForTests, addConnection, listConnections, selectedConnection } from './aiConnections'
import { adoptUpstream, forgetPc, loadPcLink, type PcLink } from './pcLink'
import { connectionBadge, connectionSub, connectionTitle, countConnected, isInUse } from './aiWizard'
import { loadAllLlmConfigs, supportsTools, type LlmConfig } from './llm'
import { t } from './i18n'

beforeEach(() => _resetForTests())
afterEach(() => {
  forgetPc()
  _resetForTests()
})

const own = (o: Partial<LlmConfig> = {}): LlmConfig => ({ kind: 'ollama', baseUrl: 'http://192.168.0.5:11434', model: 'qwen3:4b', ...o })

describe('연결 목록 행의 이름·종류·설명', () => {
  it('직접 지은 이름이 있으면 그것, 없으면 종류와 주소', () => {
    expect(connectionTitle(own({ label: '  거실 PC  ' }))).toBe('거실 PC')
    expect(connectionTitle(own())).toBe('Ollama · 192.168.0.5:11434')
    expect(connectionTitle(own({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' }))).toBe('OpenAI')
    expect(connectionTitle(own({ kind: 'custom', baseUrl: 'http://10.0.0.2:1234/v1' }))).toContain('10.0.0.2:1234')
    expect(connectionTitle(own({ viaPc: true }))).toMatch(/^PC · /)
  })
  it('주소가 이상해도 던지지 않는다', () => {
    expect(connectionTitle(own({ baseUrl: '이상한 주소' }))).toBe('Ollama')
  })
  it('종류 이름표: 내 컴퓨터 / PC 경유 / API 키', () => {
    expect(connectionBadge(own())).toBe(t('내 컴퓨터'))
    expect(connectionBadge(own({ viaPc: true }))).toBe(t('PC 경유'))
    expect(connectionBadge(own({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' }))).toBe(t('API 키'))
  })
  it('설명 줄은 모델을 보여 주고, 도구 호출을 못 하는 종류는 이유를 붙인다', () => {
    expect(connectionSub(own())).toBe('qwen3:4b')
    expect(connectionSub(own({ model: '' }))).toBe(t('모델 안 고름'))
    for (const kind of ['openai', 'anthropic', 'gemini'] as const) {
      const c = own({ kind, baseUrl: 'https://x.example', model: 'm' })
      expect(connectionSub(c).includes(t('도구 호출을 지원하지 않아 AI 패널에서는 쓸 수 없어요'))).toBe(!supportsTools(kind))
    }
  })
})

describe('개수·사용 중 표시', () => {
  it('Claude 구독이 준비돼 있으면 하나로 센다', () => {
    expect(countConnected(false, [])).toBe(0)
    expect(countConnected(true, [])).toBe(1)
    expect(countConnected(true, [own(), own({ baseUrl: 'http://10.0.0.9:11434' })])).toBe(3)
  })
  it('Claude 는 엔진이 claude 일 때만, 연결은 엔진이 ollama 이고 선택된 것만 사용 중', () => {
    expect(isInUse('claude', 'c_a', 'claude')).toBe(true)
    expect(isInUse('ollama', 'c_a', 'claude')).toBe(false)
    expect(isInUse('ollama', 'c_a', 'c_a')).toBe(true)
    expect(isInUse('ollama', 'c_a', 'c_b')).toBe(false)
    expect(isInUse('claude', 'c_a', 'c_a')).toBe(false) // 엔진이 Claude 면 연결은 "사용 중"이 아니다
  })
})

describe('폰: 내 PC 연결(PC 경유)은 내가 직접 연결한 AI 를 덮어쓰지 않는다', () => {
  const link = (model = 'qwen3:4b'): PcLink => ({ host: '192.168.0.2', port: 47410, token: 'a'.repeat(48), name: 'MY-PC', claude: false, upstream: { kind: 'ollama', model } })

  it('내 연결이 있어도 PC 경유 연결이 따로 추가되고 선택된다', () => {
    const mine = addConnection({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-mine' })
    expect(adoptUpstream(link())).toBe(true)
    const all = loadAllLlmConfigs()
    expect(all).toHaveLength(2)
    expect(all.find((c) => c.id === mine.id)).toMatchObject({ kind: 'openai', apiKey: 'sk-mine' })
    expect(selectedConnection()).toMatchObject({ viaPc: true, model: 'qwen3:4b' })
  })
  it('같은 PC 에 다시 연결해도 PC 경유 연결은 하나이고 새 모델로 고쳐진다', () => {
    adoptUpstream(link('a'))
    adoptUpstream(link('b'))
    const via = loadAllLlmConfigs().filter((c) => c.viaPc)
    expect(via).toHaveLength(1)
    expect(via[0].model).toBe('b')
  })
  it('PC 연결을 해제하면 PC 경유 연결만 지워지고 내 연결·선택은 남는다', () => {
    const mine = addConnection({ kind: 'ollama', baseUrl: 'http://192.168.0.5:11434', model: 'mine' })
    adoptUpstream(link())
    expect(loadPcLink()).toBeNull() // adoptUpstream 은 연결 정보(토큰)를 따로 저장하지 않는다 — 여기서는 AI 연결만 본다
    forgetPc()
    expect(listConnections().map((c) => c.id)).toEqual([mine.id])
    expect(selectedConnection()?.id).toBe(mine.id)
  })
})
