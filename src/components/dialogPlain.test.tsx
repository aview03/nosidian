import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Dialogs } from './Dialogs'
import { choose, useDialog } from '../lib/dialog'
import { setLang } from '../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('선택 창의 강조(기본 선택) — 바이너리 충돌은 기본 선택이 없다 (2번)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    setLang('ko')
    useDialog.setState({ kind: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement(Dialogs)))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useDialog.setState({ kind: null })
  })
  const open = (plain?: boolean) => {
    act(() => { void choose('제목', '설명', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], plain ? { plain: true } : undefined) })
    return [...host.querySelectorAll<HTMLButtonElement>('.modal-actions.choice button')]
  }

  it('기본: 첫 선택지가 강조된다(기존 동작 그대로)', () => {
    const btns = open()
    expect(btns.map((b) => b.textContent)).toEqual(['A', 'B', '취소'])
    expect(btns[0].classList.contains('primary')).toBe(true)
    expect(btns[1].classList.contains('primary')).toBe(false)
  })
  it('plain: 어느 선택지도 강조하지 않는다', () => {
    const btns = open(true)
    expect(btns.some((b) => b.classList.contains('primary'))).toBe(false)
  })
  it('plain 은 다음 창으로 새지 않는다(plain 창을 닫고 일반 선택 창을 열면 다시 강조된다)', () => {
    open(true)
    act(() => { useDialog.getState().resolve?.(null); useDialog.setState({ kind: null }) })
    const btns = open()
    expect(btns[0].classList.contains('primary')).toBe(true)
  })
})
