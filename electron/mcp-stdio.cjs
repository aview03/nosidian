#!/usr/bin/env node
// stdio ↔ Nosidian MCP(HTTP) 중계. stdio 만 지원하는 MCP 클라이언트(예: Codex)용.
// 쓰기: NOSIDIAN_MCP_URL(예: http://127.0.0.1:47322/mcp) 과 NOSIDIAN_MCP_TOKEN 을 환경 변수로 주고 `node mcp-stdio.cjs` 를 MCP 서버로 등록한다.
// 한 줄에 JSON-RPC 메시지 하나(표준 stdio 전송). 이 파일은 데이터를 보관하거나 해석하지 않고 그대로 전달만 한다.
const readline = require('readline')

const url = process.env.NOSIDIAN_MCP_URL || 'http://127.0.0.1:47322/mcp'
const token = process.env.NOSIDIAN_MCP_TOKEN || ''
let session = ''

async function forward(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`, ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify(msg),
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) session = sid
    if (res.status === 202) return
    const text = await res.text()
    if (msg.id !== undefined) {
      let out
      try {
        out = JSON.parse(text)
      } catch {
        out = null
      }
      if (!out || (res.status >= 400 && !out.jsonrpc)) out = { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Nosidian MCP: HTTP ${res.status}${res.status === 401 ? ' (check NOSIDIAN_MCP_TOKEN)' : ''}` } }
      process.stdout.write(JSON.stringify(out) + '\n')
    }
  } catch {
    if (msg.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Cannot reach Nosidian. Is the app running with the MCP server turned on?' } }) + '\n')
  }
}

readline.createInterface({ input: process.stdin }).on('line', (l) => void forward(l))
