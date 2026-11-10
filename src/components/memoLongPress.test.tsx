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

import { useRowGesture, type RowGesture } from './MemoTab'

function GProbe({ g }: { g: RowGesture }) {
  const h = useRowGesture(g)
  return createElement('button', { id: 'row', ...h }, 'row')
}

describe('끌어서 옮기기(행 손짓)', () => {
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
  const mk = (over: Partial<RowGesture> = {}): RowGesture => ({ selecting: false, selected: false, onLong: vi.fn(), onDragStart: vi.fn(), onDragMove: vi.fn(), onDrop: vi.fn(), onDragCancel: vi.fn(), ...over })
  const fire = (row: Element, type: string, o?: Record<string, unknown>) => act(() => { row.dispatchEvent(ev(type, o)) })

  it('꾹 눌러 선택한 뒤 손을 떼지 않고 끌면 드래그가 시작되고, 놓으면 drop', () => {
    const g = mk()
    act(() => root.render(createElement(GProbe, { g })))
    const row = host.querySelector('#row')!
    fire(row, 'pointerdown')
    act(() => { vi.advanceTimersByTime(460) })
    expect(g.onLong).toHaveBeenCalledTimes(1)
    fire(row, 'pointermove', { clientX: 10, clientY: 40 })
    expect(g.onDragStart).toHaveBeenCalledTimes(1)
    fire(row, 'pointermove', { clientX: 10, clientY: 90 })
    expect(g.onDragMove).toHaveBeenLastCalledWith(10, 90)
    fire(row, 'contextmenu') // 뒤따르는 contextmenu 는 무시
    fire(row, 'pointerup')
    expect(g.onDrop).toHaveBeenCalledTimes(1)
    expect(g.onLong).toHaveBeenCalledTimes(1)
  })
  it('이미 선택된 행: 바로 끌면 스크롤(드래그 아님), 0.25초 꾹 누른 뒤 끌면 드래그', () => {
    const g = mk({ selecting: true, selected: true })
    act(() => root.render(createElement(GProbe, { g })))
    const row = host.querySelector('#row')!
    fire(row, 'pointerdown')
    fire(row, 'pointermove', { clientY: 50 })
    fire(row, 'pointerup')
    expect(g.onDragStart).not.toHaveBeenCalled()
    expect(g.onDrop).not.toHaveBeenCalled()
    fire(row, 'pointerdown')
    act(() => { vi.advanceTimersByTime(260) })
    fire(row, 'pointermove', { clientY: 50 })
    expect(g.onDragStart).toHaveBeenCalledTimes(1)
    fire(row, 'pointerup')
    expect(g.onDrop).toHaveBeenCalledTimes(1)
  })
  it('선택되지 않은 행은 선택 모드에서 끌어도 드래그하지 않는다(탭으로 선택)', () => {
    const g = mk({ selecting: true, selected: false })
    act(() => root.render(createElement(GProbe, { g })))
    const row = host.querySelector('#row')!
    fire(row, 'pointerdown')
    act(() => { vi.advanceTimersByTime(600) })
    fire(row, 'pointermove', { clientY: 80 })
    fire(row, 'pointerup')
    expect(g.onDragStart).not.toHaveBeenCalled()
    expect(g.onLong).not.toHaveBeenCalled()
  })
  it('마우스는 선택된 행을 바로 끌 수 있고, 취소하면 onDragCancel', () => {
    const g = mk({ selecting: true, selected: true })
    act(() => root.render(createElement(GProbe, { g })))
    const row = host.querySelector('#row')!
    fire(row, 'pointerdown', { pointerType: 'mouse', button: 0 })
    fire(row, 'pointermove', { pointerType: 'mouse', clientY: 40 })
    expect(g.onDragStart).toHaveBeenCalledTimes(1)
    fire(row, 'pointercancel')
    expect(g.onDragCancel).toHaveBeenCalledTimes(1)
    expect(g.onDrop).not.toHaveBeenCalled()
  })
  it('짧게 눌렀다 떼면 아무 일도 없다', () => {
    const g = mk()
    act(() => root.render(createElement(GProbe, { g })))
    const row = host.querySelector('#row')!
    fire(row, 'pointerdown')
    act(() => { vi.advanceTimersByTime(150) })
    fire(row, 'pointerup')
    act(() => { vi.advanceTimersByTime(600) })
    expect(g.onLong).not.toHaveBeenCalled()
    expect(g.onDragStart).not.toHaveBeenCalled()
  })
})
