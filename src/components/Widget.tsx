// 바탕화면 위젯(Electron 별도 창)의 화면. 같은 저장소(IndexedDB)를 읽고, 본 창과 변경을 주고받는다.
// 동기화는 본 창만 한다. 위젯은 일정 보기 + 직접 수정(메모창·편집기) + 노트 열기를 맡는다.
//
// 바탕화면 레이어의 창은 투명하게 만들 수 없어서(자식 창 제약), 배경화면 이미지를 창 뒤에 위치를 맞춰 그리고
// 그 위에 옅은 색을 얹어 "배경이 비치는 달력"처럼 보이게 한다 (월간 보기).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { desktop, type WidgetState } from '../lib/externalIO'
import { buildCalendar, fmtMonth, monthGrid, openPath, parseYmd, todayYmd, useCal, weekdayLabels } from '../lib/calendar'
import { holidayOf, lunarLabel } from '../lib/holidays'
import { startReminders } from '../lib/reminders'
import { DayList, TodayView, Upcoming, useCalMap, useDayColors } from './Calendar'
import { DayNote, type Anchor } from './DayNote'
import { flushPersist } from '../lib/app'
import { Icon } from './Icon'
import { EventEditor } from './EventEditor'
import { Dialogs } from './Dialogs'

const MODES: { id: WidgetState['mode']; label: string }[] = [
  { id: 'month', label: '월간' },
  { id: 'today', label: '오늘' },
  { id: 'agenda', label: '목록' },
]

export function WidgetApp() {
  const ready = useApp((s) => s.ready)
  const settings = useApp((s) => s.settings)
  const hasVault = useApp((s) => !!s.settings.activeVault)
  const api = desktop()?.widget
  const [st, setSt] = useState<WidgetState | null>(null)
  const month = useCal((s) => s.month)
  const [pos, setPos] = useState<[number, number]>([window.screenX, window.screenY])
  const [wall, setWall] = useState(Date.now())
  // 이동·크기 조절 중에는 화면을 흐리게 고정하고 계산을 멈췄다가, 끝났을 때 한 번만 다시 그린다
  const [busy, setBusy] = useState<null | 'move' | 'resize'>(null)
  const [freeze, setFreeze] = useState<{ w: number; h: number } | null>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const badge = useRef<HTMLDivElement>(null)

  useEffect(() => void useApp.getState().initLocal(), [])
  useEffect(
    () =>
      useCal.subscribe((s, prev) => {
        if (s.editor && !prev.editor) {
          const { date, ev } = s.editor
          useCal.getState().closeEditor()
          api?.popup('editor', ev ? { date, ev: ev.id, evdate: ev.date } : { date }, null)
        }
      }),
    [api],
  )
  useEffect(() => {
    document.documentElement.classList.add('widget-win')
    void api?.get().then(setSt)
    return api?.onState(setSt)
  }, [api])

  // 본 창에서 테마·언어·vault 를 바꾸면 위젯도 따라간다
  useEffect(() => {
    const f = (e: StorageEvent) => e.key === 'amsidian.settings' && location.reload()
    window.addEventListener('storage', f)
    return () => window.removeEventListener('storage', f)
  }, [])
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'auto' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])
  useEffect(() => void document.documentElement.style.setProperty('--fs', Math.min(settings.fontSize, 17) + 'px'), [settings.fontSize])
  useEffect(() => (ready ? startReminders() : undefined), [ready])
  // 자정이 지나면 '오늘'을 새로 고르고, 배경화면이 바뀌었을 수 있으니 1분마다 다시 읽는다
  useEffect(() => {
    let day = todayYmd()
    const i = setInterval(() => {
      if (todayYmd() !== day) { day = todayYmd(); useCal.getState().goToday() }
      setWall(Date.now())
    }, 60000)
    return () => clearInterval(i)
  }, [])
  // 창을 옮기면 배경화면 위치를 다시 맞춘다
  useEffect(() => {
    const i = setInterval(() => {
      if (busyRef.current) return // 움직이는 동안은 계산하지 않는다
      setPos((p) => (p[0] === window.screenX && p[1] === window.screenY ? p : [window.screenX, window.screenY]))
    }, 200)
    return () => clearInterval(i)
  }, [])

  /** 머리글(이동) / 변·모서리(크기 조절) 끌기. 실제 이동은 메인이 커서 위치로 처리하고,
   *  여기서는 끌리는 동안 화면을 흐리게 고정했다가 끝나면 한 번만 다시 그린다. */
  const finish = useRef<(() => void) | null>(null)
  const interact = (kind: 'move' | 'resize', edge = '') => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const start = { x: e.screenX, y: e.screenY }
    let began = false
    api?.dragStart(kind, edge)
    const done = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      finish.current = null
      if (began) {
        setFreeze(null)
        setBusy(null)
        setTimeout(() => setPos([window.screenX, window.screenY]), 30) // 끝났을 때 한 번 계산
      }
    }
    const move = (ev: PointerEvent) => {
      if (began || Math.abs(ev.screenX - start.x) + Math.abs(ev.screenY - start.y) < 4) return // 단순 클릭은 무시
      began = true
      if (kind === 'resize') {
        const r = document.querySelector('.w-body')?.getBoundingClientRect()
        if (r) setFreeze({ w: r.width, h: r.height }) // 내용 크기를 고정해 다시 배치하지 않는다
      }
      setBusy(kind)
    }
    const up = () => {
      api?.dragEnd()
      done()
    }
    finish.current = done
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  // 메인이 버튼 뗌을 먼저 알아챈 경우(창 밖에서 뗐을 때 등)에도 정리한다 + 크기 표시는 DOM 에 직접 쓴다(다시 그리지 않음)
  useEffect(() => {
    const off1 = api?.onDragEnd(() => finish.current?.())
    const off2 = api?.onDragSize((w, h) => { if (badge.current) badge.current.textContent = `${w} × ${h}` })
    return () => { off1?.(); off2?.() }
  }, [api])

  if (!ready) return <div className="widget"><div className="splash">Nosidian</div></div>
  if (!hasVault) return <div className="widget"><p className="hint pad">{t('앱에서 먼저 노트 저장소를 만들어 주세요.')}</p></div>

  const mode = st?.mode ?? 'month'
  const glass = st?.layer === 'desktop' && !!st.display
  const cal = useCal.getState()
  return (
    <div className={`widget${glass ? ' glass' : ''}${glass && mode === 'month' ? ' glass-month' : ''}${busy ? ' busy' : ''}`}>
      {glass && st?.display && mode === 'month' && (
        <>
          <div
            className="w-bg"
            style={{
              left: st.display.x - pos[0],
              top: st.display.y - pos[1],
              width: st.display.width,
              height: st.display.height,
              backgroundImage: `url(/__wallpaper?v=${wall})`,
              // 측정값이 있으면 실제 바탕화면과 같은 위치·크기로, 없으면 가운데 정렬로
              ...(st.wall ? { backgroundSize: `${st.wall.w}px ${st.wall.h}px`, backgroundPosition: `${-st.wall.x}px ${-st.wall.y}px`, backgroundRepeat: 'no-repeat' } : {}),
            }}
          />
          <div className="w-tint" style={{ background: `rgba(0,0,0,${st.tint ?? 0.25})` }} />
        </>
      )}
      <header className="w-head" onPointerDown={interact('move')}>
        <span className="w-title">{mode === 'month' ? fmtMonth(month) : 'Nosidian'}</span>
        {mode === 'month' && (
          <div className="w-nav2">
            <button className="icon-btn" onClick={() => cal.shift(-1)} aria-label={t('이전 달')}><Icon name="back" size={18} /></button>
            <button className="today-btn" onClick={cal.goToday}>{t('오늘')}</button>
            <button className="icon-btn" onClick={() => cal.shift(1)} aria-label={t('다음 달')}><Icon name="forward" size={18} /></button>
          </div>
        )}
        <div className="w-modes">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => void api?.set({ mode: m.id })}>{t(m.label)}</button>
          ))}
        </div>
        <button className="icon-btn" title={t('화면에 크게 펼치기')} onClick={() => api?.fit()}><Icon name="expand" size={18} /></button>
        <button className="icon-btn" title={t('앱 열기')} onClick={() => api?.openApp()}><Icon name="panel-right" size={18} /></button>
        <button className="icon-btn" title={t('위젯 닫기')} onClick={() => void api?.set({ enabled: false })}><Icon name="close" size={18} /></button>
      </header>
      <div className="w-body" style={freeze ? { width: freeze.w, height: freeze.h, flex: 'none' } : undefined}>
        {mode === 'month' && <GlassMonth frozen={!!busy} onCell={(d, a) => { useCal.getState().select(d); api?.popup('note', { date: d }, a) }} />}
        {mode === 'today' && <div className="w-solid"><TodayView /></div>}
        {mode === 'agenda' && (
          <div className="w-solid">
            <div className="tree-scroll">
              <h3 className="sect w-sect">{t('오늘')}</h3>
              <DayList date={todayYmd()} />
              <h3 className="sect w-sect">{t('다가오는 일정')}</h3>
              <Upcoming days={30} />
            </div>
          </div>
        )}
      </div>
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((ed) => (
        <div key={ed} className={`w-edge e-${ed}`} onPointerDown={interact('resize', ed)} aria-hidden />
      ))}
      {busy === 'resize' && <div className="w-badge" ref={badge}>{window.innerWidth} × {window.innerHeight}</div>}
    </div>
  )
}

/** 큰 월간 달력: 칸마다 날짜·공휴일·그날의 일정 글자가 전부 보이고, 칸을 누르면 메모창이 열린다 */
function GlassMonth({ onCell, frozen }: { onCell(d: string, a: Anchor): void; frozen: boolean }) {
  const cal = useCalMap()
  const colors = useDayColors()
  const month = useCal((s) => s.month)
  const sel = useCal((s) => s.sel)
  const showHol = useApp((s) => s.settings.calHolidays)
  const showLunar = useApp((s) => s.settings.calLunar)
  const days = monthGrid(month)
  const today = todayYmd()
  const wd = weekdayLabels()
  const grid = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState(3) // 칸 높이에 맞춰 보여 줄 일정 줄 수

  const frozenRef = useRef(frozen)
  frozenRef.current = frozen
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const calc = () => {
      if (frozenRef.current) return // 끌리는 동안에는 줄 수를 다시 계산하지 않는다
      const cellH = (el.clientHeight - 22) / 6 // 요일 줄 제외
      setLines(Math.max(1, Math.floor((cellH - 24) / 17)))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [frozen]) // 끝나면(frozen=false) 한 번 다시 계산

  return (
    <div className="gm" ref={grid}>
      {wd.map((w, i) => <div key={i} className={`gm-wd${i === 0 ? ' sun' : ''}`}>{w}</div>)}
      {days.map((d, i) => {
        const ev = cal.get(d) ?? []
        const hol = showHol ? holidayOf(d) : null
        const lunar = showLunar ? lunarLabel(parseYmd(d)) : null
        const color = colors.get(d)
        const shown = ev.length > lines ? ev.slice(0, Math.max(0, lines - 1)) : ev
        return (
          <div
            key={d}
            className={`gm-cell${d.slice(0, 7) !== month.slice(0, 7) ? ' out' : ''}${d === today ? ' is-now' : ''}${d === sel ? ' sel' : ''}${i % 7 === 0 || hol ? ' sun' : ''}`}
            style={color ? { background: `color-mix(in srgb, ${color} 38%, transparent)` } : undefined}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onCell(d, { left: r.left, top: r.top, width: r.width, height: r.height }) }}
          >
            <div className="gm-top">
              <b>{+d.slice(8)}</b>
              {(hol || lunar) && <span className={hol ? 'hol' : 'lunar'}>{hol ?? lunar}</span>}
            </div>
            <div className="gm-evs">
              {shown.map((e) => (
                <div
                  key={e.id + e.date}
                  className={`gm-ev${e.done ? ' done' : ''}`}
                  style={e.color ? { color: e.color } : undefined}
                  onClick={(x) => { x.stopPropagation(); if (e.kind === 'task') useCal.getState().openEditor(e.origDate ?? e.date, e); else openPath(e.path) }}
                  title={e.title}
                >
                  {e.cont ? '↳ ' : ''}{e.start && <i>{e.start}</i>} {e.title}
                </div>
              ))}
              {ev.length > shown.length && <div className="gm-more">+{ev.length - shown.length}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 입력용 작은 창(메모창 / 일정 편집기). 일반 최상위 창이라 키보드 포커스와 한글 입력기가 정상 동작한다 */
export function PopupApp() {
  const params = new URLSearchParams(location.search)
  const kind = params.get('popup')
  const date = params.get('date') ?? todayYmd()
  const evId = params.get('ev')
  const evDate = params.get('evdate')
  const ready = useApp((s) => s.ready)
  const theme = useApp((s) => s.settings.theme)
  const api = desktop()?.widget
  const opened = useRef(false)

  useEffect(() => void useApp.getState().initLocal(), [])
  useEffect(() => {
    document.documentElement.classList.add('popup-win')
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const closeAfterSave = async () => {
    await flushPersist() // 저장 대기 중인 편집을 DB 에 쓴 뒤에 닫는다 (위젯·본 창이 바로 반영)
    window.close()
  }
  // 일정 편집기: 준비되면 해당 일정(또는 새 일정)으로 열고, 닫히면 창도 닫는다
  useEffect(() => {
    if (!ready || kind !== 'editor' || opened.current) return
    opened.current = true
    const ev = evId ? buildCalendar(useApp.getState().files).get(evDate ?? date)?.find((e) => e.id === evId) : undefined
    useCal.getState().openEditor(date, ev)
  }, [ready, kind, evId, evDate, date])
  useEffect(
    () =>
      useCal.subscribe((s, prev) => {
        if (kind === 'editor' && prev.editor && !s.editor) void closeAfterSave()
      }),
    [kind],
  )

  if (!ready) return <div className="splash" />
  if (kind === 'note') {
    return (
      <DayNote
        date={date}
        inline
        onClose={() => void closeAfterSave()}
        onEditor={(d, ev) => void flushPersist().then(() => { api?.popup('editor', ev ? { date: d, ev: ev.id, evdate: ev.date } : { date: d }, null); window.close() })}
      />
    )
  }
  // 삭제 확인 창(confirmAsk)을 그리는 Dialogs 가 이 창에도 있어야 한다. 없으면 확인 창이 안 떠서 삭제가 영원히 대기한다
  return (
    <>
      <EventEditor />
      <Dialogs />
    </>
  )
}
