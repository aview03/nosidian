import { t } from '../lib/i18n'
import { useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { baseName } from '../lib/links'
import { Icon } from './Icon'
import { openNewFolder, openNewNote } from './NewNote'
import { importFromPicker } from '../lib/importFiles'
import { useActiveVault } from './VaultSheet'
import { NoteContextMenu, useNoteMenu } from './NoteContextMenu'
import { isProtectedPath } from '../lib/docrules'

interface Node {
  name: string
  path: string
  children: Map<string, Node>
  file?: boolean
}

function build(paths: string[]) {
  const root: Node = { name: '', path: '', children: new Map() }
  for (const p of paths) {
    const parts = p.split('/')
    let n = root
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1
      const key = (isFile ? 'f:' : 'd:') + part
      let c = n.children.get(key)
      if (!c) {
        c = { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map(), file: isFile }
        n.children.set(key, c)
      }
      n = c
    })
  }
  return root
}

export function FileTree() {
  const files = useApp((s) => s.files)
  const current = useApp((s) => s.current)
  const bookmarks = useApp((s) => s.settings.bookmarks)
  const synced = useApp((s) => !!s.settings.remote) // 동기화 대기 점은 저장소를 연결했을 때만 의미가 있다(로컬 전용 보관함은 모든 노트가 '대기'라 오류처럼 보였다 — F33)
  const recent = useApp((s) => s.settings.recent)
  const showRecent = useApp((s) => s.settings.showRecent)
  const app = useApp.getState()
  const vault = useActiveVault()
  const nm = useNoteMenu()
  /** 팀 규칙 같은 시스템 폴더(_workspace)는 평소엔 한 줄로 접어 둔다(그 안의 노트를 열어 둔 동안은 펼침) */
  const [showSys, setShowSys] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('amsidian.closed') ?? '[]')))

  const paths = useMemo(() => Object.values(files).filter((f) => !f.deleted).map((f) => f.path), [files])
  const tree = useMemo(() => build(paths), [paths])

  const toggle = (p: string) => {
    const n = new Set(closed)
    if (n.has(p)) n.delete(p)
    else n.add(p)
    setClosed(n)
    localStorage.setItem('amsidian.closed', JSON.stringify([...n]))
  }

  const newNote = (dir?: string) => openNewNote(dir)
  const newFolder = () => openNewFolder()

  const row = (n: Node, depth: number) => {
    const pad = { paddingLeft: 12 + depth * 16 }
    if (n.file) {
      const f = files[n.path]
      return (
        <button key={n.path} className={`tree-row file ${current === n.path ? 'on' : ''}`} style={pad} onClick={() => app.openNote(n.path)} {...nm.bind(n.path)}>
          <span className="tree-name">{baseName(n.path)}</span>
          {f?.conflict ? <span className="dot warn" /> : f?.dirty && synced ? <span className="dot" /> : null}
        </button>
      )
    }
    const open = !closed.has(n.path)
    const kids = [...n.children.values()].sort((a, b) => (a.file === b.file ? a.name.localeCompare(b.name, 'ko') : a.file ? 1 : -1))
    return (
      <div key={n.path}>
        <div className="tree-row dir" style={pad}>
          <button className="tree-dir-btn" onClick={() => toggle(n.path)}>
            <span className={`caret ${open ? 'open' : ''}`}><Icon name="chevron" size={14} /></span>
            <span className="tree-name">{n.name}</span>
            <span className="count">{kids.length}</span>
          </button>
          <button className="mini-add" onClick={() => newNote(n.path)} aria-label={t('이 폴더에 새 노트')}><Icon name="plus" size={16} /></button>
        </div>
        {open && <div className="tree-kids">{kids.map((k) => row(k, depth + 1))}</div>}
      </div>
    )
  }

  const top = [...tree.children.values()].sort((a, b) => (a.file === b.file ? a.name.localeCompare(b.name, 'ko') : a.file ? 1 : -1))
  const sysTop = top.filter((n) => !n.file && isProtectedPath(n.path + '/'))
  const sysOpen = showSys || (!!current && isProtectedPath(current))
  const listed = sysOpen ? top : top.filter((n) => !sysTop.includes(n))
  const valid = (list: string[]) => list.filter((p) => files[p] && !files[p].deleted)

  return (
    <div className="filetree">
      <div className="panel-head">
        <h2 className="vault-title">
          <button className="vault-btn" onClick={() => app.setVaultSheet(true)} aria-label={t('vault 전환')} title={vault?.name}>
            <span className="vault-name">{vault?.name ?? t('노트')}</span>
            <span className="vault-caret"><Icon name="chevron" size={14} /></span>
          </button>
          <small>{paths.length}</small>
        </h2>
        <div className="head-actions">
          <button className="icon-btn" onClick={() => app.openDaily()} aria-label={t('오늘의 노트')}><Icon name="calendar" /></button>
          <button className="icon-btn" onClick={() => void importFromPicker()} aria-label={t('md 파일 가져오기')}><Icon name="import" /></button>
          <button className="icon-btn" onClick={newFolder} aria-label={t('새 폴더')}><Icon name="folder" /></button>
          <button className="icon-btn accent" onClick={() => newNote()} aria-label={t('새 노트')}><Icon name="plus" /></button>
        </div>
      </div>
      <div className="tree-scroll">
        {valid(bookmarks).length > 0 && (
          <section>
            <h3>{t('★ 북마크')}</h3>
            {valid(bookmarks).map((p) => (
              <button key={p} className={`tree-row file ${current === p ? 'on' : ''}`} style={{ paddingLeft: 12 }} onClick={() => app.openNote(p)} {...nm.bind(p)}>
                <span className="tree-name">{baseName(p)}</span>
              </button>
            ))}
          </section>
        )}
        {showRecent && valid(recent).length > 0 && (
          <section>
            <h3>{t('최근 연 노트')}</h3>
            {valid(recent).slice(0, 4).map((p) => (
              <button key={p} className={`tree-row file ${current === p ? 'on' : ''}`} style={{ paddingLeft: 12 }} onClick={() => app.openNote(p)} {...nm.bind(p)}>
                <span className="tree-name">{baseName(p)}</span>
              </button>
            ))}
          </section>
        )}
        <section>
          <h3>{t('모든 노트')}</h3>
          {listed.map((n) => row(n, 0))}
          {sysTop.length > 0 && !(current && isProtectedPath(current)) && (
            <button className="memo-sys" aria-expanded={showSys} onClick={() => setShowSys(!showSys)}>
              {showSys ? t('시스템 폴더 접기') : t('시스템 폴더 {n}개', { n: sysTop.length })}
            </button>
          )}
          {!paths.length && <p className="hint pad">{t('노트가 없습니다. ＋ 로 새로 만들거나, 가져오기 버튼으로 기기의 md 파일을 불러오세요.')}</p>}
        </section>
      </div>
      <NoteContextMenu menu={nm.menu} close={nm.close} />
    </div>
  )
}
