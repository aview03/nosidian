import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectHub } from './ProjectHub'
import { Dialogs } from './Dialogs'
import { TaskEditor } from './TaskEditor'
import { useApp } from '../lib/app'
import { useWorkUi } from '../lib/workOps'
import { buildIndex } from '../lib/links'
import { buildWork } from '../lib/work'
import { setLang, t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const PROJECT = '프로젝트/시험/프로젝트 개요.md'
const TASKS = '프로젝트/시험/할 일.md'
const BODY = ['- [ ] 가 장소 start:2026-11-12 due:2026-11-16 owner:민수', '- [ ] 나 현수막 due:2026-11-20', '- [ ] 다 정산', '- [x] 라 끝난 일 start:2026-11-01 due:2026-11-05'].join('\n') + '\n'

describe('프로젝트 허브: 간트 보기', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const q = <T extends Element>(s: string) => [...host.querySelectorAll<T>(s)]
  const openGantt = () => {
    act(() => q<HTMLButtonElement>('.hub-tabs [role="tab"]')[1].click())
    act(() => q<HTMLButtonElement>('.hub-views [role="tab"]').find((b) => b.textContent === t('간트'))!.click())
  }
  const text = () => useApp.getState().files[TASKS].content
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {} // jsdom 에는 없다(Select 목록이 쓴다)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
    setLang('ko')
    localStorage.clear()
    const files = Object.fromEntries([note(PROJECT, '---\ntype: project\nstatus: active\ndue: 2026-12-10\n---\n# 시험\n'), note(TASKS, BODY)].map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, toast: null, toastUndo: null })
    useWorkUi.setState({ hub: PROJECT, editor: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement('div', null, createElement(ProjectHub), createElement(TaskEditor), createElement(Dialogs))))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useWorkUi.setState({ hub: null, editor: null })
    vi.useRealTimers()
  })

  it('칩에 간트가 보드 다음에 있다', () => {
    act(() => q<HTMLButtonElement>('.hub-tabs [role="tab"]')[1].click())
    expect(q('.hub-views [role="tab"]').map((b) => b.textContent)).toEqual([t('보드'), t('간트'), t('타임라인'), t('표'), t('담당자별')])
  })

  it('시작~마감은 막대, 마감만 있으면 마름모, 날짜 없는 일은 아래 목록(완료는 기본 제외)', () => {
    openGantt()
    expect(q('.g-bar')).toHaveLength(1)
    expect(q('.g-pt')).toHaveLength(1)
    expect(q('.g-label').map((l) => l.textContent).filter((x) => /^[가나]/.test(x ?? '')).length).toBe(2)
    expect(q('.g-undated .wrk-row')).toHaveLength(1) // 다 정산
    expect(host.textContent).not.toContain('끝난 일')
  })

  it('막대에 접근성 이름(제목·기간·상태)이 있다', () => {
    openGantt()
    const label = q<HTMLButtonElement>('.g-bar')[0].getAttribute('aria-label')!
    expect(label).toContain('가 장소')
    expect(label).toContain('2026-11-12 ~ 2026-11-16')
    expect(label).toContain(t('할 일'))
  })

  it('프로젝트 마감 깃발과 오늘 선이 있다', () => {
    openGantt()
    expect(q('.g-flag')).toHaveLength(1)
    expect(q('.g-today').length).toBeGreaterThan(0)
  })

  it('눈금(주/월)을 바꿔도 막대는 그대로 있다', () => {
    openGantt()
    const w1 = q<HTMLButtonElement>('.g-bar')[0].style.width
    act(() => q<HTMLButtonElement>('.g-scale button').find((b) => b.textContent === t('월'))!.click())
    expect(q('.g-bar')).toHaveLength(1)
    expect(q<HTMLButtonElement>('.g-bar')[0].style.width).not.toBe(w1)
  })

  it('Alt+→ 로 하루 뒤로 옮기면 시작·마감이 같이 바뀌고 되돌리기가 뜬다', () => {
    openGantt()
    const before = text()
    act(() => {
      q<HTMLButtonElement>('.g-bar')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }))
    })
    expect(text()).toContain('start:2026-11-13')
    expect(text()).toContain('due:2026-11-17')
    expect(useApp.getState().toast).toContain('2026-11-13')
    act(() => q<HTMLButtonElement>('.toast-undo')[0].click())
    expect(text()).toBe(before)
  })

  it('Alt+Shift+→ 는 마감만 하루 늘린다', () => {
    openGantt()
    act(() => {
      q<HTMLButtonElement>('.g-bar')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    })
    const tk = buildWork(useApp.getState().files).tasks.find((x) => x.title.startsWith('가'))!
    expect(tk).toMatchObject({ start: '2026-11-12', due: '2026-11-17' })
  })

  it('마름모를 옮기면 마감만 바뀐다', () => {
    openGantt()
    act(() => {
      q<HTMLButtonElement>('.g-pt')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }))
    })
    const tk = buildWork(useApp.getState().files).tasks.find((x) => x.title.startsWith('나'))!
    expect(tk.due).toBe('2026-11-19')
    expect(tk.start).toBeUndefined()
  })

  it('마우스로 끌어 옮기면(PC) 끝난 뒤에 한 번만 저장하고, 터치로는 끌리지 않는다', () => {
    openGantt()
    const bar = () => q<HTMLButtonElement>('.g-bar')[0]
    bar().setPointerCapture = () => {}
    const ptr = (type: string, x: number, pointerType = 'mouse') => {
      const e = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true })
      Object.defineProperty(e, 'pointerType', { value: pointerType })
      Object.defineProperty(e, 'pointerId', { value: 1 })
      return e
    }
    // 터치: 아무 일도 없다
    act(() => {
      bar().dispatchEvent(ptr('pointerdown', 100, 'touch'))
      bar().dispatchEvent(ptr('pointermove', 160, 'touch'))
      bar().dispatchEvent(ptr('pointerup', 160, 'touch'))
    })
    expect(text()).toBe(BODY)
    // 마우스: 하루 폭(28px)의 2배쯤 오른쪽으로 → +2일
    act(() => {
      bar().dispatchEvent(ptr('pointerdown', 100))
      bar().dispatchEvent(ptr('pointermove', 100 + 28 * 2))
    })
    expect(text()).toBe(BODY) // 끄는 중에는 노트를 바꾸지 않는다
    act(() => {
      bar().dispatchEvent(ptr('pointerup', 100 + 28 * 2))
    })
    expect(text()).toContain('start:2026-11-14')
    expect(text()).toContain('due:2026-11-18')
  })

  it('왼쪽 끝 손잡이를 끌면 시작만 바뀐다', () => {
    openGantt()
    const bar = q<HTMLButtonElement>('.g-bar')[0]
    bar.setPointerCapture = () => {}
    const handle = bar.querySelector<HTMLElement>('.g-h.l')!
    const ptr = (type: string, x: number, target: Element) => {
      const e = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true })
      Object.defineProperty(e, 'pointerType', { value: 'mouse' })
      Object.defineProperty(e, 'pointerId', { value: 1 })
      target.dispatchEvent(e)
    }
    act(() => {
      ptr('pointerdown', 100, handle)
      ptr('pointermove', 100 - 28, bar)
      ptr('pointerup', 100 - 28, bar)
    })
    const tk = buildWork(useApp.getState().files).tasks.find((x) => x.title.startsWith('가'))!
    expect(tk).toMatchObject({ start: '2026-11-11', due: '2026-11-16' })
  })

  it('묶기: 담당자별로 묶으면 머리줄이 생긴다', () => {
    openGantt()
    expect(q('.g-grouphead')).toHaveLength(0)
    act(() => q<HTMLButtonElement>('.g-groupsel')[0].click())
    act(() => document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click())
    expect(q('.g-grouphead').length).toBeGreaterThan(0)
  })

  it('편집기에서 시작일을 정할 수 있고, 마감보다 늦으면 저장할 수 없다', () => {
    openGantt()
    const tk = buildWork(useApp.getState().files).tasks.find((x) => x.title.startsWith('다'))!
    act(() => useWorkUi.getState().openEditor(tk))
    const dates = [...document.body.querySelectorAll<HTMLInputElement>('.ee input[type="date"]')]
    expect(dates).toHaveLength(2) // 마감일, 시작일
    const set = (el: HTMLInputElement, v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
    set(dates[0], '2026-11-20') // 마감
    set(dates[1], '2026-11-25') // 시작이 더 늦다
    const save = [...document.body.querySelectorAll<HTMLButtonElement>('.ee-foot .primary')][0]
    expect(save.disabled).toBe(true)
    expect(document.body.textContent).toContain(t('시작일이 마감일보다 늦어요. 날짜를 고쳐 주세요.'))
    set(dates[1], '2026-11-18')
    expect(save.disabled).toBe(false)
    act(() => save.click())
    expect(buildWork(useApp.getState().files).tasks.find((x) => x.title.startsWith('다'))).toMatchObject({ start: '2026-11-18', due: '2026-11-20' })
  })
})

describe('간트: 빈 상태', () => {
  it('날짜가 있는 업무가 없으면 이유를 알려 준다', () => {
    setLang('ko')
    localStorage.clear()
    const files = Object.fromEntries([note(PROJECT, '---\ntype: project\n---\n# 시험\n'), note(TASKS, '- [ ] 가\n')].map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true })
    useWorkUi.setState({ hub: PROJECT, editor: null })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ProjectHub)))
    act(() => host.querySelectorAll<HTMLButtonElement>('.hub-tabs [role="tab"]')[1].click())
    act(() => [...host.querySelectorAll<HTMLButtonElement>('.hub-views [role="tab"]')].find((b) => b.textContent === t('간트'))!.click())
    expect(host.textContent).toContain(t('시작일이나 마감일이 있는 업무가 없어요. 업무에 날짜를 넣으면 여기에 막대로 나타나요.'))
    expect(host.querySelectorAll('.g-undated .wrk-row')).toHaveLength(1)
    act(() => root.unmount())
    host.remove()
    useWorkUi.setState({ hub: null, editor: null })
  })
})
