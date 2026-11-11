import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectHub } from './ProjectHub'
import { Dialogs } from './Dialogs'
import { HOLD_MS } from './HubBoard'
import { useApp } from '../lib/app'
import { useWorkUi } from '../lib/workOps'
import { buildIndex } from '../lib/links'
import { setLang, t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const PROJECT = '프로젝트/시험/프로젝트 개요.md'
const TASKS = '프로젝트/시험/할 일.md'
const OTHER = '프로젝트/시험/다른 노트.md'
const FM = '---\ntype: project\nstatus: active\nowner: 민수\ndue: 2026-12-10\n---\n# 시험\n'
const BODY = ['# 할 일', '', '- [ ] 가 due:2026-11-20', '  - 가 메모', '- [ ] 나 due:2026-11-15', '- [ ] 다', '- [ ] 라 status:doing due:2026-11-12', ''].join('\n')

describe('프로젝트 허브: 기본 정보 탭', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const q = <T extends Element>(s: string) => [...host.querySelectorAll<T>(s)]
  const tab = (label: string) => q<HTMLButtonElement>('.hub-tabs [role="tab"]').find((b) => b.textContent === t(label))!
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
    setLang('ko')
    localStorage.clear()
    const files = Object.fromEntries([note(PROJECT, FM), note(TASKS, '- [ ] 가 due:2026-11-01 owner:민수\n- [ ] 나\n')].map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, toast: null, toastUndo: null })
    useWorkUi.setState({ hub: PROJECT, editor: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement(ProjectHub)))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useWorkUi.setState({ hub: null, editor: null })
    vi.useRealTimers()
  })

  it('제목 아래 요약 띠(자리를 많이 차지하던 것)는 없고, 탭이 5개다', () => {
    expect(host.querySelector('.hub-meta')).toBeNull()
    expect(host.querySelector('.hub-chip')).toBeNull()
    expect(q('.hub-tabs [role="tab"]').map((b) => b.textContent)).toEqual([t('할 일'), t('보기'), t('기본 정보'), t('문서'), t('문서 점검')])
  })

  it('기본 정보 탭에 상태·담당·마감(남은 날)·열린 일·건강도가 있다', () => {
    act(() => tab('기본 정보').click())
    const text = host.querySelector('.hub-info')!.textContent!
    for (const k of ['상태', '담당', '마감', '열린 일', '건강도']) expect(text).toContain(t(k))
    expect(text).toContain('active')
    expect(text).toContain('민수')
    expect(text).toContain(t('{n}일 남음', { n: 29 })) // 11-11 → 12-10
    expect(text).toContain('2/2')
  })

  it('건강도 신호(기한 지난 일 등)를 한 줄씩 보여 준다', () => {
    act(() => tab('기본 정보').click())
    expect(host.querySelector('.hub-info-level')).not.toBeNull()
    expect(host.querySelector('.hub-info-signals')!.textContent).toContain(t('기한 지난 일 {n}', { n: 1 }))
  })

  it('건강도가 정상이 아니면 제목 옆에 작은 배지가 있고, 누르면 기본 정보 탭이 열린다', () => {
    const badge = host.querySelector<HTMLButtonElement>('.hub-badge')
    expect(badge).not.toBeNull()
    act(() => badge!.click())
    expect(tab('기본 정보').getAttribute('aria-selected')).toBe('true')
  })

  it('노트로 열기 버튼이 프로젝트 노트를 연다', () => {
    act(() => tab('기본 정보').click())
    act(() => host.querySelector<HTMLButtonElement>('.hub-info .link-btn')!.click())
    expect(useApp.getState().current).toBe(PROJECT)
  })
})

describe('프로젝트 허브: 보드 끌기(포인터)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const q = <T extends Element>(sel: string) => [...host.querySelectorAll<T>(sel)]
  const text = (p = TASKS) => useApp.getState().files[p].content
  const col = (title: string) => q('.board-col').find((c) => c.querySelector('h3')!.textContent!.startsWith(t(title)))!
  const titles = (title: string) => [...col(title).querySelectorAll('.board-card .wrk-title')].map((x) => x.textContent)
  const order = () => text().split('\n').filter((l) => l.startsWith('- [ ]')).map((l) => l.slice(6, 7))
  const openBoard = () => act(() => q<HTMLButtonElement>('.hub-tabs [role="tab"]')[1].click())
  const manual = () => act(() => q<HTMLButtonElement>('.board-tools .seg-mini button').find((b) => b.textContent === t('직접 정렬'))!.click())
  const card = (title: string) => q<HTMLElement>('.board-card').find((c) => c.querySelector('.wrk-title')!.textContent === title)!

  // 포인터 이벤트를 흉내 낸다(jsdom 에는 PointerEvent 가 없어 MouseEvent 에 속성을 붙인다). elementFromPoint 는 "지금 손가락 아래에 있는 요소"를 직접 정해 준다
  let under: Element | null = null
  const ptr = (type: string, target: EventTarget, x: number, y: number, pointerType = 'mouse', id = 1) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    Object.defineProperty(e, 'pointerId', { value: id })
    act(() => {
      target.dispatchEvent(e)
    })
  }
  /** from 카드를 집어서(마우스: 움직이면 바로, 터치: 길게 눌러서) over 요소 위(y: 음수=위쪽 절반, 양수=아래쪽 절반)에 놓는다 */
  const drag = (from: Element, over: Element, y: number, pointerType = 'mouse') => {
    ptr('pointerdown', from, 100, 100, pointerType)
    if (pointerType !== 'mouse') act(() => void vi.advanceTimersByTime(HOLD_MS + 50))
    under = over
    ptr('pointermove', window, 100, y, pointerType)
    ptr('pointermove', window, 100, y + 1, pointerType)
    ptr('pointerup', window, 100, y, pointerType)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    Element.prototype.scrollIntoView = () => {}
    document.elementFromPoint = () => under as Element | null
    setLang('ko')
    localStorage.clear()
    const files = Object.fromEntries([note(PROJECT, FM), note(TASKS, BODY), note(OTHER, '- [ ] 외부 due:2026-11-30\n')].map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, toast: null, toastUndo: null })
    useWorkUi.setState({ hub: PROJECT, editor: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement('div', null, createElement(ProjectHub), createElement(Dialogs))))
    openBoard()
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useWorkUi.setState({ hub: null, editor: null })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('기본은 마감순이고, 화살표 버튼(▲▼ ‹ ›)은 어디에도 없다', () => {
    expect(titles('할 일')).toEqual(['나', '가', '외부', '다'])
    expect(host.textContent).not.toMatch(/[▲▼‹›]/)
    expect(q('.board-order, .board-move').filter((e) => e.children.length > 0)).toHaveLength(0)
  })

  it('직접 정렬로 바꾸면 노트 → 줄 순서(다른 노트의 카드는 노트 이름 순으로 한 덩어리)로 보이고, 프로젝트별로 기억한다', () => {
    manual()
    expect(titles('할 일')).toEqual(['외부', '가', '나', '다'])
    expect(JSON.parse(localStorage.getItem('nosidian.boardSort')!)[PROJECT]).toBe('manual')
  })

  it('마우스: 다른 카드의 위쪽 절반에 놓으면 그 앞으로, 아래쪽 절반이면 그 뒤로(노트 줄 순서가 바뀐다)', () => {
    manual()
    drag(card('다'), card('가'), -5)
    expect(order()).toEqual(['다', '가', '나', '라'])
    drag(card('다'), card('나'), 5)
    expect(order()).toEqual(['가', '나', '다', '라'])
  })

  it('끄는 동안에는 노트를 바꾸지 않고, 유령 카드와 삽입선을 보이며, 놓으면 사라진다', () => {
    manual()
    const before = text()
    ptr('pointerdown', card('다'), 100, 100)
    under = card('가')
    ptr('pointermove', window, 100, -5)
    expect(host.querySelector('.board-ghost')!.textContent).toBe('다')
    expect(card('가').className).toContain('ins-before')
    expect(card('다').className).toContain('src')
    expect(document.body.classList.contains('board-dragging')).toBe(true)
    expect(text()).toBe(before)
    ptr('pointerup', window, 100, -5)
    expect(host.querySelector('.board-ghost')).toBeNull()
    expect(document.body.classList.contains('board-dragging')).toBe(false)
  })

  it('하위 메모가 있는 업무는 메모와 함께 움직이고, 되돌리기로 복원된다', () => {
    manual()
    const before = text()
    drag(card('가'), card('다'), 5)
    expect(text()).toContain('- [ ] 다\n- [ ] 가 due:2026-11-20\n  - 가 메모')
    act(() => q<HTMLButtonElement>('.toast-undo')[0].click())
    expect(text()).toBe(before)
  })

  it('다른 칸의 카드 위에 놓으면 칸(status)도 바뀌고 그 자리로 들어간다', () => {
    manual()
    drag(card('라'), card('나'), -5) // 진행 중의 라 를 할 일 칸의 나 앞으로
    expect(order()).toEqual(['가', '라', '나', '다'])
    expect(text()).not.toContain('라 status:doing')
  })

  it('빈 칸에 놓으면 칸만 바뀐다(대기)', () => {
    manual()
    drag(card('가'), col('대기'), 5)
    expect(text()).toMatch(/- \[ \] 가 status:waiting side:other due:2026-11-20/)
  })

  it('마감순에서는 같은 칸 카드 위에 놓아도 순서는 그대로, 다른 칸이면 칸만 바뀐다', () => {
    const before = text()
    drag(card('다'), card('가'), -5)
    expect(text()).toBe(before)
    drag(card('나'), col('진행 중'), 5)
    expect(text()).toContain('나 status:doing')
  })

  it('다른 노트의 카드 앞으로는 옮기지 못하고 이유를 알린다', () => {
    manual()
    const before = text()
    drag(card('가'), card('외부'), -5)
    expect(text()).toBe(before)
    expect(useApp.getState().toast).toBe(t('다른 노트에 있는 업무라서 이 자리로는 옮길 수 없어요'))
  })

  it('터치: 길게 눌러야 집힌다(0.35초). 집은 뒤에 끌어 놓으면 옮겨진다', () => {
    manual()
    drag(card('다'), card('가'), -5, 'touch')
    expect(order()).toEqual(['다', '가', '나', '라'])
  })

  it('터치: 길게 누르기 전에 손가락이 움직이면 끌기가 아니라 스크롤이다(아무것도 바뀌지 않음)', () => {
    manual()
    const before = text()
    ptr('pointerdown', card('다'), 100, 100, 'touch')
    under = card('가')
    ptr('pointermove', window, 100, 130, 'touch') // 30px 이동 = 스크롤하려는 것
    act(() => void vi.advanceTimersByTime(HOLD_MS + 50))
    expect(host.querySelector('.board-ghost')).toBeNull()
    ptr('pointerup', window, 100, 130, 'touch')
    expect(text()).toBe(before)
  })

  it('터치: 짧게 누르고 떼면 끌기가 아니라 눌림이라 편집기가 열린다', () => {
    ptr('pointerdown', card('나'), 100, 100, 'touch')
    act(() => void vi.advanceTimersByTime(100))
    ptr('pointerup', window, 100, 100, 'touch')
    act(() => card('나').querySelector<HTMLButtonElement>('.board-body')!.click())
    expect(useWorkUi.getState().editor?.task?.title).toBe('나')
  })

  it('끌고 난 직후의 클릭은 편집기를 열지 않는다', () => {
    manual()
    drag(card('다'), card('가'), -5)
    act(() => card('다').querySelector<HTMLButtonElement>('.board-body')!.click())
    expect(useWorkUi.getState().editor).toBeNull()
  })

  it('Esc 로 끌기를 취소한다', () => {
    manual()
    const before = text()
    ptr('pointerdown', card('다'), 100, 100)
    under = card('가')
    ptr('pointermove', window, 100, -5)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    ptr('pointerup', window, 100, -5)
    expect(text()).toBe(before)
    expect(host.querySelector('.board-ghost')).toBeNull()
  })

  it('키보드: Alt+↓ 로 한 칸 뒤로, Alt+→ 로 이웃 칸으로', () => {
    manual()
    const key = (el: Element, k: string) =>
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey: true, bubbles: true, cancelable: true }))
      })
    key(card('가').querySelector('.board-body')!, 'ArrowDown')
    expect(order()).toEqual(['나', '가', '다', '라'])
    key(card('가').querySelector('.board-body')!, 'ArrowRight')
    expect(text()).toMatch(/가 status:doing/)
  })
})
