// 새 노트 / 새 폴더 만들기 대화창: "이름"과 "어느 폴더에"를 따로 받는다(한 칸에 '폴더/이름'을 적게 하지 않는다).
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { Icon } from './Icon'
import { Select } from './Select'

interface NewNoteUi {
  mode: null | 'note' | 'folder'
  /** 처음 선택돼 있을 폴더 ('' = 맨 위) */
  dir: string
}
const useNewNote = create<NewNoteUi>(() => ({ mode: null, dir: '' }))

/** 어디서든 새 노트를 만들 때 이 함수를 부른다. dir 을 주면 그 폴더가 미리 선택된다 */
export const openNewNote = (dir?: string) => useNewNote.setState({ mode: 'note', dir: dir ?? defaultDir() })
export const openNewFolder = () => useNewNote.setState({ mode: 'folder', dir: defaultDir() })

/** 지금 열어 둔 노트가 있는 폴더(없으면 맨 위) */
function defaultDir(): string {
  const cur = useApp.getState().current
  const i = cur ? cur.lastIndexOf('/') : -1
  return cur && i > 0 ? cur.slice(0, i) : ''
}

/** 노트 경로들에서 폴더 목록을 만든다(상위 폴더 포함, 가나다순) */
function foldersOf(paths: string[]): string[] {
  const set = new Set<string>()
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'))
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
}

const clean = (s: string) => s.replace(/[\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()

export function NewNote() {
  const mode = useNewNote((s) => s.mode)
  if (!mode) return null
  return <Dialog mode={mode} />
}

function Dialog({ mode }: { mode: 'note' | 'folder' }) {
  const close = () => useNewNote.setState({ mode: null })
  const files = useApp((s) => s.files)
  const [dir, setDir] = useState(() => useNewNote.getState().dir)
  const [name, setName] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const folders = useMemo(() => foldersOf(Object.values(files).filter((f) => !f.deleted).map((f) => f.path)), [files])
  const options = useMemo(
    () => [{ value: '', label: t('폴더 없음 (맨 위)') }, ...(dir && !folders.includes(dir) ? [dir] : []).concat(folders).map((d) => ({ value: d, label: d.split('/').join(' / ') }))],
    [folders, dir],
  )

  useEffect(() => {
    ref.current?.focus()
    const f = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  const clean_ = clean(name.replace(/\//g, ' '))
  const where = (dir ? dir + '/' : '') + clean_

  const create = () => {
    if (!clean_) return
    const app = useApp.getState()
    if (mode === 'note') app.createNote(where)
    else {
      // 빈 폴더는 저장되지 않으므로(Git·동기화), 첫 노트와 함께 만든다
      app.createNote(`${where}/${t('새 노트')}`)
      app.say(t('"{name}" 폴더를 만들었어요', { name: clean_ }))
    }
    close()
  }

  return (
    <div className="ee-wrap" onClick={close}>
      <div className="ee" role="dialog" aria-label={mode === 'note' ? t('새 노트') : t('새 폴더')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{mode === 'note' ? t('새 노트') : t('새 폴더')}</h3>
          <button className="icon-btn" onClick={close} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>
        <div className="ee-body">
          <label className="ee-field">
            <span>{mode === 'note' ? t('노트 이름') : t('폴더 이름')}</span>
            <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && create()} placeholder={mode === 'note' ? t('예) 회의 메모') : t('예) 프로젝트')} />
          </label>
          <div className="ee-field">
            <span>{mode === 'note' ? t('저장할 폴더') : t('만들 위치')}</span>
            <Select value={dir} options={options} onChange={setDir} title={mode === 'note' ? t('저장할 폴더') : t('만들 위치')} ariaLabel={t('폴더')} />
          </div>
          {mode === 'folder' && <p className="hint small te-note">{t('폴더에는 첫 노트가 함께 만들어져요. (빈 폴더는 저장되지 않아요)')}</p>}
          {clean_ && <p className="hint small te-note">{mode === 'note' ? t('{path} 로 저장돼요', { path: where + '.md' }) : t('{path}/ 폴더가 만들어져요', { path: where })}</p>}
        </div>
        <div className="ee-foot">
          <span className="grow" />
          <button onClick={close}>{t('취소')}</button>
          <button className="primary" disabled={!clean_} onClick={create}>{t('만들기')}</button>
        </div>
      </div>
    </div>
  )
}
