import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const confirmMock = vi.fn<(title: string, msg?: string, ok?: string, danger?: boolean) => Promise<boolean>>()
vi.mock('../lib/dialog', () => ({ confirmAsk: (...a: Parameters<typeof confirmMock>) => confirmMock(...a) }))

import { ForgetLink, forgetNote, forgetResult } from './ForgetLink'
import { useApp } from '../lib/app'
import { setLang } from '../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('폰의 PC 연결 해제 버튼(세 곳 공통, 5-c)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    setLang('ko')
    confirmMock.mockReset()
    useApp.setState({ toast: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const render = (onForget: () => Promise<boolean>, kind: 'ai' | 'share' | 'host' = 'share') => act(() => root.render(createElement(ForgetLink, { kind, pcName: 'MY-PC', onForget })))
  const click = async () => {
    act(() => host.querySelector<HTMLButtonElement>('button')!.click())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
  }
  const toast = () => useApp.getState().toast ?? ''

  it('누르면 PC 이름이 든 확인 창이 먼저 뜨고, 취소하면 아무것도 해제하지 않는다', async () => {
    const onForget = vi.fn(async () => true)
    confirmMock.mockResolvedValue(false)
    render(onForget)
    await click()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0][0]).toContain('MY-PC')
    expect(confirmMock.mock.calls[0][3]).toBe(true) // 위험 동작 표시
    expect(onForget).not.toHaveBeenCalled()
  })
  it('종류마다 확인 창의 설명이 다르다(AI · 폴더 보기 · 동기화)', () => {
    expect(new Set([forgetNote('ai'), forgetNote('share'), forgetNote('host')]).size).toBe(3)
    expect(forgetNote('host')).toContain('노트는 그대로')
  })
  it('확인하면 해제를 실행하고, PC 목록에서도 빠졌으면 그렇게 알린다', async () => {
    const onForget = vi.fn(async () => true)
    confirmMock.mockResolvedValue(true)
    render(onForget)
    await click()
    expect(onForget).toHaveBeenCalledTimes(1)
    expect(toast()).toContain(forgetResult(true))
  })
  it('PC 에 닿지 않았으면(false) PC 앱에서 직접 해제하라고 알린다 — 폰의 해제는 끝난 상태', async () => {
    confirmMock.mockResolvedValue(true)
    render(async () => false)
    await click()
    expect(toast()).toContain(forgetResult(false))
    expect(forgetResult(false)).toContain('PC 앱')
    expect(forgetResult(true)).not.toBe(forgetResult(false))
  })
  it('label 을 주면 그 글자로, 아니면 "연결 해제"', () => {
    render(async () => true)
    expect(host.querySelector('button')!.textContent).toBe('연결 해제')
    act(() => root.render(createElement(ForgetLink, { kind: 'ai', pcName: 'MY-PC', label: '이 PC 연결 해제 (MY-PC)', onForget: async () => true })))
    expect(host.querySelector('button')!.textContent).toBe('이 PC 연결 해제 (MY-PC)')
  })
  it('해제하는 동안(PC 가 늦게 답해도) 버튼에 진행 문구가 보이고 눌리지 않는다', async () => {
    let release: (v: boolean) => void = () => {}
    confirmMock.mockResolvedValue(true)
    render(() => new Promise<boolean>((r) => { release = r }))
    await click()
    const b = host.querySelector('button')!
    expect(b.textContent).toBe('해제하는 중…')
    expect(b.disabled).toBe(true)
    await act(async () => { release(true); await Promise.resolve() })
    expect(host.querySelector('button')!.textContent).toBe('연결 해제')
  })
})
