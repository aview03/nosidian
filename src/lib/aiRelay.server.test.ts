import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mod from '../../electron/aiRelay.cjs'

const { createRelay, isPrivateAddress, lanAddresses } = mod as {
  createRelay(d: unknown): any
  isPrivateAddress(a: string): boolean
  lanAddresses(i?: unknown): string[]
}

type Ev = { type: string; [k: string]: unknown }
type Up = { kind: string; baseUrl: string; model: string; keyStored?: boolean } | null

function boot(over: Record<string, unknown> = {}) {
  let saved: unknown = null
  let upstream: Up = { kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen' }
  const llmRequest = vi.fn(async (req: { url: string }) => ({ status: 200, text: JSON.stringify({ via: req.url }) }))
  let busy = false
  const run = vi.fn(async (_req: unknown, emit: (e: Ev) => void) => {
    busy = true
    emit({ type: 'text', text: 'hi' })
    emit({ type: 'result', ok: true, text: 'done', turns: 1, costUsd: 0.01 })
    busy = false
  })
  const relay = createRelay({
    store: { read: () => saved, write: (v: unknown) => { saved = JSON.parse(JSON.stringify(v)) } },
    hostName: 'TESTPC',
    getUpstream: () => upstream,
    llmRequest,
    claude: { ready: () => true, busy: () => busy, run, cancel: vi.fn(() => true) },
    pollWaitMs: 400,
    ...over,
  })
  return { relay, llmRequest, run, setUpstream: (u: Up) => { upstream = u }, saved: () => saved }
}

let current: { close(): Promise<void> } | null = null
afterEach(async () => {
  await current?.close()
  current = null
})
const post = (base: string, path: string, body: unknown, token?: string) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', Connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })

async function start(o?: Record<string, unknown>) {
  const b = boot(o)
  const port = await b.relay.listen(0, '127.0.0.1')
  current = b.relay
  const base = `http://127.0.0.1:${port}`
  const code = b.relay.codeNow().value as string
  return { ...b, base, code }
}
async function paired(o?: Record<string, unknown>) {
  const s = await start(o)
  const r = await post(s.base, '/pair', { code: s.code, name: '내 폰' })
  const j = (await r.json()) as { token: string }
  return { ...s, token: j.token }
}

describe('사설망 판정·주소', () => {
  it('사설·로컬 주소만 통과', () => {
    for (const a of ['192.168.0.3', '10.1.2.3', '172.16.0.1', '172.31.9.9', '169.254.1.1', '100.64.0.1', '127.0.0.1', '::1', '::ffff:192.168.1.9', 'fd12::1', 'fe80::1']) expect(isPrivateAddress(a)).toBe(true)
    for (const a of ['8.8.8.8', '172.32.0.1', '11.0.0.1', '203.0.113.5', '2001:db8::1', '']) expect(isPrivateAddress(a)).toBe(false)
  })
  it('lanAddresses: 가상 어댑터(VirtualBox 등)는 맨 뒤로', () => {
    expect(lanAddresses({ 'VirtualBox Host-Only Network': [{ family: 'IPv4', address: '192.168.56.1', internal: false }], 'Wi-Fi': [{ family: 'IPv4', address: '192.168.10.86', internal: false }], 'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }] })).toEqual(['192.168.10.86', '192.168.56.1', '172.20.0.1'])
  })
  it('lanAddresses: 내부 인터페이스·공인 주소·IPv6 는 뺀다', () => {
    expect(lanAddresses({ eth0: [{ family: 'IPv4', address: '192.168.0.10', internal: false }, { family: 'IPv4', address: '8.8.4.4', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] })).toEqual(['192.168.0.10'])
  })
})

describe('짝 맺기', () => {
  it('맞는 코드로 한 번 맺으면 토큰을 받고, 코드는 다시 쓸 수 없다', async () => {
    const s = await start()
    const r = await post(s.base, '/pair', { code: s.code, name: '내 폰' })
    expect(r.status).toBe(200)
    const j = (await r.json()) as { token: string; name: string; upstream: unknown; claude: boolean }
    expect(j.token).toMatch(/^[0-9a-f]{48}$/)
    expect(j).toMatchObject({ name: 'TESTPC', upstream: { kind: 'ollama', model: 'qwen' }, claude: true })
    expect((await post(s.base, '/pair', { code: s.code, name: 'x' })).status).toBe(403)
    expect(JSON.stringify(s.saved())).not.toContain(j.token) // 토큰은 해시로만 보관
    expect((s.saved() as { devices: { hash: string }[] }).devices[0].hash).toHaveLength(64)
  })
  it('틀린 코드는 거절하고, 5번 틀리면 잠시 막는다(맞는 코드도)', async () => {
    const s = await start()
    for (let i = 0; i < 5; i++) expect((await post(s.base, '/pair', { code: '000000', name: 'x' })).status).toBe(403)
    expect((await post(s.base, '/pair', { code: s.code, name: 'x' })).status).toBe(429)
  })
  it('코드는 5분이 지나면 만료된다', async () => {
    let t = 1_000_000
    const s = await start({ now: () => t })
    t += 5 * 60_000 + 1
    expect((await post(s.base, '/pair', { code: s.code, name: 'x' })).status).toBe(403)
  })
  it('기기는 5대까지', async () => {
    const s = await start()
    for (let i = 0; i < 5; i++) expect((await post(s.base, '/pair', { code: s.relay.codeNow().value, name: 'p' + i })).status).toBe(200)
    expect((await post(s.base, '/pair', { code: s.relay.codeNow().value, name: 'p6' })).status).toBe(409)
  })
  it('기기 이름에서 이상한 글자를 걷어낸다', async () => {
    const s = await start()
    await post(s.base, '/pair', { code: s.code, name: '<script>내 폰</script>' })
    expect((s.saved() as { devices: { name: string }[] }).devices[0].name).toBe('script내 폰script')
  })
})

describe('인증', () => {
  it('토큰이 없거나 틀리면 401, 해제한 기기의 토큰도 401', async () => {
    const s = await paired()
    expect((await fetch(s.base + '/ping')).status).toBe(401)
    expect((await fetch(s.base + '/ping', { headers: { authorization: 'Bearer ' + 'a'.repeat(48) } })).status).toBe(401)
    const ok = await fetch(s.base + '/ping', { headers: { authorization: `Bearer ${s.token}` } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ name: 'TESTPC', claude: true, upstream: { kind: 'ollama' } })
    s.relay.revoke(s.relay.state().devices[0].id)
    expect((await fetch(s.base + '/ping', { headers: { authorization: `Bearer ${s.token}` } })).status).toBe(401)
  })
})

describe('모델 중계(역방향 프록시)', () => {
  const get = (s: { base: string; token: string }, path: string, body?: unknown) =>
    fetch(s.base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', Connection: 'close' }, body: body ? JSON.stringify(body) : undefined })

  it('Ollama: /api/* 를 PC 의 Ollama 로 전달한다', async () => {
    const s = await paired()
    const r = await get(s, '/api/chat', { model: 'qwen' })
    expect(await r.json()).toEqual({ via: 'http://localhost:11434/api/chat' })
    expect(s.llmRequest.mock.calls[0][0]).toMatchObject({ method: 'POST', timeoutMs: 300000 })
  })
  it('OpenAI: /v1/* 는 api.openai.com 으로, 키는 자리표시자로만(폰은 키를 모른다)', async () => {
    const s = await paired()
    s.setUpstream({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyStored: true })
    await get(s, '/v1/chat/completions', { model: 'x' })
    const req = s.llmRequest.mock.calls[0][0] as { url: string; headers: Record<string, string> }
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(req.headers.authorization).toBe('Bearer {{KEY}}')
  })
  it('LM Studio(custom): 주소의 /v1 이 겹치지 않게 붙인다', async () => {
    const s = await paired()
    s.setUpstream({ kind: 'custom', baseUrl: 'http://localhost:1234/v1', model: 'm' })
    await get(s, '/v1/models')
    expect((s.llmRequest.mock.calls[0][0] as { url: string }).url).toBe('http://localhost:1234/v1/models')
  })
  it('지원하지 않는 경로·연결 없음·PC 쪽 오류를 구분해 돌려준다', async () => {
    const s = await paired()
    expect((await get(s, '/v1/models')).status).toBe(200) // Ollama 의 OpenAI 호환 경로
    expect((await get(s, '/other')).status).toBe(404)
    s.setUpstream(null)
    expect((await get(s, '/api/tags')).status).toBe(503)
    s.setUpstream({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm' })
    expect((await get(s, '/api/tags')).status).toBe(404)
    s.llmRequest.mockResolvedValueOnce({ status: 0, text: '', error: '연결하지 못했어요' } as never)
    expect((await get(s, '/v1/models')).status).toBe(502)
  })
})

describe('Claude 구독 중계', () => {
  const call = async (s: { base: string; token: string }, path: string, body: unknown) => (await (await post(s.base, path, body, s.token)).json()) as Record<string, any>
  const claudeWith = (run: unknown, over: Record<string, unknown> = {}) => ({ claude: { ready: () => true, busy: () => false, run, cancel: vi.fn(), ...over } })

  it('실행 → 폴링으로 이벤트를 받고 end 에서 멈춘다(도구 호출이 없는 단순한 경우)', async () => {
    const s = await paired()
    const { runId } = await call(s, '/claude/run', { prompt: 'q', mode: 'ask' })
    expect(s.run.mock.calls[0][0]).toMatchObject({ prompt: 'q', mode: 'ask', forceApproval: false })
    let cursor = 0
    const got: Ev[] = []
    for (let i = 0; i < 5; i++) {
      const p = await call(s, '/claude/poll', { runId, cursor })
      got.push(...p.events)
      cursor = p.cursor
      if (p.done) break
    }
    expect(got.map((e) => e.type)).toEqual(['text', 'result', 'end'])
  })

  it('도구 호출은 폰으로 보내고(toolcall), 폰이 /claude/tool 로 돌려준 결과가 Claude 쪽 callTool 의 결과가 된다', async () => {
    let result: unknown
    const run = vi.fn(async (req: { callTool(t: string, a: object, c: string): Promise<unknown> }, emit: (e: Ev) => void) => {
      result = await req.callTool('read_note', { path: 'a.md' }, 'x')
      emit({ type: 'result', ok: true, text: 'ok', turns: 1, costUsd: 0 })
    })
    const s = await paired(claudeWith(run))
    const { runId } = await call(s, '/claude/run', { prompt: 'q', mode: 'edit', forceApproval: true })
    expect(run.mock.calls[0][0]).toMatchObject({ mode: 'edit', forceApproval: true })
    const p = await call(s, '/claude/poll', { runId, cursor: 0 })
    const tc = p.events.find((e: Ev) => e.type === 'toolcall')
    expect(tc).toMatchObject({ tool: 'read_note', args: { path: 'a.md' } })
    await call(s, '/claude/tool', { runId, id: tc.id, ok: { content: '본문' } })
    const p2 = await call(s, '/claude/poll', { runId, cursor: p.cursor })
    expect(p2.events.map((e: Ev) => e.type)).toContain('result')
    expect(result).toEqual({ content: '본문' })
  })

  it('폰이 도구 오류를 돌려주면 Claude 쪽에서 오류로 받는다. 모르는 호출 id 는 404', async () => {
    let err = ''
    const run = vi.fn(async (req: { callTool(t: string, a: object, c: string): Promise<unknown> }, emit: (e: Ev) => void) => {
      await req.callTool('propose_change', {}, 'x').catch((e: Error) => { err = e.message })
      emit({ type: 'result', ok: true, text: '', turns: 1, costUsd: 0 })
    })
    const s = await paired(claudeWith(run))
    const { runId } = await call(s, '/claude/run', { prompt: 'q', mode: 'ask' })
    const p = await call(s, '/claude/poll', { runId, cursor: 0 })
    const tc = p.events.find((e: Ev) => e.type === 'toolcall')
    await call(s, '/claude/tool', { runId, id: tc.id, error: 'read-only' })
    await call(s, '/claude/poll', { runId, cursor: p.cursor })
    expect(err).toBe('read-only')
    expect((await post(s.base, '/claude/tool', { runId, id: 'nope', ok: 1 }, s.token)).status).toBe(404)
  })

  it('Claude 를 쓸 수 없으면 503, 이미 실행 중이면 409, 질문이 비면 400', async () => {
    const s = await paired(claudeWith(vi.fn(), { ready: () => false }))
    expect((await post(s.base, '/claude/run', { prompt: 'q' }, s.token)).status).toBe(503)
    await current?.close()
    const s2 = await paired(claudeWith(vi.fn(), { busy: () => true }))
    expect((await post(s2.base, '/claude/run', { prompt: 'q' }, s2.token)).status).toBe(409)
    await current?.close()
    const s3 = await paired()
    expect((await post(s3.base, '/claude/run', { prompt: '  ' }, s3.token)).status).toBe(400)
  })

  it('취소 요청은 Claude 실행을 멈추게 한다', async () => {
    let release: () => void = () => {}
    const run = vi.fn(() => new Promise<void>((r) => { release = r }))
    const cancel = vi.fn(() => { release(); return true })
    const s = await paired(claudeWith(run, { cancel }))
    const { runId } = await call(s, '/claude/run', { prompt: 'q', mode: 'ask' })
    await call(s, '/claude/cancel', { runId })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('긴 대기(폴링): 새 이벤트가 생기면 곧바로 돌려주고, 없으면 시간 뒤에 빈 결과', async () => {
    let emit: (e: Ev) => void = () => {}
    const run = vi.fn((_r: unknown, e: (x: Ev) => void) => new Promise<void>(() => { emit = e }))
    const s = await paired(claudeWith(run))
    const { runId } = await call(s, '/claude/run', { prompt: 'q', mode: 'ask' })
    const t0 = Date.now()
    const empty = await call(s, '/claude/poll', { runId, cursor: 0 })
    expect(empty.events).toEqual([])
    expect(Date.now() - t0).toBeGreaterThanOrEqual(350)
    setTimeout(() => emit({ type: 'text', text: '늦게' }), 60)
    const t1 = Date.now()
    const got = await call(s, '/claude/poll', { runId, cursor: 0 })
    expect(got.events[0]).toMatchObject({ type: 'text', text: '늦게' })
    expect(Date.now() - t1).toBeLessThan(300)
  })
})

describe('설정 보관', () => {
  it('켜짐·포트는 저장되고 다시 불러온다', () => {
    const b = boot()
    b.relay.setEnabled(true)
    const saved = JSON.parse(JSON.stringify(b.saved()))
    expect(saved.enabled).toBe(true)
    const again = createRelay({ store: { read: () => saved, write: () => {} }, getUpstream: () => null, llmRequest: vi.fn(), claude: { ready: () => false, busy: () => false, run: vi.fn(), cancel: vi.fn() } })
    expect(again.state().enabled).toBe(true)
    expect(again.state().port).toBe(47410)
    b.relay.setEnabled(false)
    expect((b.saved() as { enabled: boolean }).enabled).toBe(false)
  })
})

describe('연결 코드는 요청할 때만 만든다 (QR 상시 노출 금지)', () => {
  it('처음엔 코드가 없고, newCode 를 눌러야 생긴다', async () => {
    const b = boot()
    await b.relay.listen(0, '127.0.0.1')
    current = b.relay
    expect(b.relay.codeActive()).toBeNull()
    const c = b.relay.newCode()
    expect(b.relay.codeActive()?.value).toBe(c.value)
  })
  it('revokeCode 이후엔 그 코드로 짝을 맺을 수 없다(403)', async () => {
    const b = boot()
    const port = await b.relay.listen(0, '127.0.0.1')
    current = b.relay
    const code = b.relay.newCode().value as string
    b.relay.revokeCode()
    expect(b.relay.codeActive()).toBeNull()
    expect((await post(`http://127.0.0.1:${port}`, '/pair', { code, name: 'x' })).status).toBe(403)
    expect(b.relay.state().devices).toHaveLength(0)
  })
  it('5분이 지나면 코드가 없어진 것으로 보이고 짝을 맺을 수 없다', async () => {
    let clock = 1_700_000_000_000
    const b = boot({ now: () => clock })
    const port = await b.relay.listen(0, '127.0.0.1')
    current = b.relay
    const code = b.relay.newCode().value as string
    clock += 5 * 60_000 + 1
    expect(b.relay.codeActive()).toBeNull()
    expect((await post(`http://127.0.0.1:${port}`, '/pair', { code, name: 'x' })).status).toBe(403)
  })
  it('짝을 맺으면 코드는 바로 없어진다(한 번만)', async () => {
    const s = await start()
    expect((await post(s.base, '/pair', { code: s.code, name: 'a' })).status).toBe(200)
    expect(s.relay.codeActive()).toBeNull()
  })
})

describe('기기 하나에 연결 링크 하나', () => {
  const pairAs = async (s: { base: string; relay: any }, clientId: string | undefined, name: string) => {
    const code = s.relay.newCode().value as string
    const r = await post(s.base, '/pair', { code, name, clientId })
    return { status: r.status, token: ((await r.json()) as { token?: string }).token }
  }
  it('같은 기기(clientId)가 다시 맺으면 기기 목록에 중복이 없고, 옛 토큰은 바로 무효가 된다', async () => {
    const s = await start()
    const a = await pairAs(s, 'phone-aaaaaaaa', '내 폰')
    const b = await pairAs(s, 'phone-aaaaaaaa', '내 폰')
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(s.relay.state().devices).toHaveLength(1)
    const auth = (t?: string) => fetch(s.base + '/ping', { headers: { authorization: `Bearer ${t}`, Connection: 'close' } }).then((r) => r.status)
    expect(await auth(a.token)).toBe(401)
    expect(await auth(b.token)).toBe(200)
  })
  it('다른 기기는 따로 늘어난다', async () => {
    const s = await start()
    await pairAs(s, 'phone-aaaaaaaa', 'A')
    await pairAs(s, 'phone-bbbbbbbb', 'B')
    expect(s.relay.state().devices).toHaveLength(2)
  })
  it('clientId 가 없거나 형식이 이상하면 새 기기로 취급한다(기존 클라이언트 호환)', async () => {
    const s = await start()
    await pairAs(s, undefined, 'A')
    await pairAs(s, 'x', 'A')
    await pairAs(s, '<script>', 'A')
    expect(s.relay.state().devices).toHaveLength(3)
  })
  it('기기 수가 상한(5)이어도 같은 기기의 재연결은 막히지 않는다', async () => {
    const s = await start()
    for (let i = 0; i < 5; i++) await pairAs(s, `phone-0000000${i}`, 'p' + i)
    expect((await pairAs(s, 'phone-00000009', 'new')).status).toBe(409)
    expect((await pairAs(s, 'phone-00000003', 'p3')).status).toBe(200)
    expect(s.relay.state().devices).toHaveLength(5)
  })
})

describe('AI 여러 개 중계(연결별 경로)', () => {
  type Ups = { id: string; kind: string; baseUrl: string; model: string; keyStored?: boolean; keyId?: string | null }[]
  const A = { id: 'c_aaaa1111', kind: 'ollama', baseUrl: 'http://10.0.0.1:11434', model: 'qwen' }
  const B = { id: 'c_bbbb2222', kind: 'custom', baseUrl: 'http://10.0.0.2:1234/v1', model: 'm-b' }
  const O = { id: 'c_oooo3333', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt', keyStored: true, keyId: 'c_oooo3333' }
  let ups: Ups = []
  const multi = async () => {
    const s = await start({ getUpstream: undefined, getUpstreams: () => ups })
    const r = await post(s.base, '/pair', { code: s.code, name: '내 폰' })
    const j = (await r.json()) as { token: string; upstream: unknown; upstreams: unknown }
    return { ...s, token: j.token, pairRes: j }
  }
  const call = (s: { base: string; token: string }, path: string, body?: unknown) =>
    fetch(s.base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', Connection: 'close' }, body: body ? JSON.stringify(body) : undefined })

  it('짝을 맺을 때와 /ping 에서 빌려주는 AI 목록(키 없이)과 예전 폰용 첫 번째 AI 를 알려 준다', async () => {
    ups = [A, B]
    const s = await multi()
    expect(s.pairRes.upstreams).toEqual([{ id: A.id, kind: 'ollama', model: 'qwen' }, { id: B.id, kind: 'custom', model: 'm-b' }])
    expect(s.pairRes.upstream).toEqual({ kind: 'ollama', model: 'qwen' })
    const ping = (await (await call(s, '/ping')).json()) as { upstreams: unknown[] }
    expect(ping.upstreams).toHaveLength(2)
    expect(JSON.stringify(ping)).not.toMatch(/10\.0\.0|baseUrl|apiKey/) // 주소·키는 폰에 알리지 않는다
  })
  it('/u/<id>/… 는 그 AI 로만 전달한다', async () => {
    ups = [A, B]
    const s = await multi()
    await call(s, `/u/${A.id}/api/chat`, { model: 'qwen' })
    await call(s, `/u/${B.id}/v1/chat/completions`, { model: 'm-b' })
    const urls = s.llmRequest.mock.calls.map((c) => (c[0] as { url: string }).url)
    expect(urls).toEqual(['http://10.0.0.1:11434/api/chat', 'http://10.0.0.2:1234/v1/chat/completions'])
  })
  it('다른 AI 의 종류로는 못 간다(Ollama 경로를 OpenAI 호환 AI 에 보내면 404)', async () => {
    ups = [A, B]
    const s = await multi()
    expect((await call(s, `/u/${B.id}/api/chat`, {})).status).toBe(404)
    expect(s.llmRequest).not.toHaveBeenCalled()
  })
  it('빌려주지 않는 AI·없는 id 는 404, 빌려주는 AI 가 하나도 없으면 503', async () => {
    ups = [A]
    const s = await multi()
    expect((await call(s, `/u/${B.id}/v1/models`)).status).toBe(404)
    expect((await call(s, '/u/../../etc/passwd')).status).toBe(404)
    ups = []
    expect((await call(s, `/u/${A.id}/api/tags`)).status).toBe(503)
    expect(s.llmRequest).not.toHaveBeenCalled()
  })
  it('토글이 바뀌면(목록이 바뀌면) 바로 반영된다 — 끈 AI 는 즉시 막힌다', async () => {
    ups = [A, B]
    const s = await multi()
    expect((await call(s, `/u/${B.id}/v1/models`)).status).toBe(200)
    ups = [A]
    expect((await call(s, `/u/${B.id}/v1/models`)).status).toBe(404)
  })
  it('예전 경로(/api/…, /v1/…)는 첫 번째 AI 로 간다', async () => {
    ups = [B, A]
    const s = await multi()
    await call(s, '/v1/models')
    expect((s.llmRequest.mock.calls[0][0] as { url: string }).url).toBe('http://10.0.0.2:1234/v1/models')
  })
  it('API 키 AI 는 그 연결의 키 자리표시자({{KEY:id}})로만 보낸다', async () => {
    ups = [A, O]
    const s = await multi()
    await call(s, `/u/${O.id}/v1/chat/completions`, { model: 'gpt' })
    const req = s.llmRequest.mock.calls[0][0] as { url: string; headers: Record<string, string> }
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(req.headers.authorization).toBe(`Bearer {{KEY:${O.id}}}`)
  })
})
