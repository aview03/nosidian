// "내 PC" Provider(폰): 폰의 Vault 가 PC 호스트 폴더와 동기화된다. 기존 Provider 인터페이스를 그대로 구현한다 — 동기화 엔진(받기 → 병합 → 올리기, 충돌·삭제 처리)은 클라우드·PC 폴더와 같은 코드다.
//  - 올리기는 조건부다: 마지막으로 본 rev(baseRev)를 보낸다. PC 에서 먼저 바뀌었으면 409 → 한 번 다시 받아 합친 뒤 올린다. 덮어쓰지 않는다.
//  - 이 휴대폰에 쓰기 권한이 없으면(기본) 받기만 하고, 올리기는 안내(code noWrite)한다. 로컬 변경은 그대로 남아 권한을 받은 뒤 올라간다.
//  - 삭제는 PC 로 전파되지 않는다(삭제 권한은 별도이고 아직 꺼져 있다): 폰에서 지운 파일은 다음에 PC 에서 다시 받아지며, 그 사실을 알린다.
//  - 삭제 기록(tombstone)이 있는 경로를 이 폰이 다시 만들 때는 그 rev 를 쓴다 — 폰이 목록으로 삭제를 알고 있고, 내가 고친 노트를 살리는 쪽(삭제 vs 수정)이다.
//    오래된 깨끗한 사본은 동기화의 받기 단계에서 로컬에서 지워지므로 되살아나지 않는다.
import { callHost, loadPcHost, pingHost, HostCallError } from '../pcHost'
import { t } from '../i18n'
import { conflictOf, SyncError, type Provider, type PushChange, type RemoteEntry } from './types'

const utf8 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function pcHostProvider(): Provider & { notice(): string | null } {
  const link = () => {
    const l = loadPcHost()
    if (!l) throw new SyncError(t('내 PC와 연결돼 있지 않아요'), 412)
    return l
  }
  let tombs = new Map<string, string>()
  let seq = 0
  let perms = { write: false, delete: false }
  let permsKnown = false // 이 Provider 가 아직 권한을 확인하지 않았다면 올리기 직전에 확인한다(파일 올리기처럼 목록 없이 push 만 부르는 경로)
  let note: string | null = null
  return {
    label: t('내 PC'),
    async test() {
      perms = (await pingHost(link())).perms
      permsKnown = true
    },
    async list() {
      note = null
      perms = (await pingHost(link())).perms // 내 권한과 PC 의 현재 주소를 먼저 확인한다
      permsKnown = true
      const r = (await callHost(link(), '/list', {})) as { seq: number; entries: { path: string; rev: string; size: number }[]; tombs: { path: string; rev: string }[] }
      seq = r.seq
      tombs = new Map(r.tombs.map((x) => [x.path, x.rev]))
      return { entries: r.entries.map((e): RemoteEntry => ({ path: e.path, rev: e.rev, id: e.rev, size: e.size })) }
    },
    async readText(e) {
      return utf8(((await callHost(link(), '/get', { path: e.path }, 120000)) as { b64: string }).b64)
    },
    async readBase64(e) {
      return ((await callHost(link(), '/get', { path: e.path }, 120000)) as { b64: string }).b64
    },
    async push(changes: PushChange[]) {
      const revs = new Map<string, string>()
      const puts = changes.filter((c) => c.content !== null)
      const dels = changes.filter((c) => c.content === null)
      if (!permsKnown && changes.length) {
        perms = (await pingHost(link())).perms
        permsKnown = true
      }
      if (!perms.write && changes.length) throw new HostCallError(t('이 PC에서 이 휴대폰의 쓰기를 허용해야 올릴 수 있어요'), 403, { code: 'noWrite' })
      for (const c of puts) {
        const created = c.baseRev == null
        const r = (await callHost(link(), '/put', { path: c.path, b64: c.b64 ?? toB64(c.content as string), baseRev: created ? (tombs.get(c.path) ?? null) : c.baseRev }, 120000)) as { rev: string }
        revs.set(c.path, r.rev)
      }
      let skipped = 0
      let keptByPc = 0
      for (const c of dels) {
        if (!perms.delete) {
          skipped++ // 이 휴대폰의 삭제는 PC 로 전파되지 않는다(PC 에서 기기별로 허용해야 한다)
          continue
        }
        try {
          const r = (await callHost(link(), '/delete', { path: c.path, baseRev: c.baseRev ?? null })) as { rev: string }
          revs.set(c.path, r.rev)
        } catch (e) {
          const cf = conflictOf(e)
          if (!cf && (e as { status?: number }).status !== 404) throw e
          if (cf && !cf.deleted) {
            // 내가 지우려던 파일을 PC 에서 그새 고쳤다: 삭제와 수정이 겹치면 수정을 살린다(데이터 보존 우선). 지우지 않고, 다음 동기화에서 PC 것을 다시 받는다
            keptByPc++
          } else if (cf?.currentRev) {
            revs.set(c.path, cf.currentRev) // 이미 지워져 있다 — 목적은 이뤄졌다
          }
        }
      }
      const notes: string[] = []
      if (skipped) notes.push(t('PC가 삭제를 허용하지 않아서 지운 파일 {n}개는 다음에 PC에서 다시 받아져요', { n: skipped }))
      if (keptByPc) notes.push(t('PC에서 먼저 바뀐 파일 {n}개는 지우지 않았어요. 다음에 PC 것을 다시 받아요', { n: keptByPc }))
      if (notes.length) note = notes.join(' · ')
      return revs
    },
    async afterSync() {
      await callHost(link(), '/ack', { seq })
    },
    notice: () => note,
  }
}
