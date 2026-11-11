import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const confirmMock = vi.fn<(title: string, msg?: string, ok?: string, danger?: boolean) => Promise<boolean>>()
vi.mock('../lib/dialog', () => ({ confirmAsk: (...a: Parameters<typeof confirmMock>) => confirmMock(...a) }))

import { DeviceList, ago } from './DeviceList'
import { t } from '../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const dev = (id: string, name: string, lastSeen = Date.now()) => ({ id, name, lastSeen })

describe('연결된 휴대폰 목록(세 카드 공통)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    confirmMock.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const render = (el: ReturnType<typeof createElement>) => act(() => root.render(el))
  const flush = () => act(async () => { await Promise.resolve() })

  it('기기가 없으면 "아직 없어요"', () => {
    render(createElement(DeviceList, { devices: [], onRevoke: () => {} }))
    expect(host.textContent).toContain(t('아직 없어요'))
    expect(host.querySelector('li')).toBeNull()
  })
  it('이름과 마지막 사용을 보이고, 카드별 보조 글·버튼을 해제 앞에 둔다', () => {
    render(createElement(DeviceList, { devices: [dev('a', '내 폰')], onRevoke: () => {}, detail: () => '쓴 횟수 3', actions: () => createElement('button', { id: 'extra' }, '읽기만') }))
    const li = host.querySelector('li')!
    expect(li.textContent).toContain('내 폰')
    expect(li.textContent).toContain('쓴 횟수 3')
    const btns = [...li.querySelectorAll('button')].map((b) => b.id || b.textContent)
    expect(btns).toEqual(['extra', t('해제')])
  })
  it('해제는 확인 창을 거치고, 취소하면 아무것도 안 한다', async () => {
    const onRevoke = vi.fn()
    confirmMock.mockResolvedValue(false)
    render(createElement(DeviceList, { devices: [dev('a', '내 폰')], onRevoke }))
    act(() => host.querySelector<HTMLButtonElement>('li .btn-link')!.click())
    await flush()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0][0]).toContain('내 폰')
    expect(onRevoke).not.toHaveBeenCalled()
  })
  it('확인하면 그 기기의 id 로 해제를 부른다', async () => {
    const onRevoke = vi.fn()
    confirmMock.mockResolvedValue(true)
    render(createElement(DeviceList, { devices: [dev('a', '내 폰'), dev('b', '태블릿')], onRevoke }))
    act(() => host.querySelectorAll<HTMLButtonElement>('li .btn-link')[1].click())
    await flush()
    expect(onRevoke).toHaveBeenCalledWith('b')
  })
  it('마지막 사용 표기: 방금 / 분 / 시간 / 날짜', () => {
    const now = Date.now()
    expect(ago(now)).toBe(t('방금'))
    expect(ago(now - 5 * 60000)).toBe(t('{n}분 전', { n: 5 }))
    expect(ago(now - 3 * 3600000)).toBe(t('{n}시간 전', { n: 3 }))
    expect(ago(now - 3 * 86400000)).toBe(new Date(now - 3 * 86400000).toLocaleDateString())
  })
})
