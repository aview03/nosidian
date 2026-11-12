import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backDepth, runBack, useBackClose } from '../lib/backStack'
import { usePcFilesUi, type PcShare } from '../lib/pcFiles'
import { PcFilesSheet } from './PcFilesCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('뒤로 가기로 닫히는 시트', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    usePcFilesUi.setState({ open: false, link: null })
  })

  it('useBackClose: 열려 있는 동안만 등록되고, 뒤로 가기가 닫는다', () => {
    let setOpen: (v: boolean) => void = () => {}
    const Probe = () => {
      const [open, set] = useState(true)
      setOpen = set
      useBackClose(open, () => set(false))
      return createElement('span', { id: 'p' }, open ? 'open' : 'closed')
    }
    act(() => root.render(createElement(Probe)))
    expect(backDepth()).toBe(1)
    act(() => { runBack() })
    expect(host.textContent).toBe('closed')
    expect(backDepth()).toBe(0)
    act(() => setOpen(true))
    expect(backDepth()).toBe(1)
    act(() => root.unmount())
    expect(backDepth()).toBe(0) // 언마운트하면 등록이 풀린다
    root = createRoot(host)
  })

  it('PC 폴더 시트: 열린 채 뒤로 가기를 누르면 시트가 닫힌다(뒤쪽 화면이 물러나지 않게 처리기가 먼저 받는다)', () => {
    const link = { host: '127.0.0.1', hosts: ['127.0.0.1'], port: 1, token: 'x', name: 'PC', fingerprint: 'f', dirName: 'share' } as unknown as PcShare
    usePcFilesUi.setState({ link, open: true })
    act(() => root.render(createElement(PcFilesSheet)))
    expect(host.querySelector('.pcfiles-sheet')).not.toBeNull()
    expect(backDepth()).toBe(1)
    act(() => { runBack() })
    expect(usePcFilesUi.getState().open).toBe(false)
    expect(host.querySelector('.pcfiles-sheet')).toBeNull()
    expect(backDepth()).toBe(0)
  })
})
