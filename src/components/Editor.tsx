import { t } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, drawSelection, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { search } from '@codemirror/search'
import { livePreview } from '../lib/livepreview'
import { findHighlight } from '../lib/findEngine'
import { useApp, attachImages } from '../lib/app'
import { isImageFile } from '../lib/images'
import { codeInsert, helpItems, type HelpItem } from '../lib/mdSnippets'
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

const NL = String.fromCharCode(10)

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
          useApp.getState().drillTo('search') // 뒤로 가면 이 노트로 돌아온다
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

  // 이미지 넣기: 붙여넣기·끌어놓기·이미지 버튼. 이 노트 옆 _assets 에 저장하고 커서 자리에 ![](…) 를 넣는다(docs/IMAGES.md)
  const pathRef = useRef(path)
  pathRef.current = path
  const fileIn = useRef<HTMLInputElement>(null)
  const addImages = async (files: File[]) => {
    const v = view.current
    if (!v || !files.length) return
    const app = useApp.getState()
    app.say(t('이미지를 넣는 중…'))
    const { added, failed } = await attachImages(files, pathRef.current)
    if (added.length) {
      const { from, to } = v.state.selection.main
      const atLineStart = from === 0 || v.state.sliceDoc(from - 1, from) === NL
      const text = (atLineStart ? '' : NL) + added.map((a) => a.md).join(NL) + NL
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
    }
    const parts: string[] = []
    if (added.length) {
      parts.push(app.settings.remote ? t('이미지 {n}장을 넣었어요(저장소에는 다음 동기화 때 올라가요)', { n: added.length }) : t('이미지 {n}장을 넣었어요(이 기기에만 저장돼요)', { n: added.length }))
      if (added.some((a) => a.shrunk)) parts.push(t('큰 사진은 줄여서 저장했어요'))
    }
    if (failed.length) parts.push(failed.map((f) => f.why).join(' '))
    useApp.getState().say(parts.join(' · '))
  }
  useEffect(() => {
    const el = host.current
    if (!el) return
    const imgs = (list: DataTransfer | null) => [...(list?.files ?? [])].filter((f) => isImageFile(f))
    const onPaste = (e: ClipboardEvent) => {
      const files = imgs(e.clipboardData)
      if (!files.length) return // 글 붙여넣기는 그대로
      e.preventDefault()
      void addImages(files)
    }
    const onDrop = (e: DragEvent) => {
      const files = imgs(e.dataTransfer)
      if (!files.length) return
      e.preventDefault()
      void addImages(files)
    }
    el.addEventListener('paste', onPaste, true)
    el.addEventListener('drop', onDrop, true)
    return () => {
      el.removeEventListener('paste', onPaste, true)
      el.removeEventListener('drop', onDrop, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

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

  // 코드 버튼: 한 줄이면 인라인 코드, 여러 줄을 골랐거나 빈 줄이면 코드 블록(개발자 P2)
  const codeBtn = run((v) => {
    const { from, to } = v.state.selection.main
    const sel = v.state.sliceDoc(from, to)
    const line = v.state.doc.lineAt(from)
    const r = codeInsert(sel, line.text.trim() === '')
    const lead = r.block && from > line.from ? NL : '' // 코드 블록은 줄 맨 앞에서 시작해야 한다
    const text = lead + r.insert
    if (!r.block && sel) {
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + 1, head: from + 1 + sel.length } })
    } else {
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + lead.length + r.cursor } })
    }
  })

  // 마크다운 도움: 문법 이름을 누르면 그 예를 커서 자리에 넣는다
  const [help, setHelp] = useState(false)
  useEffect(() => {
    if (!help) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setHelp(false)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [help])
  const putSnippet = (it: HelpItem) => {
    const v = view.current
    if (!v) return
    const { from, to } = v.state.selection.main
    const line = v.state.doc.lineAt(from)
    const lead = it.snippet.includes(NL) && from > line.from ? NL : ''
    v.dispatch({ changes: { from, to, insert: lead + it.snippet }, selection: { anchor: from + lead.length + (it.cursor ?? it.snippet.length) } })
    setHelp(false)
    v.focus()
  }

  return (
    <div className="editor-wrap">
      <div className="cm-host" ref={host} />
      <input
        ref={fileIn}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void addImages(files)
        }}
      />
      {help && (
        <div className="md-help" role="dialog" aria-label={t('마크다운 도움')} onMouseDown={(e) => e.preventDefault()}>
          <div className="md-help-head"><b>{t('마크다운 도움')}</b><small>{t('누르면 커서 자리에 넣어요')}</small></div>
          <div className="md-help-list">
            {helpItems().map((it) => (
              <button key={it.id} onClick={() => putSnippet(it)}>
                <span>{it.label}</span>
                <code>{it.snippet.split(NL)[0]}</code>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="edit-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button onClick={insert('[[]]', 2)} title={t('링크')}>[[ ]]</button>
        <button onClick={insert('#')} title={t('태그')}>#</button>
        <button onClick={linePrefix('- [ ] ')} title={t('체크리스트')}>☑</button>
        <button onClick={linePrefix('- ')} title={t('목록')}>•</button>
        <button onClick={linePrefix('## ')} title={t('제목')}>H</button>
        <button onClick={wrapSel('**')} title={t('굵게')}><b>B</b></button>
        <button onClick={codeBtn} title={t('코드 (여러 줄이나 빈 줄이면 코드 블록)')}>{'</>'}</button>
        <button onClick={wrapSel('*')} title={t('기울임')}><i>I</i></button>
        <button onClick={wrapSel('==')} title={t('하이라이트')}>▮</button>
        <button onClick={linePrefix('> ')} title={t('인용')}>❝</button>
        <button onClick={() => fileIn.current?.click()} title={t('이미지')} aria-label={t('이미지')}>🖼</button>
        <button onClick={run((v) => import('@codemirror/commands').then((m) => m.undo(v)))} title={t('실행 취소')}>↶</button>
        <button onClick={run((v) => import('@codemirror/commands').then((m) => m.redo(v)))} title={t('다시 실행')}>↷</button>
        <button className="tb-help" onClick={() => setHelp((h) => !h)} aria-pressed={help} title={t('마크다운 도움')} aria-label={t('마크다운 도움')}>?</button>
      </div>
    </div>
  )
}

import { Annotation } from '@codemirror/state'
const external = Annotation.define<boolean>()
