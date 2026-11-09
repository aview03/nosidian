import { pruneAllDaily, useCal } from '../lib/calendar'
import { t } from '../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { baseName } from '../lib/links'
import { usePresence } from '../lib/presence'
import { Capacitor } from '@capacitor/core'
import { importFromPicker } from '../lib/importFiles'
import { useWorkUi } from '../lib/workOps'
import { openNewNote } from './NewNote'
import { SETTINGS_PATH, settingsNoteContent } from '../lib/health'

interface Item {
  id: string
  title: string
  sub?: string
  run(): void
}

function fuzzy(q: string, s: string) {
  q = q.toLowerCase()
  s = s.toLowerCase()
  if (!q) return 1
  const idx = s.indexOf(q)
  if (idx >= 0) return 1000 - idx - s.length * 0.1
  let qi = 0
  let score = 0
  let last = -2
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      score += i === last + 1 ? 5 : 1
      last = i
      qi++
    }
  }
  return qi === q.length ? score : 0
}

export function Palette() {
  const mode = useApp((s) => s.palette)
  const files = useApp((s) => s.files)
  const recent = useApp((s) => s.settings.recent)
  const index = useApp((s) => s.index)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const app = useApp.getState()
  const presence = usePresence(!!mode)

  useEffect(() => {
    if (mode) {
      setQ(mode === 'command' ? '>' : '')
      setSel(0)
      setTimeout(() => input.current?.focus(), 30)
    }
  }, [mode])

  const commands: Item[] = useMemo(() => {
    const s = useApp.getState()
    return [
      { id: 'new', title: t('새 노트 만들기'), run: () => openNewNote() },
      { id: 'import', title: t('기기에서 md 파일 가져오기'), run: () => void importFromPicker() },
      ...(Capacitor.isNativePlatform() ? [] : [{ id: 'importdir', title: t('기기에서 폴더 가져오기'), run: () => void importFromPicker(true) }]),
      { id: 'vault', title: t('vault 전환 · 추가'), run: () => s.setVaultSheet(true) },
      { id: 'daily', title: t('오늘의 노트 열기'), run: () => s.openDaily() },
      { id: 'prune', title: t('빈 Daily 노트 정리'), run: () => { const n = pruneAllDaily(); s.say(n ? t('빈 Daily 노트 {n}개를 정리했습니다', { n }) : t('정리할 빈 Daily 노트가 없습니다')) } },
      { id: 'sync', title: t('동기화'), run: () => void s.sync() },
      { id: 'toggle', title: t('읽기/편집 전환'), run: () => s.setMode(s.mode === 'edit' ? 'read' : 'edit') },
      { id: 'work', title: t('내 업무 열기'), run: () => s.go('work') },
      { id: 'healthcfg', title: t('프로젝트 건강도 기준 열기'), run: () => { const f = s.files[SETTINGS_PATH]; if (f && !f.deleted) s.openNote(SETTINGS_PATH); else s.createNote(SETTINGS_PATH, settingsNoteContent(), true) } },
      { id: 'newproj', title: t('새 프로젝트'), run: () => { s.go('work'); useWorkUi.setState({ wizard: true }) } },
      { id: 'calendar', title: t('캘린더 열기'), run: () => s.go('calendar') },
      { id: 'today', title: t('오늘 일정 보기'), run: () => { useCal.getState().goToday(); s.go(window.matchMedia('(min-width: 900px)').matches ? 'calendar' : 'work') } },
      { id: 'graph', title: t('그래프 보기'), run: () => s.go('graph') },
      { id: 'files', title: t('파일 목록'), run: () => s.go('files') },
      { id: 'search', title: t('검색'), run: () => s.go('search') },
      { id: 'find', title: t('문서에서 찾기'), run: () => s.openFind() },
      { id: 'info', title: t('백링크/목차 패널'), run: () => s.setSheet('info') },
      { id: 'bm', title: t('현재 노트 북마크 토글'), run: () => s.current && s.toggleBookmark(s.current) },
      { id: 'dark', title: t('다크 모드 전환'), run: () => s.patchSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
      { id: 'settings', title: t('설정'), run: () => s.go('settings') },
    ]
  }, [])

  const items: Item[] = useMemo(() => {
    if (!mode) return []
    if (q.startsWith('>')) {
      const cq = q.slice(1).trim()
      return commands.filter((c) => fuzzy(cq, c.title) > 0).sort((a, b) => fuzzy(cq, b.title) - fuzzy(cq, a.title))
    }
    const list = Object.values(files).filter((f) => !f.deleted).map((f) => f.path)
    const scored = list
      .map((p) => {
        const aliases = index.notes.get(p)?.aliases ?? []
        const sc = Math.max(fuzzy(q, baseName(p)) * 2, fuzzy(q, p), ...aliases.map((a) => fuzzy(q, a) * 2))
        return { p, sc: sc + (recent.indexOf(p) >= 0 ? 20 - recent.indexOf(p) : 0) }
      })
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 30)
    const res: Item[] = scored.map(({ p }) => ({
      id: p,
      title: baseName(p),
      sub: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : undefined,
      run: () => app.openNote(p),
    }))
    const nq = q.trim()
    if (nq && !list.some((p) => baseName(p).toLowerCase() === nq.toLowerCase()))
      res.push({ id: '__new', title: t('"{name}" 새 노트 만들기', { name: nq }), run: () => app.createNote(nq) })
    return res
  }, [q, mode, files, recent, index, commands, app])

  if (!presence.mounted) return null
  const go = (it?: Item) => {
    if (!it) return
    app.setPalette(null)
    it.run()
  }

  return (
    <div className={`palette-wrap${presence.closing ? " closing" : ""}`} onClick={() => app.setPalette(null)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder={t('노트 이름…   (> 명령어)')}
          onChange={(e) => { setQ(e.target.value); setSel(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
            else if (e.key === 'Enter') go(items[sel])
            else if (e.key === 'Escape') app.setPalette(null)
          }}
        />
        <div className="palette-list">
          {items.map((it, i) => (
            <button key={it.id} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
              <span>{it.title}</span>
              {it.sub && <small>{it.sub}</small>}
            </button>
          ))}
          {!items.length && <p className="hint pad">{t('결과 없음')}</p>}
        </div>
      </div>
    </div>
  )
}
