// 최초 연결(미리보기 → 승인 → 스냅샷 → 반영) 시험. 실제 IPC·호스트 저장 계층을 거친다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import hostIpc from '../../electron/hostIpc.cjs'
import { useApp } from './app'
import { setLang } from './i18n'
import { applyHostConnect as applyConnect, leaveHost, pcFolderIO, planHostConnect, previewHostConnect as previewConnect, restoreVaultFromSnapshot as restoreSnap, type Choice, type ConnectPlan } from './hostConnect'

setLang('ko')
const { register } = hostIpc as { register(h: unknown): unknown }
type Handler = (e: unknown, ...a: unknown[]) => Promise<Record<string, unknown>>
const handlers = new Map<string, Handler>()
let userData: string
let dir: string
let override: Partial<Record<string, (...a: unknown[]) => Promise<Record<string, unknown>>>> = {}

function install() {
  handlers.clear()
  register({ ipcMain: { handle: (n: string, h: Handler) => handlers.set(n, h) }, app: { getPath: (n: string) => (n === 'userData' ? userData : os.homedir()), on: () => {} }, dialog: {}, BrowserWindow: { getFocusedWindow: () => null } })
  const call = (n: string) => (...a: unknown[]) => (override[n] ? override[n]!(...a) : handlers.get(n)!({}, ...a))
  ;(window as unknown as { amsidianDesktop: unknown }).amsidianDesktop = {
    host: { status: call('host:status'), list: call('host:list'), read: call('host:read'), push: call('host:push'), ack: call('host:ack'), snapshot: call('host:snapshot'), snapshots: call('host:snapshots'), snapshotVault: call('host:snapshotVault'), clear: call('host:clear'), pickDir: call('host:pickDir'), gc: call('host:gc') },
  }
}
// (PC 앱의 폴더 연결: IPC 로 호스트 저장 계층을 부른다)
const previewHostConnect = () => previewConnect(pcFolderIO())
const applyHostConnect = (plan: ConnectPlan, choices: Record<string, Choice>, dir: string) => applyConnect(plan, choices, { kind: 'host', dir }, pcFolderIO())
const restoreVaultFromSnapshot = (id: string) => restoreSnap(id, pcFolderIO())
const hf = (rel: string) => path.join(dir, ...rel.split('/'))
const hostWrite = (rel: string, data: string | Buffer) => {
  fs.mkdirSync(path.dirname(hf(rel)), { recursive: true })
  fs.writeFileSync(hf(rel), data)
}
const note = (p: string, content: string, over: object = {}) => ({ path: p, content, sha: null, dirty: false, mtime: 1, ...over })
const manifest = () => JSON.parse(fs.readFileSync(path.join(dir, '.nosidian', 'manifest.json'), 'utf8'))
const listing = (root: string): string[] => {
  const out: string[] = []
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.nosidian') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(d, e.name), r)
      else out.push(r + ':' + fs.readFileSync(path.join(d, e.name)).length)
    }
  }
  walk(root, '')
  return out.sort()
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-ud-'))
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-conn-'))
  fs.writeFileSync(path.join(userData, 'host.json'), JSON.stringify({ dir }))
  override = {}
  install()
  useApp.setState({ files: {}, assets: {}, syncing: false, settings: { ...useApp.getState().settings, remote: null } })
})
afterEach(() => {
  ;(window as unknown as { amsidianDesktop?: unknown }).amsidianDesktop = undefined
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(dir, { recursive: true, force: true })
})

/** PC 앱 Vault 와 호스트 폴더 양쪽에 데이터가 있는 상황 */
function bothSides() {
  useApp.setState({
    files: {
      'pc만.md': note('pc만.md', 'PC 에만 있어요\n'),
      '같음.md': note('같음.md', '똑같은 내용\n'),
      '다름.md': note('다름.md', 'PC 버전\n'),
      '다름2.md': note('다름2.md', 'PC 버전 2\n'),
      '다름3.md': note('다름3.md', 'PC 버전 3\n'),
    },
  })
  hostWrite('호스트만.md', '호스트에만 있어요\n')
  hostWrite('같음.md', '똑같은 내용\n')
  hostWrite('다름.md', '호스트 버전\n')
  hostWrite('다름2.md', '호스트 버전 2\n')
  hostWrite('다름3.md', '호스트 버전 3\n')
  hostWrite('자료/report.docx', Buffer.from([1, 2, 3, 4, 5, 6]))
}

describe('미리보기(계획): 읽기만 한다', () => {
  it('양쪽을 비교해 PC 에만·호스트에만·같음·다름을 가른다(내용 해시로 비교)', async () => {
    bothSides()
    const plan = await previewHostConnect()
    expect(plan.pcOnly).toEqual(['pc만.md'])
    expect(plan.hostOnly).toEqual(['호스트만.md'])
    expect(plan.hostOther).toEqual(['자료/report.docx'])
    expect(plan.same).toEqual(['같음.md'])
    expect(plan.differ).toEqual(['다름.md', '다름2.md', '다름3.md'])
    expect(plan.revived).toEqual([])
  })
  it('계획을 만드는 동안 호스트 폴더 파일·PC 앱 노트·연결 설정은 아무것도 바뀌지 않는다(스냅샷도 만들지 않는다)', async () => {
    bothSides()
    const hostBefore = listing(dir)
    const localBefore = JSON.stringify(useApp.getState().files)
    await previewHostConnect()
    await previewHostConnect()
    expect(listing(dir)).toEqual(hostBefore)
    expect(JSON.stringify(useApp.getState().files)).toBe(localBefore)
    expect(useApp.getState().settings.remote).toBeNull()
    expect(fs.existsSync(path.join(dir, '.nosidian', 'snapshots'))).toBe(false)
  })
  it('호스트에서 지워졌던 경로에 PC 가 노트를 가지고 있으면 "되살아남"으로 알린다', async () => {
    useApp.setState({ files: { '지워진.md': note('지워진.md', 'PC 사본\n') } })
    hostWrite('지워진.md', 'x')
    await handlers.get('host:list')!({})
    const l = (await handlers.get('host:list')!({})) as unknown as { entries: { rev: string }[] }
    await handlers.get('host:push')!({}, [{ path: '지워진.md', del: true, baseRev: l.entries[0].rev }])
    const plan = await previewHostConnect()
    expect(plan.pcOnly).toEqual(['지워진.md'])
    expect(plan.revived).toEqual(['지워진.md'])
  })
  it('PC 앱에서 지운 노트·노트가 아닌 항목은 비교에 넣지 않는다', async () => {
    useApp.setState({ files: { '지움.md': note('지움.md', 'x', { deleted: true, dirty: true }) } })
    const plan = await planHostConnect(useApp.getState().files, { entries: [], tombs: [] })
    expect(plan.pcOnly).toEqual([])
  })
})

describe('승인 전에는 아무것도 하지 않는다', () => {
  it('내용이 다른 항목을 고르지 않으면 스냅샷도 만들지 않고 아무것도 바꾸지 않는다', async () => {
    bothSides()
    const plan = await previewHostConnect()
    const hostBefore = listing(dir)
    const localBefore = JSON.stringify(useApp.getState().files)
    await expect(applyHostConnect(plan, { '다름.md': 'pc' }, dir)).rejects.toThrow('먼저 골라')
    expect(listing(dir)).toEqual(hostBefore)
    expect(JSON.stringify(useApp.getState().files)).toBe(localBefore)
    expect(fs.existsSync(path.join(dir, '.nosidian', 'snapshots'))).toBe(false)
    expect(useApp.getState().settings.remote).toBeNull()
  })
  it('스냅샷을 만들 수 없으면(공간 부족 등) 동기화를 시작하지 않는다 — 호스트도 PC 앱도 그대로', async () => {
    bothSides()
    const plan = await previewHostConnect()
    override['host:snapshot'] = async () => ({ ok: false, status: 507, code: 'noSpace', error: 'not enough free space' })
    const hostBefore = listing(dir)
    const localBefore = JSON.stringify(useApp.getState().files)
    await expect(applyHostConnect(plan, { '다름.md': 'pc', '다름2.md': 'host', '다름3.md': 'both' }, dir)).rejects.toThrow('not enough free space')
    expect(listing(dir)).toEqual(hostBefore)
    expect(JSON.stringify(useApp.getState().files)).toBe(localBefore)
    expect(useApp.getState().settings.remote).toBeNull()
  })
})

describe('승인 후 반영', () => {
  const choices: Record<string, Choice> = { '다름.md': 'pc', '다름2.md': 'host', '다름3.md': 'both' }

  it('고른 대로 반영하고, 어느 쪽도 지우지 않으며, 스냅샷에 반영 전 PC 노트가 남는다', async () => {
    bothSides()
    const plan = await previewHostConnect()
    const res = await applyHostConnect(plan, choices, dir)
    const files = useApp.getState().files
    // 호스트에만 있던 노트는 받고, PC 에만 있던 노트는 올렸다(둘 다 남아 있다)
    expect(files['호스트만.md'].content).toBe('호스트에만 있어요\n')
    expect(fs.readFileSync(hf('pc만.md'), 'utf8')).toBe('PC 에만 있어요\n')
    // pc 선택: 호스트가 PC 내용으로 / host 선택: PC 가 호스트 내용으로 / both: 호스트 것을 받고 PC 것은 사본으로
    expect(fs.readFileSync(hf('다름.md'), 'utf8')).toBe('PC 버전\n')
    expect(files['다름2.md'].content).toBe('호스트 버전 2\n')
    expect(fs.readFileSync(hf('다름2.md'), 'utf8')).toBe('호스트 버전 2\n')
    expect(files['다름3.md'].content).toBe('호스트 버전 3\n')
    expect(res.copies).toEqual(['다름3 (PC 사본).md'])
    expect(files['다름3 (PC 사본).md'].content).toBe('PC 버전 3\n')
    expect(fs.readFileSync(hf('다름3 (PC 사본).md'), 'utf8')).toBe('PC 버전 3\n')
    // 삭제는 없다: 호스트 파일 수는 줄지 않았고 휴지통·삭제 기록이 비어 있다
    expect(manifest().tombs).toEqual({})
    expect(fs.readdirSync(path.join(dir, '.nosidian', 'trash'))).toEqual([])
    expect(fs.existsSync(hf('자료/report.docx'))).toBe(true)
    expect(useApp.getState().assets['자료/report.docx']).toMatchObject({ size: 6 })
    // 스냅샷: 반영 전의 PC 노트 전체가 들어 있다
    const vault = JSON.parse(fs.readFileSync(path.join(dir, '.nosidian', 'snapshots', res.snapshotId, 'vault-notes.json'), 'utf8'))
    expect(vault['다름2.md']).toBe('PC 버전 2\n')
    expect(Object.keys(vault).sort()).toEqual(['pc만.md', '같음.md', '다름.md', '다름2.md', '다름3.md'])
    expect(fs.readFileSync(path.join(dir, '.nosidian', 'snapshots', res.snapshotId, 'files', '다름2.md'), 'utf8')).toBe('호스트 버전 2\n') // 호스트 쪽 원본도
    expect(res).toMatchObject({ uploaded: 3, downloaded: 1, replacedLocal: 2 })
  })

  it('끝나면 호스트 폴더가 동기화 대상이 되고 모든 노트가 깨끗하며, 이어지는 동기화는 할 일이 없다', async () => {
    bothSides()
    await applyHostConnect(await previewHostConnect(), choices, dir)
    expect(useApp.getState().settings.remote).toEqual({ kind: 'host', dir })
    for (const f of Object.values(useApp.getState().files)) {
      expect(f.dirty, f.path).toBe(false)
      expect(f.sha, f.path).toBeTruthy()
    }
    const seq = manifest().seq
    await useApp.getState().sync()
    expect(manifest().seq).toBe(seq) // 호스트에 새로 쓴 것이 없다
    expect(Object.values(useApp.getState().files).every((f) => !f.dirty)).toBe(true)
  })

  it('중간에 호스트 쓰기가 실패하면 PC 앱의 노트는 바뀌지 않고 연결도 되지 않는다(스냅샷은 남는다)', async () => {
    bothSides()
    const plan = await previewHostConnect()
    override['host:push'] = async () => ({ ok: false, status: 500, error: 'disk error' })
    const localBefore = JSON.stringify(useApp.getState().files)
    await expect(applyHostConnect(plan, choices, dir)).rejects.toThrow('disk error')
    expect(JSON.stringify(useApp.getState().files)).toBe(localBefore)
    expect(useApp.getState().settings.remote).toBeNull()
    expect(fs.readdirSync(path.join(dir, '.nosidian', 'snapshots')).length).toBe(1)
  })

  it('되돌리기: 연결을 끊어도 노트는 그대로이고, 스냅샷으로 PC 노트를 복원할 수 있다', async () => {
    bothSides()
    const res = await applyHostConnect(await previewHostConnect(), choices, dir)
    expect(useApp.getState().files['다름2.md'].content).toBe('호스트 버전 2\n') // 호스트 것으로 바뀌었다
    leaveHost()
    expect(useApp.getState().settings.remote).toBeNull()
    expect(Object.keys(useApp.getState().files).length).toBeGreaterThanOrEqual(7) // 노트를 지우지 않았다
    const n = await restoreVaultFromSnapshot(res.snapshotId)
    expect(n).toBeGreaterThanOrEqual(1)
    expect(useApp.getState().files['다름2.md'].content).toBe('PC 버전 2\n') // 반영 전 PC 내용으로
    expect(useApp.getState().files['호스트만.md']).toBeDefined() // 그 뒤에 받은 노트는 지우지 않는다
  })
})
