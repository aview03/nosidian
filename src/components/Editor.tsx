import { t } from '../lib/i18n'
import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, drawSelection, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { search } from '@codemirror/search'
import { livePreview } from '../lib/livepreview'
import { findHighlight } from '../lib/findEngine'
import { useApp } from '../lib/app'
import { baseName } from '../lib/links'

interface Props {
  path: string
  initial: string
  onChange(text: string): void
  externalContent: string
}

function wikiCompletion(ctx: CompletionContext) {
  const m = ctx.matchBefore(/\[\[[^\]\n]*$/)
  if (!m) return null
  const q = m.text.slice(2)
  const hash = q.indexOf('#')
  const { index, current } = useApp.getState()
  if (hash >= 0) {
    // 제목 자동완성
    const note = index.resolve(q.slice(0, hash), current ?? undefined)
    const parsed = note ? index.notes.get(note) : null
    return {
      from: m.from + 2 + hash + 1,
      options: (parsed?.headings ?? []).map((hd) => ({ label: hd.text, type: 'text' })),
      validFor: /^[^\]\n]*$/,
    }
  }
  return {
    from: m.from + 2,
    options: index.names.map((p) => ({
      label: baseName(p),
      detail: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '',
      type: 'text',
      apply: (view: EditorView, _c: unknown, from: number, to: number) => {
        const after = view.state.sliceDoc(to, to + 2)
        view.dispatch({
          changes: { from, to, insert: baseName(p) + (after === ']]' ? '' : ']]') },
          selection: { anchor: from + baseName(p).length + (after === ']]' ? 2 : 2) },
        })
      },
    })),
    validFor: /^[^\]#|\n]*$/,
  }
}

function tagCompletion(ctx: CompletionContext) {
  const m = ctx.matchBefore(/(^|\s)#[\p{L}\p{N}_\-/]*/u)
  if (!m) return null
  const start = m.text.indexOf('#')
  return {
    from: m.from + start + 1,
    options: [...useApp.getState().index.tags.keys()].map((t) => ({ label: t, type: 'keyword' })),
    validFor: /^[\p{L}\p{N}_\-/]*$/u,
  }
}

export function Editor({ path, initial, onChange, externalContent }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    const s = useApp.getState()
    const ext: Extension[] = [
      history(),
      drawSelection(),
      closeBrackets(),
      EditorView.lineWrapping,
      search(), // 다음/이전 이동용(패널은 쓰지 않고 FindBar 가 대신한다)
      findHighlight,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      autocompletion({ override: [wikiCompletion, tagCompletion], icons: false }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      placeholder(t('내용을 입력하세요…  [[ 로 다른 노트를 링크')),
      livePreview({
        resolve: (t) => useApp.getState().index.resolve(t, useApp.getState().current ?? undefined),
        open: (t, a) => useApp.getState().openLink(t, a),
        openTag: (t) => {
          useApp.getState().setSearch('tag:' + t)
          useApp.getState().go('search')
        },
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) cb.current(u.state.doc.toString())
      }),
    ]
    const v = new EditorView({ state: EditorState.create({ doc: initial, extensions: ext }), parent: host.current! })
    view.current = v
    ;(window as unknown as { __cm?: EditorView }).__cm = v
    if (s.anchor) {
      // 제목 앵커 위치로 커서 이동
      const parsed = s.index.notes.get(path)
      const hd = parsed?.headings.find((x) => x.text.toLowerCase() === s.anchor!.toLowerCase())
      if (hd) {
        const pos = v.state.doc.line(Math.min(hd.line + 1, v.state.doc.lines)).from
        v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start' }) })
      }
    }
    return () => v.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // 동기화 등 외부 변경 반영
  useEffect(() => {
    const v = view.current
    if (!v) return
    if (v.state.doc.toString() !== externalContent) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: externalContent }, annotations: external.of(true) })
    }
  }, [externalContent])

  const run = (fn: (v: EditorView) => void) => () => {
    const v = view.current
    if (!v) return
    fn(v)
    v.focus()
  }
  const wrapSel = (l: string, r = l) =>
    run((v) => {
      const { from, to } = v.state.selection.main
      const sel = v.state.sliceDoc(from, to)
      v.dispatch({
        changes: { from, to, insert: l + sel + r },
        selection: { anchor: from + l.length, head: from + l.length + sel.length },
      })
    })
  const linePrefix = (p: string) =>
    run((v) => {
      const line = v.state.doc.lineAt(v.state.selection.main.from)
      const has = line.text.startsWith(p)
      v.dispatch({ changes: has ? { from: line.from, to: line.from + p.length } : { from: line.from, insert: p } })
    })
  const insert = (t: string, back = 0) =>
    run((v) => {
      const { from, to } = v.state.selection.main
      v.dispatch({ changes: { from, to, insert: t }, selection: { anchor: from + t.length - back } })
      if (t === '[[]]') import('@codemirror/autocomplete').then((m) => m.startCompletion(v))
    })

  return (
    <div className="editor-wrap">
      <div className="cm-host" ref={host} />
      <div className="edit-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button onClick={insert('[[]]', 2)} title={t('링크')}>[[ ]]</button>
        <button onClick={insert('#')} title={t('태그')}>#</button>
        <button onClick={linePrefix('- [ ] ')} title={t('체크리스트')}>☑</button>
        <button onClick={linePrefix('- ')} title={t('목록')}>•</button>
        <button onClick={linePrefix('## ')} title={t('제목')}>H</button>
        <button onClick={wrapSel('**')} title={t('굵게')}><b>B</b></button>
        <button onClick={wrapSel('*')} title={t('기울임')}><i>I</i></button>
        <button onClick={wrapSel('==')} title={t('하이라이트')}>▮</button>
        <button onClick={wrapSel('`')} title={t('코드')}>{'</>'}</button>
        <button onClick={linePrefix('> ')} title={t('인용')}>❝</button>
        <button onClick={run((v) => import('@codemirror/commands').then((m) => m.undo(v)))} title={t('실행 취소')}>↶</button>
        <button onClick={run((v) => import('@codemirror/commands').then((m) => m.redo(v)))} title={t('다시 실행')}>↷</button>
      </div>
    </div>
  )
}

import { Annotation } from '@codemirror/state'
const external = Annotation.define<boolean>()
