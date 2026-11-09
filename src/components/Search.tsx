import { t } from '../lib/i18n'
import { tx } from '../lib/tx'
import { useMemo } from 'react'
import { useApp } from '../lib/app'
import { baseName } from '../lib/links'

interface Hit {
  path: string
  score: number
  snippet: string
  at: number
}

function parseQuery(q: string) {
  const tags: string[] = []
  const paths: string[] = []
  const names: string[] = []
  const terms: string[] = []
  for (const tok of q.match(/"[^"]+"|\S+/g) ?? []) {
    const t = tok.replace(/^"|"$/g, '')
    if (/^tag:/i.test(t)) tags.push(t.slice(4).replace(/^#/, '').toLowerCase())
    else if (/^path:/i.test(t)) paths.push(t.slice(5).toLowerCase())
    else if (/^file:/i.test(t)) names.push(t.slice(5).toLowerCase())
    else terms.push(t.toLowerCase())
  }
  return { tags, paths, names, terms }
}

export function search(q: string, limit = 80): Hit[] {
  const { files, index } = useApp.getState()
  const { tags, paths, names, terms } = parseQuery(q)
  if (!tags.length && !paths.length && !names.length && !terms.length) return []
  const hits: Hit[] = []
  for (const f of Object.values(files)) {
    if (f.deleted) continue
    const p = index.notes.get(f.path)
    const lower = f.content.toLowerCase()
    const title = baseName(f.path).toLowerCase()
    if (tags.some((t) => !p?.tags.some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(t + '/')))) continue
    if (paths.some((x) => !f.path.toLowerCase().includes(x))) continue
    if (names.some((x) => !title.includes(x))) continue
    let score = 0
    let at = -1
    let ok = true
    for (const t of terms) {
      const ti = title.indexOf(t)
      const ci = lower.indexOf(t)
      if (ti < 0 && ci < 0) {
        ok = false
        break
      }
      if (ti >= 0) score += title === t ? 100 : 40
      if (ci >= 0) {
        score += 5 + Math.min(10, lower.split(t).length - 1)
        if (at < 0) at = ci
      }
    }
    if (!ok) continue
    const from = Math.max(0, at - 40)
    const snippet = at < 0 ? f.content.slice(0, 100) : f.content.slice(from, at + 100)
    hits.push({ path: f.path, score, snippet: (from > 0 ? '…' : '') + snippet.replace(/\s+/g, ' '), at })
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit)
}

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text
  const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

export function Search({ autoFocus = true }: { autoFocus?: boolean }) {
  const q = useApp((s) => s.searchQuery)
  const setQ = useApp((s) => s.setSearch)
  const files = useApp((s) => s.files)
  const index = useApp((s) => s.index)
  const open = useApp((s) => s.openNote)

  const hits = useMemo(() => search(q), [q, files])
  const { terms } = parseQuery(q)
  const tagList = useMemo(() => [...index.tags.entries()].sort((a, b) => b[1].length - a[1].length), [index])

  return (
    <div className="search">
      <div className="panel-head">
        <h2>{t('검색')}</h2>
      </div>
      <div className="search-box">
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('검색…  tag:프로젝트  path:폴더  file:이름')}
          enterKeyHint="search"
        />
        {q && <button className="clear" onClick={() => setQ('')} aria-label={t('지우기')}>✕</button>}
      </div>
      <div className="search-results">
        {!q && (
          <>
            <h3>{t('태그')}</h3>
            <div className="chips">
              {tagList.map(([t, ps]) => (
                <button key={t} className="chip tag" onClick={() => setQ('tag:' + t)}>#{t} <i>{ps.length}</i></button>
              ))}
              {!tagList.length && <p className="hint">{t('태그가 없습니다.')} {tx('노트에 {tag} 를 써보세요.', { tag: <code>{t('#태그')}</code> })}</p>}
            </div>
            <p className="hint">{tx('검색 연산자: {ops} · 여러 단어는 모두 포함된 노트를 찾습니다.', { ops: <><code>tag:</code> <code>path:</code> <code>file:</code></> })}</p>
          </>
        )}
        {q && !hits.length && <p className="hint pad">{t('결과가 없습니다.')}</p>}
        {hits.map((h) => (
          <button key={h.path} className="hit" onClick={() => open(h.path)}>
            <div className="hit-title">{highlight(baseName(h.path), terms)}</div>
            {h.path.includes('/') && <div className="hit-path">{h.path.slice(0, h.path.lastIndexOf('/'))}</div>}
            <div className="hit-snip">{highlight(h.snippet, terms)}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
