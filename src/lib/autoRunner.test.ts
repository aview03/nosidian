import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from './app'
import type { NoteFile } from './types'
import type { QueueItem } from './autoTriggers'
import type { ClaudeEvent } from './externalIO'

const agent = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./aiAgent', async (orig) => ({ ...(await orig<typeof import('./aiAgent')>()), runAgent: agent.run }))
vi.mock('./llm', async (orig) => ({ ...(await orig<typeof import('./llm')>()), loadLlmConfig: () => ({ provider: 'ollama', model: 'm', baseUrl: 'http://127.0.0.1:11434' }) }))

import { promptOf, startAnalysis, titleOf } from './autoRunner'

const item: QueueItem = {
  id: 'x', cacheKey: 'k', kind: 'duplicate', project: '프로젝트/행사 준비/프로젝트 개요.md', projectName: '행사 준비',
  paths: ['프로젝트/행사 준비/a.md', '프로젝트/행사 준비/b.md'], hashes: {}, createdAt: 0, status: 'queued', attempts: 0, interrupted: 0,
}

describe('분석 프롬프트', () => {
  it('문서 점검 → AI로 고치기 1단계와 같은 지침: 변경 제출 금지·삭제 금지·결정은 사람에게', () => {
    const p = promptOf(item)
    expect(p).toContain('do NOT call propose_change')
    expect(p).toContain('Never plan to delete a note outright')
    expect(p).toContain('결정 필요')
    expect(p).toContain('`프로젝트/행사 준비/a.md`')
    expect(p).toContain('Short names: a.md, b.md')
  })
  it('패널에 보일 제목', () => expect(titleOf(item)).toBe('점검 · 중복 문서 후보: a.md ↔ b.md'))
})

describe('Claude 실행: 묻기(읽기 전용)로만 부른다', () => {
  let cbs: ((e: ClaudeEvent) => void)[]
  let run: ReturnType<typeof vi.fn>
  let cancel: ReturnType<typeof vi.fn>
  const emit = (e: ClaudeEvent) => cbs.forEach((f) => f(e))
  beforeEach(() => {
    cbs = []
    run = vi.fn()
    cancel = vi.fn(async () => true)
    ;(window as never as { amsidianDesktop: unknown }).amsidianDesktop = {
      claude: { run, cancel, detect: vi.fn(), onEvent: (f: (e: ClaudeEvent) => void) => { cbs.push(f); return () => { cbs = cbs.filter((x) => x !== f) } } },
    }
  })
  afterEach(() => delete (window as never as { amsidianDesktop?: unknown }).amsidianDesktop)

  it('mode 는 항상 ask 이고 승인 강제·변경 모드를 쓰지 않는다. 결과·비용을 돌려준다', async () => {
    run.mockImplementation(async () => { emit({ type: 'result', ok: true, text: '정리 계획', turns: 2, costUsd: 0.07 }); return { ok: true } })
    const a = startAnalysis('분석해', 'claude')
    const o = await a.done
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatchObject({ mode: 'ask' })
    expect(run.mock.calls[0][0].forceApproval).toBeUndefined()
    expect(run.mock.calls[0][0].prompt).toContain('Mode: read-only')
    expect(o).toMatchObject({ ok: true, text: '정리 계획', costUsd: 0.07, cancelled: false })
    expect(cbs).toHaveLength(0) // 끝나면 이벤트 구독을 푼다
  })
  it('run() 이 먼저 돌아오고 결과 이벤트가 뒤늦게 와도 기다린다(실제 Claude Code 의 동작)', async () => {
    run.mockResolvedValue({ ok: true })
    const a = startAnalysis('분석해', 'claude')
    let settled = false
    void a.done.then(() => { settled = true })
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    emit({ type: 'result', ok: true, text: '늦게 온 계획', turns: 1, costUsd: 0.2 })
    expect(await a.done).toMatchObject({ ok: true, text: '늦게 온 계획', costUsd: 0.2 })
  })
  it('시작하지 못하면(run ok:false) 오류 이벤트를 잠깐 기다린 뒤 실패', async () => {
    run.mockImplementation(async () => { setTimeout(() => emit({ type: 'error', code: 'busy', message: '이미 실행 중이에요' }), 5); return { ok: false } })
    expect(await startAnalysis('x', 'claude').done).toMatchObject({ ok: false, error: '이미 실행 중이에요' })
  })
  it('취소하면 cancelled(실패가 아니다), 이미 든 비용은 돌려준다', async () => {
    run.mockImplementation(() => new Promise((res) => { cancel.mockImplementation(async () => { emit({ type: 'error', code: 'cancelled', message: '취소했어요' }); res({ ok: false }); return true }) }))
    const a = startAnalysis('분석해', 'claude')
    a.cancel()
    expect(await a.done).toMatchObject({ ok: false, cancelled: true })
    expect(cancel).toHaveBeenCalled()
  })
  it('Claude 가 오류를 내면 실패(메시지 포함)', async () => {
    run.mockImplementation(async () => { emit({ type: 'error', code: 'auth', message: '로그인이 필요해요' }); return { ok: false } })
    expect(await startAnalysis('x', 'claude').done).toMatchObject({ ok: false, cancelled: false, error: '로그인이 필요해요' })
  })
  it('Claude Code 가 없으면 실패', async () => {
    delete (window as never as { amsidianDesktop?: unknown }).amsidianDesktop
    expect(await startAnalysis('x', 'claude').done).toMatchObject({ ok: false })
  })
})

describe('로컬 모델 실행: 읽기 전용 환경', () => {
  beforeEach(() => {
    agent.run.mockReset()
    const f: Record<string, NoteFile> = { 'p/a.md': { path: 'p/a.md', content: '# a', sha: null, dirty: false, mtime: 0 } }
    useApp.setState({ files: f, settings: { ...useApp.getState().settings, activeVault: 'v1' } })
  })
  it('도구는 읽기 전용으로 실행돼 propose_change 가 거절된다', async () => {
    let denied = ''
    agent.run.mockImplementation(async (input: { mode: string }, deps: { exec(n: string, a: Record<string, unknown>): unknown }) => {
      expect(input.mode).toBe('ask')
      try { deps.exec('propose_change', { action: 'create', path: 'p/새.md', content: 'x' }) } catch (e) { denied = (e as Error).message }
      return { text: '계획', rounds: 1 }
    })
    const o = await startAnalysis('분석해', 'ollama').done
    expect(o).toMatchObject({ ok: true, text: '계획', costUsd: 0 })
    expect(denied).toContain('read-only')
    expect(useApp.getState().files['p/새.md']).toBeUndefined()
  })
  it('취소하면 cancelled, 그 밖의 오류는 실패', async () => {
    agent.run.mockImplementation((_i: unknown, _d: unknown) => new Promise((_res, rej) => setTimeout(() => rej(new Error('연결 거부')), 5)))
    expect(await startAnalysis('x', 'ollama').done).toMatchObject({ ok: false, cancelled: false, error: '연결 거부' })
    agent.run.mockImplementation((input: { signal: AbortSignal }) => new Promise((_res, rej) => input.signal.addEventListener('abort', () => rej(new Error('aborted')))))
    const a = startAnalysis('x', 'ollama')
    a.cancel()
    expect(await a.done).toMatchObject({ ok: false, cancelled: true })
  })
})
