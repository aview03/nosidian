import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostTrash } from './HostTrash'
import { useApp } from '../lib/app'
import { setLang } from '../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Entry = { name: string; path: string; at: number; size: number }

describe('PC 앱의 휴지통 복구 화면 (6번 4항)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let entries: Entry[]
  let all: Entry[] // 되살리기 전의 전체 목록(모의 함수가 이름으로 찾는다)
  const trash = vi.fn(async () => ({ ok: true as const, entries }))
  const restoreTrash = vi.fn(async (name: string) => ({ ok: true as const, path: all.find((e) => e.name === name)!.path, rev: 'r', seq: 1, renamed: false }))
  const sync = vi.fn(async (..._a: unknown[]) => {})
  const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }) }
  beforeEach(() => {
    setLang('ko')
    entries = [
      { name: '7-b.md', path: '프로젝트/b.md', at: Date.now() - 1_000, size: 2048 },
      { name: '3-a.docx', path: 'a.docx', at: Date.now() - 3 * 3600_000, size: 12 },
    ]
    all = [...entries]
    trash.mockClear(); restoreTrash.mockClear(); sync.mockClear()
    ;(window as unknown as { amsidianDesktop: unknown }).amsidianDesktop = { host: { trash, restoreTrash } }
    useApp.setState({ toast: null, sync: sync as never })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete (window as unknown as { amsidianDesktop?: unknown }).amsidianDesktop
  })
  const show = async () => { await act(async () => { root.render(createElement(HostTrash)) }); await flush() }

  it('지운 파일 목록(최근 것이 위)과 개수를 보여 준다', async () => {
    await show()
    expect(host.querySelector('summary')!.textContent).toBe('휴지통 (2)')
    const rows = [...host.querySelectorAll('li')].map((li) => li.textContent)
    expect(rows[0]).toContain('프로젝트/b.md')
    expect(rows[0]).toContain('2 KB')
    expect(rows[0]).toContain('방금 지움') // "방금에 지움" 이 아니다
    expect(rows[1]).toContain('3시간 전에 지움')
    expect(rows[1]).toContain('a.docx')
  })
  it('휴지통이 비어 있으면 아무것도 그리지 않는다', async () => {
    entries = []
    await show()
    expect(host.innerHTML).toBe('')
  })
  it('되살리기: 이름으로 되살리고, 알리고, 동기화해 앱에도 반영하고, 목록을 다시 읽는다', async () => {
    await show()
    entries = [entries[1]] // 되살린 뒤 목록
    act(() => host.querySelector<HTMLButtonElement>('li button')!.click())
    await flush()
    expect(restoreTrash).toHaveBeenCalledWith('7-b.md')
    expect(useApp.getState().toast).toContain('되살렸어요')
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync.mock.calls[0]).toEqual([false, { auto: true }]) // 조용히
    expect(trash.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(host.querySelector('summary')!.textContent).toBe('휴지통 (1)')
  })
  it('원래 자리에 같은 이름이 있어서 이름이 바뀌었으면 그 이름을 알린다', async () => {
    restoreTrash.mockResolvedValueOnce({ ok: true, path: '프로젝트/b (복구).md', rev: 'r', seq: 1, renamed: true })
    await show()
    act(() => host.querySelector<HTMLButtonElement>('li button')!.click())
    await flush()
    expect(useApp.getState().toast).toContain('프로젝트/b (복구).md')
    expect(useApp.getState().toast).toContain('같은 이름')
  })
  it('실패하면 이유를 알리고 동기화하지 않는다', async () => {
    restoreTrash.mockResolvedValueOnce({ ok: false, error: 'not in trash' } as never)
    await show()
    act(() => host.querySelector<HTMLButtonElement>('li button')!.click())
    await flush()
    expect(useApp.getState().toast).toContain('not in trash')
    expect(sync).not.toHaveBeenCalled()
  })
})
