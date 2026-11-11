// 호스트 동기화 서버(electron/hostServer.cjs) 시험: 실제 HTTPS 서버 + 실제 호스트 저장 계층(임시 폴더).
// 기기별 쓰기 권한, 조건부 쓰기, 실행 파일 거부, 경로·링크 방어, 크기·속도·공간 제한, 삭제 권한(기본 꺼짐), 해제 즉시 반영.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import hostServerMod from '../../electron/hostServer.cjs'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import hostStoreMod from '../../electron/hostStore.cjs'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import shareMod from '../../electron/fileShare.cjs'

const { createHostServer } = hostServerMod as { createHostServer(d: unknown): any }
const { openHost } = hostStoreMod as { openHost(dir: string, o?: unknown): any }
const { makeTls } = shareMod as { makeTls(): Promise<{ key: string; cert: string; fp: string }> }

let tls: { key: string; cert: string; fp: string }
let dir: string
let outside: string
let host: any = null
let server: { close(): Promise<void> } | null = null
let clock = 1_700_000_000_000

beforeAll(async () => {
  tls = await makeTls()
})
afterEach(async () => {
  await server?.close()
  server = null
  host?.close()
  host = null
  for (const d of [dir, outside]) if (d) fs.rmSync(d, { recursive: true, force: true })
})

type Res = { status: number; json: any; fp: string }
function req(port: number, p: string, body: unknown, token?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body ?? {})
    const r = https.request({ host: '127.0.0.1', port, path: p, method: 'POST', rejectUnauthorized: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), Connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      const fp = (res.socket as import('tls').TLSSocket).getPeerCertificate()?.fingerprint256?.replace(/:/g, '').toLowerCase() ?? ''
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        let json: unknown = null
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* */ }
        resolve({ status: res.statusCode ?? 0, json, fp })
      })
    })
    r.on('error', reject)
    r.end(data)
  })
}
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64')
const hf = (rel: string) => path.join(dir, ...rel.split('/'))

async function boot(over: Record<string, unknown> = {}, opts: { noHost?: boolean } = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-hsrv-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-hsrv-out-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET')
  host = opts.noHost ? null : openHost(dir, { now: () => clock })
  let saved: unknown = (over.saved as unknown) ?? null
  const s = createHostServer({ store: { read: () => saved, write: (v: unknown) => { saved = JSON.parse(JSON.stringify(v)) } }, tls, hostName: 'TEST-PC', now: () => clock, getHost: () => { if (!host) throw Object.assign(new Error('no folder'), { status: 412 }); return host }, ...over })
  const port = await s.listen(0, '127.0.0.1')
  server = s
  return { s, port, saved: () => saved }
}
async function pairDevice(b: { s: any; port: number }, name = '내 폰') {
  const r = await req(b.port, '/pair', { code: b.s.codeNow().value, name })
  return { token: r.json.token as string, id: r.json.deviceId as string, res: r }
}
/** 쓰기 권한까지 켠 기기 */
async function writer(b: { s: any; port: number }) {
  const d = await pairDevice(b)
  b.s.setPerms(d.id, { write: true })
  return d
}
const put = (port: number, token: string, p: string, content: string | Buffer, baseRev: string | null) => req(port, '/put', { path: p, baseRev, b64: b64(content) }, token)

describe('짝 맺기: 기본은 읽기 전용', () => {
  it('HTTPS 로 짝을 맺으면 토큰·기기 ID·폴더 이름을 받고, 쓰기·삭제 권한은 꺼져 있으며, 인증서 지문이 같다', async () => {
    const b = await boot()
    const d = await pairDevice(b)
    expect(d.res.status).toBe(200)
    expect(d.token).toMatch(/^[0-9a-f]{48}$/)
    expect(d.res.json).toMatchObject({ name: 'TEST-PC', fp: tls.fp, perms: { write: false, delete: false } })
    expect(d.res.fp).toBe(tls.fp)
    expect(JSON.stringify(b.saved())).not.toContain(d.token) // 토큰은 해시로만 보관
    expect(host.devices().map((x: { id: string }) => x.id)).toContain(d.id) // 호스트 manifest 에 기기가 등록돼 ack 를 기다릴 수 있다
  })
  it('호스트 폴더가 지정돼 있지 않으면 짝을 맺을 수 없다', async () => {
    const b = await boot({}, { noHost: true })
    const r = await req(b.port, '/pair', { code: b.s.codeNow().value, name: 'x' })
    expect(r.status).toBe(412)
  })
  it('평문 http 로는 연결되지 않는다(TLS 전용)', async () => {
    const b = await boot()
    await expect(new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: b.port, path: '/ping', method: 'POST', headers: { Connection: 'close' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
      r.on('error', reject)
      r.setTimeout(1500, () => r.destroy(new Error('timeout')))
      r.end('{}')
    })).rejects.toThrow()
  })
  it('코드는 한 번만, 5번 틀리면 잠그고, 기기는 5대까지', async () => {
    const b = await boot()
    const d = await pairDevice(b)
    expect(d.token).toBeTruthy()
    expect((await req(b.port, '/pair', { code: b.s.codeNow().value === '' ? '' : '000000', name: 'x' })).status).toBe(403)
    for (let i = 0; i < 4; i++) await req(b.port, '/pair', { code: '000000', name: 'x' })
    expect((await req(b.port, '/pair', { code: b.s.codeNow().value, name: 'x' })).status).toBe(429)
  })
  it('기기 5대를 넘기면 409', async () => {
    const b = await boot()
    for (let i = 0; i < 5; i++) expect((await req(b.port, '/pair', { code: b.s.codeNow().value, name: 'p' + i })).status).toBe(200)
    expect((await req(b.port, '/pair', { code: b.s.codeNow().value, name: 'p6' })).status).toBe(409)
  })
})

describe('인증과 해제', () => {
  it('토큰이 없거나 틀리면 401, 해제하면 즉시 401(호스트의 기기 목록에서도 빠진다)', async () => {
    const b = await boot()
    const d = await pairDevice(b)
    expect((await req(b.port, '/list', {})).status).toBe(401)
    expect((await req(b.port, '/list', {}, 'a'.repeat(48))).status).toBe(401)
    expect((await req(b.port, '/list', {}, d.token)).status).toBe(200)
    b.s.revoke(d.id)
    expect((await req(b.port, '/list', {}, d.token)).status).toBe(401)
    expect(host.devices().map((x: { id: string }) => x.id)).not.toContain(d.id)
  })
})

describe('읽기(모든 짝 맺은 기기)', () => {
  it('목록(rev·삭제 기록 포함)과 파일 내용·SHA-256 을 읽는다. 우회 경로는 거절', async () => {
    const b = await boot()
    host.put('노트.md', '# 안녕\n', null)
    const d = await pairDevice(b)
    const l = await req(b.port, '/list', {}, d.token)
    expect(l.json.entries.map((e: { path: string }) => e.path)).toEqual(['노트.md'])
    expect(l.json.epoch).toBeTruthy()
    const g = await req(b.port, '/get', { path: '노트.md' }, d.token)
    expect(Buffer.from(g.json.b64, 'base64').toString()).toBe('# 안녕\n')
    expect(g.json.rev).toBe(l.json.entries[0].rev)
    for (const p of ['../x', '.nosidian/manifest.json', '/etc/passwd', 'a\\b']) expect((await req(b.port, '/get', { path: p }, d.token)).status, p).toBe(400)
    expect((await req(b.port, '/get', { path: 'nope.md' }, d.token)).status).toBe(404)
  })
})

describe('쓰기 권한: 기기별, PC 에서만, 즉시 적용', () => {
  it('기본 기기는 쓸 수 없다 — 403 이고 파일도 manifest 도 바뀌지 않는다', async () => {
    const b = await boot()
    const d = await pairDevice(b)
    const seq = host.info().seq
    const r = await put(b.port, d.token, 'phone.md', 'x', null)
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('noWrite')
    expect(fs.existsSync(hf('phone.md'))).toBe(false)
    expect(host.info().seq).toBe(seq)
  })
  it('PC 에서 쓰기를 허용하면 쓸 수 있고, 누가 썼는지 기록되며, 끄면 다음 요청부터 바로 막힌다', async () => {
    const b = await boot()
    const d = await writer(b)
    const r1 = await put(b.port, d.token, '프로젝트/폰에서.md', '# 폰에서 만듦\n', null)
    expect(r1.status).toBe(200)
    expect(fs.readFileSync(hf('프로젝트/폰에서.md'), 'utf8')).toBe('# 폰에서 만듦\n')
    expect(host.list().entries[0].rev).toBe(r1.json.rev)
    const m = JSON.parse(fs.readFileSync(path.join(dir, '.nosidian', 'manifest.json'), 'utf8'))
    expect(m.files['프로젝트/폰에서.md'].by).toBe(`device:${d.id.slice(0, 8)}`)
    expect(b.s.state().devices[0]).toMatchObject({ writes: 1 })
    b.s.setPerms(d.id, { write: false }) // PC 에서 회수
    const r2 = await put(b.port, d.token, '프로젝트/폰에서.md', 'after revoke', r1.json.rev)
    expect(r2.status).toBe(403)
    expect(fs.readFileSync(hf('프로젝트/폰에서.md'), 'utf8')).toBe('# 폰에서 만듦\n')
    expect((await req(b.port, '/list', {}, d.token)).status).toBe(200) // 읽기는 계속 된다
  })
  it('기기마다 권한이 따로다', async () => {
    const b = await boot()
    const a = await writer(b)
    const c = await pairDevice(b, '다른 폰')
    expect((await put(b.port, a.token, 'a.md', 'a', null)).status).toBe(200)
    expect((await put(b.port, c.token, 'c.md', 'c', null)).status).toBe(403)
  })
  it('기기가 자신의 권한을 올릴 방법이 없다(그런 요청은 404, 권한은 그대로)', async () => {
    const b = await boot()
    const d = await pairDevice(b)
    for (const p of ['/perms', '/setPerms', '/device', '/admin', '/pair-perms']) expect((await req(b.port, p, { write: true, id: d.id, perms: { write: true } }, d.token)).status, p).toBe(404)
    expect(b.s.state().devices[0].perms).toEqual({ write: false, delete: false })
    expect((await put(b.port, d.token, 'x.md', 'x', null)).status).toBe(403)
  })
  it('권한 설정은 저장돼 재시작 후에도 이어진다', async () => {
    const b = await boot()
    const d = await writer(b)
    const saved = JSON.parse(JSON.stringify(b.saved()))
    expect(saved.devices[0].perms).toEqual({ write: true, delete: false })
    const again = createHostServer({ store: { read: () => saved, write: () => {} }, tls, getHost: () => host })
    expect(again.state().devices[0].perms.write).toBe(true)
    void d
  })
})

describe('조건부 쓰기(내가 본 rev 가 그대로일 때만)', () => {
  it('rev 가 맞으면 갱신, 다르면 아무것도 바꾸지 않고 409 와 현재 rev', async () => {
    const b = await boot()
    const d = await writer(b)
    const r1 = await put(b.port, d.token, 'a.md', 'v1', null)
    const r2 = await put(b.port, d.token, 'a.md', 'v2', r1.json.rev)
    expect(r2.status).toBe(200)
    const stale = await put(b.port, d.token, 'a.md', 'stale', r1.json.rev)
    expect(stale.status).toBe(409)
    expect(stale.json).toMatchObject({ code: 'conflict', currentRev: r2.json.rev })
    expect(fs.readFileSync(hf('a.md'), 'utf8')).toBe('v2')
    expect((await put(b.port, d.token, 'a.md', 'again-new', null)).status).toBe(409) // 이미 있는 파일을 "새로" 만들 수 없다
  })
  it('PC 에서 탐색기로 먼저 고쳤으면 폰의 옛 rev 쓰기는 충돌이다(덮어쓰지 못한다)', async () => {
    const b = await boot()
    const d = await writer(b)
    const r1 = await put(b.port, d.token, 'a.md', 'phone v1', null)
    fs.writeFileSync(hf('a.md'), 'edited on PC in explorer')
    const t = new Date(Date.now() + 5000)
    fs.utimesSync(hf('a.md'), t, t)
    const r = await put(b.port, d.token, 'a.md', 'phone v2', r1.json.rev)
    expect(r.status).toBe(409)
    expect(fs.readFileSync(hf('a.md'), 'utf8')).toBe('edited on PC in explorer')
  })
  it('PC 에서 지운 경로에 폰의 오래된 사본이 새로 만들 수 없다 — 삭제 기록의 rev 를 알아야 한다', async () => {
    const b = await boot()
    const d = await writer(b)
    const r1 = await put(b.port, d.token, 'gone.md', 'x', null)
    const tomb = host.del('gone.md', r1.json.rev).rev // PC 에서 삭제
    const zombie = await put(b.port, d.token, 'gone.md', 'zombie from stale copy', null)
    expect(zombie.status).toBe(409)
    expect(zombie.json).toMatchObject({ deleted: true, currentRev: tomb })
    expect(fs.existsSync(hf('gone.md'))).toBe(false)
    const l = await req(b.port, '/list', {}, d.token)
    expect(l.json.tombs[0].rev).toBe(tomb) // 폰이 목록으로 삭제를 알게 되면
    expect((await put(b.port, d.token, 'gone.md', 'revived knowingly', tomb)).status).toBe(200)
  })
})

describe('실행 파일 쓰기 거부(보조 방어 — 호스트는 어떤 파일도 실행하지 않는다)', () => {
  it('확장자로 거부하고, 이름을 바꿔도 PE·ELF·Mach-O 머리를 보고 거부한다. 일반 파일은 통과', async () => {
    const b = await boot()
    const d = await writer(b)
    for (const n of ['setup.exe', 'a/b.DLL', 'run.bat', 'x.ps1', 'inst.msi', 'link.lnk', 'app.jar', 'tool.apk']) {
      const r = await put(b.port, d.token, n, 'harmless', null)
      expect(r.status, n).toBe(403)
      expect(r.json.code).toBe('executable')
    }
    expect((await put(b.port, d.token, 'innocent.txt', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2]), null)).json.code).toBe('executable')
    expect((await put(b.port, d.token, 'data.bin', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]), null)).json.code).toBe('executable')
    expect((await put(b.port, d.token, 'mac.dat', Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0]), null)).json.code).toBe('executable')
    expect(host.list().entries).toEqual([]) // 아무것도 저장되지 않았다
    for (const n of ['main.py', 'report.docx', 'data.json', '메모.md']) expect((await put(b.port, d.token, n, 'fine', null)).status, n).toBe(200)
  })
  it('PC 사용자가 직접 폴더에 넣은 실행 파일은 막지 않는다(읽을 수는 있다)', async () => {
    const b = await boot()
    fs.writeFileSync(hf('tool.exe'), Buffer.from([0x4d, 0x5a, 1, 2, 3]))
    const d = await pairDevice(b)
    const g = await req(b.port, '/get', { path: 'tool.exe' }, d.token)
    expect(g.status).toBe(200)
  })
})

describe('경로·링크·제한', () => {
  it('상위 경로·숨김(.nosidian 포함)·예약 이름·절대 경로는 400, 링크로 폴더 밖에 쓰지 못한다', async () => {
    const b = await boot()
    const d = await writer(b)
    for (const p of ['../x.md', '.nosidian/manifest.json', 'a/.git/x', '/abs.md', 'C:/x.md', 'a\\b.md', 'CON', 'x.md:stream', 'trail.']) {
      expect((await put(b.port, d.token, p, 'x', null)).status, p).toBe(400)
    }
    let made = 0
    try { fs.symlinkSync(outside, hf('linkdir'), 'junction'); made++ } catch { /* 권한 없음 */ }
    if (made) {
      const r = await put(b.port, d.token, 'linkdir/pwn.md', 'x', null)
      expect(r.status).toBe(403)
      expect(fs.existsSync(path.join(outside, 'pwn.md'))).toBe(false)
      fs.rmSync(hf('linkdir'), { recursive: true, force: true })
    }
    expect(made).toBeGreaterThan(0)
    expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('TOP SECRET')
  })
  it('25MB 를 넘는 파일은 413', async () => {
    const b = await boot()
    const d = await writer(b)
    const r = await put(b.port, d.token, 'big.bin', Buffer.alloc(25 * 1024 * 1024 + 1), null)
    expect(r.status).toBe(413)
    expect(fs.existsSync(hf('big.bin'))).toBe(false)
  })
  it('쓰기가 너무 잦으면(분당 120회) 429', async () => {
    const b = await boot()
    const d = await writer(b)
    let last = 0
    for (let i = 0; i < 121; i++) last = (await put(b.port, d.token, `n${i}.md`, 'x', null)).status
    expect(last).toBe(429)
    expect(host.list().entries.length).toBe(120)
  })
  it('PC 의 여유 공간이 부족하면 507 — 파일은 만들어지지 않는다', async () => {
    const b = await boot({ freeBytes: () => 50 * 1024 * 1024 })
    const d = await writer(b)
    const r = await put(b.port, d.token, 'a.md', 'x', null)
    expect(r.status).toBe(507)
    expect(fs.existsSync(hf('a.md'))).toBe(false)
  })
})

describe('삭제: 별도 권한이고 이번 버전에서는 꺼 둔다', () => {
  it('기본(allowDelete 꺼짐)에서는 쓰기 권한이 있어도 삭제할 수 없고, 삭제 권한도 켤 수 없다', async () => {
    const b = await boot()
    const d = await writer(b)
    const r1 = await put(b.port, d.token, 'a.md', 'x', null)
    const r = await req(b.port, '/delete', { path: 'a.md', baseRev: r1.json.rev }, d.token)
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('noDelete')
    expect(fs.existsSync(hf('a.md'))).toBe(true)
    expect(() => b.s.setPerms(d.id, { delete: true })).toThrow('not available')
    expect(b.s.state().devices[0].perms.delete).toBe(false)
  })
  it('저장된 설정에 삭제 권한이 켜져 있어도 allowDelete 가 꺼져 있으면 무시한다', async () => {
    const b = await boot()
    const d = await writer(b)
    const saved = JSON.parse(JSON.stringify(b.saved()))
    saved.devices[0].perms.delete = true
    const again = createHostServer({ store: { read: () => saved, write: () => {} }, tls, getHost: () => host })
    expect(again.state().devices[0].perms.delete).toBe(false)
    void d
  })
  it('(기능을 켠 서버) 삭제 권한이 있어야 하고, 조건부이며, 휴지통 + 삭제 기록으로 남는다', async () => {
    const b = await boot({ allowDelete: true })
    const d = await writer(b)
    const r1 = await put(b.port, d.token, 'a.md', 'precious', null)
    expect((await req(b.port, '/delete', { path: 'a.md', baseRev: r1.json.rev }, d.token)).status).toBe(403) // 쓰기만으로는 안 된다
    b.s.setPerms(d.id, { delete: true })
    expect((await req(b.port, '/delete', { path: 'a.md', baseRev: 'stale' }, d.token)).status).toBe(409)
    expect(fs.existsSync(hf('a.md'))).toBe(true)
    const r = await req(b.port, '/delete', { path: 'a.md', baseRev: r1.json.rev }, d.token)
    expect(r.status).toBe(200)
    expect(fs.existsSync(hf('a.md'))).toBe(false)
    expect(host.trash()).toHaveLength(1)
    expect(host.list().tombs.map((t: { path: string }) => t.path)).toEqual(['a.md'])
  })
})

describe('확인(ack)과 삭제 기록 정리', () => {
  it('폰이 확인하기 전에는 90일이 지나도 삭제 기록이 남고, 확인하면 정리된다', async () => {
    const b = await boot()
    const d = await writer(b)
    const r1 = await put(b.port, d.token, 'a.md', 'x', null)
    const del = host.del('a.md', r1.json.rev)
    clock += 120 * 86_400_000
    expect(host.gc().tombs).toBe(0) // 폰이 아직 확인하지 않았다
    expect((await req(b.port, '/ack', { seq: del.seq }, d.token)).status).toBe(200)
    expect(host.gc().tombs).toBe(1)
  })
  it('기기를 해제하면 그 기기의 확인을 더 기다리지 않는다', async () => {
    const b = await boot()
    const d = await writer(b)
    const r1 = await put(b.port, d.token, 'a.md', 'x', null)
    host.del('a.md', r1.json.rev)
    clock += 120 * 86_400_000
    expect(host.gc().tombs).toBe(0)
    b.s.revoke(d.id)
    expect(host.gc().tombs).toBe(1)
  })
})

describe('그 밖', () => {
  it('알 수 없는 경로·GET 요청은 404', async () => {
    const b = await boot()
    const d = await pairDevice(b)
    for (const p of ['/', '/files', '/write', '/rename', '/exec']) expect((await req(b.port, p, {}, d.token)).status, p).toBe(404)
    const r = await new Promise<number>((resolve, reject) => {
      const q = https.request({ host: '127.0.0.1', port: b.port, path: '/list', method: 'GET', rejectUnauthorized: false, headers: { authorization: `Bearer ${d.token}`, Connection: 'close' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) })
      q.on('error', reject)
      q.end()
    })
    expect(r).toBe(404)
  })
  it('호스트 폴더를 해제하면(폴더 없음) 읽기·쓰기 모두 412', async () => {
    const b = await boot()
    const d = await writer(b)
    host.close()
    const saved = host
    host = null // 폴더 지정이 사라진 상황
    expect((await req(b.port, '/list', {}, d.token)).status).toBe(412)
    expect((await put(b.port, d.token, 'a.md', 'x', null)).status).toBe(412)
    host = saved
  })
})

describe('폰을 위한 보조 기능: 현재 주소 알림·최초 연결 스냅샷', () => {
  it('/ping 은 이 PC 의 현재 주소 후보를 알려 준다(IP 가 바뀌어도 폰이 다시 찾는다)', async () => {
    const b = await boot({ lanAddresses: () => ['192.168.0.7', '10.0.0.2'] })
    const d = await pairDevice(b)
    const r = await req(b.port, '/ping', {}, d.token)
    expect(r.json).toMatchObject({ name: 'TEST-PC', ips: ['192.168.0.7', '10.0.0.2'], perms: { write: false, delete: false } })
  })
  it('/snapshot: 쓰기 권한이 있는 기기만, 1분에 한 번, 공간이 있을 때만 — 호스트 폴더 스냅샷이 만들어진다', async () => {
    const b = await boot()
    host.put('a.md', 'A', null)
    const ro = await pairDevice(b)
    expect((await req(b.port, '/snapshot', { label: 'x' }, ro.token)).status).toBe(403) // 읽기 전용 기기는 디스크를 쓰게 할 수 없다
    const d = await writer(b)
    const r = await req(b.port, '/snapshot', { label: 'first-connect' }, d.token)
    expect(r.status).toBe(200)
    expect(r.json.files).toBe(1)
    expect(fs.readFileSync(path.join(dir, '.nosidian', 'snapshots', r.json.id, 'files', 'a.md'), 'utf8')).toBe('A')
    expect((await req(b.port, '/snapshot', {}, d.token)).status).toBe(429)
    clock += 61_000
  })
  it('/snapshot: 여유 공간이 부족하면 507 — 스냅샷이 없으면 폰은 연결을 시작하지 않는다', async () => {
    const b = await boot({ freeBytes: () => 10 * 1024 * 1024 })
    const d = await writer(b)
    expect((await req(b.port, '/snapshot', {}, d.token)).status).toBe(507)
    expect(host.snapshots()).toEqual([])
  })
})

describe('연결 코드는 요청할 때만 만든다 (QR 상시 노출 금지)', () => {
  it('처음엔 없고 newCode 로 생기며 revokeCode 로 바로 없앤다', async () => {
    const b = await boot()
    expect(b.s.codeActive()).toBeNull()
    const c = b.s.newCode()
    expect(b.s.codeActive()?.value).toBe(c.value)
    b.s.revokeCode()
    expect(b.s.codeActive()).toBeNull()
  })
  it('5분이 지나면 없어지고, 폐기한 코드로는 짝을 맺을 수 없다(403)', async () => {
    const b = await boot()
    const code = b.s.newCode().value as string
    clock += 5 * 60_000 + 1
    expect(b.s.codeActive()).toBeNull()
    expect((await req(b.port, '/pair', { code, name: 'x' })).status).toBe(403)
  })
})

describe('기기 하나에 연결 링크 하나 (호스트)', () => {
  it('같은 기기가 다시 맺으면 같은 id 를 유지하고 권한은 읽기만으로 돌아가며 옛 토큰은 무효', async () => {
    const b = await boot()
    const pairOnce = async () => {
      const r = await req(b.port, '/pair', { code: b.s.newCode().value, name: '내 폰', clientId: 'phone-aaaaaaaa' })
      return { token: r.json.token as string, id: r.json.deviceId as string }
    }
    const a = await pairOnce()
    b.s.setPerms(a.id, { write: true })
    expect(b.s.state().devices[0].perms.write).toBe(true)
    const c = await pairOnce()
    expect(c.id).toBe(a.id)
    expect(b.s.state().devices).toHaveLength(1)
    expect(b.s.state().devices[0].perms.write).toBe(false)
    expect((await req(b.port, '/ping', {}, a.token)).status).toBe(401)
    expect((await req(b.port, '/ping', {}, c.token)).status).toBe(200)
  })
})
