// 카메라로 QR 을 읽는다(휴대폰의 "내 PC에 연결"). 웹뷰의 카메라(getUserMedia)와 jsQR 로 직접 해독한다 — 별도 네이티브 플러그인이 없다.
// 연결 코드 모양이 맞는 QR 만 받아들인다(parsePairing). 카메라를 못 쓰면 이유를 알리고, 코드를 직접 입력하게 한다.
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { t } from '../lib/i18n'
import { parsePairing, type Pairing } from '../lib/pcLink'
import { Icon } from './Icon'

export function QrScan({ onResult, onClose }: { onResult(p: Pairing): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const stop = () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped) return stream.getTracks().forEach((tr) => tr.stop())
        const v = video.current!
        v.srcObject = stream
        await v.play()
        let last = 0
        const tick = (now: number) => {
          if (stopped) return
          raf = requestAnimationFrame(tick)
          if (now - last < 100 || v.videoWidth === 0) return // 초당 10번만 읽는다
          last = now
          const c = canvas.current!
          const w = Math.min(480, v.videoWidth)
          const h = Math.round((v.videoHeight / v.videoWidth) * w)
          c.width = w
          c.height = h
          const ctx = c.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(v, 0, 0, w, h)
          const q = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })
          if (!q) return
          const p = parsePairing(q.data)
          if (p) {
            stop()
            onResult(p)
          }
        }
        raf = requestAnimationFrame(tick)
      } catch (e) {
        const name = (e as { name?: string }).name
        setErr(name === 'NotAllowedError' ? t('카메라 권한이 없어요. 설정에서 카메라를 허용하거나, 연결 코드를 직접 입력해 주세요') : t('카메라를 열지 못했어요. 연결 코드를 직접 입력해 주세요'))
      }
    })()
    return stop
  }, [onResult])

  return (
    <div className="qr-wrap" role="dialog" aria-label={t('QR 스캔')}>
      <div className="qr-head">
        <b>{t('PC 화면의 QR을 비춰 주세요')}</b>
        <button className="icon-btn" onClick={onClose} aria-label={t('닫기')}><Icon name="close" /></button>
      </div>
      {err ? <p className="qr-err">{err}</p> : <div className="qr-frame"><video ref={video} muted playsInline /><i /></div>}
      <canvas ref={canvas} hidden />
    </div>
  )
}
