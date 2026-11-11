import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { EMPTY_TEXT, EmptyTile, signalText } from './WorkHome'
import { BUILTIN_TILES } from '../lib/tiles'
import { PERSONA_INFO, PERSONAS } from '../lib/persona'
import { t } from '../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('켜 둔 타일이 비었을 때의 한 줄', () => {
  it('모든 기본 타일에 안내 글이 있다(빈 글로 보이는 타일이 없다)', () => {
    for (const id of BUILTIN_TILES) expect(EMPTY_TEXT[id].trim().length, id).toBeGreaterThan(0)
  })
  it('역할별 시작 타일도 모두 안내 글을 갖는다', () => {
    for (const p of PERSONAS) for (const id of PERSONA_INFO[p].tiles) expect(EMPTY_TEXT[id], `${p}:${id}`).toBeTruthy()
  })
  it('제목과 안내 글을 한 줄에 보인다', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(EmptyTile, { title: '기한이 지난 일', text: t(EMPTY_TEXT.overdue), tone: 'danger' })))
    const sec = host.querySelector('section')!
    expect(sec.className).toContain('wrk-tile-empty')
    expect(sec.className).toContain('danger')
    expect(sec.textContent).toContain('기한이 지난 일')
    expect(sec.textContent).toContain(t('지금은 없어요'))
    expect(sec.getAttribute('title')).toBe(t(EMPTY_TEXT.overdue))
    act(() => root.unmount())
    host.remove()
  })
})

describe('프로젝트 상태 요약 문구', () => {
  it('"대기" 같은 줄임말 대신 풀어서 쓴다', () => {
    const text = signalText({ key: 'waitingLate', count: 2 } as never)
    expect(text).toContain('2')
    expect(text).not.toMatch(/^답이 늦은 대기/)
  })
})
