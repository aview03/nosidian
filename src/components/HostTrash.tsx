// PC 앱: 호스트 폴더의 휴지통(지운 파일을 90일 보관). 되살리기는 원래 자리가 비어 있으면 거기로, 이미 다른 파일이 있으면
// 덮어쓰지 않고 "이름 (복구).확장자" 로 한다(저장 계층 `restoreTrash`). 폰에서 지운 파일이 PC 로 전파돼도(삭제 허용) 여기서 되살릴 수 있다.
import { useCallback, useEffect, useState } from 'react'
import { desktop } from '../lib/externalIO'
import { useApp } from '../lib/app'
import { formatSize } from '../lib/attachments'
import { t } from '../lib/i18n'
import { ago } from './DeviceList'

type Entry = { name: string; path: string; at: number; size: number }

export function HostTrash() {
  const api = desktop()?.host
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!api) return
    const r = await api.trash()
    if (r.ok) setEntries(r.entries)
  }, [api])
  useEffect(() => {
    void refresh()
  }, [refresh])
  if (!api || entries.length === 0) return null

  const restore = async (e: Entry) => {
    if (busy) return
    setBusy(e.name)
    try {
      const r = await api.restoreTrash(e.name)
      if (!r.ok) throw new Error(r.error)
      useApp.getState().say(r.renamed ? t('원래 자리에 같은 이름이 있어서 "{name}" 으로 되살렸어요', { name: r.path }) : t('되살렸어요: {name}', { name: r.path }))
      void useApp.getState().sync(false, { auto: true }) // 되살린 파일을 이 앱의 노트·파일 목록에도 반영한다(조용히 — "되살렸어요" 알림을 덮어쓰지 않는다)
    } catch (err) {
      useApp.getState().say(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  return (
    <details className="more">
      <summary>{t('휴지통 ({n})', { n: entries.length })}</summary>
      <p className="hint small">{t('지운 파일은 90일 동안 폴더의 휴지통에 보관돼요. 되살리면 원래 자리로 돌아가고, 같은 이름이 있으면 "이름 (복구)"로 되살려요.')}</p>
      <ul className="hc-snaps">
        {entries.map((e) => (
          <li key={e.name}>
            <span>
              {e.path}
              <small>{ago(e.at) === t('방금') ? t('방금 지움') : t('{when}에 지움', { when: ago(e.at) })} · {formatSize(e.size)}</small>
            </span>
            <button className="btn-link" disabled={busy !== null} onClick={() => void restore(e)}>{busy === e.name ? t('되살리는 중…') : t('되살리기')}</button>
          </li>
        ))}
      </ul>
    </details>
  )
}
