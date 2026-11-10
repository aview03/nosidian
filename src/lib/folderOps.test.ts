import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from './app'
import { allFolders, cleanName, firstLines, isUntitled, listDir, newMemoPath, planDelete, planMove, planRenameFolder, untitledCleanup } from './folderOps'
import type { NoteFile } from './types'

const f = (path: string, content = '', mtime = 1, extra: Partial<NoteFile> = {}): NoteFile => ({ path, content, sha: null, dirty: false, mtime, ...extra })
const vault = (list: NoteFile[]) => Object.fromEntries(list.map((x) => [x.path, x]))

describe('목록', () => {
  const files = vault([f('루트.md', '# 루트 노트\n본문 첫 줄', 5), f('일상/여행.md', '# 여행\n', 9), f('일상/집.md', '', 3), f('일상/2025/회고.md', '', 7), f('업무/A.md', '', 1), f('삭제됨.md', '', 1, { deleted: true })])
  it('폴더(노트 수는 하위 포함)와 노트(최근 수정순)를 나눠 준다. 삭제한 노트는 빠진다', () => {
    const root = listDir(files, '')
    expect(root.folders.map((x) => [x.name, x.count])).toEqual([['업무', 1], ['일상', 3]])
    expect(root.notes.map((n) => n.path)).toEqual(['루트.md'])
    const sub = listDir(files, '일상')
    expect(sub.folders.map((x) => x.path)).toEqual(['일상/2025'])
    expect(sub.notes.map((n) => n.path)).toEqual(['일상/여행.md', '일상/집.md'])
  })
  it('폴더 mtime 은 안의 가장 최근 수정', () => expect(listDir(files, '').folders.find((x) => x.name === '일상')!.mtime).toBe(9))
  it('allFolders: 상위 폴더까지 포함해 가나다순', () => expect(allFolders(files)).toEqual(['업무', '일상', '일상/2025']))
  it('firstLines: 속성·제목 기호를 걷어내고 첫 줄과 다음 줄', () => {
    expect(firstLines('---\ntags: a\n---\n# 제목\n\n- [ ] 할 일\n')).toEqual({ title: '제목', snippet: '할 일' })
    expect(firstLines('')).toEqual({ title: '', snippet: '' })
  })
  it('"새 메모" 노트는 파일 이름 대신 첫 줄을 제목으로 보여 준다', () => {
    const l = listDir(vault([f('새 메모.md', '장보기\n우유 사기', 1), f('새 메모 (2).md', '', 2)]), '')
    expect(l.notes.find((n) => n.path === '새 메모.md')).toMatchObject({ title: '장보기', snippet: '우유 사기', untitled: true })
    expect(l.notes.find((n) => n.path === '새 메모 (2).md')!.title).toBe('새 메모 (2)')
    expect(isUntitled('a/새 메모 (3).md')).toBe(true)
    expect(isUntitled('새 메모 정리.md')).toBe(false)
  })
})

describe('이동 계획', () => {
  const files = vault([f('a.md'), f('일상/b.md'), f('일상/2025/c.md'), f('업무/a.md')])
  it('노트를 폴더로 넣고, 폴더 밖(맨 위)으로 꺼낸다', () => {
    expect(planMove(files, ['a.md'], [], '일상').moves).toEqual([['a.md', '일상/a.md']])
    expect(planMove(files, ['일상/b.md'], [], '').moves).toEqual([['일상/b.md', 'b.md']])
  })
  it('같은 이름이 이미 있으면 (2) 를 붙여 덮어쓰지 않는다', () => {
    expect(planMove(files, ['a.md'], [], '업무').moves).toEqual([['a.md', '업무/a (2).md']])
  })
  it('폴더째 옮기면 안의 노트가 모두 따라간다(하위 폴더 포함)', () => {
    expect(planMove(files, [], ['일상'], '업무').moves.sort()).toEqual([['일상/2025/c.md', '업무/일상/2025/c.md'], ['일상/b.md', '업무/일상/b.md']].sort())
  })
  it('폴더를 자기 안이나 하위로는 못 옮긴다', () => {
    expect(planMove(files, [], ['일상'], '일상/2025').error).toBe('intoSelf')
    expect(planMove(files, [], ['일상'], '일상').error).toBe('intoSelf')
  })
  it('이미 그 자리면 아무것도 하지 않는다', () => {
    expect(planMove(files, ['일상/b.md'], [], '일상').moves).toEqual([])
    expect(planMove(files, [], ['일상'], '').moves).toEqual([])
  })
  it('여러 개를 한꺼번에 옮길 때 서로 이름이 겹쳐도 구분한다', () => {
    const m = planMove(files, ['a.md', '업무/a.md'], [], '일상').moves
    expect(m.map((x) => x[1]).sort()).toEqual(['일상/a (2).md', '일상/a.md'])
  })
})

describe('폴더 이름 바꾸기·삭제 계획', () => {
  const files = vault([f('일상/b.md'), f('일상/2025/c.md'), f('업무/a.md')])
  it('안의 노트 경로가 모두 새 이름으로', () => {
    expect(planRenameFolder(files, '일상', '생활').moves.sort()).toEqual([['일상/2025/c.md', '생활/2025/c.md'], ['일상/b.md', '생활/b.md']].sort())
    expect(planRenameFolder(files, '일상/2025', '작년').moves).toEqual([['일상/2025/c.md', '일상/작년/c.md']])
  })
  it('빈 이름·같은 이름의 폴더가 이미 있으면 거절(합치지 않는다)', () => {
    expect(planRenameFolder(files, '일상', '  ').error).toBe('badName')
    expect(planRenameFolder(files, '일상', '업무').error).toBe('exists')
    expect(planRenameFolder(files, '일상', '일상').moves).toEqual([])
  })
  it('이름에 쓸 수 없는 글자는 걷어낸다', () => expect(cleanName(' a/b:c  ')).toBe('a b c'))
  it('삭제: 선택한 노트 + 폴더 안의 모든 노트, 폴더 안에서 지워지는 수를 센다', () => {
    const d = planDelete(files, ['업무/a.md'], ['일상'])
    expect(d.paths.sort()).toEqual(['업무/a.md', '일상/2025/c.md', '일상/b.md'])
    expect(d.inFolders).toBe(2)
  })
})

describe('새로 쓰기', () => {
  it('비어 있는 "새 메모" 경로를 고른다', () => {
    expect(newMemoPath(vault([]), '')).toBe('새 메모.md')
    expect(newMemoPath(vault([f('일상/새 메모.md')]), '일상')).toBe('일상/새 메모 (2).md')
  })
  it('정리: 내용이 있으면 첫 줄이 이름, 비었으면 지운다, 열려 있는 노트는 그대로', () => {
    const files = vault([f('새 메모.md', '# 장보기 목록\n우유'), f('새 메모 (2).md', ''), f('새 메모 (3).md', '   \n'), f('새 메모 (4).md', '쓰는 중'), f('장보기 목록.md', '이미 있음')])
    const r = untitledCleanup(files, '새 메모 (4).md')
    expect(r.rename).toEqual([['새 메모.md', '장보기 목록 (2).md']])
    expect(r.remove.sort()).toEqual(['새 메모 (2).md', '새 메모 (3).md'])
  })
  it('첫 줄이 길거나 특수문자가 있어도 안전한 이름', () => {
    const r = untitledCleanup(vault([f('새 메모.md', 'a/b:c ' + 'x'.repeat(80))]), null)
    expect(r.rename[0][1].length).toBeLessThanOrEqual(44)
    expect(r.rename[0][1]).not.toMatch(/[:]/)
  })
})

describe('저장소: 일괄 이동·삭제', () => {
  beforeEach(() => {
    localStorage.clear()
    useApp.setState({ files: vault([f('a.md', 'A'), f('일상/b.md', 'B', 1, { sha: 'x' })]), current: 'a.md', history: ['a.md'], settings: { ...useApp.getState().settings, bookmarks: ['a.md'], recent: ['a.md'], activeVault: 'v1' } })
  })
  it('moveNotes: 새 경로로 옮기고, 열려 있던 노트·북마크·최근도 따라간다. 원격에 있던 파일은 삭제 표시가 남는다', () => {
    const n = useApp.getState().moveNotes([['a.md', '일상/a.md'], ['일상/b.md', 'b.md']])
    const s = useApp.getState()
    expect(n).toBe(2)
    expect(s.files['일상/a.md']).toMatchObject({ content: 'A', dirty: true })
    expect(s.files['a.md']).toBeUndefined()
    expect(s.files['일상/b.md']).toMatchObject({ deleted: true })
    expect(s.files['b.md']).toMatchObject({ content: 'B' })
    expect(s.current).toBe('일상/a.md')
    expect(s.settings.bookmarks).toEqual(['일상/a.md'])
    expect(s.settings.recent).toEqual(['일상/a.md'])
  })
  it('목적지에 이미 있으면 건너뛴다', () => {
    useApp.setState({ files: vault([f('a.md', 'A'), f('일상/a.md', 'X')]) })
    expect(useApp.getState().moveNotes([['a.md', '일상/a.md']])).toBe(0)
    expect(useApp.getState().files['a.md'].content).toBe('A')
  })
  it('deleteNotes: 한 번에 지우고 열려 있던 노트는 목록으로', () => {
    const n = useApp.getState().deleteNotes(['a.md', '일상/b.md'])
    const s = useApp.getState()
    expect(n).toBe(2)
    expect(s.files['a.md']).toBeUndefined()
    expect(s.files['일상/b.md']).toMatchObject({ deleted: true })
    expect(s.current).toBeNull()
    expect(s.settings.bookmarks).toEqual([])
  })
})

import { defaultDailyFolder, defaultProjectsFolder, projectsRoot } from './defaultFolders'
import { calendarDemo } from './demo.cal'
import { demoNotes } from './demo'
import { projectsIn, protectedFolder } from './folderOps'

describe('기본 폴더 이름(언어별)', () => {
  it('한국어는 할 일·프로젝트, 그 밖의 언어는 Tasks·Projects', () => {
    expect(defaultDailyFolder('ko')).toBe('할 일')
    expect(defaultProjectsFolder('ko')).toBe('프로젝트')
    for (const l of ['en', 'zh', 'ja', 'fr', 'es'] as const) {
      expect(defaultDailyFolder(l)).toBe('Tasks')
      expect(defaultProjectsFolder(l)).toBe('Projects')
    }
  })
  it('새 프로젝트의 최상위 폴더: 이미 쓰는 폴더가 있으면 언어를 바꿔도 그것을 쓴다', () => {
    expect(projectsRoot([], 'ko')).toBe('프로젝트')
    expect(projectsRoot([], 'en')).toBe('Projects')
    expect(projectsRoot(['Projects/A/개요.md', 'x.md'], 'ko')).toBe('Projects')
    expect(projectsRoot(['프로젝트/A/개요.md'], 'en')).toBe('프로젝트')
  })
  it('예제 vault 의 날짜별 노트는 지정한 Daily 폴더에 만들어진다', () => {
    expect(Object.keys(calendarDemo(true, '할 일')).some((p) => p.startsWith('할 일/'))).toBe(true)
    expect(Object.keys(calendarDemo(false, 'Tasks')).some((p) => p.startsWith('Tasks/'))).toBe(true)
    expect(Object.keys(calendarDemo(false)).some((p) => p.startsWith('Daily/'))).toBe(false)
    expect(Object.keys(demoNotes('ko', 'Daily').notes).some((p) => p.startsWith('Daily/'))).toBe(true)
    expect(Object.keys(demoNotes('ko').notes).some((p) => p.startsWith('할 일/'))).toBe(true)
  })
})

describe('앱이 쓰는 폴더 보호', () => {
  it('프로젝트·Daily·_workspace 최상위 폴더는 보호하고, 하위 폴더·일반 폴더는 아니다', () => {
    expect(protectedFolder('프로젝트', 'Daily')).toBe('projects')
    expect(protectedFolder('Projects', '할 일')).toBe('projects')
    expect(protectedFolder('Daily', 'Daily')).toBe('daily')
    expect(protectedFolder('할 일', '할 일')).toBe('daily')
    expect(protectedFolder('_workspace', 'Daily')).toBe('system')
    expect(protectedFolder('_보관', 'Daily')).toBe('system')
    expect(protectedFolder('프로젝트/행사 준비', 'Daily')).toBeNull()
    expect(protectedFolder('일상', 'Daily')).toBeNull()
    expect(protectedFolder('Daily', '')).toBeNull() // Daily 폴더를 쓰지 않는 설정이면 일반 폴더
  })
  it('폴더 안의 프로젝트 수(type: project 노트)', () => {
    const files = vault([f('프로젝트/A/개요.md', '---\ntype: project\n---\n# A'), f('프로젝트/B/개요.md', '---\ntype: "project"\n---\n'), f('프로젝트/B/메모.md', '# 메모'), f('프로젝트/C/x.md', '---\ntype: note\n---\n')])
    expect(projectsIn(files, '프로젝트')).toBe(2)
    expect(projectsIn(files, '프로젝트/A')).toBe(1)
    expect(projectsIn(files, '프로젝트/C')).toBe(0)
  })
})
