import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const confirmMock = vi.fn<(title: string, msg?: string, ok?: string, danger?: boolean) => Promise<boolean>>()
vi.mock('../lib/dialog', () => ({ confirmAsk: (...a: Parameters<typeof confirmMock>) => confirmMock(...a), choose: vi.fn(), ask: vi.fn() }))

import { HostServerSection } from './HostConnect'
import { useApp } from '../lib/app'
import { setLang } from '../lib/i18n'
import type { HostServerStatus } from '../lib/externalIO'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PC 앱: 기기별 삭제 허용 스위치 (6번 4항 삭제 전파)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let status: HostServerStatus
  const setPerms = vi.fn(async (_id: string, _p: { write?: boolean; delete?: boolean }) => ({ ok: true as const, ...status }))
  const mkStatus = (over: Partial<HostServerStatus> = {}, perms = { write: true, delete: false }): HostServerStatus => ({
    hostConfigured: true, enabled: true, running: true, port: 47412, ips: ['10.0.0.2'], code: null, codeExpiresAt: null, pair: null, fingerprint: 'f', allowDelete: true,
    devices: [{ id: 'd1', name: '내 휴대폰', createdAt: 1, lastSeen: Date.now(), perms, writes: 0, lastWriteAt: 0 }], error: null, ...over,
  })
  const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }) }
  const mount = async () => {
    ;(window as unknown as { amsidianDesktop: unknown }).amsidianDesktop = { hostsrv: { get: async () => ({ ok: true, ...status }), setPerms } }
    await act(async () => { root.render(createElement(HostServerSection)) })
    await flush()
  }
  const delBtn = () => [...host.querySelectorAll<HTMLButtonElement>('button.hc-perm')].find((b) => /삭제/.test(b.textContent ?? ''))!

  beforeEach(() => {
    setLang('ko')
    confirmMock.mockReset()
    setPerms.mockClear()
    useApp.setState({ toast: null })
    status = mkStatus()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete (window as unknown as { amsidianDesktop?: unknown }).amsidianDesktop
  })

  it('서버가 삭제를 허용하지 않는 빌드면 버튼이 꺼져 있다("삭제 불가")', async () => {
    status = mkStatus({ allowDelete: false })
    await mount()
    expect(delBtn().disabled).toBe(true)
    expect(delBtn().textContent).toBe('삭제 불가')
  })
  it('쓰기가 허용되지 않은 기기에서는 켜지지 않고 먼저 쓰기를 허용하라고 알린다', async () => {
    status = mkStatus({}, { write: false, delete: false })
    await mount()
    act(() => delBtn().click())
    await flush()
    expect(setPerms).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(useApp.getState().toast).toContain('먼저 쓰기를 허용')
  })
  it('켤 때는 확인 창(위험 표시 · 휴지통 90일 안내)을 거치고, 취소하면 아무것도 바꾸지 않는다', async () => {
    confirmMock.mockResolvedValue(false)
    await mount()
    act(() => delBtn().click())
    await flush()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0][0]).toContain('내 휴대폰')
    expect(confirmMock.mock.calls[0][1]).toContain('휴지통')
    expect(confirmMock.mock.calls[0][3]).toBe(true)
    expect(setPerms).not.toHaveBeenCalled()
  })
  it('확인하면 삭제 권한을 켠다', async () => {
    confirmMock.mockResolvedValue(true)
    await mount()
    act(() => delBtn().click())
    await flush()
    expect(setPerms).toHaveBeenCalledWith('d1', { delete: true })
  })
  it('끄는 것은 확인 없이 바로', async () => {
    status = mkStatus({}, { write: true, delete: true })
    await mount()
    expect(delBtn().textContent).toBe('삭제 허용됨')
    act(() => delBtn().click())
    await flush()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(setPerms).toHaveBeenCalledWith('d1', { delete: false })
  })
})
