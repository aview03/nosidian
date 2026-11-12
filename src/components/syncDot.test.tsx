import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileTree } from './FileTree'
import { useApp } from '../lib/app'
import { setLang } from '../lib/i18n'
import type { NoteFile, RemoteCfg } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const dirtyNote = (path: string): NoteFile => ({ path, content: 'x', sha: null, dirty: true, mtime: 1 })

describe('F33: 동기화 대기 점은 저장소를 연결했을 때만', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    setLang('ko')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const show = (remote: RemoteCfg | null) => {
    useApp.setState({ files: { 'a.md': dirtyNote('a.md') }, ready: true, settings: { ...useApp.getState().settings, remote } })
    act(() => root.render(createElement(FileTree)))
  }

  it('로컬 전용 보관함: 바뀐 노트에도 점이 없다(모든 노트가 대기라 오류처럼 보였다)', () => {
    show(null)
    expect(host.textContent).toContain('a')
    expect(host.querySelectorAll('.tree-row .dot')).toHaveLength(0)
  })
  it('저장소를 연결한 보관함: 아직 올리지 않은 노트에 점이 있다', () => {
    show({ kind: 'github', owner: 'o', repo: 'r', branch: 'main', token: 't' } as unknown as RemoteCfg)
    expect(host.querySelectorAll('.tree-row .dot')).toHaveLength(1)
  })
})
