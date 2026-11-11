import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkHome } from './WorkHome'
import { useApp } from '../lib/app'
import { useWorkUi } from '../lib/workOps'
import { buildIndex } from '../lib/links'
import { defaultLayout, enableTile } from '../lib/tiles'
import { presetLayout } from '../lib/persona'
import { t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const withProject = [note('프로젝트/과제/프로젝트 개요.md', '---\ntype: project\nstatus: active\n---\n# 과제\n'), note('프로젝트/과제/할 일.md', '- [ ] 보고서\n')]

describe('학생 구성의 홈: 프로젝트가 생기면 프로젝트 타일이 저절로 나타난다', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const mount = (notes: NoteFile[], layout = presetLayout('student', defaultLayout(), [])) => {
    const files = Object.fromEntries(notes.map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(notes.map((f) => ({ path: f.path, content: f.content }))), ready: true })
    useWorkUi.setState({ layout, editing: false })
    act(() => root.render(createElement(WorkHome)))
  }
  const titles = () => [...host.querySelectorAll('.wrk-tname')].map((x) => x.textContent)

  it('프로젝트가 없으면 보이지 않는다(가볍게 시작)', () => {
    mount([])
    expect(titles()).not.toContain(t('프로젝트'))
  })
  it('프로젝트가 하나라도 있으면 보이고, 눌러서 허브로 갈 수 있다', () => {
    mount(withProject)
    expect(titles()).toContain(t('프로젝트'))
    expect(host.querySelector('.wrk-projrow')).not.toBeNull()
  })
  it('받은 업무만 있고(프로젝트 없음) 프로젝트 타일도 없으면 "+ 새 프로젝트" 링크로 첫 프로젝트를 만들 수 있다', () => {
    mount([note('받은 업무.md', '- [ ] 과제 제출\n')])
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t('새 프로젝트')))
    expect(btn).toBeTruthy()
    act(() => btn!.click())
    expect(useWorkUi.getState().wizard).toBe(true)
  })
  it('프로젝트 타일이 보이는 동안에는 링크를 따로 두지 않는다(타일 안에 이미 있다)', () => {
    mount(withProject)
    expect(host.querySelectorAll('.wrk-newproj').length).toBe(1)
  })
  it('사용자가 직접 켠 뒤에는 프로젝트가 없어도 보인다(auto 해제)', () => {
    mount([], enableTile(presetLayout('student', defaultLayout(), []), [], 'projects'))
    expect(titles()).toContain(t('프로젝트'))
  })
  it('기획자 구성(프로젝트 타일 있음)은 예전 그대로', () => {
    mount(withProject, presetLayout('planner', defaultLayout(), []))
    expect(titles()).toContain(t('프로젝트'))
  })
})
