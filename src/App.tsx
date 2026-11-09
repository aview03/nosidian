import { Fragment, useEffect, useState } from 'react'
import { t } from './lib/i18n'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { homeTab, useApp, type Tab } from './lib/app'
import { useDialog } from './lib/dialog'
import { FileTree } from './components/FileTree'
import { Search } from './components/Search'
import { Graph } from './components/Graph'
import { startReminders } from './lib/reminders'
import { desktop } from './lib/externalIO'
import { startNativeBridge } from './lib/nativeCal'
import { pruneAllDaily, useCal } from './lib/calendar'
import { EventEditor } from './components/EventEditor'
import { CalendarMain, CalendarMobile, CalendarSide, DayPanel, TodayView } from './components/Calendar'
import { NoteView } from './components/NoteView'
import { Settings } from './components/Settings'
import { Palette } from './components/Palette'
import { Dialogs } from './components/Dialogs'
import { Onboarding } from './components/Onboarding'
import { Icon } from './components/Icon'
import { VaultSheet } from './components/VaultSheet'
import { listenExternalFiles } from './lib/importFiles'
import { SYNC_LABEL } from './lib/types'

function useWide() {
  const [w, setW] = useState(() => window.matchMedia('(min-width: 900px)').matches)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 900px)')
    const f = () => setW(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return w
}

function SyncBtn({ cls = 'icon-btn' }: { cls?: string }) {
  const syncing = useApp((s) => s.syncing)
  const remote = useApp((s) => s.settings.remote)
  const dirty = useApp((s) => Object.values(s.files).some((f) => f.dirty))
  if (!remote) return null
  return (
    <button className={`${cls} sync ${syncing ? 'spin' : ''}`} onClick={() => void useApp.getState().sync()} aria-label={t('동기화')} title={t('{name} 동기화 (Ctrl+S)', { name: SYNC_LABEL[remote.kind] })}>
      <Icon name="sync" />
      {dirty && !syncing && <span className="badge-dot" />}
    </button>
  )
}

export default function App() {
  const ready = useApp((s) => s.ready)
  const settings = useApp((s) => s.settings)
  const hasVault = useApp((s) => !!s.settings.activeVault)
  const hasExternal = useApp((s) => !!s.external)
  const lang = useApp((s) => s.settings.lang)
  const tab = useApp((s) => s.tab)
  const activeVault = useApp((s) => s.settings.activeVault)
  const leftOpen = useApp((s) => s.settings.leftOpen)
  const mode = useApp((s) => s.mode)
  const wide = useWide()
  const [leftTab, setLeftTab] = useState<'files' | 'search'>('files')

  useEffect(() => void useApp.getState().init(), [])

  // 테마 / 글자 크기
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'auto' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#121212' : '#ffffff')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])
  useEffect(() => (ready ? startReminders() : undefined), [ready])
  // 안드로이드: 홈 화면 위젯·알림용 데이터를 네이티브로 넘기고, 위젯/알림에서 들어온 딥링크로 그 날을 연다
  useEffect(() => (ready ? startNativeBridge() : undefined), [ready])
  // 이미 쌓여 있던 빈 Daily 노트를 vault 마다 한 번만 자동 정리한다 (이후에 생긴 것은 일정을 지울 때 정리됨 / 수동 정리 명령)
  const activeVaultId = useApp((s) => s.settings.activeVault)
  useEffect(() => {
    if (!ready || !activeVaultId || window.location.search.includes('widget')) return
    const key = `nosidian.pruned.${activeVaultId}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      return
    }
    const timer = setTimeout(() => {
      const n = pruneAllDaily()
      if (n > 0) useApp.getState().say(t('빈 Daily 노트 {n}개를 정리했습니다', { n }))
    }, 1500) // 불러오기가 끝난 뒤에
    return () => clearTimeout(timer)
  }, [ready, activeVaultId])
  useEffect(() => {
    if (!ready || !Capacitor.isNativePlatform()) return
    const handle = (url: string) => {
      if (!url.startsWith('com.amsidian.app://calendar')) return
      const q = new URL(url).searchParams
      const d = q.get('date')
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) useCal.getState().select(d)
      useApp.getState().go('calendar')
      if (q.get('add')) setTimeout(() => useCal.getState().focus(), 350)
    }
    void CapApp.getLaunchUrl().then((l) => l?.url && handle(l.url))
    const h = CapApp.addListener('appUrlOpen', (e) => handle(e.url))
    return () => void h.then((x) => x.remove())
  }, [ready])
  // 위젯에서 일정을 눌러 본 창에서 열기
  useEffect(() => {
    const d = desktop()
    if (!ready || !d?.takeOpenNotes || !d.onOpenNote) return
    const take = () => void d.takeOpenNotes!().then((ps) => ps.forEach((p) => useApp.getState().openNote(p)))
    take()
    return d.onOpenNote(take)
  }, [ready])
  // 다른 앱에서 열기 / 공유로 들어온 파일
  useEffect(() => (ready ? listenExternalFiles() : undefined), [ready])

  useEffect(() => {
    document.documentElement.style.setProperty('--fs', settings.fontSize + 'px')
  }, [settings.fontSize])

  useEffect(() => {
    if (tab === 'files' || tab === 'search') setLeftTab(tab)
  }, [tab])

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const app = useApp.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); app.setPalette('switcher') }
      else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); app.setPalette('command') }
      else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); app.setMode(app.mode === 'edit' ? 'read' : 'edit') }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (app.external && app.tab === 'note') void app.saveExternal(); else void app.sync() }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); app.openFind() }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); app.go('search') }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); app.back() }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); app.forward() }
      else if (e.key === 'Escape') { if (!app.palette && !app.sheet && !app.vaultSheet) app.closeFind(); app.setPalette(null); app.setSheet(null); app.setVaultSheet(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 안드로이드 뒤로가기
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const h = CapApp.addListener('backButton', () => {
      const app = useApp.getState()
      if (useDialog.getState().kind) return useDialog.setState({ kind: null })
      if (app.vaultSheet) return app.setVaultSheet(false)
      if (app.palette) return app.setPalette(null)
      if (app.sheet) return app.setSheet(null)
      if (app.tab === 'note' && app.back()) return
      if (app.tab !== homeTab()) return app.go(homeTab()) // 홈(PC: 캘린더 / 모바일: 오늘)으로 한 번 돌아간 뒤 종료
      void CapApp.exitApp()
    })
    return () => void h.then((x) => x.remove())
  }, [])

  // 앱이 다시 보일 때 자동 동기화 (변경 없을 때만 가볍게)
  useEffect(() => {
    const f = () => {
      const s = useApp.getState()
      if (document.visibilityState === 'visible' && s.settings.remote && (!s.settings.lastSync || Date.now() - s.settings.lastSync > 5 * 60000)) void s.sync()
    }
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])

  if (!ready) return <div className="splash">Nosidian</div>
  // vault 가 없어도 밖에서 연 문서는 열람할 수 있다
  if (!hasVault && hasExternal) return (
    <div className="layout" key={lang}>
      <main className="main"><div className="view"><NoteView wide={false} /></div></main>
      <Dialogs />
    </div>
  )
  if (!hasVault) return (<Fragment key={lang}><Onboarding /><Dialogs /></Fragment>)

  const nav: { id: Tab; icon: string; label: string }[] = [
    { id: 'today', icon: 'sun', label: t('오늘') },
    { id: 'calendar', icon: 'calendar', label: t('캘린더') },
    { id: 'files', icon: 'note', label: t('메모') },
    { id: 'search', icon: 'search', label: t('검색') },
    { id: 'settings', icon: 'settings', label: t('설정') },
  ]

  if (wide) {
    const mainTab = tab === 'graph' || tab === 'settings' || tab === 'calendar' ? tab : 'note'
    // 이미 열려 있는 탭을 다시 누르면 사이드바를 접고, 접혀 있으면 그 탭으로 연다
    const pickLeft = (t: 'files' | 'search') => {
      const app = useApp.getState()
      if (mainTab === 'note' && leftOpen && leftTab === t) return app.patchSettings({ leftOpen: false })
      app.patchSettings({ leftOpen: true })
      app.go(t)
    }
    const railActive = (id: Tab) => (id === 'files' || id === 'search' ? leftTab === id && mainTab === 'note' : mainTab === id)
    return (
      <div className="layout wide" key={lang}>
        <nav className="rail">
          <button className={mainTab === 'calendar' ? 'on' : ''} onClick={() => useApp.getState().go('calendar')} title={t('캘린더')}><Icon name="calendar" /></button>
          <button className={leftOpen && leftTab === 'files' && mainTab === 'note' ? 'on' : ''} onClick={() => pickLeft('files')} title={t('메모')}><Icon name="note" /></button>
          <button className={leftOpen && railActive('search') ? 'on' : ''} onClick={() => pickLeft('search')} title={t('검색 (Ctrl+Shift+F)')}><Icon name="search" /></button>
          <div className="grow" />
          <SyncBtn cls="rail-btn" />
          <button onClick={() => useApp.getState().patchSettings({ leftOpen: !leftOpen })} title={leftOpen ? t('사이드바 접기') : t('사이드바 펴기')} aria-label={t('왼쪽 사이드바 접기/펴기')}><Icon name="panel-left" /></button>
          <button className={railActive('settings') ? 'on' : ''} onClick={() => useApp.getState().go('settings')} title={t('설정')}><Icon name="settings" /></button>
        </nav>
        {/* 파일·검색 사이드바는 노트 화면에서만. 그래프·설정은 본문이 전체를 쓴다 */}
        {(mainTab === 'note' || mainTab === 'calendar') && leftOpen && (
          <aside className="side-left">
            <div className="view" key={`${activeVault}:${mainTab === 'calendar' ? 'cal' : leftTab}`}>
              {mainTab === 'calendar' ? <CalendarSide /> : leftTab === 'files' ? <FileTree /> : <Search />}
            </div>
          </aside>
        )}
        <main className="main">
          <div className={`view${mainTab === 'calendar' ? ' cal-split' : ''}`} key={`${activeVault}:${mainTab}`}>
            {mainTab === 'graph' ? <Graph /> : mainTab === 'settings' ? <Settings /> : mainTab === 'calendar' ? (<><CalendarMain /><DayPanel /></>) : <NoteView wide />}
          </div>
        </main>
        <Palette />
        <EventEditor />
        <VaultSheet />
        <Dialogs />
      </div>
    )
  }

  const hideNav = tab === 'note' && mode === 'edit'
  return (
    <div className="layout" key={lang}>
      <main className="main">
        <div className="view" key={`${activeVault}:${tab}`}>
          {tab === 'note' && <NoteView wide={false} />}
          {tab === 'today' && <TodayView />}
          {tab === 'calendar' && <CalendarMobile />}
          {tab === 'files' && (<><FileTree /><div className="fab-sync"><SyncBtn cls="fab" /></div></>)}
          {tab === 'search' && <Search autoFocus={false} />}
          {tab === 'graph' && <Graph />}
          {tab === 'settings' && <Settings />}
        </div>
      </main>
      {!hideNav && (
        <nav className="tabbar">
          {nav.map((n) => (
            <button key={n.id} className={tab === n.id || (n.id === 'files' && tab === 'note') ? 'on' : ''} onClick={() => useApp.getState().go(n.id)}>
              <Icon name={n.icon} size={22} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      )}
      <Palette />
      <EventEditor />
      <VaultSheet />
      <Dialogs />
    </div>
  )
}
