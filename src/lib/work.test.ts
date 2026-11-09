import { describe, expect, it } from 'vitest'
import { buildQueues, buildWork, findTaskLine, parseMe, rewriteTaskLine, titleOfLine, tokensForState, uiStateOf } from './work'
import type { NoteFile } from './types'

const note = (path: string, content: string): NoteFile => ({ path, content, sha: null, dirty: false, mtime: 0 })
const mk = (...ns: NoteFile[]) => Object.fromEntries(ns.map((n) => [n.path, n]))
const TODAY = '2026-11-10'

const PROJECT = note('행사 준비/프로젝트 개요.md', '---\ntype: project\nstatus: active\nowner: 홍길동\ndue: 2026-12-20\nhealth: warning\n---\n# 행사 준비\n')

describe('프로젝트와 업무 판정', () => {
  it('type: project 노트를 프로젝트로 읽는다', () => {
    const w = buildWork(mk(PROJECT))
    expect(w.projects).toHaveLength(1)
    expect(w.projects[0]).toMatchObject({ name: '행사 준비', folder: '행사 준비', status: 'active', owner: ['홍길동'], due: '2026-12-20', health: 'warning' })
  })

  it('프로젝트 이름은 title > 첫 # 제목 > 파일 이름 순', () => {
    expect(buildWork(mk(PROJECT)).projects[0].name).toBe('행사 준비') // # 행사 준비
    const t = note('a/b.md', '---\ntype: project\ntitle: 제목 속성\n---\n# 본문 제목\n')
    expect(buildWork(mk(t)).projects[0].name).toBe('제목 속성')
    const n = note('a/파일이름.md', '---\ntype: project\n---\n본문만 있음\n')
    expect(buildWork(mk(n)).projects[0].name).toBe('파일이름')
  })

  it('프로젝트 폴더 아래 체크리스트는 토큰이 없어도 업무', () => {
    const w = buildWork(mk(PROJECT, note('행사 준비/할 일.md', '- [ ] 장소 섭외\n- [x] 예산 확정')))
    expect(w.tasks.map((t) => t.title)).toEqual(['장소 섭외', '예산 확정'])
    expect(w.tasks.every((t) => t.project === '행사 준비/프로젝트 개요.md')).toBe(true)
  })

  it('프로젝트 밖의 평범한 체크리스트는 업무가 아니다', () => {
    const w = buildWork(mk(PROJECT, note('개인/장보기.md', '- [ ] 우유\n- [ ] 계란')))
    expect(w.tasks).toHaveLength(0)
  })

  it('프로젝트 밖이어도 업무 토큰이 있으면 업무', () => {
    const w = buildWork(mk(note('개인/메모.md', '- [ ] 세금 신고 due:2026-12-01\n- [ ] 우유')))
    expect(w.tasks.map((t) => t.title)).toEqual(['세금 신고'])
    expect(w.tasks[0].project).toBeNull()
  })

  it('proj: 가 폴더 규칙보다 우선한다', () => {
    const other = note('다른/프로젝트 B.md', '---\ntype: project\n---\n')
    const w = buildWork(mk(PROJECT, other, note('행사 준비/할 일.md', '- [ ] 옮긴 일 proj:[[프로젝트 B]]')))
    expect(w.tasks[0].project).toBe('다른/프로젝트 B.md')
  })

  it('프론트매터 project: 로도 소속된다', () => {
    const w = buildWork(mk(PROJECT, note('회의/11월.md', '---\nproject: "[[프로젝트 개요]]"\n---\n- [ ] 후속 조치')))
    expect(w.tasks[0].project).toBe('행사 준비/프로젝트 개요.md')
  })

  it('코드 블록 안의 체크리스트는 무시', () => {
    const w = buildWork(mk(note('a.md', '```\n- [ ] 예시 due:2026-11-11\n```\n- [ ] 진짜 due:2026-11-11')))
    expect(w.tasks.map((t) => t.title)).toEqual(['진짜'])
  })

  it('삭제된 노트는 제외하고 일정 토큰은 제목에서 걷어 낸다', () => {
    const gone = { ...note('x.md', '- [ ] 사라짐 due:2026-11-11'), deleted: true }
    const w = buildWork(mk(gone, note('y.md', '- [ ] 14:00 회의 @2026-11-12 due:2026-11-12')))
    expect(w.tasks.map((t) => t.title)).toEqual(['회의'])
  })
})

describe('내 업무 대기열', () => {
  const files = mk(
    PROJECT,
    note('행사 준비/할 일.md', [
      '- [ ] 지난 일 due:2026-11-05 owner:홍길동',
      '- [ ] 오늘 일 due:2026-11-10 owner:홍길동',
      '- [ ] 이번 주 일 due:2026-11-14 owner:홍길동',
      '- [ ] 다음 달 일 due:2026-12-30 owner:홍길동',
      '- [ ] 답 대기 status:waiting side:other due:2026-11-08 owner:홍길동',
      '- [ ] 진행 중 status:doing owner:홍길동',
      '- [ ] 담당자 없음 due:2026-11-20',
      '- [ ] 남의 일 due:2026-11-06 owner:김철수',
      '- [x] 끝난 일 due:2026-11-01 owner:홍길동',
      '- [ ] 접음 status:dropped due:2026-11-01 owner:홍길동',
    ].join('\n')),
  )
  const q = buildQueues(buildWork(files), TODAY)
  const titles = (a: { task: { title: string } }[]) => a.map((x) => x.task.title)

  it('기한 초과·오늘·이번 주를 가른다', () => {
    expect(titles(q.overdue)).toEqual(['지난 일', '남의 일'])
    expect(titles(q.today)).toEqual(['오늘 일'])
    expect(titles(q.week)).toEqual(['이번 주 일'])
  })

  it('상대 차례(답 대기)는 기한 초과와 섞지 않는다', () => {
    expect(titles(q.waiting)).toEqual(['답 대기'])
    expect(q.overdue.some((x) => x.task.title === '답 대기')).toBe(false)
    expect(q.waiting[0].days).toBe(2) // 기한(11-08)을 이틀 넘김
  })

  it('끝난 일·접은 일은 어디에도 없다', () => {
    const all = [...q.overdue, ...q.today, ...q.week, ...q.waiting, ...q.doing, ...q.unowned]
    expect(all.some((x) => x.task.title === '끝난 일' || x.task.title === '접음')).toBe(false)
  })

  it('진행 중·담당자 없음 묶음', () => {
    expect(titles(q.doing)).toEqual(['진행 중'])
    expect(titles(q.unowned)).toEqual(['담당자 없음'])
  })

  it('내 이름으로 걸러도 담당자 없는 일은 남는다', () => {
    const mine = buildQueues(buildWork(files), TODAY, parseMe('홍길동'))
    expect(titles(mine.overdue)).toEqual(['지난 일'])
    expect(titles(mine.unowned)).toEqual(['담당자 없음'])
  })

  it('이름은 쉼표로 여러 개', () => {
    expect(parseMe(' 홍길동, 길동 ,')).toEqual(['홍길동', '길동'])
    expect(parseMe(undefined)).toEqual([])
  })
})

describe('숫자 상식 검사 (대기열이 의미를 잃지 않게)', () => {
  it('평범한 체크리스트 노트 수백 개는 업무로 세지 않는다', () => {
    const notes: NoteFile[] = []
    for (let i = 0; i < 300; i++) notes.push(note(`개인/목록 ${i}.md`, '- [ ] 할 것 1\n- [ ] 할 것 2\n- [x] 한 것'))
    notes.push(note('일/업무.md', '- [ ] 진짜 업무 due:2026-11-09 owner:나'))
    const w = buildWork(mk(...notes))
    expect(w.tasks).toHaveLength(1)
    const q = buildQueues(w, TODAY)
    expect(q.total).toBeLessThan(w.tasks.length + 1)
    expect(q.overdue).toHaveLength(1)
  })

  it('기한 초과가 전체 업무의 1/4 을 넘는 구성이 아니다 (정의가 뒤틀리면 걸린다)', () => {
    const lines = ['- [ ] 아주 오래전 due:2020-01-01 owner:나']
    for (let i = 0; i < 20; i++) lines.push(`- [ ] 앞으로 ${i} due:2026-12-${String((i % 28) + 1).padStart(2, '0')} owner:나`)
    const w = buildWork(mk(note('p/업무.md', lines.join('\n'))))
    const q = buildQueues(w, TODAY)
    expect(q.overdue.length).toBeLessThan(w.tasks.length / 4)
  })
})


describe('한 줄 편집 (rewriteTaskLine)', () => {
  const edit = (title: string, tokens = {}, done = false) => ({ title, done, tokens })

  it('제목과 업무 꼬리표만 바꾸고 들여쓰기·불릿은 그대로', () => {
    const out = rewriteTaskLine('  * [ ] 견적서 수정 due:2026-11-12 owner:홍길동', edit('견적서 최종 수정', { due: '2026-11-15', owner: ['김철수'], p: 1 }))
    expect(out).toBe('  * [ ] 견적서 최종 수정 due:2026-11-15 owner:김철수 p:1')
  })

  it('일정 꼬리표(시간·@날짜·end·repeat·until)는 보존한다', () => {
    const out = rewriteTaskLine('- [ ] 14:00-15:00 회의 @2026-11-20 repeat:weekly until:2026-12-31 owner:나', edit('주간 회의', { owner: ['민수'] }))
    expect(out).toBe('- [ ] 14:00-15:00 주간 회의 @2026-11-20 repeat:weekly until:2026-12-31 owner:민수')
  })

  it('모르는 status 값은 지우지 않는다', () => {
    const out = rewriteTaskLine('- [ ] 뭔가 status:모름 due:2026-11-12', edit('뭔가', { due: '2026-11-13' }))
    expect(out).toContain('status:모름')
    expect(out).toContain('due:2026-11-13')
  })

  it('완료 표시와 결론', () => {
    const out = rewriteTaskLine('- [ ] 정책 확정 status:waiting side:other', edit('정책 확정', { conclusion: '불가로 결정' }, true))
    expect(out).toBe('- [x] 정책 확정 => 불가로 결정')
  })

  it('쓴 줄을 다시 읽으면 같은 업무', () => {
    const line = rewriteTaskLine('- [ ] 시작', edit('룸 문의', tokensForState('waiting', { due: '2026-11-08', owner: ['민수'] })))!
    expect(line).toBe('- [ ] 룸 문의 status:waiting side:other due:2026-11-08 owner:민수')
    const w = buildWork(mk(note('p/업무.md', line)))
    expect(w.tasks[0]).toMatchObject({ title: '룸 문의', state: 'waiting', side: 'other', due: '2026-11-08', owner: ['민수'] })
    expect(uiStateOf(w.tasks[0])).toBe('waiting')
  })

  it('체크리스트가 아닌 줄은 건드리지 않는다', () => {
    expect(rewriteTaskLine('그냥 문장', edit('x'))).toBeNull()
    expect(titleOfLine('# 제목')).toBeNull()
  })

  it('줄 번호가 밀려도 같은 제목의 줄을 찾는다', () => {
    const content = '새로 생긴 줄\n- [ ] 다른 일\n- [ ] 대상 업무 due:2026-11-12'
    expect(findTaskLine(content, { line: 0, title: '대상 업무' })).toBe(2)
    expect(findTaskLine(content, { line: 2, title: '대상 업무' })).toBe(2)
    expect(findTaskLine(content, { line: 0, title: '없는 업무' })).toBe(-1)
  })

  it('상태 → 꼬리표', () => {
    expect(tokensForState('todo', { status: 'doing', side: 'other', due: '2026-11-12' })).toEqual({ due: '2026-11-12' })
    expect(tokensForState('doing', {})).toEqual({ status: 'doing' })
    expect(tokensForState('dropped', {})).toEqual({ status: 'dropped' })
  })
})
