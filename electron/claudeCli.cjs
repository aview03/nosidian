// 앱 안 AI: PC 에 설치된 Claude Code CLI(`claude`)를 별도 프로세스로 띄워 쓴다. API 키 없이 로그인된 Claude 계정으로 동작한다.
//
// Nosidian 이 하는 일은 "임시 MCP 연결 정보를 주고 claude -p 를 실행해 결과를 받는 것"뿐이다.
// CLI 는 아래 고정된 안전 옵션으로만 실행한다(buildArgs):
//  - --tools ""            : 내장 도구(파일 읽기·쓰기·셸 등)를 전부 끈다. 이 프로세스는 PC 파일에 닿을 수 없다.
//  - --strict-mcp-config   : 사용자의 개인 MCP 설정은 무시하고, 우리가 준 임시 설정(Nosidian 하나)만 쓴다.
//  - --allowedTools        : Nosidian MCP 도구 6개만 허용한다. 노트를 직접 쓰는 도구는 없고, 변경은 propose_change → 정책 엔진 → 사람 승인을 거친다.
//  - --setting-sources project + 빈 임시 작업 폴더 : 사용자 설정(훅·권한 규칙·CLAUDE.md)의 영향을 받지 않는다.
//  - --no-session-persistence : 대화 기록을 디스크에 남기지 않는다.
// MCP 서버는 실행 한 번 동안만 열리는 임시 서버(무작위 포트·토큰)이고, 지금 열려 있는 vault 하나에만 닿는다.
// 사용자가 요청할 때만 실행한다(수동 모드). 한 번에 한 개만 돈다.
const fs = require('fs')
const os = require('os')
const path = require('path')

const TOOL_NAMES = ['search_notes', 'read_note', 'list_projects', 'get_document_rules', 'propose_change', 'propose_file', 'get_proposal_status']
const ALLOWED_TOOLS = TOOL_NAMES.map((n) => `mcp__nosidian__${n}`)
/** 묻기(읽기 전용) 모드: 변경을 낼 수 있는 도구(propose_change)와 제안 조회는 허용하지 않는다 */
const READ_TOOLS = ALLOWED_TOOLS.filter((n) => !/propose_change|propose_file|get_proposal_status/.test(n))
const TIMEOUT_MS = 240_000
const MAX_RESULT = 200_000
const MAX_STDERR = 20_000
const GRACE_MS = 3000

/** 모델에게 주는 규칙(시스템 프롬프트에 덧붙인다) */
const SYSTEM_PROMPT =
  'You are the assistant built into Nosidian, a Markdown notes and projects app. Use ONLY the Nosidian MCP tools ' +
  '(search_notes, read_note, list_projects, get_document_rules, propose_change, propose_file, get_proposal_status); you have no other tools. ' +
  'You cannot edit notes directly: every change must go through propose_change, and a person may have to approve it. ' +
  'Never say a change was applied unless propose_change returned outcome "applied"; if it returned "pending_approval", say the person must approve it in Nosidian. ' +
  'Before changing a note, read it with read_note, send its content_hash as base_hash, and send the complete new text as content. ' +
  'Check get_document_rules when a change is denied or before creating notes. ' +
  'When you write text the user will copy and use elsewhere (a message, an email, a draft, a spec, a template, code), put exactly that text in a fenced code block (use ```text for prose) and keep your explanation outside the block. ' +
  'Answer in the language of the user\'s question (Korean by default), concisely and concretely, and mention note paths you relied on.'

/** PATH 에서 claude 실행 파일을 찾는다. 네이티브 설치(.exe)만 지원한다 */
function findClaude({ env = process.env, platform = process.platform, exists = fs.existsSync, homedir = os.homedir() } = {}) {
  const exts = platform === 'win32' ? ['.exe'] : ['']
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  dirs.push(path.join(homedir, '.local', 'bin')) // 네이티브 설치기의 기본 위치
  for (const d of dirs) for (const e of exts) {
    const p = path.join(d, 'claude' + e)
    if (exists(p)) return { path: p }
  }
  // npm 으로 설치하면 claude.cmd 만 있다 — 지원하지 않는다(안내 문구용)
  if (platform === 'win32' && dirs.some((d) => exists(path.join(d, 'claude.cmd')))) return { path: null, onlyCmd: true }
  return { path: null }
}

/** 고정된 실행 인자. 사용자 입력은 여기에 들어가지 않는다(프롬프트는 stdin 으로 보낸다) */
function buildArgs({ mcpConfigPath, model, readOnly }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--tools', '',
    '--allowedTools', ...(readOnly ? READ_TOOLS : ALLOWED_TOOLS),
    '--setting-sources', 'project',
    '--no-session-persistence',
    '--append-system-prompt', SYSTEM_PROMPT,
  ]
  if (typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(model)) args.push('--model', model)
  return args
}

const mcpConfig = ({ url, token }) => ({ mcpServers: { nosidian: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } })

const shortTool = (n) => String(n || '').replace(/^mcp__nosidian__/, '')

/** stream-json 한 줄 → 화면에 보낼 이벤트들(없으면 빈 배열) */
function parseStreamLine(line) {
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return []
  }
  if (!o || typeof o !== 'object') return []
  if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
    const out = []
    for (const c of o.message.content) {
      if (c && c.type === 'tool_use') out.push({ type: 'tool', name: shortTool(c.name), input: summarize(c.input) })
      else if (c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) out.push({ type: 'text', text: c.text })
    }
    return out
  }
  if (o.type === 'result') {
    return [{ type: 'result', ok: o.is_error !== true && o.subtype === 'success', text: String(o.result || '').slice(0, MAX_RESULT), turns: Number(o.num_turns) || 0, costUsd: Number(o.total_cost_usd) || 0 }]
  }
  return []
}

/** 도구 입력을 한 줄로(진행 표시용). 긴 본문(content)은 싣지 않는다 */
function summarize(input) {
  if (!input || typeof input !== 'object') return ''
  const pick = input.query ?? input.path ?? input.proposal_id ?? input.to ?? ''
  const action = input.action ? `${input.action} ` : ''
  return `${action}${String(pick)}`.slice(0, 120)
}

/**
 * 실행기. 바깥 의존(프로세스 띄우기·임시 MCP 서버·프로세스 종료)은 주입한다 — 시험하기 쉽게.
 * deps: { spawn, execFile, startMcp, killTree, findClaude?, fsImpl?, tmpdir? }
 *  - startMcp(): Promise<{ url, token, close(): Promise<void> }>  (이번 실행 동안만 열리는 임시 MCP 서버)
 */
function createRunner(deps) {
  const fsx = deps.fsImpl || fs
  const find = deps.findClaude || findClaude
  let active = null // { child, cancelled }
  let ready = false // 마지막 확인에서 설치·로그인이 되어 있었나(휴대폰 중계가 쓸 수 있는지 알려 주는 용도)

  async function detect() {
    const f = find()
    if (!f.path) return { found: false, onlyCmd: !!f.onlyCmd }
    const out = (args, ms) => new Promise((resolve) => deps.execFile(f.path, args, { timeout: ms, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout))))
    const version = ((await out(['--version'], 15_000)) || '').trim().replace(/\s*\(Claude Code\)\s*$/i, '') || null
    let loggedIn = false
    let authMethod = null
    const st = await out(['auth', 'status'], 15_000)
    if (st) {
      try {
        const j = JSON.parse(st)
        loggedIn = j.loggedIn === true
        authMethod = typeof j.authMethod === 'string' ? j.authMethod : null
      } catch {
        /* 형식이 다르면 로그인 여부를 모르는 것으로 */
      }
    }
    return { found: true, path: f.path, version, loggedIn, authMethod }
  }

  /** 한 번 실행한다. onEvent 로 진행(tool·text)과 끝(result·error)을 알린다. 끝나면 임시 파일·서버를 정리한다 */
  async function refreshReady() {
    const d = await detect()
    ready = !!(d.found && d.loggedIn)
    return ready
  }

  async function run({ prompt, model, mode, forceApproval, callTool }, onEvent) {
    if (active) return onEvent({ type: 'error', code: 'busy', message: '이미 AI 가 실행 중이에요' })
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20_000) return onEvent({ type: 'error', code: 'badPrompt', message: '질문이 비었거나 너무 길어요' })
    const f = find()
    if (!f.path) return onEvent({ type: 'error', code: 'notFound', message: 'Claude Code CLI 를 찾을 수 없어요' })
    const state = { child: null, cancelled: false }
    active = state
    // 끝을 알리는 이벤트(result·error)는 정리(프로세스 종료·임시 서버·폴더)가 끝난 뒤에 보낸다 — 화면이 "끝남"을 받았을 때는 이미 다시 실행할 수 있는 상태여야 한다
    const final = []
    const out = (ev) => (ev.type === 'result' || ev.type === 'error' ? final.push(ev) : onEvent(ev))
    let dir = null
    let mcp = null
    try {
      dir = fsx.mkdtempSync(path.join(deps.tmpdir || os.tmpdir(), 'nosidian-claude-'))
      const readOnly = mode === 'ask'
      mcp = await deps.startMcp({ readOnly, forceApproval: forceApproval === true, callTool }) // callTool: 도구 호출을 대신 처리할 곳(휴대폰 중계). 없으면 이 PC 의 창
      const cfgPath = path.join(dir, 'mcp.json')
      fsx.writeFileSync(cfgPath, JSON.stringify(mcpConfig(mcp)), { mode: 0o600 })
      const child = deps.spawn(f.path, buildArgs({ mcpConfigPath: cfgPath, model, readOnly }), { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      state.child = child
      let sawResult = false
      let grace = null
      let stderr = ''
      let buf = ''
      const take = (line) => {
        for (const ev of parseStreamLine(line)) {
          if (ev.type === 'result' && !sawResult) {
            sawResult = true
            // 결과를 낸 뒤에도 프로세스가 안 끝나면 잠깐 기다렸다가 끝낸다
            grace = setTimeout(() => deps.killTree(child), deps.graceMs || GRACE_MS)
          }
          out(ev)
        }
      }
      const feed = (chunk) => {
        buf += chunk
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (line) take(line)
        }
      }
      child.stdout.on('data', (d) => feed(String(d)))
      child.stderr.on('data', (d) => {
        if (stderr.length < MAX_STDERR) stderr += String(d)
      })
      child.stdin.on('error', () => {})
      child.stdin.end(prompt) // 프롬프트는 인자가 아니라 stdin 으로(길이·이스케이프 문제를 피한다)
      const timer = setTimeout(() => {
        state.timedOut = true
        deps.killTree(child)
      }, deps.timeoutMs || TIMEOUT_MS)
      const code = await new Promise((resolve) => {
        child.on('error', (e) => resolve({ spawnError: e }))
        child.on('close', (c) => resolve(c))
      })
      clearTimeout(timer)
      if (grace) clearTimeout(grace)
      if (buf.trim()) take(buf.trim())
      if (sawResult) return
      if (state.cancelled) return out({ type: 'error', code: 'cancelled', message: '취소했어요' })
      if (state.timedOut) return out({ type: 'error', code: 'timeout', message: 'AI 가 너무 오래 걸려서 멈췄어요' })
      if (code && code.spawnError) return out({ type: 'error', code: 'spawn', message: 'Claude Code CLI 를 실행하지 못했어요' })
      const tail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300)
      const login = /log ?in|auth|unauthori[sz]ed|credential/i.test(stderr)
      out({ type: 'error', code: login ? 'login' : 'exit', message: login ? 'Claude 에 로그인되어 있지 않아요. 터미널에서 claude auth login 을 실행해 주세요' : `Claude Code CLI 가 비정상 종료했어요${tail ? ` (${tail})` : ''}` })
    } catch (e) {
      out({ type: 'error', code: 'internal', message: e instanceof Error ? e.message : String(e) })
    } finally {
      try {
        if (mcp) await mcp.close()
      } catch {
        /* 이미 닫힘 */
      }
      try {
        if (dir) fsx.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* 임시 폴더 정리 실패는 무시 */
      }
      active = null
      for (const ev of final) onEvent(ev)
    }
  }

  function cancel() {
    if (!active) return false
    active.cancelled = true
    if (active.child) deps.killTree(active.child)
    return true
  }

  return { detect, run, cancel, isRunning: () => !!active, isReady: () => ready, refreshReady }
}

/** Windows 는 자식의 자식까지 함께 끝낸다(taskkill /T), 그 밖에는 kill */
function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) require('child_process').spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    else child.kill('SIGKILL')
  } catch {
    /* 이미 끝남 */
  }
}

/** Electron 호스트: IPC 연결. startInternalMcp 는 mcpHost 가 준다 */
function register({ ipcMain, getWindow, startMcp }) {
  const cp = require('child_process')
  const runner = createRunner({ spawn: cp.spawn, execFile: cp.execFile, startMcp, killTree })
  ipcMain.handle('claude:detect', () => runner.detect())
  ipcMain.handle('claude:run', (e, req) => {
    const send = (ev) => {
      const w = getWindow()
      if (w && !w.isDestroyed()) w.webContents.send('claude:event', ev)
    }
    void runner.run({ prompt: req && req.prompt, model: req && req.model, mode: req && req.mode === 'ask' ? 'ask' : 'edit', forceApproval: !!(req && req.forceApproval) }, send) // 진행·결과·오류는 모두 claude:event 로 간다
    return { ok: true }
  })
  ipcMain.handle('claude:cancel', () => runner.cancel())
  return runner
}

module.exports = { register, createRunner, findClaude, buildArgs, parseStreamLine, mcpConfig, killTree, ALLOWED_TOOLS, READ_TOOLS, SYSTEM_PROMPT, TOOL_NAMES, summarize }
