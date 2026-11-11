import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteTasksSheet } from './NoteTasksSheet'
import { Dialogs } from './Dialogs'
import { useApp } from '../lib/app'
import { useWorkUi } from '../lib/workOps'
import { buildIndex } from '../lib/links'
import { buildWork } from '../lib/work'
import { setLang, t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const PROJECT = '프로젝트/행사/프로젝트 개요.md'
const MINUTES = '프로젝트/행사/회의록.md'
const BODY = ['# 회의록 11-11', '', '## 후속 업무', '- [ ] 행사장 계약서 검토 (민수, 11/18까지)', '- [ ] 케이터링 견적 3곳 받기 (지현)', '- [ ] 포스터 시안 2안 만들기', '- [x] 끝난 일', ''].join('\n')

describe('노트 업무 정리 화면 (F24)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const q = <T extends Element>(s: string) => [...host.querySelectorAll<T>(s)]
  const text = () => useApp.getState().files[MINUTES].content
  const setValue = (el: HTMLInputElement, v: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const open = (content = BODY) => {
    const files = Object.fromEntries([note(PROJECT, '---\ntype: project\n---\n# 행사\n'), note(MINUTES, content)].map((f) => [f.path, f]))
    useApp.setState({
      files,
      index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))),
      ready: true,
      toast: null,
      toastUndo: null,
      settings: { ...useApp.getState().settings, myName: '민수, 지현' },
    })
    act(() => useWorkUi.getState().openTidy(MINUTES))
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
    setLang('ko')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement('div', null, createElement(NoteTasksSheet), createElement(Dialogs))))
  })
  afterEach(() => {
    act(() => useWorkUi.getState().closeTidy())
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  it('열린 할 일 줄만 행으로 나오고, (민수, 11/18까지)·(지현)을 읽어 미리 채운다(확인 표시 포함)', () => {
    open()
    expect(q('.nt-row')).toHaveLength(3)
    const [a, b, c] = q<HTMLElement>('.nt-row')
    expect(a.querySelector<HTMLInputElement>('.nt-title')!.value).toBe('행사장 계약서 검토')
    expect(a.querySelector<HTMLInputElement>('.nt-owner')!.value).toBe('민수')
    expect(a.querySelector<HTMLInputElement>('.nt-due')!.value).toBe('2026-11-18')
    expect(a.querySelector('.nt-hint')!.textContent).toContain('행사장 계약서 검토 (민수, 11/18까지)') // 원문
    expect(b.querySelector<HTMLInputElement>('.nt-owner')!.value).toBe('지현')
    expect(c.querySelector('.nt-hint')).toBeNull() // 읽을 게 없는 줄
    expect(c.querySelector<HTMLInputElement>('.nt-owner')!.value).toBe('')
  })

  it('적용 버튼은 바뀐 줄 수를 보여 주고, 바뀐 게 없으면 눌리지 않는다', () => {
    open(['- [ ] 그냥 할 일', ''].join('\n'))
    const btn = q<HTMLButtonElement>('.ee-foot .primary')[0]
    expect(btn.disabled).toBe(true)
    setValue(q<HTMLInputElement>('.nt-owner')[0], '민수')
    expect(q<HTMLButtonElement>('.ee-foot .primary')[0].disabled).toBe(false)
    expect(q<HTMLButtonElement>('.ee-foot .primary')[0].textContent).toBe(t('{n}개 적용', { n: 1 }))
  })

  it('적용하면 바뀐 줄만 꼬리표로 다시 쓰이고, 알림에서 되돌리기로 복원되며, 화면은 닫힌다', () => {
    open()
    const before = text()
    act(() => q<HTMLButtonElement>('.ee-foot .primary')[0].click())
    const lines = text().split('\n')
    expect(lines[3]).toBe('- [ ] 행사장 계약서 검토 due:2026-11-18 owner:민수')
    expect(lines[4]).toBe('- [ ] 케이터링 견적 3곳 받기 owner:지현')
    expect(lines[5]).toBe('- [ ] 포스터 시안 2안 만들기')
    expect(lines[6]).toBe('- [x] 끝난 일')
    expect(useApp.getState().toast).toBe(t('업무 {n}개를 정리했어요', { n: 2 }))
    expect(useWorkUi.getState().tidy).toBeNull()
    act(() => q<HTMLButtonElement>('.toast-undo')[0].click())
    expect(text()).toBe(before)
  })

  it('사람이 고친 값(제목·담당 추가·마감·결정)이 적용되고 허브 업무로 읽힌다', () => {
    open()
    const rows = q<HTMLElement>('.nt-row')
    setValue(rows[2].querySelector<HTMLInputElement>('.nt-owner')!, '지현, 민수')
    setValue(rows[2].querySelector<HTMLInputElement>('.nt-due')!, '2026-11-25')
    act(() => rows[2].querySelector<HTMLButtonElement>('.nt-dec')!.click())
    setValue(rows[0].querySelector<HTMLInputElement>('.nt-due')!, '') // 읽어 채운 마감 지우기
    act(() => q<HTMLButtonElement>('.ee-foot .primary')[0].click())
    const tasks = buildWork(useApp.getState().files).tasks
    expect(tasks.find((x) => x.title === '포스터 시안 2안 만들기')).toMatchObject({ owner: ['지현', '민수'], due: '2026-11-25', kind: 'decision' })
    expect(tasks.find((x) => x.title === '행사장 계약서 검토')).toMatchObject({ owner: ['민수'] })
    expect(tasks.find((x) => x.title === '행사장 계약서 검토')!.due).toBeUndefined()
  })

  it('취소·Esc·바깥 클릭으로 닫으면 노트는 그대로다', () => {
    open()
    const before = text()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(useWorkUi.getState().tidy).toBeNull()
    expect(text()).toBe(before)
    open()
    act(() => q<HTMLButtonElement>('.ee-foot button')[0].click()) // 취소
    expect(useWorkUi.getState().tidy).toBeNull()
    expect(text()).toBe(before)
  })

  it('열린 할 일 줄이 없으면 안내 문구를 보인다', () => {
    open('# 메모\n\n그냥 글\n')
    expect(q('.nt-row')).toHaveLength(0)
    expect(host.textContent).toContain(t('이 노트에는 열린 할 일 줄(- [ ])이 없어요.'))
  })
})
