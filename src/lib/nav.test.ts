import { beforeEach, describe, expect, it } from 'vitest'
import { useApp, type Tab } from './app'
import { useWorkUi } from './workOps'
import { openSettingsGroup, settingsBack } from '../components/Settings'
import type { NoteFile } from './types'

const note = (path: string): NoteFile => ({ path, content: '# ' + path, sha: null, dirty: false, mtime: 1 })
const FILES = Object.fromEntries(['a.md', 'b.md', 'c.md'].map((p) => [p, note(p)]))

const app = () => useApp.getState()
const reset = (tab: Tab = 'work') =>
  useApp.setState({ files: FILES, tab, current: null, history: [], hpos: -1, returnTo: null, noteBase: 0, ready: true })

beforeEach(() => {
  reset()
  useWorkUi.setState({ hub: null })
})

describe('뒤로 가기: 노트를 연 화면으로 돌아간다', () => {
  it.each<Tab>(['search', 'calendar', 'files', 'work', 'project'])('%s 에서 노트를 열고 뒤로 가면 %s 로', (tab) => {
    reset(tab)
    app().openNote('a.md')
    expect(app().tab).toBe('note')
    expect(app().backScreen()).toBe(true)
    expect(app().tab).toBe(tab)
    expect(app().backScreen()).toBe(false) // 더 갈 곳이 없으면 호출한 쪽(앱의 뒤로 가기)이 이어받는다
  })
  it('링크로 따라온 노트는 한 칸씩 되돌아가고, 그다음 노트를 연 화면으로 간다', () => {
    reset('calendar')
    app().openNote('a.md')
    app().openNote('b.md') // 노트 안 링크
    app().openNote('c.md')
    expect(app().backScreen()).toBe(true)
    expect(app().current).toBe('b.md')
    expect(app().backScreen()).toBe(true)
    expect(app().current).toBe('a.md')
    expect(app().backScreen()).toBe(true)
    expect(app().tab).toBe('calendar')
  })
  it('다른 화면에서 새로 연 노트는 옛 흐름의 노트로 돌아가지 않는다(← 가 아무 노트로 가던 문제)', () => {
    reset('search')
    app().openNote('a.md')
    app().backScreen() // 검색으로
    app().go('calendar')
    app().openNote('b.md')
    expect(app().backScreen()).toBe(true)
    expect(app().tab).toBe('calendar') // a.md 가 아니라 캘린더
    expect(app().current).not.toBe('a.md')
  })
  it('같은 노트를 다른 화면에서 다시 열어도 그 화면으로 돌아간다', () => {
    reset('search')
    app().openNote('a.md')
    app().go('work')
    app().openNote('a.md') // 이미 history 끝이 a.md 라도
    app().backScreen()
    expect(app().tab).toBe('work')
  })
  it('PC 의 Alt+← (back) 는 예전처럼 노트 기록을 따라간다', () => {
    reset('search')
    app().openNote('a.md')
    app().openNote('b.md')
    expect(app().back()).toBe(true)
    expect(app().current).toBe('a.md')
    expect(app().back()).toBe(false)
  })
  it('돌아갈 곳이 없으면(앱 시작 직후 등) false 라서 앱이 홈으로 보낸다', () => {
    useApp.setState({ tab: 'note', current: 'a.md', history: ['a.md'], hpos: 0, returnTo: null, noteBase: 0 })
    expect(app().backScreen()).toBe(false)
  })
  it('노트 화면이 아니면 backScreen 은 아무것도 하지 않는다', () => {
    reset('calendar')
    expect(app().backScreen()).toBe(false)
    expect(app().tab).toBe('calendar')
  })
})

describe('프로젝트 허브: 보던 프로젝트로 돌아온다', () => {
  it('노트를 열었다가 뒤로 오면 같은 프로젝트', () => {
    reset('project')
    useWorkUi.setState({ hub: 'P/개요.md' })
    app().openNote('a.md')
    useWorkUi.setState({ hub: 'Q/개요.md' }) // 그 사이 다른 곳에서 바뀌었어도
    app().backScreen()
    expect(app().tab).toBe('project')
    expect(useWorkUi.getState().hub).toBe('P/개요.md')
  })
})

describe('설정: 그룹 안에서 뒤로 가면 설정 목록, 바로 들어왔으면 들어온 화면', () => {
  it('목록에서 그룹을 눌러 들어갔다면: 뒤로 = 그룹 목록, 한 번 더 = 설정을 떠남(false)', () => {
    app().go('settings')
    // 목록에서 직접 고른 것과 같은 상태
    useWorkUi.setState({}) // no-op
    openSettingsGroup('ai') // 설정 안에서 호출하면 들어온 곳을 적지 않는다
    expect(settingsBack()).toBe(true) // 그룹 → 목록
    expect(settingsBack()).toBe(false) // 목록에서는 앱의 뒤로 가기에게 넘긴다
  })
  it('AI 패널·내 업무 같은 다른 화면에서 설정 그룹으로 바로 들어오면 뒤로 = 그 화면', () => {
    reset('note')
    useApp.setState({ current: 'a.md', history: ['a.md'], hpos: 0 })
    openSettingsGroup('ai')
    expect(app().tab).toBe('settings')
    expect(settingsBack()).toBe(true)
    expect(app().tab).toBe('note')
    expect(app().current).toBe('a.md')
    expect(settingsBack()).toBe(false) // 들어온 곳을 한 번만 쓴다
  })
  it('설정에 있던 기록은 설정을 한 번 떠났다 오면 잊는다(엉뚱한 곳으로 가지 않게)', () => {
    reset('work')
    openSettingsGroup('ai')
    expect(app().tab).toBe('settings')
    // 같은 그룹을 다시 열어도(이미 설정) 처음 들어온 곳을 유지한다
    openSettingsGroup('ai')
    expect(settingsBack()).toBe(true)
    expect(app().tab).toBe('work')
  })
})
