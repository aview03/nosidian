import { describe, expect, it } from 'vitest'
import { buildChat, buildListModels, describeFailure, isPrivateHost, LlmError, loadLlmConfig, parseChat, parseModels, saveLlmConfig, validateConfig, type LlmConfig } from './llm'

const cfg = (o: Partial<LlmConfig> = {}): LlmConfig => ({ kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3', ...o })
const MSGS = [{ role: 'system' as const, content: '규칙을 지켜' }, { role: 'user' as const, content: '안녕' }, { role: 'assistant' as const, content: '네' }, { role: 'user' as const, content: '요약해' }]

describe('주소 검증', () => {
  it('사설망·내 기기 주소', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '172.16.3.1', '172.31.255.1', '192.168.0.10', '169.254.1.1', '100.64.0.1', '100.127.9.9', 'nas.local', '[::1]']) expect(isPrivateHost(h), h).toBe(true)
    for (const h of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.128.0.1', 'api.openai.com', '192.169.0.1', 'example.com']) expect(isPrivateHost(h), h).toBe(false)
  })
  it('공개 인터넷으로 http 는 금지, https 는 허용, 사설망 http 는 허용', () => {
    expect(validateConfig(cfg({ baseUrl: 'http://192.168.0.10:11434' }))).toEqual([])
    expect(validateConfig(cfg({ baseUrl: 'http://example.com:11434' }))).toContain('httpPublic')
    expect(validateConfig(cfg({ kind: 'custom', baseUrl: 'https://llm.example.com/v1' }))).toEqual([])
    expect(validateConfig(cfg({ baseUrl: 'file:///etc/passwd' }))).toContain('url')
    expect(validateConfig(cfg({ baseUrl: '이상한 주소' }))).toContain('url')
  })
  it('모델은 필수(목록 조회 때는 불필요), 클라우드는 키 필수', () => {
    expect(validateConfig(cfg({ model: '' }))).toEqual(['model'])
    expect(validateConfig(cfg({ model: '' }), { needModel: false })).toEqual([])
    expect(validateConfig(cfg({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' }))).toContain('key')
    expect(validateConfig(cfg({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt', apiKey: 'sk-x' }))).toEqual([])
    expect(validateConfig(cfg({ kind: 'custom', baseUrl: 'http://localhost:1234/v1' }))).toEqual([]) // 키 없어도 됨
  })
})

describe('요청 만들기', () => {
  it('Ollama: /api/chat, stream 끔', () => {
    const r = buildChat(cfg({ baseUrl: 'http://192.168.0.10:11434/' }), MSGS, { temperature: 0.2, maxTokens: 300 })
    expect(r).toMatchObject({ url: 'http://192.168.0.10:11434/api/chat', method: 'POST' })
    expect(JSON.parse(r.body!)).toMatchObject({ model: 'llama3', stream: false, options: { temperature: 0.2, num_predict: 300 } })
    expect(JSON.parse(r.body!).messages).toHaveLength(4)
  })
  it('OpenAI 호환: Bearer 키는 있을 때만', () => {
    const r = buildChat({ kind: 'custom', baseUrl: 'http://localhost:1234/v1', model: 'm' }, MSGS)
    expect(r.url).toBe('http://localhost:1234/v1/chat/completions')
    expect(r.headers.Authorization).toBeUndefined()
    const o = buildChat({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt', apiKey: 'sk-1' }, MSGS, { maxTokens: 50 })
    expect(o.headers.Authorization).toBe('Bearer sk-1')
    expect(JSON.parse(o.body!)).toMatchObject({ model: 'gpt', max_tokens: 50 })
  })
  it('Anthropic: system 은 따로, max_tokens 필수, 키는 헤더', () => {
    const r = buildChat({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x', apiKey: 'k' }, MSGS)
    const b = JSON.parse(r.body!)
    expect(r.url).toBe('https://api.anthropic.com/v1/messages')
    expect(r.headers['x-api-key']).toBe('k')
    expect(r.headers['anthropic-version']).toBeTruthy()
    expect(b.system).toBe('규칙을 지켜')
    expect(b.max_tokens).toBe(1024)
    expect(b.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true)
  })
  it('Gemini: 역할 이름 변환, 키는 헤더(주소에 넣지 않는다)', () => {
    const r = buildChat({ kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-x', apiKey: 'g' }, MSGS)
    const b = JSON.parse(r.body!)
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent')
    expect(r.url).not.toMatch(/[?&]key=/)
    expect(r.headers['x-goog-api-key']).toBe('g')
    expect(b.systemInstruction.parts[0].text).toBe('규칙을 지켜')
    expect(b.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user'])
  })
  it('모델 목록 요청', () => {
    expect(buildListModels(cfg()).url).toBe('http://localhost:11434/api/tags')
    expect(buildListModels({ kind: 'custom', baseUrl: 'http://x:1/v1/', model: '' }).url).toBe('http://x:1/v1/models')
    expect(buildListModels({ kind: 'gemini', baseUrl: 'https://g.example', model: '', apiKey: 'k' }).headers['x-goog-api-key']).toBe('k')
  })
})

describe('응답 읽기', () => {
  it('제공자별 답변 글', () => {
    expect(parseChat(cfg(), { message: { role: 'assistant', content: '답' } })).toBe('답')
    expect(parseChat(cfg({ kind: 'openai' }), { choices: [{ message: { content: '답2' } }] })).toBe('답2')
    expect(parseChat(cfg({ kind: 'anthropic' }), { content: [{ type: 'text', text: '가' }, { type: 'text', text: '나' }] })).toBe('가나')
    expect(parseChat(cfg({ kind: 'gemini' }), { candidates: [{ content: { parts: [{ text: '지' }, { text: '미' }] } }] })).toBe('지미')
  })
  it('비어 있으면 서버 오류 문장과 함께 LlmError', () => {
    expect(() => parseChat(cfg(), {})).toThrow(LlmError)
    expect(() => parseChat(cfg({ kind: 'openai' }), { error: { message: 'bad key' } })).toThrow('bad key')
    expect(() => parseChat(cfg({ kind: 'ollama' }), { error: 'model not found' })).toThrow('model not found')
  })
  it('모델 목록: 중복 제거·정렬, Gemini 는 generateContent 가능한 것만', () => {
    expect(parseModels(cfg(), { models: [{ name: 'b:7b' }, { name: 'a:1b' }, { name: 'a:1b' }] })).toEqual(['a:1b', 'b:7b'])
    expect(parseModels(cfg({ kind: 'custom' }), { data: [{ id: 'z' }, { id: 'y' }] })).toEqual(['y', 'z'])
    expect(parseModels(cfg({ kind: 'gemini' }), { models: [{ name: 'models/g1', supportedGenerationMethods: ['generateContent'] }, { name: 'models/emb', supportedGenerationMethods: ['embedContent'] }] })).toEqual(['g1'])
    expect(parseModels(cfg(), 'x')).toEqual([])
  })
  it('실패 설명', () => {
    expect(describeFailure(401, { error: { message: 'no' } })).toContain('인증')
    expect(describeFailure(404, {})).toContain('404')
    expect(describeFailure(500, { error: 'boom' })).toContain('boom')
  })
})

describe('기기 저장', () => {
  it('저장·불러오기·지우기, 깨진 값은 null', () => {
    expect(loadLlmConfig()).toBeNull()
    saveLlmConfig(cfg({ apiKey: 'k' }))
    expect(loadLlmConfig()).toEqual(cfg({ apiKey: 'k' }))
    localStorage.setItem('nosidian.llm', '{깨짐')
    expect(loadLlmConfig()).toBeNull()
    saveLlmConfig(cfg())
    saveLlmConfig(null)
    expect(loadLlmConfig()).toBeNull()
  })
})
