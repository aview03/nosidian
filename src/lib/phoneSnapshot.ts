// 폰의 Vault 스냅샷: "내 PC" 최초 연결을 반영하기 **전에** 폰의 노트 내용을 앱 전용 저장소에 남긴다(복원용).
//  - 안드로이드: 앱 전용 파일(Capacitor Filesystem, Directory.Data). 웹·시험: localStorage(용량이 작아 큰 Vault 는 실패하고, 실패하면 연결을 시작하지 않는다).
//  - 쓰고 **다시 읽어 확인**한다. 쓰지 못하면(저장 공간 부족 등) 예외 — 호출한 쪽은 연결을 시작하지 않아야 한다.
//  - 보관: 최근 3개 또는 30일(둘 중 먼저).
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

export interface SnapshotBackend {
  write(id: string, json: string): Promise<void>
  read(id: string): Promise<string | null>
  list(): Promise<string[]>
  remove(id: string): Promise<void>
}

const DIR = 'nosidian-snapshots'
const nativeBackend: SnapshotBackend = {
  async write(id, json) {
    await Filesystem.writeFile({ path: `${DIR}/${id}.json`, data: json, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })
  },
  async read(id) {
    try {
      const r = await Filesystem.readFile({ path: `${DIR}/${id}.json`, directory: Directory.Data, encoding: Encoding.UTF8 })
      return typeof r.data === 'string' ? r.data : null
    } catch {
      return null
    }
  },
  async list() {
    try {
      const r = await Filesystem.readdir({ path: DIR, directory: Directory.Data })
      return r.files.map((f) => f.name.replace(/\.json$/, ''))
    } catch {
      return []
    }
  },
  async remove(id) {
    try {
      await Filesystem.deleteFile({ path: `${DIR}/${id}.json`, directory: Directory.Data })
    } catch {
      /* 이미 없다 */
    }
  },
}
const PREFIX = 'nosidian.snap.'
const webBackend: SnapshotBackend = {
  async write(id, json) {
    localStorage.setItem(PREFIX + id, json) // 용량 초과면 예외
  },
  async read(id) {
    return localStorage.getItem(PREFIX + id)
  },
  async list() {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length))
  },
  async remove(id) {
    localStorage.removeItem(PREFIX + id)
  },
}

let backend: SnapshotBackend = Capacitor.isNativePlatform() ? nativeBackend : webBackend
/** 시험·특수 환경용 */
export function setSnapshotBackend(b: SnapshotBackend | null) {
  backend = b ?? (Capacitor.isNativePlatform() ? nativeBackend : webBackend)
}

const DAY = 86_400_000
const idOf = (at: number) => new Date(at).toISOString().replace(/[:.]/g, '-')
const atOf = (id: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(id)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : 0
}

export interface PhoneSnapshot {
  id: string
  at: number
  count: number
}

/** 노트 내용(경로 → 내용)을 저장한다. 쓰고 다시 읽어 같은지 확인하며, 실패하면 예외 */
export async function saveVaultSnapshot(notes: Record<string, string>, now = Date.now()): Promise<PhoneSnapshot> {
  const id = idOf(now)
  const json = JSON.stringify({ at: now, notes })
  try {
    await backend.write(id, json)
    const back = await backend.read(id)
    if (back !== json) throw new Error('verify failed')
  } catch (e) {
    await backend.remove(id).catch(() => {})
    throw Object.assign(new Error(`snapshot failed: ${e instanceof Error ? e.message : String(e)}`), { status: 507, code: 'snapshot' })
  }
  await pruneSnapshots(now)
  return { id, at: now, count: Object.keys(notes).length }
}

export async function listVaultSnapshots(): Promise<PhoneSnapshot[]> {
  const out: PhoneSnapshot[] = []
  for (const id of await backend.list()) {
    const raw = await backend.read(id)
    if (!raw) continue
    try {
      const v = JSON.parse(raw) as { at: number; notes: Record<string, string> }
      out.push({ id, at: Number(v.at) || atOf(id), count: Object.keys(v.notes ?? {}).length })
    } catch {
      /* 손상된 파일은 건너뛴다 */
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

export async function readVaultSnapshot(id: string): Promise<Record<string, string> | null> {
  if (!/^[0-9TZ-]+$/.test(id)) return null
  const raw = await backend.read(id)
  if (!raw) return null
  try {
    return (JSON.parse(raw) as { notes: Record<string, string> }).notes ?? null
  } catch {
    return null
  }
}

async function pruneSnapshots(now: number) {
  const list = await listVaultSnapshots()
  for (let i = 0; i < list.length; i++) if (i >= 3 || now - list[i].at > 30 * DAY) await backend.remove(list[i].id)
}
