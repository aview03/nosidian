import { describe, expect, it } from 'vitest'
import { builtinTemplates, fillTemplate, planProject, templateFromProject, vaultTemplates } from './projectTemplates'
import { setLang } from './i18n'
import { buildWork } from './work'
import { isTemplatePath, templateParts } from './templatePaths'
import type { NoteFile } from './types'

const F = { name: '봄 행사', owner: '민수', due: '2026-12-09', today: '2026-11-09' }

describe('프로젝트 템플릿', () => {
  it('마감일에서 거꾸로 날짜를 채운다', () => {
    expect(fillTemplate('a due:{{due-30}} b due:{{due+3}} c {{due}}', F)).toBe('a due:2026-11-09 b due:2026-12-12 c 2026-12-09')
  })
  it('마감일·담당자를 비우면 그 꼬리표가 줄에서 빠진다', () => {
    expect(fillTemplate('- [ ] x owner:{{owner}} due:{{due-7}}', { ...F, due: '', owner: '' })).toBe('- [ ] x')
    expect(fillTemplate('---\nowner: {{owner}}\ndue: {{due}}\n---\n', { ...F, due: '', owner: '' })).toBe('---\n---\n')
  })
  it('같은 이름 폴더가 있으면 번호를 붙인다', () => {
    setLang('ko')
    const t = builtinTemplates()[1]
    expect(planProject(t, F, '프로젝트', []).folder).toBe('프로젝트/봄 행사')
    expect(planProject(t, F, '프로젝트', ['프로젝트/봄 행사/할 일.md']).folder).toBe('프로젝트/봄 행사 (2)')
  })
  for (const lang of ['ko', 'en'] as const) {
    for (const due of ['2026-12-09', '']) {
      it(`(${lang}, 마감일 ${due || '없음'}) 모든 템플릿이 프로젝트 1개 + 업무로 읽힌다`, () => {
        setLang(lang)
        for (const tpl of builtinTemplates()) {
          const plan = planProject(tpl, { ...F, due }, 'Projects', [])
          expect(plan.overview).toBeTruthy()
          const files = Object.fromEntries(Object.entries(plan.files).map(([path, content]) => [path, { path, content, sha: null, dirty: false, mtime: 0 } as NoteFile]))
          const w = buildWork(files)
          expect(w.projects).toHaveLength(1)
          expect(w.projects[0].name).toBe('봄 행사')
          expect(w.tasks.length).toBeGreaterThan(0)
          expect(w.tasks.every((x) => x.project === plan.overview)).toBe(true)
          expect(JSON.stringify(plan.files)).not.toContain('{{')
        }
        setLang('ko')
      })
    }
  }
})

const mk = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([path, content]) => [path, { path, content, sha: null, dirty: false, mtime: 0 } as NoteFile]))

describe('사용자 템플릿 (vault 의 Templates/ 폴더)', () => {
  const OV = '---\ntype: project\ntemplate: 우리 팀 행사 틀\nowner: {{owner}}\ndue: {{due}}\n---\n# {{name}}\n'
  const TASKS = '# 할 일\n\n- [ ] 장소 확정 owner:{{owner}} due:{{due-14}}\n- [ ] {{name}} 공지 due:{{due-7}}\n'
  const files = mk({
    'Templates/행사 틀/프로젝트 개요.md': OV,
    'Templates/행사 틀/할 일.md': TASKS,
    'Templates/행사 틀/{{name}} 회의록.md': '# {{name}} 회의록\n',
    'Templates/빈 틀/메모.md': '# 메모\n',
    'Templates/루트 파일.md': '템플릿 루트에 바로 둔 파일은 템플릿이 아니다',
    '템플릿/한글 폴더 틀/개요.md': '---\ntype: project\n---\n# {{name}}\n',
    'Templates/지운 틀/a.md': 'x',
  })
  files['Templates/지운 틀/a.md'].deleted = true

  it('경로 판정: 루트 아래 폴더 하나가 템플릿 하나', () => {
    expect(templateParts('Templates/행사 틀/할 일.md')).toEqual({ name: '행사 틀', rel: '할 일.md' })
    expect(templateParts('templates/a/b/c.md')).toEqual({ name: 'a', rel: 'b/c.md' })
    expect(templateParts('Templates/루트 파일.md')).toBeNull()
    expect(templateParts('Daily/2026-11-09.md')).toBeNull()
    expect(isTemplatePath('Templates/루트 파일.md')).toBe(true)
    expect(isTemplatePath('프로젝트/Templates/a.md')).toBe(false)
  })
  it('폴더마다 템플릿 하나, 삭제된 것·루트 파일은 제외, 설명은 머리말 template: 에서', () => {
    setLang('ko')
    const v = vaultTemplates(files)
    expect(v.map((x) => x.name)).toEqual(['빈 틀', '한글 폴더 틀', '행사 틀'])
    const t1 = v.find((x) => x.name === '행사 틀')!
    expect(t1.desc).toBe('우리 팀 행사 틀')
    expect(t1.mine).toBe(true)
    expect(Object.keys(t1.files).sort()).toEqual(['{{name}} 회의록.md', '프로젝트 개요.md', '할 일.md'])
    expect(v.find((x) => x.name === '빈 틀')!.desc).toBe('내 템플릿 · 문서 1개')
  })
  it('틀 안의 노트는 진짜 프로젝트·업무로 세지 않는다', () => {
    const w = buildWork(files)
    expect(w.projects).toHaveLength(0)
    expect(w.tasks).toHaveLength(0)
  })
  it('새 프로젝트를 만들면 파일 이름·내용의 자리표시자가 채워지고 template: 키는 빠진다', () => {
    setLang('ko')
    const tpl = vaultTemplates(files).find((x) => x.name === '행사 틀')!
    const plan = planProject(tpl, { name: '봄 행사', owner: '민수', due: '2026-12-09', today: '2026-11-09' }, '프로젝트', [])
    expect(Object.keys(plan.files).sort()).toEqual(['프로젝트/봄 행사/봄 행사 회의록.md', '프로젝트/봄 행사/프로젝트 개요.md', '프로젝트/봄 행사/할 일.md'])
    expect(plan.overview).toBe('프로젝트/봄 행사/프로젝트 개요.md')
    expect(plan.files[plan.overview]).not.toContain('template:')
    expect(plan.files['프로젝트/봄 행사/할 일.md']).toContain('- [ ] 장소 확정 owner:민수 due:2026-11-25')
    expect(JSON.stringify(plan.files)).not.toContain('{{')
    const w = buildWork(mk(plan.files))
    expect(w.projects).toHaveLength(1)
    expect(w.projects[0].name).toBe('봄 행사')
    expect(w.tasks).toHaveLength(2)
  })
  it('프로젝트 노트가 없는 템플릿이어도 개요 노트를 만들어 프로젝트가 된다', () => {
    setLang('ko')
    const tpl = vaultTemplates(files).find((x) => x.name === '빈 틀')!
    const plan = planProject(tpl, { name: 'X', owner: '', due: '', today: '2026-11-09' }, '프로젝트', [])
    expect(plan.overview).toBe('프로젝트/X/프로젝트 개요.md')
    expect(buildWork(mk(plan.files)).projects).toHaveLength(1)
  })
})

describe('프로젝트를 템플릿으로 저장', () => {
  const proj = mk({
    '프로젝트/봄 행사/프로젝트 개요.md': '---\ntype: project\nstatus: 진행 중\nowner: 민수\ndue: 2026-12-09\nhealth: warning\ntitle: 봄 행사\n---\n# 봄 행사\n\n봄 행사 소개\n',
    '프로젝트/봄 행사/할 일.md': '# 할 일\n\n- [x] 날짜 확정 owner:민수 due:2026-11-09 => 토요일로 결정\n- [ ] 케이크 owner:지현 due:2026-12-09 status:doing\n- [ ] 정산 due:2026-12-12\n- [ ] 날짜 없는 일 owner:민수\n설명 글 [x] 는 그대로\n',
    '프로젝트/다른 프로젝트/a.md': '무관',
  })
  const w = buildWork(proj)
  const out = templateFromProject(w.projects[0], proj, '행사 틀', [])

  it('이름·머리말·할 일이 틀로 바뀐다(완료·결론·상태 제거, 마감은 프로젝트 마감 기준)', () => {
    expect(Object.keys(out.files).sort()).toEqual(['Templates/행사 틀/프로젝트 개요.md', 'Templates/행사 틀/할 일.md'])
    const ov = out.files['Templates/행사 틀/프로젝트 개요.md']
    expect(ov).toContain('owner: {{owner}}')
    expect(ov).toContain('due: {{due}}')
    expect(ov).toContain('title: {{name}}')
    expect(ov).toContain('# {{name}}')
    expect(ov).toContain('{{name}} 소개')
    expect(ov).not.toContain('health:')
    const tk = out.files['Templates/행사 틀/할 일.md']
    expect(tk).toContain('- [ ] 날짜 확정 owner:{{owner}} due:{{due-30}}')
    expect(tk).not.toContain('=>')
    expect(tk).toContain('- [ ] 케이크 owner:지현 due:{{due}}')
    expect(tk).not.toContain('status:')
    expect(tk).toContain('- [ ] 정산 due:{{due+3}}')
    expect(tk).toContain('- [ ] 날짜 없는 일 owner:{{owner}}')
    expect(tk).toContain('설명 글 [x] 는 그대로')
  })
  it('같은 이름의 템플릿이 있으면 번호를 붙인다', () => {
    expect(templateFromProject(w.projects[0], proj, '행사 틀', ['Templates/행사 틀/a.md']).name).toBe('행사 틀 (2)')
  })
  it('저장한 틀로 새 프로젝트를 만들면 같은 구조가 되고 날짜가 새 마감 기준으로 옮겨 간다 (왕복)', () => {
    setLang('ko')
    const tpl = vaultTemplates(mk(out.files))[0]
    const plan = planProject(tpl, { name: '가을 행사', owner: '지현', due: '2027-03-01', today: '2027-01-01' }, '프로젝트', [])
    const tasks = buildWork(mk(plan.files)).tasks
    expect(tasks.map((x) => [x.title, x.due])).toEqual([['날짜 확정', '2027-01-30'], ['케이크', '2027-03-01'], ['정산', '2027-03-04'], ['날짜 없는 일', undefined]])
    expect(tasks.every((x) => !x.done)).toBe(true)
  })
  it('프로젝트 마감이 없으면 마감일 꼬리표는 뺀다', () => {
    const noDue = mk({ '프로젝트/P/개요.md': '---\ntype: project\n---\n# P\n', '프로젝트/P/할 일.md': '- [ ] a due:2026-11-09\n' })
    const p = buildWork(noDue).projects[0]
    const o = templateFromProject(p, noDue, 'T', [])
    expect(o.files['Templates/T/할 일.md']).toBe('- [ ] a\n')
  })
})

describe('프로젝트 템플릿: 시작일(start:)과 새 템플릿 (첫 걸음)', () => {
  const all = (lang: 'ko' | 'en', due: string) => {
    setLang(lang)
    const out = builtinTemplates().map((tpl) => ({ tpl, plan: planProject(tpl, { ...F, due }, 'Projects', []) }))
    setLang('ko')
    return out
  }
  for (const lang of ['ko', 'en'] as const) {
    it(`(${lang}) 마감일이 없으면 start: 꼬리표도 줄에서 빠진다(예전: start:NaN-NaN-NaN 이 생겼다)`, () => {
      for (const { plan } of all(lang, '')) {
        const text = JSON.stringify(plan.files)
        expect(text).not.toMatch(/start:(?!\d{4}-\d{2}-\d{2})/)
        expect(text).not.toContain('NaN')
      }
    })
    it(`(${lang}) 마감일이 있으면 start: 는 모두 올바른 날짜이고 같은 줄의 due 보다 늦지 않다`, () => {
      for (const { plan } of all(lang, '2026-12-09')) {
        for (const content of Object.values(plan.files)) {
          for (const line of content.split('\n')) {
            const st = /start:(\d{4}-\d{2}-\d{2})/.exec(line)?.[1]
            const du = /due:(\d{4}-\d{2}-\d{2})/.exec(line)?.[1]
            if (st && du) expect(st <= du).toBe(true)
          }
        }
      }
    })
  }
  it('디자인 일정·기획 정식 템플릿이 있다', () => {
    for (const lang of ['ko', 'en'] as const) {
      expect(all(lang, '2026-12-09').map((x) => x.tpl.id)).toEqual(['general', 'event', 'content', 'design', 'planning'])
    }
  })
  it('디자인 일정: 개요에 depth: light · words: design 이 있고, 문서 틀 없이 일정 업무만 있다', () => {
    const { tpl, plan } = all('ko', '2026-12-09').find((x) => x.tpl.id === 'design')!
    const overview = plan.files[plan.overview]
    expect(overview).toMatch(/^depth: light$/m)
    expect(overview).toMatch(/^words: design$/m)
    expect(Object.keys(tpl.files)).toEqual(['프로젝트 개요.md', '할 일.md'])
  })
  it('기획 정식: PRD·정책서·기능설계서·IA 구조도·결정 기록 문서 틀과 일정 업무가 있고, 결정 안건이 결정 업무로 읽힌다', () => {
    const { plan } = all('ko', '2026-12-09').find((x) => x.tpl.id === 'planning')!
    const names = Object.keys(plan.files).map((p) => p.split('/').pop())
    expect(names).toEqual(expect.arrayContaining(['PRD.md', '정책서.md', '기능설계서.md', 'IA 구조도.md', '결정 기록.md', '할 일.md']))
    const files = Object.fromEntries(Object.entries(plan.files).map(([path, content]) => [path, { path, content, sha: null, dirty: false, mtime: 0 } as NoteFile]))
    const w = buildWork(files)
    expect(w.tasks.some((x) => x.kind === 'decision')).toBe(true)
    expect(w.tasks.filter((x) => x.start && x.due).length).toBeGreaterThanOrEqual(5) // 간트에 막대로 보인다
    expect(plan.files[plan.overview]).not.toMatch(/^depth:/m) // 표준(모든 탭)
  })
  it('프로젝트를 템플릿으로 저장할 때 start: 도 마감일 기준 {{due±N}} 로 바뀐다(절대 날짜가 남지 않는다)', () => {
    const files: Record<string, NoteFile> = {
      'P/개요.md': { path: 'P/개요.md', content: '---\ntype: project\nowner: 민수\ndue: 2026-12-09\n---\n# P\n', sha: null, dirty: false, mtime: 0 },
      'P/할 일.md': { path: 'P/할 일.md', content: '# 할 일\n\n- [x] 시안 start:2026-11-18 due:2026-11-25 owner:민수\n', sha: null, dirty: false, mtime: 0 },
    }
    const w = buildWork(files)
    const out = templateFromProject(w.projects[0], files, '시안틀', Object.keys(files))
    const text = JSON.stringify(out.files)
    expect(text).toContain('start:{{due-21}}')
    expect(text).toContain('due:{{due-14}}')
    expect(text).not.toContain('2026-11-18')
  })
  it('새 템플릿은 만들자마자 "담당자 없는 일"로 주의가 뜨지 않도록 모든 업무 줄에 담당자가 있다(담당자를 넣었을 때)', () => {
    for (const lang of ['ko', 'en'] as const) {
      for (const { tpl, plan } of all(lang, '2026-12-09')) {
        if (tpl.id !== 'design' && tpl.id !== 'planning') continue
        const tasksNote = Object.entries(plan.files).find(([p]) => /(할 일|Tasks)\.md$/.test(p))![1]
        const lines = tasksNote.split('\n').filter((l) => /^- \[ \]/.test(l))
        expect(lines.length).toBeGreaterThanOrEqual(4)
        for (const l of lines) expect(l).toContain('owner:민수')
      }
    }
  })
})
