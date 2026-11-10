import { describe, expect, it } from 'vitest'
import { formatSize, gate, isExecutable, LARGE_BYTES, MAX_PHONE_BYTES, othersIn } from './attachments'
import { capOthers, isOther, MAX_OTHERS } from './sync'

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
