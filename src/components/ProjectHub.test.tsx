import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectHub } from './ProjectHub'
import { useApp } from '../lib/app'
import { useWorkUi } from '../lib/workOps'
import { buildIndex } from '../lib/links'
import { t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const PROJECT = '프로젝트/시험/프로젝트 개요.md'

describe('프로젝트 허브의 업무 추가', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    const files = Object.fromEntries([
      note(PROJECT, '---\ntype: project\nstatus: active\n---\n# 시험\n'),
      note('프로젝트/시험/할 일.md', '- [ ] 첫 일\n'),
    ].map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true })
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
  })

  it('목록 안에 글자가 있는 "+ 업무 추가" 버튼이 있다(헤더 아이콘만 있던 문제)', () => {
    const btn = host.querySelector<HTMLButtonElement>('.hub-addtask')
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toContain(t('업무 추가'))
  })
  it('누르면 이 프로젝트에 넣는 새 업무 편집기가 열린다', () => {
    act(() => host.querySelector<HTMLButtonElement>('.hub-addtask')!.click())
    const ed = useWorkUi.getState().editor
    expect(ed).not.toBeNull()
    expect(ed!.project).toBe(PROJECT)
    expect(ed!.task).toBeUndefined()
  })
  it('프로젝트 요약 칩 이름이 "건강도"이고 "문서 점검" 탭과 겹치지 않는다', () => {
    const chips = [...host.querySelectorAll('.hub-chip small')].map((x) => x.textContent)
    expect(chips).toContain(t('건강도'))
    expect(chips).not.toContain(t('점검'))
  })
})

describe('프로젝트 허브의 보기 탭', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('.hub-tabs [role="tab"]')]
  const chips = () => [...host.querySelectorAll<HTMLButtonElement>('.hub-views [role="tab"]')]
  const mount = () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement(ProjectHub)))
  }
  beforeEach(() => {
    localStorage.clear()
    const files = Object.fromEntries([
      note(PROJECT, '---\ntype: project\nstatus: active\n---\n# 시험\n'),
      note('프로젝트/시험/할 일.md', '- [ ] 첫 일 due:2026-12-01\n'),
    ].map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true })
    useWorkUi.setState({ hub: PROJECT, editor: null })
    mount()
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useWorkUi.setState({ hub: null, editor: null })
  })

  it('1단 탭은 4개(할 일·보기·문서·문서 점검)이고 보기 탭에 현재 보기 이름이 붙는다', () => {
    expect(tabs().map((b) => b.textContent)).toEqual([t('할 일'), `${t('보기')} · ${t('보드')}`, t('문서'), t('문서 점검')])
    expect(host.querySelector('.hub-views')).toBeNull() // 보기 탭을 열기 전에는 칩 줄이 없다
  })
  it('보기 탭을 열면 칩 줄이 보이고 기본은 보드(칸반)다', () => {
    act(() => tabs()[1].click())
    expect(chips().map((b) => b.textContent)).toEqual([t('보드'), t('타임라인'), t('표'), t('담당자별')])
    expect(chips()[0].getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('.board')).not.toBeNull()
  })
  it('타임라인 칩을 고르면 그 화면이 열리고, 탭 이름이 바뀌고, 다시 열어도 기억한다', () => {
    act(() => tabs()[1].click())
    act(() => chips()[1].click())
    expect(host.querySelector('.tl')).not.toBeNull()
    expect(host.querySelector('.board')).toBeNull()
    expect(tabs()[1].textContent).toBe(`${t('보기')} · ${t('타임라인')}`)
    act(() => root.unmount())
    host.remove()
    mount() // 허브를 닫았다 다시 연 것과 같다
    expect(tabs()[1].textContent).toBe(`${t('보기')} · ${t('타임라인')}`)
    act(() => tabs()[1].click())
    expect(host.querySelector('.tl')).not.toBeNull()
  })
  it('좌우 화살표로 칩을 옮기며 고른다', () => {
    act(() => tabs()[1].click())
    chips()[0].focus()
    act(() => {
      chips()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(chips()[1].getAttribute('aria-selected')).toBe('true')
  })
})
