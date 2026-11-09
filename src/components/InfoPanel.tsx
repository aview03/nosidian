import { t } from '../lib/i18n'
import { tx } from '../lib/tx'
import { useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { baseName, unlinkedMentions } from '../lib/links'
import { Graph } from './Graph'

type T = 'back' | 'out' | 'outline'

export function InfoPanel({ path, onScroll }: { path: string; onScroll(line: number, text: string): void }) {
  const index = useApp((s) => s.index)
  const files = useApp((s) => s.files)
  const [tab, setTab] = useState<T>('back')
  const [showUnlinked, setShowUnlinked] = useState(false)
  const open = useApp((s) => s.openNote)

  const parsed = index.notes.get(path)
  const back = index.back.get(path) ?? []
  const out = index.out.get(path) ?? []
  const missing = index.unresolved.get(path) ?? []
  const unlinked = useMemo(() => {
    if (!showUnlinked) return []
    const m = new Map<string, string>()
    for (const [p, f] of Object.entries(files)) if (!f.deleted) m.set(p, f.content)
    return unlinkedMentions(index, path, m)
  }, [showUnlinked, index, path, files])

  const line = (p: string, sub?: string) => (
    <button key={p} className="row" onClick={() => open(p)}>
      <span className="row-title">{baseName(p)}</span>
      <span className="row-sub">{sub ?? (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')}</span>
    </button>
  )

  const snippetFor = (from: string) => {
    const f = files[from]
    if (!f) return undefined
    const p = index.notes.get(from)
    const l = p?.links.find((x) => index.resolve(x.target, from) === path)
    if (!l) return undefined
    return f.content.split('\n')[l.line + (f.content.startsWith('---') ? 0 : 0)]?.trim().slice(0, 120)
  }

  return (
    <div className="info">
      <div className="tabs-mini">
        <button className={tab === 'back' ? 'on' : ''} onClick={() => setTab('back')}>{t('백링크')} <i>{back.length}</i></button>
        <button className={tab === 'out' ? 'on' : ''} onClick={() => setTab('out')}>{t('링크')} <i>{out.length + missing.length}</i></button>
        <button className={tab === 'outline' ? 'on' : ''} onClick={() => setTab('outline')}>{t('목차')} <i>{parsed?.headings.length ?? 0}</i></button>
      </div>

      {tab === 'back' && (
        <div className="list">
          {back.length === 0 && <p className="hint">{t('이 노트를 가리키는 노트가 없습니다.')}<br />{tx('다른 노트에서 {link} 로 연결해 보세요.', { link: <code>[[{baseName(path)}]]</code> })}</p>}
          {back.map((p) => (
            <button key={p} className="row" onClick={() => open(p)}>
              <span className="row-title">{baseName(p)}</span>
              <span className="row-sub snippet">{snippetFor(p)}</span>
            </button>
          ))}
          <button className="link-btn" onClick={() => setShowUnlinked((v) => !v)}>
            {showUnlinked ? '▾' : '▸'} {t('링크되지 않은 언급')}
          </button>
          {showUnlinked && (unlinked.length ? unlinked.map((u) => line(u.path, u.snippet)) : <p className="hint">{t('없습니다.')}</p>)}
        </div>
      )}

      {tab === 'out' && (
        <div className="list">
          {out.map((p) => line(p))}
          {missing.map((m) => (
            <button key={m} className="row unresolved" onClick={() => useApp.getState().openLink(m)}>
              <span className="row-title">{m}</span>
              <span className="row-sub">{t('없는 노트 · 눌러서 만들기')}</span>
            </button>
          ))}
          {!out.length && !missing.length && <p className="hint">{t('이 노트에는 링크가 없습니다.')}</p>}
        </div>
      )}

      {tab === 'outline' && (
        <div className="list">
          {parsed?.headings.map((h, i) => (
            <button key={i} className="row outline" style={{ paddingLeft: 10 + (h.level - 1) * 14 }} onClick={() => onScroll(h.line, h.text)}>
              <span className="row-title">{h.text}</span>
            </button>
          ))}
          {!parsed?.headings.length && <p className="hint">{t('제목(#)이 없습니다.')}</p>}
        </div>
      )}

      <div className="mini-graph-head">
        <span>{t('로컬 그래프')}</span>
        <button className="link-btn" onClick={() => useApp.getState().go('graph')}>{t('크게 보기')}</button>
      </div>
      <Graph local mini />
    </div>
  )
}
