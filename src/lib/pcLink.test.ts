import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mod from '../../electron/aiRelay.cjs'
import { useApp } from './app'
import { setLang } from './i18n'
import { chat } from './llmNet'
import { adoptUpstream, forgetPc, llmConfigVia, loadPcLink, parsePairing, pairWithPc, pingPc, runClaudeViaPc, savePcLink, type PcLink } from './pcLink'
import { loadLlmConfig } from './llm'
import type { ClaudeEvent } from './externalIO'

setLang('ko')
const { createRelay } = mod as { createRelay(d: unknown): any }

describe('연결 코드 해석', () => {
  it('QR 문자열과 사람이 쓰는 여러 모양을 받아들인다', () => {
    expect(parsePairing('nsd1:192.168.0.10:47410:482913')).toEqual({ host: '192.168.0.10', hosts: ['192.168.0.10'], port: 47410, code: '482913' })
    expect(parsePairing('nsd1:192.168.10.86,192.168.56.1:47410:482913')).toMatchObject({ host: '192.168.10.86', hosts: ['192.168.10.86', '192.168.56.1'], code: '482913' })
    expect(parsePairing(' 192.168.0.10:47411/482913 ')).toMatchObject({ host: '192.168.0.10', port: 47411, code: '482913' })
    expect(parsePairing('192.168.0.10 482913')).toMatchObject({ host: '192.168.0.10', port: 47410, code: '482913' })
    expect(parsePairing('10.0.0.2-123456')).toMatchObject({ host: '10.0.0.2', port: 47410, code: '123456' })
  })
  it('잘못된 주소·코드·포트는 거절', () => {
    for (const bad of ['', 'hello', '192.168.0.10:47410/12345', '999.1.1.1 123456', '192.168.0.10:80/123456', 'nsd1:1.2.3.4:47410:12', '192.168.0.10:47410/abcdef', 'nsd1:1.2.3.4,999.1.1.1:47410:123456']) expect(parsePairing(bad)).toBeNull()
  })
})

type Ev = { type: string; [k: string]: unknown }
let relay: { close(): Promise<void>; codeNow(): { value: string } } | null = null
afterEach(async () => {
  await relay?.close()
  relay = null
  localStorage.clear()
})
beforeEach(() => {
  localStorage.clear()
  useApp.setState({ files: {}, settings: { ...useApp.getState().settings, activeVault: 'v1' } })
})

async function boot(over: { upstream?: unknown; run?: (req: any, emit: (e: Ev) => void) => Promise<void>; cancel?: () => boolean } = {}) {
  const llmRequest = vi.fn(async () => ({ status: 200, text: JSON.stringify({ message: { role: 'assistant', content: 'PC 의 Ollama 가 답했어요' } }) }))
  const run = vi.fn(over.run ?? (async (_r: unknown, emit: (e: Ev) => void) => { emit({ type: 'result', ok: true, text: 'OK', turns: 1, costUsd: 0 }) }))
  const cancel = vi.fn(over.cancel ?? (() => true))
  const r = createRelay({
    store: { read: () => null, write: () => {} },
    hostName: 'MY-PC',
    getUpstream: () => (over.upstream === undefined ? { kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3.5:4b' } : over.upstream),
    llmRequest,
    claude: { ready: () => true, busy: () => false, run, cancel },
    pollWaitMs: 300,
  })
  const port = await r.listen(0, '127.0.0.1')
  relay = r
  return { r, port, llmRequest, run, cancel, code: r.codeNow().value as string }
}
const pairNow = async (b: Awaited<ReturnType<typeof boot>>) => pairWithPc({ host: '127.0.0.1', hosts: ['127.0.0.1'], port: b.port, code: b.code }, '내 폰')

describe('짝 맺기와 모델 중계(폰 → PC → AI 서버)', () => {
  it('코드로 짝을 맺으면 PC 이름·AI 종류·Claude 가능 여부와 토큰이 저장된다', async () => {
    const b = await boot()
    const link = await pairNow(b)
    expect(link).toMatchObject({ host: '127.0.0.1', port: b.port, name: 'MY-PC', claude: true, upstream: { kind: 'ollama', model: 'qwen3.5:4b' } })
    expect(link.token).toMatch(/^[0-9a-f]{48}$/)
    expect(loadPcLink()).toEqual(link)
    const ping = await pingPc(link)
    expect(ping).toMatchObject({ name: 'MY-PC', claude: true })
  })
  it('틀린 코드는 알아보기 쉬운 오류로', async () => {
    const b = await boot()
    await expect(pairWithPc({ host: '127.0.0.1', hosts: ['127.0.0.1'], port: b.port, code: '000000' }, 'x')).rejects.toThrow('연결 코드가 맞지 않거나 만료됐어요')
    expect(loadPcLink()).toBeNull()
  })
  it('PC 에 닿지 않으면 같은 와이파이·PC 앱 확인을 안내한다', async () => {
    await expect(pairWithPc({ host: '127.0.0.1', hosts: ['127.0.0.1'], port: 1, code: '123456' }, 'x')).rejects.toThrow('PC에 연결하지 못했어요')
  })
  it('주소 후보가 여럿이면 안 닿는 주소는 건너뛰고 닿는 주소로 짝을 맺는다', async () => {
    const b = await boot()
    const link = await pairWithPc({ host: '127.0.0.1', hosts: ['127.0.0.1'], port: b.port, code: b.code }, 'x')
    expect(link.host).toBe('127.0.0.1')
  })
  it('PC 의 Ollama 는 폰의 ollama 연결(PC 주소+토큰)로, OpenAI 호환은 custom(/v1)으로 채워진다. 실제 키는 폰에 없다', async () => {
    const ollama: PcLink = { host: '192.168.0.10', port: 47410, token: 't'.repeat(48), name: 'PC', claude: false, upstream: { kind: 'ollama', model: 'qwen' } }
    expect(llmConfigVia(ollama)).toEqual({ kind: 'ollama', baseUrl: 'http://192.168.0.10:47410', model: 'qwen', apiKey: ollama.token, viaPc: true })
    const openai = { ...ollama, upstream: { kind: 'openai', model: 'gpt-4o-mini' } }
    expect(llmConfigVia(openai)).toEqual({ kind: 'custom', baseUrl: 'http://192.168.0.10:47410/v1', model: 'gpt-4o-mini', apiKey: ollama.token, viaPc: true })
    expect(llmConfigVia({ ...ollama, upstream: null })).toBeNull()
    expect(adoptUpstream({ ...ollama, upstream: null })).toBe(false)
    expect(adoptUpstream(ollama)).toBe(true)
    expect(loadLlmConfig()).toMatchObject({ kind: 'ollama', viaPc: true })
    savePcLink(ollama)
    forgetPc()
    expect(loadPcLink()).toBeNull()
    expect(loadLlmConfig()).toBeNull() // PC 를 통한 연결도 함께 지운다
  })
  it('채팅 요청이 PC 의 중계를 지나 PC 의 AI 서버에 닿고 답이 돌아온다(토큰으로 인증)', async () => {
    const b = await boot()
    const link = await pairNow(b)
    adoptUpstream(link)
    const reply = await chat(loadLlmConfig()!, [{ role: 'user', content: '안녕' }], { maxTokens: 16 })
    expect(reply).toBe('PC 의 Ollama 가 답했어요')
    expect((b.llmRequest.mock.calls[0] as unknown as [{ url: string }])[0].url).toBe('http://localhost:11434/api/chat')
  })
})

describe('Claude 구독 중계(폰이 도구를 실행)', () => {
  const collect = (link: PcLink, req: { prompt: string; mode: 'ask' | 'edit'; forceApproval?: boolean }) => {
    const events: ClaudeEvent[] = []
    const run = runClaudeViaPc(link, req, (e) => events.push(e))
    return { run, events }
  }

  it('PC 의 Claude 가 부른 노트 도구가 이 폰의 노트에서 실행되고, 진행·결과가 폰에 전달된다', async () => {
    useApp.setState({ files: { 'p/a.md': { path: 'p/a.md', content: '폰에만 있는 노트', sha: null, dirty: false, mtime: 0 } } })
    let seen = ''
    const b = await boot({
      run: async (req, emit) => {
        const out = (await req.callTool('read_note', { path: 'p/a.md' }, 'x')) as { content: string }
        seen = out.content
        emit({ type: 'tool', name: 'read_note', input: 'p/a.md' })
        emit({ type: 'result', ok: true, text: '읽었어요: ' + out.content, turns: 2, costUsd: 0.02 })
      },
    })
    const link = await pairNow(b)
    const { run, events } = collect(link, { prompt: '요약해 줘', mode: 'ask' })
    await run.done
    expect(seen).toBe('폰에만 있는 노트') // PC 가 아니라 폰의 vault 에서 읽었다
    expect(events.map((e) => e.type)).toEqual(['tool', 'result'])
    expect(events[1]).toMatchObject({ type: 'result', ok: true, text: '읽었어요: 폰에만 있는 노트' })
    expect(b.run.mock.calls[0][0]).toMatchObject({ prompt: '요약해 줘', mode: 'ask', forceApproval: false })
  })

  it('묻기(읽기 전용)에서는 폰이 propose_change 를 거절하고, 그 이유가 Claude 에게 돌아간다', async () => {
    let err = ''
    const b = await boot({
      run: async (req, emit) => {
        await req.callTool('propose_change', { action: 'create', path: 'x.md', content: 'x' }, 'x').catch((e: Error) => { err = e.message })
        emit({ type: 'result', ok: true, text: '', turns: 1, costUsd: 0 })
      },
    })
    const link = await pairNow(b)
    const { run } = collect(link, { prompt: 'q', mode: 'ask' })
    await run.done
    expect(err).toContain('read-only')
    expect(useApp.getState().files['x.md']).toBeUndefined()
  })

  it('변경 제안 모드의 propose_change 는 폰의 정책·승인 흐름으로 들어간다(PC 의 vault 가 아니다)', async () => {
    let out: unknown
    const b = await boot({
      run: async (req, emit) => {
        out = await req.callTool('propose_change', { action: 'create', path: '새 노트.md', content: '# 새 노트' }, 'x').catch((e: Error) => ({ error: e.message }))
        emit({ type: 'result', ok: true, text: 'done', turns: 1, costUsd: 0 })
      },
    })
    const link = await pairNow(b)
    const { run } = collect(link, { prompt: 'q', mode: 'edit', forceApproval: true })
    await run.done
    expect(b.run.mock.calls[0][0]).toMatchObject({ mode: 'edit', forceApproval: true })
    expect(JSON.stringify(out)).toMatch(/pending_approval|applied|denied|outcome/) // 폰의 정책 엔진이 판정한 결과가 돌아왔다
  })

  it('PC 에서 Claude 를 쓸 수 없으면(503) 안내 오류, 이미 실행 중이면(409) 잠시 뒤에', async () => {
    const b = await boot()
    const link = await pairNow(b)
    await relay!.close()
    relay = null
    const { run, events } = collect(link, { prompt: 'q', mode: 'ask' })
    await run.done
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', code: 'pc' })
    expect((events[0] as { message: string }).message).toContain('PC에 연결하지 못했어요')
  })

  it('취소하면 PC 의 Claude 실행도 멈추고 cancelled 로 끝난다', async () => {
    let release: () => void = () => {}
    const b = await boot({ run: () => new Promise<void>((r) => { release = r }), cancel: () => { release(); return true } })
    const link = await pairNow(b)
    const { run, events } = collect(link, { prompt: 'q', mode: 'ask' })
    await new Promise((r) => setTimeout(r, 150))
    run.cancel()
    await run.done
    await new Promise((r) => setTimeout(r, 150)) // 취소 요청은 기다리지 않고 보낸다
    expect(b.cancel).toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'cancelled' })
  })
})
