import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLongPress } from './MemoTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe({ onLong }: { onLong: () => void }) {
  const lp = useLongPress(onLong)
  return createElement('button', { id: 'row', ...lp }, 'row')
}

describe('꾹 누르기(메모 목록)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })
  const ev = (type: string, o: Record<string, unknown> = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, ...o })
    Object.defineProperty(e, 'pointerType', { value: (o.pointerType as string) ?? 'touch' })
    return e
  }

  it('손가락으로 꾹 누르면 한 번만 선택한다(뒤따라 오는 contextmenu 가 다시 토글하지 않는다)', () => {
    const onLong = vi.fn()
    act(() => root.render(createElement(Probe, { onLong })))
    const row = host.querySelector('#row')!
    act(() => { row.dispatchEvent(ev('pointerdown')) })
    act(() => { vi.advanceTimersByTime(460) })
    expect(onLong).toHaveBeenCalledTimes(1)
    act(() => { row.dispatchEvent(ev('contextmenu')) }) // 브라우저가 이어서 보내는 이벤트
    act(() => { row.dispatchEvent(ev('pointerup')) })
    expect(onLong).toHaveBeenCalledTimes(1)
  })
  it('마우스 우클릭은 선택으로 본다', () => {
    const onLong = vi.fn()
    act(() => root.render(createElement(Probe, { onLong })))
    act(() => { host.querySelector('#row')!.dispatchEvent(ev('contextmenu', { pointerType: 'mouse' })) })
    expect(onLong).toHaveBeenCalledTimes(1)
  })
  it('짧게 누르거나 많이 움직이면 선택하지 않는다', () => {
    const onLong = vi.fn()
    act(() => root.render(createElement(Probe, { onLong })))
    const row = host.querySelector('#row')!
    act(() => { row.dispatchEvent(ev('pointerdown')) })
    act(() => { vi.advanceTimersByTime(200) })
    act(() => { row.dispatchEvent(ev('pointerup')) })
    act(() => { row.dispatchEvent(ev('pointerdown')) })
    act(() => { row.dispatchEvent(ev('pointermove', { clientX: 60, clientY: 10 })) })
    act(() => { vi.advanceTimersByTime(600) })
    expect(onLong).not.toHaveBeenCalled()
  })
})
