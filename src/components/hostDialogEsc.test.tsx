import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostConnectDialog } from './HostConnect'
import { backDepth, runBack } from '../lib/backStack'
import { setLang } from '../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PC 앱의 호스트 폴더 연결 창 (7번: Esc·뒤로 가기 일관성)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    setLang('ko')
    ;(window as unknown as { amsidianDesktop: unknown }).amsidianDesktop = { host: { status: async () => ({ ok: false }) } }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete (window as unknown as { amsidianDesktop?: unknown }).amsidianDesktop
  })
  const open = async () => {
    const onClose = vi.fn()
    await act(async () => { root.render(createElement(HostConnectDialog, { onClose })) })
    return onClose
  }

  it('Esc 로 닫힌다(다른 창들과 같게)', async () => {
    const onClose = await open()
    expect(host.querySelector('.hc')).not.toBeNull()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('안드로이드 뒤로 가기(등록된 창 닫기)도 같은 곳으로 닫는다', async () => {
    const onClose = await open()
    expect(backDepth()).toBe(1)
    act(() => { runBack() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('Esc 이외의 키는 닫지 않는다', async () => {
    const onClose = await open()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })) })
    expect(onClose).not.toHaveBeenCalled()
  })
})
