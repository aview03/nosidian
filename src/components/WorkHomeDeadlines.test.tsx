import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkHome } from './WorkHome'
import { useApp } from '../lib/app'
import { useCal } from '../lib/calendar'
import { useWorkUi } from '../lib/workOps'
import { buildIndex } from '../lib/links'
import { defaultLayout } from '../lib/tiles'
import { presetLayout } from '../lib/persona'
import { setLang, t } from '../lib/i18n'
import type { NoteFile } from '../lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 1 })
const daily = (date: string, lines: string[]) => note(`Daily/${date}.md`, `# ${date}\n\n## 할 일\n${lines.join('\n')}\n`)

describe('학생의 홈: 날짜만 적은 과제(종일 체크리스트)도 이번 주·기한이 지난 일에 보인다 (F21)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const section = (title: string) => [...host.querySelectorAll('section')].find((s) => s.textContent!.startsWith(t(title)))
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0)) // 수요일
    setLang('ko')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const notes = [
      daily('2026-11-10', ['- [ ] 국어 숙제 제출']),
      daily('2026-11-11', ['- [ ] 오늘 할 일']),
      daily('2026-11-13', ['- [ ] 영어 에세이 제출']),
      daily('2026-11-16', ['- [ ] 수학 과제 제출', '- [ ] 15:00 치과 예약']),
    ]
    const files = Object.fromEntries(notes.map((f) => [f.path, f]))
    useApp.setState({ files, index: buildIndex(notes.map((f) => ({ path: f.path, content: f.content }))), ready: true })
    useWorkUi.setState({ layout: presetLayout('student', defaultLayout(), []), editing: false })
    act(() => root.render(createElement(WorkHome)))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  it('이번 주 타일에 내일부터 7일 안의 과제가 날짜순으로 있고(남은 날 표시), 시간 있는 약속은 없다', () => {
    const s = section('이번 주')!
    expect(s).toBeTruthy()
    const rows = [...s.querySelectorAll('.wrk-row')].map((r) => r.textContent!)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('영어 에세이 제출')
    expect(rows[0]).toContain(t('D-{n}', { n: 2 }))
    expect(rows[1]).toContain('수학 과제 제출')
    expect(rows[1]).toContain(t('D-{n}', { n: 5 }))
    expect(s.textContent).not.toContain('치과')
  })

  it('기한이 지난 일 타일에 어제 놓친 과제가 지난 날수와 함께 있다', () => {
    const s = section('기한이 지난 일')!
    expect(s).toBeTruthy()
    expect(s.textContent).toContain('국어 숙제 제출')
    expect(s.textContent).toContain(t('기한 {n}일 지남', { n: 1 }))
  })

  it('체크하면 파일이 완료로 바뀌고 타일에서 사라진다', () => {
    const row = [...section('기한이 지난 일')!.querySelectorAll('.wrk-row')].find((r) => r.textContent!.includes('국어'))!
    act(() => row.querySelector<HTMLInputElement>('input.task')!.click())
    expect(useApp.getState().files['Daily/2026-11-10.md'].content).toContain('- [x] 국어 숙제 제출')
    expect(section('기한이 지난 일')).toBeFalsy() // 비면 화면에서 빠진다(문제가 없는 상태는 숨긴다)
  })

  it('줄을 누르면 일정 편집기가 열린다(날짜를 옮기거나 지울 수 있다)', () => {
    const row = [...section('이번 주')!.querySelectorAll('.wrk-row')].find((r) => r.textContent!.includes('수학'))!
    act(() => row.querySelector<HTMLButtonElement>('.wrk-main')!.click())
    expect(useCal.getState().editor).not.toBeNull()
  })

  it('오늘 일정 타일에는 오늘 것만 있고 과제 줄이 중복되지 않는다', () => {
    const today = section('오늘 일정')!
    expect(today.textContent).toContain('오늘 할 일')
    expect(today.textContent).not.toContain('수학')
  })
})
