import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp, type Tab } from './app'
import { useAiThread } from './aiThread'
import { pushBack } from './backStack'
import { useDialog } from './dialog'
import { androidBack, type BackDeps } from './androidBack'
import type { NoteFile } from './types'

const note = (path: string): NoteFile => ({ path, content: '# ' + path, sha: null, dirty: false, mtime: 1 })
const FILES = Object.fromEntries(['a.md', 'b.md'].map((p) => [p, note(p)]))
const app = () => useApp.getState()

let deps: { [K in keyof BackDeps]: ReturnType<typeof vi.fn> }
const press = () => androidBack(deps as unknown as BackDeps)
const reset = (tab: Tab = 'work') => {
  useApp.setState({ files: FILES, tab, current: null, history: [], hpos: -1, returnTo: null, noteBase: 0, drillFrom: null, sheet: null, palette: null, vaultSheet: false, ready: true })
  useDialog.setState({ kind: null })
  useAiThread.setState({ open: false })
  deps = { memoBack: vi.fn(() => false), settingsBack: vi.fn(() => false), exit: vi.fn(), desktop: vi.fn(() => false) }
}
beforeEach(() => reset())

describe('안드로이드 뒤로 가기 처리 순서 (7번)', () => {
  it('확인·입력 창이 열려 있으면 그것만 닫는다(등록된 시트·화면 이동보다 먼저)', () => {
    reset('files')
    const close = vi.fn()
    const off = pushBack(close)
    useDialog.setState({ kind: 'confirm' })
    press()
    expect(useDialog.getState().kind).toBeNull()
    expect(close).not.toHaveBeenCalled()
    off()
  })
  it('스스로 등록한 시트·창은 가장 나중에 연 것부터 닫고, 화면은 그대로다', () => {
    reset('settings')
    const log: string[] = []
    const a = pushBack(() => log.push('a'))
    const b = pushBack(() => log.push('b'))
    press()
    expect(log).toEqual(['b'])
    expect(app().tab).toBe('settings')
    expect(deps.settingsBack).not.toHaveBeenCalled()
    a(); b()
  })
  it('보관함 시트 → 팔레트 → 정보 시트 순으로 하나씩 닫는다', () => {
    reset('work')
    useApp.setState({ vaultSheet: true, palette: 'switcher', sheet: 'info' })
    press(); expect(app().vaultSheet).toBe(false); expect(app().palette).toBe('switcher')
    press(); expect(app().palette).toBeNull(); expect(app().sheet).toBe('info')
    press(); expect(app().sheet).toBeNull()
    expect(app().tab).toBe('work')
  })
  it('폰에서는 AI 시트를 먼저 닫고, PC 에서는 건드리지 않는다', () => {
    reset('files')
    useAiThread.setState({ open: true })
    press()
    expect(useAiThread.getState().open).toBe(false)
    useAiThread.setState({ open: true })
    deps.desktop.mockReturnValue(true)
    press()
    expect(useAiThread.getState().open).toBe(true) // PC: 패널은 뒤로 가기와 무관
    expect(app().tab).toBe('work') // 홈으로 갔다
  })
  it('노트 화면: 노트를 연 화면으로 돌아간다', () => {
    reset('calendar')
    app().openNote('a.md')
    press()
    expect(app().tab).toBe('calendar')
    expect(deps.exit).not.toHaveBeenCalled()
  })
  it('★ 태그·그래프로 들어간 검색·그래프 화면: 뒤로 가기는 홈이 아니라 그 노트로(예전엔 노트 화면에서만 부르고 있었다)', () => {
    for (const tab of ['search', 'graph'] as Tab[]) {
      reset('files')
      app().openNote('a.md')
      app().drillTo(tab)
      press()
      expect(app().tab).toBe('note')
      expect(app().current).toBe('a.md')
      press() // 한 번 더: 노트를 연 화면(메모)
      expect(app().tab).toBe('files')
    }
  })
  it('탭을 직접 눌러 간 검색 화면은 드릴이 아니라서 홈으로', () => {
    reset('files')
    app().openNote('a.md')
    app().go('search')
    press()
    expect(app().tab).toBe('work')
  })
  it('메모 탭: 선택 해제·위 폴더가 먼저, 할 것이 없으면 홈', () => {
    reset('files')
    deps.memoBack.mockReturnValueOnce(true)
    press()
    expect(app().tab).toBe('files')
    press()
    expect(app().tab).toBe('work')
  })
  it('설정 탭: 그룹 안이면 그룹 목록이 먼저, 아니면 홈', () => {
    reset('settings')
    deps.settingsBack.mockReturnValueOnce(true)
    press()
    expect(app().tab).toBe('settings')
    press()
    expect(app().tab).toBe('work')
  })
  it('홈이 아니면 홈으로 한 번, 홈에서 누르면 앱 종료', () => {
    reset('calendar')
    press()
    expect(app().tab).toBe('work')
    expect(deps.exit).not.toHaveBeenCalled()
    press()
    expect(deps.exit).toHaveBeenCalledTimes(1)
  })
})
