import { describe, expect, it } from 'vitest'
import { diffHunks, merge3, mergeNote } from './merge'
import type { NoteFile } from './types'

const L = (...x: string[]) => x.join('\n')
const base = L('# 할 일', '', '- [ ] 장소 예약', '- [ ] 케이크 주문', '- [ ] 현수막 인쇄', '')

describe('줄 단위 3자 병합', () => {
  it('서로 다른 줄을 고치면 둘 다 반영한다', () => {
    const local = base.replace('- [ ] 장소 예약', '- [x] 장소 예약')
    const remote = base.replace('- [ ] 현수막 인쇄', '- [ ] 현수막 인쇄 due:2026-11-20')
    expect(merge3(base, local, remote)).toBe(L('# 할 일', '', '- [x] 장소 예약', '- [ ] 케이크 주문', '- [ ] 현수막 인쇄 due:2026-11-20', ''))
  })
  it('바로 이웃한 줄의 수정도 합친다 (두 사람이 인접한 업무를 각자 완료)', () => {
    const local = base.replace('- [ ] 장소 예약', '- [x] 장소 예약')
    const remote = base.replace('- [ ] 케이크 주문', '- [x] 케이크 주문')
    expect(merge3(base, local, remote)).toBe(L('# 할 일', '', '- [x] 장소 예약', '- [x] 케이크 주문', '- [ ] 현수막 인쇄', ''))
  })
  it('한쪽은 지우고 한쪽은 다른 줄을 고쳐도 합친다', () => {
    const local = base.replace('- [ ] 케이크 주문\n', '')
    const remote = base.replace('- [ ] 현수막 인쇄', '- [x] 현수막 인쇄')
    expect(merge3(base, local, remote)).toBe(L('# 할 일', '', '- [ ] 장소 예약', '- [x] 현수막 인쇄', ''))
  })
  it('같은 곳에 서로 다른 줄을 끝에 추가하면 둘 다 남긴다(내 것 먼저)', () => {
    const local = base + '- [ ] 내가 추가한 일\n'
    const remote = base + '- [ ] 상대가 추가한 일\n'
    expect(merge3(base, local, remote)).toBe(L('# 할 일', '', '- [ ] 장소 예약', '- [ ] 케이크 주문', '- [ ] 현수막 인쇄', '- [ ] 내가 추가한 일', '- [ ] 상대가 추가한 일', ''))
  })
  it('같은 수정·같은 추가는 한 번만', () => {
    const edited = base.replace('- [ ] 장소 예약', '- [x] 장소 예약')
    expect(merge3(base, edited, edited)).toBe(edited)
    const addedBoth = base + '- [ ] 같은 일\n'
    expect(merge3(base, addedBoth, addedBoth)).toBe(addedBoth)
    // 서로 다른 변경 안에 같은 수정이 섞여 있어도 한 번만
    const local = edited.replace('케이크 주문', '케이크 주문 owner:민수')
    const remote = edited.replace('현수막 인쇄', '현수막 인쇄 owner:지현')
    expect(merge3(base, local, remote)).toBe(L('# 할 일', '', '- [x] 장소 예약', '- [ ] 케이크 주문 owner:민수', '- [ ] 현수막 인쇄 owner:지현', ''))
  })
  it('같은 줄을 서로 다르게 고치면 합치지 않는다(null)', () => {
    const local = base.replace('- [ ] 케이크 주문', '- [ ] 케이크 주문 owner:민수')
    const remote = base.replace('- [ ] 케이크 주문', '- [ ] 케이크 주문 owner:지현')
    expect(merge3(base, local, remote)).toBeNull()
  })
  it('한쪽이 지운 줄을 다른 쪽이 고쳤으면 합치지 않는다', () => {
    const local = base.replace('- [ ] 케이크 주문\n', '')
    const remote = base.replace('- [ ] 케이크 주문', '- [x] 케이크 주문')
    expect(merge3(base, local, remote)).toBeNull()
  })
  it('한쪽만 바뀌었으면 그쪽을 그대로', () => {
    const edited = base.replace('장소 예약', '장소 예약 확정')
    expect(merge3(base, base, edited)).toBe(edited)
    expect(merge3(base, edited, base)).toBe(edited)
  })
  it('큰 노트(수천 줄)도 겹치지 않는 수정이면 빠르게 합친다', () => {
    const big = Array.from({ length: 4000 }, (_, i) => `- [ ] 일 ${i}`).join('\n')
    const local = big.replace('- [ ] 일 100\n', '- [x] 일 100\n')
    const remote = big.replace('- [ ] 일 3900\n', '- [x] 일 3900\n')
    const t0 = Date.now()
    const m = merge3(big, local, remote)!
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(m).toContain('- [x] 일 100\n')
    expect(m).toContain('- [x] 일 3900\n')
  })
  it('diffHunks: 앞·뒤가 같으면 가운데만 비교', () => {
    expect(diffHunks(['a', 'b', 'c'], ['a', 'X', 'c'])).toEqual([{ s: 1, e: 2, lines: ['X'] }])
    expect(diffHunks(['a', 'b'], ['a', 'b', 'c'])).toEqual([{ s: 2, e: 2, lines: ['c'] }])
    expect(diffHunks(['a', 'b'], ['a', 'b'])).toEqual([])
  })
})

describe('mergeNote (동기화에서 내가 고치는 중인 노트의 원격본이 바뀐 경우)', () => {
  const file = (over: Partial<NoteFile>): NoteFile => ({ path: 'a.md', content: base, sha: 'old', dirty: true, mtime: 1, base, ...over })

  it('겹치지 않으면 자동 병합: 원격 sha 로 올라타고, 원격본이 새 기준이 된다', () => {
    const local = base.replace('- [ ] 장소 예약', '- [x] 장소 예약')
    const remote = base.replace('- [ ] 현수막 인쇄', '- [x] 현수막 인쇄')
    const r = mergeNote(file({ content: local }), { sha: 'new', content: remote })
    expect(r.auto).toBe(true)
    expect(r.file.content).toContain('- [x] 장소 예약')
    expect(r.file.content).toContain('- [x] 현수막 인쇄')
    expect(r.file.sha).toBe('new')
    expect(r.file.dirty).toBe(true)
    expect(r.file.base).toBe(remote)
    expect(r.file.conflict).toBeUndefined()
  })
  it('내 수정이 이미 원격에 들어 있으면 올릴 것이 없다(dirty 해제)', () => {
    const edited = base.replace('- [ ] 장소 예약', '- [x] 장소 예약')
    const r = mergeNote(file({ content: edited }), { sha: 'new', content: edited })
    expect(r.auto).toBe(true)
    expect(r.file.dirty).toBe(false)
    expect(r.file.base).toBeUndefined()
  })
  it('겹치면 충돌로 남기고 내 글은 그대로', () => {
    const local = base.replace('- [ ] 케이크 주문', '- [ ] 케이크 주문 owner:민수')
    const remote = base.replace('- [ ] 케이크 주문', '- [ ] 케이크 주문 owner:지현')
    const r = mergeNote(file({ content: local }), { sha: 'new', content: remote })
    expect(r.auto).toBe(false)
    expect(r.file.content).toBe(local)
    expect(r.file.conflict).toEqual({ sha: 'new', content: remote })
  })
  it('기준(base)이 없는 옛 데이터는 예전처럼 충돌', () => {
    const r = mergeNote(file({ content: base + 'x', base: undefined }), { sha: 'new', content: base + 'y' })
    expect(r.auto).toBe(false)
    expect(r.file.conflict).toBeDefined()
  })
})
