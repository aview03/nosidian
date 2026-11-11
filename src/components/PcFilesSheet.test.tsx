import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/pcFiles', async (orig) => {
  const m = await orig<typeof import('../lib/pcFiles')>()
  return {
    ...m,
    listShare: vi.fn(async () => ({
      name: 'PC',
      truncated: false,
      entries: [
        { path: '논문 PDF/LoRA 논문.pdf', size: 613, mtime: 1 },
        { path: '논문 PDF/2022/Chinchilla.pdf', size: 700, mtime: 1 },
        { path: '실험 로그.md', size: 439, mtime: 1 },
      ],
    })),
  }
})

import { PcFilesSheet } from './PcFilesCard'
import { usePcFilesUi } from '../lib/pcFiles'

const link = { host: '192.168.0.2', port: 47411, token: 't', fp: 'f'.repeat(64), name: 'DESKTOP', dirName: 'share_folder' }

describe('PC 폴더 보기 시트: 위치·상위 폴더·닫기(오른손 엄지)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(async () => {
    setLang('ko')
    usePcFilesUi.setState({ link, open: true })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(createElement(PcFilesSheet)))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    usePcFilesUi.setState({ open: false })
  })
  const click = async (el: Element | null | undefined) => await act(async () => (el as HTMLElement).click())
  const row = (name: string) => [...host.querySelectorAll('.memo-dest')].find((r) => r.textContent?.includes(name))

  it('맨 위에서는 상위 폴더 줄·위치 줄이 없다', () => {
    expect(host.querySelector('.pcf-up')).toBeNull()
    expect(host.querySelector('.pcf-path')).toBeNull()
  })
  it('폴더 안에서는 현재 위치와 `상위 폴더`(한 칸 위 이름)가 보이고, 누르면 올라간다', async () => {
    await click(row('논문 PDF'))
    expect(host.querySelector('.pcf-path')!.textContent).toBe('share_folder › 논문 PDF')
    const up = host.querySelector('.pcf-up')!
    expect(up.textContent).toContain('상위 폴더')
    expect(up.querySelector('.row-sub')!.textContent).toBe('share_folder')
    await click(row('2022'))
    expect(host.querySelector('.pcf-path')!.textContent).toBe('share_folder › 논문 PDF › 2022')
    expect(host.querySelector('.pcf-up .row-sub')!.textContent).toBe('논문 PDF')
    await click(host.querySelector('.pcf-up'))
    expect(host.querySelector('.pcf-path')!.textContent).toBe('share_folder › 논문 PDF')
  })
  it('닫기는 오른쪽 아래 고정 바에 있고 누르면 시트가 닫힌다', async () => {
    const foot = host.querySelector('.sheet-foot')!
    const btn = foot.querySelector<HTMLButtonElement>('.pcf-close')!
    expect(btn.textContent).toBe('닫기')
    await click(btn)
    expect(usePcFilesUi.getState().open).toBe(false)
  })
})
