// 통합 시험: 기존 동기화(useApp.sync)가 "내 PC 폴더" Provider 로 그대로 동작한다 — 실제 IPC 계층(hostIpc)과 실제 호스트 저장 계층(hostStore)을 거친다.
// 클라우드 동기화·AI 정책은 건드리지 않았다는 점은 기존 시험(sync.test.ts 등)이 그대로 통과하는 것으로 본다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import hostIpc from '../../electron/hostIpc.cjs'
import { useApp, replaceOther } from './app'
import { useDialog } from './dialog'
import { setLang } from './i18n'

setLang('ko')
const { register } = hostIpc as { register(h: unknown): unknown }

type Handler = (e: unknown, ...a: unknown[]) => Promise<Record<string, unknown>>
let userData: string
let dir: string
const handlers = new Map<string, Handler>()
let beforePush: (() => void) | null = null

function installHost() {
  handlers.clear()
  const app = { getPath: (n: string) => (n === 'userData' ? userData : os.homedir()), on: () => {} }
  register({ ipcMain: { handle: (n: string, h: Handler) => handlers.set(n, h) }, app, dialog: {}, BrowserWindow: { getFocusedWindow: () => null } })
  const call = (n: string) => (...a: unknown[]) => {
    if (n === 'host:push' && beforePush) {
      const f = beforePush
      beforePush = null
      f() // 올리는 사이 탐색기에서 먼저 고친 상황
    }
    return handlers.get(n)!({}, ...a)
  }
  ;(window as unknown as { amsidianDesktop: unknown }).amsidianDesktop = {
    host: {
      status: call('host:status'), pickDir: call('host:pickDir'), clear: call('host:clear'), list: call('host:list'), read: call('host:read'),
      push: call('host:push'), ack: call('host:ack'), snapshot: call('host:snapshot'), snapshots: call('host:snapshots'), snapshotVault: call('host:snapshotVault'), gc: call('host:gc'),
    },
  }
}
const hostFile = (rel: string) => path.join(dir, ...rel.split('/'))
const bump = (rel: string) => { const t = new Date(Date.now() + 5000 + Math.floor(Math.random() * 1000)); fs.utimesSync(hostFile(rel), t, t) }
const text = (p: string) => useApp.getState().files[p]?.content
const list = async () => (await handlers.get('host:list')!({})) as unknown as { entries: { path: string; rev: string }[]; tombs: { path: string; rev: string }[]; seq: number }

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-ud-'))
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-hostsync-'))
  fs.writeFileSync(path.join(userData, 'host.json'), JSON.stringify({ dir }))
  beforePush = null
  installHost()
  useApp.setState({
    files: {},
    assets: {},
    syncing: false,
    settings: { ...useApp.getState().settings, remote: { kind: 'host', dir } as never },
  })
})
afterEach(() => {
  ;(window as unknown as { amsidianDesktop?: unknown }).amsidianDesktop = undefined
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(dir, { recursive: true, force: true })
})

const note = (path: string, content: string, over: object = {}) => ({ path, content, sha: null, dirty: true, mtime: 1, ...over })

describe('PC 앱 ⇄ 호스트 폴더 (기존 동기화 재사용)', () => {
  it('새 노트는 호스트 폴더에 평범한 .md 파일로 올라가고, 고치면 같은 파일이 갱신된다', async () => {
    useApp.setState({ files: { '프로젝트/개요.md': note('프로젝트/개요.md', '# 개요\n') } })
    await useApp.getState().sync()
    expect(fs.readFileSync(hostFile('프로젝트/개요.md'), 'utf8')).toBe('# 개요\n') // 탐색기에서도 그대로 열리는 파일
    const f1 = useApp.getState().files['프로젝트/개요.md']
    expect(f1.dirty).toBe(false)
    expect(f1.sha).toBe((await list()).entries[0].rev)
    useApp.getState().setContent('프로젝트/개요.md', '# 개요\n수정\n')
    await useApp.getState().sync()
    expect(fs.readFileSync(hostFile('프로젝트/개요.md'), 'utf8')).toBe('# 개요\n수정\n')
    expect((await list()).entries[0].rev).not.toBe(f1.sha)
    expect(Object.keys(useApp.getState().files)).toEqual(['프로젝트/개요.md']) // .nosidian 은 목록에 없다
  })

  it('탐색기에서 고친 파일은 다음 동기화 때 PC 앱으로 들어온다(내가 안 고쳤다면 그대로 받는다)', async () => {
    useApp.setState({ files: { 'a.md': note('a.md', 'v1\n') } })
    await useApp.getState().sync()
    fs.writeFileSync(hostFile('a.md'), 'edited in explorer\n')
    bump('a.md')
    await useApp.getState().sync()
    expect(text('a.md')).toBe('edited in explorer\n')
    expect(useApp.getState().files['a.md'].dirty).toBe(false)
  })

  it('외부에서 새로 넣은 파일은 노트(.md)면 받아 오고, 그 밖의 파일은 파일 목록으로만 보인다', async () => {
    fs.mkdirSync(hostFile('자료'), { recursive: true })
    fs.writeFileSync(hostFile('외부.md'), '# from outside\n')
    fs.writeFileSync(hostFile('자료/report.docx'), Buffer.from([1, 2, 3, 4, 5]))
    await useApp.getState().sync()
    expect(text('외부.md')).toBe('# from outside\n')
    expect(useApp.getState().files['자료/report.docx']).toBeUndefined()
    expect(useApp.getState().assets['자료/report.docx']).toMatchObject({ size: 5 })
  })

  it('같은 노트를 PC 앱과 탐색기에서 다른 줄을 고치면 자동으로 합쳐 호스트에 올린다. 같은 줄이면 충돌로 남기고 호스트는 그대로', async () => {
    const base = ['# 할 일', '', '- [ ] 하나', '- [ ] 둘', '- [ ] 셋', ''].join('\n')
    useApp.setState({ files: { 't.md': note('t.md', base) } })
    await useApp.getState().sync()
    useApp.getState().setContent('t.md', base.replace('- [ ] 하나', '- [x] 하나')) // 앱에서
    fs.writeFileSync(hostFile('t.md'), base.replace('- [ ] 셋', '- [x] 셋')) // 탐색기에서
    bump('t.md')
    await useApp.getState().sync()
    const merged = fs.readFileSync(hostFile('t.md'), 'utf8')
    expect(merged).toContain('- [x] 하나')
    expect(merged).toContain('- [x] 셋')
    expect(text('t.md')).toBe(merged)

    // 같은 줄을 서로 다르게 고침 → 충돌
    useApp.getState().setContent('t.md', merged.replace('- [ ] 둘', '- [ ] 둘 (앱)'))
    fs.writeFileSync(hostFile('t.md'), merged.replace('- [ ] 둘', '- [ ] 둘 (탐색기)'))
    bump('t.md')
    await useApp.getState().sync()
    expect(useApp.getState().files['t.md'].conflict).toBeTruthy()
    expect(fs.readFileSync(hostFile('t.md'), 'utf8')).toContain('(탐색기)') // 호스트는 덮어쓰지 않았다
    expect(fs.readFileSync(hostFile('t.md'), 'utf8')).not.toContain('(앱)')
  })

  it('올리는 사이에 탐색기에서 먼저 고쳐도(409) 한 번 다시 받아 합친 뒤 올린다 — 어느 쪽 변경도 잃지 않는다', async () => {
    const base = ['# 제목', '', '- a', '- b', '- c', ''].join('\n')
    useApp.setState({ files: { 'r.md': note('r.md', base) } })
    await useApp.getState().sync()
    useApp.getState().setContent('r.md', base.replace('- a', '- A!'))
    beforePush = () => {
      fs.writeFileSync(hostFile('r.md'), base.replace('- c', '- C!'))
      bump('r.md')
    }
    await useApp.getState().sync()
    const disk = fs.readFileSync(hostFile('r.md'), 'utf8')
    expect(disk).toContain('- A!')
    expect(disk).toContain('- C!')
  })

  it('삭제는 호스트에서 휴지통 + 삭제 기록으로 남고, 같은 경로에 다시 만들어도 동기화된다', async () => {
    useApp.setState({ files: { 'x.md': note('x.md', 'x\n') } })
    await useApp.getState().sync()
    useApp.getState().deleteNote('x.md', { silent: true })
    await useApp.getState().sync()
    expect(fs.existsSync(hostFile('x.md'))).toBe(false)
    expect((await list()).tombs.map((t) => t.path)).toEqual(['x.md'])
    expect(fs.readdirSync(path.join(dir, '.nosidian', 'trash')).length).toBe(1) // 내용은 휴지통에 있다
    useApp.getState().createNote('x.md', '다시 만듦\n', false)
    await useApp.getState().sync()
    expect(fs.readFileSync(hostFile('x.md'), 'utf8')).toBe('다시 만듦\n')
    expect((await list()).tombs).toEqual([])
  })

  it('호스트에서 지워진 파일은 PC 앱에서도 사라지지만, 내가 고치고 있던 파일은 지우지 않고 다시 올린다', async () => {
    useApp.setState({ files: { 'keep.md': note('keep.md', 'k\n'), 'edit.md': note('edit.md', 'e\n') } })
    await useApp.getState().sync()
    fs.rmSync(hostFile('keep.md'))
    fs.rmSync(hostFile('edit.md'))
    useApp.getState().setContent('edit.md', 'e\n내가 고침\n')
    await useApp.getState().sync()
    expect(useApp.getState().files['keep.md']).toBeUndefined()
    expect(text('edit.md')).toBe('e\n내가 고침\n')
    expect(fs.readFileSync(hostFile('edit.md'), 'utf8')).toBe('e\n내가 고침\n') // 데이터를 잃지 않는다
  })

  it('동기화가 끝나면 PC 앱이 여기까지 반영했다는 확인(ack)을 남긴다(삭제 기록 정리 조건)', async () => {
    useApp.setState({ files: { 'a.md': note('a.md', 'a\n') } })
    const manifest = () => JSON.parse(fs.readFileSync(path.join(dir, '.nosidian', 'manifest.json'), 'utf8'))
    await useApp.getState().sync()
    // 확인은 "목록을 읽은 시점"까지다. 방금 올린 변경은 다음 동기화에서 확인된다(그 사이 탐색기에서 생긴 변경을 확인한 것으로 잘못 치지 않으려는 보수적 동작)
    expect(manifest().devices['pc-app'].ackSeq).toBe(0)
    expect(manifest().seq).toBe(1)
    await useApp.getState().sync()
    expect(manifest().devices['pc-app'].ackSeq).toBe(manifest().seq)
  })

  it('호스트 폴더를 열 수 없으면 알리고 로컬 노트는 그대로 둔다', async () => {
    useApp.setState({ files: { 'a.md': note('a.md', '내용\n') } })
    fs.rmSync(path.join(userData, 'host.json')) // 폴더 지정이 사라진 상황
    installHost()
    await useApp.getState().sync()
    expect(text('a.md')).toBe('내용\n')
    expect(useApp.getState().files['a.md'].dirty).toBe(true)
    expect(useApp.getState().toast ?? '').toMatch(/호스트 폴더|동기화 실패/)
  })
})

describe('바이너리 파일 교체·충돌 (PC 앱 ⇄ 호스트 폴더, 2번)', () => {
  const REL = '자료/report.docx'
  const bytesOf = (rel: string) => [...fs.readFileSync(hostFile(rel))]
  const answer = async (kind: 'choice' | 'confirm', v: string | boolean | null) => {
    for (let i = 0; i < 400 && useDialog.getState().kind !== kind; i++) await new Promise((r) => setTimeout(r, 5))
    const d = useDialog.getState()
    expect(d.kind).toBe(kind)
    const values = (d.choices ?? []).map((c) => c.value)
    d.resolve?.(v)
    useDialog.setState({ kind: null })
    return values
  }
  const setup = async () => {
    fs.mkdirSync(hostFile('자료'), { recursive: true })
    fs.writeFileSync(hostFile(REL), Buffer.from([1, 2, 3, 4]))
    await useApp.getState().sync() // 이 PC 앱이 파일 목록(rev)을 안다
  }
  const mine = () => new File([new Uint8Array([9, 9, 9, 9, 9])], 'report.docx')

  it('탐색기에서 아무도 안 고쳤으면 새 버전으로 바꾸기가 그냥 성공한다(예전: baseRev 없이 보내 항상 409)', async () => {
    await setup()
    expect((await replaceOther(REL, mine())).outcome).toBe('replaced')
    expect(bytesOf(REL)).toEqual([9, 9, 9, 9, 9])
    expect(useDialog.getState().kind).toBeNull()
  })
  it('탐색기에서 먼저 고쳤으면 선택 창이 뜨고, 새 이름으로 보관하면 탐색기에서 고친 파일은 그대로다', async () => {
    await setup()
    fs.writeFileSync(hostFile(REL), Buffer.from([7, 7]))
    bump(REL)
    const p = replaceOther(REL, mine())
    expect(await answer('choice', 'rename')).toEqual(['rename', 'keep', 'overwrite'])
    expect(await p).toEqual({ outcome: 'renamed', path: '자료/report (내 것).docx' })
    expect(bytesOf(REL)).toEqual([7, 7])
    expect(bytesOf('자료/report (내 것).docx')).toEqual([9, 9, 9, 9, 9])
  })
  it('탐색기에서 먼저 고친 파일을 덮어쓰기로 고르면(확인 뒤) 내 것으로 바뀐다', async () => {
    await setup()
    fs.writeFileSync(hostFile(REL), Buffer.from([7, 7]))
    bump(REL)
    const p = replaceOther(REL, mine())
    await answer('choice', 'overwrite')
    await answer('confirm', true)
    expect((await p).outcome).toBe('replaced')
    expect(bytesOf(REL)).toEqual([9, 9, 9, 9, 9])
  })
})
