import { describe, expect, it } from 'vitest'
import { applyView, formatView, parseViewLine, readViews, removeView, upsertView, VIEWS_PATH, viewsNoteHeader } from './views'
import { buildWork } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const TODAY = '2026-11-09'
const w = buildWork({
  'p/개요.md': note('p/개요.md', '---\ntype: project\n---\n# 행사 준비\n'),
  'p/할 일.md': note(
    'p/할 일.md',
    [
      '# 할 일',
      '- [ ] 예약금 due:2026-11-06 owner:민수',
      '- [ ] 참석자 확인 due:2026-11-09 owner:지현',
      '- [ ] 케이크 due:2026-11-12 owner:지현',
      '- [ ] 문의 status:waiting side:other owner:민수',
      '- [ ] 시안 status:doing owner:지현',
      '- [ ] 장소 정하기 kind:decision due:2026-11-10 owner:민수',
      '- [ ] 담당 없음 due:2026-11-30',
      '- [x] 끝난 일 owner:민수',
    ].join('\n') + '\n',
  ),
  '받은 업무.md': note('받은 업무.md', '# 받은 업무\n\n- [ ] 세금 신고\n'),
})
const titles = (v: Parameters<typeof applyView>[1], me: string[] = []) => applyView(w, v, TODAY, me).map((t) => t.title)

describe('저장된 보기', () => {
  it('줄 형식을 읽고 쓴다(왕복)', () => {
    const v = { name: '이번 주 민수 일', owner: '민수', due: 'week' as const, q: '확인' }
    expect(formatView(v)).toBe('- 이번 주 민수 일 :: owner=민수; due=week; q=확인')
    expect(parseViewLine(formatView(v))).toEqual(v)
    expect(parseViewLine('그냥 글')).toBeNull()
    expect(parseViewLine('- 알 수 없는 값 :: status=foo; due=bar')).toEqual({ name: '알 수 없는 값' })
  })
  it('노트에서 목록을 읽고, 추가·수정·삭제한다', () => {
    let c = viewsNoteHeader()
    c = upsertView(c, { name: 'A', status: 'doing' })
    c = upsertView(c, { name: 'B', owner: 'me' })
    expect(readViews({ [VIEWS_PATH]: note(VIEWS_PATH, c) }).map((v) => v.name)).toEqual(['A', 'B'])
    c = upsertView(c, { name: 'A2', status: 'waiting' }, 'A') // 이름 바꾸며 수정
    expect(readViews({ [VIEWS_PATH]: note(VIEWS_PATH, c) })).toEqual([{ name: 'A2', status: 'waiting' }, { name: 'B', owner: 'me' }])
    c = removeView(c, 'a2')
    expect(readViews({ [VIEWS_PATH]: note(VIEWS_PATH, c) }).map((v) => v.name)).toEqual(['B'])
    expect(c).toContain('# 저장된 보기') // 설명은 남는다
  })
  it('담당자·상태·마감·프로젝트·글 조건을 적용한다', () => {
    expect(titles({ name: 'x', owner: '민수' })).toEqual(['예약금', '장소 정하기', '문의'])
    expect(titles({ name: 'x', status: 'waiting' })).toEqual(['문의'])
    expect(titles({ name: 'x', status: 'decision' })).toEqual(['장소 정하기'])
    expect(titles({ name: 'x', status: 'todo' })).toEqual(['예약금', '참석자 확인', '케이크', '담당 없음', '세금 신고'])
    expect(titles({ name: 'x', due: 'overdue' })).toEqual(['예약금'])
    expect(titles({ name: 'x', due: 'today' })).toEqual(['참석자 확인'])
    expect(titles({ name: 'x', due: 'week' })).toEqual(['참석자 확인', '장소 정하기', '케이크'])
    expect(titles({ name: 'x', project: '행사 준비', owner: '지현' })).toEqual(['참석자 확인', '케이크', '시안'])
    expect(titles({ name: 'x', project: 'none' })).toEqual(['세금 신고'])
    expect(titles({ name: 'x', owner: 'none' })).toEqual(['담당 없음', '세금 신고'])
    expect(titles({ name: 'x', q: '확인' })).toEqual(['참석자 확인'])
  })
  it('owner=me 는 내 이름들로, 내 이름이 비면 담당자 조건 없음', () => {
    expect(titles({ name: 'x', owner: 'me' }, ['지현'])).toEqual(['참석자 확인', '케이크', '시안'])
    expect(titles({ name: 'x', owner: 'me' }, []).length).toBe(titles({ name: 'x' }).length)
  })
  it('끝난·취소된 일은 나오지 않는다', () => {
    expect(titles({ name: 'x' })).not.toContain('끝난 일')
  })
})
