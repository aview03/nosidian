import { t } from '../lib/i18n'
import { useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { baseName } from '../lib/links'
import { ask } from '../lib/dialog'
import { Icon } from './Icon'
import { importFromPicker } from '../lib/importFiles'
import { useActiveVault } from './VaultSheet'
import { NoteContextMenu, useNoteMenu } from './NoteContextMenu'

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
  const recent = useApp((s) => s.settings.recent)
  const showRecent = useApp((s) => s.settings.showRecent)
  const app = useApp.getState()
  const vault = useActiveVault()
  const nm = useNoteMenu()
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

  const newNote = async (dir = '') => {
    const n = await ask(t('새 노트'), '', dir ? t('{dir}/ 아래에 만듭니다', { dir }) : t('이름 또는 폴더/이름'), t('만들기'))
    if (n?.trim()) app.createNote((dir ? dir + '/' : '') + n.trim())
  }
  const newFolder = async () => {
    const n = await ask(t('새 폴더'), '', t('폴더에 첫 노트가 생성됩니다 (Git은 빈 폴더를 저장하지 않아요)'), t('만들기'))
    if (n?.trim()) app.createNote(n.trim().replace(/\/$/, '') + '/' + t('새 노트'))
  }

  const row = (n: Node, depth: number) => {
    const pad = { paddingLeft: 12 + depth * 16 }
    if (n.file) {
      const f = files[n.path]
      return (
        <button key={n.path} className={`tree-row file ${current === n.path ? 'on' : ''}`} style={pad} onClick={() => app.openNote(n.path)} {...nm.bind(n.path)}>
          <span className="tree-name">{baseName(n.path)}</span>
          {f?.conflict ? <span className="dot warn" /> : f?.dirty ? <span className="dot" /> : null}
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
          {top.map((n) => row(n, 0))}
          {!paths.length && <p className="hint pad">{t('노트가 없습니다. ＋ 로 새로 만들거나, 가져오기 버튼으로 기기의 md 파일을 불러오세요.')}</p>}
        </section>
      </div>
      <NoteContextMenu menu={nm.menu} close={nm.close} />
    </div>
  )
}
