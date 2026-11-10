// "내 PC 폴더" 최초 연결: PC 앱의 Vault 와 호스트 폴더에 이미 있는 내용을 비교해 **미리 보여 주고**, 사용자가 승인한 뒤에만 반영한다.
//  - 계획(plan)을 만드는 동안은 읽기만 한다. 승인 전에는 아무것도 덮어쓰거나 지우지 않는다.
//  - 최초 연결에는 **삭제가 없다**(양쪽 어느 쪽도 지우지 않는다). 덮어쓰기는 사용자가 항목별로 고른 것만 한다.
//  - 반영 직전에 **스냅샷**(호스트 폴더 + PC 앱 Vault 노트)을 만든다. 스냅샷을 만들 수 없으면 아무것도 하지 않고 중단한다.
//  - 반영이 끝나면 호스트 폴더가 이 Vault 의 동기화 대상(settings.remote = host)이 되고, 이후는 기존 동기화(useApp.sync)가 한다.
//  - 문제가 생기면: leaveHost()(연결 끊기, 로컬 노트 그대로) · restoreVaultFromSnapshot()(스냅샷의 노트로 되돌리기).
import { desktop, type HostApi, type HostEntry } from './externalIO'
import { useApp } from './app'
import { isNote } from './sync/types'
import type { NoteFile } from './types'

export type Choice = 'pc' | 'host' | 'both'

export interface ConnectPlan {
  /** PC 앱에만 있는 노트 → 호스트에 올린다 */
  pcOnly: string[]
  /** (pcOnly 중) 호스트에서 지워진 적이 있는 경로. 올리면 되살아난다 — 사용자에게 알린다 */
  revived: string[]
  /** 호스트에만 있는 노트(.md) → PC 앱으로 받는다 */
  hostOnly: string[]
  /** 호스트에만 있는 노트가 아닌 파일 → 파일 목록으로만 보인다(내용은 받지 않는다) */
  hostOther: string[]
  /** 경로와 내용이 같다 → 할 일 없음(버전만 맞춘다) */
  same: string[]
  /** 경로는 같은데 내용이 다르다 → 항목별로 사용자가 고른다 */
  differ: string[]
  hostRevs: Record<string, string>
  tombRevs: Record<string, string>
  hostSizes: Record<string, number>
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Text = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
const utf8 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function must<T>(r: ({ ok: true } & T) | { ok: false; status: number; error: string; code?: string }): T {
  if (!r.ok) throw Object.assign(new Error(r.error), { status: r.status, code: r.code })
  return r
}
const api = (): HostApi => {
  const h = desktop()?.host
  if (!h) throw new Error('PC 앱에서만 쓸 수 있어요')
  return h
}

/** 두 저장소를 비교한다(읽기만). */
export async function planHostConnect(files: Record<string, NoteFile>, host: { entries: HostEntry[]; tombs: { path: string; rev: string }[] }): Promise<ConnectPlan> {
  const local = Object.values(files).filter((f) => !f.deleted && isNote(f.path))
  const localByPath = new Map(local.map((f) => [f.path, f]))
  const hostByPath = new Map(host.entries.map((e) => [e.path, e]))
  const tombRevs = Object.fromEntries(host.tombs.map((t) => [t.path, t.rev]))
  const plan: ConnectPlan = { pcOnly: [], revived: [], hostOnly: [], hostOther: [], same: [], differ: [], hostRevs: {}, tombRevs, hostSizes: {} }
  for (const e of host.entries) {
    plan.hostRevs[e.path] = e.rev
    plan.hostSizes[e.path] = e.size
  }
  for (const f of local) {
    const h = hostByPath.get(f.path)
    if (!h) {
      plan.pcOnly.push(f.path)
      if (tombRevs[f.path]) plan.revived.push(f.path)
    } else if ((await sha256Text(f.content)) === h.hash) plan.same.push(f.path)
    else plan.differ.push(f.path)
  }
  for (const e of host.entries) {
    if (localByPath.has(e.path)) continue
    if (isNote(e.path)) plan.hostOnly.push(e.path)
    else plan.hostOther.push(e.path)
  }
  for (const k of ['pcOnly', 'revived', 'hostOnly', 'hostOther', 'same', 'differ'] as const) plan[k].sort((a, b) => a.localeCompare(b, 'ko'))
  return plan
}

/** 호스트 폴더의 현재 목록을 읽어 계획을 만든다 */
export async function previewHostConnect(): Promise<ConnectPlan> {
  const l = must(await api().list()) as { entries: HostEntry[]; tombs: { path: string; rev: string }[] }
  return planHostConnect(useApp.getState().files, l)
}

const uniquePath = (path: string, taken: Set<string>) => {
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  const ext = dot > 0 ? path.slice(dot) : ''
  let p = `${stem} (PC 사본)${ext}`
  for (let n = 2; taken.has(p.toLowerCase()); n++) p = `${stem} (PC 사본 ${n})${ext}`
  return p
}

export interface ApplyResult {
  uploaded: number
  downloaded: number
  replacedLocal: number
  copies: string[]
  snapshotId: string
}

/**
 * 사용자가 승인한 계획을 반영한다. choices: 내용이 다른 항목(differ)마다 'pc'(PC 것을 호스트에 올림) · 'host'(호스트 것으로 받음) · 'both'(호스트 것을 받고 PC 것은 "(PC 사본)"으로 보관).
 * 순서: 선택 확인 → **스냅샷(실패하면 중단)** → 올리기·받기 → 앱 상태 반영. 중간에 실패하면 앱의 노트는 바뀌지 않는다(호스트에는 이미 올라간 새 파일이 남을 수 있다 — 지우지 않는다).
 */
export async function applyHostConnect(plan: ConnectPlan, choices: Record<string, Choice>, dirLabel: string): Promise<ApplyResult> {
  const missing = plan.differ.filter((p) => !choices[p])
  if (missing.length) throw Object.assign(new Error(`내용이 다른 ${missing.length}개를 먼저 골라 주세요`), { code: 'unresolved' })

  const state = useApp.getState()
  const files: Record<string, NoteFile> = { ...state.files }
  const vaultNotes: Record<string, string> = {}
  for (const f of Object.values(state.files)) if (!f.deleted && isNote(f.path)) vaultNotes[f.path] = f.content

  // 0) 스냅샷: 양쪽의 현재 상태를 복구할 수 있게 남긴다. 못 하면 여기서 끝(아무것도 바뀌지 않았다)
  const snap = must(await api().snapshot({ vaultNotes, label: 'first-connect' })) as { id: string }

  const taken = new Set([...Object.keys(files), ...Object.keys(plan.hostRevs)].map((p) => p.toLowerCase()))
  const assets: Record<string, { sha: string | null; id?: string; size?: number }> = { ...state.assets }
  let uploaded = 0
  let downloaded = 0
  let replacedLocal = 0
  const copies: string[] = []
  const now = Date.now()
  const fetchNote = async (path: string) => {
    const r = must(await api().read(path)) as { b64: string; rev: string }
    return { content: utf8(r.b64), rev: r.rev }
  }
  const upload = async (items: { path: string; content: string; baseRev: string | null }[]) => {
    if (!items.length) return {} as Record<string, string>
    const r = must(await api().push(items.map((i) => ({ path: i.path, b64: toB64(i.content), baseRev: i.baseRev })))) as { revs: Record<string, string> }
    uploaded += items.length
    return r.revs
  }

  // 1) 호스트에만 있는 노트 받기(새 노트이므로 덮어쓰는 것이 없다)
  for (const p of plan.hostOnly) {
    const n = await fetchNote(p)
    files[p] = { path: p, content: n.content, sha: n.rev, dirty: false, mtime: now }
    downloaded++
  }
  // 2) 호스트의 노트가 아닌 파일은 목록으로만
  for (const p of plan.hostOther) assets[p] = { sha: plan.hostRevs[p], id: plan.hostRevs[p], size: plan.hostSizes[p] }
  // 3) 같은 것은 버전만 맞춘다
  for (const p of plan.same) files[p] = { ...files[p], sha: plan.hostRevs[p], dirty: false, base: undefined, conflict: undefined }
  // 4) PC 에만 있는 노트 올리기(호스트에서 지워졌던 경로면 그 삭제 기록의 rev 로 — 알고 되살리는 것이다)
  const up1 = await upload(plan.pcOnly.map((p) => ({ path: p, content: files[p].content, baseRev: plan.tombRevs[p] ?? null })))
  for (const p of plan.pcOnly) files[p] = { ...files[p], sha: up1[p], dirty: false, base: undefined }
  // 5) 내용이 다른 것: 사용자가 고른 대로
  const keepPc = plan.differ.filter((p) => choices[p] === 'pc')
  const up2 = await upload(keepPc.map((p) => ({ path: p, content: files[p].content, baseRev: plan.hostRevs[p] })))
  for (const p of keepPc) files[p] = { ...files[p], sha: up2[p], dirty: false, base: undefined }
  const copyItems: { path: string; content: string; baseRev: null }[] = []
  for (const p of plan.differ.filter((x) => choices[x] === 'host' || choices[x] === 'both')) {
    const pcContent = files[p].content
    const n = await fetchNote(p)
    files[p] = { path: p, content: n.content, sha: n.rev, dirty: false, mtime: now }
    replacedLocal++
    if (choices[p] === 'both') {
      const np = uniquePath(p, taken)
      taken.add(np.toLowerCase())
      copyItems.push({ path: np, content: pcContent, baseRev: null })
    }
  }
  const up3 = await upload(copyItems)
  for (const c of copyItems) {
    files[c.path] = { path: c.path, content: c.content, sha: up3[c.path], dirty: false, mtime: now }
    copies.push(c.path)
  }

  // 6) 앱 상태 반영: 이제부터 호스트 폴더가 이 Vault 의 동기화 대상
  await useApp.getState().commitHostConnect(files, assets, dirLabel)
  return { uploaded, downloaded, replacedLocal, copies, snapshotId: snap.id }
}

/** 호스트 폴더 연결을 끊는다. PC 앱의 노트는 그대로다(지우지 않는다) */
export function leaveHost() {
  useApp.getState().leaveHost()
}

/** 스냅샷에 담아 둔 PC 앱 Vault 의 노트로 되돌린다(스냅샷에 있던 노트의 내용을 복원한다. 그 뒤에 새로 만든 노트는 지우지 않는다). 반환: 복원한 노트 수 */
export async function restoreVaultFromSnapshot(id: string): Promise<number> {
  const r = must(await api().snapshotVault(id)) as { vault: Record<string, string> | null }
  if (!r.vault) throw new Error('이 스냅샷에는 Vault 노트가 없어요')
  const app = useApp.getState()
  let n = 0
  for (const [p, content] of Object.entries(r.vault)) {
    const cur = useApp.getState().files[p]
    if (cur && !cur.deleted) {
      if (cur.content !== content) {
        app.setContent(p, content)
        n++
      }
    } else {
      app.createNote(p, content, false)
      n++
    }
  }
  return n
}
