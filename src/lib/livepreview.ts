import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export interface LPHooks {
  resolve(target: string): string | null
  open(target: string, anchor?: string): void
  openTag(tag: string): void
}

class CheckWidget extends WidgetType {
  readonly checked: boolean
  readonly from: number
  constructor(checked: boolean, from: number) {
    super()
    this.checked = checked
    this.from = from
  }
  eq(o: CheckWidget) {
    return o.checked === this.checked && o.from === this.from
  }
  toDOM(view: EditorView) {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.className = 'cm-task'
    el.checked = this.checked
    el.onmousedown = (e) => e.preventDefault()
    el.onclick = (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(el)
      const line = view.state.doc.lineAt(pos)
      const m = /\[([ xX])\]/.exec(line.text)
      if (!m) return
      const at = line.from + m.index + 1
      view.dispatch({ changes: { from: at, to: at + 1, insert: m[1] === ' ' ? 'x' : ' ' } })
    }
    return el
  }
  ignoreEvent() {
    return true
  }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-bullet'
    s.textContent = '•'
    return s
  }
}

const hide = Decoration.replace({})
const h = (n: number) => Decoration.line({ class: `cm-h cm-h${n}` })
const strong = Decoration.mark({ class: 'cm-strong' })
const em = Decoration.mark({ class: 'cm-em' })
const strike = Decoration.mark({ class: 'cm-strike' })
const code = Decoration.mark({ class: 'cm-icode' })
const quoteLine = Decoration.line({ class: 'cm-quote' })
const codeLine = Decoration.line({ class: 'cm-codeline' })
const tagMark = Decoration.mark({ class: 'cm-tag' })
const hlMark = Decoration.mark({ class: 'cm-hl' })
const urlMark = Decoration.mark({ class: 'cm-url' })

export function livePreview(hooks: LPHooks): Extension {
  const build = (view: EditorView): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>()
    const sel = view.state.selection.ranges
    const active = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from)
    const activeLine = (from: number, to: number) => {
      const a = view.state.doc.lineAt(from).number
      const z = view.state.doc.lineAt(to).number
      return sel.some((r) => {
        const rl = view.state.doc.lineAt(r.from).number
        const rz = view.state.doc.lineAt(r.to).number
        return rl <= z && rz >= a
      })
    }
    type Item = { from: number; to: number; deco: Decoration; line?: boolean }
    const items: Item[] = []
    const push = (from: number, to: number, deco: Decoration, line = false) => items.push({ from, to, deco, line })

    for (const { from, to } of view.visibleRanges) {
      // 위키링크 / 태그 / 하이라이트: 정규식으로 처리 (코드 영역 제외)
      const text = view.state.doc.sliceString(from, to)
      const skip: [number, number][] = []
      syntaxTree(view.state).iterate({
        from,
        to,
        enter(n) {
          if (n.name === 'FencedCode' || n.name === 'InlineCode' || n.name === 'CodeBlock') skip.push([n.from, n.to])
        },
      })
      const inCode = (p: number) => skip.some(([a, z]) => p >= a && p < z)

      for (const m of text.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
        const s = from + m.index!
        const e = s + m[0].length
        if (inCode(s)) continue
        const inner = m[2]
        const bar = inner.indexOf('|')
        const left = bar < 0 ? inner : inner.slice(0, bar)
        const hash = left.indexOf('#')
        const target = (hash < 0 ? left : left.slice(0, hash)).trim()
        const ok = !target || !!hooks.resolve(target)
        const open = s + m[1].length + 2
        const cursorIn = active(s, e)
        const cls = `cm-wikilink${ok ? '' : ' cm-unresolved'}${m[1] ? ' cm-embed' : ''}`
        if (cursorIn) {
          push(s, e, Decoration.mark({ class: cls }))
        } else {
          push(s, open, hide)
          if (bar >= 0) push(open, open + bar + 1, hide) // 별칭이 있으면 대상 부분을 숨김
          push(open + (bar >= 0 ? bar + 1 : 0), e - 2, Decoration.mark({ class: cls, attributes: { 'data-link': inner } }))
          push(e - 2, e, hide)
        }
      }
      for (const m of text.matchAll(/(^|[\s(])#([\p{L}\p{N}_\-/]+)/gu)) {
        if (/^\d+$/.test(m[2])) continue
        const s = from + m.index! + m[1].length
        if (inCode(s)) continue
        // 제목(# ) 마커와 구분: "# " 뒤 공백이면 위 정규식에 걸리지 않음
        push(s, s + m[2].length + 1, tagMark)
      }
      for (const m of text.matchAll(/==([^=\n]+)==/g)) {
        const s = from + m.index!
        if (inCode(s)) continue
        if (active(s, s + m[0].length)) push(s, s + m[0].length, hlMark)
        else {
          push(s, s + 2, hide)
          push(s + 2, s + m[0].length - 2, hlMark)
          push(s + m[0].length - 2, s + m[0].length, hide)
        }
      }

      syntaxTree(view.state).iterate({
        from,
        to,
        enter(n) {
          const name = n.name
          const line = (p: number) => view.state.doc.lineAt(p)
          if (/^ATXHeading(\d)$/.test(name)) {
            const lvl = +name.slice(-1)
            push(line(n.from).from, line(n.from).from, h(lvl), true)
          } else if (name === 'HeaderMark') {
            if (!activeLine(n.from, n.to)) push(n.from, Math.min(n.to + 1, line(n.from).to), hide)
          } else if (name === 'StrongEmphasis') {
            push(n.from, n.to, strong)
          } else if (name === 'Emphasis') {
            push(n.from, n.to, em)
          } else if (name === 'Strikethrough') {
            push(n.from, n.to, strike)
          } else if (name === 'InlineCode') {
            push(n.from, n.to, code)
          } else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
            const p = n.node.parent
            if (p && !active(p.from, p.to)) push(n.from, n.to, hide)
          } else if (name === 'CodeMark' && n.node.parent?.name === 'InlineCode') {
            const p = n.node.parent
            if (!active(p.from, p.to)) push(n.from, n.to, hide)
          } else if (name === 'Blockquote') {
            for (let l = line(n.from).number; l <= line(n.to).number; l++) push(view.state.doc.line(l).from, view.state.doc.line(l).from, quoteLine, true)
          } else if (name === 'QuoteMark') {
            if (!activeLine(n.from, n.to)) push(n.from, Math.min(n.to + 1, line(n.from).to), hide)
          } else if (name === 'FencedCode') {
            for (let l = line(n.from).number; l <= line(n.to).number; l++) push(view.state.doc.line(l).from, view.state.doc.line(l).from, codeLine, true)
          } else if (name === 'ListMark') {
            const txt = view.state.sliceDoc(n.from, n.to)
            if (/^[-*+]$/.test(txt) && !activeLine(n.from, n.to)) push(n.from, n.to, Decoration.replace({ widget: new BulletWidget() }))
          } else if (name === 'TaskMarker') {
            const txt = view.state.sliceDoc(n.from, n.to)
            if (!activeLine(n.from, n.to)) push(n.from, n.to, Decoration.replace({ widget: new CheckWidget(/x/i.test(txt), n.from) }))
          } else if (name === 'URL' && n.node.parent?.name === 'Link') {
            push(n.from, n.to, urlMark)
          }
        },
      })
    }

    items.sort((a, b) => a.from - b.from || (a.line ? -1 : 0) - (b.line ? -1 : 0) || a.to - b.to)
    let lastTo = -1
    for (const it of items) {
      // 겹치는 replace 방지
      if (!it.line && it.deco.spec.widget === undefined && it.from < lastTo && it.to > it.from && it.deco === hide) continue
      try {
        b.add(it.from, it.to, it.deco)
        if (!it.line && it.to > it.from && (it.deco === hide || it.deco.spec.widget)) lastTo = Math.max(lastTo, it.to)
      } catch {
        /* 순서 문제는 무시 */
      }
    }
    return b.finish()
  }

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) this.decorations = build(u.view)
      }
    },
    { decorations: (v) => v.decorations },
  )

  const clicks = EditorView.domEventHandlers({
    click(e, view) {
      const el = (e.target as HTMLElement).closest('.cm-wikilink') as HTMLElement | null
      const touch = (e as PointerEvent).pointerType === 'touch'
      if (el && (touch || e.ctrlKey || e.metaKey)) {
        const raw = el.getAttribute('data-link')
        if (raw) {
          const left = raw.split('|')[0]
          const [t, a] = left.split('#')
          hooks.open(t.trim(), a?.trim())
          e.preventDefault()
          return true
        }
      }
      const tg = (e.target as HTMLElement).closest('.cm-tag')
      if (tg && (touch || e.ctrlKey || e.metaKey)) {
        hooks.openTag(tg.textContent!.replace(/^#/, ''))
        return true
      }
      void view
      return false
    },
  })

  return [plugin, clicks]
}
