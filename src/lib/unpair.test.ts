import { describe, expect, it } from 'vitest'
import { notifyUnpair } from './unpair'

describe('PC 에 해제를 알리는 결과(5-c)', () => {
  it('성공하면 true', async () => {
    expect(await notifyUnpair(async () => ({ ok: true }))).toBe(true)
  })
  it('이미 PC 쪽에서 해제돼 있어서 401 이 와도 true(목적은 이뤄진 상태)', async () => {
    expect(await notifyUnpair(async () => { throw Object.assign(new Error('unauthorized'), { status: 401 }) })).toBe(true)
  })
  it('PC 가 꺼져 있거나 닿지 않으면 false (폰의 해제는 그래도 진행된다 — 호출한 쪽이 이어서 지운다)', async () => {
    expect(await notifyUnpair(async () => { throw new Error('connect ECONNREFUSED') })).toBe(false)
    expect(await notifyUnpair(async () => { throw Object.assign(new Error('timeout'), { status: undefined }) })).toBe(false)
    expect(await notifyUnpair(async () => { throw Object.assign(new Error('server'), { status: 500 }) })).toBe(false)
  })
})
