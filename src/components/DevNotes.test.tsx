import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Reader } from './Reader'
import { TaskLine } from './TaskLine'
import { InfoPanel } from './InfoPanel'
import { useApp } from '../lib/app'
import { useWorkUi } from '../lib/workOps'
import { buildIndex } from '../lib/links'
import { buildWork } from '../lib/work'
import { setLang, t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const F = '```'

describe('개발자 P2: 읽기 화면 코드 블록 복사', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const write = vi.fn(() => Promise.resolve())
  beforeEach(() => {
    setLang('ko')
    write.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const content = ['# 코드', '', `${F}ts`, 'const a = 1', 'console.log(a)', F, '', `${F}bash`, 'kubectl get pods', F, ''].join('\n')
    const files = { 'a.md': note('a.md', content) }
    useApp.setState({ files, index: buildIndex([{ path: 'a.md', content }]), ready: true, toast: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement(Reader, { path: 'a.md', content })))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('코드 블록마다 복사 버튼이 하나씩 있다(언어 표시는 그대로)', () => {
    expect(host.querySelectorAll('.code-block .code-copy')).toHaveLength(2)
    expect([...host.querySelectorAll('.code-lang')].map((x) => x.textContent)).toEqual(['ts', 'bash'])
  })
  it('누르면 그 블록의 코드만(끝 줄바꿈 없이) 클립보드에 복사하고 알려 준다', async () => {
    const btns = host.querySelectorAll<HTMLButtonElement>('.code-copy')
    await act(async () => {
      btns[1].click()
    })
    expect(write).toHaveBeenCalledWith('kubectl get pods')
    await act(async () => {
      btns[0].click()
    })
    expect(write).toHaveBeenLastCalledWith('const a = 1\nconsole.log(a)')
    expect(useApp.getState().toast).toBe(t('복사했어요'))
  })
})

describe('개발자 P2: 이슈 줄의 [[링크]]', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const openLink = vi.fn()
  beforeEach(() => {
    setLang('ko')
    openLink.mockClear()
    const files = { 'p/프로젝트 개요.md': note('p/프로젝트 개요.md', '---\ntype: project\n---\n# p\n'), 'p/할 일.md': note('p/할 일.md', '- [ ] 429 응답 추가 [[ADR-0007 레이트리밋 정책]] p:1\n') }
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, openLink })
    useWorkUi.setState({ editor: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const tk = buildWork(files).tasks[0]
    act(() => root.render(createElement(TaskLine, { tk })))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useWorkUi.setState({ editor: null })
  })

  it('대괄호 없이 링크 글자로 보인다', () => {
    const link = host.querySelector<HTMLElement>('.tl-link')!
    expect(link.textContent).toBe('ADR-0007 레이트리밋 정책')
    expect(host.querySelector('.wrk-title')!.textContent).not.toContain('[[')
    expect(link.getAttribute('title')).toBe(t('{name} 열기', { name: 'ADR-0007 레이트리밋 정책' }))
  })
  it('링크 글자를 누르면 그 노트를 열고 편집기는 열리지 않는다', () => {
    act(() => host.querySelector<HTMLElement>('.tl-link')!.click())
    expect(openLink).toHaveBeenCalledWith('ADR-0007 레이트리밋 정책')
    expect(useWorkUi.getState().editor).toBeNull()
  })
  it('링크가 아닌 곳을 누르면 원래대로 업무 편집기가 열린다', () => {
    act(() => host.querySelector<HTMLButtonElement>('.wrk-main')!.click())
    expect(openLink).not.toHaveBeenCalled()
    expect(useWorkUi.getState().editor?.task?.title).toContain('429 응답 추가')
  })
})

describe('개발자 P2: 백링크 목록', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    setLang('ko')
    // 로컬 그래프가 캔버스를 쓴다(jsdom 에는 없다): 아무것도 그리지 않는 대체품
    HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: () => () => {} })) as never
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    const adr = '# ADR\n'
    const files = {
      '프로젝트/결제/ADR.md': note('프로젝트/결제/ADR.md', adr),
      '프로젝트/결제/할 일.md': note('프로젝트/결제/할 일.md', '- [ ] **429** 응답 `Retry-After` [[ADR]] 추가\n'),
      '프로젝트/앱/할 일.md': note('프로젝트/앱/할 일.md', '- [ ] 재시도 적용 [[ADR]]\n'),
    }
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, current: '프로젝트/결제/ADR.md' })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement(InfoPanel, { path: '프로젝트/결제/ADR.md' } as never)))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('같은 이름의 노트(할 일)는 폴더 이름으로 구별되고, 한 줄은 마크다운 기호 없이 읽기 쉽다', () => {
    const rows = [...host.querySelectorAll('.list > .row')].map((r) => ({ title: r.querySelector('.row-title')!.textContent!, sub: r.querySelector('.row-sub')!.textContent! }))
    expect(rows.map((r) => r.title).sort()).toEqual(['할 일결제', '할 일앱'])
    const pay = rows.find((r) => r.title.endsWith('결제'))!
    expect(pay.sub).toBe('☐ 429 응답 Retry-After ADR 추가')
  })
})
