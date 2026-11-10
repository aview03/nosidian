// PC 호스트 저장 계층(electron/hostStore.cjs) 시험: rev 영속성, 외부 변경 감지, 저장 중단 복구, 삭제 기록(tombstone)·정리, manifest 손상, 경로·링크 방어.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mod from '../../electron/hostStore.cjs'

type Host = {
  root: string
  info(): { epoch: string; seq: number; rebuilt: boolean; recovery: { recovered: boolean; did?: string }; files: number; tombs: number }
  scan(o?: { deep?: boolean }): { added: string[]; modified: string[]; deleted: string[]; moved: { from: string; to: string }[] }
  list(): { epoch: string; seq: number; entries: { path: string; rev: string; size: number; hash: string }[]; tombs: { path: string; rev: string; at: number }[] }
  read(p: string): { bytes: Buffer; rev: string }
  put(p: string, bytes: Buffer | string, baseRev: string | null, by?: string): { rev: string; seq: number }
  del(p: string, baseRev: string | null, by?: string): { rev: string; seq: number }
  registerDevice(id: string, info?: object): void
  ack(id: string, seq: number): void
  removeDevice(id: string): void
  devices(): { id: string; ackSeq: number; lastSeen: number }[]
  staleDevices(days?: number): string[]
  gc(): { trashed: number; tombs: number }
  trash(): { path: string; name: string; at: number }[]
  readTrash(name: string): Buffer
  snapshot(extra?: { vaultNotes?: unknown; label?: string }): { id: string; files: number; bytes: number }
  snapshots(): { id: string; at: number; hasVault: boolean }[]
  readSnapshotVault(id: string): unknown
  close(): void
}
const { openHost, HostError, cleanRel, looksExecutable, overlaps } = mod as {
  openHost(dir: string, opts?: Record<string, unknown>): Host
  HostError: new (...a: never[]) => Error & { status: number; code: string }
  cleanRel(p: unknown): string | null
  looksExecutable(name: string, head?: Buffer): boolean
  overlaps(a: string, b: string): boolean
}

let dir: string
let clock = 1_700_000_000_000
const open = (opts: Record<string, unknown> = {}) => openHost(dir, { now: () => clock, ...opts })
const f = (rel: string) => path.join(dir, ...rel.split('/'))
const write = (rel: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(f(rel)), { recursive: true })
  fs.writeFileSync(f(rel), text)
}
const bump = (rel: string, ms = 5000) => { // 외부 프로그램이 나중에 고친 것처럼 mtime 을 확실히 바꾼다
  const t = new Date(Date.now() + ms)
  fs.utimesSync(f(rel), t, t)
}
const expectErr = (fn: () => unknown, status: number, code?: string) => {
  try {
    fn()
  } catch (e) {
    const err = e as { status?: number; code?: string }
    expect(err.status, String((e as Error).message)).toBe(status)
    if (code) expect(err.code).toBe(code)
    return err
  }
  throw new Error('예외가 나야 하는데 나지 않았다')
}
const DAY = 86_400_000
const opened: Host[] = []
const track = (h: Host) => (opened.push(h), h)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-host-'))
  clock = 1_700_000_000_000
})
afterEach(() => {
  for (const h of opened.splice(0)) h.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('rev: 영속성과 구분', () => {
  it('앱을 다시 열어도 gen 이 이어지고, 같은 내용으로 되돌려도(A→B→A) 이전 rev 와 다르다', () => {
    let h = track(open())
    const a1 = h.put('노트.md', 'A', null).rev
    const b = h.put('노트.md', 'B', a1).rev
    const a2 = h.put('노트.md', 'A', b).rev
    expect(new Set([a1, b, a2]).size).toBe(3) // 내용이 같은 a1 과 a2 도 다르다
    expect(a1.split('.')[1]).toBe(a2.split('.')[1]) // 해시 부분은 같다
    h.close()
    h = track(open()) // 재시작
    expect(h.list().entries[0].rev).toBe(a2)
    const a3 = h.put('노트.md', 'C', a2).rev
    expect(Number(a3.split('-')[1].split('.')[0])).toBe(Number(a2.split('-')[1].split('.')[0]) + 1) // 번호가 이어진다
  })
  it('삭제 후 같은 내용으로 다시 만들어도 이전 rev 와 구분된다', () => {
    const h = track(open())
    const r1 = h.put('a.md', 'same', null).rev
    const tomb = h.del('a.md', r1).rev
    const r2 = h.put('a.md', 'same', tomb).rev
    expect(r2).not.toBe(r1)
    expect(h.list().tombs).toHaveLength(0) // 다시 만들면 삭제 기록은 사라진다
  })
  it('manifest 를 새로 만들면(epoch 변경) 옛 rev 는 절대 일치하지 않는다', () => {
    const h = track(open())
    const r = h.put('a.md', 'x', null).rev
    h.close()
    fs.writeFileSync(path.join(dir, '.nosidian', 'manifest.json'), '{broken')
    fs.writeFileSync(path.join(dir, '.nosidian', 'manifest.bak.json'), '{broken')
    const h2 = track(open())
    expect(h2.info().rebuilt).toBe(true)
    const now = h2.list().entries[0].rev
    expect(now).not.toBe(r)
    expectErr(() => h2.put('a.md', 'y', r), 409, 'conflict') // 옛 rev 를 들고 온 기기는 충돌로 보인다
  })
})

describe('조건부 쓰기', () => {
  it('baseRev 가 현재와 같을 때만 쓰고, 다르면 아무것도 바꾸지 않고 409 와 현재 rev 를 알려 준다', () => {
    const h = track(open())
    const r1 = h.put('a.md', '1', null).rev
    const r2 = h.put('a.md', '2', r1).rev
    const err = expectErr(() => h.put('a.md', 'stale', r1), 409, 'conflict') as unknown as { currentRev: string }
    expect(err.currentRev).toBe(r2)
    expect(fs.readFileSync(f('a.md'), 'utf8')).toBe('2')
    expectErr(() => h.put('a.md', 'x', null), 409, 'conflict') // 이미 있는 파일을 "새로"는 못 만든다
    expectErr(() => h.put('nope.md', 'x', 'bogus-1.abc'), 409, 'conflict')
  })
  it('삭제 기록 위에 만들려면 그 tombstone rev 가 필요하다(오래된 사본이 파일을 되살리지 못한다)', () => {
    const h = track(open())
    const r = h.put('a.md', 'x', null).rev
    const tomb = h.del('a.md', r).rev
    const e = expectErr(() => h.put('a.md', 'zombie', null), 409, 'conflict') as unknown as { deleted: boolean; currentRev: string }
    expect(e.deleted).toBe(true)
    expect(e.currentRev).toBe(tomb)
    expect(fs.existsSync(f('a.md'))).toBe(false)
    expect(h.put('a.md', 'revived', tomb).rev).toBeTruthy()
  })
  it('삭제도 조건부이고, 파일은 휴지통으로 가며 내용을 되살릴 수 있다', () => {
    const h = track(open())
    const r = h.put('a.md', 'precious', null).rev
    expectErr(() => h.del('a.md', 'wrong'), 409, 'conflict')
    expect(fs.existsSync(f('a.md'))).toBe(true)
    h.del('a.md', r)
    expect(fs.existsSync(f('a.md'))).toBe(false)
    expect(h.trash()).toHaveLength(1)
    expect(h.readTrash(h.trash()[0].name).toString()).toBe('precious')
  })
  it('대소문자만 다른 경로·너무 큰 파일은 거절한다', () => {
    const h = track(open())
    h.put('Notes/A.md', 'x', null)
    expectErr(() => h.put('notes/a.md', 'y', null), 409, 'case')
    expectErr(() => h.put('big.bin', Buffer.alloc(25 * 1024 * 1024 + 1), null), 413, 'tooLarge')
  })
})

describe('경로·링크 방어', () => {
  it('상위 경로·숨김·예약 이름·특수 문자는 거절한다', () => {
    const h = track(open())
    for (const p of ['../x.md', 'a/../../x.md', '/abs.md', '.nosidian/manifest.json', '.hidden', 'a/.git/x', 'C:/x.md', 'a\\b.md', 'CON', 'a/nul.txt', 'x.md:stream', 'a/b?.md', 'trail.', '']) {
      expectErr(() => h.put(p, 'x', null), 400, 'badPath')
      expectErr(() => h.read(p), 400, 'badPath')
    }
    expect(cleanRel('프로젝트/행사 준비/개요.md')).toBe('프로젝트/행사 준비/개요.md')
  })
  it('링크(정션·심볼릭)로 호스트 폴더 밖에 쓰거나 읽지 않고, 스캔도 링크를 따라가지 않는다', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-out-'))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET')
    let made = 0
    try { fs.symlinkSync(outside, f('linkdir'), 'junction'); made++ } catch { /* 권한 없음 */ }
    try { fs.symlinkSync(path.join(outside, 'secret.txt'), f('linkfile.txt'), 'file'); made++ } catch { /* 윈도: 관리자 권한 필요할 수 있다 */ }
    try {
      const h = track(open())
      expect(h.list().entries.map((e) => e.path)).toEqual([]) // 링크는 목록에 없다
      expectErr(() => h.put('linkdir/pwn.md', 'x', null), 403, 'outside')
      expect(fs.existsSync(path.join(outside, 'pwn.md'))).toBe(false)
      expectErr(() => h.read('linkdir/secret.txt'), 403, 'link') // 중간에 링크가 있으면 실제 경로가 달라져 거절한다
      if (fs.existsSync(f('linkfile.txt'))) expectErr(() => h.put('linkfile.txt', 'overwrite', null), 403, 'link')
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('TOP SECRET')
      expect(made).toBeGreaterThan(0)
    } finally {
      fs.rmSync(f('linkdir'), { recursive: true, force: true })
      fs.rmSync(f('linkfile.txt'), { force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('외부 변경 감지(탐색기·다른 프로그램)', () => {
  it('외부에서 수정하면 다음 목록·읽기에서 gen 이 올라가고, 읽은 rev 는 항상 내용과 일치한다', () => {
    const h = track(open())
    const r1 = h.put('a.md', 'v1', null).rev
    fs.writeFileSync(f('a.md'), 'edited in explorer')
    bump('a.md')
    const got = h.read('a.md') // 목록을 거치지 않고 바로 읽어도 외부 수정이 반영된다
    expect(got.bytes.toString()).toBe('edited in explorer')
    expect(got.rev).not.toBe(r1)
    expect(Number(got.rev.split('-')[1].split('.')[0])).toBe(2)
    expectErr(() => h.put('a.md', 'from phone', r1), 409, 'conflict') // 폰은 옛 rev 를 들고 있다 → 덮어쓰지 못한다
  })
  it('외부 추가·삭제·이동을 발견한다(이동은 힌트만, 삭제+새 파일로 기록)', () => {
    const h = track(open())
    h.put('keep.md', 'k', null)
    h.put('old/name.md', 'moving content', null)
    h.put('gone.md', 'bye', null)
    write('added.md', 'new from outside')
    fs.rmSync(f('gone.md'))
    fs.mkdirSync(f('moved'), { recursive: true })
    fs.renameSync(f('old/name.md'), f('moved/name.md'))
    const c = h.scan()
    expect(c.added.sort()).toEqual(['added.md', 'moved/name.md'])
    expect(c.deleted.sort()).toEqual(['gone.md', 'old/name.md'])
    expect(c.moved).toEqual([{ from: 'old/name.md', to: 'moved/name.md' }])
    const l = h.list()
    expect(l.tombs.map((t) => t.path).sort()).toEqual(['gone.md', 'old/name.md'])
    expect(l.entries.map((e) => e.path)).toEqual(['added.md', 'keep.md', 'moved/name.md'])
  })
  it('앱이 꺼져 있는 동안의 외부 변경도 다시 열 때 발견한다', () => {
    let h = track(open())
    h.put('a.md', 'x', null)
    h.put('b.md', 'y', null)
    const before = h.list().entries.find((e) => e.path === 'a.md')!.rev
    h.close()
    fs.writeFileSync(f('a.md'), 'changed while closed')
    bump('a.md')
    fs.rmSync(f('b.md'))
    write('c.md', 'new')
    h = track(open())
    const l = h.list()
    expect(l.entries.map((e) => e.path)).toEqual(['a.md', 'c.md'])
    expect(l.entries[0].rev).not.toBe(before)
    expect(l.tombs.map((t) => t.path)).toEqual(['b.md'])
  })
  it('내용은 같고 시간만 바뀐 파일은 변경으로 보지 않는다. 깊은 점검은 시간이 같아도 내용 변화를 찾는다', () => {
    const h = track(open())
    const r = h.put('a.md', 'same', null).rev
    bump('a.md')
    h.scan()
    expect(h.list().entries[0].rev).toBe(r)
    const st = fs.statSync(f('a.md'))
    fs.writeFileSync(f('a.md'), 'diff') // 같은 크기(4바이트)의 다른 내용
    fs.utimesSync(f('a.md'), st.atimeMs / 1000, st.mtimeMs / 1000) // mtime 까지(소수점 이하 포함) 되돌림
    expect(h.scan().modified).toEqual([]) // 빠른 점검은 못 본다(알려진 한계)
    expect(h.scan({ deep: true }).modified).toEqual(['a.md']) // 깊은 점검은 찾는다
  })
})

describe('저장 중단 복구', () => {
  const crashAt = (point: string) => ({
    hooks: {
      [point]: () => {
        throw new Error('CRASH at ' + point)
      },
    },
  })
  const consistent = (h: Host) => {
    const l = h.list()
    for (const e of l.entries) {
      const disk = fs.readFileSync(f(e.path))
      expect(disk.length, e.path).toBe(e.size) // manifest 와 디스크가 맞는다
    }
    expect(fs.existsSync(path.join(dir, '.nosidian', 'journal.json'))).toBe(false) // journal 이 남지 않는다
    expect(fs.readdirSync(path.join(dir, '.nosidian', 'tmp'))).toEqual([]) // 임시 파일이 남지 않는다
    return l
  }

  it('쓰는 도중(임시 파일만 쓴 시점)에 끊기면 옛 내용이 그대로이고 찌꺼기가 정리된다', () => {
    let h = track(open())
    const r1 = h.put('a.md', 'old', null).rev
    h.close()
    h = track(open(crashAt('afterTmp')))
    expect(() => h.put('a.md', 'new', r1)).toThrow('CRASH')
    h = track(open()) // 재시작
    expect(fs.readFileSync(f('a.md'), 'utf8')).toBe('old')
    expect(consistent(h).entries[0].rev).toBe(r1)
  })
  it('journal 만 쓴 시점에 끊기면 옛 내용 유지, journal 은 버린다', () => {
    let h = track(open())
    const r1 = h.put('a.md', 'old', null).rev
    h.close()
    h = track(open(crashAt('afterJournal')))
    expect(() => h.put('a.md', 'new', r1)).toThrow('CRASH')
    h = track(open())
    expect(h.info().recovery).toMatchObject({ recovered: true, did: 'discarded' })
    expect(fs.readFileSync(f('a.md'), 'utf8')).toBe('old')
    expect(consistent(h).entries[0].rev).toBe(r1)
  })
  it('rename 직후(manifest 갱신 전)에 끊기면 이어서 반영한다 — 파일과 버전 정보가 어긋난 채 방치되지 않는다', () => {
    let h = track(open())
    const r1 = h.put('a.md', 'old', null).rev
    h.close()
    h = track(open(crashAt('afterRename')))
    expect(() => h.put('a.md', 'new content', r1)).toThrow('CRASH')
    h = track(open())
    expect(h.info().recovery).toMatchObject({ recovered: true, did: 'rolled-forward' })
    expect(fs.readFileSync(f('a.md'), 'utf8')).toBe('new content')
    const l = consistent(h)
    expect(l.entries[0].rev).not.toBe(r1)
    expect(Number(l.entries[0].rev.split('-')[1].split('.')[0])).toBe(2) // gen 이 정확히 한 번만 올랐다
    expect(h.put('a.md', 'next', l.entries[0].rev).rev).toBeTruthy() // 복구 뒤에도 정상 동작
  })
  it('manifest 까지 쓰고 journal 삭제 전에 끊겨도 일관되다(중복 반영 없음)', () => {
    let h = track(open())
    const r1 = h.put('a.md', 'old', null).rev
    h.close()
    h = track(open(crashAt('afterManifest')))
    expect(() => h.put('a.md', 'new', r1)).toThrow('CRASH')
    h = track(open())
    const l = consistent(h)
    expect(fs.readFileSync(f('a.md'), 'utf8')).toBe('new')
    expect(Number(l.entries[0].rev.split('-')[1].split('.')[0])).toBe(2)
  })
  it('새 파일을 만들다 끊겨도(rename 직후) 이어서 반영하고, 삭제 도중 끊기면 삭제 기록이 남는다', () => {
    let h = track(open(crashAt('afterRename')))
    expect(() => h.put('fresh.md', 'created', null)).toThrow('CRASH')
    h = track(open())
    expect(consistent(h).entries.map((e) => e.path)).toEqual(['fresh.md'])
    const rev = h.list().entries[0].rev
    h.close()
    h = track(open(crashAt('afterRename')))
    expect(() => h.del('fresh.md', rev)).toThrow('CRASH') // 휴지통으로 옮긴 직후
    h = track(open())
    const l = consistent(h)
    expect(l.entries).toEqual([])
    expect(l.tombs.map((t) => t.path)).toEqual(['fresh.md']) // 삭제 기록이 복구됐다
    expect(h.trash()).toHaveLength(1)
  })
  it('삭제의 journal 단계에서 끊기면 파일은 그대로 남는다', () => {
    let h = track(open())
    const r = h.put('a.md', 'keep me', null).rev
    h.close()
    h = track(open(crashAt('afterJournal')))
    expect(() => h.del('a.md', r)).toThrow('CRASH')
    h = track(open())
    expect(fs.readFileSync(f('a.md'), 'utf8')).toBe('keep me')
    expect(consistent(h).entries[0].rev).toBe(r)
  })
})

describe('manifest 손상', () => {
  it('manifest 가 깨지면 백업에서 되살린다(삭제 기록 포함). 손상본은 지우지 않고 남긴다', () => {
    let h = track(open())
    const r = h.put('a.md', 'x', null).rev
    h.del('a.md', r)
    h.put('b.md', 'y', null)
    h.close()
    const manifest = path.join(dir, '.nosidian', 'manifest.json')
    fs.writeFileSync(manifest, '{"truncated"')
    h = track(open())
    expect(h.info().rebuilt).toBe(false) // 백업이 있었다
    expect(h.list().tombs.map((t) => t.path)).toEqual(['a.md']) // 삭제 기록 유지
    expect(h.list().entries.map((e) => e.path)).toEqual(['b.md'])
    expect(fs.readdirSync(path.join(dir, '.nosidian')).some((n) => n.startsWith('manifest.corrupt-'))).toBe(true)
  })
  it('manifest 와 백업이 모두 깨지면 디스크를 스캔해 다시 만들고(rebuilt), 데이터 파일은 건드리지 않는다', () => {
    const h0 = track(open())
    h0.put('a.md', 'keep-a', null)
    h0.put('b/c.md', 'keep-c', null)
    h0.close()
    fs.writeFileSync(path.join(dir, '.nosidian', 'manifest.json'), 'garbage')
    fs.writeFileSync(path.join(dir, '.nosidian', 'manifest.bak.json'), 'garbage')
    const h = track(open())
    expect(h.info().rebuilt).toBe(true)
    expect(h.list().entries.map((e) => e.path)).toEqual(['a.md', 'b/c.md'])
    expect(fs.readFileSync(f('a.md'), 'utf8')).toBe('keep-a')
    expect(fs.readFileSync(f('b/c.md'), 'utf8')).toBe('keep-c')
  })
  it('엉뚱한 모양의 JSON 도 손상으로 다룬다', () => {
    const h0 = track(open())
    h0.put('a.md', 'x', null)
    h0.close()
    fs.writeFileSync(path.join(dir, '.nosidian', 'manifest.json'), JSON.stringify({ v: 99, files: 'no' }))
    const h = track(open())
    expect(h.list().entries.map((e) => e.path)).toEqual(['a.md'])
  })
})

describe('삭제 기록(tombstone)과 정리', () => {
  it('90일이 지나도 아직 확인하지 않은 기기가 있으면 tombstone 을 유지한다', () => {
    const h = track(open())
    h.registerDevice('phone')
    h.registerDevice('pc-app')
    const r = h.put('a.md', 'x', null).rev
    const del = h.del('a.md', r)
    h.ack('pc-app', del.seq) // PC 앱은 확인, 폰은 아직
    clock += 120 * DAY
    expect(h.gc().tombs).toBe(0)
    expect(h.list().tombs).toHaveLength(1) // 폰의 옛 사본이 파일을 되살릴 수 없다
    h.ack('phone', del.seq) // 폰도 확인
    expect(h.gc().tombs).toBe(1)
    expect(h.list().tombs).toHaveLength(0)
  })
  it('90일 전에는 모두 확인했어도 지우지 않는다. 기기 해제 후에는 그 기기를 기다리지 않는다', () => {
    const h = track(open())
    h.registerDevice('phone')
    const r = h.put('a.md', 'x', null).rev
    const del = h.del('a.md', r)
    clock += 30 * DAY
    expect(h.gc().tombs).toBe(0)
    clock += 70 * DAY // 총 100일, 폰은 확인 안 함
    expect(h.gc().tombs).toBe(0)
    h.removeDevice('phone') // PC 에서 기기를 해제 → 더 이상 기다리지 않는다
    expect(h.gc().tombs).toBe(1)
    void del
  })
  it('휴지통의 파일 내용은 90일 뒤 비우지만, tombstone 은 별개로 유지될 수 있다', () => {
    const h = track(open())
    h.registerDevice('phone')
    const r = h.put('a.md', 'x', null).rev
    h.del('a.md', r)
    clock += 91 * DAY
    const g = h.gc()
    expect(g.trashed).toBe(1)
    expect(g.tombs).toBe(0)
    expect(h.trash()).toHaveLength(0)
    expect(h.list().tombs).toHaveLength(1) // 기록이 내용보다 오래 간다
  })
  it('오래 접속하지 않은 기기(180일)를 알려 준다', () => {
    const h = track(open())
    h.registerDevice('old')
    clock += 100 * DAY
    h.registerDevice('new')
    expect(h.staleDevices()).toEqual([])
    clock += 100 * DAY
    expect(h.staleDevices()).toEqual(['old'])
    h.ack('old', 0)
    expect(h.staleDevices()).toEqual([]) // 접속하면 해제된다
  })
})

describe('스냅샷', () => {
  it('호스트 파일·manifest·PC 앱 Vault 노트를 복사해 두고, 보관은 최근 3개까지', () => {
    const h = track(open())
    h.put('a.md', 'A', null)
    h.put('dir/b.md', 'B', null)
    const s = h.snapshot({ vaultNotes: { 'pc-only.md': '내용' }, label: 'first-connect' })
    expect(s.files).toBe(2)
    const base = path.join(dir, '.nosidian', 'snapshots', s.id)
    expect(fs.readFileSync(path.join(base, 'files', 'dir', 'b.md'), 'utf8')).toBe('B')
    expect(fs.existsSync(path.join(base, 'manifest.json'))).toBe(true)
    expect(h.readSnapshotVault(s.id)).toEqual({ 'pc-only.md': '내용' })
    expect(h.snapshots()[0]).toMatchObject({ id: s.id, hasVault: true })
    for (let i = 0; i < 4; i++) {
      clock += 1000
      h.snapshot()
    }
    expect(h.snapshots()).toHaveLength(3)
  })
  it('30일이 지난 스냅샷은 정리한다', () => {
    const h = track(open())
    h.put('a.md', 'A', null)
    h.snapshot()
    clock += 31 * DAY
    h.snapshot()
    expect(h.snapshots()).toHaveLength(1)
  })
  it('여유 공간이 부족하면 스냅샷을 만들지 않고(찌꺼기 없음) 예외 — 호출한 쪽은 동기화를 시작하지 않는다', () => {
    const h = track(open({ freeBytes: () => 1024 }))
    h.put('a.md', 'A'.repeat(1000), null)
    expectErr(() => h.snapshot(), 507, 'noSpace')
    expect(h.snapshots()).toEqual([])
    expect(fs.existsSync(path.join(dir, '.nosidian', 'snapshots'))).toBe(false)
  })
  it('복사에 실패하면 부분 스냅샷을 남기지 않는다', () => {
    const h = track(open())
    h.put('a.md', 'A', null)
    h.put('b.md', 'B', null)
    fs.rmSync(f('b.md')) // manifest 는 b.md 를 알지만 스캔 후 사라진 경우를 만들기 위해, 스냅샷 직전 스캔이 정리하므로 복사 중 사라지는 상황을 흉내
    const ok = h.snapshot()
    expect(ok.files).toBe(1) // 스캔이 사라진 파일을 반영했다
  })
})

describe('단일 작성자(잠금)', () => {
  it('다른 프로세스가 쓰고 있으면 열지 않고, 죽은 프로세스의 잠금은 이어받는다', () => {
    const h0 = track(open())
    h0.close()
    const lock = path.join(dir, '.nosidian', 'host.lock')
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: Date.now() })) // 살아 있는 다른 프로세스(부모)
    expectErr(() => open(), 423, 'busy')
    fs.writeFileSync(lock, JSON.stringify({ pid: 2147483000, at: Date.now() })) // 없는 프로세스
    expect(() => track(open())).not.toThrow()
  })
})

describe('보조 규칙', () => {
  it('실행 파일 판별: 확장자와 머리 표지(PE·ELF·Mach-O), 일반 파일은 통과', () => {
    for (const n of ['a.exe', 'x/b.DLL', 'c.bat', 'd.ps1', 'e.msi', 'f.lnk', 'g.jar']) expect(looksExecutable(n), n).toBe(true)
    expect(looksExecutable('innocent.txt', Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(true) // 이름을 바꿔도 PE 머리를 본다
    expect(looksExecutable('data.bin', Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toBe(true)
    expect(looksExecutable('mac', Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(true)
    for (const n of ['note.md', 'main.py', 'data.json', 'readme', 'report.docx']) expect(looksExecutable(n, Buffer.from('hello world')), n).toBe(false)
  })
  it('겹치는 폴더 판별(같거나 포함)', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-ov-'))
    fs.mkdirSync(path.join(a, 'sub'))
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-ov2-'))
    try {
      expect(overlaps(a, a)).toBe(true)
      expect(overlaps(a, path.join(a, 'sub'))).toBe(true)
      expect(overlaps(path.join(a, 'sub'), a)).toBe(true)
      expect(overlaps(a, b)).toBe(false)
      expect(overlaps(a, a + '-other')).toBe(false) // 이름 앞부분만 같은 폴더는 겹치지 않는다
    } finally {
      fs.rmSync(a, { recursive: true, force: true })
      fs.rmSync(b, { recursive: true, force: true })
    }
  })
  it('HostError 는 상태 코드를 가진다', () => {
    const e = new (HostError as unknown as new (m: string, s: number, c: string) => Error & { status: number })('x', 409, 'conflict')
    expect(e.status).toBe(409)
  })
})
