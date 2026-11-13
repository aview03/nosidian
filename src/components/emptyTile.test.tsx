import { describe, expect, it } from 'vitest'
import { signalText } from './WorkHome'

describe('프로젝트 상태 요약 문구', () => {
  it('"대기" 같은 줄임말 대신 풀어서 쓴다', () => {
    const text = signalText({ key: 'waitingLate', count: 2 } as never)
    expect(text).toContain('2')
    expect(text).not.toMatch(/^답이 늦은 대기/)
  })
})
