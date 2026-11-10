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

describe('동기화: 노트가 아닌 파일', () => {
  it('목록(assets)에만 올라오고 노트로 내려받지 않으며, 원격에서 사라지면 목록에서도 빠진다', async () => {
    bump('tools/main.py', 'print(1)')
    bump('report.docx', 'binary')
    await useApp.getState().sync()
    const st = useApp.getState()
    expect(Object.keys(st.assets).sort()).toEqual(['report.docx', 'tools/main.py'])
    expect(st.files['tools/main.py']).toBeUndefined()
    expect(st.files['a.md']).toBeDefined()
    remote.files.delete('report.docx')
    await useApp.getState().sync()
    expect(Object.keys(useApp.getState().assets)).toEqual(['tools/main.py'])
  })
})

describe('파일 올리기(uploadOthers)', () => {
  it('바이너리를 base64 로 올리고 목록에 더하며, 같은 이름은 번호를 붙이고 노트(.md)는 거절한다', async () => {
    const { uploadOthers } = await import('./app')
    const pushed: { path: string; b64?: string }[] = []
    const orig = fake.push
    fake.push = async (changes, m) => {
      pushed.push(...changes.map((c) => ({ path: c.path, b64: c.b64 })))
      return orig(changes, m)
    }
    try {
      const f = (name: string, bytes: number[]) => new File([new Uint8Array(bytes)], name)
      const r1 = await uploadOthers([f('r.docx', [1, 2, 3]), f('x.md', [1])], 'proj')
      expect(r1.done).toEqual(['proj/r.docx'])
      expect(r1.failed.map((x) => x.name)).toEqual(['x.md'])
      expect(pushed[0]).toEqual({ path: 'proj/r.docx', b64: 'AQID' })
      expect(useApp.getState().assets['proj/r.docx']?.size).toBe(3)
      const r2 = await uploadOthers([f('r.docx', [9])], 'proj')
      expect(r2.done).toEqual(['proj/r (2).docx'])
    } finally {
      fake.push = orig
    }
  })
})

describe('파일 삭제(deleteOther)', () => {
  it('저장소에서 지우고 목록에서도 뺀다(원격에 없는 경로는 건드리지 않는다)', async () => {
    const { uploadOthers, deleteOther } = await import('./app')
    await uploadOthers([new File([new Uint8Array([1, 2])], 'gone.zip')], '')
    expect(remote.files.has('gone.zip')).toBe(true)
    await deleteOther('gone.zip')
    expect(remote.files.has('gone.zip')).toBe(false)
    expect(useApp.getState().assets['gone.zip']).toBeUndefined()
    expect(remote.files.has('a.md')).toBe(true)
    await deleteOther('never.zip') // 목록에 없으면 아무 일도 하지 않는다
  })
})

describe('파일 이름 바꾸기·이동(moveOther)', () => {
  it('새 경로에 올리고 원본을 지운다. 같은 이름·큰 파일은 거절하고, 실패하면 원본이 그대로 남는다', async () => {
    const { uploadOthers, moveOther } = await import('./app')
    ;(await import('./i18n')).setLang('ko')
    await uploadOthers([new File([new Uint8Array([7, 8])], 'a.zip'), new File([new Uint8Array([1])], 'b.zip')], '')
    // readBase64 는 가짜가 빈 문자열이라, 가져온 내용 대신 흐름(경로·삭제)만 본다
    await moveOther('a.zip', 'proj/a2.zip')
    expect(remote.files.has('a.zip')).toBe(false)
    expect(remote.files.has('proj/a2.zip')).toBe(true)
    const st = useApp.getState()
    expect(st.assets['a.zip']).toBeUndefined()
    expect(st.assets['proj/a2.zip']?.size).toBe(2)
    await expect(moveOther('b.zip', 'PROJ/A2.zip')).rejects.toThrow('같은 이름')
    await expect(moveOther('nope.zip', 'x.zip')).rejects.toThrow('목록에 없는')
    useApp.setState((s) => ({ assets: { ...s.assets, 'huge.bin': { sha: 'h', size: 99 * 1024 * 1024 } } }))
    await expect(moveOther('huge.bin', 'h2.bin')).rejects.toThrow('이름 바꾸기·이동을 지원하지 않아요')
    const orig = fake.push
    fake.push = async () => { throw new SyncError('fail', 500) }
    try {
      await expect(moveOther('b.zip', 'c.zip')).rejects.toThrow('fail')
    } finally {
      fake.push = orig
    }
    expect(remote.files.has('b.zip')).toBe(true)
    expect(useApp.getState().assets['b.zip']).toBeDefined()
  })
})

describe('AI 파일 제안(propose_file) → 승인 → 올리기', () => {
  it('제안만으로는 저장소에 아무것도 올라가지 않고, 승인하면 올라가며, 거절·중복·실패를 구분한다', async () => {
    const { useFileProposals } = await import('./fileProposals')
    const { callTool } = await import('./mcpTools')
    const { buildEnv } = await import('./mcpBridge')
    const { replaceOther } = await import('./app')
    ;(await import('./i18n')).setLang('ko')
    localStorage.clear()
    useFileProposals.setState({ loaded: false, items: [] })
    useApp.setState({ settings: { ...useApp.getState().settings, activeVault: 'v1', vaults: [{ id: 'v1', name: 't' } as never] } })
    const env = () => buildEnv(true, false, false)
    const call = (args: unknown) => callTool('propose_file', args, env(), 'c') as Record<string, unknown>

    const r = call({ path: 'tools/clean.py', content: 'print("hi")\n', summary: '정리 스크립트' })
    expect(r).toMatchObject({ outcome: 'pending_approval' })
    expect(remote.files.has('tools/clean.py')).toBe(false) // 승인 전에는 올라가지 않는다
    const id = r.proposal_id as string
    expect(callTool('get_proposal_status', { proposal_id: id }, env(), 'c')).toMatchObject({ status: 'pending', action: 'file', path: 'tools/clean.py' })

    expect(call({ path: 'run.exe', content: 'x' })).toMatchObject({ outcome: 'denied', reason: 'badExt' })
    expect(call({ path: 'tools/clean.py', content: 'again' })).toMatchObject({ outcome: 'denied', reason: 'exists' }) // 대기 중인 제안과 겹침

    await useFileProposals.getState().approve(id)
    expect(remote.files.has('tools/clean.py')).toBe(true)
    expect(useApp.getState().assets['tools/clean.py']?.size).toBe(12)
    expect(callTool('get_proposal_status', { proposal_id: id }, env(), 'c')).toMatchObject({ status: 'applied' })
    expect(call({ path: 'tools/clean.py', content: 'x' })).toMatchObject({ outcome: 'denied', reason: 'exists' }) // 덮어쓰지 않는다

    const r2 = call({ path: 'data/rows.csv', content: 'a,b\n1,2\n' }) as { proposal_id: string }
    useFileProposals.getState().reject(r2.proposal_id)
    expect(callTool('get_proposal_status', { proposal_id: r2.proposal_id }, env(), 'c')).toMatchObject({ status: 'rejected' })
    expect(remote.files.has('data/rows.csv')).toBe(false)

    // 올리기가 실패하면 failed 로 남고 목록에는 안 생긴다
    const r3 = call({ path: 'x/y.json', content: '{}' }) as { proposal_id: string }
    const orig = fake.push
    fake.push = async () => { throw new SyncError('boom', 500) }
    try {
      await useFileProposals.getState().approve(r3.proposal_id)
    } finally {
      fake.push = orig
    }
    expect(useFileProposals.getState().find(r3.proposal_id)).toMatchObject({ status: 'failed', error: 'boom' })
    expect(useApp.getState().assets['x/y.json']).toBeUndefined()

    // 묻기(읽기 전용)에서는 제안할 수 없다
    expect(() => callTool('propose_file', { path: 'a.py', content: 'x' }, { ...env(), readOnly: true }, 'c')).toThrow(/read-only/)

    // 새 버전으로 바꾸기: 같은 경로에 덮어쓴다
    await replaceOther('tools/clean.py', new File([new Uint8Array([1, 2, 3, 4])], 'clean-v2.py'))
    expect(useApp.getState().assets['tools/clean.py']?.size).toBe(4)
    await expect(replaceOther('nope.py', new File([new Uint8Array([1])], 'n.py'))).rejects.toThrow('목록에 없는')
  })
})
