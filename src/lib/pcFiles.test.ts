import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mod from '../../electron/fileShare.cjs'
import { setLang } from './i18n'
import { setPinnedTransport, pinnedRequest, type PinnedReq, type PinnedRes } from './pinnedHttp'
import { entriesIn, forgetPcShare, getShareFile, listShare, loadPcShare, pairShare, parseSharePairing, sha256Hex, usePcFilesUi } from './pcFiles'

setLang('ko')
const { createShare, makeTls } = mod as { createShare(d: unknown): any; makeTls(): Promise<{ key: string; cert: string; fp: string }> }

/** 폰의 PinnedHttp 와 같은 규칙의 시험용 전송: 서버 인증서 지문이 pin 과 다르면 요청을 보내기 전에 끊는다 */
function nodePinned(r: PinnedReq): Promise<PinnedRes> {
  return new Promise((resolve, reject) => {
    const u = new URL(r.url)
    const req = https.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: r.method,
        headers: { ...r.headers, Connection: 'close' },
        rejectUnauthorized: false,
        agent: new https.Agent({ maxCachedSessions: 0 }), // 세션 재개에서는 상대 인증서가 안 보이므로 매번 전체 핸드셰이크(안드로이드 플러그인도 요청마다 새로 한다)
        timeout: r.timeoutMs ?? 30000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), fp: r.pin }))
      },
    )
    // 안드로이드 PinnedHttp(TrustManager)와 같은 규칙: 핸드셰이크 직후 지문이 다르면 요청 본문을 보내기 전에 끊는다
    req.on('socket', (sock) => {
      const check = () => {
        const fp = (sock as import('tls').TLSSocket).getPeerCertificate()?.fingerprint256?.replace(/:/g, '').toLowerCase() ?? ''
        if (fp !== r.pin) req.destroy(new Error('pin mismatch'))
      }
      if ((sock as import('tls').TLSSocket).getPeerCertificate?.()?.fingerprint256) check()
      else sock.once('secureConnect', check)
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.flushHeaders()
    setImmediate(() => req.end(r.body))
  })
}

let tls: { key: string; cert: string; fp: string }
let dir: string
let server: { close(): Promise<void>; codeNow(): { value: string }; revoke(id: string): void; state(): { devices: { id: string }[] } } | null = null
beforeAll(async () => {
  tls = await makeTls()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-pcfiles-'))
  fs.mkdirSync(path.join(dir, 'proj'))
  fs.writeFileSync(path.join(dir, 'a.txt'), '안녕')
  fs.writeFileSync(path.join(dir, 'proj', 'b.bin'), Buffer.from([1, 2, 3, 250]))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
beforeEach(() => {
  localStorage.clear()
  usePcFilesUi.setState({ link: null, open: false })
  setPinnedTransport(nodePinned)
})
afterEach(async () => {
  await server?.close()
  server = null
  setPinnedTransport(null)
})

async function boot() {
  const s = createShare({ store: { read: () => null, write: () => {} }, tls, hostName: 'MY-PC' })
  s.setDir(dir)
  const port = await s.listen(0, '127.0.0.1')
  server = s
  return { s, port, pairing: `nsf1:127.0.0.1:${port}:${s.codeNow().value}:${tls.fp.toUpperCase()}` }
}

describe('연결 문자열', () => {
  it('QR/복사 문자열(지문 포함)을 해석하고, 지문이 없거나 틀린 모양은 거절한다', () => {
    const fp = 'ab'.repeat(32)
    expect(parseSharePairing(`nsf1:192.168.0.10,192.168.56.1:47411:482913:${fp}`)).toEqual({ host: '192.168.0.10', hosts: ['192.168.0.10', '192.168.56.1'], port: 47411, code: '482913', fp })
    expect(parseSharePairing(` nsf1:10.0.0.2:47411:123456:${fp.toUpperCase()} `)?.fp).toBe(fp)
    for (const bad of ['', 'nsf1:10.0.0.2:47411:123456', 'nsf1:10.0.0.2:47411:123456:abcd', '10.0.0.2:47411/123456', 'nsd1:10.0.0.2:47410:123456', `nsf1:999.0.0.1:47411:123456:${fp}`, `nsf1:10.0.0.2:80:123456:${fp}`, `nsf1:10.0.0.2:47411:12345:${fp}`]) expect(parseSharePairing(bad), bad).toBeNull()
  })
  it('목록에서 폴더별 보기', () => {
    const e = [{ path: 'a.txt', size: 1, mtime: 1 }, { path: 'proj/b.bin', size: 2, mtime: 2 }, { path: 'proj/sub/c.py', size: 3, mtime: 3 }, { path: 'proj2/d.txt', size: 4, mtime: 4 }]
    expect(entriesIn(e, '').folders).toEqual([{ name: 'proj', path: 'proj', count: 2 }, { name: 'proj2', path: 'proj2', count: 1 }])
    expect(entriesIn(e, '').files.map((f) => f.name)).toEqual(['a.txt'])
    expect(entriesIn(e, 'proj').files.map((f) => f.name)).toEqual(['b.bin'])
    expect(entriesIn(e, 'proj').folders).toEqual([{ name: 'sub', path: 'proj/sub', count: 1 }])
  })
})

describe('HTTPS 페어링 → 목록 → 받기(지문 고정 연결)', () => {
  it('QR 의 지문으로 짝을 맺고, 목록을 보고, 바이너리를 해시 검증과 함께 받는다', async () => {
    const b = await boot()
    const link = await pairShare(parseSharePairing(b.pairing)!, '내 폰')
    expect(link).toMatchObject({ host: '127.0.0.1', port: b.port, fp: tls.fp, name: 'MY-PC', dirName: path.basename(dir) })
    expect(loadPcShare()).toEqual(link)
    expect(usePcFilesUi.getState().link).toEqual(link)
    const list = await listShare(link)
    expect(list.entries.map((e) => e.path)).toEqual(['a.txt', 'proj/b.bin'])
    const text = await getShareFile(link, 'a.txt')
    expect(Buffer.from(text, 'base64').toString()).toBe('안녕')
    const bin = await getShareFile(link, 'proj/b.bin')
    expect([...Buffer.from(bin, 'base64')]).toEqual([1, 2, 3, 250])
  })
  it('지문이 다른 서버(가로채기)에는 연결하지 않는다 — 코드도 보내지 않는다', async () => {
    const b = await boot()
    const wrong = parseSharePairing(`nsf1:127.0.0.1:${b.port}:${b.s.codeNow().value}:${'0'.repeat(64)}`)!
    await expect(pairShare(wrong, 'x')).rejects.toThrow('인증서가 연결할 때와 달라요')
    expect(loadPcShare()).toBeNull()
    expect(b.s.state().devices).toHaveLength(0)
    await expect(pairShare(parseSharePairing(b.pairing)!, 'x')).resolves.toBeTruthy() // 코드가 소모되지 않았다
  })
  it('맺은 뒤 PC 인증서가 바뀌면(다른 기기) 목록·받기가 거절된다', async () => {
    const b = await boot()
    const link = await pairShare(parseSharePairing(b.pairing)!, 'x')
    await expect(listShare({ ...link, fp: '1'.repeat(64) })).rejects.toThrow('인증서가 연결할 때와 달라요')
    await expect(getShareFile({ ...link, fp: '1'.repeat(64) }, 'a.txt')).rejects.toThrow('인증서가 연결할 때와 달라요')
  })
  it('PC 에서 기기를 해제하면 폰은 알아보기 쉬운 오류를 받는다', async () => {
    const b = await boot()
    const link = await pairShare(parseSharePairing(b.pairing)!, 'x')
    b.s.revoke(b.s.state().devices[0].id)
    await expect(listShare(link)).rejects.toThrow('연결이 해제됐어요')
  })
  it('틀린 코드·없는 파일·우회 경로는 오류로 끝나고 아무것도 받지 않는다', async () => {
    const b = await boot()
    await expect(pairShare(parseSharePairing(`nsf1:127.0.0.1:${b.port}:000000:${tls.fp}`)!, 'x')).rejects.toThrow('연결 코드가 맞지 않거나')
    const link = await pairShare(parseSharePairing(b.pairing)!, 'x')
    await expect(getShareFile(link, 'nope.txt')).rejects.toThrow('찾을 수 없어요')
    await expect(getShareFile(link, '../etc/passwd')).rejects.toThrow()
  })
  it('받은 내용이 PC 가 알린 해시·크기와 다르면 버린다(변조·전송 오류)', async () => {
    const b = await boot()
    const link = await pairShare(parseSharePairing(b.pairing)!, 'x')
    setPinnedTransport(async (r) => {
      const res = await nodePinned(r)
      if (!r.url.endsWith('/get')) return res
      const j = JSON.parse(res.text)
      j.b64 = Buffer.from('변조된 내용').toString('base64')
      return { ...res, text: JSON.stringify(j) }
    })
    await expect(getShareFile(link, 'a.txt')).rejects.toThrow('PC의 파일과 달라서 버렸어요')
  })
  it('http 주소나 지문 없는 요청은 보내지 않는다', async () => {
    await expect(pinnedRequest({ url: 'http://127.0.0.1:1/x', method: 'POST', headers: {}, pin: 'a'.repeat(64) })).rejects.toThrow('https only')
    await expect(pinnedRequest({ url: 'https://127.0.0.1:1/x', method: 'POST', headers: {}, pin: '' })).rejects.toThrow('pin required')
  })
  it('해제하면 저장한 연결이 지워진다. sha256Hex 는 표준 값', async () => {
    const b = await boot()
    await pairShare(parseSharePairing(b.pairing)!, 'x')
    forgetPcShare()
    expect(loadPcShare()).toBeNull()
    expect(usePcFilesUi.getState().link).toBeNull()
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
