// 휴대폰(웹·앱, PC 앱 제외): "내 PC 폴더 보기". PC 앱이 공유한 폴더의 파일을 읽기 전용으로 보고, 눌러서 받는다.
// 연결은 PC 화면의 QR 스캔 또는 복사한 연결 문자열로만 한다(인증서 지문이 들어 있어 가로채기를 막는다).
import { useCallback, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { t } from '../lib/i18n'
import { desktop } from '../lib/externalIO'
import { useApp } from '../lib/app'
import { confirmAsk } from '../lib/dialog'
import { formatSize, gate, gateMessage, handOver } from '../lib/attachments'
import { entriesIn, forgetPcShare, getShareFile, listShare, pairShare, parseSharePairing, shareErrorText, usePcFilesUi, type PcShare, type ShareEntry, type SharePairing } from '../lib/pcFiles'
import { Icon } from './Icon'
import { QrScan } from './QrScan'

export function PcFilesCard() {
  const link = usePcFilesUi((s) => s.link)
  const [text, setText] = useState('')
  const [scan, setScan] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'idle' | 'busy' | 'err'; text: string }>({ kind: 'idle', text: '' })
  if (desktop()) return null // PC 앱은 공유하는 쪽이다

  const connect = async (given?: SharePairing) => {
    const p = given ?? parseSharePairing(text)
    if (!p) return setMsg({ kind: 'err', text: t('PC 화면의 QR을 스캔하거나, "연결 문자열 복사"로 복사한 글을 붙여 넣어 주세요') })
    setMsg({ kind: 'busy', text: t('PC에 연결하는 중…') })
    try {
      await pairShare(p, t('내 휴대폰'))
      setText('')
      setMsg({ kind: 'idle', text: '' })
      useApp.getState().say(t('연결했어요'))
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <section className="card pcfiles">
      <h3>{t('내 PC 폴더 보기')}</h3>
      {link ? (
        <>
          <p className="hint">{t('{name} 의 "{dir}" 폴더를 읽기 전용으로 볼 수 있어요.', { name: link.name, dir: link.dirName ?? '…' })}</p>
          <button className="primary big" onClick={() => usePcFilesUi.setState({ open: true })}>{t('파일 보기')}</button>
          <button className="btn-link" onClick={() => { forgetPcShare(); setMsg({ kind: 'idle', text: '' }) }}>{t('연결 해제')}</button>
        </>
      ) : (
        <div className="stack">
          <p className="hint small">{t('PC 앱 설정 > 노트와 동기화에서 "내 휴대폰에서 이 PC의 폴더 보기"를 켜고 폴더를 고른 뒤, 나온 QR을 스캔해 주세요.')}</p>
          <button className="primary big" disabled={msg.kind === 'busy'} onClick={() => setScan(true)}>{t('QR 스캔')}</button>
          <input className="inline wide" value={text} placeholder="nsf1:…" autoCapitalize="off" autoCorrect="off" onChange={(e) => { setText(e.target.value); setMsg({ kind: 'idle', text: '' }) }} aria-label={t('연결 문자열')} />
          <button className="big" disabled={!text.trim() || msg.kind === 'busy'} onClick={() => void connect()}>{t('붙여 넣은 글로 연결')}</button>
        </div>
      )}
      {msg.text && <p className={`hint small${msg.kind === 'err' ? ' ai-warn' : ''}`}>{msg.text}</p>}
      {scan && <QrScan parse={parseSharePairing} onClose={() => setScan(false)} onResult={(p) => { setScan(false); void connect(p) }} />}
    </section>
  )
}

/** "내 PC의 파일" 시트: 폴더를 따라 들어가며 보고, 파일을 누르면 받는다 */
export function PcFilesSheet() {
  const open = usePcFilesUi((s) => s.open)
  const link = usePcFilesUi((s) => s.link)
  const [entries, setEntries] = useState<ShareEntry[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [dir, setDir] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const close = () => usePcFilesUi.setState({ open: false })

  const load = useCallback(async (l: PcShare) => {
    setErr('')
    try {
      const r = await listShare(l)
      setEntries(r.entries)
      setTruncated(r.truncated)
    } catch (e) {
      setEntries([])
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    if (open && link) {
      setDir('')
      setEntries(null)
      void load(link)
    }
  }, [open, link, load])
  if (!open || !link) return null

  const up = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
  const view = entriesIn(entries ?? [], dir)
  const root = link.dirName || t('처음 위치')
  const upName = up ? up.split('/').pop() : root // 한 칸 위 폴더의 이름(맨 위면 공유한 폴더 이름)
  const phone = Capacitor.isNativePlatform()
  const get = async (f: { name: string; path: string; size: number }) => {
    if (busy) return
    const g = gate(f.name, f.size, phone)
    if (g.ok === false) return useApp.getState().say(gateMessage(g, f.name, f.size))
    if (g.ok === 'confirm' && !(await confirmAsk(f.name, gateMessage(g, f.name, f.size), t('받기')))) return
    setBusy(f.path)
    try {
      await handOver(f.name, await getShareFile(link, f.path))
    } catch (e) {
      useApp.getState().say(e instanceof Error ? e.message : shareErrorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sheet-wrap" onClick={close}>
      <div className="sheet memo-sheet pcfiles-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="panel-head">
          <h2>{link.name}{link.dirName ? ` · ${link.dirName}` : ''}</h2>
          <button className="icon-btn" onClick={() => void load(link)} aria-label={t('새로고침')}><Icon name="sync" size={18} /></button>
        </div>
        <div className="list">
          {dir && (
            <>
              <p className="pcf-path" aria-label={t('지금 위치')}>{[root, ...dir.split('/')].join(' › ')}</p>
              <button className="row memo-dest pcf-up" onClick={() => setDir(up)}>
                <span className="row-title"><Icon name="chevron-up" size={16} /> {t('상위 폴더')}</span>
                <span className="row-sub">{upName}</span>
              </button>
            </>
          )}
          {entries === null && <p className="hint pad">{t('불러오는 중…')}</p>}
          {err && <p className="hint pad ai-warn">{err}</p>}
          {entries && !err && view.folders.length === 0 && view.files.length === 0 && <p className="hint pad">{t('비어 있어요')}</p>}
          {view.folders.map((f) => (
            <button key={f.path} className="row memo-dest" onClick={() => setDir(f.path)}>
              <span className="row-title"><Icon name="folder" size={16} /> {f.name}</span>
              <span className="row-sub">{t('{n}개', { n: f.count })}</span>
            </button>
          ))}
          {view.files.map((f) => (
            <button key={f.path} className="row memo-dest" disabled={!!busy} onClick={() => void get(f)}>
              <span className="row-title"><Icon name="import" size={16} /> {f.name}</span>
              <span className="row-sub">{busy === f.path ? t('받는 중…') : formatSize(f.size)}</span>
            </button>
          ))}
          {truncated && <p className="hint small pad">{t('파일이 많아 일부만 보여요')}</p>}
        </div>
        <div className="sheet-foot">
          <button className="pcf-close" onClick={close}>{t('닫기')}</button>
        </div>
      </div>
    </div>
  )
}
