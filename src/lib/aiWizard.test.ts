import { describe, expect, it } from 'vitest'
import { setLang } from './i18n'
import { KEY_PROVIDERS, LOCAL_PROVIDERS, aiSummary, pickModel } from './aiWizard'
import { supportsTools } from './llm'

setLang('ko')

describe('AI 연결 상태 요약', () => {
  const ok = { found: true, loggedIn: true, version: '2.1.3' }
  it('Claude 엔진: 로그인돼 있으면 연결됨, 아니면 안 됨', () => {
    expect(aiSummary('claude', ok, null)).toMatchObject({ connected: true, title: '내 Claude 계정으로 연결됨', sub: 'Claude Code 2.1.3' })
    expect(aiSummary('claude', { found: true, loggedIn: false }, null).connected).toBe(false)
    expect(aiSummary('claude', null, null).connected).toBe(false)
    expect(aiSummary('claude', { found: false }, null).title).toBe('아직 연결 안 됨')
  })
  it('로컬/키 엔진: 도구 호출을 지원하고 모델이 있어야 연결됨', () => {
    expect(aiSummary('ollama', null, { kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3.5:4b' })).toMatchObject({ connected: true, title: '내 컴퓨터의 AI로 연결됨', sub: 'Ollama · qwen3.5:4b' })
    expect(aiSummary('ollama', null, { kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyStored: true })).toMatchObject({ connected: true, title: 'API 키로 연결됨' })
    expect(aiSummary('ollama', null, { kind: 'ollama', baseUrl: 'x', model: '' }).connected).toBe(false) // 모델 없음
    expect(aiSummary('ollama', null, { kind: 'anthropic', baseUrl: 'x', model: 'm' }).connected).toBe(false) // 도구 호출 미지원
    expect(aiSummary('ollama', null, null).connected).toBe(false)
  })
})

describe('모델 고르기', () => {
  it('제공자별 선호 모델을 먼저, 없으면 첫 번째, 목록이 비면 빈 문자열', () => {
    expect(pickModel('openai', ['gpt-4o', 'gpt-4o-mini', 'o3'])).toBe('gpt-4o-mini')
    expect(pickModel('openai', ['o3', 'x'])).toBe('o3')
    expect(pickModel('ollama', ['phi3', 'qwen3.5:4b', 'llama3.1'])).toBe('qwen3.5:4b')
    expect(pickModel('custom', ['a', 'b'])).toBe('a')
    expect(pickModel('ollama', [])).toBe('')
  })
})

describe('연결 방식 목록', () => {
  it('키로 연결할 수 있다고 표시한 제공자는 AI 패널이 쓰는 도구 호출을 지원한다(지원 안 하는 것은 준비 중)', () => {
    for (const p of KEY_PROVIDERS) expect(p.ready).toBe(supportsTools(p.kind))
    expect(KEY_PROVIDERS.find((p) => p.kind === 'openai')!.ready).toBe(true)
    expect(LOCAL_PROVIDERS.map((p) => p.kind)).toEqual(['ollama', 'custom'])
  })
})
