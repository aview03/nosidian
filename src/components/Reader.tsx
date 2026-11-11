import { t, t as translate } from '../lib/i18n'
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
    // AI 답변(compact): 코드·복사할 글 블록을 머리글(종류 + 복사/펼치기)이 있는 카드로 감싼다
    if (compact) {
      const svg = (d: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
      root.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
        if (pre.parentElement?.classList.contains('codecard') || pre.closest('.mermaid-block')) return
        const lang = (pre.querySelector('code')?.className.match(/language-([\w+#.-]+)/)?.[1] ?? '').toLowerCase()
        const prose = !lang || ['text', 'txt', 'plain', 'plaintext', 'md', 'markdown'].includes(lang)
        const label = prose ? t('복사할 글') : lang
        const wrap = document.createElement('div')
        wrap.className = `codecard${prose ? ' prose' : ''}`
        const head = document.createElement('div')
        head.className = 'codecard-head'
        const name = document.createElement('span')
        name.textContent = label
        const btns = document.createElement('span')
        btns.className = 'codecard-btns'
        btns.innerHTML = `<button type="button" class="codecard-copy" title="${t('복사')}" aria-label="${t('복사')}">${svg('M9 9h11v11H9zM5 15V5h10')}</button>`
        head.append(name, btns)
        const host = pre.closest('.code-block') ?? pre // 기본 코드 블록의 언어 표시(.code-lang)는 카드 머리글이 대신한다
        host.replaceWith(wrap)
        wrap.append(head, pre)
        if (pre.scrollHeight > 360) {
          wrap.classList.add('clamped')
          btns.insertAdjacentHTML('beforeend', `<button type="button" class="codecard-expand" title="${t('펼치기')}" aria-label="${t('펼치기')}">${svg('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')}</button>`)
        }
      })
    }
    // 노트 읽기 화면: 코드 블록마다 복사 버튼(개발자 P2). 폰은 마우스를 올릴 수 없으니 늘 보인다
    if (!compact) {
      root.querySelectorAll<HTMLElement>('.code-block').forEach((b) => {
        if (b.querySelector('.code-copy')) return
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'code-copy'
        btn.title = t('코드 복사')
        btn.setAttribute('aria-label', t('코드 복사'))
        btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9h11v11H9zM5 15V5h10"/></svg>'
        b.appendChild(btn)
      })
    }
    if (anchor && !compact) requestAnimationFrame(() => scrollToAnchor(root, anchor))
  }, [html, anchor, dark, compact])

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    const card = t.closest('.codecard')
    const tr = (k: string) => translate(k)
    const cc = t.closest('.code-copy')
    if (cc) {
      const text = cc.closest('.code-block')?.querySelector('pre')?.textContent ?? ''
      void navigator.clipboard.writeText(text.replace(/\n$/, '')).then(() => useApp.getState().say(tr('복사했어요')))
      return
    }
    if (card && t.closest('.codecard-copy')) {
      const text = card.querySelector('pre')?.textContent ?? ''
      void navigator.clipboard.writeText(text.replace(/\n$/, '')).then(() => useApp.getState().say(tr('복사했어요')))
      return
    }
    if (card && t.closest('.codecard-expand')) {
      card.classList.toggle('open')
      return
    }
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
