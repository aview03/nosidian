// 비밀값(PC 연결 토큰·폰에 저장한 API 키)을 안드로이드 Keystore 보안 저장소에 두는 계층.
//  - 안드로이드 앱: 비밀 필드는 네이티브 SecureStore(Keystore AES-GCM)에만 저장하고, 웹뷰 localStorage 의 레코드에서는 뺀다.
//  - 그 밖(웹·PC 앱): 보안 저장소가 없으므로 지금까지처럼 localStorage 에 그대로 둔다(PC 앱의 API 키는 메인 프로세스 safeStorage 가 따로 맡는다).
//  - 기존 코드는 동기 함수(loadXxx)를 쓰므로, 앱 시작 때 한 번(hydrateSecrets) 복호화해 메모리 캐시에 올리고 이후엔 캐시에서 읽는다.
//  - 기존 평문 값은 시작할 때 **확인한 뒤에만** 보안 저장소로 옮기고 평문을 지운다(옮기기에 실패하면 평문을 그대로 둔다 — 값을 잃지 않는다).
//  - 키가 무효가 되면(백업 복원·기기 이전) 해당 값은 사라지고 "연결 안 됨"으로 돌아간다 — 다시 연결하면 된다. 평문으로 되돌리지 않는다.
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface SecureBackend {
  set(o: { key: string; value: string }): Promise<void>
  get(o: { key: string }): Promise<{ value: string | null; invalid?: boolean }>
  remove(o: { key: string }): Promise<void>
}

const Native = registerPlugin<SecureBackend>('SecureStore')
let backend: SecureBackend | null = Capacitor.isNativePlatform() ? Native : null
/** 시험·특수 환경용: 보안 저장소 구현을 바꾼다(null 이면 보안 저장소 없음) */
export function setSecureBackend(b: SecureBackend | null) {
  backend = b
  cache.clear()
  hydrated = false
}
export const secureAvailable = () => backend !== null

/** 보안 저장소에 둘 필드를 가진 localStorage 레코드 */
export interface SecretSpec {
  /** localStorage 키 */
  storageKey: string
  /** 레코드 안의 비밀 필드 이름 */
  field: string
  /** 보안 저장소 안에서의 이름(영문·숫자·._-) */
  secretName: string
  /** true 면 비밀이 없는 레코드는 쓸 수 없다(토큰). false 면 비밀 없이도 유효(API 키 없는 로컬 서버) */
  required: boolean
}

const cache = new Map<string, string>()
const specs = new Map<string, SecretSpec>()
const listeners = new Set<() => void>()
let hydrated = false

/** 보안 저장소를 쓰는 레코드를 등록한다(시작할 때 이전·복호화 대상) */
export function registerSecret(spec: SecretSpec) {
  specs.set(spec.secretName, spec)
}
/** 복호화·이전이 끝났을 때 불린다(모듈 로드 때 읽어 둔 화면 상태를 다시 읽게 하는 용도) */
export function onSecretsReady(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

const readRaw = (key: string): Record<string, unknown> | null => {
  try {
    const raw = localStorage.getItem(key)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
const writeRaw = (key: string, v: Record<string, unknown>) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}

/**
 * 시작할 때 한 번: 보안 저장소의 값을 캐시로 읽고, 아직 평문으로 남은 값을 옮긴다.
 * 어느 단계에서 실패해도 던지지 않는다(앱은 계속 뜨고, 평문이 남아 있으면 그대로 쓴다).
 */
export async function hydrateSecrets(): Promise<void> {
  const b = backend
  if (b) {
    for (const spec of specs.values()) {
      try {
        const got = await b.get({ key: spec.secretName })
        if (got.value) cache.set(spec.secretName, got.value)
        const rec = readRaw(spec.storageKey)
        const plain = rec && typeof rec[spec.field] === 'string' ? (rec[spec.field] as string) : ''
        if (plain) {
          // 평문 → 보안 저장소: 쓰고, 다시 읽어 같은지 확인한 뒤에만 평문을 지운다
          await b.set({ key: spec.secretName, value: plain })
          const check = await b.get({ key: spec.secretName })
          if (check.value === plain) {
            cache.set(spec.secretName, plain)
            const { [spec.field]: _drop, ...rest } = rec!
            void _drop
            writeRaw(spec.storageKey, rest)
          }
        } else if (rec && !got.value && spec.required) {
          // 레코드는 있는데 비밀이 없다(키 무효·복원): 쓸 수 없는 연결이므로 정리한다 — 다시 연결하면 된다
          localStorage.removeItem(spec.storageKey)
        }
      } catch {
        /* 이 항목은 이번 실행에서 보안 저장소를 쓰지 못했다: 평문이 남아 있으면 그대로 쓰인다 */
      }
    }
  }
  hydrated = true
  for (const cb of listeners) cb()
}
export const secretsHydrated = () => hydrated

/** 레코드를 읽는다. 보안 저장소를 쓰면 비밀 필드를 캐시에서 합쳐 돌려준다. 쓸 수 없는 레코드(required 인데 비밀 없음)는 null */
export function readSecretRecord<T extends Record<string, unknown>>(spec: SecretSpec): T | null {
  const v = readRaw(spec.storageKey)
  if (!v) return null
  if (!backend) return spec.required && !v[spec.field] ? null : (v as T)
  const secret = cache.get(spec.secretName) || (typeof v[spec.field] === 'string' ? (v[spec.field] as string) : '') // 아직 이전 전의 평문도 읽는다
  if (!secret) return spec.required ? null : ({ ...v } as T)
  return { ...v, [spec.field]: secret } as T
}

/**
 * 레코드를 저장한다. 보안 저장소를 쓰면 비밀 필드는 localStorage 에 쓰지 않고 보안 저장소(와 캐시)에만 둔다.
 * 보안 저장소에 쓰지 못하면 값을 잃지 않도록 평문으로 되돌려 저장한다(저장 실패를 조용히 삼키지는 않는다: 경고를 남긴다).
 */
export function writeSecretRecord(spec: SecretSpec, record: Record<string, unknown>) {
  const secret = typeof record[spec.field] === 'string' ? (record[spec.field] as string) : ''
  const b = backend
  if (!b) return writeRaw(spec.storageKey, record)
  const { [spec.field]: _s, ...rest } = record
  void _s
  if (!secret) {
    cache.delete(spec.secretName)
    writeRaw(spec.storageKey, rest)
    void b.remove({ key: spec.secretName }).catch(() => {})
    return
  }
  cache.set(spec.secretName, secret)
  writeRaw(spec.storageKey, rest)
  void b.set({ key: spec.secretName, value: secret }).catch((e) => {
    console.warn('secure store write failed; keeping the value in app storage', e instanceof Error ? e.message : e)
    writeRaw(spec.storageKey, record)
  })
}

export function clearSecretRecord(spec: SecretSpec) {
  cache.delete(spec.secretName)
  try {
    localStorage.removeItem(spec.storageKey)
  } catch {
    /* noop */
  }
  void backend?.remove({ key: spec.secretName }).catch(() => {})
}
