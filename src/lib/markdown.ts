import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import hljs from 'highlight.js/lib/common'
import katex from 'katex'
import { slugAnchor, splitFrontmatter, baseName, dirName } from './links'

export interface RenderCtx {
  from: string // 현재 노트 경로
  resolve(target: string, from?: string): string | null
  resolveAsset(name: string, from?: string): string | null
  getContent(path: string): string | null
  interactive: boolean // 체크박스 토글 허용
  stack: string[] // 임베드 순환 방지
}

const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CALLOUT_ICON: Record<string, string> = {
  note: '✎', info: 'ⓘ', tip: '💡', hint: '💡', important: '❗', success: '✔', check: '✔', done: '✔',
  question: '？', help: '？', faq: '？', warning: '⚠', caution: '⚠', attention: '⚠', failure: '✖', fail: '✖',
  missing: '✖', danger: '⚡', error: '⚡', bug: '🐞', example: '☰', quote: '❝', cite: '❝', abstract: '☰',
  summary: '☰', tldr: '☰', todo: '☑',
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fallthrough */
      }
    }
    return esc(str)
  },
}).use(footnote as never)

type Env = { ctx: RenderCtx; lineOffset: number }

// ── [[위키링크]] / ![[임베드]] ──
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const s = state.src
  let p = state.pos
  let embed = false
  if (s.charCodeAt(p) === 0x21) {
    embed = true
    p++
  }
  if (s.charCodeAt(p) !== 0x5b || s.charCodeAt(p + 1) !== 0x5b) return false
  const end = s.indexOf(']]', p + 2)
  if (end < 0) return false
  const inner = s.slice(p + 2, end)
  if (!inner.trim() || inner.includes('[') || inner.includes('\n')) return false
  if (!silent) {
    const t = state.push(embed ? 'wikiembed' : 'wikilink', '', 0)
    t.content = inner
  }
  state.pos = end + 2
  return true
})

function parseInner(inner: string) {
  const bar = inner.indexOf('|')
  const left = bar < 0 ? inner : inner.slice(0, bar)
  const alias = bar < 0 ? undefined : inner.slice(bar + 1).trim()
  const hash = left.indexOf('#')
  const target = (hash < 0 ? left : left.slice(0, hash)).trim()
  const anchor = hash < 0 ? undefined : left.slice(hash + 1).trim()
  return { target, anchor, alias }
}

md.renderer.rules.wikilink = (tokens, i, _o, env: Env) => {
  const { target, anchor, alias } = parseInner(tokens[i].content)
  const path = env.ctx.resolve(target, env.ctx.from)
  const label = alias ?? (target ? target + (anchor ? ' › ' + anchor : '') : anchor ?? '')
  return `<a href="#" class="internal-link${path ? '' : ' unresolved'}" data-target="${esc(target)}" data-path="${esc(path ?? '')}" data-anchor="${esc(anchor ?? '')}">${esc(label)}</a>`
}

function sectionOf(content: string, anchor: string) {
  const lines = content.split('\n')
  const key = slugAnchor(anchor)
  if (anchor.startsWith('^')) {
    const i = lines.findIndex((l) => l.trimEnd().endsWith(anchor))
    if (i < 0) return content
    let s = i
    while (s > 0 && lines[s - 1].trim() !== '') s--
    return lines.slice(s, i + 1).join('\n').replace(/\s\^[\w-]+$/, '')
  }
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i])
    if (!m) continue
    if (start < 0) {
      if (slugAnchor(m[2]) === key) {
        start = i
        level = m[1].length
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join('\n')
    }
  }
  return start < 0 ? content : lines.slice(start).join('\n')
}

md.renderer.rules.wikiembed = (tokens, i, _o, env: Env) => {
  const ctx = env.ctx
  const { target, anchor, alias } = parseInner(tokens[i].content)
  if (IMG_RE.test(target)) {
    const asset = ctx.resolveAsset(target, ctx.from)
    const w = alias && /^\d+(x\d+)?$/.test(alias) ? alias.split('x')[0] : ''
    return `<img class="embed-img" data-asset="${esc(asset ?? '')}" alt="${esc(target)}"${w ? ` style="width:${w}px"` : ''}>`
  }
  if (/\.(pdf|mp3|mp4|webm|wav|m4a)$/i.test(target)) return `<span class="embed-file">📎 ${esc(target)}</span>`
  const path = ctx.resolve(target, ctx.from)
  if (!path) return `<span class="internal-link unresolved">${esc(target)}</span>`
  if (ctx.stack.includes(path) || ctx.stack.length >= 3)
    return `<a href="#" class="internal-link" data-path="${esc(path)}" data-target="${esc(target)}" data-anchor="">${esc(baseName(path))}</a>`
  let content = ctx.getContent(path) ?? ''
  content = splitFrontmatter(content).body
  if (anchor) content = sectionOf(content, anchor)
  const inner = renderMarkdown(content, { ...ctx, from: path, interactive: false, stack: [...ctx.stack, path] }, true)
  return `<div class="embed-note"><a href="#" class="embed-title internal-link" data-path="${esc(path)}" data-target="${esc(target)}" data-anchor="${esc(anchor ?? '')}">${esc(baseName(path))}${anchor ? ' › ' + esc(anchor.replace(/^\^/, '')) : ''}</a>${inner}</div>`
}

// ── #태그 ──
md.inline.ruler.before('link', 'obtag', (state, silent) => {
  const s = state.src
  const pos = state.pos
  if (s.charCodeAt(pos) !== 0x23) return false
  if (pos > 0 && !/[\s(]/.test(s[pos - 1])) return false
  const m = /^#([\p{L}\p{N}_\-/]+)/u.exec(s.slice(pos))
  if (!m || /^\d+$/.test(m[1])) return false
  if (!silent) {
    const t = state.push('obtag', '', 0)
    t.content = m[1]
  }
  state.pos += m[0].length
  return true
})
md.renderer.rules.obtag = (tokens, i) =>
  `<a href="#" class="tag" data-tag="${esc(tokens[i].content)}">#${esc(tokens[i].content)}</a>`

// ── ==하이라이트== ──
md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
  const s = state.src
  const start = state.pos
  if (s.charCodeAt(start) !== 0x3d || s.charCodeAt(start + 1) !== 0x3d) return false
  const end = s.indexOf('==', start + 2)
  if (end < 0 || end === start + 2) return false
  if (!silent) {
    state.push('mark_open', 'mark', 1)
    const oldMax = state.posMax
    state.pos = start + 2
    state.posMax = end
    state.md.inline.tokenize(state)
    state.posMax = oldMax
    state.push('mark_close', 'mark', -1)
  }
  state.pos = end + 2
  return true
})

// ── 수식 ──
md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const s = state.src
  const start = state.pos
  if (s.charCodeAt(start) !== 0x24 || s.charCodeAt(start + 1) === 0x24) return false
  let end = start + 1
  while ((end = s.indexOf('$', end)) >= 0 && s.charCodeAt(end - 1) === 0x5c) end++
  if (end < 0 || end === start + 1) return false
  const inner = s.slice(start + 1, end)
  if (/^\s|\s$/.test(inner) || inner.includes('\n') || /\d/.test(s[end + 1] ?? '')) return false
  if (!silent) {
    const t = state.push('math_inline', '', 0)
    t.content = inner
  }
  state.pos = end + 1
  return true
})
md.renderer.rules.math_inline = (tokens, i) =>
  katex.renderToString(tokens[i].content, { throwOnError: false })

md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
  let pos = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  if (state.src.slice(pos, pos + 2) !== '$$') return false
  if (silent) return true
  let first = state.src.slice(pos + 2, max)
  let nextLine = startLine
  let content = ''
  if (first.trimEnd().endsWith('$$') && first.trim().length > 2) {
    content = first.trimEnd().slice(0, -2)
  } else {
    let found = false
    if (first.trim()) content += first + '\n'
    while (++nextLine < endLine) {
      pos = state.bMarks[nextLine] + state.tShift[nextLine]
      const lmax = state.eMarks[nextLine]
      const line = state.src.slice(pos, lmax)
      if (line.trimEnd().endsWith('$$')) {
        content += line.trimEnd().slice(0, -2)
        found = true
        break
      }
      content += line + '\n'
    }
    if (!found) return false
    first = ''
  }
  state.line = nextLine + 1
  const t = state.push('math_block', '', 0)
  t.content = content
  t.map = [startLine, state.line]
  t.block = true
  return true
})
md.renderer.rules.math_block = (tokens, i) =>
  `<div class="math-block">${katex.renderToString(tokens[i].content, { throwOnError: false, displayMode: true })}</div>`

// ── 코드 펜스: mermaid ──
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, i, o, env, self) => {
  const t = tokens[i]
  if (t.info.trim() === 'mermaid') return `<div class="mermaid-block" data-src="${esc(t.content)}"><pre>${esc(t.content)}</pre></div>`
  const lang = t.info.trim().split(/\s+/)[0]
  const body = defaultFence(tokens, i, o, env, self)
  return `<div class="code-block">${lang ? `<span class="code-lang">${esc(lang)}</span>` : ''}${body}</div>`
}

// ── 표 가로 스크롤 ──
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>'
md.renderer.rules.table_close = () => '</table></div>'

// ── 일반 링크 / 이미지 ──
const defaultLinkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
md.renderer.rules.link_open = (tokens, i, o, env: Env, self) => {
  const t = tokens[i]
  const href = t.attrGet('href') ?? ''
  if (/^https?:|^mailto:/i.test(href)) {
    t.attrSet('target', '_blank')
    t.attrSet('rel', 'noopener noreferrer')
    t.attrJoin('class', 'external-link')
  } else if (href.startsWith('#')) {
    // 각주 등 문서 내 앵커
  } else {
    let dec = href
    try {
      dec = decodeURI(href)
    } catch {
      /* noop */
    }
    const [file, anchor] = dec.split('#')
    const path = env.ctx.resolve(file.replace(/\.md$/i, ''), env.ctx.from)
    t.attrSet('href', '#')
    t.attrJoin('class', 'internal-link' + (path ? '' : ' unresolved'))
    t.attrSet('data-target', file.replace(/\.md$/i, ''))
    t.attrSet('data-path', path ?? '')
    t.attrSet('data-anchor', anchor ?? '')
  }
  return defaultLinkOpen(tokens, i, o, env as never, self)
}
md.renderer.rules.image = (tokens, i, _o, env: Env) => {
  const t = tokens[i]
  const src = t.attrGet('src') ?? ''
  const alt = esc(t.content)
  if (/^(https?:|data:)/i.test(src)) return `<img src="${esc(src)}" alt="${alt}" loading="lazy">`
  let dec = src
  try {
    dec = decodeURI(src)
  } catch {
    /* noop */
  }
  const asset = env.ctx.resolveAsset(dec, env.ctx.from)
  return `<img class="embed-img" data-asset="${esc(asset ?? '')}" alt="${alt}">`
}

// ── 코어 룰: 콜아웃, 체크박스, 제목/블록 id ──
md.core.ruler.push('obsidian', (state) => {
  const env = state.env as Env
  const toks = state.tokens

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]

    // 제목: data-h / data-line
    if (t.type === 'heading_open' && toks[i + 1]?.type === 'inline') {
      t.attrSet('data-h', slugAnchor(toks[i + 1].content))
      if (t.map) t.attrSet('data-line', String(t.map[0] + env.lineOffset))
    }

    // 블록 id: 문단 끝의 ^abc
    if (t.type === 'paragraph_open' && toks[i + 1]?.type === 'inline') {
      const inl = toks[i + 1]
      const m = /(?:^|\s)(\^[\w-]+)$/.exec(inl.content)
      if (m) {
        t.attrSet('id', m[1])
        inl.content = inl.content.slice(0, inl.content.length - m[0].length)
        const last = inl.children?.[inl.children.length - 1]
        if (last?.type === 'text') last.content = last.content.replace(/\s?\^[\w-]+$/, '')
      }
    }

    // 체크박스
    if (t.type === 'list_item_open' && toks[i + 1]?.type === 'paragraph_open' && toks[i + 2]?.type === 'inline') {
      const inl = toks[i + 2]
      const m = /^\[([ xX])\]\s+/.exec(inl.content)
      if (m && inl.children?.[0]?.type === 'text') {
        inl.children[0].content = inl.children[0].content.replace(/^\[[ xX]\]\s+/, '')
        const box = new state.Token('html_inline', '', 0)
        const done = m[1] !== ' '
        box.content = `<input type="checkbox" class="task" data-line="${(t.map?.[0] ?? 0) + env.lineOffset}"${done ? ' checked' : ''}${env.ctx.interactive ? '' : ' disabled'}> `
        inl.children.unshift(box)
        t.attrJoin('class', 'task-item' + (done ? ' done' : ''))
      }
    }

    // 콜아웃
    if (t.type === 'blockquote_open') {
      let j = i + 1
      if (toks[j]?.type !== 'paragraph_open' || toks[j + 1]?.type !== 'inline') continue
      const inl = toks[j + 1]
      const first = inl.content.split('\n')[0]
      const m = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/.exec(first)
      if (!m) continue
      const type = m[1].toLowerCase()
      const fold = m[2]
      const title = m[3] || type.charAt(0).toUpperCase() + type.slice(1)
      const rest = inl.content.split('\n').slice(1).join('\n')
      // 닫는 blockquote 찾기
      let depth = 0
      let close = i
      for (let k = i; k < toks.length; k++) {
        if (toks[k].type === 'blockquote_open') depth++
        if (toks[k].type === 'blockquote_close' && --depth === 0) {
          close = k
          break
        }
      }
      const tag = fold ? 'details' : 'div'
      t.tag = tag
      toks[close].tag = tag
      t.attrJoin('class', 'callout')
      t.attrSet('data-callout', type)
      if (fold === '+') t.attrSet('open', '')
      const head = new state.Token('html_block', '', 0)
      const iconCls = CALLOUT_ICON[type] ? type : 'note'
      head.content = `<${fold ? 'summary' : 'div'} class="callout-title"><span class="callout-icon">${CALLOUT_ICON[iconCls]}</span><span>${esc(title)}</span></${fold ? 'summary' : 'div'}>\n`
      if (rest.trim()) {
        inl.content = rest
        inl.children = []
        state.md.inline.parse(rest, state.md, state.env, inl.children)
        toks.splice(i + 1, 0, head)
      } else {
        // 제목만 있는 경우: 문단 3개 토큰을 head로 교체
        toks.splice(j, 3, head)
      }
    }
  }
})

export function renderMarkdown(src: string, ctx: RenderCtx, noFm = false): string {
  let body = src
  let lineOffset = 0
  if (!noFm) {
    const sp = splitFrontmatter(src)
    body = sp.body
    lineOffset = sp.lines
  }
  const env: Env = { ctx, lineOffset }
  return md.render(body, env)
}

export { dirName }
