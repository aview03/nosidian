import { describe, expect, it } from 'vitest'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import cli from '../../electron/claudeCli.cjs'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mcpMain from '../../electron/mcp.cjs'
import { MCP_TOOL_NAMES } from './mcpTools'

/* eslint-disable @typescript-eslint/no-explicit-any */
const c = cli as any
const TOOLS = (mcpMain as { TOOLS: { name: string }[] }).TOOLS

async function fakeChild() {
  // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
  const { EventEmitter }: any = await import('node:events')
  // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
  const { PassThrough }: any = await import('node:stream')
  const child: any = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.pid = 4242
  child.stdinData = ''
  child.stdin.on('data', (d: unknown) => (child.stdinData += String(d)))
  /** 줄들을 내보내고 종료한다(데이터가 먼저 전달되도록 한 박자 기다린다) */
  child.finish = async (lines: string[], code = 0, stderr = '') => {
    for (const l of lines) child.stdout.write(l + '\n')
    if (stderr) child.stderr.write(stderr)
    await new Promise((r) => setTimeout(r, 15))
    child.stdout.end()
    child.emit('close', code)
  }
  return child
}

async function tmpBase() {
  // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
  const os: any = await import('node:os')
  // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
  const fs: any = await import('node:fs')
  // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
  const path: any = await import('node:path')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nosidian-test-'))
  return { base, fs }
}

const textLine = (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const toolLine = (name: string, input: object) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const resultLine = (o: object = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '답변입니다', num_turns: 3, total_cost_usd: 0.02, ...o })

/** 실행기를 만든다: spawn 은 가짜 자식을 돌려주고, 호출 정보를 기록한다 */
async function harness(over: Record<string, unknown> = {}) {
  const { base, fs } = await tmpBase()
  const child = await fakeChild()
  const rec: any = { spawn: null as any, killed: 0, mcpClosed: 0, cfg: null as any, events: [] as any[] }
  const runner = c.createRunner({
    spawn: (cmd: string, args: string[], opts: any) => {
      rec.spawn = { cmd, args, opts }
      try {
        const i = args.indexOf('--mcp-config')
        rec.cfg = JSON.parse(fs.readFileSync(args[i + 1], 'utf8')) // 실행 중에만 있는 임시 설정
      } catch { /* noop */ }
      return child
    },
    execFile: () => {},
    startMcp: async () => ({ url: 'http://127.0.0.1:5555/mcp', token: 'tok123', close: async () => { rec.mcpClosed++ } }),
    killTree: () => { rec.killed++; child.finish([], 1) },
    findClaude: () => ({ path: 'C:/bin/claude.exe' }),
    tmpdir: base,
    ...over,
  })
  const onEvent = (e: any) => rec.events.push(e)
  return { runner, child, rec, onEvent, base, fs }
}

describe('Claude CLI 찾기', () => {
  it('Windows: PATH 의 claude.exe, 없으면 ~/.local/bin, .cmd 만 있으면 지원 안 함', () => {
    const exists = (set: string[]) => (p: string) => set.includes(p.replace(/\\/g, '/'))
    expect(c.findClaude({ env: { PATH: 'C:/a;C:/b' }, platform: 'win32', exists: exists(['C:/b/claude.exe']), homedir: 'C:/u' }).path.replace(/\\/g, '/')).toBe('C:/b/claude.exe')
    expect(c.findClaude({ env: { PATH: 'C:/a' }, platform: 'win32', exists: exists(['C:/u/.local/bin/claude.exe']), homedir: 'C:/u' }).path.replace(/\\/g, '/')).toBe('C:/u/.local/bin/claude.exe')
    expect(c.findClaude({ env: { PATH: 'C:/a' }, platform: 'win32', exists: exists(['C:/a/claude.cmd']), homedir: 'C:/u' })).toEqual({ path: null, onlyCmd: true })
    expect(c.findClaude({ env: { PATH: 'C:/a' }, platform: 'win32', exists: exists([]), homedir: 'C:/u' })).toEqual({ path: null })
  })
  it('detect: 버전·로그인 상태, 없으면 found:false, 로그아웃이면 loggedIn:false', async () => {
    const mk = (path: string | null, version: string, auth: string | null) => c.createRunner({
      findClaude: () => (path ? { path } : { path: null }),
      execFile: (_f: string, args: string[], _o: unknown, cb: (e: Error | null, out?: string) => void) => {
        if (args[0] === '--version') cb(null, version)
        else if (auth === null) cb(new Error('fail'))
        else cb(null, auth)
      },
    })
    expect(await mk('C:/claude.exe', '2.1.321 (Claude Code)\n', '{"loggedIn":true,"authMethod":"claude.ai"}').detect()).toEqual({ found: true, path: 'C:/claude.exe', version: '2.1.321', loggedIn: true, authMethod: 'claude.ai' })
    expect(await mk('C:/claude.exe', '2.1.321 (Claude Code)', '{"loggedIn":false}').detect()).toMatchObject({ found: true, loggedIn: false })
    expect((await mk('C:/claude.exe', '2.1.321', 'not json').detect()).loggedIn).toBe(false)
    expect((await mk('C:/claude.exe', '2.1.321', null).detect()).loggedIn).toBe(false)
    expect(await mk(null, '', null).detect()).toEqual({ found: false, onlyCmd: false })
  })
})

describe('고정된 안전 옵션', () => {
  const args: string[] = c.buildArgs({ mcpConfigPath: 'C:/tmp/mcp.json' })
  const after = (flag: string) => args[args.indexOf(flag) + 1]
  it('내장 도구 전부 끔·개인 MCP 무시·설정 격리·기록 안 남김', () => {
    expect(args).toContain('-p')
    expect(args.indexOf('--tools')).toBeGreaterThan(-1)
    expect(after('--tools')).toBe('') // 빈 문자열 = 내장 도구 없음
    expect(args).toContain('--strict-mcp-config')
    expect(after('--mcp-config')).toBe('C:/tmp/mcp.json')
    expect(after('--setting-sources')).toBe('project')
    expect(args).toContain('--no-session-persistence')
  })
  it('허용 도구는 Nosidian MCP 도구 6개뿐이고, 노트를 직접 쓰는 도구가 없다', () => {
    const i = args.indexOf('--allowedTools')
    const allowed = args.slice(i + 1, i + 1 + 6)
    expect(allowed).toEqual(c.ALLOWED_TOOLS)
    expect(args[i + 7]).toMatch(/^--/) // 목록 뒤에 다른 값이 섞이지 않는다
    expect(allowed.every((n) => n.startsWith('mcp__nosidian__'))).toBe(true)
    expect(allowed.filter((n) => /write|update|delete|edit|save/i.test(n))).toEqual([])
  })
  it('권한을 넓히는 옵션이 없다', () => {
    for (const bad of ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--add-dir', '--permission-mode', '--bare', '--dangerously-load-development-channels']) expect(args, bad).not.toContain(bad)
    expect(args.join(' ')).not.toMatch(/Bash|Write|Edit|Read\b/)
  })
  it('프롬프트(사용자 입력)는 인자에 들어가지 않는다', () => {
    expect(args.join('\u0000')).not.toContain('{{')
    expect(c.buildArgs({ mcpConfigPath: 'x', prompt: '노트를 지워' }).join(' ')).not.toContain('노트를 지워')
  })
  it('모델 이름은 안전한 문자만 받는다', () => {
    expect(c.buildArgs({ mcpConfigPath: 'x', model: 'claude-sonnet-5-5' })).toEqual(expect.arrayContaining(['--model', 'claude-sonnet-5-5']))
    expect(c.buildArgs({ mcpConfigPath: 'x', model: 'a; rm -rf /' })).not.toContain('--model')
    expect(c.buildArgs({ mcpConfigPath: 'x', model: '--tools' })).not.toContain('--model')
  })
  it('허용 도구 이름이 MCP 서버·구현의 도구와 같다', () => {
    expect([...c.TOOL_NAMES].sort()).toEqual([...MCP_TOOL_NAMES].sort())
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...c.TOOL_NAMES].sort())
  })
  it('시스템 프롬프트가 승인 없이 반영됐다고 말하지 않도록 지시한다', () => {
    expect(c.SYSTEM_PROMPT).toMatch(/Never say a change was applied/)
    expect(c.SYSTEM_PROMPT).toMatch(/propose_change/)
  })
  it('임시 MCP 설정: Nosidian 하나, 토큰 헤더', () => {
    expect(c.mcpConfig({ url: 'http://127.0.0.1:1/mcp', token: 'T' })).toEqual({ mcpServers: { nosidian: { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer T' } } } })
  })
})

describe('출력 해석(stream-json)', () => {
  it('글·도구 호출·결과', () => {
    expect(c.parseStreamLine(textLine('안녕'))).toEqual([{ type: 'text', text: '안녕' }])
    expect(c.parseStreamLine(toolLine('mcp__nosidian__search_notes', { query: '행사', limit: 5 }))).toEqual([{ type: 'tool', name: 'search_notes', input: '행사' }])
    expect(c.parseStreamLine(resultLine())).toEqual([{ type: 'result', ok: true, text: '답변입니다', turns: 3, costUsd: 0.02 }])
    expect(c.parseStreamLine(resultLine({ is_error: true, subtype: 'error_during_execution' }))[0].ok).toBe(false)
  })
  it('긴 본문(content)은 진행 표시에 싣지 않는다', () => {
    const [ev] = c.parseStreamLine(toolLine('mcp__nosidian__propose_change', { action: 'modify', path: 'a/b.md', content: '비밀'.repeat(1000), base_hash: 'h' }))
    expect(ev).toEqual({ type: 'tool', name: 'propose_change', input: 'modify a/b.md' })
    expect(JSON.stringify(ev)).not.toContain('비밀')
  })
  it('system·rate_limit·깨진 줄·빈 줄은 무시', () => {
    expect(c.parseStreamLine('{"type":"system","subtype":"init"}')).toEqual([])
    expect(c.parseStreamLine('{"type":"rate_limit_event"}')).toEqual([])
    expect(c.parseStreamLine('깨진')).toEqual([])
    expect(c.parseStreamLine('')).toEqual([])
    expect(c.parseStreamLine('null')).toEqual([])
  })
})

describe('실행기', () => {
  it('성공: 진행·결과 이벤트, 프롬프트는 stdin, 임시 MCP 연결 정보 전달, 끝나면 정리', async () => {
    const h = await harness()
    const p = h.runner.run({ prompt: '행사 일정 알려 줘' }, h.onEvent)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.rec.spawn.cmd).toBe('C:/bin/claude.exe')
    expect(h.rec.spawn.opts).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    expect(h.rec.spawn.args).not.toContain('행사 일정 알려 줘') // 인자에 프롬프트 없음
    expect(h.rec.cfg).toEqual({ mcpServers: { nosidian: { type: 'http', url: 'http://127.0.0.1:5555/mcp', headers: { Authorization: 'Bearer tok123' } } } })
    const cwd = h.rec.spawn.opts.cwd as string
    expect(cwd.startsWith(h.base)).toBe(true) // 빈 임시 작업 폴더(프로젝트 파일 밖)
    await h.child.finish([textLine('찾아볼게요'), toolLine('mcp__nosidian__search_notes', { query: '행사' }), resultLine()])
    await p
    expect(h.child.stdinData).toBe('행사 일정 알려 줘')
    expect(h.rec.events).toEqual([{ type: 'text', text: '찾아볼게요' }, { type: 'tool', name: 'search_notes', input: '행사' }, { type: 'result', ok: true, text: '답변입니다', turns: 3, costUsd: 0.02 }])
    expect(h.rec.mcpClosed).toBe(1) // 임시 MCP 서버를 닫았다
    expect(h.fs.existsSync(cwd)).toBe(false) // 임시 폴더(설정 파일 포함)를 지웠다
    expect(h.runner.isRunning()).toBe(false)
  })
  it('끝 이벤트는 정리가 끝난 뒤에 온다: 받았을 때는 임시 서버·폴더가 이미 정리되어 있고 바로 다시 실행할 수 있다', async () => {
    const h = await harness()
    let atResult: any = null
    const onEvent = (e: any) => {
      h.rec.events.push(e)
      if (e.type === 'result') atResult = { mcpClosed: h.rec.mcpClosed, dirGone: !h.fs.existsSync(h.rec.spawn.opts.cwd), running: h.runner.isRunning() }
    }
    const p = h.runner.run({ prompt: 'q' }, onEvent)
    await new Promise((r) => setTimeout(r, 20))
    await h.child.finish([toolLine('mcp__nosidian__search_notes', { query: 'a' }), resultLine()])
    await p
    expect(atResult).toEqual({ mcpClosed: 1, dirGone: true, running: false })
    expect(h.rec.events.map((e: any) => e.type)).toEqual(['tool', 'result']) // 진행은 먼저, 끝은 마지막
  })
  it('결과를 낸 뒤에도 프로세스가 안 끝나면 유예 후 끝낸다', async () => {
    const h = await harness({ graceMs: 40 })
    const p = h.runner.run({ prompt: 'q' }, h.onEvent)
    await new Promise((r) => setTimeout(r, 20))
    h.child.stdout.write(resultLine() + '\n') // 결과는 냈지만 close 는 오지 않는다
    await p // 유예 뒤 killTree → close
    expect(h.rec.killed).toBe(1)
    expect(h.rec.events.at(-1)).toMatchObject({ type: 'result', ok: true })
  })
  it('한 줄이 여러 조각으로 와도 이어 붙여 해석한다', async () => {
    const h = await harness()
    const p = h.runner.run({ prompt: 'q' }, h.onEvent)
    await new Promise((r) => setTimeout(r, 20))
    const line = resultLine()
    h.child.stdout.write(line.slice(0, 20))
    await new Promise((r) => setTimeout(r, 10))
    h.child.stdout.write(line.slice(20) + '\n')
    await h.child.finish([])
    await p
    expect(h.rec.events.map((e: any) => e.type)).toEqual(['result'])
  })
  it('결과 없이 비정상 종료: 로그인 문제와 그 밖을 구분해 알린다', async () => {
    const a = await harness()
    const pa = a.runner.run({ prompt: 'q' }, a.onEvent)
    await new Promise((r) => setTimeout(r, 20))
    await a.child.finish([], 1, 'Error: not logged in. Please run claude auth login')
    await pa
    expect(a.rec.events[0]).toMatchObject({ type: 'error', code: 'login' })
    const b = await harness()
    const pb = b.runner.run({ prompt: 'q' }, b.onEvent)
    await new Promise((r) => setTimeout(r, 20))
    await b.child.finish([], 2, 'something broke\nbadly')
    await pb
    expect(b.rec.events[0]).toMatchObject({ type: 'error', code: 'exit' })
    expect(b.rec.events[0].message).toContain('badly')
    expect(b.rec.mcpClosed).toBe(1)
  })
  it('시간 초과: 프로세스를 끝내고 알리며 정리한다', async () => {
    const h = await harness({ timeoutMs: 60 })
    const p = h.runner.run({ prompt: 'q' }, h.onEvent)
    await p // killTree 가 자식을 끝낸다
    expect(h.rec.killed).toBe(1)
    expect(h.rec.events.at(-1)).toMatchObject({ type: 'error', code: 'timeout' })
    expect(h.rec.mcpClosed).toBe(1)
    expect(h.runner.isRunning()).toBe(false)
  })
  it('취소: 프로세스를 끝내고 cancelled, 실행 중이 아니면 false', async () => {
    const h = await harness()
    expect(h.runner.cancel()).toBe(false)
    const p = h.runner.run({ prompt: 'q' }, h.onEvent)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.runner.isRunning()).toBe(true)
    expect(h.runner.cancel()).toBe(true)
    await p
    expect(h.rec.killed).toBe(1)
    expect(h.rec.events.at(-1)).toMatchObject({ type: 'error', code: 'cancelled' })
  })
  it('동시에 하나만: 실행 중에 또 요청하면 busy, 끝나면 다시 가능', async () => {
    const h = await harness()
    const p = h.runner.run({ prompt: 'q' }, h.onEvent)
    await new Promise((r) => setTimeout(r, 20))
    const second: any[] = []
    await h.runner.run({ prompt: 'q2' }, (e: any) => second.push(e))
    expect(second).toEqual([expect.objectContaining({ type: 'error', code: 'busy' })])
    await h.child.finish([resultLine()])
    await p
    expect(h.runner.isRunning()).toBe(false)
  })
  it('잘못된 요청: 빈 질문·너무 긴 질문·CLI 없음은 실행하지 않는다', async () => {
    const h = await harness()
    const ev: any[] = []
    await h.runner.run({ prompt: '   ' }, (e: any) => ev.push(e))
    await h.runner.run({ prompt: 'x'.repeat(20_001) }, (e: any) => ev.push(e))
    await h.runner.run({ prompt: 5 as unknown as string }, (e: any) => ev.push(e))
    expect(ev.map((e) => e.code)).toEqual(['badPrompt', 'badPrompt', 'badPrompt'])
    const none = await harness({ findClaude: () => ({ path: null }) })
    await none.runner.run({ prompt: 'q' }, none.onEvent)
    expect(none.rec.events[0]).toMatchObject({ code: 'notFound' })
    expect(h.rec.spawn).toBeNull()
  })
  it('임시 MCP 서버를 못 열면 오류로 끝내고 정리, 이후 다시 실행 가능', async () => {
    const h = await harness({ startMcp: async () => { throw new Error('포트를 열 수 없어요') } })
    await h.runner.run({ prompt: 'q' }, h.onEvent)
    expect(h.rec.events[0]).toMatchObject({ type: 'error', code: 'internal', message: '포트를 열 수 없어요' })
    expect(h.runner.isRunning()).toBe(false)
    expect(h.fs.readdirSync(h.base)).toEqual([]) // 임시 폴더가 남지 않았다
  })
})
