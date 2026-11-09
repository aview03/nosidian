import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider, PushChange } from './sync'
import { SyncError } from './sync'

// 가짜 원격: 파일 목록과 내용을 메모리에 둔다. rev 는 내용이 바뀔 때마다 올라간다
const remote = { files: new Map<string, { content: string; rev: string }>(), n: 0, onFirstPush: null as null | (() => void), pushes: 0 }
const bump = (path: string, content: string) => remote.files.set(path, { content, rev: 'r' + ++remote.n })
const fake: Provider = {
  label: 'fake',
  async test() {},
  async list() {
    return { entries: [...remote.files].map(([path, f]) => ({ path, rev: f.rev })) }
  },
  async readText(e) {
    return remote.files.get(e.path)!.content
  },
  async readBase64() {
    return ''
  },
  async push(changes: PushChange[]) {
    remote.pushes++
    if (remote.onFirstPush) {
      const f = remote.onFirstPush
      remote.onFirstPush = null
      f() // 올리는 사이 다른 사람이 먼저 올렸다
      throw new SyncError('먼저 변경됨', 409)
    }
    const revs = new Map<string, string>()
    for (const c of changes) {
      if (c.content === null) remote.files.delete(c.path)
      else {
        bump(c.path, c.content)
        revs.set(c.path, remote.files.get(c.path)!.rev)
      }
    }
    return revs
  },
}
vi.mock('./sync', async (orig) => ({ ...(await orig<typeof import('./sync')>()), createProvider: () => fake }))

const { useApp } = await import('./app')

const base = ['# 할 일', '', '- [ ] 장소 예약', '- [ ] 케이크 주문', '- [ ] 현수막 인쇄', ''].join('\n')
const text = (p: string) => useApp.getState().files[p]?.content

beforeEach(() => {
  remote.files.clear()
  remote.n = 0
  remote.pushes = 0
  remote.onFirstPush = null
  bump('a.md', base)
  const rev = remote.files.get('a.md')!.rev
  useApp.setState({
    files: { 'a.md': { path: 'a.md', content: base, sha: rev, dirty: false, mtime: 1 } },
    assets: {},
    syncing: false,
    settings: { ...useApp.getState().settings, remote: { kind: 'github', token: 't', owner: 'o', repo: 'r', branch: 'main' } as never },
  })
})

describe('동기화: 같은 노트를 둘이 고쳤을 때', () => {
  it('고친 줄이 겹치지 않으면 자동으로 합쳐 올린다', async () => {
    useApp.getState().setContent('a.md', base.replace('- [ ] 장소 예약', '- [x] 장소 예약')) // 내가
    expect(useApp.getState().files['a.md'].base).toBe(base) // 고치기 시작할 때의 내용이 기준으로 남는다
    bump('a.md', base.replace('- [ ] 현수막 인쇄', '- [x] 현수막 인쇄')) // 상대가 먼저 올림
    await useApp.getState().sync()
    const f = useApp.getState().files['a.md']
    expect(f.conflict).toBeUndefined()
    expect(f.content).toContain('- [x] 장소 예약')
    expect(f.content).toContain('- [x] 현수막 인쇄')
    expect(remote.files.get('a.md')!.content).toBe(f.content) // 합친 결과가 원격에도 올라갔다
    expect(f.dirty).toBe(false)
    expect(f.base).toBeUndefined()
    expect(f.sha).toBe(remote.files.get('a.md')!.rev)
  })
  it('같은 줄을 서로 다르게 고치면 충돌로 남기고 원격은 건드리지 않는다', async () => {
    useApp.getState().setContent('a.md', base.replace('- [ ] 케이크 주문', '- [ ] 케이크 주문 owner:민수'))
    const theirs = base.replace('- [ ] 케이크 주문', '- [ ] 케이크 주문 owner:지현')
    bump('a.md', theirs)
    await useApp.getState().sync()
    const f = useApp.getState().files['a.md']
    expect(f.conflict?.content).toBe(theirs)
    expect(f.content).toContain('owner:민수') // 내 글은 그대로
    expect(remote.files.get('a.md')!.content).toBe(theirs)
    expect(remote.pushes).toBe(0)
  })
  it('올리는 사이 상대가 먼저 올려도(409) 한 번은 알아서 다시 받아 합친 뒤 올린다', async () => {
    useApp.getState().setContent('a.md', base.replace('- [ ] 장소 예약', '- [x] 장소 예약'))
    remote.onFirstPush = () => bump('a.md', base.replace('- [ ] 현수막 인쇄', '- [x] 현수막 인쇄'))
    await useApp.getState().sync()
    const f = useApp.getState().files['a.md']
    expect(remote.pushes).toBe(2)
    expect(f.dirty).toBe(false)
    expect(remote.files.get('a.md')!.content).toContain('- [x] 장소 예약')
    expect(remote.files.get('a.md')!.content).toContain('- [x] 현수막 인쇄')
    expect(useApp.getState().syncing).toBe(false)
  })
  it('내가 고치는 동안 상대는 안 고쳤으면 그냥 올리고, 한 번 더 고치면 기준이 새로 잡힌다', async () => {
    const mine = base.replace('- [ ] 장소 예약', '- [x] 장소 예약')
    useApp.getState().setContent('a.md', mine)
    await useApp.getState().sync()
    expect(remote.files.get('a.md')!.content).toBe(mine)
    expect(useApp.getState().files['a.md'].base).toBeUndefined()
    useApp.getState().setContent('a.md', mine + '- [ ] 새 일\n')
    expect(useApp.getState().files['a.md'].base).toBe(mine) // 방금 올린 내용이 기준
    expect(text('a.md')).toContain('새 일')
  })
  it('충돌을 "내 버전 유지"로 풀면 원격본이 기준이 되어 다음 동기화에서 다시 합칠 수 있다', async () => {
    useApp.getState().setContent('a.md', base.replace('- [ ] 케이크 주문', '- [ ] 케이크 주문 owner:민수'))
    const theirs = base.replace('- [ ] 케이크 주문', '- [ ] 케이크 주문 owner:지현')
    bump('a.md', theirs)
    await useApp.getState().sync()
    useApp.getState().resolveConflict('a.md', 'local')
    expect(useApp.getState().files['a.md'].base).toBe(theirs)
    await useApp.getState().sync()
    expect(remote.files.get('a.md')!.content).toContain('owner:민수')
    expect(useApp.getState().files['a.md'].dirty).toBe(false)
  })
})
