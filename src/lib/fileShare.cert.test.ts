// 회귀 시험(v1.38.0): PC 앱이 준비되기 전에 인증서 개인키를 복호화하다 실패하면 인증서가 새로 만들어져,
// 이미 짝을 맺은 폰의 고정 지문이 PC 를 다시 켤 때마다 깨졌다. 한 번 짝을 맺은 기기는 PC 를 재시작해도 같은 인증서를 믿을 수 있어야 한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mod from '../../electron/fileShare.cjs'

const { register } = mod as { register(h: unknown): void }

type Handler = (e: unknown, arg?: unknown) => Promise<{ fingerprint: string; devices: unknown[] }>

/** Electron 의 실제 제약을 흉내 낸다: safeStorage 는 앱이 준비되기 전에 복호화하면 예외를 던진다 */
function host(userData: string, opts: { encryption?: boolean } = {}) {
  const handlers = new Map<string, Handler>()
  let ready = false
  let release!: () => void
  const readyPromise = new Promise<void>((r) => (release = () => { ready = true; r() }))
  const quit: (() => void)[] = []
  const app = {
    getPath: (n: string) => (n === 'userData' ? userData : os.homedir()),
    whenReady: () => readyPromise,
    on: (ev: string, cb: () => void) => { if (ev === 'before-quit') quit.push(cb) },
  }
  const safeStorage = {
    isEncryptionAvailable: () => opts.encryption !== false,
    encryptString: (s: string) => Buffer.from('ENC:' + s),
    decryptString: (b: Buffer) => {
      if (!ready) throw new Error('safeStorage cannot be used before app is ready')
      const t = b.toString()
      if (!t.startsWith('ENC:')) throw new Error('cannot decrypt')
      return t.slice(4)
    },
  }
  register({ ipcMain: { handle: (n: string, h: Handler) => handlers.set(n, h) }, app, dialog: {}, safeStorage, BrowserWindow: { getFocusedWindow: () => null } })
  return {
    ready: release,
    status: () => handlers.get('share:get')!({}),
    set: (enabled: boolean) => handlers.get('share:set')!({}, { enabled }),
    stop: async () => { await handlers.get('share:set')!({}, { enabled: false }); quit.forEach((f) => f()) },
  }
}

let dir: string
const hosts: { stop(): Promise<void> }[] = []
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-cert-')) })
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})
const launch = (opts?: { encryption?: boolean }) => {
  const h = host(dir, opts)
  hosts.push(h)
  return h
}

describe('PC 재시작 후에도 같은 인증서(지문)', () => {
  it('처음 켠 뒤 여러 번 재시작해도 지문이 바뀌지 않는다', async () => {
    const first = launch()
    first.ready()
    const fp = (await first.status()).fingerprint
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
    await hosts.pop()!.stop()
    for (let i = 0; i < 3; i++) {
      const again = launch()
      again.ready()
      expect((await again.status()).fingerprint, `재시작 ${i + 1}`).toBe(fp)
      await hosts.pop()!.stop()
    }
  })

  it('앱이 준비되기 전에 상태를 물어도(복호화 불가) 인증서를 새로 만들지 않고 준비된 뒤에 읽는다', async () => {
    const first = launch()
    first.ready()
    const fp = (await first.status()).fingerprint
    await hosts.pop()!.stop()

    const again = launch()
    const early = again.status() // 아직 앱이 준비되지 않았다: 여기서 복호화하면 예외 → 인증서 재생성(옛 결함)
    again.ready()
    expect((await early).fingerprint).toBe(fp)
  })

  it('여러 곳에서 동시에 불려도 인증서는 하나다(경합 방지)', async () => {
    const h = launch()
    const all = [h.status(), h.status(), h.set(false), h.status()]
    h.ready()
    const fps = (await Promise.all(all)).map((r) => r.fingerprint)
    expect(new Set(fps).size).toBe(1)
  })

  it('개인키는 보안 저장소로 암호화돼 파일에 평문으로 남지 않는다(사용 가능할 때)', async () => {
    const h = launch()
    h.ready()
    await h.status()
    const raw = fs.readFileSync(path.join(dir, 'share-tls.json'), 'utf8')
    const v = JSON.parse(raw)
    expect(v.enc).toBe(true)
    expect(raw).not.toContain('PRIVATE KEY')
    expect(raw).toContain('BEGIN CERTIFICATE') // 인증서(공개)는 평문이어도 된다
  })

  it('보안 저장소를 못 쓰는 환경에서도 재시작 후 같은 인증서를 쓴다', async () => {
    const a = launch({ encryption: false })
    a.ready()
    const fp = (await a.status()).fingerprint
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'share-tls.json'), 'utf8')).enc).toBe(false)
    await hosts.pop()!.stop()
    const b = launch({ encryption: false })
    b.ready()
    expect((await b.status()).fingerprint).toBe(fp)
  })

  it('저장된 인증서를 정말 읽을 수 없을 때만(손상·다른 사용자 계정) 새로 만든다 — 이때는 폰이 지문 불일치로 거절한다', async () => {
    const a = launch()
    a.ready()
    const fp = (await a.status()).fingerprint
    await hosts.pop()!.stop()
    const f = path.join(dir, 'share-tls.json')
    const v = JSON.parse(fs.readFileSync(f, 'utf8'))
    fs.writeFileSync(f, JSON.stringify({ ...v, key: Buffer.from('garbage').toString('base64') })) // 복호화 불가
    const b = launch()
    b.ready()
    const fp2 = (await b.status()).fingerprint
    expect(fp2).toMatch(/^[0-9a-f]{64}$/)
    expect(fp2).not.toBe(fp) // 조용히 같은 척하지 않는다
  })
})
