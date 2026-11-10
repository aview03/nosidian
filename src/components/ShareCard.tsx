// 설정 > 노트와 동기화 (PC): "내 휴대폰에서 이 PC의 폴더 보기". PC 에서 폴더 하나를 지정하면, 같은 와이파이의 내 휴대폰이
// QR(또는 복사한 연결 문자열)로 한 번 짝을 맺고 그 폴더의 파일을 **읽기만** 한다. 암호화(HTTPS)·인증서 지문 확인이 들어 있다.
// 기본은 꺼짐. 폴더 밖·쓰기·삭제·실행은 되지 않고, 기기는 여기서 언제든 해제한다.
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { t } from '../lib/i18n'
import { desktop, type ShareStatus } from '../lib/externalIO'
import { useApp } from '../lib/app'

const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return t('방금')
  if (m < 60) return t('{n}분 전', { n: m })
  if (m < 1440) return t('{n}시간 전', { n: Math.round(m / 60) })
  return new Date(ts).toLocaleDateString()
}

const PICK_ERR: Record<string, string> = {
  'drive root': '드라이브 전체는 공유할 수 없어요. 폴더를 하나 골라 주세요',
  'too broad': '이 폴더는 너무 넓어요(홈 폴더·앱 폴더). 안의 폴더를 골라 주세요',
  'system folder': '시스템 폴더는 공유할 수 없어요',
  'not found': '폴더를 찾을 수 없어요',
  'not a directory': '폴더가 아니에요',
}

export function ShareCard() {
  const api = desktop()?.share
  const [st, setSt] = useState<ShareStatus | null>(null)
  const [qr, setQr] = useState('')
  const refresh = useCallback(async () => { if (api) setSt(await api.get()) }, [api])
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

  const say = useApp.getState().say
  const pick = async () => {
    const r = await api.pickDir()
    setSt(r)
    if (r.pickError) say(t(PICK_ERR[r.pickError] ?? '이 폴더는 공유할 수 없어요'))
  }
  const copy = () => void navigator.clipboard.writeText(st.pair ?? '').then(() => say(t('복사했어요')))

  return (
    <section className="card relay share">
      <h3>{t('내 휴대폰에서 이 PC의 폴더 보기')}</h3>
      <div className="kv"><span>{t('사용')}</span>
        <div className="seg">
          <button className={st.enabled ? 'on' : ''} onClick={async () => setSt(await api.set({ enabled: true }))}>{t('켜기')}</button>
          <button className={!st.enabled ? 'on' : ''} onClick={async () => setSt(await api.set({ enabled: false }))}>{t('끄기')}</button>
        </div>
      </div>
      {!st.enabled && <p className="hint small">{t('켜면 같은 와이파이의 내 휴대폰이 이 PC에서 고른 폴더의 파일을 보고 받을 수 있어요. 읽기만 가능하고 암호화돼요.')}</p>}
      {st.enabled && (
        <>
          <div className="kv"><span>{t('공유 폴더')}</span>
            <span className="share-dir">
              <b title={st.dir ?? ''}>{st.dir ?? t('아직 없어요')}</b>
              <button className="btn-link" onClick={() => void pick()}>{st.dir ? t('바꾸기') : t('폴더 고르기')}</button>
              {st.dir && <button className="btn-link" onClick={async () => setSt(await api.clearDir())}>{t('공유 끝내기')}</button>}
            </span>
          </div>
          {st.error && <p className="hint small ai-warn">{st.error}</p>}
          {!st.running && !st.error && <p className="hint small">{t('시작하는 중…')}</p>}
          {st.running && st.ips.length === 0 && <p className="hint small ai-warn">{t('와이파이에 연결돼 있지 않아요. 같은 와이파이에 연결해 주세요.')}</p>}
          {st.running && st.dir && st.code && st.pair && (
            <div className="relay-pair">
              {qr && <img src={qr} width={176} height={176} alt={t('연결 QR')} />}
              <div className="relay-code">
                <small>{t('휴대폰 앱 > 설정 > 노트와 동기화 > 내 PC 폴더 보기')}</small>
                <b>{st.code}</b>
                <small>{t('5분 안에, 한 번만 쓸 수 있어요')}</small>
                <button className="btn-link" onClick={copy}>{t('연결 문자열 복사')}</button>
                <button className="btn-link" onClick={async () => setSt(await api.newCode())}>{t('새 코드 만들기')}</button>
              </div>
            </div>
          )}
          <div className="relay-devs">
            <div className="auto-sub">{t('연결된 휴대폰')}</div>
            {st.devices.length === 0 ? <p className="hint small">{t('아직 없어요')}</p> : (
              <ul>
                {st.devices.map((d) => (
                  <li key={d.id}>
                    <span><b>{d.name}</b><small>{t('마지막 사용 {when}', { when: ago(d.lastSeen) })}</small></span>
                    <button className="btn-link" onClick={async () => setSt(await api.revoke(d.id))}>{t('해제')}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="hint small">{t('이 PC가 켜져 있고 같은 와이파이일 때만 연결돼요. 폴더 밖 파일·숨김 파일은 보이지 않고, 쓰기·삭제는 되지 않아요.')}</p>
          <p className="hint small share-fp">{t('인증서 지문')}: {st.fingerprint.slice(0, 16).toUpperCase().replace(/(.{4})/g, '$1 ').trim()}…</p>
        </>
      )}
    </section>
  )
}
