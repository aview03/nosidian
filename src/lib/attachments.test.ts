import { setLang } from './i18n'
import { describe, expect, it } from 'vitest'
import { formatSize, gate, isExecutable, LARGE_BYTES, MAX_PHONE_BYTES, othersIn } from './attachments'
import { capOthers, isOther, MAX_OTHERS } from './sync'

setLang('ko')

describe('다른 파일 판정', () => {
  it('노트·이미지가 아닌 것만 "다른 파일"', () => {
    for (const p of ['a.py', 'b/report.docx', 'x.PDF', 'z.zip', 'p.exe', 'noext']) expect(isOther(p)).toBe(true)
    for (const p of ['a.md', 'b/C.MD', 'i.png', 'j.JPG', 'k.svg']) expect(isOther(p)).toBe(false)
  })
  it('목록에 올리는 다른 파일은 개수 상한이 있고 노트·이미지는 전부 남긴다', () => {
    const entries = [{ path: 'n.md' }, { path: 'i.png' }, ...Array.from({ length: MAX_OTHERS + 5 }, (_, i) => ({ path: `f${i}.txt` })), { path: 'last.md' }]
    const out = capOthers(entries)
    expect(out.filter((e) => isOther(e.path))).toHaveLength(MAX_OTHERS)
    expect(out.map((e) => e.path)).toContain('last.md')
    expect(out).toHaveLength(MAX_OTHERS + 3)
  })
})

describe('폴더별 파일 목록', () => {
  const assets = { 'main.py': { size: 10 }, 'img.png': { size: 5 }, 'proj/report.docx': { size: 2048 }, 'proj/sub/a.zip': {}, 'proj/b.pdf': { size: 1 }, 'other/x.txt': {} }
  it('루트: 바로 아래 파일과, 파일이 든 하위 폴더(이미지는 제외)', () => {
    const r = othersIn(assets, '')
    expect(r.files.map((f) => f.name)).toEqual(['main.py'])
    expect(r.folders).toEqual([{ path: 'other', name: 'other', count: 1 }, { path: 'proj', name: 'proj', count: 3 }])
  })
  it('하위 폴더 안', () => {
    const r = othersIn(assets, 'proj')
    expect(r.files.map((f) => f.name)).toEqual(['b.pdf', 'report.docx'])
    expect(r.folders).toEqual([{ path: 'proj/sub', name: 'sub', count: 1 }])
  })
  it('비슷한 이름의 폴더를 섞지 않는다', () => {
    expect(othersIn({ 'proj2/a.txt': {} }, 'proj').files).toEqual([])
  })
})

describe('받기 전 확인', () => {
  it('실행 파일은 폰에서 막고, PC 에서는 묻는다', () => {
    expect(isExecutable('x/Setup.EXE')).toBe(true)
    expect(isExecutable('a.py')).toBe(false)
    expect(gate('p.exe', 1, true)).toEqual({ ok: false, reason: 'executable-phone' })
    expect(gate('p.exe', 1, false)).toEqual({ ok: 'confirm', reason: 'executable' })
  })
  it('큰 파일은 묻고, 폰은 아주 큰 파일을 막는다', () => {
    expect(gate('a.pdf', 1000, true)).toEqual({ ok: true })
    expect(gate('a.pdf', LARGE_BYTES + 1, true)).toEqual({ ok: 'confirm', reason: 'large' })
    expect(gate('a.zip', MAX_PHONE_BYTES + 1, true)).toEqual({ ok: false, reason: 'too-large-phone' })
    expect(gate('a.zip', MAX_PHONE_BYTES + 1, false)).toEqual({ ok: 'confirm', reason: 'large' })
    expect(gate('a.pdf', undefined, true)).toEqual({ ok: true })
  })
  it('크기 표기', () => {
    expect(formatSize(undefined)).toBe('')
    expect(formatSize(12)).toBe('12 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatSize(30 * 1024 * 1024)).toBe('30 MB')
  })
})

import { uploadPath, uploadProblem, MAX_UPLOAD_BYTES } from './attachments'
import { pushChanges } from './github'
import { vi } from 'vitest'

describe('올리기 규칙', () => {
  it('노트·숨김·빈 파일·너무 큰 파일은 막는다', () => {
    expect(uploadProblem('a.md', 5)).toContain('가져오기')
    expect(uploadProblem('.env', 5)).toContain('숨김')
    expect(uploadProblem('a.zip', 0)).toContain('빈 파일')
    expect(uploadProblem('a.zip', MAX_UPLOAD_BYTES + 1)).toContain('너무 커요')
    expect(uploadProblem('a.docx', 1000)).toBeNull()
  })
  it('경로: 폴더 아래에 두고, 같은 이름이면 번호를 붙이며(대소문자 무시), 금지 문자는 바꾼다', () => {
    expect(uploadPath('', 'r.docx', new Set())).toBe('r.docx')
    expect(uploadPath('proj/sub', 'r.docx', new Set())).toBe('proj/sub/r.docx')
    expect(uploadPath('proj', 'r.docx', new Set(['proj/R.DOCX', 'proj/r (2).docx']))).toBe('proj/r (3).docx')
    expect(uploadPath('', 'a:b?.txt', new Set())).toBe('a_b_.txt')
    expect(uploadPath('', 'noext', new Set(['noext']))).toBe('noext (2)')
  })
})

describe('GitHub 업로드: 바이너리는 base64 blob 으로', () => {
  it('b64 가 있으면 base64 로, 없으면 utf-8 로 blob 을 만든다', async () => {
    const calls: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') })
      const u = String(url)
      const j = (o: unknown) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) })
      if (u.includes('/git/ref/')) return j({ object: { sha: 'c0' } })
      if (u.includes('/git/commits/c0')) return j({ tree: { sha: 't0' } })
      if (u.endsWith('/git/blobs')) return j({ sha: 'blob' + calls.length })
      if (u.endsWith('/git/trees')) return j({ sha: 't1' })
      if (u.endsWith('/git/commits')) return j({ sha: 'c1' })
      return j({})
    }))
    const revs = await pushChanges({ token: 't', owner: 'o', repo: 'r', branch: 'main' } as never, [{ path: 'a.docx', content: '', b64: 'AQID' }, { path: 'n.md', content: '# 안녕' }], 'm')
    const blobs = calls.filter((c) => c.url.endsWith('/git/blobs')).map((c) => JSON.parse(c.body))
    expect(blobs).toEqual([{ content: 'AQID', encoding: 'base64' }, { content: '# 안녕', encoding: 'utf-8' }])
    expect([...revs.keys()]).toEqual(['a.docx', 'n.md'])
    vi.unstubAllGlobals()
  })
})

import { renamedPath } from './attachments'
describe('이름 바꾸기 경로', () => {
  it('같은 폴더에서 이름만 바꾼다. 금지 문자는 공백으로, 빈 이름·숨김은 거절', () => {
    expect(renamedPath('proj/a.zip', 'b.zip')).toBe('proj/b.zip')
    expect(renamedPath('a.zip', '  새 이름.zip ')).toBe('새 이름.zip')
    expect(renamedPath('proj/a.zip', 'x/y:z.zip')).toBe('proj/x y z.zip')
    expect(renamedPath('a.zip', '   ')).toBeNull()
    expect(renamedPath('a.zip', '.hidden')).toBeNull()
  })
})
