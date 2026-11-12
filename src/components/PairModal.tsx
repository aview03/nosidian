// 기기 추가 모달: 연결 QR·코드는 사용자가 요청했을 때만 만들어 이 창에서만 보여 준다(보안).
// - 열 때 새 코드를 만든다. 5분이 지나면 만료로 바꾸고 "새로 만들기"를 누를 때만 다시 만든다.
// - 기기가 연결되면 "연결됐어요"를 잠깐 보이고 창이 저절로 닫힌다.
// - 닫으면(버튼·바깥·Esc) 아직 안 쓴 코드를 서버에서 바로 폐기한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { t } from '../lib/i18n'
import { useApp } from '../lib/app'
import { baselineIds, newcomer, pairPhase, remaining, type PairBase, type PairState } from '../lib/pairModal'
import { useBackClose } from '../lib/backStack'

export interface PairSource {
  /** 지금 상태(코드는 새로 만들지 않는다) */
  get(): Promise<PairState | null>
  /** 새 코드 발급 */
  issue(): Promise<PairState | null>
  /** 떠 있는 코드 폐기 */
  revoke(): Promise<void>
}

const POLL_MS = 1500

export function PairModal({ title, where, source, onClose, onConnected }: { title: string; /** 휴대폰에서 어디로 들어가는지 */ where: string; source: PairSource; onClose(): void; onConnected?(name: string): void }) {
  const [st, setSt] = useState<PairState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [qr, setQr] = useState('')
  const [fail, setFail] = useState(false)
  const base = useRef<PairBase>(new Map())
  const started = useRef(false)
  const done = useRef(false)
  const src = useRef(source)
  src.current = source

  const issue = useCallback(async () => {
    setFail(false)
    const before = await src.current.get() // 이 시점까지 있던 기기는 "방금 연결된 기기"가 아니다
    base.current = baselineIds(before)
    const s = await src.current.issue()
    if (!s) setFail(true)
    setSt(s)
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void issue()
  }, [issue])

  // 1초마다 남은 시간, 1.5초마다 서버 상태(연결됐는지)
  useEffect(() => {
    const a = setInterval(() => setNow(Date.now()), 1000)
    const b = setInterval(() => void src.current.get().then((s) => s && setSt(s)), POLL_MS)
    return () => { clearInterval(a); clearInterval(b) }
  }, [])

  const phase = pairPhase(st, base.current, now)
  const who = newcomer(st, base.current)

  const pair = phase === 'waiting' ? st?.pair ?? '' : ''
  useEffect(() => {
    if (!pair) return void setQr('')
    void QRCode.toDataURL(pair, { margin: 1, width: 200, errorCorrectionLevel: 'M', color: { dark: '#1d1b1f', light: '#ffffff' } }).then(setQr)
  }, [pair])

  const close = useCallback(async () => {
    if (done.current) return
    done.current = true
    try { await src.current.revoke() } catch { /* 서버가 이미 폐기했으면 무시 */ }
    onClose()
  }, [onClose])

  useBackClose(true, () => void close())

  // 연결되면 알리고 저절로 닫는다
  useEffect(() => {
    if (phase !== 'connected' || !who) return
    onConnected?.(who.name)
    const id = setTimeout(() => void close(), 1400)
    return () => clearTimeout(id)
  }, [phase, who?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); void close() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [close])

  const copy = () => void navigator.clipboard.writeText(st?.typed ?? '').then(() => useApp.getState().say(t('복사했어요')))

  return createPortal(
    <div className="modal-wrap" onClick={() => void close()}>
      <div className="modal pair-modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {fail && <p className="ai-warn">{t('연결 코드를 만들지 못했어요. 다시 시도해 주세요.')}</p>}
        {phase === 'loading' && !fail && <p>{t('연결 코드를 만드는 중…')}</p>}
        {phase === 'waiting' && st && (
          st.noNetwork ? <p className="ai-warn">{t('와이파이에 연결돼 있지 않아요. 같은 와이파이에 연결해 주세요.')}</p> : (
            <>
              <p>{where}</p>
              <div className="pair-body">
                {qr && <img src={qr} width={200} height={200} alt={t('연결 QR')} />}
                <b className="pair-code">{st.code}</b>
                <small className="pair-left" aria-live="off">{t('남은 시간 {t}', { t: remaining(st.expiresAt, now) })} · {t('한 번만 쓸 수 있어요')}</small>
                {st.typed && <button type="button" className="btn-link" onClick={copy}>{t('연결 문자열 복사')}</button>}
              </div>
            </>
          )
        )}
        {phase === 'expired' && <p>{t('코드가 만료됐어요. 안전을 위해 지금은 아무 기기도 연결할 수 없어요.')}</p>}
        {phase === 'connected' && <p className="pair-ok">{t('"{name}" 연결됐어요', { name: who?.name ?? '' })}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => void close()}>{phase === 'connected' ? t('닫기') : t('취소')}</button>
          {phase === 'expired' && <button type="button" className="primary" onClick={() => void issue()}>{t('새로 만들기')}</button>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
