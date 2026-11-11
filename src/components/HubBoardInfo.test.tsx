import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectHub } from './ProjectHub'
import { Dialogs } from './Dialogs'
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

describe('프로젝트 허브: 보드 순서 바꾸기', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const q = <T extends Element>(s: string) => [...host.querySelectorAll<T>(s)]
  const text = (p = TASKS) => useApp.getState().files[p].content
  const col = (title: string) => q('.board-col').find((c) => c.querySelector('h3')!.textContent!.startsWith(t(title)))!
  const titles = (title: string) => [...col(title).querySelectorAll('.board-card .wrk-title')].map((x) => x.textContent)
  const openBoard = () => act(() => q<HTMLButtonElement>('.hub-tabs [role="tab"]')[1].click())
  const manual = () => act(() => q<HTMLButtonElement>('.board-tools .seg-mini button').find((b) => b.textContent === t('직접 정렬'))!.click())
  const card = (title: string) => q<HTMLElement>('.board-card').find((c) => c.querySelector('.wrk-title')!.textContent === title)!
  const dnd = (type: string, el: Element, id: string, clientY = 0) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY })
    Object.defineProperty(e, 'dataTransfer', { value: { getData: () => id, setData: () => {} } })
    act(() => {
      el.dispatchEvent(e)
    })
  }
  const idOf = (title: string) => {
    const i = text().split('\n').findIndex((l) => l.includes(`] ${title}`))
    return `${TASKS}:${i}`
  }
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
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
  })

  it('기본은 마감순(마감 → 우선순위), 순서 바꾸기 버튼은 없다', () => {
    expect(titles('할 일')).toEqual(['나', '가', '외부', '다'])
    expect(q('.board-order')).toHaveLength(0)
  })

  it('직접 정렬로 바꾸면 노트 → 줄 순서대로(다른 노트의 카드는 노트 이름 순으로 한 덩어리) 보이고 ▲▼ 가 생기며, 프로젝트별로 기억한다', () => {
    manual()
    expect(titles('할 일')).toEqual(['외부', '가', '나', '다'])
    expect(q('.board-order').length).toBeGreaterThan(0)
    expect(JSON.parse(localStorage.getItem('nosidian.boardSort')!)[PROJECT]).toBe('manual')
  })

  it('▼ 로 내리면 노트의 줄 순서가 바뀌고(하위 메모도 같이), 되돌리기로 복원된다', () => {
    manual()
    const before = text()
    act(() => card('가').querySelector<HTMLButtonElement>('.board-order button:last-child')!.click())
    expect(text()).toBe(['# 할 일', '', '- [ ] 나 due:2026-11-15', '- [ ] 가 due:2026-11-20', '  - 가 메모', '- [ ] 다', '- [ ] 라 status:doing due:2026-11-12', ''].join('\n'))
    expect(titles('할 일')).toEqual(['외부', '나', '가', '다'])
    act(() => q<HTMLButtonElement>('.toast-undo')[0].click())
    expect(text()).toBe(before)
  })

  it('칸의 맨 끝 카드의 ▼ 와, 위쪽이 다른 노트의 카드인 ▲ 는 눌리지 않는다', () => {
    manual()
    expect(card('외부').querySelector<HTMLButtonElement>('.board-order button:first-child')!.disabled).toBe(true) // 맨 위
    expect(card('가').querySelector<HTMLButtonElement>('.board-order button:first-child')!.disabled).toBe(true) // 위가 다른 노트의 외부
    expect(card('다').querySelector<HTMLButtonElement>('.board-order button:last-child')!.disabled).toBe(true) // 맨 끝
    expect(card('나').querySelector<HTMLButtonElement>('.board-order button:last-child')!.disabled).toBe(false)
  })

  it('카드를 다른 카드 위쪽에 끌어 놓으면 그 앞으로, 아래쪽이면 그 뒤로', () => {
    manual()
    // 다 를 가 의 위쪽(clientY 가 중간보다 작음)에 놓기
    dnd('drop', card('가'), idOf('다'), -5) // dragover 없이 곧바로 놓아도(이벤트가 연달아 와도) 놓는 순간의 위치로 정한다
    expect(text().split('\n').filter((l) => l.startsWith('- [ ]')).map((l) => l.slice(6, 7))).toEqual(['다', '가', '나', '라'])
  })

  it('다른 칸의 카드 위에 놓으면 칸(status)도 바뀌고 그 자리로 들어간다', () => {
    manual()
    dnd('dragover', card('나'), idOf('라'), -5)
    dnd('drop', card('나'), idOf('라'), -5) // 진행 중의 라 를 할 일 칸의 나 앞으로
    const lines = text().split('\n').filter((l) => l.startsWith('- [ ]'))
    expect(lines.map((l) => l.slice(6, 7))).toEqual(['가', '라', '나', '다'])
    expect(lines[1]).not.toContain('status:doing') // 할 일 칸으로 왔으니 status 가 지워진다
  })

  it('칸의 빈 곳에 놓으면 그 칸의 맨 끝으로(같은 노트일 때)', () => {
    manual()
    dnd('drop', col('대기'), idOf('가')) // 가 를 대기 칸으로: 칸 안에 카드가 없으니 칸만 바뀐다
    expect(text()).toMatch(/- \[ \] 가 status:waiting side:other due:2026-11-20/)
  })

  it('마감순에서는 카드 위에 놓아도 순서는 바뀌지 않는다(칸만 바뀜)', () => {
    const before = text()
    dnd('drop', card('나'), idOf('가')) // 같은 칸의 카드 위에 놓기
    expect(text()).toBe(before)
  })

  it('다른 노트의 카드 앞으로는 옮기지 못하고 이유를 알린다', () => {
    manual()
    const before = text()
    dnd('dragover', card('외부'), idOf('가'), -5)
    dnd('drop', card('외부'), idOf('가'), -5)
    expect(text()).toBe(before)
    expect(useApp.getState().toast).toBe(t('다른 노트에 있는 업무라서 이 자리로는 옮길 수 없어요'))
  })

  it('‹ › 로 칸을 옮겨도 되돌리기가 뜬다', () => {
    act(() => card('나').querySelector<HTMLButtonElement>('.board-move button:last-child')!.click())
    expect(text()).toContain('나 status:doing')
    expect(useApp.getState().toastUndo).not.toBeNull()
  })
})
