// MCP 서버 코어(Electron 에 의존하지 않는다 — 시험하기 쉽게 HTTP·JSON-RPC 만 다룬다).
//
// 외부 AI 에이전트(Claude Code·Codex 등)가 Nosidian 의 노트를 찾고 읽고 "변경안을 제출"하게 하는 통로.
//  - 전송: Streamable HTTP 의 단순형 — POST /mcp 한 개로 JSON-RPC 요청을 받고 JSON 으로 답한다(SSE 없음). stdio 가 필요하면 mcp-stdio.cjs 가 이 서버로 전달한다.
//  - 127.0.0.1 에만 열고, 토큰(Bearer)이 없으면 거절한다. Host 가 로컬 주소가 아니거나 Origin 이 있으면(브라우저 요청) 거절한다(DNS 리바인딩·웹페이지 접근 방지).
//  - 도구 호출은 callTool(이름, 인자, 클라이언트) 로 넘긴다 — 실제 처리(vault 범위 확인·정책 엔진·승인)는 렌더러가 한다. 여기에는 문서를 쓰는 경로가 없다.
const http = require('http')
const crypto = require('crypto')

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 1024 * 1024
const CALL_TIMEOUT_MS = 30_000

/** 도구 정의(이름·설명·입력 형식). 구현은 src/lib/mcpTools.ts 에 같은 이름으로 있다 */
const TOOLS = [
  {
    name: 'search_notes',
    description: 'Search notes in the connected Nosidian vault. Supports plain terms plus tag:, path:, file: filters (e.g. `tag:project path:행사 견적`). Returns path, title, a snippet and a score.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 20)' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'read_note',
    description: 'Read one note. Returns its content and `content_hash`. Keep the hash: modify/delete/move proposals must send it back as `base_hash` so changes made by a person after you read the note are never overwritten.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Note path, e.g. "프로젝트/행사 준비/프로젝트 개요.md"' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'list_projects',
    description: 'List projects (notes with `type: project`) with status, owner, due date, folder and whether document rules apply (and which profile).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_document_rules',
    description: 'Show the document rules and AI write policy of the vault: whether rules are on, `ai_write` / `ai_new_file`, profiles with their roles (official/aux, file names, required headings), allowed statuses and protected paths. Read this before proposing changes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_change',
    description: 'Propose a change to a note. You cannot write directly: every change goes through the vault policy. The outcome is `applied` (policy allowed it), `pending_approval` (a person must approve it in Nosidian — poll get_proposal_status) or `denied` (see `reason`). Actions: create (path, content), modify (path, content = the FULL new text, base_hash), delete (path, base_hash; moves the note to _보관/), move (path, to, base_hash; also renames).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'modify', 'delete', 'move'] },
        path: { type: 'string' },
        to: { type: 'string', description: 'move only: the new path' },
        content: { type: 'string', description: 'create/modify: full text of the note' },
        base_hash: { type: 'string', description: 'modify/delete/move: the content_hash returned by read_note' },
        summary: { type: 'string', description: 'One line explaining the change to the reviewer' },
      },
      required: ['action', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_proposal_status',
    description: 'Check a proposal made with propose_change: pending, applied, rejected (by the person) or failed (the note changed meanwhile or the rules no longer allow it).',
    inputSchema: { type: 'object', properties: { proposal_id: { type: 'string' } }, required: ['proposal_id'], additionalProperties: false },
  },
]

const INSTRUCTIONS =
  'Nosidian is a Markdown notes/projects app. This server exposes one vault chosen by the user. Read with search_notes/read_note, check get_document_rules, and change notes ONLY with propose_change (a person may need to approve). Never assume a change was applied until the outcome says so.'

function tokenOk(header, token) {
  if (typeof header !== 'string' || !token) return false
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!m) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(token)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } })

/**
 * @param {{ token: string, version: string, callTool: (tool: string, args: object, client: string) => Promise<unknown>, timeoutMs?: number }} opts
 */
function createMcpServer(opts) {
  const sessions = new Map() // 세션 id → 클라이언트 이름 (제안자 표시용)
  let server = null
  let port = 0

  async function handle(msg, session) {
    const { id, method, params } = msg
    const isNote = id === undefined
    if (typeof method !== 'string') return isNote ? null : rpcError(id, -32600, 'Invalid Request')
    if (isNote) return null // notifications/initialized 등: 답하지 않는다
    switch (method) {
      case 'initialize': {
        const asked = params && params.protocolVersion
        const protocolVersion = PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0]
        const name = params && params.clientInfo && typeof params.clientInfo.name === 'string' ? params.clientInfo.name.slice(0, 60) : 'MCP client'
        return { jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nosidian', version: opts.version }, instructions: INSTRUCTIONS }, _client: name }
      }
      case 'ping': return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
      case 'tools/call': {
        const name = params && params.name
        if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${String(name)}`)
        const args = params && typeof params.arguments === 'object' && params.arguments ? params.arguments : {}
        try {
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Nosidian did not answer in time')), opts.timeoutMs || CALL_TIMEOUT_MS).unref?.())
          const out = await Promise.race([opts.callTool(name, args, session || ''), timeout])
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } }
        } catch (e) {
          return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] } }
        }
      }
      default: return rpcError(id, -32601, `Method not found: ${method}`)
    }
  }

  function onRequest(req, res) {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
      res.end(body === undefined ? '' : JSON.stringify(body))
    }
    // 브라우저(웹페이지)가 보낸 요청과 로컬 주소가 아닌 Host(DNS 리바인딩)는 거절한다
    if (req.headers.origin) return send(403, { error: 'Origin not allowed' })
    const host = String(req.headers.host || '')
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(403, { error: 'Host not allowed' })
    if (!tokenOk(req.headers.authorization, opts.token)) return send(401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' })
    if (req.url.split('?')[0] !== '/mcp') return send(404, { error: 'Not found' })
    if (req.method !== 'POST') return send(405, { error: 'Use POST' }, { Allow: 'POST' })

    const chunks = []
    let size = 0
    let dead = false
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        dead = true
        send(413, { error: 'Request too large' })
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', async () => {
      if (dead) return
      let msg
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, rpcError(null, -32700, 'Parse error'))
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send(400, rpcError(null, -32600, 'Invalid Request'))
      const sid = req.headers['mcp-session-id']
      const session = typeof sid === 'string' ? sessions.get(sid) : undefined
      const out = await handle(msg, session)
      if (out === null) return send(202)
      const extra = {}
      if (out._client) {
        const id = crypto.randomUUID()
        sessions.set(id, out._client)
        if (sessions.size > 50) sessions.delete(sessions.keys().next().value)
        extra['Mcp-Session-Id'] = id
        delete out._client
      }
      send(200, out, extra)
    })
  }

  return {
    /** 127.0.0.1:port 에 연다(port 0 이면 빈 포트). 실제 포트를 돌려준다 */
    listen(wantPort) {
      return new Promise((resolve, reject) => {
        server = http.createServer(onRequest)
        server.once('error', reject)
        server.listen(wantPort, '127.0.0.1', () => {
          port = server.address().port
          server.removeListener('error', reject)
          resolve(port)
        })
      })
    },
    close() {
      return new Promise((resolve) => {
        if (!server) return resolve()
        server.close(() => resolve())
        server.closeAllConnections?.()
        server = null
        sessions.clear()
      })
    },
    get port() {
      return port
    },
  }
}

module.exports = { createMcpServer, TOOLS, tokenOk, PROTOCOLS }
