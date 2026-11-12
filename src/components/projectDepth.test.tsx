import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectHub } from './ProjectHub'
import { TaskEditor } from './TaskEditor'
import { Dialogs } from './Dialogs'
import { useApp } from '../lib/app'
import { useWorkUi } from '../lib/workOps'
import { buildIndex } from '../lib/links'
import { setLang } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const PROJECT = '프로젝트/시안/프로젝트 개요.md'
const TASKS = '프로젝트/시안/할 일.md'
const BODY = ['- [ ] 가 로고 시안 status:doing', '- [ ] 나 시안 검토 받기 status:waiting side:other', '- [ ] 다 키 비주얼'].join('\n') + '\n'
const overview = (extra: string) => `---\ntype: project\nstatus: active\n${extra}---\n# 시안\n`

describe('프로젝트 깊이·용어: 허브와 업무 편집기 (첫 걸음)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const q = <T extends Element>(s: string) => [...host.querySelectorAll<T>(s)]
  const tabs = () => q<HTMLButtonElement>('.hub-tabs [role="tab"]').map((b) => b.textContent)
  const groupTitles = () => q('.wrk-sec h3').map((h) => h.childNodes[0]?.textContent)
  const menu = () => {
    act(() => host.querySelector<HTMLButtonElement>('.hub-menu button[aria-haspopup]')!.click())
    return q<HTMLButtonElement>('.hub-pop [role="menuitem"]')
  }
  const mount = (extra: string) => {
    const files = Object.fromEntries([note(PROJECT, overview(extra)), note(TASKS, BODY)].map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(Object.values(files).map((f) => ({ path: f.path, content: f.content }))), ready: true, toast: null, toastUndo: null })
    useWorkUi.setState({ hub: PROJECT, editor: null })
    act(() => root.render(createElement('div', null, createElement(ProjectHub), createElement(TaskEditor), createElement(Dialogs))))
  }
  beforeEach(() => {
    setLang('ko')
    localStorage.clear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useWorkUi.setState({ hub: null, editor: null })
  })

  it('표준(depth 없음): 할 일·보기·기본 정보·문서·문서 점검 탭이 모두 있다(기존 프로젝트는 그대로)', () => {
    mount('')
    expect(tabs()).toEqual(['할 일', '보기', '기본 정보', '문서', '문서 점검'])
  })
  it('가볍게(depth: light): 문서·문서 점검 탭이 숨겨진다', () => {
    mount('depth: light\n')
    expect(tabs()).toEqual(['할 일', '보기', '기본 정보'])
  })
  it('메뉴의 "문서·점검 탭 보이기"는 개요 노트의 depth 만 지우고(데이터는 그대로) 탭이 돌아온다', () => {
    mount('depth: light\nowner: 민수\n')
    const items = menu()
    expect(items.map((b) => b.textContent)).toContain('문서·점검 탭 보이기')
    act(() => items.find((b) => b.textContent === '문서·점검 탭 보이기')!.click())
    const c = useApp.getState().files[PROJECT].content
    expect(c).not.toMatch(/^depth:/m)
    expect(c).toContain('owner: 민수') // 다른 속성은 그대로
    expect(useApp.getState().files[TASKS].content).toBe(BODY) // 업무 노트는 건드리지 않는다
    expect(tabs()).toEqual(['할 일', '보기', '기본 정보', '문서', '문서 점검'])
  })
  it('표준 프로젝트의 메뉴 "가볍게 보기"는 depth: light 를 적고 탭이 숨겨진다', () => {
    mount('')
    const items = menu()
    expect(items.map((b) => b.textContent)).toContain('가볍게 보기 (문서·점검 숨김)')
    act(() => items.find((b) => b.textContent === '가볍게 보기 (문서·점검 숨김)')!.click())
    expect(useApp.getState().files[PROJECT].content).toMatch(/^depth: light$/m)
    expect(tabs()).toEqual(['할 일', '보기', '기본 정보'])
  })
  it('문서 탭을 보고 있다가 가볍게로 바꾸면 보이지 않는 탭이 아니라 할 일로 돌아온다', () => {
    mount('')
    act(() => q<HTMLButtonElement>('.hub-tabs [role="tab"]').find((b) => b.textContent === '문서')!.click())
    expect(q<HTMLButtonElement>('.hub-tabs [role="tab"]').find((b) => b.textContent === '문서')!.getAttribute('aria-selected')).toBe('true')
    const items = menu()
    act(() => items.find((b) => b.textContent === '가볍게 보기 (문서·점검 숨김)')!.click())
    expect(q<HTMLButtonElement>('.hub-tabs [role="tab"]').find((b) => b.textContent === '할 일')!.getAttribute('aria-selected')).toBe('true')
  })

  it('기본 용어: 허브 그룹 제목이 진행 중·할 일·대기', () => {
    mount('')
    expect(groupTitles()).toEqual(['진행 중', '할 일', '대기'])
  })
  it('words: design — 그룹 제목(시안 중·시작 전·검토 요청), 업무 줄 배지, 보드 열이 프로젝트의 말로 보인다', () => {
    mount('words: design\n')
    expect(groupTitles()).toEqual(['시안 중', '시작 전', '검토 요청'])
    expect(q('.wrk-why').map((e) => e.textContent).sort()).toEqual(['검토 요청', '시안 중'])
    act(() => q<HTMLButtonElement>('.hub-tabs [role="tab"]')[1].click())
    act(() => q<HTMLButtonElement>('.hub-views [role="tab"]').find((b) => b.textContent === '보드')!.click())
    expect(q('.board-col h3').map((h) => h.childNodes[0]?.textContent)).toEqual(['시작 전', '시안 중', '검토 요청', '확정'])
  })
  it('내부 값은 그대로다: 용어만 바뀌고 업무 노트의 status·side 꼬리표는 건드리지 않는다', () => {
    mount('words: design\n')
    expect(useApp.getState().files[TASKS].content).toBe(BODY)
  })
  it('업무 편집기의 상태 칩도 프로젝트의 말로 보이고(시작 전·시안 중·검토 요청), 다른 프로젝트는 기본 이름이다', () => {
    mount('words: design\n')
    act(() => useWorkUi.getState().openEditor(undefined, PROJECT))
    act(() => q<HTMLButtonElement>('.ee .te-more')[0].click()) // 새 업무는 상태가 "더 보기" 안에 있다
    const chips = q<HTMLButtonElement>('.ee button').map((b) => b.textContent)
    expect(chips).toEqual(expect.arrayContaining(['시작 전', '시안 중', '검토 요청']))
    expect(chips).not.toContain('대기')
    act(() => useWorkUi.getState().closeEditor())
    mount('')
    act(() => useWorkUi.getState().openEditor(undefined, PROJECT))
    act(() => q<HTMLButtonElement>('.ee .te-more')[0].click())
    const plain = q<HTMLButtonElement>('.ee button').map((b) => b.textContent)
    expect(plain).toEqual(expect.arrayContaining(['할 일', '진행 중', '대기']))
  })
})
