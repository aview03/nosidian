import { describe, expect, it } from 'vitest'
import { builtinTemplates, fillTemplate, planProject } from './projectTemplates'
import { setLang } from './i18n'
import { buildWork } from './work'
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
