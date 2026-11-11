import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Settings, openSettingsGroup } from './Settings'
import { useApp } from '../lib/app'
import { buildIndex } from '../lib/links'
import { DOCRULES_PATH, rulesNoteTemplate } from '../lib/docrules'
import { t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; __APP_VERSION__?: string }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = 'test'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })

describe('설정 > 업무와 문서 > 문서 규칙 버튼', () => {
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
  const mount = (notes: NoteFile[]) => {
    const files = Object.fromEntries(notes.map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(notes.map((f) => ({ path: f.path, content: f.content }))), ready: true, current: null, tab: 'work' })
    act(() => { openSettingsGroup('work'); root.render(createElement(Settings)) })
  }
  const rulesBtn = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)

  it('규칙 노트가 없으면 "규칙 노트 만들기" 이고, 누르면 설명이 든 노트를 만들어 연다(예전엔 아무 일도 없었다)', () => {
    mount([])
    const btn = rulesBtn(t('규칙 노트 만들기'))
    expect(btn).toBeTruthy()
    act(() => btn!.click())
    const s = useApp.getState()
    expect(s.files[DOCRULES_PATH]).toBeTruthy()
    expect(s.files[DOCRULES_PATH].content).toBe(rulesNoteTemplate())
    expect(s.current).toBe(DOCRULES_PATH)
    expect(s.tab).toBe('note')
  })
  it('규칙 노트가 있으면 "규칙 파일 열기" 이고 내용은 건드리지 않고 연다', () => {
    mount([note(DOCRULES_PATH, '---\nrules: off\n---\n# 내 규칙\n')])
    const btn = rulesBtn(t('규칙 파일 열기'))
    expect(btn).toBeTruthy()
    act(() => btn!.click())
    const s = useApp.getState()
    expect(s.files[DOCRULES_PATH].content).toBe('---\nrules: off\n---\n# 내 규칙\n')
    expect(s.current).toBe(DOCRULES_PATH)
  })
  it('두 경우 모두 이 기능이 무엇인지 설명하는 문장이 보인다', () => {
    mount([])
    expect(host.textContent).toContain(t('문서 규칙은 프로젝트 문서의 역할과 구조를 점검해 주는 기능이에요. 지금은 꺼져 있고, 만들면 설명이 들어 있는 노트가 열려요.'))
  })
})
