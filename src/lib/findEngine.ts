// 문서 안 찾기 엔진. 읽기 화면(렌더된 DOM)과 편집 화면(CodeMirror) 각각의 방식으로 같은 인터페이스를 제공한다.
import { SearchQuery, findNext, findPrevious, setSearchQuery } from '@codemirror/search'
import { RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

export interface FindResult {
  count: number
  /** 현재 위치(1부터). 0 = 현재 선택된 결과 없음 */
  index: number
}

export interface FindEngine {
  /** goto=true 면 첫 결과(보이는 위치 이후)로 이동한다. false 면 개수만 갱신 */
  search(q: string, caseSensitive: boolean, goto: boolean): FindResult
  step(dir: 1 | -1): FindResult
  clear(): void
}

const MAX = 5000

// ── 읽기 화면: CSS Custom Highlight API 로 DOM 을 건드리지 않고 칠한다 ──
interface HighlightRegistry {
  set(name: string, h: unknown): void
  delete(name: string): void
}
const registry = (): HighlightRegistry | null => ((CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null)
const makeHighlight = (ranges: Range[]) => new (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight(...ranges)

const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,div,summary,tr,figcaption'

export function readEngine(getRoot: () => HTMLElement | null): FindEngine {
  let ranges: Range[] = []
  let idx = -1

  const paint = (scroll: boolean) => {
    const hl = registry()
    if (hl) {
      if (ranges.length) hl.set('find-hit', makeHighlight(ranges))
      else hl.delete('find-hit')
      if (idx >= 0 && ranges[idx]) hl.set('find-current', makeHighlight([ranges[idx]]))
      else hl.delete('find-current')
    }
    if (scroll && idx >= 0 && ranges[idx]) {
      const r = ranges[idx].getBoundingClientRect()
      const root = getRoot()
      const sc = root?.closest<HTMLElement>('.note-scroll')
      if (sc) {
        const s = sc.getBoundingClientRect()
        sc.scrollTop += r.top - (s.top + s.height / 2)
      }
    }
  }

  const clear = () => {
    ranges = []
    idx = -1
    registry()?.delete('find-hit')
    registry()?.delete('find-current')
  }

  const result = (): FindResult => ({ count: ranges.length, index: idx >= 0 ? idx + 1 : 0 })

  return {
    search(q, cs, goto) {
      const prev = idx
      ranges = []
      idx = -1
      const root = getRoot()
      if (!q || !root) {
        clear()
        return { count: 0, index: 0 }
      }
      // 텍스트 노드를 이어 붙이되, 블록이 바뀌는 곳에는 줄바꿈을 넣어 단락을 넘나드는 가짜 일치를 막는다
      const segs: { node: Text; start: number }[] = []
      let full = ''
      let lastBlock: Element | null = null
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement?.closest('script,style,.katex-mathml') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      })
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        if (!n.data) continue
        const block = n.parentElement?.closest(BLOCK) ?? null
        if (lastBlock && block !== lastBlock) full += '\n'
        lastBlock = block
        segs.push({ node: n, start: full.length })
        full += n.data
      }
      const hay = cs ? full : full.toLowerCase()
      const needle = cs ? q : q.toLowerCase()
      const locate = (pos: number) => {
        let lo = 0
        let hi = segs.length - 1
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if (segs[mid].start <= pos) lo = mid
          else hi = mid - 1
        }
        return { node: segs[lo].node, off: Math.min(pos - segs[lo].start, segs[lo].node.data.length) }
      }
      for (let p = hay.indexOf(needle); p >= 0 && ranges.length < MAX; p = hay.indexOf(needle, p + needle.length)) {
        const a = locate(p)
        const b = locate(p + needle.length - 1)
        const r = document.createRange()
        r.setStart(a.node, a.off)
        r.setEnd(b.node, Math.min(b.off + 1, b.node.data.length))
        ranges.push(r)
      }
      if (!ranges.length) {
        paint(false)
        return { count: 0, index: 0 }
      }
      if (goto) {
        // 지금 보이는 영역 이후의 첫 결과부터
        const sc = root.closest<HTMLElement>('.note-scroll')
        const top = sc ? sc.getBoundingClientRect().top : 0
        const i = ranges.findIndex((r) => r.getBoundingClientRect().top >= top)
        idx = i < 0 ? 0 : i
      } else {
        idx = prev >= 0 ? Math.min(prev, ranges.length - 1) : -1
      }
      paint(goto)
      return result()
    },
    step(dir) {
      if (!ranges.length) return { count: 0, index: 0 }
      idx = idx < 0 ? (dir > 0 ? 0 : ranges.length - 1) : (idx + dir + ranges.length) % ranges.length
      paint(true)
      return result()
    },
    clear,
  }
}

// ── 편집 화면: CodeMirror 검색 엔진 ──
// CodeMirror 기본 검색은 자체 패널이 열려 있을 때만 일치 항목을 칠하므로, 우리 막대용 강조를 따로 둔다
const setFind = StateEffect.define<SearchQuery | null>()
const findField = StateField.define<SearchQuery | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFind)) return e.value
    return v
  },
})
const hitMark = Decoration.mark({ class: 'cm-find-hit' })
const curMark = Decoration.mark({ class: 'cm-find-hit cm-find-current' })
/** Editor 의 extensions 에 넣는다 */
export const findHighlight = [
  findField,
  EditorView.decorations.compute([findField, 'selection', 'doc'], (state) => {
    const q = state.field(findField)
    if (!q || !q.valid) return Decoration.none
    const sel = state.selection.main
    const b = new RangeSetBuilder<Decoration>()
    for (const m of allMatches(state, q)) if (m.to > m.from) b.add(m.from, m.to, m.from === sel.from && m.to === sel.to ? curMark : hitMark)
    return b.finish()
  }),
]
const cm = () => (window as unknown as { __cm?: EditorView }).__cm ?? null

function allMatches(state: EditorState, q: SearchQuery) {
  const out: { from: number; to: number }[] = []
  const cur = q.getCursor(state) as unknown as { next(): { done?: boolean; value: { from: number; to: number } } }
  for (let r = cur.next(); !r.done && out.length < MAX; r = cur.next()) out.push(r.value)
  return out
}

export function editEngine(): FindEngine {
  let query: SearchQuery | null = null
  const result = (v: EditorView): FindResult => {
    if (!query) return { count: 0, index: 0 }
    const all = allMatches(v.state, query)
    const sel = v.state.selection.main
    const i = all.findIndex((m) => m.from === sel.from && m.to === sel.to)
    return { count: all.length, index: i + 1 }
  }
  return {
    search(q, cs, goto) {
      const v = cm()
      if (!v) return { count: 0, index: 0 }
      query = new SearchQuery({ search: q, caseSensitive: cs })
      v.dispatch({ effects: [setSearchQuery.of(query), setFind.of(q ? query : null)] })
      if (!q) return { count: 0, index: 0 }
      const all = allMatches(v.state, query)
      if (goto && all.length) {
        const from = v.state.selection.main.from
        const m = all.find((x) => x.from >= from) ?? all[0]
        v.dispatch({ selection: { anchor: m.from, head: m.to }, effects: EditorView.scrollIntoView(m.from, { y: 'center' }) })
      }
      return result(v)
    },
    step(dir) {
      const v = cm()
      if (!v || !query?.valid) return { count: 0, index: 0 }
      if (dir > 0) findNext(v)
      else findPrevious(v)
      return result(v)
    },
    clear() {
      const v = cm()
      query = null
      if (v) v.dispatch({ effects: [setSearchQuery.of(new SearchQuery({ search: '' })), setFind.of(null)] })
    },
  }
}
