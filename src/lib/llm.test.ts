import { describe, expect, it } from 'vitest'
import { buildChat, buildListModels, describeFailure, forRequest, isPrivateHost, parseTurn, supportsTools, type ChatMessage, type ToolSpec, LlmError, loadLlmConfig, parseChat, parseModels, saveLlmConfig, validateConfig, type LlmConfig } from './llm'

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
    expect(loadLlmConfig()).toMatchObject(cfg({ apiKey: 'k' }))
    localStorage.setItem('nosidian.aiConnections', '{깨짐') // 연결 목록이 깨지면 "연결 없음"
    expect(loadLlmConfig()).toBeNull()
    saveLlmConfig(cfg())
    saveLlmConfig(null)
    expect(loadLlmConfig()).toBeNull()
  })
})

describe('보안 저장소의 키(keyStored)', () => {
  it('키 입력 없이도 클라우드 설정이 유효하고, 요청에는 자리표시자만 들어간다(화면은 키를 모른다)', () => {
    const c: LlmConfig = { kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt', keyStored: true }
    expect(validateConfig(c)).toEqual([])
    const r = buildChat(forRequest(c), MSGS)
    expect(r.headers.Authorization).toBe('Bearer {{KEY}}')
    const a = buildListModels(forRequest({ ...c, kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }))
    expect(a.headers['x-api-key']).toBe('{{KEY}}')
    expect(forRequest({ ...c, kind: 'gemini', baseUrl: 'https://g.example' }) .apiKey).toBe('{{KEY}}')
  })
  it('keyStored 가 아니면 설정 그대로', () => {
    const c = cfg({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'g', apiKey: 'sk-1' })
    expect(forRequest(c)).toBe(c)
  })
  it('저장·불러오기에서 keyStored 는 유지되고 평문 키는 없다', () => {
    saveLlmConfig({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'g', keyStored: true })
    expect(loadLlmConfig()).toMatchObject({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'g', keyStored: true })
    const id = loadLlmConfig()!.id!
    expect(localStorage.getItem(`nosidian.llm.${id}`)).not.toContain('apiKey')
    // 연결 id 가 있으면 키 자리표시자에 id 가 들어가 메인 프로세스가 그 연결의 키를 찾는다
    expect(forRequest(loadLlmConfig()!).apiKey).toBe(`{{KEY:${id}}}`)
    saveLlmConfig(null)
  })
})

describe('도구 호출(function calling)', () => {
  const TOOLS: ToolSpec[] = [{ name: 'search_notes', description: '검색', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }]
  const convo: ChatMessage[] = [
    { role: 'user', content: '행사 찾아 줘' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'search_notes', args: { query: '행사' } }] },
    { role: 'tool', content: '{"count":1}', toolCallId: 'call_1', toolName: 'search_notes' },
  ]
  it('지원 제공자: Ollama·OpenAI 호환만', () => {
    expect(['ollama', 'openai', 'custom'].every((k) => supportsTools(k as never))).toBe(true)
    expect(supportsTools('anthropic')).toBe(false)
    expect(supportsTools('gemini')).toBe(false)
  })
  it('Ollama 요청: tools·think·num_ctx, 도구 호출은 인자를 객체로, 도구 결과는 tool_name 으로', () => {
    const r = buildChat(cfg(), convo, { tools: TOOLS, think: false, numCtx: 16384, temperature: 0.2 })
    const b = JSON.parse(r.body!)
    expect(b.think).toBe(false)
    expect(b.options).toMatchObject({ num_ctx: 16384, temperature: 0.2 })
    expect(b.tools).toEqual([{ type: 'function', function: { name: 'search_notes', description: '검색', parameters: TOOLS[0].inputSchema } }])
    expect(b.messages[1]).toEqual({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_notes', arguments: { query: '행사' } } }] })
    expect(b.messages[2]).toEqual({ role: 'tool', content: '{"count":1}', tool_name: 'search_notes' })
  })
  it('OpenAI 호환 요청: 인자는 JSON 글자, 결과는 tool_call_id 로', () => {
    const r = buildChat({ kind: 'custom', baseUrl: 'http://localhost:1234/v1', model: 'm' }, convo, { tools: TOOLS })
    const b = JSON.parse(r.body!)
    expect(b.tools[0].function.name).toBe('search_notes')
    expect(b.messages[1].tool_calls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'search_notes', arguments: '{"query":"행사"}' } }])
    expect(b.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"count":1}' })
  })
  it('요청별 시간 제한을 요청에 실어 보낸다(Ollama·OpenAI 호환), 없으면 싣지 않는다', () => {
    expect(buildChat(cfg(), [{ role: 'user', content: 'q' }], { timeoutMs: 300000 }).timeoutMs).toBe(300000)
    expect(buildChat({ kind: 'custom', baseUrl: 'http://x/v1', model: 'm' }, [{ role: 'user', content: 'q' }], { timeoutMs: 5000 }).timeoutMs).toBe(5000)
    expect(buildChat(cfg(), [{ role: 'user', content: 'q' }])).not.toHaveProperty('timeoutMs')
  })
  it('도구를 안 쓰는 요청은 이전과 같다(think·tools 없음)', () => {
    const b = JSON.parse(buildChat(cfg(), [{ role: 'user', content: 'q' }]).body!)
    expect(b).not.toHaveProperty('tools')
    expect(b).not.toHaveProperty('think')
    expect(b.messages).toEqual([{ role: 'user', content: 'q' }])
  })
  it('Anthropic·Gemini 는 도구 호출을 거절한다(조용히 무시하지 않는다)', () => {
    for (const kind of ['anthropic', 'gemini'] as const) {
      const c: LlmConfig = { kind, baseUrl: 'https://x.example', model: 'm', apiKey: 'k' }
      expect(() => buildChat(c, [{ role: 'user', content: 'q' }], { tools: TOOLS })).toThrow(/도구 호출/)
      expect(() => buildChat(c, convo)).toThrow(/도구 호출/)
      expect(() => buildChat(c, [{ role: 'user', content: 'q' }])).not.toThrow()
    }
  })
  it('응답 해석(Ollama): 글, 도구 호출, 둘 다 없으면 오류', () => {
    expect(parseTurn(cfg(), { message: { content: '답' } })).toEqual({ text: '답', toolCalls: [] })
    expect(parseTurn(cfg(), { message: { content: '', tool_calls: [{ function: { name: 'search_notes', arguments: { query: 'a' } } }] } })).toEqual({ text: '', toolCalls: [{ name: 'search_notes', args: { query: 'a' } }] })
    expect(() => parseTurn(cfg(), { message: { content: '  ' } })).toThrow(LlmError)
    expect(() => parseTurn(cfg(), { error: 'model not found' })).toThrow('model not found')
  })
  it('응답 해석(OpenAI 호환): id 와 JSON 글자 인자, 깨진 인자는 __raw 로', () => {
    const c = cfg({ kind: 'custom' })
    const t = parseTurn(c, { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'read_note', arguments: '{"path":"a.md"}' } }, { id: 'c2', function: { name: 'read_note', arguments: '{깨짐' } }, { id: 'c3', function: { name: '', arguments: '{}' } }] } }] })
    expect(t.toolCalls).toEqual([{ id: 'c1', name: 'read_note', args: { path: 'a.md' } }, { id: 'c2', name: 'read_note', args: { __raw: '{깨짐' } }])
  })
  it('도구 미지원 제공자의 응답은 글만 읽는다', () => {
    expect(parseTurn(cfg({ kind: 'anthropic' }), { content: [{ type: 'text', text: '가' }] })).toEqual({ text: '가', toolCalls: [] })
  })
})

describe('OpenAI 모델 목록은 대화용만', () => {
  const openai = (ids: string[]) => parseModels(cfg({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' }), { data: ids.map((id) => ({ id })) })
  it('임베딩·음성·이미지·검색 미리보기 모델을 뺀다', () => {
    expect(openai(['gpt-4o', 'gpt-4o-mini', 'text-embedding-3-small', 'whisper-1', 'tts-1', 'dall-e-3', 'omni-moderation-latest', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'gpt-image-1', 'gpt-4o-search-preview', 'gpt-3.5-turbo-instruct', 'o3-mini', 'chatgpt-4o-latest'])).toEqual(['chatgpt-4o-latest', 'gpt-4o', 'gpt-4o-mini', 'o3-mini'])
  })
  it('걸러서 아무것도 안 남으면(이름 규칙이 바뀐 경우) 서버가 준 그대로 보여 준다', () => {
    expect(openai(['model-a', 'model-b'])).toEqual(['model-a', 'model-b'])
  })
  it('다른 종류(사용자 지정 서버 등)는 거르지 않는다', () => {
    expect(parseModels(cfg({ kind: 'custom' }), { data: [{ id: 'text-embedding-x' }, { id: 'local-chat' }] })).toEqual(['local-chat', 'text-embedding-x'])
  })
})
