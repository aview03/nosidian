// 내가 연결해 둔 AI 들(로컬 모델·내 서버·API 키 모델)의 목록 저장소. 설계: docs/AI-CONNECTIONS.md
//
// - 연결마다 localStorage 레코드가 하나(`nosidian.llm.<id>`)이고, 비밀(API 키·중계 토큰)은 기존 secureStore 규칙대로 **연결별 이름**으로 보안 저장소에 둔다.
//   목록(순서·선택)은 비밀이 아닌 인덱스 하나(`nosidian.aiConnections`)에 둔다.
// - 예전의 한 칸 설정(`nosidian.llm`)은 앱이 처음 뜰 때 **레코드 이름만 바꿔서** 연결 1개(id `c_legacy`)로 옮긴다.
//   비밀은 같은 이름(`llm.apiKey`)·같은 파일(PC 의 `llm-key.bin`)을 그대로 쓰므로 옮기는 과정에서 키가 움직이지 않는다 → 잃을 일이 없다.
//   옛 레코드는 `nosidian.llm.bak`(비밀 없는 사본)로 남겨 둔다(되돌릴 수 있게; 다음 버전에서 정리).
// - 이 파일은 llm.ts 의 값을 가져오지 않는다(llm.ts 가 이 파일을 쓴다). 종류(kind) 검증은 llm.ts 쪽에서 한다.
import { clearSecretRecord, readSecretRecord, registerSecret, writeSecretRecord, type SecretSpec } from './secureStore'

/** 예전 한 칸 설정이 옮겨 간 연결의 id. 비밀 이름·PC 키 파일이 옛 것과 같다 */
export const LEGACY_ID = 'c_legacy'
/** 연결 수 상한 */
export const MAX_CONNECTIONS = 8
/** 연결이 바뀌었음을 알리는 window 이벤트(화면·중계가 다시 읽는다). 이름은 예전 것을 그대로 쓴다 */
export const CHANGED_EVENT = 'nosidian-llm-changed'

const INDEX_KEY = 'nosidian.aiConnections'
const LEGACY_KEY = 'nosidian.llm'
const BACKUP_KEY = 'nosidian.llm.bak'
const ID_RE = /^c_[a-z0-9]{1,16}$/

/** 내가 연결해 둔 AI 하나 (Claude 구독은 여기 없다 — 항상 있는 내장 선택지) */
export interface AiConnection {
  id: string
  /** 'ollama' | 'custom' | 'openai' | 'anthropic' | 'gemini' (검증은 llm.ts) */
  kind: string
  /** 화면에 보일 이름(없으면 종류로 만든다) */
  label?: string
  baseUrl: string
  /** 이 연결에서 기본으로 쓸 모델 */
  model: string
  apiKey?: string
  keyStored?: boolean
  viaPc?: boolean
  /** 마지막으로 가져온 모델 목록(없거나 낡아도 `model` 은 쓸 수 있다) */
  models?: { list: string[]; at: number }
  /** PC: 이 연결을 휴대폰에 빌려줄까(기본 꺼짐) */
  shareToPhone?: boolean
}

export interface Selected {
  conn: string
  model?: string
}
interface Index {
  v: 2
  ids: string[]
  selected: Selected | null
}

const recordKey = (id: string) => `nosidian.llm.${id}`
export const secretNameOf = (id: string) => (id === LEGACY_ID ? 'llm.apiKey' : `llm.apiKey.${id}`)
const specOf = (id: string): SecretSpec => ({ storageKey: recordKey(id), field: 'apiKey', secretName: secretNameOf(id), required: false })

// ── 인덱스 ──
function readIndex(): Index | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Index>
    if (!v || v.v !== 2 || !Array.isArray(v.ids)) return null
    const ids = [...new Set(v.ids.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)))].slice(0, MAX_CONNECTIONS)
    const s = v.selected
    const selected = s && typeof s.conn === 'string' && ids.includes(s.conn) ? { conn: s.conn, ...(typeof s.model === 'string' && s.model ? { model: s.model } : {}) } : null
    return { v: 2, ids, selected }
  } catch {
    return null
  }
}
function writeIndex(i: Index) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(i))
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}
const emit = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT))
}

// ── 예전 한 칸 설정 → 연결 1개 ──
/** 예전 설정이 있고 아직 목록이 없으면 레코드 이름만 바꿔 옮긴다. 여러 번 불러도 안전하다(이미 옮겼으면 아무것도 안 한다) */
export function migrateLegacy(): boolean {
  try {
    if (localStorage.getItem(INDEX_KEY)) return false
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return false
    const old = JSON.parse(raw) as Record<string, unknown>
    if (!old || typeof old !== 'object' || typeof old.kind !== 'string') return false
    // 1) 새 레코드(평문 키가 있던 웹 환경에서는 키도 같이 — 어차피 같은 평문), 2) 인덱스, 3) 옛 레코드는 비밀 없는 사본으로 보관하고 지운다
    localStorage.setItem(recordKey(LEGACY_ID), raw)
    const { apiKey: _k, ...noSecret } = old
    void _k
    localStorage.setItem(BACKUP_KEY, JSON.stringify(noSecret))
    writeIndex({ v: 2, ids: [LEGACY_ID], selected: { conn: LEGACY_ID, ...(typeof old.model === 'string' && old.model ? { model: old.model } : {}) } })
    localStorage.removeItem(LEGACY_KEY)
    registerSecret(specOf(LEGACY_ID)) // 비밀 이름(llm.apiKey)은 그대로라 시작할 때 hydrateSecrets 가 같은 키를 읽는다
    return true
  } catch {
    return false // 옛 설정을 건드리지 않은 채 두면 loadLegacyFallback 이 계속 읽는다
  }
}

/** 이전에 실패했으면(인덱스가 없고 옛 레코드가 남아 있으면) 옛 한 칸을 연결 1개처럼 읽는다 */
function legacyFallback(): AiConnection | null {
  try {
    if (localStorage.getItem(INDEX_KEY) || !localStorage.getItem(LEGACY_KEY)) return null
    const v = readSecretRecord<Record<string, unknown>>({ storageKey: LEGACY_KEY, field: 'apiKey', secretName: secretNameOf(LEGACY_ID), required: false })
    if (!v || typeof v.kind !== 'string') return null
    return toConnection(LEGACY_ID, v)
  } catch {
    return null
  }
}

function toConnection(id: string, v: Record<string, unknown>): AiConnection {
  const models = v.models as { list?: unknown; at?: unknown } | undefined
  return {
    id,
    kind: String(v.kind),
    ...(typeof v.label === 'string' && v.label ? { label: v.label } : {}),
    baseUrl: String(v.baseUrl ?? ''),
    model: String(v.model ?? ''),
    ...(typeof v.apiKey === 'string' && v.apiKey ? { apiKey: v.apiKey } : {}),
    ...(v.keyStored ? { keyStored: true } : {}),
    ...(v.viaPc ? { viaPc: true } : {}),
    ...(models && Array.isArray(models.list) && typeof models.at === 'number' ? { models: { list: models.list.map(String), at: models.at } } : {}),
    ...(v.shareToPhone === true ? { shareToPhone: true } : {}),
  }
}

// 모듈을 처음 불러올 때: 옮기고, 있는 연결들의 비밀 이름을 등록한다(앱 시작 때 hydrateSecrets 가 복호화한다)
migrateLegacy()
{
  const i = readIndex()
  if (i) for (const id of i.ids) registerSecret(specOf(id))
}

// ── 읽기 ──
export function listConnections(): AiConnection[] {
  const i = readIndex()
  if (!i) {
    const l = legacyFallback()
    return l ? [l] : []
  }
  const out: AiConnection[] = []
  for (const id of i.ids) {
    const rec = readSecretRecord<Record<string, unknown>>(specOf(id))
    if (rec && typeof rec.kind === 'string') out.push(toConnection(id, rec))
  }
  return out
}
export const connectionById = (id: string) => listConnections().find((c) => c.id === id) ?? null
export function getSelected(): Selected | null {
  const i = readIndex()
  if (!i) return legacyFallback() ? { conn: LEGACY_ID } : null
  return i.selected
}
/** 지금 선택된 연결(없으면 첫 연결, 연결이 없으면 null). 모델은 선택값이 있으면 그것으로 */
export function selectedConnection(): AiConnection | null {
  const all = listConnections()
  if (!all.length) return null
  const s = getSelected()
  const c = (s && all.find((x) => x.id === s.conn)) || all[0]
  return s?.model && s.conn === c.id ? { ...c, model: s.model } : c
}

// ── 쓰기 ──
export function newConnectionId(): string {
  const taken = new Set(readIndex()?.ids ?? [])
  for (;;) {
    const id = 'c_' + Math.random().toString(36).slice(2, 10).padEnd(8, '0')
    if (ID_RE.test(id) && !taken.has(id)) return id
  }
}

function persist(c: AiConnection) {
  const { id, ...rest } = c
  writeSecretRecord(specOf(id), { ...rest })
}

/** 연결을 추가하고(상한 MAX_CONNECTIONS) 바로 선택한다. id 를 주면 그 id 로(비밀을 먼저 그 id 로 저장해 둔 경우) */
export function addConnection(c: Omit<AiConnection, 'id'> & { id?: string }): AiConnection {
  migrateLegacy()
  const i = readIndex() ?? { v: 2 as const, ids: [], selected: null }
  const id = c.id && ID_RE.test(c.id) ? c.id : newConnectionId()
  if (i.ids.includes(id)) {
    const { id: _i, ...patch } = c
    void _i
    return updateConnection(id, patch)!
  }
  if (i.ids.length >= MAX_CONNECTIONS) throw new Error('too many connections')
  const conn: AiConnection = { ...c, id }
  registerSecret(specOf(id))
  persist(conn)
  writeIndex({ v: 2, ids: [...i.ids, id], selected: { conn: id, ...(conn.model ? { model: conn.model } : {}) } })
  emit()
  return conn
}

/** 연결의 내용을 고친다(주소·종류가 바뀌면 모델 목록 캐시는 버린다). id 는 바뀌지 않는다 */
export function updateConnection(id: string, patch: Partial<Omit<AiConnection, 'id'>>): AiConnection | null {
  const cur = connectionById(id)
  if (!cur) return null
  const next: AiConnection = { ...cur, ...patch, id }
  for (const k of ['apiKey', 'keyStored', 'viaPc', 'models', 'shareToPhone', 'label'] as const) if (patch[k] === undefined && k in patch) delete next[k]
  if ((patch.baseUrl !== undefined && patch.baseUrl !== cur.baseUrl) || (patch.kind !== undefined && patch.kind !== cur.kind)) if (patch.models === undefined) delete next.models
  registerSecret(specOf(id))
  persist(next)
  const i = readIndex()
  if (i && i.selected?.conn === id && patch.model !== undefined) writeIndex({ ...i, selected: { conn: id, ...(next.model ? { model: next.model } : {}) } })
  emit()
  return next
}

/** 연결을 없앤다(비밀도 함께). 선택돼 있던 연결이면 남은 첫 연결로 넘어간다. PC 의 키 파일은 호출한 쪽이 따로 지운다 */
export function removeConnection(id: string) {
  const i = readIndex()
  if (!i) {
    // 옮기기 전(실패 상태)의 옛 한 칸이면 그것을 지운다
    if (id === LEGACY_ID) {
      clearSecretRecord({ storageKey: LEGACY_KEY, field: 'apiKey', secretName: secretNameOf(LEGACY_ID), required: false })
      emit()
    }
    return
  }
  if (!i.ids.includes(id)) return
  clearSecretRecord(specOf(id))
  const ids = i.ids.filter((x) => x !== id)
  const selected = i.selected?.conn === id ? (ids[0] ? { conn: ids[0] } : null) : i.selected
  writeIndex({ v: 2, ids, selected })
  emit()
}

export function setSelected(conn: string | null, model?: string) {
  const i = readIndex()
  if (!i) return
  if (conn !== null && !i.ids.includes(conn)) return
  writeIndex({ ...i, selected: conn ? { conn, ...(model ? { model } : {}) } : null })
  emit()
}

/** 시험용: 이 모듈의 상태를 비운다 */
export function _resetForTests() {
  try {
    const i = readIndex()
    for (const id of i?.ids ?? []) clearSecretRecord(specOf(id))
    for (const k of [INDEX_KEY, LEGACY_KEY, BACKUP_KEY]) localStorage.removeItem(k)
  } catch {
    /* noop */
  }
}
