import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../lib/i18n'
import { Reader } from './Reader'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
setLang('ko')

describe('AI 답변의 코드·복사할 글 카드', () => {
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
  const render = (md: string, compact = true) => act(() => root.render(createElement(Reader, { path: 'AI', content: md, compact })))

  it('```text 는 "복사할 글" 카드(줄바꿈 글), 언어가 있으면 그 이름의 코드 카드', () => {
    render('설명\n\n```text\n담당자에게 보낼 글\n```\n\n```ts\nconst a = 1\n```')
    const cards = host.querySelectorAll('.codecard')
    expect(cards).toHaveLength(2)
    expect(cards[0].classList.contains('prose')).toBe(true)
    expect(cards[0].querySelector('.codecard-head span')!.textContent).toBe('복사할 글')
    expect(cards[1].classList.contains('prose')).toBe(false)
    expect(cards[1].querySelector('.codecard-head span')!.textContent).toBe('ts')
    expect(cards[0].querySelector('pre')!.textContent).toContain('담당자에게 보낼 글')
  })
  it('복사 버튼은 블록의 글만 클립보드에 넣는다', async () => {
    const write = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    render('```text\n복사 내용\n```')
    const btn = host.querySelector('.codecard-copy') as HTMLElement
    await act(async () => { btn.click() })
    expect(write).toHaveBeenCalledWith('복사 내용')
  })
  it('노트 읽기 화면(compact 아님)에는 카드를 입히지 않는다', () => {
    render('```ts\nx\n```', false)
    expect(host.querySelector('.codecard')).toBeNull()
  })
})
