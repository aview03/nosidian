import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { DEFAULT_VAULT_ID, type NoteFile } from './types'

interface Schema extends DBSchema {
  files: { key: string; value: NoteFile }
  assets: { key: string; value: { path: string; sha: string | null; id?: string; size?: number; b64?: string; mime?: string } }
}

// vault 마다 별도 IndexedDB. 이전 버전의 단일 저장소('amsidian')는 기본 vault 가 그대로 이어받는다.
export const dbName = (vaultId: string) => (vaultId === DEFAULT_VAULT_ID ? 'amsidian' : `amsidian-${vaultId}`)

let current = DEFAULT_VAULT_ID

// 같은 origin 의 다른 창(위젯 ↔ 본 창)이 같은 IndexedDB 를 쓰므로, 쓴 쪽이 알리고 받은 쪽이 다시 읽는다
const WIN_ID = Math.random().toString(36).slice(2)
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nosidian-db') : null
const ping = () => bc?.postMessage({ from: WIN_ID, vault: current })
export function onDbChange(cb: () => void) {
  if (!bc) return () => {}
  const h = (e: MessageEvent) => e.data?.from !== WIN_ID && e.data?.vault === current && cb()
  bc.addEventListener('message', h)
  return () => bc.removeEventListener('message', h)
}
let dbp: Promise<IDBPDatabase<Schema>> | null = null
function db() {
  dbp ??= openDB<Schema>(dbName(current), 1, {
    upgrade(d) {
      d.createObjectStore('files', { keyPath: 'path' })
      d.createObjectStore('assets', { keyPath: 'path' })
    },
  })
  return dbp
}

export const store = {
  /** 이후의 모든 읽기/쓰기를 이 vault 의 저장소로 */
  async use(vaultId: string) {
    if (vaultId === current && dbp) return
    if (dbp) (await dbp).close()
    dbp = null
    current = vaultId
  },
  /** vault 의 저장소 자체를 삭제 (활성 vault 면 먼저 닫는다) */
  async drop(vaultId: string) {
    if (vaultId === current && dbp) {
      ;(await dbp).close()
      dbp = null
    }
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(dbName(vaultId))
      r.onsuccess = r.onerror = r.onblocked = () => resolve()
    })
  },
  async allFiles() {
    return (await db()).getAll('files')
  },
  async putFile(f: NoteFile) {
    const r = await (await db()).put('files', f)
    ping()
    return r
  },
  async putFiles(fs: NoteFile[]) {
    const d = await db()
    const tx = d.transaction('files', 'readwrite')
    await Promise.all([...fs.map((f) => tx.store.put(f)), tx.done])
    ping()
  },
  async delFile(path: string) {
    const r = await (await db()).delete('files', path)
    ping()
    return r
  },
  async allAssets() {
    return (await db()).getAll('assets')
  },
  async putAsset(a: Schema['assets']['value']) {
    return (await db()).put('assets', a)
  },
  async delAsset(path: string) {
    return (await db()).delete('assets', path)
  },
  async clearAll() {
    const d = await db()
    await d.clear('files')
    await d.clear('assets')
  },
}
