// "내 PC 폴더" Provider: PC 앱의 Vault 가 호스트 폴더(PC 디스크의 평범한 폴더)와 동기화되게 한다. 기존 Provider 인터페이스를 그대로 구현한다 —
// 동기화 엔진(받기 → 병합 → 올리기, 충돌·삭제 처리)은 클라우드와 같은 코드가 쓴다. 폴더 접근은 메인 프로세스(hostStore)가 하고, 여기서는 IPC 만 부른다.
//  - 올리기는 조건부다: 로컬 노트가 마지막으로 본 rev(baseRev)를 같이 보낸다. 호스트의 rev 가 달라졌으면 409 → 동기화가 한 번 다시 받아 합친 뒤 올린다.
//  - 삭제 기록(tombstone)이 있는 경로에 이 PC 앱이 새로 만들 때는 그 tombstone rev 를 baseRev 로 쓴다(이 앱이 삭제를 이미 알고 있기 때문).
//    폰 같은 다른 기기는 자신이 본 rev 만 쓸 수 있다 — 오래된 사본이 파일을 되살릴 수 없다(v1.41).
import { desktop, type HostApi } from '../externalIO'
import { t } from '../i18n'
import { SyncError, type Provider, type PushChange, type RemoteEntry } from './types'

type Res<T> = ({ ok: true } & T) | { ok: false; status: number; code?: string; error: string; currentRev?: string | null; deleted?: boolean }

function unwrap<T>(r: Res<T>): T {
  if (!r.ok) {
    const friendly = r.code === 'noFolder' ? t('호스트 폴더가 지정돼 있지 않아요') : r.code === 'busy' ? t('호스트 폴더를 다른 프로그램이 쓰고 있어요') : r.code === 'noSpace' ? t('저장 공간이 부족해요') : r.error
    throw Object.assign(new SyncError(friendly, r.status), { code: r.code, currentRev: r.currentRev, deleted: r.deleted })
  }
  return r
}
const utf8 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function hostProvider(): Provider {
  const api = (): HostApi => {
    const h = desktop()?.host
    if (!h) throw new SyncError(t('이 연결은 PC 앱에서만 쓸 수 있어요'), 0)
    return h
  }
  let tombs = new Map<string, string>()
  let seq = 0
  return {
    label: t('내 PC 폴더'),
    async test() {
      const st = unwrap(await api().status()) as { configured?: boolean; unavailable?: boolean; error?: string }
      if (!st.configured) throw new SyncError(t('호스트 폴더를 먼저 골라 주세요'), 412)
      if (st.unavailable) throw new SyncError(st.error || t('호스트 폴더를 열 수 없어요'), 423)
    },
    async list() {
      const r = unwrap(await api().list()) as { seq: number; entries: { path: string; rev: string; size: number }[]; tombs: { path: string; rev: string }[] }
      seq = r.seq
      tombs = new Map(r.tombs.map((x) => [x.path, x.rev]))
      return { entries: r.entries.map((e): RemoteEntry => ({ path: e.path, rev: e.rev, id: e.rev, size: e.size })) }
    },
    async readText(e) {
      return utf8((unwrap(await api().read(e.path)) as { b64: string }).b64)
    },
    async readBase64(e) {
      return (unwrap(await api().read(e.path)) as { b64: string }).b64
    },
    async push(changes: PushChange[]) {
      const items = changes.map((c) => {
        if (c.content === null) return { path: c.path, del: true, baseRev: c.baseRev ?? null }
        const created = c.baseRev == null
        return { path: c.path, b64: c.b64 ?? toB64(c.content), baseRev: created ? (tombs.get(c.path) ?? null) : (c.baseRev ?? null) }
      })
      const r = unwrap(await api().push(items)) as { revs: Record<string, string> }
      return new Map(Object.entries(r.revs))
    },
    async afterSync() {
      unwrap(await api().ack(seq))
      void api().gc().catch(() => {}) // 90일이 지난 휴지통 파일과(모든 기기가 확인한) 삭제 기록을 정리한다
    },
  }
}
