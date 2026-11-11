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
