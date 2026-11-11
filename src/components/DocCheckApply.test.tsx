import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocCheck } from './DocCheck'
import { useApp } from '../lib/app'
import { buildIndex } from '../lib/links'
import { buildWork } from '../lib/work'
import { DOCRULES_PATH, rulesNoteTemplate } from '../lib/docrules'
import { t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const PROJECT = '프로젝트/시험/프로젝트 개요.md'

describe('문서 점검 탭: 이 프로젝트에 적용', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    const notes = [note(DOCRULES_PATH, rulesNoteTemplate()), note(PROJECT, '---\ntype: project\nstatus: active\n---\n# 시험\n'), note('프로젝트/시험/할 일.md', '- [ ] 첫 일\n')]
    const files = Object.fromEntries(notes.map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(notes.map((f) => ({ path: f.path, content: f.content }))), ready: true, toast: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const project = buildWork(files).projects.find((p) => p.path === PROJECT)!
    act(() => root.render(createElement(DocCheck, { project })))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('누르면 프로젝트 노트에 docs 속성을 적고, 어느 노트에 무엇을 적었는지 알려 준다', () => {
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === t('이 프로젝트에 적용'))
    expect(btn).toBeTruthy()
    act(() => btn!.click())
    expect(useApp.getState().files[PROJECT].content).toMatch(/docs: 기본/)
    const toast = useApp.getState().toast ?? ''
    expect(toast).toContain('프로젝트 개요.md')
    expect(toast).toContain('docs')
  })
})
