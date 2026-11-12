// 폰(설정 > 노트와 동기화): "내 PC에 연결(클라우드 없이)". PC 앱의 "휴대폰과 맞추기"가 보여 주는 QR(또는 복사한 연결 문자열)로 짝을 맺고,
// 최초 연결의 차이를 **미리 본 뒤** 승인해야 반영한다(삭제 없음, 스냅샷 필수). 쓰기는 PC 에서 이 휴대폰에 허용해야 올릴 수 있다(기본 읽기만).
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { useApp } from '../lib/app'
import { confirmAsk } from '../lib/dialog'
import { applyHostConnect, leaveHost, phoneHostIO, previewHostConnect, restoreVaultFromSnapshot, type Choice, type ConnectPlan } from '../lib/hostConnect'
import { forgetPcHost, hostErrorText, loadPcHost, pairHost, parseHostPairing, pingHost, unpairHost, type HostPairing, type PcHostLink, type PcHostPing } from '../lib/pcHost'
import { listVaultSnapshots, type PhoneSnapshot } from '../lib/phoneSnapshot'
import { Icon } from './Icon'
import { HostPlanView } from './HostPlan'
import { QrScan } from './QrScan'
import { useBackClose } from '../lib/backStack'
import { ForgetLink } from './ForgetLink'

const errText = (e: unknown) => {
  const x = e as { message?: string; status?: number; code?: string }
  return e instanceof Error && x.status != null ? hostErrorText(x.status, x.code, e.message) : e instanceof Error ? e.message : String(e)
}

function PermLine({ perms }: { perms: { write: boolean } | null }) {
  if (!perms) return null
  return perms.write ? <p className="hint small">{t('이 휴대폰은 PC에서 쓰기가 허용돼 있어요.')}</p> : <p className="hint small ai-warn">{t('이 휴대폰은 지금 읽기만 가능해요. PC 앱에서 이 휴대폰의 쓰기를 허용하면 내 노트를 올릴 수 있어요.')}</p>
}

export function PcHostConnectDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState<PcHostLink | null>(loadPcHost())
  const [ping, setPing] = useState<PcHostPing | null>(null)
  const [text, setText] = useState('')
  const [scan, setScan] = useState(false)
  const [plan, setPlan] = useState<ConnectPlan | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  useBackClose(true, () => { if (!busy) onClose() }) // 진행 중에는 바깥을 눌러도 닫히지 않는 것과 같다
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const refresh = async (l: PcHostLink) => {
    try {
      setPing(await pingHost(l))
      setErr('')
    } catch (e) {
      setErr(errText(e))
    }
  }
  useEffect(() => {
    if (link) void refresh(link)
  }, [link?.deviceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async (given?: HostPairing) => {
    const p = given ?? parseHostPairing(text)
    if (!p) return setErr(t('PC 앱의 "휴대폰과 맞추기" QR을 스캔하거나, "연결 문자열 복사"로 복사한 글을 붙여 넣어 주세요'))
    setBusy(true)
    setErr('')
    try {
      const l = await pairHost(p, t('내 휴대폰'))
      setText('')
      setLink(l)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const preview = async () => {
    if (!link || !ping) return
    setBusy(true)
    setErr('')
    try {
      setPlan(await previewHostConnect(phoneHostIO(link, ping.perms.write)))
      setChoices({})
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const start = async () => {
    if (!plan || !link || !ping) return
    setBusy(true)
    setErr('')
    try {
      const r = await applyHostConnect(plan, choices, { kind: 'pchost', name: link.name, folder: link.folder }, phoneHostIO(link, ping.perms.write))
      setDone(t('연결했어요. 올림 {up} · 받음 {down}{extra}', { up: r.uploaded, down: r.downloaded, extra: r.pendingUpload ? ' · ' + t('올리기 대기 {n}', { n: r.pendingUpload }) : r.copies.length ? ' · ' + t('PC 사본 {n}개', { n: r.copies.length }) : '' }))
    } catch (e) {
      const x = e as { code?: string }
      setErr(x.code === 'snapshot' || x.code === 'noSpace' ? t('스냅샷을 만들 수 없어서 시작하지 않았어요(아무것도 바뀌지 않았어요). 저장 공간을 확인해 주세요.') : t('시작하지 못했어요(아무것도 바뀌지 않았어요): {why}', { why: errText(e) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ee-wrap" onClick={busy ? undefined : onClose}>
      <div className="ee hc" role="dialog" aria-label={t('내 PC에 연결')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{t('내 PC에 연결')}</h3>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>
        <div className="ee-body">
          {done ? (
            <>
              <p className="aiw-q">{done}</p>
              <p className="hint">{t('이제 "지금 동기화"로 PC와 맞춰요. PC가 꺼져 있어도 노트는 읽고 고칠 수 있고, 다시 연결되면 맞춰요.')}</p>
              <button className="primary big" onClick={onClose}>{t('확인')}</button>
            </>
          ) : (
            <>
              <p className="hint">{t('클라우드 없이 같은 와이파이의 내 PC와 노트를 맞춰요. 연결하기 전에 차이를 먼저 보여 드리고, 확인하시기 전에는 아무것도 덮어쓰거나 지우지 않아요.')}</p>
              {!link ? (
                <div className="stack">
                  <p className="hint small">{t('PC 앱에서 설정 > 노트와 동기화 > "휴대폰과 맞추기"를 켜면 QR이 나와요(PC에서 호스트 폴더를 먼저 연결해야 해요).')}</p>
                  <button className="primary big" disabled={busy} onClick={() => setScan(true)}>{t('QR 스캔')}</button>
                  <input className="inline wide" value={text} placeholder="nsh1:…" autoCapitalize="off" autoCorrect="off" onChange={(e) => { setText(e.target.value); setErr('') }} aria-label={t('연결 문자열')} />
                  <button className="big" disabled={!text.trim() || busy} onClick={() => void connect()}>{busy ? t('PC에 연결하는 중…') : t('붙여 넣은 글로 연결')}</button>
                </div>
              ) : (
                <>
                  <div className="kv"><span>{t('PC')}</span><b>{link.name}{link.folder ? ` · ${link.folder}` : ''}</b></div>
                  <PermLine perms={ping?.perms ?? null} />
                  <div className="btn-row">
                    <button disabled={busy} onClick={() => void refresh(link)}>{t('다시 확인')}</button>
                    <button className="danger-link" disabled={busy} onClick={async () => { await unpairHost(link); forgetPcHost(); setLink(null); setPing(null); setPlan(null) }}>{t('다른 PC에 연결')}</button>
                  </div>
                  {ping && !plan && <button className="primary big" disabled={busy} onClick={() => void preview()}>{busy ? t('확인하는 중…') : t('차이 미리 보기')}</button>}
                  {plan && ping && <HostPlanView plan={plan} choices={choices} setChoices={setChoices} busy={busy} side="phone" canWrite={ping.perms.write} onStart={() => void start()} />}
                </>
              )}
              {err && <p className="hint small ai-warn">{err}</p>}
              <button className="link-btn" disabled={busy} onClick={onClose}>{t('취소')}</button>
            </>
          )}
        </div>
      </div>
      {scan && <QrScan parse={parseHostPairing} onClose={() => setScan(false)} onResult={(p) => { setScan(false); void connect(p) }} />}
    </div>
  )
}

/** 연결된 뒤(고급): PC·내 권한, 다시 확인, 스냅샷 복원, 연결 끊기(노트는 그대로) */
export function PcHostPanel() {
  const [link] = useState<PcHostLink | null>(loadPcHost())
  const [ping, setPing] = useState<PcHostPing | null>(null)
  const [err, setErr] = useState('')
  const [snaps, setSnaps] = useState<PhoneSnapshot[]>([])
  const say = useApp.getState().say
  const check = async () => {
    if (!link) return
    try {
      setPing(await pingHost(link))
      setErr('')
    } catch (e) {
      setErr(errText(e))
    }
  }
  useEffect(() => {
    void check()
    void listVaultSnapshots().then(setSnaps)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!link) return <p className="hint small ai-warn">{t('PC 연결 정보가 없어요. 다시 연결해 주세요.')}</p>
  return (
    <div className="hc-panel">
      <div className="kv"><span>{t('PC')}</span><b>{link.name}{link.folder ? ` · ${link.folder}` : ''}</b></div>
      {err ? <p className="hint small ai-warn">{err}</p> : <PermLine perms={ping?.perms ?? null} />}
      <div className="btn-row"><button onClick={() => void check()}>{t('다시 확인')}</button></div>
      <p className="hint small">{t('PC가 꺼져 있어도 노트는 읽고 고칠 수 있어요. 다시 연결되면 맞춰요. 폰에서 지운 파일은 PC로 전파되지 않아요.')}</p>
      {snaps.length > 0 && (
        <details className="more">
          <summary>{t('스냅샷에서 복원 ({n})', { n: snaps.length })}</summary>
          <ul className="hc-snaps">
            {snaps.map((s) => (
              <li key={s.id}>
                <span>{new Date(s.at).toLocaleString()}<small>{t('{n}개 파일', { n: s.count })}</small></span>
                <button
                  className="btn-link"
                  onClick={async () => {
                    if (!(await confirmAsk(t('이 스냅샷으로 복원할까요?'), t('스냅샷에 있던 이 휴대폰의 노트 내용으로 되돌려요(그 뒤에 만든 노트는 지우지 않아요). 되돌린 내용은 다음 동기화 때 PC에 반영돼요(쓰기가 허용된 경우).'), t('복원')))) return
                    try {
                      say(t('{n}개 노트를 복원했어요', { n: await restoreVaultFromSnapshot(s.id, phoneHostIO(link, ping?.perms.write === true)) }))
                    } catch (e) {
                      say(errText(e))
                    }
                  }}
                >
                  {t('복원')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ForgetLink kind="host" pcName={link.name} className="danger-link" onForget={async () => { const ok = await unpairHost(link); leaveHost(); return ok }} />
    </div>
  )
}
