// 폰 → PC 호스트 동기화 통합 시험: 실제 호스트 서버(HTTPS)·실제 호스트 저장 계층에 대해 폰의 기존 동기화(useApp.sync)와 "내 PC" Provider 를 돌린다.
// 폰의 PinnedHttp 와 같은 규칙(지문이 다르면 요청을 보내기 전에 끊는다)의 시험용 전송을 쓴다.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import hostServerMod from '../../electron/hostServer.cjs'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import hostStoreMod from '../../electron/hostStore.cjs'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import shareMod from '../../electron/fileShare.cjs'
import { useApp, uploadOthers, replaceOther } from './app'
import { useDialog } from './dialog'
import { conflictOf } from './sync/types'
import { conflictCopyPath } from './otherConflict'
import { setLang } from './i18n'
import { setPinnedTransport, type PinnedReq, type PinnedRes } from './pinnedHttp'
import { setSnapshotBackend, listVaultSnapshots, type SnapshotBackend } from './phoneSnapshot'
import { forgetPcHost, hostErrorText, loadPcHost, pairHost, parseHostPairing, pingHost, callHost, savePcHost, unpairHost, type PcHostLink } from './pcHost'
import { applyHostConnect, leaveHost, phoneHostIO, planHostConnect, previewHostConnect, restoreVaultFromSnapshot, type Choice } from './hostConnect'

setLang('ko')
const { createHostServer } = hostServerMod as { createHostServer(d: unknown): any }
const { openHost } = hostStoreMod as { openHost(dir: string, o?: unknown): any }
const { makeTls } = shareMod as { makeTls(): Promise<{ key: string; cert: string; fp: string }> }

function nodePinned(r: PinnedReq): Promise<PinnedRes> {
  return new Promise((resolve, reject) => {
    const u = new URL(r.url)
    const req = https.request(
      { host: u.hostname, port: u.port, path: u.pathname, method: r.method, headers: { ...r.headers, Connection: 'close' }, rejectUnauthorized: false, timeout: r.timeoutMs ?? 30000, agent: new https.Agent({ maxCachedSessions: 0 }) },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), fp: r.pin }))
      },
    )
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
let host: any
let server: any
let port = 0
let clock = 1_700_000_000_000
let beforeRequest: ((path: string) => void) | null = null
const mem = new Map<string, string>()
const memBackend: SnapshotBackend = {
  write: async (id, json) => { if (failSnapshot) throw new Error('disk full'); mem.set(id, json) },
  read: async (id) => mem.get(id) ?? null,
  list: async () => [...mem.keys()],
  remove: async (id) => { mem.delete(id) },
}
let failSnapshot = false

beforeAll(async () => {
  tls = await makeTls()
})
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-pchost-'))
  clock = 1_700_000_000_000
  host = openHost(dir, { now: () => clock })
  let saved: unknown = null
  server = createHostServer({ store: { read: () => saved, write: (v: unknown) => { saved = JSON.parse(JSON.stringify(v)) } }, tls, hostName: 'TEST-PC', now: () => clock, getHost: () => host, lanAddresses: () => ['10.9.8.7'] })
  port = await server.listen(0, '127.0.0.1')
  mem.clear()
  failSnapshot = false
  setSnapshotBackend(memBackend)
  beforeRequest = null
  setPinnedTransport((r) => {
    if (beforeRequest) beforeRequest(new URL(r.url).pathname)
    return nodePinned(r)
  })
  localStorage.clear()
  useApp.setState({ files: {}, assets: {}, syncing: false, toast: null, settings: { ...useApp.getState().settings, remote: { kind: 'pchost', name: 'TEST-PC' } as never } })
})
afterEach(async () => {
  await server?.close()
  host?.close()
  setPinnedTransport(null)
  setSnapshotBackend(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

const hf = (rel: string) => path.join(dir, ...rel.split('/'))
const bump = (rel: string) => { const t = new Date(Date.now() + 5000 + Math.floor(Math.random() * 1000)); fs.utimesSync(hf(rel), t, t) }
const note = (p: string, content: string, over: object = {}) => ({ path: p, content, sha: null, dirty: true, mtime: 1, ...over })
const text = (p: string) => useApp.getState().files[p]?.content
const toast = () => useApp.getState().toast ?? ''
const sync = () => useApp.getState().sync()
async function connect(write = false) {
  const code = server.codeNow().value
  const link = await pairHost({ host: '127.0.0.1', hosts: ['127.0.0.1'], port, code, fp: tls.fp }, '내 폰')
  if (write) server.setPerms(link.deviceId, { write: true })
  return link
}

describe('연결 문자열·짝 맺기', () => {
  it('nsh1 문자열을 해석하고, 지문이 없거나 틀린 모양은 거절한다', () => {
    const fp = 'ab'.repeat(32)
    expect(parseHostPairing(`nsh1:192.168.0.10,10.0.0.2:47412:482913:${fp}`)).toEqual({ host: '192.168.0.10', hosts: ['192.168.0.10', '10.0.0.2'], port: 47412, code: '482913', fp })
    for (const bad of ['', `nsf1:10.0.0.2:47412:482913:${fp}`, 'nsh1:10.0.0.2:47412:482913', `nsh1:999.0.0.1:47412:482913:${fp}`, `nsh1:10.0.0.2:80:482913:${fp}`, `nsh1:10.0.0.2:47412:48291:${fp}`]) expect(parseHostPairing(bad), bad).toBeNull()
  })
  it('QR 의 지문으로 짝을 맺고 저장한다(기본 읽기 전용). 지문이 다르면 코드를 보내지 않는다', async () => {
    const link = await connect()
    expect(link).toMatchObject({ host: '127.0.0.1', port, fp: tls.fp, name: 'TEST-PC' })
    expect(loadPcHost()).toEqual(link)
    expect(server.state().devices[0].perms).toEqual({ write: false, delete: false })
    forgetPcHost()
    const wrong = await pairHost({ host: '127.0.0.1', hosts: ['127.0.0.1'], port, code: server.codeNow().value, fp: '0'.repeat(64) }, 'x').catch((e) => e)
    expect(String(wrong.message)).toContain('인증서가 연결할 때와 달라요')
    expect(server.state().devices).toHaveLength(1) // 두 번째 짝 맺기 요청은 서버에 닿지 않았다
    expect(loadPcHost()).toBeNull()
  })
  it('PC 에 닿지 않으면 같은 와이파이·PC 앱 확인을 안내한다', async () => {
    const e = await pairHost({ host: '127.0.0.1', hosts: ['127.0.0.1'], port: 1, code: '123456', fp: tls.fp }, 'x').catch((x) => x)
    expect(String(e.message)).toContain('PC에 연결하지 못했어요')
  })
})

describe('주소 재탐색(IP 는 힌트, 기기 식별은 기기 ID·인증서 지문)', () => {
  it('마지막 주소가 안 되면 다른 후보를 시도하고, 성공한 주소를 기억한다', async () => {
    const l = await connect()
    const stale: PcHostLink = { ...l, host: '127.0.0.2', hosts: ['127.0.0.2', '127.0.0.1'] } // 127.0.0.2 는 서버가 듣지 않는 주소
    savePcHost(stale)
    const r = await callHost(stale, '/ping', {}, 8000)
    expect(r.name).toBe('TEST-PC')
    expect(loadPcHost()?.host).toBe('127.0.0.1')
  })
  it('핑이 PC 의 현재 주소 목록을 알려 주면 후보를 갱신한다', async () => {
    const l = await connect()
    const p = await pingHost(l)
    expect(p.ips).toEqual(['10.9.8.7'])
    expect(loadPcHost()?.hosts).toEqual(['127.0.0.1', '10.9.8.7'])
    expect(p.perms.write).toBe(false)
  })
  it('지문이 다른 서버로는(주소를 바꿔도) 자동으로 다시 연결하지 않는다', async () => {
    const l = await connect()
    const e = await callHost({ ...l, fp: '1'.repeat(64) }, '/ping', {}).catch((x) => x)
    expect(e.code).toBe('pin')
    expect(String(e.message)).toContain('인증서가 연결할 때와 달라요')
  })
})

describe('동기화: 이 휴대폰에 쓰기가 허용되지 않았을 때(기본)', () => {
  it('받기는 하고, 내 변경은 올리지 않고 안내하며 그대로 남긴다. 허용되면 다음 동기화에서 올라간다', async () => {
    host.put('pc노트.md', '# PC 에서 만든 노트\n', null)
    await connect()
    useApp.setState({ files: { '폰노트.md': note('폰노트.md', '# 폰에서 만든 노트\n') } })
    await sync()
    expect(text('pc노트.md')).toBe('# PC 에서 만든 노트\n') // 받기는 됐다
    expect(toast()).toContain('받기만 했어요')
    expect(useApp.getState().files['폰노트.md'].dirty).toBe(true) // 내 변경은 그대로
    expect(fs.existsSync(hf('폰노트.md'))).toBe(false) // 호스트는 바뀌지 않았다
    server.setPerms(loadPcHost()!.deviceId, { write: true }) // PC 에서 허용
    await sync()
    expect(fs.readFileSync(hf('폰노트.md'), 'utf8')).toBe('# 폰에서 만든 노트\n')
    expect(useApp.getState().files['폰노트.md'].dirty).toBe(false)
  })
})

describe('동기화: 쓰기가 허용된 폰', () => {
  it('새 노트는 PC 폴더에 평범한 파일로 올라가고, 고치면 같은 파일이 갱신된다', async () => {
    await connect(true)
    useApp.setState({ files: { '프로젝트/개요.md': note('프로젝트/개요.md', '# 개요\n') } })
    await sync()
    expect(fs.readFileSync(hf('프로젝트/개요.md'), 'utf8')).toBe('# 개요\n')
    expect(useApp.getState().files['프로젝트/개요.md'].dirty).toBe(false)
    useApp.getState().setContent('프로젝트/개요.md', '# 개요\n수정\n')
    await sync()
    expect(fs.readFileSync(hf('프로젝트/개요.md'), 'utf8')).toBe('# 개요\n수정\n')
    const m = JSON.parse(fs.readFileSync(path.join(dir, '.nosidian', 'manifest.json'), 'utf8'))
    expect(m.files['프로젝트/개요.md'].by).toMatch(/^device:/) // 누가 썼는지 남는다
  })

  it('PC 에서 탐색기로 고친 파일은 다음 동기화 때 폰으로 들어온다', async () => {
    await connect(true)
    useApp.setState({ files: { 'a.md': note('a.md', 'v1\n') } })
    await sync()
    fs.writeFileSync(hf('a.md'), 'edited on PC\n')
    bump('a.md')
    await sync()
    expect(text('a.md')).toBe('edited on PC\n')
  })

  it('폰과 PC 에서 다른 줄을 고치면 자동으로 합쳐 올린다. 같은 줄이면 충돌로 남기고 PC 파일은 덮어쓰지 않는다', async () => {
    await connect(true)
    const base = ['# 할 일', '', '- [ ] 하나', '- [ ] 둘', '- [ ] 셋', ''].join('\n')
    useApp.setState({ files: { 't.md': note('t.md', base) } })
    await sync()
    useApp.getState().setContent('t.md', base.replace('- [ ] 하나', '- [x] 하나'))
    fs.writeFileSync(hf('t.md'), base.replace('- [ ] 셋', '- [x] 셋'))
    bump('t.md')
    await sync()
    const merged = fs.readFileSync(hf('t.md'), 'utf8')
    expect(merged).toContain('- [x] 하나')
    expect(merged).toContain('- [x] 셋')
    useApp.getState().setContent('t.md', merged.replace('- [ ] 둘', '- [ ] 둘 (폰)'))
    fs.writeFileSync(hf('t.md'), merged.replace('- [ ] 둘', '- [ ] 둘 (PC)'))
    bump('t.md')
    await sync()
    expect(useApp.getState().files['t.md'].conflict).toBeTruthy()
    expect(fs.readFileSync(hf('t.md'), 'utf8')).toContain('(PC)')
    expect(fs.readFileSync(hf('t.md'), 'utf8')).not.toContain('(폰)')
  })

  it('올리는 사이 PC 에서 먼저 고쳐도(409) 한 번 다시 받아 합친 뒤 올린다 — 어느 쪽 변경도 잃지 않는다', async () => {
    await connect(true)
    const base = ['# 제목', '', '- a', '- b', '- c', ''].join('\n')
    useApp.setState({ files: { 'r.md': note('r.md', base) } })
    await sync()
    useApp.getState().setContent('r.md', base.replace('- a', '- A!'))
    let done = false
    beforeRequest = (p) => {
      if (p === '/put' && !done) {
        done = true
        fs.writeFileSync(hf('r.md'), base.replace('- c', '- C!'))
        bump('r.md')
      }
    }
    await sync()
    const disk = fs.readFileSync(hf('r.md'), 'utf8')
    expect(disk).toContain('- A!')
    expect(disk).toContain('- C!')
  })

  it('폰에서 지운 파일은 PC 로 전파되지 않고(삭제 권한이 꺼져 있다) 그 사실을 알린다. 다음 동기화에서 다시 받아진다', async () => {
    await connect(true)
    useApp.setState({ files: { 'x.md': note('x.md', 'x\n') } })
    await sync()
    useApp.getState().deleteNote('x.md', { silent: true })
    await sync()
    expect(fs.existsSync(hf('x.md'))).toBe(true) // PC 파일은 그대로
    expect(toast()).toContain('삭제를 허용하지 않아서')
    await sync()
    expect(text('x.md')).toBe('x\n') // 다시 받아졌다(데이터를 잃지 않는다)
  })

  it('PC 에서 지운 파일: 폰에 깨끗한 사본이 있으면 폰에서도 사라지고(되살리지 않는다), 폰에서 고치던 파일은 살려서 다시 올린다', async () => {
    await connect(true)
    useApp.setState({ files: { 'clean.md': note('clean.md', 'c\n'), 'edit.md': note('edit.md', 'e\n') } })
    await sync()
    host.del('clean.md', host.list().entries.find((e: { path: string }) => e.path === 'clean.md').rev)
    host.del('edit.md', host.list().entries.find((e: { path: string }) => e.path === 'edit.md').rev)
    useApp.getState().setContent('edit.md', 'e\n폰에서 고침\n')
    await sync()
    expect(useApp.getState().files['clean.md']).toBeUndefined()
    expect(fs.existsSync(hf('clean.md'))).toBe(false) // 오래된 사본이 파일을 되살리지 못했다
    expect(text('edit.md')).toBe('e\n폰에서 고침\n')
    expect(fs.readFileSync(hf('edit.md'), 'utf8')).toBe('e\n폰에서 고침\n') // 고친 쪽(수정)을 살렸다
  })

  it('실행 파일은 올릴 수 없고 이유를 알려 준다(폴더에도 남지 않는다)', async () => {
    await connect(true)
    await sync() // 목록·권한 확인
    const r = await uploadOthers([new File([new Uint8Array([1, 2, 3])], 'tool.exe'), new File([new Uint8Array([1, 2, 3])], 'data.csv')], '')
    expect(r.done).toEqual(['data.csv'])
    expect(r.failed[0]).toMatchObject({ name: 'tool.exe' })
    expect(r.failed[0].why).toContain('실행 파일')
    expect(fs.existsSync(hf('tool.exe'))).toBe(false)
  })

  it('동기화가 끝나면 이 휴대폰이 여기까지 반영했다는 확인(ack)을 남긴다', async () => {
    host.put('a.md', 'a\n', null)
    await connect()
    await sync()
    const m = JSON.parse(fs.readFileSync(path.join(dir, '.nosidian', 'manifest.json'), 'utf8'))
    expect(m.devices[loadPcHost()!.deviceId].ackSeq).toBe(m.seq)
  })
})

describe('연결 문제: PC 꺼짐·해제·지문 변경에도 폰의 데이터는 안전하다', () => {
  it('PC 가 꺼져 있으면(오프라인) 실패로 알리지만 폰의 변경은 그대로 남고, 켜지면 올라간다', async () => {
    await connect(true)
    useApp.setState({ files: { 'o.md': note('o.md', 'offline edit\n') } })
    await server.close() // PC 앱이 꺼졌다
    await sync()
    expect(toast()).toContain('PC에 연결하지 못했어요')
    expect(text('o.md')).toBe('offline edit\n')
    expect(useApp.getState().files['o.md'].dirty).toBe(true)
    await server.listen(port, '127.0.0.1') // 다시 켜졌다(같은 포트)
    await sync()
    expect(fs.readFileSync(hf('o.md'), 'utf8')).toBe('offline edit\n')
  })
  it('PC 에서 기기를 해제하면 알려 주고 폰의 노트는 그대로다', async () => {
    const l = await connect(true)
    useApp.setState({ files: { 'k.md': note('k.md', 'keep\n') } })
    server.revoke(l.deviceId)
    await sync()
    expect(toast()).toContain('연결이 해제됐어요')
    expect(text('k.md')).toBe('keep\n')
  })
  it('PC 인증서가 바뀌면(지문 불일치) 자동 재연결 없이 알리고 폰의 노트는 그대로다', async () => {
    const l = await connect(true)
    useApp.setState({ files: { 'k.md': note('k.md', 'keep\n') } })
    savePcHost({ ...l, fp: '2'.repeat(64) })
    await sync()
    expect(toast()).toContain('인증서가 연결할 때와 달라요')
    expect(text('k.md')).toBe('keep\n')
  })
  it('오류 문장: 권한·실행 파일·공간·해제', () => {
    expect(hostErrorText(403, 'noWrite', '')).toContain('쓰기를 허용')
    expect(hostErrorText(403, 'executable', '')).toContain('실행 파일')
    expect(hostErrorText(507, 'noSpace', '')).toContain('저장 공간')
    expect(hostErrorText(401, undefined, '')).toContain('해제')
  })
})

describe('최초 연결(폰): 미리보기 → 승인 → 스냅샷 → 반영', () => {
  async function bothSides() {
    useApp.setState({ files: { 'pc에없음.md': note('pc에없음.md', '폰에만 있어요\n', { dirty: false }), '같음.md': note('같음.md', '똑같아요\n', { dirty: false }), '다름.md': note('다름.md', '폰 버전\n', { dirty: false }), '다름2.md': note('다름2.md', '폰 버전 2\n', { dirty: false }) } })
    host.put('호스트만.md', '호스트에만 있어요\n', null)
    host.put('같음.md', '똑같아요\n', null)
    host.put('다름.md', 'PC 버전\n', null)
    host.put('다름2.md', 'PC 버전 2\n', null)
    fs.mkdirSync(hf('자료'), { recursive: true })
    fs.writeFileSync(hf('자료/r.docx'), Buffer.from([1, 2, 3, 4]))
    host.scan()
  }
  const cfg = { kind: 'pchost' as const, name: 'TEST-PC' }

  it('미리보기는 읽기만 한다(호스트·폰·연결 설정이 그대로, 스냅샷도 없음)', async () => {
    await bothSides()
    const link = await connect(true)
    const io = phoneHostIO(link, true)
    const before = JSON.stringify(useApp.getState().files)
    const plan = await previewHostConnect(io)
    expect(plan).toMatchObject({ pcOnly: ['pc에없음.md'], hostOnly: ['호스트만.md'], same: ['같음.md'], differ: ['다름.md', '다름2.md'], hostOther: ['자료/r.docx'] })
    expect(JSON.stringify(useApp.getState().files)).toBe(before)
    expect(host.snapshots()).toEqual([])
    expect(mem.size).toBe(0)
    expect(fs.existsSync(hf('pc에없음.md'))).toBe(false)
  })

  it('쓰기가 허용된 폰: 고른 대로 반영하고 삭제는 없으며, PC 호스트 폴더와 폰 양쪽에 스냅샷이 남는다', async () => {
    await bothSides()
    const link = await connect(true)
    const io = phoneHostIO(link, true)
    const plan = await previewHostConnect(io)
    const choices: Record<string, Choice> = { '다름.md': 'pc', '다름2.md': 'host' }
    const res = await applyHostConnect(plan, choices, cfg, io)
    expect(fs.readFileSync(hf('pc에없음.md'), 'utf8')).toBe('폰에만 있어요\n') // 올렸다
    expect(fs.readFileSync(hf('다름.md'), 'utf8')).toBe('폰 버전\n') // 폰 것으로
    expect(text('다름2.md')).toBe('PC 버전 2\n') // 호스트 것으로
    expect(text('호스트만.md')).toBe('호스트에만 있어요\n') // 받았다
    expect(useApp.getState().assets['자료/r.docx']).toMatchObject({ size: 4 })
    expect(useApp.getState().settings.remote).toEqual(cfg)
    expect(Object.values(useApp.getState().files).every((f) => !f.dirty)).toBe(true)
    // 스냅샷: 호스트 폴더(PC)와 폰
    expect(host.snapshots()).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, '.nosidian', 'snapshots', host.snapshots()[0].id, 'files', '다름.md'), 'utf8')).toBe('PC 버전\n') // 덮어쓰기 전 PC 원본
    const phoneSnap = (await listVaultSnapshots())[0]
    expect(phoneSnap.count).toBe(4)
    expect(res.snapshotId).toBe(phoneSnap.id)
    // 삭제는 없다
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.nosidian', 'manifest.json'), 'utf8')).tombs).toEqual({})
    // 이어지는 동기화는 할 일이 없다
    const seq = host.info().seq
    await sync()
    expect(host.info().seq).toBe(seq)
  })

  it('쓰기가 허용되지 않은 폰: 받기는 하고, 올릴 노트는 "올리기 대기"로 남기며, "PC 것으로 올리기"는 고를 수 없다. PC 에는 아무것도 쓰지 않는다', async () => {
    await bothSides()
    const link = await connect(false)
    const io = phoneHostIO(link, false)
    const plan = await previewHostConnect(io)
    await expect(applyHostConnect(plan, { '다름.md': 'pc', '다름2.md': 'host' }, cfg, io)).rejects.toThrow('쓰기를 허용해야')
    expect(useApp.getState().settings.remote).toMatchObject({ kind: 'pchost', name: 'TEST-PC' }) // (연결 전 상태 그대로: beforeEach 의 기본값)
    const hostBefore = JSON.stringify(host.list().entries)
    const res = await applyHostConnect(plan, { '다름.md': 'host', '다름2.md': 'host' }, cfg, io)
    expect(res.pendingUpload).toBe(1)
    expect(JSON.stringify(host.list().entries)).toBe(hostBefore) // PC 폴더는 그대로
    expect(host.snapshots()).toEqual([]) // 호스트에는 쓰지 않았으므로 PC 스냅샷은 만들지 않는다(폰 스냅샷만)
    expect((await listVaultSnapshots()).length).toBe(1)
    const f = useApp.getState().files['pc에없음.md']
    expect(f).toMatchObject({ dirty: true, sha: null }) // 허용되면 올라갈 대기 상태
    expect(text('다름.md')).toBe('PC 버전\n')
    server.setPerms(link.deviceId, { write: true })
    await sync()
    expect(fs.readFileSync(hf('pc에없음.md'), 'utf8')).toBe('폰에만 있어요\n')
  })

  it('스냅샷을 만들 수 없으면(폰 저장 실패·PC 공간 부족) 시작하지 않는다 — 아무것도 바뀌지 않는다', async () => {
    await bothSides()
    const link = await connect(true)
    const plan = await previewHostConnect(phoneHostIO(link, true))
    const filesBefore = JSON.stringify(useApp.getState().files)
    const hostBefore = JSON.stringify(host.list().entries)
    failSnapshot = true // 폰의 저장 공간 부족
    await expect(applyHostConnect(plan, { '다름.md': 'pc', '다름2.md': 'host' }, cfg, phoneHostIO(link, true))).rejects.toThrow('snapshot failed')
    failSnapshot = false
    expect(JSON.stringify(useApp.getState().files)).toBe(filesBefore)
    expect(JSON.stringify(host.list().entries)).toBe(hostBefore)
    // PC 의 공간 부족
    await server.close()
    let saved: unknown = null
    server = createHostServer({ store: { read: () => saved, write: (v: unknown) => { saved = JSON.parse(JSON.stringify(v)) } }, tls, hostName: 'TEST-PC', now: () => clock, getHost: () => host, freeBytes: () => 10 * 1024 * 1024 })
    port = await server.listen(0, '127.0.0.1')
    forgetPcHost()
    const link2 = await connect(true)
    await expect(applyHostConnect(plan, { '다름.md': 'pc', '다름2.md': 'host' }, cfg, phoneHostIO(link2, true))).rejects.toThrow()
    expect(JSON.stringify(useApp.getState().files)).toBe(filesBefore)
    expect(mem.size).toBe(0) // 폰 스냅샷도 만들지 않았다(PC 스냅샷이 먼저 실패)
  })

  it('되돌리기: 스냅샷으로 폰의 노트를 복원하고, 연결을 끊으면 노트는 그대로이며 연결 정보(토큰)가 지워진다', async () => {
    await bothSides()
    const link = await connect(true)
    const io = phoneHostIO(link, true)
    const res = await applyHostConnect(await previewHostConnect(io), { '다름.md': 'host', '다름2.md': 'host' }, cfg, io)
    expect(text('다름.md')).toBe('PC 버전\n')
    const n = await restoreVaultFromSnapshot(res.snapshotId, io)
    expect(n).toBeGreaterThanOrEqual(2)
    expect(text('다름.md')).toBe('폰 버전\n')
    expect(text('호스트만.md')).toBe('호스트에만 있어요\n') // 그 뒤에 받은 노트는 지우지 않는다
    leaveHost()
    expect(useApp.getState().settings.remote).toBeNull()
    expect(loadPcHost()).toBeNull()
    expect(Object.keys(useApp.getState().files).length).toBeGreaterThanOrEqual(5)
  })

  it('planHostConnect 는 호스트에서 지워졌던 경로에 폰이 가진 노트를 "되살아남"으로 알린다', async () => {
    host.put('gone.md', 'x', null)
    host.del('gone.md', host.list().entries[0].rev)
    useApp.setState({ files: { 'gone.md': note('gone.md', '폰 사본\n', { dirty: false }) } })
    const link = await connect(true)
    const plan = await planHostConnect(useApp.getState().files, await phoneHostIO(link, true).list())
    expect(plan.pcOnly).toEqual(['gone.md'])
    expect(plan.revived).toEqual(['gone.md'])
  })
})

describe('폰에서 해제하면 PC 의 목록에서도 빠진다 (5-c)', () => {
  it('unpairHost: PC 의 호스트 기기 목록에서 빠지고 그 토큰은 더 쓸 수 없다', async () => {
    const link = await connect()
    expect(server.state().devices).toHaveLength(1)
    expect(await unpairHost(link)).toBe(true)
    expect(server.state().devices).toHaveLength(0)
    await expect(callHost(link, '/list', {})).rejects.toBeTruthy()
  })
  it('닿지 않는 PC 면 false(폰의 연결은 호출한 쪽이 끊는다)', async () => {
    const link = await connect()
    expect(await unpairHost({ ...link, host: '127.0.0.1', hosts: ['127.0.0.1'], port: 1 })).toBe(false)
  })
})

describe('바이너리 파일 충돌: 새 이름으로 보관 / PC 것 유지 / 덮어쓰기 (2번)', () => {
  const REL = '자료/r.docx'
  const bytesOf = (rel: string) => [...fs.readFileSync(hf(rel))]
  const revOf = (rel: string) => host.list().entries.find((e: { path: string }) => e.path === rel).rev as string
  /** 선택·확인 창이 뜨기를 기다렸다가 답한다(창이 뜬 순간의 제목·선택지를 돌려준다) */
  const answer = async (kind: 'choice' | 'confirm', v: string | boolean | null) => {
    for (let i = 0; i < 400 && useDialog.getState().kind !== kind; i++) await new Promise((r) => setTimeout(r, 5))
    const d = useDialog.getState()
    expect(d.kind).toBe(kind)
    const seen = { plain: d.plain === true, title: d.title, message: d.message ?? '', labels: (d.choices ?? []).map((c) => c.label), values: (d.choices ?? []).map((c) => c.value) }
    d.resolve?.(v)
    useDialog.setState({ kind: null })
    return seen
  }
  const setup = async () => {
    host.put(REL, Buffer.from([1, 2, 3, 4]), null)
    await connect(true)
    await sync() // 폰이 PC 의 rev 를 안다
    host.put(REL, Buffer.from([7, 7]), revOf(REL)) // 그 뒤 PC 에서 먼저 고쳤다
  }
  const mine = () => new File([new Uint8Array([9, 9, 9, 9, 9])], 'r.docx')

  it('PC 에서 아무도 안 바꿨으면 새 버전으로 바꾸기가 그냥 성공한다(예전: baseRev 없이 보내 항상 409 였다)', async () => {
    host.put(REL, Buffer.from([1, 2, 3, 4]), null)
    await connect(true)
    await sync()
    const r = await replaceOther(REL, mine())
    expect(r).toEqual({ outcome: 'replaced', path: REL })
    expect(bytesOf(REL)).toEqual([9, 9, 9, 9, 9])
    expect(useDialog.getState().kind).toBeNull() // 묻지 않았다
  })
  it('PC 에서 먼저 바뀌었으면 선택 창이 뜬다 — 세 선택지, 기본 선택 없음, 창이 뜨는 동안 아무것도 바뀌지 않는다', async () => {
    await setup()
    const p = replaceOther(REL, mine())
    const seen = await answer('choice', null) // 창을 닫는다
    expect(seen.values).toEqual(['rename', 'keep', 'overwrite'])
    expect(seen.plain).toBe(true) // 기본 선택이 없다 — 어느 것도 강조하지 않는다
    expect(seen.title).toContain('r.docx')
    expect(seen.title).toContain('먼저 바뀌었어요')
    expect(bytesOf(REL)).toEqual([7, 7]) // 고르기 전에는 PC 것 그대로
    expect((await p).outcome).toBe('kept') // 닫으면 아무것도 바꾸지 않는다
    expect(bytesOf(REL)).toEqual([7, 7])
  })
  it('PC 것을 그대로 두기: PC 파일은 그대로이고, 이 폰의 목록은 PC 의 현재 rev 로 맞춰진다', async () => {
    await setup()
    const p = replaceOther(REL, mine())
    await answer('choice', 'keep')
    expect(await p).toEqual({ outcome: 'kept', path: REL })
    expect(bytesOf(REL)).toEqual([7, 7])
    expect(useApp.getState().assets[REL]?.sha).toBe(revOf(REL))
    expect(fs.existsSync(hf('자료/r (내 것).docx'))).toBe(false)
  })
  it('내 것을 새 이름으로 보관: PC 파일은 그대로, 내 파일은 `이름 (내 것).확장자` 로 올라간다', async () => {
    await setup()
    const p = replaceOther(REL, mine())
    await answer('choice', 'rename')
    const r = await p
    expect(r).toEqual({ outcome: 'renamed', path: '자료/r (내 것).docx' })
    expect(bytesOf(REL)).toEqual([7, 7]) // PC 것은 건드리지 않았다
    expect(bytesOf('자료/r (내 것).docx')).toEqual([9, 9, 9, 9, 9])
    expect(useApp.getState().assets['자료/r (내 것).docx']).toBeTruthy()
  })
  it('내 것으로 덮어쓰기: 한 번 더 확인하고, 확인하면 PC 파일이 내 것으로 바뀐다', async () => {
    await setup()
    const p = replaceOther(REL, mine())
    await answer('choice', 'overwrite')
    const c = await answer('confirm', true)
    expect(c.title).toContain('덮어쓸까요')
    expect(await p).toEqual({ outcome: 'replaced', path: REL })
    expect(bytesOf(REL)).toEqual([9, 9, 9, 9, 9])
  })
  it('덮어쓰기를 골랐다가 확인에서 취소하면 아무것도 바뀌지 않는다', async () => {
    await setup()
    const p = replaceOther(REL, mine())
    await answer('choice', 'overwrite')
    await answer('confirm', false)
    expect((await p).outcome).toBe('kept')
    expect(bytesOf(REL)).toEqual([7, 7])
  })
  it('PC 에서 지워졌으면: 문구가 달라지고(다시 올리기), 고르기 전에는 되살아나지 않는다', async () => {
    host.put(REL, Buffer.from([1, 2, 3, 4]), null)
    await connect(true)
    await sync()
    host.del(REL, revOf(REL)) // PC 에서 지웠다
    const p = replaceOther(REL, mine())
    const seen = await answer('choice', null)
    expect(seen.title).toContain('지워졌어요')
    expect(seen.labels).toContain('내 것을 다시 올리기')
    expect((await p).outcome).toBe('kept')
    expect(fs.existsSync(hf(REL))).toBe(false) // 고르기 전에는 되살아나지 않았다
  })
  it('PC 에서 지워진 파일을 "다시 올리기"로 고르면 확인 뒤 되살아난다', async () => {
    host.put(REL, Buffer.from([1, 2, 3, 4]), null)
    await connect(true)
    await sync()
    host.del(REL, revOf(REL))
    const p = replaceOther(REL, mine())
    await answer('choice', 'overwrite')
    const c = await answer('confirm', true)
    expect(c.title).toContain('다시 올릴까요')
    expect((await p).outcome).toBe('replaced')
    expect(bytesOf(REL)).toEqual([9, 9, 9, 9, 9])
  })
  it('같은 이름의 파일이 PC 에만 새로 생겼으면: 올리기(uploadOthers)도 묻고, 새 이름으로 올릴 수 있다', async () => {
    await connect(true)
    await sync() // PC 가 비어 있다고 알고 있다
    host.put('새자료.pdf', Buffer.from([5, 5]), null) // 그 뒤 PC 에 같은 이름이 생겼다
    const p = uploadOthers([new File([new Uint8Array([6, 6, 6])], '새자료.pdf')], '')
    const seen = await answer('choice', 'rename')
    expect(seen.title).toContain('같은 이름의 파일이 이미 있어요') // 바뀐 게 아니라 이미 있다
    const r = await p
    expect(r.done).toEqual(['새자료 (내 것).pdf'])
    expect(r.kept).toEqual([])
    expect(bytesOf('새자료.pdf')).toEqual([5, 5])
    expect(bytesOf('새자료 (내 것).pdf')).toEqual([6, 6, 6])
  })
  it('올리기에서 PC 것 유지를 고르면 올리지 않고 kept 로 알린다', async () => {
    await connect(true)
    await sync()
    host.put('새자료.pdf', Buffer.from([5, 5]), null)
    const p = uploadOthers([new File([new Uint8Array([6, 6, 6])], '새자료.pdf')], '')
    await answer('choice', 'keep')
    const r = await p
    expect(r).toMatchObject({ done: [], kept: ['새자료.pdf'], failed: [] })
    expect(bytesOf('새자료.pdf')).toEqual([5, 5])
  })
})

describe('충돌 정보와 새 이름', () => {
  it('conflictOf: 호스트의 409 conflict·case 만 충돌로 본다(클라우드의 409·422 처럼 code 가 없는 오류는 아니다)', () => {
    expect(conflictOf(Object.assign(new Error('x'), { status: 409, code: 'conflict', currentRev: 'r2', deleted: false }))).toEqual({ code: 'conflict', currentRev: 'r2', deleted: false })
    expect(conflictOf(Object.assign(new Error('x'), { status: 409, code: 'conflict', currentRev: 'tomb', deleted: true }))?.deleted).toBe(true)
    expect(conflictOf(Object.assign(new Error('x'), { status: 409, code: 'case' }))).toEqual({ code: 'case', currentRev: null, deleted: false })
    expect(conflictOf(Object.assign(new Error('x'), { status: 409 }))).toBeNull()
    expect(conflictOf(Object.assign(new Error('x'), { status: 422 }))).toBeNull()
    expect(conflictOf(Object.assign(new Error('x'), { status: 403, code: 'noWrite' }))).toBeNull()
    expect(conflictOf(null)).toBeNull()
  })
  it('conflictCopyPath: 확장자 앞에 (내 것), 겹치면 (2)…, 폴더·확장자 없는 이름도 된다', () => {
    expect(conflictCopyPath('자료/r.docx', new Set())).toBe('자료/r (내 것).docx')
    expect(conflictCopyPath('자료/r.docx', new Set(['자료/r (내 것).docx']))).toBe('자료/r (내 것) (2).docx')
    expect(conflictCopyPath('r.tar.gz', new Set())).toBe('r.tar (내 것).gz')
    expect(conflictCopyPath('Makefile', new Set())).toBe('Makefile (내 것)')
    expect(conflictCopyPath('a.zip', new Set(), '202611121530')).toBe('a (내 것 202611121530).zip')
  })
})
