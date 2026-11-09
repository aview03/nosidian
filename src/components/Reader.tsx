import { t } from '../lib/i18n'
import { useEffect, useMemo, useRef } from 'react'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import { useApp, loadAsset, resolveAsset } from '../lib/app'
import { renderMarkdown } from '../lib/markdown'
import { slugAnchor, splitFrontmatter } from '../lib/links'

let mermaidSeq = 0

export function scrollToAnchor(root: HTMLElement | null, anchor: string | null) {
  if (!root || !anchor) return false
  const el = anchor.startsWith('^')
    ? root.querySelector<HTMLElement>(`[id="${CSS.escape(anchor)}"]`)
    : root.querySelector<HTMLElement>(`[data-h="${CSS.escape(slugAnchor(anchor))}"]`)
  el?.scrollIntoView({ block: 'start' })
  return !!el
}

export function Properties({ fm }: { fm: Record<string, unknown> }) {
  const entries = Object.entries(fm)
  if (!entries.length) return null
  const openTag = (t: string) => {
    useApp.getState().setSearch('tag:' + t)
    useApp.getState().go('search')
  }
  return (
    <div className="props">
      {entries.map(([k, v]) => (
        <div className="prop" key={k}>
          <span className="prop-k">{k}</span>
          <span className="prop-v">
            {Array.isArray(v)
              ? v.map((x, i) =>
                  k === 'tags' ? (
                    <button key={i} className="chip tag" onClick={() => openTag(String(x).replace(/^#/, ''))}>#{String(x).replace(/^#/, '')}</button>
                  ) : (
                    <span key={i} className="chip">{String(x)}</span>
                  ),
                )
              : String(v)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Reader({ path, content, compact = false }: { path: string; content: string; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const index = useApp((s) => s.index)
  const assets = useApp((s) => s.assets)
  const anchor = useApp((s) => s.anchor)
  const dark = document.documentElement.dataset.theme === 'dark'

  const fm = useMemo(() => splitFrontmatter(content).fm, [content])
  const html = useMemo(
    () =>
      renderMarkdown(content, {
        from: path,
        resolve: (t, f) => index.resolve(t, f),
        resolveAsset,
        getContent: (p) => useApp.getState().files[p]?.content ?? null,
        interactive: !compact,
        stack: [path],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content, path, index, assets, compact],
  )

  useEffect(() => {
    const root = ref.current
    if (!root) return
    // 이미지
    root.querySelectorAll<HTMLImageElement>('img[data-asset]').forEach(async (img) => {
      const p = img.dataset.asset
      if (!p) {
        img.classList.add('missing')
        img.alt = t('이미지를 찾을 수 없음: {alt}', { alt: img.alt })
        return
      }
      const url = await loadAsset(p)
      if (url) img.src = url
      else img.classList.add('missing')
    })
    // Mermaid
    const blocks = root.querySelectorAll<HTMLElement>('.mermaid-block')
    if (blocks.length) {
      import('mermaid').then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
        for (const b of blocks) {
          try {
            const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, b.dataset.src ?? '')
            b.innerHTML = svg
          } catch {
            b.classList.add('mermaid-error')
          }
        }
      })
    }
    if (anchor && !compact) requestAnimationFrame(() => scrollToAnchor(root, anchor))
  }, [html, anchor, dark, compact])

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    const a = t.closest('a.internal-link') as HTMLElement | null
    const app = useApp.getState()
    if (a) {
      e.preventDefault()
      const p = a.dataset.path
      if (p) app.openNote(p, a.dataset.anchor || null)
      else app.openLink(a.dataset.target ?? '', a.dataset.anchor)
      return
    }
    const tag = t.closest('a.tag') as HTMLElement | null
    if (tag) {
      e.preventDefault()
      app.setSearch('tag:' + tag.dataset.tag)
      app.go('search')
      return
    }
    if (t instanceof HTMLInputElement && t.classList.contains('task') && !compact) {
      e.preventDefault()
      app.toggleTask(path, Number(t.dataset.line))
    }
  }

  return (
    <div className="reader-wrap">
      {!compact && <Properties fm={fm} />}
      <div ref={ref} className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
