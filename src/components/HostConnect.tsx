// 설정 > 노트와 동기화 (PC 앱): "이 PC의 폴더로 맞추기(클라우드 없이)".
//  1) 호스트 폴더 고르기 → 2) 미리보기(PC 앱 Vault 와 폴더의 차이) → 3) 사용자가 확인하고 시작 → 스냅샷을 만들고 반영.
// 확인 전에는 아무것도 덮어쓰거나 지우지 않는다. 최초 연결에는 삭제가 없다. 되돌리려면 "연결 끊기"(노트는 그대로)와 스냅샷 복원.
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { t } from '../lib/i18n'
import { desktop, type HostServerStatus, type HostStatus } from '../lib/externalIO'
import { useApp } from '../lib/app'
import { confirmAsk } from '../lib/dialog'
import { applyHostConnect, leaveHost, previewHostConnect, restoreVaultFromSnapshot, type Choice, type ConnectPlan } from '../lib/hostConnect'
import { Icon } from './Icon'

const PICK_ERR: Record<string, string> = {
  'drive root': '드라이브 전체는 쓸 수 없어요. 폴더를 하나 골라 주세요',
  'too broad': '이 폴더는 너무 넓어요(홈 폴더·앱 폴더). 안의 폴더를 골라 주세요',
  'system folder': '시스템 폴더는 쓸 수 없어요',
  'not found': '폴더를 찾을 수 없어요',
  'not a directory': '폴더가 아니에요',
  'overlaps share': '"내 휴대폰에서 이 PC의 폴더 보기"의 공유 폴더와 겹쳐요. 다른 폴더를 골라 주세요',
}

const SHOW = 12
function PathList({ title, paths, note }: { title: string; paths: string[]; note?: string }) {
  if (!paths.length) return null
  return (
    <details className="hc-group">
      <summary>{title} <span className="wrk-count">{paths.length}</span></summary>
      {note && <p className="hint small">{note}</p>}
      <ul>
        {paths.slice(0, SHOW).map((p) => <li key={p}>{p}</li>)}
        {paths.length > SHOW && <li className="hint">{t('… 외 {n}개', { n: paths.length - SHOW })}</li>}
      </ul>
    </details>
  )
}

export function HostConnectDialog({ onClose }: { onClose: () => void }) {
  const api = desktop()?.host
  const [st, setSt] = useState<HostStatus | null>(null)
  const [plan, setPlan] = useState<ConnectPlan | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (!api) return
    void api.status().then((r) => r.ok && setSt(r))
  }, [api])
  if (!api) return null

  const pick = async () => {
    setErr('')
    const r = await api.pickDir()
    if (!r.ok) return setErr(r.error)
    setSt(r)
    setPlan(null)
    if (r.pickError) setErr(t(PICK_ERR[r.pickError] ?? '이 폴더는 쓸 수 없어요'))
  }
  const preview = async () => {
    setBusy(true)
    setErr('')
    try {
      const p = await previewHostConnect()
      setPlan(p)
      setChoices({})
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const start = async () => {
    if (!plan || !st?.dir) return
    setBusy(true)
    setErr('')
    try {
      const r = await applyHostConnect(plan, choices, st.dir)
      setDone(t('연결했어요. 올림 {up} · 받음 {down}{copies}', { up: r.uploaded, down: r.downloaded, copies: r.copies.length ? ' · ' + t('PC 사본 {n}개', { n: r.copies.length }) : '' }))
    } catch (e) {
      setErr((e as { code?: string }).code === 'noSpace' ? t('저장 공간이 부족해서 시작하지 않았어요. 공간을 만든 뒤 다시 해 주세요.') : t('시작하지 못했어요(아무것도 바뀌지 않았어요): {why}', { why: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }
  const total = plan ? plan.pcOnly.length + plan.hostOnly.length + plan.same.length + plan.differ.length : 0
  const unresolved = plan ? plan.differ.filter((p) => !choices[p]).length : 0

  return (
    <div className="ee-wrap" onClick={busy ? undefined : onClose}>
      <div className="ee hc" role="dialog" aria-label={t('이 PC의 폴더로 맞추기')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{t('이 PC의 폴더로 맞추기')}</h3>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>
        <div className="ee-body">
          {done ? (
            <>
              <p className="aiw-q">{done}</p>
              <p className="hint">{t('이제 "지금 동기화"로 이 PC의 폴더와 맞춰요. 폴더 안의 파일은 탐색기로도 열 수 있어요.')}</p>
              <button className="primary big" onClick={onClose}>{t('확인')}</button>
            </>
          ) : (
            <>
              <p className="hint">{t('클라우드 없이 이 PC의 폴더에 노트와 파일을 둡니다. 연결하기 전에 차이를 먼저 보여 드리고, 확인하시기 전에는 아무것도 덮어쓰거나 지우지 않아요.')}</p>
              <div className="kv"><span>{t('폴더')}</span>
                <span className="share-dir"><b title={st?.dir ?? ''}>{st?.dir ?? t('아직 없어요')}</b><button className="btn-link" disabled={busy} onClick={() => void pick()}>{st?.dir ? t('바꾸기') : t('폴더 고르기')}</button></span>
              </div>
              {st?.dir && <p className="hint small">{t('고른 폴더에 관리용 .nosidian 폴더가 만들어져요(수정하거나 지우지 마세요).')}</p>}
              {st?.rebuilt && <p className="hint small ai-warn">{t('이 폴더의 관리 정보가 손상돼 새로 만들었어요. 다른 기기는 다시 연결할 때 확인을 거쳐요.')}</p>}
              {st?.dir && !plan && <button className="primary big" disabled={busy} onClick={() => void preview()}>{busy ? t('확인하는 중…') : t('차이 미리 보기')}</button>}

              {plan && (
                <div className="hc-plan">
                  <p className="aiw-q">{t('미리 보기')}</p>
                  <ul className="hc-sum">
                    <li><b>{plan.pcOnly.length}</b> {t('PC 앱에만 있는 노트 → 폴더에 올려요')}</li>
                    <li><b>{plan.hostOnly.length}</b> {t('폴더에만 있는 노트 → PC 앱으로 받아요')}</li>
                    <li><b>{plan.same.length}</b> {t('같은 노트 → 그대로 맞춰요')}</li>
                    <li><b>{plan.differ.length}</b> {t('내용이 다른 노트 → 아래에서 골라 주세요')}</li>
                    {plan.hostOther.length > 0 && <li><b>{plan.hostOther.length}</b> {t('노트가 아닌 파일 → 파일 목록으로만 보여요')}</li>}
                  </ul>
                  <p className="hint small">{t('삭제는 하지 않아요. 시작하기 전에 폴더와 이 PC 앱의 노트를 스냅샷으로 저장하고, 저장하지 못하면 시작하지 않아요.')}</p>
                  {total === 0 && plan.hostOther.length === 0 && <p className="hint">{t('양쪽 모두 비어 있어요. 바로 연결할 수 있어요.')}</p>}

                  <PathList title={t('PC 앱에만 있는 노트')} paths={plan.pcOnly} />
                  {plan.revived.length > 0 && <p className="hint small ai-warn">{t('이 중 {n}개는 폴더에서 지워졌던 노트예요. 올리면 다시 생겨요.', { n: plan.revived.length })}</p>}
                  <PathList title={t('폴더에만 있는 노트')} paths={plan.hostOnly} />
                  <PathList title={t('노트가 아닌 파일')} paths={plan.hostOther} />

                  {plan.differ.length > 0 && (
                    <div className="hc-differ">
                      <div className="auto-sub">{t('내용이 다른 노트')}</div>
                      {plan.differ.length > 1 && (
                        <div className="hc-all">
                          <small>{t('모두:')}</small>
                          <button className="btn-link" onClick={() => setChoices(Object.fromEntries(plan.differ.map((p) => [p, 'pc' as Choice])))}>{t('PC 것')}</button>
                          <button className="btn-link" onClick={() => setChoices(Object.fromEntries(plan.differ.map((p) => [p, 'host' as Choice])))}>{t('폴더 것')}</button>
                          <button className="btn-link" onClick={() => setChoices(Object.fromEntries(plan.differ.map((p) => [p, 'both' as Choice])))}>{t('둘 다 보관')}</button>
                        </div>
                      )}
                      {plan.differ.map((p) => (
                        <div key={p} className="hc-row">
                          <b title={p}>{p}</b>
                          <div className="seg">
                            {(['pc', 'host', 'both'] as Choice[]).map((c) => (
                              <button key={c} className={choices[p] === c ? 'on' : ''} onClick={() => setChoices((cur) => ({ ...cur, [p]: c }))}>{c === 'pc' ? t('PC 것') : c === 'host' ? t('폴더 것') : t('둘 다')}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                      <p className="hint small">{t('"PC 것": 폴더의 파일을 PC 앱의 내용으로 바꿔요. "폴더 것": PC 앱의 내용을 폴더의 내용으로 바꿔요. "둘 다": 폴더 것을 받고 PC 앱의 내용은 "(PC 사본)" 노트로 남겨요. 어느 쪽이든 스냅샷에 원본이 남아요.')}</p>
                    </div>
                  )}

                  <button className="primary big" disabled={busy || unresolved > 0} onClick={() => void start()}>
                    {busy ? t('연결하는 중…') : unresolved > 0 ? t('{n}개를 먼저 골라 주세요', { n: unresolved }) : t('확인했어요, 시작하기')}
                  </button>
                </div>
              )}
              {err && <p className="hint small ai-warn">{err}</p>}
              <button className="link-btn" disabled={busy} onClick={onClose}>{t('취소')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 연결된 뒤(고급): 폴더 정보, 스냅샷에서 복원, 연결 끊기(노트는 그대로) */
export function HostPanel() {
  const api = desktop()?.host
  const [st, setSt] = useState<HostStatus | null>(null)
  const [snaps, setSnaps] = useState<{ id: string; at: number; files?: number; hasVault: boolean }[]>([])
  const say = useApp.getState().say
  useEffect(() => {
    if (!api) return
    void api.status().then((r) => r.ok && setSt(r))
    void api.snapshots().then((r) => r.ok && setSnaps(r.snapshots))
  }, [api])
  if (!api) return null
  return (
    <div className="hc-panel">
      <div className="kv"><span>{t('폴더')}</span><b className="share-dir" title={st?.dir ?? ''}>{st?.dir ?? '…'}</b></div>
      {st?.rebuilt && <p className="hint small ai-warn">{t('이 폴더의 관리 정보가 손상돼 새로 만들었어요.')}</p>}
      {st?.unavailable && <p className="hint small ai-warn">{st.error}</p>}
      <p className="hint small">{t('폴더의 파일을 탐색기에서 고치거나 옮기면 다음 동기화 때 반영돼요. 파일을 자동으로 열거나 실행하지 않아요.')}</p>
      <HostServerSection />
      {snaps.length > 0 && (
        <details className="more">
          <summary>{t('스냅샷에서 복원 ({n})', { n: snaps.length })}</summary>
          <ul className="hc-snaps">
            {snaps.map((s) => (
              <li key={s.id}>
                <span>{new Date(s.at).toLocaleString()}<small>{t('{n}개 파일', { n: s.files ?? 0 })}</small></span>
                {s.hasVault && (
                  <button
                    className="btn-link"
                    onClick={async () => {
                      if (!(await confirmAsk(t('이 스냅샷으로 복원할까요?'), t('스냅샷에 있던 PC 앱의 노트 내용으로 되돌려요(그 뒤에 만든 노트는 지우지 않아요). 되돌린 내용은 다음 동기화 때 폴더에 반영돼요.'), t('복원')))) return
                      try {
                        const n = await restoreVaultFromSnapshot(s.id)
                        say(t('{n}개 노트를 복원했어요', { n }))
                      } catch (e) {
                        say(e instanceof Error ? e.message : String(e))
                      }
                    }}
                  >
                    {t('복원')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button
        className="danger-link"
        onClick={async () => {
          if (await confirmAsk(t('폴더 연결을 끊을까요?'), t('이 PC 앱의 노트는 그대로 남고, 폴더의 파일도 지우지 않아요. 연결만 끊어요. 올리지 않은 변경은 노트에 남아 있어요.'), t('끊기'), true)) {
            leaveHost()
            await api.clear()
          }
        }}
      >
        {t('폴더 연결 끊기 (노트는 그대로)')}
      </button>
    </div>
  )
}

const ago = (ts: number) => {
  if (!ts) return t('아직 없어요')
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return t('방금')
  if (m < 60) return t('{n}분 전', { n: m })
  if (m < 1440) return t('{n}시간 전', { n: Math.round(m / 60) })
  return new Date(ts).toLocaleDateString()
}

/**
 * 휴대폰과 맞추기(이 PC가 호스트): 켜면 같은 와이파이의 내 휴대폰이 QR(또는 연결 문자열)로 짝을 맺고 이 폴더를 읽는다.
 * **쓰기는 기기별로 여기서 직접 허용해야** 한다(기본은 읽기만). 삭제 권한은 별도이고 이번 버전에서는 켤 수 없다. 언제든 끄거나 해제한다.
 */
function HostServerSection() {
  const api = desktop()?.hostsrv
  const [st, setSt] = useState<HostServerStatus | null>(null)
  const [qr, setQr] = useState('')
  const say = useApp.getState().say
  const refresh = useCallback(async () => {
    if (!api) return
    const r = await api.get()
    if (r.ok) setSt(r)
  }, [api])
  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 4000)
    return () => clearInterval(id)
  }, [refresh])
  const pair = st?.pair ?? ''
  useEffect(() => {
    if (!pair) return void setQr('')
    void QRCode.toDataURL(pair, { margin: 1, width: 176, errorCorrectionLevel: 'M', color: { dark: '#1d1b1f', light: '#ffffff' } }).then(setQr)
  }, [pair])
  if (!api || !st) return null
  const apply = (r: Awaited<ReturnType<typeof api.get>>) => {
    if (r.ok) setSt(r)
    else say(r.error)
  }
  const toggleWrite = async (d: HostServerStatus['devices'][number]) => {
    if (!d.perms.write) {
      const ok = await confirmAsk(t('"{name}"에 쓰기를 허용할까요?', { name: d.name }), t('이 기기는 이 폴더의 노트와 파일을 만들거나 고칠 수 있게 돼요. 지우는 것과 실행 파일 올리기는 안 돼요. 언제든 여기서 끌 수 있어요.'), t('허용'))
      if (!ok) return
    }
    apply(await api.setPerms(d.id, { write: !d.perms.write }))
  }
  return (
    <section className="hc-srv">
      <div className="auto-sub">{t('휴대폰과 맞추기')}</div>
      <div className="kv"><span>{t('사용')}</span>
        <div className="seg">
          <button className={st.enabled ? 'on' : ''} onClick={async () => apply(await api.set({ enabled: true }))}>{t('켜기')}</button>
          <button className={!st.enabled ? 'on' : ''} onClick={async () => apply(await api.set({ enabled: false }))}>{t('끄기')}</button>
        </div>
      </div>
      {!st.enabled && <p className="hint small">{t('켜면 같은 와이파이의 내 휴대폰이 이 폴더를 읽을 수 있어요. 기본은 읽기만이고, 쓰기는 기기마다 여기서 직접 허용해야 해요.')}</p>}
      {st.enabled && (
        <>
          {st.error && <p className="hint small ai-warn">{st.error}</p>}
          {st.running && st.ips.length === 0 && <p className="hint small ai-warn">{t('와이파이에 연결돼 있지 않아요. 같은 와이파이에 연결해 주세요.')}</p>}
          {st.running && st.code && st.pair && (
            <div className="relay-pair">
              {qr && <img src={qr} width={176} height={176} alt={t('연결 QR')} />}
              <div className="relay-code">
                <small>{t('휴대폰 앱에서 이 PC에 연결')}</small>
                <b>{st.code}</b>
                <small>{t('5분 안에, 한 번만 쓸 수 있어요')}</small>
                <button className="btn-link" onClick={() => void navigator.clipboard.writeText(st.pair ?? '').then(() => say(t('복사했어요')))}>{t('연결 문자열 복사')}</button>
                <button className="btn-link" onClick={async () => apply(await api.newCode())}>{t('새 코드 만들기')}</button>
              </div>
            </div>
          )}
          <div className="relay-devs">
            <div className="auto-sub">{t('연결된 휴대폰')}</div>
            {st.devices.length === 0 ? <p className="hint small">{t('아직 없어요')}</p> : (
              <ul>
                {st.devices.map((d) => (
                  <li key={d.id} className="hc-dev">
                    <span><b>{d.name}</b><small>{t('마지막 사용 {when}', { when: ago(d.lastSeen) })}{d.writes ? ' · ' + t('쓴 횟수 {n}', { n: d.writes }) : ''}</small></span>
                    <span className="hc-perms">
                      <button className={`hc-perm${d.perms.write ? ' on' : ''}`} onClick={() => void toggleWrite(d)} aria-pressed={d.perms.write}>{d.perms.write ? t('쓰기 허용됨') : t('읽기만')}</button>
                      <button className="hc-perm" disabled title={t('삭제 권한은 아직 쓸 수 없어요')}>{t('삭제 불가')}</button>
                      <button className="btn-link" onClick={async () => apply(await api.revoke(d.id))}>{t('해제')}</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="hint small">{t('읽기만 허용된 기기는 파일을 볼 수만 있어요. 쓰기를 허용해도 실행 파일(.exe 등)은 폰에서 올릴 수 없고, 이 PC가 파일을 열거나 실행하지 않아요. 같은 와이파이 안에서만 연결돼요.')}</p>
        </>
      )}
    </section>
  )
}
