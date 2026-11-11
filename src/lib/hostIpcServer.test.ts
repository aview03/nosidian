// PC 화면(IPC) → 호스트 동기화 서버 연결 시험: 켜기·연결 문자열·기기별 권한 변경·해제·폴더 해제 시 서버 중지. 실제 HTTPS 로 폰 역할을 한다.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import hostIpc from '../../electron/hostIpc.cjs'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import shareMod from '../../electron/fileShare.cjs'

const { register } = hostIpc as { register(h: unknown): unknown }
const { makeTls } = shareMod as { makeTls(): Promise<{ key: string; cert: string; fp: string }> }

type Handler = (e: unknown, ...a: unknown[]) => Promise<Record<string, any>>
const handlers = new Map<string, Handler>()
let tls: { key: string; cert: string; fp: string }
let userData: string
let dir: string
const ipc = (n: string, ...a: unknown[]) => handlers.get(n)!({}, ...a)

beforeAll(async () => {
  tls = await makeTls()
})
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-hipc-ud-'))
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-hipc-'))
  fs.writeFileSync(path.join(userData, 'host.json'), JSON.stringify({ dir }))
  handlers.clear()
  register({ ipcMain: { handle: (n: string, h: Handler) => handlers.set(n, h) }, app: { getPath: (n: string) => (n === 'userData' ? userData : os.homedir()), on: () => {}, whenReady: () => Promise.resolve() }, dialog: {}, BrowserWindow: { getFocusedWindow: () => null }, getTls: async () => tls })
})
afterEach(async () => {
  await ipc('hostsrv:set', { enabled: false })
  await ipc('host:clear')
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(dir, { recursive: true, force: true })
})

function call(port: number, p: string, body: unknown, token?: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body ?? {})
    const r = https.request({ host: '127.0.0.1', port, path: p, method: 'POST', rejectUnauthorized: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), Connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        let json: unknown = null
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* */ }
        resolve({ status: res.statusCode ?? 0, json })
      })
    })
    r.on('error', reject)
    r.end(data)
  })
}

describe('PC 화면 → 호스트 동기화 서버', () => {
  it('기본은 꺼져 있고, 켜면 연결 문자열(지문 포함)이 나오며, 폰이 짝을 맺으면 읽기 전용 기기로 보인다', async () => {
    const off = await ipc('hostsrv:get')
    expect(off).toMatchObject({ ok: true, enabled: false, running: false, hostConfigured: true, pair: null, allowDelete: false })
    const on = await ipc('hostsrv:set', { enabled: true })
    expect(on).toMatchObject({ ok: true, enabled: true, running: true })
    expect(on).toMatchObject({ code: null, pair: null, codeExpiresAt: null }) // 켠 것만으로는 QR·코드가 생기지 않는다
    const g = await ipc('hostsrv:newCode') // 코드는 '기기 추가'를 눌렀을 때만 만든다
    expect(g.pair).toMatch(/^nsh1:[\d.,]+:\d+:\d{6}:[0-9a-f]{64}$/)
    expect(g.pair).toContain(tls.fp) // 공유 폴더와 같은 PC 인증서 지문
    const r = await call(g.port, '/pair', { code: g.code, name: '내 폰' })
    expect(r.status).toBe(200)
    expect(r.json.perms).toEqual({ write: false, delete: false })
    const after = await ipc('hostsrv:get')
    expect(after.devices).toHaveLength(1)
    expect(after.devices[0]).toMatchObject({ name: '내 폰', perms: { write: false, delete: false }, writes: 0 })
  })

  it('PC 에서 쓰기를 허용·회수하면 폰의 쓰기가 즉시 열리고 닫힌다. 삭제 권한은 켤 수 없다', async () => {
    await ipc('hostsrv:set', { enabled: true })
    const g = await ipc('hostsrv:newCode') // 코드는 '기기 추가'를 눌렀을 때만 만든다
    const p = await call(g.port, '/pair', { code: g.code, name: '내 폰' })
    const token = p.json.token as string
    const id = p.json.deviceId as string
    const w = (content: string, baseRev: string | null) => call(g.port, '/put', { path: '노트.md', baseRev, b64: Buffer.from(content).toString('base64') }, token)
    expect((await w('first', null)).status).toBe(403)
    expect(fs.existsSync(path.join(dir, '노트.md'))).toBe(false)

    const on = await ipc('hostsrv:setPerms', id, { write: true })
    expect(on.ok).toBe(true)
    expect(on.devices[0].perms.write).toBe(true)
    const r1 = await w('first', null)
    expect(r1.status).toBe(200)
    expect(fs.readFileSync(path.join(dir, '노트.md'), 'utf8')).toBe('first')
    expect((await ipc('hostsrv:get')).devices[0].writes).toBe(1)

    const del = await ipc('hostsrv:setPerms', id, { delete: true })
    expect(del).toMatchObject({ ok: false, status: 403, code: 'noDelete' })
    expect((await ipc('hostsrv:get')).devices[0].perms.delete).toBe(false)

    await ipc('hostsrv:setPerms', id, { write: false })
    expect((await w('second', r1.json.rev)).status).toBe(403)
    expect(fs.readFileSync(path.join(dir, '노트.md'), 'utf8')).toBe('first')
    expect(await ipc('hostsrv:setPerms', 'no-such-device', { write: true })).toMatchObject({ ok: false, status: 404 })
  })

  it('기기를 해제하면 즉시 접근이 막히고, 서버를 끄면 연결이 거부된다', async () => {
    await ipc('hostsrv:set', { enabled: true })
    const g = await ipc('hostsrv:newCode') // 코드는 '기기 추가'를 눌렀을 때만 만든다
    const p = await call(g.port, '/pair', { code: g.code, name: '내 폰' })
    expect((await call(g.port, '/list', {}, p.json.token)).status).toBe(200)
    const rv = await ipc('hostsrv:revoke', p.json.deviceId)
    expect(rv.devices).toHaveLength(0)
    expect((await call(g.port, '/list', {}, p.json.token)).status).toBe(401)
    await ipc('hostsrv:set', { enabled: false })
    await expect(call(g.port, '/list', {}, p.json.token)).rejects.toThrow()
  })

  it('호스트 폴더를 해제하면 서버가 꺼지고, 폴더 없이는 켤 수 없다', async () => {
    await ipc('hostsrv:set', { enabled: true })
    expect((await ipc('hostsrv:get')).running).toBe(true)
    await ipc('host:clear')
    const st = await ipc('hostsrv:get')
    expect(st).toMatchObject({ enabled: false, running: false, hostConfigured: false, pair: null })
    expect(await ipc('hostsrv:set', { enabled: true })).toMatchObject({ ok: false, status: 412, code: 'noFolder' })
  })

  it('새 코드를 만들면 이전 코드는 쓸 수 없다', async () => {
    await ipc('hostsrv:set', { enabled: true })
    const a = await ipc('hostsrv:newCode')
    const b = await ipc('hostsrv:newCode')
    expect(b.code).not.toBe(a.code)
    expect((await call(a.port, '/pair', { code: a.code, name: 'x' })).status).toBe(403)
    expect((await call(a.port, '/pair', { code: b.code, name: 'x' })).status).toBe(200)
  })

  it('코드를 폐기하면 그 코드로는 짝을 맺을 수 없고, 상태에서도 사라진다', async () => {
    await ipc('hostsrv:set', { enabled: true })
    const a = await ipc('hostsrv:newCode')
    expect(a.codeExpiresAt).toBeGreaterThan(Date.now())
    const r = await ipc('hostsrv:revokeCode')
    expect(r).toMatchObject({ ok: true, code: null, pair: null, codeExpiresAt: null })
    expect((await call(a.port, '/pair', { code: a.code, name: 'x' })).status).toBe(403)
  })
})
