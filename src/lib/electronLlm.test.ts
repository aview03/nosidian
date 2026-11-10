import { describe, expect, it } from 'vitest'
import { isPrivateHost } from './llm'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mainRaw from '../../electron/llm.cjs'

// 메인 프로세스(electron/llm.cjs)는 화면(src/lib/llm.ts)과 같은 주소 규칙을 따로 한 번 더 검사한다. 둘이 어긋나지 않는지 본다.
const main = mainRaw as {
  check(req: unknown): string | null
  isPrivateHost(h: string): boolean
  injectKey(h: Record<string, string>, key: string | null): Record<string, string> | null
  createKeyStore(o: { file: string; safeStorage: unknown }): { available(): boolean; has(): boolean; set(k: string): void; get(): string | null; clear(): void }
  request(req: unknown, keys: unknown, ac?: unknown): Promise<{ status: number; text: string; error?: string; cancelled?: boolean }>
}

describe('메인 프로세스 요청 검사(electron/llm.cjs)', () => {
  it('주소 규칙이 화면(llm.ts)과 같다', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '172.32.0.1', '192.168.1.1', '192.169.1.1', '169.254.0.1', '100.64.0.1', '100.128.0.1', 'nas.local', '[::1]', '::1', 'example.com', '8.8.8.8', 'api.openai.com']) {
      expect(main.isPrivateHost(h), h).toBe(isPrivateHost(h))
    }
  })
  it('허용: 사설망 http, 어디든 https, GET·POST', () => {
    expect(main.check({ url: 'http://192.168.0.10:11434/api/tags', method: 'GET', headers: {} })).toBeNull()
    expect(main.check({ url: 'https://api.openai.com/v1/models', method: 'GET', headers: {} })).toBeNull()
    expect(main.check({ url: 'http://localhost:11434/api/chat', method: 'POST', headers: {}, body: '{}' })).toBeNull()
  })
  it('거절: 공개 http, http/https 가 아닌 주소, 다른 메서드, 문자열이 아닌 본문, 깨진 요청', () => {
    expect(main.check({ url: 'http://example.com/', method: 'GET' })).not.toBeNull()
    expect(main.check({ url: 'file:///c:/x', method: 'GET' })).not.toBeNull()
    expect(main.check({ url: 'ftp://localhost/', method: 'GET' })).not.toBeNull()
    expect(main.check({ url: 'http://localhost/', method: 'DELETE' })).not.toBeNull()
    expect(main.check({ url: 'http://localhost/', method: 'POST', body: { a: 1 } })).not.toBeNull()
    expect(main.check({ url: '이상한' , method: 'GET' })).not.toBeNull()
    expect(main.check(null)).not.toBeNull()
  })
})

// ── API 키 보관(운영체제 보안 저장소) ──
// 실제 safeStorage 는 Electron 안에서만 있으므로, 암호화 대신 눈에 띄는 접두어를 붙이는 가짜로 흐름만 확인한다.
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => new TextEncoder().encode('ENC:' + s),
  decryptString: (b: Uint8Array) => {
    const t = new TextDecoder().decode(b)
    if (!t.startsWith('ENC:')) throw new Error('복호화 실패')
    return t.slice(4)
  },
})
async function tmpFile() {
  // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
  const os: any = await import('node:os')
  // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
  const fs: any = await import('node:fs')
  // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
  const path: any = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nosidian-key-'))
  return { file: path.join(dir, 'llm-key.bin'), fs }
}

describe('API 키 보관소', () => {
  it('저장 → 있음 → 읽기 → 삭제, 파일에는 평문 키가 없다(여기서는 가짜 암호화 접두어로 구분)', async () => {
    const { file, fs } = await tmpFile()
    const ks = main.createKeyStore({ file, safeStorage: fakeSafe() })
    expect(ks.available()).toBe(true)
    expect(ks.has()).toBe(false)
    ks.set('  sk-secret  ')
    expect(ks.has()).toBe(true)
    expect(ks.get()).toBe('sk-secret') // 앞뒤 공백 제거
    expect(String(fs.readFileSync(file))).toBe('ENC:sk-secret')
    ks.clear()
    expect(ks.has()).toBe(false)
    expect(ks.get()).toBeNull()
    ks.clear() // 없어도 오류 없음
  })
  it('보안 저장소를 못 쓰면 저장을 거절하고, 잘못된 키도 거절', async () => {
    const { file } = await tmpFile()
    expect(() => main.createKeyStore({ file, safeStorage: fakeSafe(false) }).set('k')).toThrow()
    const ks = main.createKeyStore({ file, safeStorage: fakeSafe() })
    for (const bad of ['', '   ', 'x'.repeat(2001), 5 as unknown as string]) expect(() => ks.set(bad), String(bad)).toThrow()
    expect(ks.has()).toBe(false)
  })
  it('깨진 파일은 null(복호화 실패)', async () => {
    const { file, fs } = await tmpFile()
    fs.writeFileSync(file, 'garbage')
    expect(main.createKeyStore({ file, safeStorage: fakeSafe() }).get()).toBeNull()
  })
  it('자리표시자 치환: 허용 헤더에만, 키가 없으면 null', () => {
    expect(main.injectKey({ Authorization: 'Bearer {{KEY}}', 'Content-Type': 'application/json' }, 'k1')).toEqual({ Authorization: 'Bearer k1', 'Content-Type': 'application/json' })
    expect(main.injectKey({ 'x-api-key': '{{KEY}}' }, 'k2')).toEqual({ 'x-api-key': 'k2' })
    expect(main.injectKey({ Authorization: 'Bearer {{KEY}}' }, null)).toBeNull()
    expect(main.injectKey({ 'X-Evil': '{{KEY}}', Authorization: 'Bearer a' }, 'k')).toEqual({ Authorization: 'Bearer a' }) // 허용 목록 밖 헤더로는 키가 새지 않는다
    expect(main.injectKey({ 'Content-Type': 'application/json' }, null)).toEqual({ 'Content-Type': 'application/json' })
  })
  it('실제 요청: 메인 프로세스가 키를 넣어 보내고, 키가 없으면 보내지 않으며, 오류에 키가 섞이지 않는다', async () => {
    // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
    const http: any = await import('node:http')
    const seen: string[] = []
    const server = http.createServer((req: any, res: any) => { seen.push(String(req.headers.authorization)); res.end('{"ok":true}') })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${server.address().port}/`
    try {
      const { file } = await tmpFile()
      const ks = main.createKeyStore({ file, safeStorage: fakeSafe() })
      const req = { url, method: 'GET', headers: { Authorization: 'Bearer {{KEY}}' } }
      const noKey = await main.request(req, ks)
      expect(noKey.status).toBe(0)
      expect(noKey.error).toBeTruthy()
      expect(seen).toHaveLength(0) // 키가 없으면 요청 자체를 보내지 않는다
      ks.set('sk-live-123')
      const ok = await main.request(req, ks)
      expect(ok.status).toBe(200)
      expect(seen).toEqual(['Bearer sk-live-123'])
      expect(JSON.stringify(ok)).not.toContain('sk-live-123')
      // 연결 실패 오류에도 키가 없다
      const failed = await main.request({ url: 'http://127.0.0.1:1/', method: 'GET', headers: { Authorization: 'Bearer {{KEY}}' } }, ks)
      expect(JSON.stringify(failed)).not.toContain('sk-live-123')
    } finally {
      server.close()
    }
  })
})

describe('요청 취소', () => {
  it('진행 중인 요청을 끊으면 "취소했어요" 로 끝나고(시간 초과와 구분), 서버 응답을 기다리지 않는다', async () => {
    // @ts-expect-error 타입 선언 없이 Node 내장 모듈을 쓴다
    const http: any = await import('node:http')
    const server = http.createServer(() => { /* 응답하지 않는다 */ })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    try {
      const ac = new AbortController() as AbortController & { cancelled?: boolean }
      const t0 = Date.now()
      const p = main.request({ url: `http://127.0.0.1:${server.address().port}/`, method: 'GET', headers: {} }, null, ac)
      setTimeout(() => { ac.cancelled = true; ac.abort() }, 50)
      const r = await p
      expect(r).toMatchObject({ status: 0, cancelled: true })
      expect(r.error).toBe('취소했어요')
      expect(Date.now() - t0).toBeLessThan(2000)
    } finally {
      server.closeAllConnections?.()
      server.close()
    }
  })
})
