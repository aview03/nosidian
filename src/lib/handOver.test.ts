import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = { v: true }
const view = vi.fn()
const share = vi.fn()
const choose = vi.fn()
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.v }, registerPlugin: () => ({}) }))
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { writeFile: vi.fn(async () => ({ uri: 'file:///cache/nosidian-files/1/a.pdf' })) } }))
vi.mock('@capacitor/share', () => ({ Share: { share: (...a: unknown[]) => share(...a) } }))
vi.mock('./externalIO', () => ({ OpenFile: { view: (...a: unknown[]) => view(...a) } }))
vi.mock('./dialog', () => ({ choose: (...a: unknown[]) => choose(...a) }))

import { askHandMode, handOver } from './attachments'

beforeEach(() => {
  native.v = true
  view.mockReset()
  share.mockReset()
  choose.mockReset()
})

describe('F44: 받은 파일을 열기 / 공유·저장', () => {
  it('열기: 기본 앱으로 바로 열고 공유 창은 띄우지 않는다(PDF 는 application/pdf 로 넘긴다)', async () => {
    view.mockResolvedValue(undefined)
    expect(await handOver('논문/LoRA.pdf', 'AAAA', 'open')).toBe('opened')
    expect(view).toHaveBeenCalledWith({ uri: 'file:///cache/nosidian-files/1/a.pdf', mime: 'application/pdf' })
    expect(share).not.toHaveBeenCalled()
  })
  it('열기인데 열 앱이 없으면 공유 창으로 넘기고 noapp 으로 알린다', async () => {
    view.mockRejectedValue(new Error('noapp'))
    share.mockResolvedValue(undefined)
    expect(await handOver('a.pdf', 'AAAA', 'open')).toBe('noapp')
    expect(share).toHaveBeenCalledTimes(1)
  })
  it('열기가 noapp 이 아닌 오류로 실패하면 삼키지 않고 던진다(공유 창으로 숨기지 않는다)', async () => {
    view.mockRejectedValue(new Error('열 수 없는 파일'))
    await expect(handOver('a.pdf', 'AAAA', 'open')).rejects.toThrow('열 수 없는 파일')
    expect(share).not.toHaveBeenCalled()
  })
  it('공유·저장: 공유 창만(열기는 부르지 않는다), 창을 그냥 닫아도 오류가 아니다', async () => {
    share.mockRejectedValue(new Error('Share canceled'))
    expect(await handOver('a.pdf', 'AAAA', 'share')).toBe('shared')
    expect(view).not.toHaveBeenCalled()
  })
  it('askHandMode: 선택 창에서 고른 값을 돌려주고, 닫으면 null(받지 않는다)', async () => {
    choose.mockResolvedValueOnce('open').mockResolvedValueOnce('share').mockResolvedValueOnce(null)
    expect(await askHandMode('a.pdf')).toBe('open')
    expect(await askHandMode('a.pdf')).toBe('share')
    expect(await askHandMode('a.pdf')).toBeNull()
  })
  it('폰이 아니면(PC·웹) 묻지 않고 바로 다운로드 방식', async () => {
    native.v = false
    expect(await askHandMode('a.pdf')).toBe('share')
    expect(choose).not.toHaveBeenCalled()
  })
})
