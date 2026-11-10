import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mcp from '../../electron/mcp.cjs'

const { createMcpServer, TOOLS, tokenOk } = mcp as {
  createMcpServer(o: { token: string; version: string; callTool: (t: string, a: object, c: string) => Promise<unknown>; timeoutMs?: number }): { listen(p: number): Promise<number>; close(): Promise<void> }
  TOOLS: { name: string; inputSchema: { type: string } }[]
  tokenOk(h: unknown, t: string): boolean
}

const TOKEN = 'a'.repeat(48)
let current: { close(): Promise<void> } | null = null
afterEach(async () => {
  await current?.close()
  current = null
})

async function boot(callTool: (t: string, a: object, c: string) => Promise<unknown> = async () => ({ ok: true }), timeoutMs?: number) {
  const s = createMcpServer({ token: TOKEN, version: '9.9.9', callTool, timeoutMs })
  const port = await s.listen(0)
  current = s
  const url = `http://127.0.0.1:${port}/mcp`
  // 서버를 매번 열고 닫는데 OS 가 같은 포트 번호를 다시 줄 수 있다 — fetch 의 연결 풀이 이미 닫힌 서버로 가는 연결을 재사용하지 않게 매 요청 연결을 닫는다
  const post = (body: unknown, headers: Record<string, string> = {}, raw = false) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Connection: 'close', ...headers }, body: raw ? (body as string) : JSON.stringify(body) })
  return { port, url, post }
}
const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })
/** 알림: id 가 없는 JSON-RPC 메시지 */
const notice = (method: string) => ({ jsonrpc: '2.0', method })

describe('MCP 서버: 접근 통제', () => {
  it('토큰이 없거나 틀리면 401, 맞으면 통과', async () => {
    const { url, post } = await boot()
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await post(rpc('ping'), { Authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await post(rpc('ping'), { Authorization: TOKEN })).status).toBe(401) // Bearer 형식이 아님
    expect((await post(rpc('ping'))).status).toBe(200)
  })
  it('Origin 이 있는 요청(브라우저)은 토큰이 맞아도 거절', async () => {
    const { post } = await boot()
    expect((await post(rpc('ping'), { Origin: 'http://evil.example' })).status).toBe(403)
  })
  it('Host 가 로컬 주소가 아니면 거절(DNS 리바인딩)', async () => {
    const { port } = await boot()
    // fetch 는 Host 를 못 바꾸므로 raw 소켓으로 보낸다
    const net: any = await import('node:net')
    const status = await new Promise<string>((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => sock.write(`POST /mcp HTTP/1.1\r\nHost: evil.example\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`))
      let buf = ''
      sock.on('data', (d: unknown) => (buf += String(d)))
      sock.on('end', () => resolve(buf.split('\r\n')[0]))
    })
    expect(status).toContain('403')
  })
  it('POST /mcp 외에는 거절: 다른 경로 404, GET 405', async () => {
    const { port, url } = await boot()
    const auth = { Authorization: `Bearer ${TOKEN}` }
    expect((await fetch(`http://127.0.0.1:${port}/other`, { method: 'POST', headers: auth })).status).toBe(404)
    expect((await fetch(url, { method: 'GET', headers: auth })).status).toBe(405)
    expect((await fetch(url, { method: 'DELETE', headers: auth })).status).toBe(405)
  })
  it('127.0.0.1 에만 열린다', async () => {
    const { port } = await boot()
    const net: any = await import('node:net')
    const reach = (host: string) => new Promise<boolean>((resolve) => { const s = net.connect(port, host); s.on('connect', () => { s.destroy(); resolve(true) }); s.on('error', () => resolve(false)) })
    expect(await reach('127.0.0.1')).toBe(true)
  })
  it('본문이 너무 크면 413, 깨진 JSON 은 400', async () => {
    const { post } = await boot()
    expect((await post('{깨짐', {}, true)).status).toBe(400)
    expect((await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(1_100_000) }), {}, true).catch(() => ({ status: 413 }))).status).toBe(413)
  })
  it('토큰 비교 함수', () => {
    expect(tokenOk('Bearer ' + TOKEN, TOKEN)).toBe(true)
    expect(tokenOk('bearer ' + TOKEN, TOKEN)).toBe(true)
    expect(tokenOk('Bearer ' + TOKEN.slice(1), TOKEN)).toBe(false)
    expect(tokenOk(undefined, TOKEN)).toBe(false)
    expect(tokenOk('Bearer x', '')).toBe(false)
  })
})

describe('MCP 서버: 비정상 클라이언트', () => {
  it('본문을 보내다가 연결을 끊어도 서버는 죽지 않고(처리되지 않은 오류 없음) 다음 요청을 받는다', async () => {
    const { port, post } = await boot()
    const net: any = await import('node:net')
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) => {
        const sock = net.connect(port, '127.0.0.1', () => {
          sock.write(`POST /mcp HTTP/1.1

Host: 127.0.0.1:${port}

Authorization: Bearer ${TOKEN}

Content-Type: application/json

Content-Length: 100000



{"jsonrpc":"2.0"`)
          setTimeout(() => { sock.destroy(); resolve() }, 20) // 본문 중간에 끊는다
        })
        sock.on('error', () => resolve())
      })
    }
    await new Promise((r) => setTimeout(r, 100)) // 서버가 끊김을 처리할 시간
    expect((await post(rpc('ping'))).status).toBe(200)
  })
})

describe('MCP 서버: 프로토콜', () => {
  it('initialize: 프로토콜 협상·서버 정보·세션 id', async () => {
    const { post } = await boot()
    const res = await post(rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } }))
    const body = await res.json()
    expect(body.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nosidian', version: '9.9.9' } })
    expect(res.headers.get('mcp-session-id')).toBeTruthy()
    const odd = await (await post(rpc('initialize', { protocolVersion: '1999-01-01', clientInfo: { name: 'x' } }))).json()
    expect(odd.result.protocolVersion).toBe('2025-06-18')
  })
  it('알림(id 없음)에는 본문 없이 202', async () => {
    const { post } = await boot()
    const res = await post(notice('notifications/initialized'))
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })
  it('tools/list: 7개 도구, 입력 형식 포함, 구현(mcpTools)과 이름이 같다', async () => {
    const { post } = await boot()
    const body = await (await post(rpc('tools/list'))).json()
    const names = body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['search_notes', 'read_note', 'list_projects', 'get_document_rules', 'propose_change', 'propose_file', 'get_proposal_status'])
    expect(body.result.tools.every((t: { inputSchema: { type: string } }) => t.inputSchema.type === 'object')).toBe(true)
    expect(TOOLS).toHaveLength(7)
  })
  it('쓰기 도구가 없다: propose_change 외에 노트를 바꾸는 이름이 없다', () => {
    expect(TOOLS.map((t) => t.name).filter((n) => /write|update|delete|create|edit|save|set_/i.test(n))).toEqual([])
  })
  it('tools/call: 호출을 넘기고 결과를 text 로 돌려준다(제안자 이름 전달)', async () => {
    const calls: unknown[] = []
    const { post } = await boot(async (tool, args, client) => { calls.push({ tool, args, client }); return { hello: '세상' } })
    const init = await post(rpc('initialize', { clientInfo: { name: 'codex' } }))
    const sid = init.headers.get('mcp-session-id')!
    const body = await (await post(rpc('tools/call', { name: 'search_notes', arguments: { query: 'a' } }), { 'Mcp-Session-Id': sid })).json()
    expect(JSON.parse(body.result.content[0].text)).toEqual({ hello: '세상' })
    expect(body.result.isError).toBeUndefined()
    expect(calls).toEqual([{ tool: 'search_notes', args: { query: 'a' }, client: 'codex' }])
  })
  it('도구 오류는 isError 결과, 모르는 도구·메서드는 JSON-RPC 오류', async () => {
    const { post } = await boot(async () => { throw new Error('노트가 없어요') })
    const err = await (await post(rpc('tools/call', { name: 'read_note', arguments: {} }))).json()
    expect(err.result).toMatchObject({ isError: true, content: [{ type: 'text', text: '노트가 없어요' }] })
    expect((await (await post(rpc('tools/call', { name: 'delete_everything' }))).json()).error.code).toBe(-32602)
    expect((await (await post(rpc('nope'))).json()).error.code).toBe(-32601)
  })
  it('응답이 오래 걸리면 시간 초과 오류', async () => {
    const { post } = await boot(() => new Promise(() => {}), 80)
    const body = await (await post(rpc('tools/call', { name: 'list_projects' }))).json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/in time/)
  })
  it('ping', async () => {
    const { post } = await boot()
    expect((await (await post(rpc('ping'))).json()).result).toEqual({})
  })
})
