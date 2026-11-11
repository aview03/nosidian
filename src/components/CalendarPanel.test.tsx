import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayPanel, QuickAdd } from './Calendar'
import { useApp } from '../lib/app'
import { useCal } from '../lib/calendar'
import { buildIndex } from '../lib/links'
import { setLang, t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const TODAY = '2026-11-11'

describe('빠른 입력: 보고 있는 날짜를 옮기지 않는다 (F22)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const type = (v: string) =>
    act(() => {
      const i = host.querySelector<HTMLInputElement>('.quick-add input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(i, v)
      i.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const add = () => act(() => host.querySelector<HTMLButtonElement>('.quick-add .primary')!.click())
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
    setLang('ko')
    useApp.setState({ files: {}, index: buildIndex([]), ready: true, toast: null, toastUndo: null })
    useCal.setState({ sel: TODAY })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement(QuickAdd, { date: TODAY })))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  it('다른 날짜에 넣어도 선택한 날은 그대로이고, 어느 날에 들어갔는지 알려 준다', () => {
    type('11월 20일 수학 과제 제출')
    add()
    expect(useCal.getState().sel).toBe(TODAY)
    const toast = useApp.getState().toast!
    expect(toast).toContain('11월 20일')
    expect(toast).toBe(t('{day}에 추가했어요', { day: toast.replace(/에 추가했어요$/, '') }))
    // 일정은 그 날짜의 Daily 노트에 들어갔다
    const paths = Object.keys(useApp.getState().files)
    expect(paths.some((p) => p.includes('2026-11-20'))).toBe(true)
    expect(Object.values(useApp.getState().files).some((f) => f.content.includes('수학 과제 제출'))).toBe(true)
  })

  it('보고 있는 날에 넣으면 알림 없이 입력창만 비운다', () => {
    type('오늘 영어 단어 외우기')
    add()
    expect(useApp.getState().toast).toBeNull()
    expect(host.querySelector<HTMLInputElement>('.quick-add input')!.value).toBe('')
  })
})

describe('캘린더 오른쪽 패널: 일정 목록을 접어 노트를 넓힌다 (F23)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const mount = () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement(DayPanel)))
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
    setLang('ko')
    localStorage.clear()
    const files = Object.fromEntries([note('Daily/2026-11-12.md', '# 2026-11-12\n\n## 할 일\n- [ ] 치과 예약\n- [ ] 영어 숙제\n')].map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true })
    useCal.setState({ sel: TODAY }) // 노트가 없는 날이라 편집기(CodeMirror)는 그리지 않는다
    mount()
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })
  const toggle = () => host.querySelector<HTMLButtonElement>('.day-toggle')!

  it('기본은 펼쳐져 있고 일정 개수가 보인다', () => {
    expect(host.querySelector('.day-events')).not.toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(toggle().textContent).toContain(t('일정 {n}개', { n: 0 }))
  })

  it('누르면 일정 목록이 접히고, 다시 열어도 접힌 채로 기억한다', () => {
    act(() => toggle().click())
    expect(host.querySelector('.day-events')).toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    act(() => root.unmount())
    host.remove()
    mount()
    expect(host.querySelector('.day-events')).toBeNull()
    act(() => toggle().click())
    expect(host.querySelector('.day-events')).not.toBeNull()
  })

  it('날짜를 바꾸면 그날의 일정 개수가 바뀐다', () => {
    act(() => useCal.setState({ sel: '2026-11-12' }))
    expect(toggle().textContent).toContain(t('일정 {n}개', { n: 2 }))
  })
})
