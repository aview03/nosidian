// 연결된 휴대폰 목록: AI 중계·폴더 공유·호스트 동기화 세 카드가 같은 모양·같은 동작으로 쓴다.
//  - 이름과 "마지막 사용", (카드마다 다른) 보조 글·버튼, 그리고 해제. 해제는 확인 창을 거친다(되돌리려면 새 연결 코드로 다시 연결해야 한다).
import type { ReactNode } from 'react'
import { t } from '../lib/i18n'
import { confirmAsk } from '../lib/dialog'

export interface DeviceRow {
  id: string
  name: string
  lastSeen: number
}

/** "방금 / N분 전 / N시간 전 / 날짜" */
export const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return t('방금')
  if (m < 60) return t('{n}분 전', { n: m })
  if (m < 1440) return t('{n}시간 전', { n: Math.round(m / 60) })
  return new Date(ts).toLocaleDateString()
}

export function DeviceList<T extends DeviceRow>({ devices, onRevoke, detail, actions, className }: { devices: T[]; onRevoke(id: string): void | Promise<void>; /** 마지막 사용 옆에 붙일 글 */ detail?(d: T): string; /** 해제 앞에 둘 카드별 버튼(쓰기 권한 등) */ actions?(d: T): ReactNode; className?: string }) {
  const revoke = async (d: T) => {
    const ok = await confirmAsk(t('"{name}" 연결을 해제할까요?', { name: d.name }), t('이 휴대폰은 바로 연결이 끊겨요. 다시 쓰려면 새 연결 코드로 다시 연결해야 해요.'), t('해제'), true)
    if (ok) await onRevoke(d.id)
  }
  return (
    <div className="relay-devs">
      <div className="auto-sub">{t('연결된 휴대폰')}</div>
      {devices.length === 0 ? (
        <p className="hint small">{t('아직 없어요')}</p>
      ) : (
        <ul>
          {devices.map((d) => (
            <li key={d.id} className={className}>
              <span><b>{d.name}</b><small>{t('마지막 사용 {when}', { when: ago(d.lastSeen) })}{detail?.(d) ? ' · ' + detail(d) : ''}</small></span>
              <span className="hc-perms">
                {actions?.(d)}
                <button className="btn-link" onClick={() => void revoke(d)}>{t('해제')}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
