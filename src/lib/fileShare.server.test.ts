import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mod from '../../electron/fileShare.cjs'

const { createShare, makeTls, cleanRel, badShareDir } = mod as {
  createShare(d: unknown): any
  makeTls(): Promise<{ key: string; cert: string; fp: string }>
  cleanRel(p: unknown): string | null
  badShareDir(d: string, extra?: string[]): string | null
}

let tls: { key: string; cert: string; fp: string }
let root: string
let outside: string
let server: { close(): Promise<void> } | null = null

beforeAll(async () => {
  tls = await makeTls()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-share-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-secret-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET')
  fs.mkdirSync(path.join(root, 'proj', 'sub'), { recursive: true })
  fs.mkdirSync(path.join(root, '.git'))
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true })
  fs.writeFileSync(path.join(root, 'readme.txt'), 'hello')
  fs.writeFileSync(path.join(root, 'proj', 'a.py'), 'print(1)')
  fs.writeFileSync(path.join(root, 'proj', 'sub', 'b.bin'), Buffer.from([0, 1, 2, 250, 255]))
  fs.writeFileSync(path.join(root, '.git', 'config'), 'token=abc')
  fs.writeFileSync(path.join(root, '.env'), 'KEY=1')
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), 'x')
})
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})
afterEach(async () => {
  await server?.close()
  server = null
})

function boot(over: Record<string, unknown> = {}) {
  let saved: unknown = null
  const s = createShare({ store: { read: () => saved, write: (v: unknown) => { saved = JSON.parse(JSON.stringify(v)) } }, tls, hostName: 'TESTPC', ...over })
  return { s, saved: () => saved }
}
type Res = { status: number; json: any; fp: string }
/** 실제 HTTPS 요청. 서버 인증서 지문을 함께 돌려준다(폰이 고정해서 확인하는 값) */
function req(port: number, p: string, body: unknown, token?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = https.request({ host: '127.0.0.1', port, path: p, method: 'POST', rejectUnauthorized: false, headers: { 'content-type': 'application/json', Connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      const chunks: Buffer[] = []
      const fp = (res.socket as import('tls').TLSSocket).getPeerCertificate()?.fingerprint256?.replace(/:/g, '').toLowerCase() ?? ''
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        let json: unknown = null
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* */ }
        resolve({ status: res.statusCode ?? 0, json, fp })
      })
    })
    r.on('error', reject)
    r.end(JSON.stringify(body))
  })
}
async function start(o?: Record<string, unknown>) {
  const b = boot(o)
  b.s.setDir(root)
  const port = await b.s.listen(0, '127.0.0.1')
  server = b.s
  const code = b.s.codeNow().value as string
  const r = await req(port, '/pair', { code, name: '내 폰' })
  return { ...b, port, code, token: r.json.token as string, pairRes: r }
}

describe('경로 정리(cleanRel)', () => {
  it('안전한 상대 경로만 통과', () => {
    expect(cleanRel('a.txt')).toBe('a.txt')
    expect(cleanRel('proj/sub/b.bin')).toBe('proj/sub/b.bin')
    expect(cleanRel('한글 폴더/파일 1.txt')).toBe('한글 폴더/파일 1.txt')
  })
  it('우회 시도는 모두 거절', () => {
    for (const p of ['../x', 'a/../../x', '/etc/passwd', 'C:/Windows/win.ini', 'C:\\x', 'a\\b', '.env', 'a/.git/config', 'a//b', './a', 'a/./b', 'file.txt:stream', 'a/b ', 'a/b.', 'CON', 'nul.txt', 'a/COM1', 'a\u0000b', 'a/b?.txt', '', 'x'.repeat(1001), 123, null, undefined]) expect(cleanRel(p), String(p)).toBeNull()
  })
})

describe('공유 폴더로 지정할 수 없는 곳', () => {
  it('없는 곳·파일·드라이브 루트·홈 폴더·지정한 앱 폴더를 거절하고, 일반 폴더는 받는다', () => {
    expect(badShareDir(path.join(root, 'nope'))).toBe('not found')
    expect(badShareDir(path.join(root, 'readme.txt'))).toBe('not a directory')
    expect(badShareDir(path.parse(root).root)).toBe('drive root')
    expect(badShareDir(os.homedir())).toBe('too broad')
    expect(badShareDir(root, [root])).toBe('too broad')
    expect(badShareDir(root)).toBeNull()
  })
})

describe('HTTPS 짝 맺기와 인증서 지문', () => {
  it('HTTPS 로 코드를 맞게 보내면 토큰을 받고, 서버 인증서 지문이 약속한 값과 같다', async () => {
    const s = await start()
    expect(s.pairRes.status).toBe(200)
    expect(s.token).toMatch(/^[0-9a-f]{48}$/)
    expect(s.pairRes.fp).toBe(tls.fp) // 폰이 QR 로 받은 지문과 비교하는 값
    expect(s.pairRes.json).toMatchObject({ name: 'TESTPC', dirName: path.basename(root), fp: tls.fp })
    expect(JSON.stringify(s.saved())).not.toContain(s.token) // 토큰은 해시로만 보관
  })
  it('평문 http 로는 연결되지 않는다(TLS 전용)', async () => {
    const s = await start()
    const http = await import('node:http')
    await expect(new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: s.port, path: '/ping', method: 'POST', headers: { Connection: 'close' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
      r.on('error', reject)
      r.setTimeout(1500, () => { r.destroy(new Error('timeout')) })
      r.end('{}')
    })).rejects.toThrow()
  })
  it('코드는 한 번만, 틀리면 거절하고 5번 틀리면 잠근다, 기기는 5대까지', async () => {
    const s = await start()
    expect((await req(s.port, '/pair', { code: s.code, name: 'x' })).status).toBe(403) // 이미 썼다
    for (let i = 0; i < 4; i++) expect((await req(s.port, '/pair', { code: '000000', name: 'x' })).status).toBe(403) // 위의 한 번과 합쳐 5번째에 잠긴다
    expect((await req(s.port, '/pair', { code: s.s.codeNow().value, name: 'x' })).status).toBe(429)
  })
  it('기기 5대를 넘기면 409', async () => {
    const b = boot()
    b.s.setDir(root)
    const port = await b.s.listen(0, '127.0.0.1')
    server = b.s
    for (let i = 0; i < 5; i++) expect((await req(port, '/pair', { code: b.s.codeNow().value, name: 'p' + i })).status).toBe(200)
    expect((await req(port, '/pair', { code: b.s.codeNow().value, name: 'p6' })).status).toBe(409)
  })
})

describe('인증과 기기 해제', () => {
  it('토큰이 없거나 틀리면 401, 해제한 기기는 즉시 401', async () => {
    const s = await start()
    expect((await req(s.port, '/list', {})).status).toBe(401)
    expect((await req(s.port, '/list', {}, 'a'.repeat(48))).status).toBe(401)
    expect((await req(s.port, '/list', {}, s.token)).status).toBe(200)
    s.s.revoke(s.s.state().devices[0].id)
    expect((await req(s.port, '/list', {}, s.token)).status).toBe(401)
    expect((await req(s.port, '/get', { path: 'readme.txt' }, s.token)).status).toBe(401)
  })
  it('잘못된 토큰이 20번 쌓이면 잠시 막는다(맞는 토큰도)', async () => {
    const s = await start()
    for (let i = 0; i < 20; i++) await req(s.port, '/list', {}, 'b'.repeat(48))
    expect((await req(s.port, '/list', {}, s.token)).status).toBe(429)
  })
})

describe('목록(/list): 지정 폴더 안, 읽기 전용', () => {
  it('폴더 안의 파일만 보이고 숨김·node_modules 는 뺀다', async () => {
    const s = await start()
    const r = await req(s.port, '/list', {}, s.token)
    expect(r.json.name).toBe(path.basename(root))
    expect(r.json.entries.map((e: { path: string }) => e.path)).toEqual(['proj/a.py', 'proj/sub/b.bin', 'readme.txt'])
    expect(r.json.entries[2]).toMatchObject({ path: 'readme.txt', size: 5 })
    expect(r.json.truncated).toBe(false)
  })
  it('공유 폴더가 없으면 409', async () => {
    const b = boot()
    const port = await b.s.listen(0, '127.0.0.1')
    server = b.s
    const code = b.s.codeNow().value
    const token = (await req(port, '/pair', { code, name: 'x' })).json.token
    expect((await req(port, '/list', {}, token)).status).toBe(409)
    expect((await req(port, '/ping', {}, token)).json).toMatchObject({ shared: false })
  })
  it('심볼릭 링크·정션은 목록에 나오지 않는다', async () => {
    const link = path.join(root, 'linkdir')
    const flink = path.join(root, 'linkfile.txt')
    let made = 0
    try { fs.symlinkSync(outside, link, 'junction'); made++ } catch { /* 권한 없음 */ }
    try { fs.symlinkSync(path.join(outside, 'secret.txt'), flink, 'file'); made++ } catch { /* 윈도: 관리자 권한이 필요할 수 있다 */ }
    try {
      const s = await start()
      const paths = (await req(s.port, '/list', {}, s.token)).json.entries.map((e: { path: string }) => e.path)
      expect(paths.some((p: string) => p.includes('secret') || p.startsWith('linkdir') || p.startsWith('linkfile'))).toBe(false)
      expect(made).toBeGreaterThan(0) // 최소 한 종류는 실제로 시험했는지
    } finally {
      fs.rmSync(link, { recursive: true, force: true })
      fs.rmSync(flink, { force: true })
    }
  })
})

describe('내려받기(/get): 경로 우회·링크 차단과 무결성', () => {
  it('파일 내용과 SHA-256 을 돌려준다(바이너리 포함)', async () => {
    const s = await start()
    const t = await req(s.port, '/get', { path: 'readme.txt' }, s.token)
    expect(t.status).toBe(200)
    expect(Buffer.from(t.json.b64, 'base64').toString()).toBe('hello')
    expect(t.json).toMatchObject({ size: 5, sha256: crypto.createHash('sha256').update('hello').digest('hex') })
    const b = await req(s.port, '/get', { path: 'proj/sub/b.bin' }, s.token)
    expect([...Buffer.from(b.json.b64, 'base64')]).toEqual([0, 1, 2, 250, 255])
  })
  it('우회 경로는 400, 폴더 밖 절대 경로·숨김 파일·없는 파일도 내주지 않는다', async () => {
    const s = await start()
    for (const p of ['../' + path.basename(outside) + '/secret.txt', path.join(outside, 'secret.txt'), '.env', '.git/config', 'proj/../../x', 'readme.txt:stream', 'proj\\a.py']) {
      const r = await req(s.port, '/get', { path: p }, s.token)
      expect([400, 403, 404], p).toContain(r.status)
      expect(JSON.stringify(r.json)).not.toContain('SECRET')
    }
    expect((await req(s.port, '/get', { path: 'nope.txt' }, s.token)).status).toBe(404)
    expect((await req(s.port, '/get', { path: 'proj' }, s.token)).status).toBe(404) // 폴더
    expect((await req(s.port, '/get', {}, s.token)).status).toBe(400)
  })
  it('링크를 통한 폴더 밖 파일은 내주지 않는다(정션·심볼릭 링크)', async () => {
    const link = path.join(root, 'jdir')
    const flink = path.join(root, 'sfile.txt')
    let made = 0
    try { fs.symlinkSync(outside, link, 'junction'); made++ } catch { /* */ }
    try { fs.symlinkSync(path.join(outside, 'secret.txt'), flink, 'file'); made++ } catch { /* */ }
    try {
      const s = await start()
      const viaDir = await req(s.port, '/get', { path: 'jdir/secret.txt' }, s.token)
      const viaFile = await req(s.port, '/get', { path: 'sfile.txt' }, s.token)
      for (const r of [viaDir, viaFile]) {
        expect(r.status).not.toBe(200)
        expect(JSON.stringify(r.json)).not.toContain('b64')
      }
      expect(made).toBeGreaterThan(0)
    } finally {
      fs.rmSync(link, { recursive: true, force: true })
      fs.rmSync(flink, { force: true })
    }
  })
  it('쓰기·삭제 같은 다른 요청은 없다(읽기 전용): 알 수 없는 경로는 404', async () => {
    const s = await start()
    for (const p of ['/put', '/write', '/delete', '/rename', '/exec', '/files', '/']) expect((await req(s.port, p, { path: 'x.txt', content: 'x' }, s.token)).status, p).toBe(404)
    expect(fs.readFileSync(path.join(root, 'readme.txt'), 'utf8')).toBe('hello')
  })
  it('25MB 를 넘는 파일은 413', async () => {
    const big = path.join(root, 'big.bin')
    fs.writeFileSync(big, Buffer.alloc(25 * 1024 * 1024 + 1))
    try {
      const s = await start()
      expect((await req(s.port, '/get', { path: 'big.bin' }, s.token)).status).toBe(413)
    } finally {
      fs.rmSync(big, { force: true })
    }
  })
})

describe('설정 보관', () => {
  it('켜짐·공유 폴더는 저장되고 다시 불러온다', () => {
    const b = boot()
    b.s.setDir(root)
    b.s.setEnabled(true)
    const saved = JSON.parse(JSON.stringify(b.saved()))
    expect(saved).toMatchObject({ enabled: true, dir: fs.realpathSync.native(root) })
    const again = createShare({ store: { read: () => saved, write: () => {} }, tls })
    expect(again.state()).toMatchObject({ enabled: true, port: 47411 })
    expect(b.s.setDir(path.join(root, 'nope'))).toBe('not found')
    expect(b.s.setDir(null)).toBeNull()
    expect((b.saved() as { dir: unknown }).dir).toBeNull()
  })
})

describe('연결 코드는 요청할 때만 만든다 (QR 상시 노출 금지)', () => {
  it('처음엔 없고 newCode 로 생기며 revokeCode 로 바로 없앤다', () => {
    const b = boot()
    b.s.setDir(root)
    expect(b.s.codeActive()).toBeNull()
    const c = b.s.newCode()
    expect(b.s.codeActive()?.value).toBe(c.value)
    b.s.revokeCode()
    expect(b.s.codeActive()).toBeNull()
  })
  it('5분이 지나면 없어진다', () => {
    let clock = 1_700_000_000_000
    const b = boot({ now: () => clock })
    b.s.setDir(root)
    b.s.newCode()
    clock += 5 * 60_000 + 1
    expect(b.s.codeActive()).toBeNull()
  })
  it('폐기한 코드로는 짝을 맺을 수 없다(403)', async () => {
    const b = boot()
    b.s.setDir(root)
    const port = await b.s.listen(0, '127.0.0.1')
    server = b.s
    const code = b.s.newCode().value as string
    b.s.revokeCode()
    expect((await req(port, '/pair', { code, name: 'x' })).status).toBe(403)
  })
})

describe('기기 하나에 연결 링크 하나 (폴더 공유)', () => {
  it('같은 기기가 다시 맺으면 목록에 중복이 없다', async () => {
    const b = boot()
    b.s.setDir(root)
    const port = await b.s.listen(0, '127.0.0.1')
    server = b.s
    for (let i = 0; i < 3; i++) {
      const r = await req(port, '/pair', { code: b.s.newCode().value, name: '내 폰', clientId: 'phone-aaaaaaaa' })
      expect(r.status).toBe(200)
    }
    expect(b.s.state().devices).toHaveLength(1)
  })
})

describe('/unpair — 폰이 스스로 연결을 해제한다 (5-c)', () => {
  it('해제하면 PC 의 기기 목록에서 빠지고 그 토큰은 즉시 401, 다른 기기는 그대로', async () => {
    const s = await start()
    const r2 = await req(s.port, '/pair', { code: s.s.codeNow().value, name: '태블릿' })
    const t2 = r2.json.token as string
    expect(s.s.state().devices).toHaveLength(2)
    expect((await req(s.port, '/unpair', {}, s.token)).status).toBe(200)
    expect(s.s.state().devices.map((d: { name: string }) => d.name)).toEqual(['태블릿'])
    expect((await req(s.port, '/list', {}, s.token)).status).toBe(401)
    expect((await req(s.port, '/list', {}, t2)).status).toBe(200)
    expect((await req(s.port, '/unpair', {}, s.token)).status).toBe(401) // 이미 해제됨
  })
  it('토큰이 없거나 틀리면 해제할 수 없다(401)', async () => {
    const s = await start()
    expect((await req(s.port, '/unpair', {})).status).toBe(401)
    expect((await req(s.port, '/unpair', {}, 'a'.repeat(48))).status).toBe(401)
    expect(s.s.state().devices).toHaveLength(1)
  })
})
