import { describe, expect, it } from 'vitest'
import { backDepth, pushBack, runBack } from './backStack'

describe('뒤로 가기 스택', () => {
  it('아무것도 열려 있지 않으면 false (화면 이동으로 넘어간다)', () => {
    expect(runBack()).toBe(false)
  })
  it('가장 나중에 연 것부터 하나씩 닫는다', () => {
    const log: string[] = []
    const a = pushBack(() => log.push('a'))
    const b = pushBack(() => log.push('b'))
    expect(runBack()).toBe(true)
    expect(log).toEqual(['b'])
    b() // 실제로는 닫힌 컴포넌트가 등록을 푼다
    expect(runBack()).toBe(true)
    expect(log).toEqual(['b', 'a'])
    a()
    expect(runBack()).toBe(false)
  })
  it('등록을 풀면 더는 불리지 않고, 가운데 것을 풀어도 나머지 순서는 유지된다', () => {
    const log: string[] = []
    const a = pushBack(() => log.push('a'))
    const b = pushBack(() => log.push('b'))
    const c = pushBack(() => log.push('c'))
    b()
    runBack()
    expect(log).toEqual(['c'])
    c()
    runBack()
    expect(log).toEqual(['c', 'a'])
    a()
    expect(backDepth()).toBe(0)
  })
  it('같은 등록을 두 번 풀어도 다른 것이 지워지지 않는다', () => {
    const log: string[] = []
    const a = pushBack(() => log.push('a'))
    const b = pushBack(() => log.push('b'))
    b()
    b()
    expect(backDepth()).toBe(1)
    runBack()
    expect(log).toEqual(['a'])
    a()
  })
})
