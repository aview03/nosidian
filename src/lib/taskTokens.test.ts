import { describe, expect, it } from 'vitest'
import { formatWorkTokens, splitWorkTokens } from './taskTokens'

describe('splitWorkTokens', () => {
  it('모든 토큰을 읽고 제목에서 걷어 낸다', () => {
    const r = splitWorkTokens('견적서 수정 due:2026-11-12 owner:홍길동 p:1 status:doing side:me proj:[[행사 준비]] impact:"범위 추가"')
    expect(r.rest).toBe('견적서 수정')
    expect(r.has).toBe(true)
    expect(r.tokens).toEqual({ due: '2026-11-12', owner: ['홍길동'], p: 1, status: 'doing', side: 'me', proj: '행사 준비', impact: '범위 추가' })
  })

  it('토큰이 없으면 아무것도 건드리지 않는다', () => {
    const r = splitWorkTokens('우유 사기')
    expect(r).toEqual({ rest: '우유 사기', tokens: {}, has: false })
  })

  it('한글 별칭과 여러 담당자', () => {
    const r = splitWorkTokens('확인 status:대기 side:상대 owner:"홍길동, 김철수"')
    expect(r.tokens.status).toBe('waiting')
    expect(r.tokens.side).toBe('other')
    expect(r.tokens.owner).toEqual(['홍길동', '김철수'])
  })

  it('모르는 status 값은 글자 그대로 남긴다 (데이터를 지우지 않는다)', () => {
    const r = splitWorkTokens('뭔가 status:모름')
    expect(r.tokens.status).toBeUndefined()
    expect(r.rest).toContain('status:모름')
  })

  it('결론(=>)은 줄 끝까지', () => {
    const r = splitWorkTokens('영상 이벤트 정책 due:2026-11-12 => 중복 수상은 불가로 결정')
    expect(r.tokens.conclusion).toBe('중복 수상은 불가로 결정')
    expect(r.tokens.due).toBe('2026-11-12')
    expect(r.rest).toBe('영상 이벤트 정책')
  })

  it('일정 토큰(@날짜, repeat, end)은 건드리지 않는다', () => {
    const r = splitWorkTokens('요가 @2026-11-20 repeat:weekly:mon,wed end:2026-11-25 due:2026-11-30')
    expect(r.rest).toBe('요가 @2026-11-20 repeat:weekly:mon,wed end:2026-11-25')
    expect(r.tokens.due).toBe('2026-11-30')
  })

  it('p 는 1~3 만', () => {
    expect(splitWorkTokens('a p:2').tokens.p).toBe(2)
    expect(splitWorkTokens('a p:9').has).toBe(false)
  })

  it('쓰고 다시 읽어도 같다', () => {
    const t = { status: 'waiting' as const, side: 'other' as const, due: '2026-12-01', owner: ['홍 길동', '김철수'], p: 3 as const, proj: '행사 준비', conclusion: '결론입니다' }
    const back = splitWorkTokens('제목 ' + formatWorkTokens(t))
    expect(back.rest).toBe('제목')
    expect(back.tokens).toEqual(t)
  })
})
