import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectHub } from './ProjectHub'
import { Dialogs } from './Dialogs'
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
const BODY = ['- [ ] 가 장소 due:2026-11-20 owner:민수', '- [ ] 나 케이터링 due:2026-11-10 owner:지현 status:doing', '- [ ] 다 정산', '- [x] 라 끝난 일 owner:민수'].join('\n') + '\n'

describe('프로젝트 허브: 표·담당자별 보기', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const q = <T extends Element>(s: string) => [...host.querySelectorAll<T>(s)]
  const openView = (label: string) => {
    act(() => q<HTMLButtonElement>('.hub-tabs [role="tab"]')[1].click())
    act(() => q<HTMLButtonElement>('.hub-views [role="tab"]').find((b) => b.textContent === t(label))!.click())
  }
  const setValue = (el: HTMLInputElement, v: string) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  beforeEach(() => {
    setLang('ko')
    localStorage.clear()
    const files = Object.fromEntries([note(PROJECT, '---\ntype: project\nstatus: active\n---\n# 시험\n'), note(TASKS, BODY)].map((f) => [f.path, f]))
    useApp.setState({
      files,
      index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))),
      ready: true,
      toast: null,
      toastUndo: null,
      settings: { ...useApp.getState().settings, myName: '지현' },
    })
    useWorkUi.setState({ hub: PROJECT, editor: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement('div', null, createElement(ProjectHub), createElement(Dialogs))))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useWorkUi.setState({ hub: null, editor: null })
  })

  it('칩에 표·담당자별이 있다', () => {
    act(() => q<HTMLButtonElement>('.hub-tabs [role="tab"]')[1].click())
    expect(q('.hub-views [role="tab"]').map((b) => b.textContent)).toEqual([t('보드'), t('타임라인'), t('표'), t('담당자별')])
  })

  describe('표', () => {
    it('열린 일만 한 줄씩(완료 제외), 기본은 마감 빠른 순', () => {
      openView('표')
      expect(q('.tbl-row .tbl-title').map((b) => b.textContent)).toEqual(['나 케이터링', '가 장소', '다 정산'])
    })
    it('완료 포함을 켜면 끝난 일도 나온다', () => {
      openView('표')
      act(() => q<HTMLButtonElement>('.hub-filter button').find((b) => b.textContent === t('완료 포함'))!.click())
      expect(q('.tbl-row')).toHaveLength(4)
    })
    it('열 머리를 누르면 그 열로 정렬하고 다시 누르면 반대로(aria-sort)', () => {
      openView('표')
      const head = () => q<HTMLButtonElement>('.tbl-head [role="columnheader"]').find((b) => b.textContent!.startsWith(t('제목')))!
      act(() => head().click())
      expect(head().getAttribute('aria-sort')).toBe('ascending')
      expect(q('.tbl-row .tbl-title').map((b) => b.textContent)).toEqual(['가 장소', '나 케이터링', '다 정산'])
      act(() => head().click())
      expect(head().getAttribute('aria-sort')).toBe('descending')
      expect(q('.tbl-row .tbl-title').map((b) => b.textContent)).toEqual(['다 정산', '나 케이터링', '가 장소'])
    })
    it('마감을 그 자리에서 고치면 노트의 그 줄만 바뀌고, 되돌리기가 뜨고, 누르면 원래대로', () => {
      openView('표')
      const before = useApp.getState().files[TASKS].content
      const dates = q<HTMLInputElement>('.tbl-date')
      expect(dates[1].value).toBe('2026-11-20') // 가 장소
      setValue(dates[1], '2026-12-05')
      const after = useApp.getState().files[TASKS].content
      expect(after).toContain('가 장소')
      expect(after).toContain('due:2026-12-05')
      expect(after.split('\n').filter((l) => !l.includes('가 장소'))).toEqual(before.split('\n').filter((l) => !l.includes('가 장소'))) // 다른 줄은 그대로
      expect(useApp.getState().toast).toContain('2026-12-05')
      const undo = q<HTMLButtonElement>('.toast-undo')[0]
      expect(undo).toBeTruthy()
      act(() => undo.click())
      expect(useApp.getState().files[TASKS].content).toBe(before)
    })
    it('마감을 비우면 지운다', () => {
      openView('표')
      setValue(q<HTMLInputElement>('.tbl-date')[1], '')
      expect(buildWork(useApp.getState().files).tasks.find((x) => x.title.startsWith('가'))!.due).toBeUndefined()
    })
  })

  describe('담당자별', () => {
    it('나 → 담당 없음 → 나머지 순으로 구역이 나오고 머리줄에 열린 일 수가 있다', () => {
      openView('담당자별')
      const heads = q('.own-head').map((h) => h.textContent!)
      expect(heads[0]).toContain('지현')
      expect(heads[0]).toContain(t('나'))
      expect(heads[1]).toContain(t('담당 없음'))
      expect(heads[2]).toContain('민수')
      expect(heads[2]).toContain(t('열린 {n}', { n: 1 })) // 라(완료)는 열린 일이 아니다
    })
    it('처음엔 나와 담당 없음만 펼쳐져 있고, 머리줄을 누르면 연다', () => {
      openView('담당자별')
      const heads = q<HTMLButtonElement>('.own-head')
      expect(heads.map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'false'])
      act(() => heads[2].click())
      expect(q<HTMLButtonElement>('.own-head')[2].getAttribute('aria-expanded')).toBe('true')
    })
    it('일을 다른 사람 구역으로 끌어 놓으면 담당이 바뀌고 되돌리기가 뜬다', () => {
      openView('담당자별')
      const target = buildWork(useApp.getState().files).tasks.find((x) => x.title.startsWith('다'))! // 담당 없음 → 지현
      const lane = q('.own-lane')[0] // 지현
      const ev = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => target.id } })
      act(() => {
        lane.dispatchEvent(ev)
      })
      expect(useApp.getState().files[TASKS].content).toMatch(/다 정산.*owner:지현/)
      expect(useApp.getState().toastUndo).not.toBeNull()
    })
    it('내 것만을 켜면 내 일만 남는다', () => {
      openView('담당자별')
      act(() => q<HTMLButtonElement>('.hub-filter button').find((b) => b.textContent === t('내 것만'))!.click())
      expect(q('.own-lane')).toHaveLength(1)
    })
  })
})
