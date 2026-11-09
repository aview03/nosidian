import { load as yamlLoad } from 'js-yaml'

export interface LinkRef {
  target: string // 노트 이름/경로 (앵커 제외)
  anchor?: string
  alias?: string
  embed: boolean
  line: number
}
export interface Heading {
  level: number
  text: string
  line: number
}
export interface ParsedNote {
  path: string
  title: string
  fm: Record<string, unknown>
  links: LinkRef[]
  tags: string[]
  headings: Heading[]
  aliases: string[]
  body: string // 코드/프론트매터 제거(공백 치환)된 본문
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export function splitFrontmatter(src: string) {
  const m = FM_RE.exec(src)
  if (!m) return { fm: {} as Record<string, unknown>, body: src, raw: '', lines: 0 }
  let fm: Record<string, unknown> = {}
  try {
    const v = yamlLoad(m[1])
    if (v && typeof v === 'object' && !Array.isArray(v)) fm = v as Record<string, unknown>
  } catch {
    /* 잘못된 YAML은 무시 */
  }
  return { fm, body: src.slice(m[0].length), raw: m[1], lines: m[0].split('\n').length - 1 }
}

function blank(s: string) {
  return s.replace(/[^\n]/g, ' ')
}
function stripCode(s: string) {
  return s
    .replace(/```[\s\S]*?(```|$)|~~~[\s\S]*?(~~~|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\$\$[\s\S]*?\$\$/g, blank)
}

export function baseName(path: string) {
  const f = path.slice(path.lastIndexOf('/') + 1)
  return f.replace(/\.md$/i, '')
}
export function dirName(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

const cache = new Map<string, { content: string; parsed: ParsedNote }>()

function splitFirst(s: string, ch: string): [string, string | undefined] {
  const i = s.indexOf(ch)
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)]
}

export function parseNote(path: string, content: string): ParsedNote {
  const hit = cache.get(path)
  if (hit && hit.content === content) return hit.parsed

  const { fm, lines } = splitFrontmatter(content)
  // 프론트매터 영역은 같은 줄 수의 공백으로 치환 (줄 번호 유지)
  let body = content
  if (lines) {
    const idx = content.split('\n').slice(0, lines).join('\n').length
    body = blank(content.slice(0, idx)) + content.slice(idx)
  }
  body = stripCode(body)

  const links: LinkRef[] = []
  const lineStarts: number[] = [0]
  for (let i = 0; i < body.length; i++) if (body[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (pos: number) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  for (const m of body.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
    const [left, alias] = splitFirst(m[2], '|')
    const [target, anchor] = splitFirst(left, '#')
    links.push({ target: target.trim(), anchor: anchor?.trim(), alias: alias?.trim(), embed: m[1] === '!', line: lineOf(m.index!) })
  }
  for (const m of body.matchAll(/(!?)\[[^\]\n]*\]\(([^)\s]+?\.md)(?:#([^)\s]*))?\)/gi)) {
    if (/^[a-z]+:/i.test(m[2])) continue
    let t = m[2]
    try {
      t = decodeURI(t)
    } catch {
      /* noop */
    }
    links.push({ target: t.replace(/\.md$/i, ''), anchor: m[3], embed: false, line: lineOf(m.index!) })
  }

  const tagSet = new Set<string>()
  for (const m of body.matchAll(/(^|[\s(])#([\p{L}\p{N}_\-/]+)/gu)) {
    if (/^\d+$/.test(m[2])) continue
    tagSet.add(m[2])
  }
  const fmTags = fm.tags ?? fm.tag
  const arr = Array.isArray(fmTags) ? fmTags : typeof fmTags === 'string' ? fmTags.split(/[,\s]+/) : []
  for (const t of arr) if (t) tagSet.add(String(t).replace(/^#/, ''))

  const headings: Heading[] = []
  body.split('\n').forEach((ln, i) => {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(ln)
    if (m) headings.push({ level: m[1].length, text: m[2].replace(/[*_`=~]/g, ''), line: i })
  })

  const al = fm.aliases ?? fm.alias
  const aliases = (Array.isArray(al) ? al : typeof al === 'string' ? [al] : []).map(String)

  const parsed: ParsedNote = {
    path,
    title: baseName(path),
    fm,
    links,
    tags: [...tagSet],
    headings,
    aliases,
    body,
  }
  cache.set(path, { content, parsed })
  return parsed
}

export interface LinkIndex {
  notes: Map<string, ParsedNote>
  resolve(target: string, from?: string): string | null
  out: Map<string, string[]>
  back: Map<string, string[]>
  unresolved: Map<string, string[]> // path -> 해결 안 된 링크 이름
  tags: Map<string, string[]> // tag -> paths
  names: string[] // 자동완성용 (경로 정렬)
}

function commonPrefix(a: string, b: string) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

export function buildIndex(files: { path: string; content: string }[]): LinkIndex {
  const notes = new Map<string, ParsedNote>()
  const byName = new Map<string, string[]>()
  const byPathLower = new Map<string, string>()
  const alias = new Map<string, string>()
  for (const f of files) {
    const p = parseNote(f.path, f.content)
    notes.set(f.path, p)
    const k = p.title.toLowerCase()
    byName.set(k, [...(byName.get(k) ?? []), f.path])
    byPathLower.set(f.path.replace(/\.md$/i, '').toLowerCase(), f.path)
    for (const a of p.aliases) alias.set(a.toLowerCase(), f.path)
  }

  const resolve = (target: string, from?: string): string | null => {
    let t = target.trim().replace(/\.md$/i, '').toLowerCase()
    if (!t) return from ?? null
    if (t.startsWith('/')) t = t.slice(1)
    if (t.includes('/')) {
      const exact = byPathLower.get(t)
      if (exact) return exact
      for (const [k, v] of byPathLower) if (k.endsWith('/' + t)) return v
      return null
    }
    const c = byName.get(t)
    if (c?.length) {
      if (c.length === 1 || !from) return c[0]
      // 같은 이름이 여러 개면 현재 문서와 가장 가까운 폴더 우선
      const fd = dirName(from)
      return [...c].sort((a, b) => commonPrefix(dirName(b), fd) - commonPrefix(dirName(a), fd))[0]
    }
    return alias.get(t) ?? null
  }

  const out = new Map<string, string[]>()
  const back = new Map<string, string[]>()
  const unresolved = new Map<string, string[]>()
  const tags = new Map<string, string[]>()
  for (const [path, p] of notes) {
    const o = new Set<string>()
    const u = new Set<string>()
    for (const l of p.links) {
      const r = resolve(l.target, path)
      if (r) {
        if (r !== path) o.add(r)
      } else if (l.target) u.add(l.target)
    }
    out.set(path, [...o])
    unresolved.set(path, [...u])
    for (const r of o) back.set(r, [...(back.get(r) ?? []), path])
    for (const t of p.tags) tags.set(t, [...(tags.get(t) ?? []), path])
  }
  const names = [...notes.keys()].sort((a, b) => a.localeCompare(b))
  return { notes, resolve, out, back, unresolved, tags, names }
}

/** 링크되지 않은 언급: 이름이 본문에 나오지만 [[ ]]로 감싸지 않은 노트 */
export function unlinkedMentions(idx: LinkIndex, path: string, files: Map<string, string>) {
  const me = idx.notes.get(path)
  if (!me) return []
  const names = [me.title, ...me.aliases].filter((n) => n.length >= 2)
  const linked = new Set(idx.back.get(path) ?? [])
  const res: { path: string; snippet: string }[] = []
  for (const [p, n] of idx.notes) {
    if (p === path || linked.has(p)) continue
    const text = n.body.replace(/\[\[[^\]]*\]\]/g, (m) => ' '.repeat(m.length))
    const lower = text.toLowerCase()
    for (const nm of names) {
      const i = lower.indexOf(nm.toLowerCase())
      if (i >= 0) {
        const raw = files.get(p) ?? text
        const s = Math.max(0, i - 30)
        res.push({ path: p, snippet: (s ? '…' : '') + raw.slice(s, i + nm.length + 40).replace(/\s+/g, ' ') })
        break
      }
    }
  }
  return res
}

export function slugAnchor(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}
