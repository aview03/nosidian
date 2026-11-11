import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskEditor } from './TaskEditor'
import { useWorkUi } from '../lib/workOps'
import { t } from '../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('새 업무 편집기는 필요한 것만 먼저 보여 준다', () => {
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
    useWorkUi.setState({ editor: null })
  })
  const labels = () => [...host.querySelectorAll('.ee-field > span, .ee-check > span')].map((x) => x.textContent)
  const show = (state: { editor: { project: string | null; closing?: boolean } }) => act(() => { useWorkUi.setState(state as Partial<ReturnType<typeof useWorkUi.getState>>); root.render(createElement(TaskEditor)) })

  it('새 업무: 제목·결정 안건·마감일·담당자·프로젝트만, 나머지는 "더 보기"', () => {
    show({ editor: { project: null } })
    const l = labels()
    for (const need of ['제목', '결정이 필요한 안건', '마감일', '담당자', '프로젝트']) expect(l, need).toContain(t(need))
    for (const hidden of ['상태', '완료', '우선순위']) expect(l, hidden).not.toContain(t(hidden))
    expect(host.querySelector('.te-more')).not.toBeNull()
  })
  it('"더 보기"를 누르면 상태·완료·우선순위가 나타난다', () => {
    show({ editor: { project: null } })
    act(() => host.querySelector<HTMLButtonElement>('.te-more')!.click())
    const l = labels()
    for (const need of ['상태', '완료', '우선순위']) expect(l, need).toContain(t(need))
    expect(host.querySelector('.te-more')).toBeNull()
  })
  it('결정 안건을 닫을 때(closing)는 처음부터 전부 보인다(결론을 적어야 하므로)', () => {
    show({ editor: { project: null, closing: true } })
    expect(labels()).toContain(t('상태'))
    expect(host.querySelector('.te-more')).toBeNull()
  })
})
