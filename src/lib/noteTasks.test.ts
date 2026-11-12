import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyRows, buildRows, extractHints, rowChanged, suggestOwner } from './noteTasks'
import { buildWork } from './work'
import type { NoteFile } from './types'

const TODAY = '2026-11-11' // 수요일
const KNOWN = new Set(['민수', '지현'])
const ex = (t: string, known = KNOWN) => extractHints(t, known, TODAY)

// '내일'·'금요일' 같은 말은 실제 오늘 날짜로 풀리므로, 시계를 TODAY 로 고정한다(고정하지 않으면 날짜가 바뀌는 날 실패한다)
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${TODAY}T12:00:00`)) })
afterAll(() => { vi.useRealTimers() })

describe('제목에서 담당·마감 읽기', () => {
  it('괄호 안의 (이름, 날짜까지)를 담당·마감으로 읽고 제목에서 뺀다', () => {
    expect(ex('행사장 계약서 검토 (민수, 11/18까지)')).toEqual({ title: '행사장 계약서 검토', owner: ['민수'], due: '2026-11-18', found: true })
  })
  it('아는 이름만 있는 괄호도 담당으로 읽는다', () => {
    expect(ex('케이터링 견적 3곳 받기 (지현)')).toMatchObject({ title: '케이터링 견적 3곳 받기', owner: ['지현'], due: undefined, found: true })
  })
  it('모르는 이름은 같은 괄호에 날짜가 있을 때만 이름으로 본다', () => {
    expect(ex('자료 정리 (새사람)', new Set())).toMatchObject({ found: false, title: '자료 정리 (새사람)' })
    expect(ex('자료 정리 (새사람, 11/20까지)', new Set())).toMatchObject({ owner: ['새사람'], due: '2026-11-20' })
  })
  it('말머리(참고·긴급 …)는 이름으로 보지 않는다', () => {
    expect(ex('보고서 작성 (긴급)', new Set(['긴급']))).toMatchObject({ found: false, title: '보고서 작성 (긴급)' })
    expect(ex('보고서 작성 (참고, 11/20까지)')).toMatchObject({ found: false }) // 참고 는 이름도 날짜도 아니라 괄호를 건드리지 않는다
  })
  it('이름도 날짜도 아닌 글이 섞인 괄호는 그대로 둔다', () => {
    expect(ex('발표 자료 (지난 회의 참고)')).toMatchObject({ found: false, title: '발표 자료 (지난 회의 참고)' })
  })
  it('@이름 을 읽는다(@날짜 꼬리표는 건드리지 않는다)', () => {
    expect(ex('시안 확인 @지현')).toMatchObject({ title: '시안 확인', owner: ['지현'], found: true })
    expect(ex('보고서 제출 @2026-11-20')).toMatchObject({ found: false, title: '보고서 제출 @2026-11-20' })
  })
  it('괄호 밖 "…까지" 날짜를 읽는다(요일·월/일)', () => {
    expect(ex('견적 받기 금요일까지')).toMatchObject({ title: '견적 받기', due: '2026-11-13' })
    expect(ex('포스터 11월 20일까지 완성')).toMatchObject({ title: '포스터 완성', due: '2026-11-20' })
    expect(ex('정산 내일까지')).toMatchObject({ title: '정산', due: '2026-11-12' })
  })
  it('"까지" 없는 날짜 표현은 읽지 않는다(제목의 일부일 수 있다)', () => {
    expect(ex('11/18 회의 준비')).toMatchObject({ found: false, title: '11/18 회의 준비' })
    expect(ex('내일 발표 연습')).toMatchObject({ found: false })
  })
  it('여러 이름도 읽는다', () => {
    expect(ex('현수막 제작 (민수·지현, 11/20까지)')).toMatchObject({ owner: ['민수', '지현'], due: '2026-11-20' })
  })
  it('읽고 나서 제목이 비면 원문을 그대로 둔다', () => {
    expect(ex('(민수, 11/18까지)')).toMatchObject({ title: '(민수, 11/18까지)', found: false })
  })
})

const MINUTES = ['# 회의록 11-11', '', '## 후속 업무', '- [ ] 행사장 계약서 검토 (민수, 11/18까지)', '- [ ] 케이터링 견적 3곳 받기 (지현)', '- [ ] 포스터 시안 2안 만들기', '  - [ ] 하위: 문구 확정', '- [x] 이미 끝난 일 (민수)', '- 그냥 글머리', ''].join('\n')

describe('노트의 열린 줄 → 행', () => {
  const rows = buildRows(MINUTES, KNOWN, TODAY)
  it('열린 체크리스트 줄만 행이 된다(끝난 줄·글머리 제외, 하위 줄 포함)', () => {
    expect(rows.map((r) => r.line)).toEqual([3, 4, 5, 6])
  })
  it('읽은 값이 미리 채워지고 hinted 로 표시된다', () => {
    expect(rows[0]).toMatchObject({ title: '행사장 계약서 검토', owner: ['민수'], due: '2026-11-18', hinted: true })
    expect(rows[1]).toMatchObject({ title: '케이터링 견적 3곳 받기', owner: ['지현'], hinted: true })
    expect(rows[2]).toMatchObject({ title: '포스터 시안 2안 만들기', owner: [], hinted: false })
  })
  it('읽을 게 없는 행은 안 바뀐 것으로 본다. 읽은 행은 바뀐 것으로 본다', () => {
    expect(rowChanged(rows[2])).toBe(false)
    expect(rowChanged(rows[0])).toBe(true)
  })
  it('줄에 이미 담당·마감 꼬리표가 있으면 그 값을 쓰고 제목에서 읽지 않는다', () => {
    const r = buildRows('- [ ] 검토 (지현) owner:민수 due:2026-11-30', KNOWN, TODAY)[0]
    expect(r).toMatchObject({ title: '검토 (지현)', owner: ['민수'], due: '2026-11-30', hinted: false })
    expect(rowChanged(r)).toBe(false)
  })
})

describe('행 → 노트에 적용', () => {
  const rows = buildRows(MINUTES, KNOWN, TODAY)
  const out = applyRows(MINUTES, rows)
  it('바뀐 줄만 꼬리표로 다시 쓴다(제목에서 괄호 제거)', () => {
    const lines = out.split('\n')
    expect(lines[3]).toBe('- [ ] 행사장 계약서 검토 due:2026-11-18 owner:민수')
    expect(lines[4]).toBe('- [ ] 케이터링 견적 3곳 받기 owner:지현')
  })
  it('안 바뀐 줄·끝난 줄·들여쓴 줄·다른 글은 그대로다', () => {
    const before = MINUTES.split('\n')
    const after = out.split('\n')
    for (const i of [0, 1, 2, 5, 6, 7, 8]) expect(after[i]).toBe(before[i])
  })
  it('적용하면 허브의 업무로 담당·마감이 읽힌다', () => {
    const files: NoteFile[] = [
      { path: '프로젝트/행사/프로젝트 개요.md', content: '---\ntype: project\n---\n# 행사\n', sha: null, dirty: false, mtime: 1 },
      { path: '프로젝트/행사/회의록.md', content: out, sha: null, dirty: false, mtime: 1 },
    ]
    const tasks = buildWork(Object.fromEntries(files.map((f) => [f.path, f]))).tasks
    const t = tasks.find((x) => x.title === '행사장 계약서 검토')!
    expect(t).toMatchObject({ owner: ['민수'], due: '2026-11-18' })
  })
  it('사람이 고친 값(담당 바꾸기·마감 지우기·결정으로)이 적용된다', () => {
    const r = buildRows('- [ ] 정책 정하기 (민수, 11/18까지)', KNOWN, TODAY)
    r[0].owner = ['지현']
    r[0].due = undefined
    r[0].decision = true
    expect(applyRows('- [ ] 정책 정하기 (민수, 11/18까지)', r)).toBe('- [ ] 정책 정하기 kind:decision owner:지현')
  })
  it('그새 줄이 바뀌었으면(제목이 달라짐) 건너뛴다', () => {
    const r = buildRows('- [ ] 가 (민수)', KNOWN, TODAY)
    expect(applyRows('- [ ] 전혀 다른 줄', r)).toBe('- [ ] 전혀 다른 줄')
  })
  it('들여쓰기와 일정 꼬리표는 보존한다', () => {
    const src = '  - [ ] 14:00 점검 (지현) @2026-11-20'
    const r = buildRows(src, KNOWN, TODAY)
    expect(applyRows(src, r)).toBe('  - [ ] 14:00 점검 @2026-11-20 owner:지현')
  })
})

import { applyDecisions, buildDecisionRows, splitDecision } from './noteTasks'

describe('결정 사항 → 결정 기록 (F26)', () => {
  it('"A는 B로 확정"을 안건과 결론으로 나눈다. 못 나누면 문장 전체를 둘 다에', () => {
    expect(splitDecision('행사 날짜는 12월 9일로 확정')).toEqual({ title: '행사 날짜', conclusion: '12월 9일로 확정' })
    expect(splitDecision('예산 상한은 300만원으로 합의')).toEqual({ title: '예산 상한', conclusion: '300만원으로 합의' })
    expect(splitDecision('장소는 대관 후 결정')).toEqual({ title: '장소', conclusion: '대관 후 결정' })
    expect(splitDecision('포스터 문구 수정')).toEqual({ title: '포스터 문구 수정', conclusion: '포스터 문구 수정' })
  })

  const MINUTES = ['# 회의록', '', '## 안건', '- 이건 안건 글머리', '', '## 결정', '- 행사 날짜는 12월 9일로 확정', '  - 하위 글머리 예산은 300만원으로 합의', '- [ ] 이건 체크리스트라 제외', '- [x] 끝난 체크리스트도 제외', '', '## 후속 업무', '- [ ] 계약서 검토', '- 후속 업무 아래 글머리는 제외', ''].join('\n')

  it('"## 결정" 머리말 아래(다음 머리말 전까지)의 일반 글머리만 행이 된다(체크리스트 제외)', () => {
    const rows = buildDecisionRows(MINUTES)
    expect(rows.map((r) => r.line)).toEqual([6, 7])
    expect(rows[0]).toMatchObject({ init: '행사 날짜는 12월 9일로 확정', on: false, title: '행사 날짜', conclusion: '12월 9일로 확정' })
  })
  it('"결정 사항"·"Decisions" 같은 머리말도 인식한다', () => {
    for (const h of ['## 결정 사항', '### 결정내용', '## Decisions', '# 결정:']) expect(buildDecisionRows(`${h}\n- 가는 나로 확정\n`), h).toHaveLength(1)
    expect(buildDecisionRows('## 결정 보류 목록\n- 가는 나로 확정\n')).toHaveLength(0)
  })
  it('꺼져 있으면(기본) 노트를 건드리지 않는다', () => {
    expect(applyDecisions(MINUTES, buildDecisionRows(MINUTES))).toBe(MINUTES)
  })
  it('켠 행은 완료된 결정 안건(+결론)으로 바뀌고 들여쓰기·글머리 모양이 보존된다', () => {
    const rows = buildDecisionRows(MINUTES).map((r) => ({ ...r, on: true }))
    const lines = applyDecisions(MINUTES, rows).split('\n')
    expect(lines[6]).toBe('- [x] 행사 날짜 kind:decision => 12월 9일로 확정')
    expect(lines[7]).toBe('  - [x] 하위 글머리 예산 kind:decision => 300만원으로 합의')
    expect(lines[8]).toBe('- [ ] 이건 체크리스트라 제외')
  })
  it('사람이 고친 안건·결론이 쓰이고, 그새 줄이 바뀌었으면 건너뛴다', () => {
    const rows = buildDecisionRows('## 결정\n- 가는 나로 확정\n')
    rows[0].on = true
    rows[0].title = '담당 배정'
    rows[0].conclusion = '민수가 맡기로'
    expect(applyDecisions('## 결정\n- 가는 나로 확정\n', rows)).toBe('## 결정\n- [x] 담당 배정 kind:decision => 민수가 맡기로\n')
    expect(applyDecisions('## 결정\n- 전혀 다른 글\n', rows)).toBe('## 결정\n- 전혀 다른 글\n')
  })
  it('적용하면 업무로 읽히고 결론이 보인다(완료된 결정 안건)', () => {
    const src = '## 결정\n- 행사 날짜는 12월 9일로 확정\n'
    const rows = buildDecisionRows(src).map((r) => ({ ...r, on: true }))
    const out = applyDecisions(src, rows)
    const files: NoteFile[] = [
      { path: '프로젝트/행사/프로젝트 개요.md', content: '---\ntype: project\n---\n# 행사\n', sha: null, dirty: false, mtime: 1 },
      { path: '프로젝트/행사/회의록.md', content: out, sha: null, dirty: false, mtime: 1 },
    ]
    const t = buildWork(Object.fromEntries(files.map((f) => [f.path, f]))).tasks.find((x) => x.title === '행사 날짜')!
    expect(t).toMatchObject({ done: true, kind: 'decision', conclusion: '12월 9일로 확정' })
  })
})

describe('모르는 이름 제안(자동으로 읽지는 않는다)', () => {
  it('제목 끝 괄호의 모르는 한글 이름 하나를 제안한다', () => {
    expect(suggestOwner('케이터링 견적 3곳 받기 (지현)', new Set())).toEqual({ name: '지현', title: '케이터링 견적 3곳 받기' })
    expect(suggestOwner('시안 확인 [수진]', new Set())).toEqual({ name: '수진', title: '시안 확인' })
  })
  it('아는 이름(자동으로 읽는다)·말머리·영문·긴 글·제목이 비는 경우는 제안하지 않는다', () => {
    expect(suggestOwner('견적 (지현)', new Set(['지현']))).toBeNull()
    expect(suggestOwner('보고서 (참고)', new Set())).toBeNull()
    expect(suggestOwner('보고서 (draft)', new Set())).toBeNull()
    expect(suggestOwner('발표 자료 (지난 회의 참고)', new Set())).toBeNull()
    expect(suggestOwner('(지현)', new Set())).toBeNull()
  })
  it('자동 읽기는 그대로다: 모르는 이름만 있는 괄호는 읽지 않는다', () => {
    expect(extractHints('자료 정리 (새사람)', new Set(), TODAY)).toMatchObject({ found: false, title: '자료 정리 (새사람)' })
  })
})
