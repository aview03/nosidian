import { t } from '../lib/i18n'
import { diffHunks } from '../lib/merge'
import { tx } from '../lib/tx'
import { useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { useApp } from '../lib/app'
import { baseName } from '../lib/links'
import { renameNoteDialog, deleteNoteDialog, copyNoteLink } from '../lib/noteActions'
import { Reader, scrollToAnchor } from './Reader'
import { useAiThread } from '../lib/aiThread'
import { useWorkUi } from '../lib/workOps'
import { Editor } from './Editor'
import { InfoPanel } from './InfoPanel'
import { FindBar } from './FindBar'
import { Icon } from './Icon'
import { openNewNote } from './NewNote'
import { usePresence } from '../lib/presence'

function InfoSheet({ open, path, onScroll, onClose }: { open: boolean; path: string; onScroll(line: number, text: string): void; onClose(): void }) {
  const { mounted, closing } = usePresence(open)
  if (!mounted) return null
  return (
    <div className={`sheet-wrap${closing ? ' closing' : ''}`} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <InfoPanel path={path} onScroll={onScroll} />
      </div>
    </div>
  )
}

export function NoteView({ wide }: { wide: boolean }) {
  const current = useApp((s) => s.current)
  const external = useApp((s) => s.external)
  const file = useApp((s) => (s.current ? s.files[s.current] : null))
  const mode = useApp((s) => s.mode)
  const index = useApp((s) => s.index)
  const bookmarks = useApp((s) => s.settings.bookmarks)
  const synced = useApp((s) => !!s.settings.remote) // 저장소가 없으면 '동기화 대기' 점을 보이지 않는다(F33)
  const rightOpen = useApp((s) => s.settings.rightOpen)
  const aiOpen = useAiThread((s) => s.open)
  const findOpen = useApp((s) => s.findOpen)
  const sheet = useApp((s) => s.sheet)
  const hpos = useApp((s) => s.hpos)
  const hlen = useApp((s) => s.history.length)
  const hist = { pos: hpos, len: hlen }
  const app = useApp.getState()
  const scroller = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDetailsElement>(null)

  if (external) {
    return (
      <div className="note">
        <header className="note-head">
          <button className="icon-btn" onClick={() => void app.closeExternal()} aria-label={t('닫기')}><Icon name="back" /></button>
          <div className="note-title">
            <span className="t"><span className="tn">{baseName(external.name)}</span>{external.dirty && <span className="dot" title={t('저장 안 됨')} />}</span>
            <span className="p">{t('vault 밖 문서')}{external.source ? '' : ' ' + t('(원본 위치 모름)')}</span>
          </div>
          <button className={`mode-btn ${mode === 'edit' ? 'on' : ''}`} onClick={() => app.setMode(mode === 'edit' ? 'read' : 'edit')}>
            <Icon name={mode === 'edit' ? 'book' : 'edit'} />
            <span>{mode === 'edit' ? t('읽기') : t('편집')}</span>
          </button>
          <details className="menu">
            <summary className="icon-btn" aria-label={t('더보기')}><Icon name="more" /></summary>
            <div className="menu-pop" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
              <button onClick={() => app.openFind()}>{t('문서에서 찾기')}</button>
              <button onClick={() => void app.importExternal()}>{t('vault 로 가져오기')}</button>
              <button onClick={() => void app.closeExternal()}>{t('닫기')}</button>
            </div>
          </details>
          <button className="mode-btn on" disabled={!external.dirty && !!external.source} onClick={() => void app.saveExternal()}>
            <span>{external.source ? t('저장') : t('내려받기')}</span>
          </button>
        </header>
        {!external.hideBanner && (
          <div className="banner">
            {tx('이 문서는 vault 에 들어 있지 않습니다. 편집하고 {save}하면 원본 파일에 반영됩니다.', { save: <b>{t('저장')}</b> })}
            <div className="banner-actions">
              <button onClick={() => void app.importExternal()}>{t('vault 로 가져오기')}</button>
              <button onClick={() => app.dismissExternalBanner()}>{t('무시')}</button>
            </div>
          </div>
        )}
        {findOpen && <FindBar mode={mode} scroller={scroller} content={external.content} />}
        <div className="note-body">
          <div className={`note-scroll ${mode}`} ref={scroller}>
            <div className="swap" key={mode}>
              {mode === 'edit' ? (
                <Editor key={external.name} path={external.name} initial={external.content} externalContent={external.content} onChange={(t) => app.setExternalContent(t)} />
              ) : (
                <Reader path={external.name} content={external.content} />
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!current || !file || file.deleted) {
    return (
      <div className="empty-note">
        <div className="empty-art">✦</div>
        <h2>{t('노트를 선택하거나 추가해 주세요')}</h2>
        <p>{t('파일 목록에서 노트를 고르거나, 새 노트를 만들어 시작하세요.')}</p>
        <div className="empty-actions">
          <button className="primary" onClick={() => app.setPalette('switcher')}>{t('노트 찾기')}<span className="only-wide"> (Ctrl+O)</span></button>
          <button onClick={() => openNewNote()}>{t('새 노트')}</button>
          <button onClick={() => app.openDaily()}>{t('오늘의 노트')}</button>
        </div>
      </div>
    )
  }

  const backCount = index.back.get(current)?.length ?? 0
  const marked = bookmarks.includes(current)
  const closeMenu = () => menu.current?.removeAttribute('open')

  const scrollTo = (line: number, text: string) => {
    if (useApp.getState().mode === 'read') {
      scrollToAnchor(scroller.current, text)
    } else {
      const v = (window as unknown as { __cm?: EditorView }).__cm
      if (v) {
        const pos = v.state.doc.line(Math.min(line + 1, v.state.doc.lines)).from
        v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start' }) })
        v.focus()
      }
    }
    app.setSheet(null)
  }

  const rename = () => {
    closeMenu()
    void renameNoteDialog(current)
  }
  const remove = () => {
    closeMenu()
    void deleteNoteDialog(current)
  }

  return (
    <div className="note">
      <header className="note-head">
        {!wide && (
          <button className="icon-btn" onClick={() => { if (!app.backScreen()) app.go('files') }} aria-label={t('뒤로')}>
            <Icon name="back" />
          </button>
        )}
        {wide && (
          <>
            <button className="icon-btn" disabled={hist.pos <= 0} onClick={() => app.back()} aria-label={t('뒤로')}><Icon name="back" /></button>
            <button className="icon-btn" disabled={hist.pos >= hist.len - 1} onClick={() => app.forward()} aria-label={t('앞으로')}><Icon name="forward" /></button>
          </>
        )}
        <div className="note-title" onClick={rename}>
          <span className="t"><span className="tn">{baseName(current)}</span>{file.dirty && synced && <span className="dot" title={t('동기화 대기')} />}</span>
          {current.includes('/') && <span className="p">{current.slice(0, current.lastIndexOf('/'))}</span>}
        </div>
        <button className={`mode-btn ${mode === 'edit' ? 'on' : ''}`} onClick={() => app.setMode(mode === 'edit' ? 'read' : 'edit')}>
          <Icon name={mode === 'edit' ? 'book' : 'edit'} />
          <span>{mode === 'edit' ? t('읽기') : t('편집')}</span>
        </button>
        {!wide && (
          <button className="icon-btn badge-wrap" onClick={() => app.setSheet(sheet === 'info' ? null : 'info')} aria-label={t('연결')}>
            <Icon name="link" />
            {backCount > 0 && <span className="badge">{backCount}</span>}
          </button>
        )}
        <details className="menu" ref={menu}>
          <summary className="icon-btn" aria-label={t('더보기')}><Icon name="more" /></summary>
          <div className="menu-pop" onClick={closeMenu}>
            <button onClick={() => app.openFind()}>{t('문서에서 찾기')}</button>
            <button onClick={() => app.toggleBookmark(current)}>{marked ? t('★ 북마크 해제') : t('☆ 북마크')}</button>
            <button onClick={rename}>{t('이름 바꾸기')}</button>
            {/^\s*[-*+]\s+\[ \]\s+\S/m.test(file.content) && <button onClick={() => useWorkUi.getState().openTidy(current)}>{t('업무 정리')}</button>}
            <button onClick={() => app.go('graph')}>{t('그래프에서 보기')}</button>
            <button onClick={() => copyNoteLink(current)}>{t('링크 복사')}</button>
            <button className="danger" onClick={remove}>{t('삭제')}</button>
          </div>
        </details>
      </header>

      {file.conflict && (
        <div className="banner">
          {tx('{b} 원격의 이 노트가 다른 곳에서 수정되었습니다.', { b: <b>{t('충돌')}</b> })}
          <ConflictDiff mine={file.content} theirs={file.conflict.content} />
          <div className="banner-actions">
            <button onClick={() => app.resolveConflict(current, 'local')}>{t('내 버전 유지')}</button>
            <button onClick={() => app.resolveConflict(current, 'remote')}>{t('원격 버전 사용')}</button>
            <button onClick={() => app.resolveConflict(current, 'both')}>{t('둘 다 보관')}</button>
          </div>
        </div>
      )}

      {findOpen && <FindBar mode={mode} scroller={scroller} content={file.content} />}
      <div className="note-body">
        <div className={`note-scroll ${mode}`} ref={scroller}>
          <div className="swap" key={`${current}:${mode}`}>
          {mode === 'edit' ? (
            <Editor
              key={current}
              path={current}
              initial={file.content}
              externalContent={file.content}
              onChange={(t) => app.setContent(current, t)}
            />
          ) : (
            <Reader path={current} content={file.content} />
          )}
          </div>
        </div>
        {wide && rightOpen && !aiOpen && (
          <aside className="side-right">
            <div className="side-right-body"><InfoPanel path={current} onScroll={scrollTo} /></div>
            <div className="side-foot">
              <button className="icon-btn" onClick={() => app.patchSettings({ rightOpen: false })} title={t('링크·목차 접기')} aria-label={t('오른쪽 사이드바 접기')}><Icon name="panel-right" /></button>
            </div>
          </aside>
        )}
        {wide && (!rightOpen || aiOpen) && (
          <aside className="side-right-mini">
            <button className="icon-btn" onClick={() => { useAiThread.getState().setOpen(false); app.patchSettings({ rightOpen: true }) }} title={t('링크·목차 펴기')} aria-label={t('오른쪽 사이드바 펴기')}><Icon name="panel-right" /></button>
          </aside>
        )}
      </div>

      {!wide && <InfoSheet open={sheet === 'info'} path={current} onScroll={scrollTo} onClose={() => app.setSheet(null)} />}
    </div>
  )
}

/** 충돌한 곳만 보여 준다: 내 글과 원격 글이 다른 구간(최대 5곳, 곳마다 3줄까지) */
export function ConflictDiff({ mine, theirs }: { mine: string; theirs: string }) {
  const m = mine.split('\n')
  const r = theirs.split('\n')
  const hunks = diffHunks(m, r)
  if (!hunks || hunks.length === 0) return null
  const show = (lines: string[]) => (lines.length ? lines.slice(0, 3).join('\n') + (lines.length > 3 ? '\n…' : '') : t('(없음)'))
  return (
    <details className="conflict-diff">
      <summary>{t('다른 곳 {n}군데 보기', { n: hunks.length })}</summary>
      {hunks.slice(0, 5).map((h, i) => (
        <div key={i} className="cd-hunk">
          <div><b>{t('내 것')}</b><pre>{show(m.slice(h.s, h.e))}</pre></div>
          <div><b>{t('원격')}</b><pre>{show(h.lines)}</pre></div>
        </div>
      ))}
      {hunks.length > 5 && <p className="hint small">{t('… 외 {n}군데', { n: hunks.length - 5 })}</p>}
    </details>
  )
}
