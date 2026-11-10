// 자동 관리 상태의 저장: vault 마다 별도 IndexedDB(노트 저장소와 분리). 재시도·중복 실행 방지용 기기별 실행 상태일 뿐이고,
// 업무 데이터는 아니다 — 지워도 노트는 그대로이며, 다음 실행 때 기준선부터 다시 만든다.
import { openDB } from 'idb'
import { emptyState, normalizeSettings, type AutoSettings, type AutoState } from './autoTriggers'

const dbName = (vault: string) => `nosidian-auto-${vault}`
const open = (vault: string) => openDB(dbName(vault), 1, { upgrade: (d) => void d.createObjectStore('kv') })

export async function loadAuto(vault: string): Promise<AutoState> {
  try {
    const d = await open(vault)
    const v = (await d.get('kv', 'state')) as Partial<AutoState> | undefined
    d.close()
    if (!v || v.v !== 1) return emptyState()
    const e = emptyState()
    return {
      ...e,
      ...v,
      seen: v.seen && typeof v.seen === 'object' ? v.seen : {},
      baselined: Array.isArray(v.baselined) ? v.baselined : [],
      queue: Array.isArray(v.queue) ? v.queue : [],
      usage: Array.isArray(v.usage) ? v.usage : [],
      log: Array.isArray(v.log) ? v.log : [],
      analyzed: v.analyzed && typeof v.analyzed === 'object' ? v.analyzed : {},
      aiTouched: v.aiTouched && typeof v.aiTouched === 'object' ? v.aiTouched : {},
    }
  } catch {
    return emptyState()
  }
}

export async function saveAuto(vault: string, st: AutoState): Promise<void> {
  try {
    const d = await open(vault)
    await d.put('kv', st, 'state')
    d.close()
  } catch {
    /* 저장하지 못하면 이번 실행에서만 유지 — 다음에 기준선부터 다시 만든다 */
  }
}

export async function dropAuto(vault: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(dbName(vault))
    r.onsuccess = r.onerror = r.onblocked = () => resolve()
  })
}

const SKEY = 'nosidian.auto.settings'
export function loadAutoSettings(): AutoSettings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(SKEY) ?? 'null'))
  } catch {
    return normalizeSettings(null)
  }
}
export function saveAutoSettings(s: AutoSettings) {
  try {
    localStorage.setItem(SKEY, JSON.stringify(s))
  } catch {
    /* noop */
  }
}
