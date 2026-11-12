import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { Icon } from './Icon'
import { desktop } from '../lib/externalIO'
import { Editor } from './Editor'
import { holidayOf, lunarLabel } from '../lib/holidays'
import {
  buildDayColors, DAY_COLORS, setDayColor, parseYmd, REPEAT_LABEL,
  isWidgetWindow, fmtShort, weekOf, addDays, openPath, openDay, addEvent, buildCalendar, dailyPath, ensureDaily, fmtDay, fmtMonth, monthGrid, parseQuick, quickPreview, range,
  todayYmd, useCal, weekdayLabels, type CalEvent,
} from '../lib/calendar'

export function useDayColors() {
  const files = useApp((s) => s.files)
  return useMemo(() => buildDayColors(files), [files])
}

export function useCalMap() {
  const files = useApp((s) => s.files)
  return useMemo(() => buildCalendar(files), [files])
}

// ── 이벤트 한 줄 ──
export function EventRow({ ev, showDate }: { ev: CalEvent; showDate?: boolean }) {
  const app = useApp.getState()
  return (
    <div className={`ev-row${ev.done ? ' done' : ''}`}>
      {ev.inst ? (
        <span className="ev-ico" title={ev.repeat ? t(REPEAT_LABEL[ev.repeat]) : ''}><Icon name="repeat" size={16} /></span>
      ) : ev.kind === 'task' ? (
        <input type="checkbox" className="task" checked={ev.done} onChange={() => app.toggleTask(ev.path, ev.line)} aria-label={ev.title} />
      ) : (
        <span className="ev-ico"><Icon name="note" size={16} /></span>
      )}
      <button className="ev-main" onClick={() => (ev.kind === 'task' ? useCal.getState().openEditor(ev.origDate ?? ev.date, ev) : openPath(ev.path))}>
        <span className="ev-time">{showDate ? fmtDay(ev.date) + (ev.start ? ' ' : '') : ''}{ev.start ? ev.start + (ev.end ? '–' + ev.end : '') : ev.cont ? t('계속') : showDate ? '' : t('종일')}</span>
        <span className="ev-title">{ev.title}</span>
        {ev.span && <span className="ev-span">~{fmtShort(ev.span[1])}</span>}
        {ev.repeat && !ev.inst && <span className="ev-rep" title={t(REPEAT_LABEL[ev.repeat])}><Icon name="repeat" size={13} /></span>}
      </button>
    </div>
  )
}

export function DayList({ date }: { date: string }) {
  const cal = useCalMap()
  const list = cal.get(date) ?? []
  if (!list.length) return <p className="hint">{t('이 날은 일정이 없습니다.')}</p>
  return <div className="ev-list">{list.map((e) => <EventRow key={e.id + e.date} ev={e} />)}</div>
}

// ── 빠른 입력: "내일 3시 치과" ──
export function QuickAdd({ date }: { date: string }) {
  if (isWidgetWindow()) {
    // 바탕화면 위젯 창 안에서는 한글 입력이 안 되므로, 입력창 대신 별도의 입력 창을 연다
    return (
      <div className="quick-add">
        <button className="quick-open" onClick={() => desktop()?.widget?.popup('note', { date }, null)}>
          <Icon name="plus" size={16} /> {t('일정 추가')}
        </button>
      </div>
    )
  }
  return <QuickAddInput date={date} />
}

function QuickAddInput({ date }: { date: string }) {
  const [v, setV] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const focusAdd = useCal((s) => s.focusAdd)
  // 탭을 열 때마다 키보드가 올라오지 않도록: 이 입력창이 생긴 뒤에 '입력창 열기' 요청이 온 경우에만 포커스한다
  const seen = useRef(focusAdd)
  useEffect(() => {
    if (focusAdd !== seen.current) {
      seen.current = focusAdd
      ref.current?.focus()
    }
  }, [focusAdd])
  const q = v.trim() ? parseQuick(v, date) : null
  const submit = () => {
    if (!q) return
    addEvent(q)
    setV('')
    // 보고 있는 날짜를 옮기지 않는다(이어서 쓰는 필기가 엉뚱한 날 노트로 들어가던 문제). 다른 날에 넣었으면 어느 날인지 알려 준다
    if (q.date !== date) useApp.getState().say(t('{day}에 추가했어요', { day: fmtDay(q.date) }))
  }
  return (
    <div className="quick-add">
      <input
        ref={ref}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
        placeholder={t('일정 추가…  예) 내일 3시 치과')}
        enterKeyHint="done"
      />
      <button className="detail" onClick={() => useCal.getState().openEditor(q?.date ?? date)} title={t('시간·반복·기간을 골라서 추가')}>{t('상세')}</button>
      <button className="primary" onClick={submit} disabled={!q} aria-label={t('추가')}><Icon name="plus" /></button>
      {q && <div className="quick-preview">{quickPreview(q)}</div>}
    </div>
  )
}

// ── 월간 그리드 ──
export function MonthGrid({ compact }: { compact?: boolean }) {
  const cal = useCalMap()
  const colors = useDayColors()
  const showHol = useApp((s) => s.settings.calHolidays)
  const showLunar = useApp((s) => s.settings.calLunar)
  const month = useCal((s) => s.month)
  const sel = useCal((s) => s.sel)
  const days = useMemo(() => monthGrid(month), [month])
  const today = todayYmd()
  const wd = useMemo(() => weekdayLabels(), [month])
  const max = 3
  return (
    <div className={`mgrid${compact ? ' compact' : ''}`}>
      {wd.map((w, i) => <div key={i} className={`mg-wd${i === 0 ? ' sun' : ''}`}>{w}</div>)}
      {days.map((d, i) => {
        const ev = cal.get(d) ?? []
        const out = d.slice(0, 7) !== month.slice(0, 7)
        const hol = showHol ? holidayOf(d) : null
        const lunar = showLunar ? lunarLabel(parseYmd(d)) : null
        const color = colors.get(d)
        return (
          <div
            key={d}
            role="button"
            tabIndex={0}
            className={`mg-cell${out ? ' out' : ''}${d === today ? ' today' : ''}${d === sel ? ' sel' : ''}${i % 7 === 0 || hol ? ' sun' : ''}`}
            style={color ? { background: `color-mix(in srgb, ${color} 16%, transparent)` } : undefined}
            onClick={() => useCal.getState().select(d)}
            onDoubleClick={() => { useCal.getState().select(d); useCal.getState().focus() }}
            onKeyDown={(e) => e.key === 'Enter' && useCal.getState().select(d)}
            aria-label={fmtDay(d)}
          >
            <span className="mg-top">
              <span className="mg-num">{+d.slice(8)}</span>
              {!compact && (hol || lunar) && <span className={`mg-sub${hol ? ' hol' : ''}`}>{hol ?? lunar}</span>}
            </span>
            {compact ? (
              ev.length > 0 && <span className="mg-dots">{ev.slice(0, 3).map((e, k) => <i key={k} className={e.done ? 'done' : ''} />)}</span>
            ) : (
              <div className="mg-chips">
                {ev.slice(0, max).map((e) => (
                  <span key={e.id + e.date} className={`mg-chip${e.done ? ' done' : ''}${e.kind === 'note' ? ' note' : ''}`} style={e.color ? { borderLeftColor: e.color } : undefined}>
                    {e.cont && '↳ '}{e.start && <b>{e.start}</b>} {e.title}
                  </span>
                ))}
                {ev.length > max && <span className="mg-more">+{ev.length - max}</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CalHead() {
  const month = useCal((s) => s.month)
  const sel = useCal((s) => s.sel)
  const view = useCal((s) => s.view)
  const cal = useCal.getState()
  return (
    <div className="cal-head">
      <div className="cal-nav">
        <button className="icon-btn" onClick={() => cal.shift(-1)} aria-label={t('이전 달')}><Icon name="back" /></button>
        <h2 className={view === 'week' ? 'wk' : ''}>{view === 'week' ? `${fmtShort(weekOf(sel)[0])} – ${fmtShort(weekOf(sel)[1])}` : fmtMonth(month)}</h2>
        <button className="icon-btn" onClick={() => cal.shift(1)} aria-label={t('다음 달')}><Icon name="forward" /></button>
      </div>
      <button className="today-btn" onClick={cal.goToday}>{t('오늘')}</button>
      <span className="cal-gap" />
      <div className="seg">
        <button className={view === 'month' ? 'on' : ''} onClick={() => cal.setView('month')}>{t('월간')}</button>
        <button className={view === 'week' ? 'on' : ''} onClick={() => cal.setView('week')}>{t('주간')}</button>
        <button className={view === 'agenda' ? 'on' : ''} onClick={() => cal.setView('agenda')}>{t('목록')}</button>
      </div>
    </div>
  )
}

/** 선택한 달의 일정을 날짜순으로 */
function MonthAgenda() {
  const cal = useCalMap()
  const month = useCal((s) => s.month)
  const first = month
  const n = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate()
  const groups = range(cal, first, n)
  if (!groups.length) return <p className="hint pad">{t('이 달에는 일정이 없습니다.')}</p>
  return (
    <div className="agenda-scroll">
      {groups.map(([d, ev]) => (
        <section key={d} className="ag-day">
          <h3 onClick={() => useCal.getState().select(d)}>{fmtDay(d)}</h3>
          {ev.map((e) => <EventRow key={e.id + e.date} ev={e} />)}
        </section>
      ))}
    </div>
  )
}

function DayHead({ date }: { date: string }) {
  const colors = useDayColors()
  const showHol = useApp((s) => s.settings.calHolidays)
  const [pick, setPick] = useState(false)
  const hol = showHol ? holidayOf(date) : null
  const cur = colors.get(date)
  return (
    <>
      <div className="day-head">
        <h3>{fmtDay(date)}{date === todayYmd() && <small>{t('오늘')}</small>}{hol && <small className="hol">{hol}</small>}</h3>
        <div className="head-actions">
          <button className="icon-btn" title={t('날짜 색상')} onClick={() => setPick((v) => !v)}><span className="swatch-dot" style={{ background: cur ?? 'transparent' }} /></button>
          <button className="icon-btn" title={t('노트로 열기')} onClick={() => openDay(date)}><Icon name="edit" /></button>
        </div>
      </div>
      {pick && (
        <div className="swatches">
          {DAY_COLORS.map((c) => <button key={c} className={`sw${cur === c ? ' on' : ''}`} style={{ background: c }} onClick={() => { setDayColor(date, c); setPick(false) }} aria-label={c} />)}
          <button className="sw none" onClick={() => { setDayColor(date, null); setPick(false) }} aria-label={t('색상 지우기')}>×</button>
        </div>
      )}
    </>
  )
}

/** 주간: 선택한 날이 속한 주 (일~토) 7열 */
function WeekView() {
  const cal = useCalMap()
  const colors = useDayColors()
  const showHol = useApp((s) => s.settings.calHolidays)
  const sel = useCal((s) => s.sel)
  const today = todayYmd()
  const start = addDays(sel, -parseYmd(sel).getDay())
  const wd = useMemo(() => weekdayLabels(), [])
  return (
    <div className="wgrid">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i)
        const hol = showHol ? holidayOf(d) : null
        const color = colors.get(d)
        return (
          <div
            key={d}
            className={`wg-col${d === sel ? ' sel' : ''}${d === today ? ' today' : ''}${i === 0 || hol ? ' sun' : ''}`}
            style={color ? { background: `color-mix(in srgb, ${color} 14%, transparent)` } : undefined}
            onClick={() => useCal.getState().select(d)}
            onDoubleClick={() => useCal.getState().focus()}
          >
            <div className="wg-head"><span>{wd[i]}</span><b>{+d.slice(8)}</b>{hol && <em>{hol}</em>}</div>
            <div className="wg-body">
              {(cal.get(d) ?? []).map((e) => (
                <div key={e.id + e.date} className={`mg-chip${e.done ? ' done' : ''}${e.kind === 'note' ? ' note' : ''}`} style={e.color ? { borderLeftColor: e.color } : undefined}>
                  {e.cont && '↳ '}{e.start && <b>{e.start}</b>} {e.title}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 모바일 주간: 7일을 세로로. 날짜를 누르면 그날이 선택된다 */
function WeekList() {
  const cal = useCalMap()
  const showHol = useApp((s) => s.settings.calHolidays)
  const sel = useCal((s) => s.sel)
  const today = todayYmd()
  const [start] = weekOf(sel)
  const wd = useMemo(() => weekdayLabels(), [])
  return (
    <div className="agenda-scroll wk-list">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i)
        const hol = showHol ? holidayOf(d) : null
        const list = cal.get(d) ?? []
        return (
          <section key={d} className={`wk-day${d === sel ? ' sel' : ''}${d === today ? ' is-now' : ''}${i === 0 || hol ? ' sun' : ''}`} onClick={() => useCal.getState().select(d)}>
            <div className="wk-date"><span>{wd[i]}</span><b>{+d.slice(8)}</b></div>
            <div className="wk-events">
              {hol && <div className="wk-hol">{hol}</div>}
              {list.length ? list.map((e) => <EventRow key={e.id + e.date} ev={e} />) : <div className="wk-empty">{t('일정 없음')}</div>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** PC 본문: 머리글 + 월간/주간/목록 */
export function CalendarMain() {
  const view = useCal((s) => s.view)
  return (
    <div className="cal-main">
      <CalHead />
      {view === 'month' ? <MonthGrid /> : view === 'week' ? <WeekView /> : <MonthAgenda />}
    </div>
  )
}

/** PC 오른쪽: 선택한 날 + 그날의 Daily 노트 */
const EVENTS_OPEN_KEY = 'nosidian.dayEventsOpen'
const readEventsOpen = () => {
  try {
    return localStorage.getItem(EVENTS_OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

export function DayPanel() {
  const sel = useCal((s) => s.sel)
  const cal = useCalMap()
  const path = dailyPath(sel)
  const file = useApp((s) => s.files[path])
  const exists = !!file && !file.deleted
  // 일정 목록을 접으면 아래 노트(수업 필기처럼 긴 글)가 그만큼 넓어진다. 접은 상태는 기억한다
  const [open, setOpen] = useState(readEventsOpen)
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(EVENTS_OPEN_KEY, next ? '1' : '0')
    } catch {
      /* 저장소를 못 써도 동작한다 */
    }
  }
  const count = (cal.get(sel) ?? []).length
  return (
    <aside className="day-panel">
      <DayHead date={sel} />
      <QuickAdd date={sel} />
      <button className="day-toggle" aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {t('일정 {n}개', { n: count })}
        <small>{open ? t('접으면 노트가 넓어져요') : t('눌러서 펼치기')}</small>
      </button>
      {open && <div className="day-events"><DayList date={sel} /></div>}
      <div className="day-memo">
        {exists ? (
          <Editor key={path} path={path} initial={file.content} externalContent={file.content} onChange={(c) => useApp.getState().setContent(path, c)} />
        ) : (
          <div className="day-memo-empty">
            <p className="hint">{t('이 날의 메모가 아직 없습니다.')}</p>
            <button onClick={() => ensureDaily(sel)}>{t('메모 쓰기')}</button>
          </div>
        )}
      </div>
    </aside>
  )
}

/** 오늘 이후 일정 (PC 왼쪽 사이드바, 모바일 '오늘' 탭 공용) */
export function Upcoming({ days = 14, from }: { days?: number; from?: string }) {
  const cal = useCalMap()
  const start = from ?? addDays(todayYmd(), 1)
  const groups = range(cal, start, days)
  if (!groups.length) return <p className="hint">{t('예정된 일정이 없습니다.')}</p>
  return (
    <>
      {groups.map(([d, ev]) => (
        <section key={d} className="ag-day">
          <h3 onClick={() => useCal.getState().select(d)}>{fmtDay(d)}</h3>
          {ev.map((e) => <EventRow key={e.id + e.date} ev={e} />)}
        </section>
      ))}
    </>
  )
}

export function CalendarSide() {
  return (
    <div className="cal-side">
      <div className="panel-head"><h2>{t('다가오는 일정')}</h2></div>
      <div className="tree-scroll"><Upcoming days={30} from={todayYmd()} /></div>
    </div>
  )
}

/** 모바일 '캘린더' 탭: 월간(격자 + 선택한 날) / 주간(7일 세로) / 목록(그 달 전체) */
export function CalendarMobile() {
  const sel = useCal((s) => s.sel)
  const view = useCal((s) => s.view)
  return (
    <div className="cal-mobile">
      <CalHead />
      {view === 'month' && (
        <>
          <MonthGrid compact />
          <div className="cal-day">
            <DayHead date={sel} />
            <div className="cal-day-scroll">
              <DayList date={sel} />
            </div>
            <QuickAdd date={sel} />
          </div>
        </>
      )}
      {view === 'week' && (
        <>
          <WeekList />
          <div className="cal-foot"><QuickAdd date={sel} /></div>
        </>
      )}
      {view === 'agenda' && (
        <>
          <MonthAgenda />
          <div className="cal-foot"><QuickAdd date={sel} /></div>
        </>
      )}
    </div>
  )
}

/** 모바일 '오늘' 탭 */
export function TodayView() {
  const cal = useCalMap()
  const today = todayYmd()
  // 최근 2주 안의 못 한 일
  const overdue: CalEvent[] = []
  for (let i = 14; i >= 1; i--) for (const e of cal.get(addDays(today, -i)) ?? []) if (e.kind === 'task' && !e.done && !e.inst && !e.cont) overdue.push(e)
  return (
    <div className="today">
      <div className="panel-head">
        <h2>{fmtDay(today)}</h2>
        <div className="head-actions">
          <button className="icon-btn" title={t('오늘의 노트 열기')} onClick={() => openDay(today)}><Icon name="edit" /></button>
        </div>
      </div>
      <div className="tree-scroll">
        <QuickAdd date={today} />
        <DayList date={today} />
        {overdue.length > 0 && (
          <section className="ag-day overdue">
            <h3>{t('지난 미완료')}</h3>
            {overdue.slice(0, 10).map((e) => <EventRow key={e.id} ev={e} showDate />)}
          </section>
        )}
        <h3 className="sect">{t('다가오는 일정')}</h3>
        <Upcoming days={7} />
      </div>
    </div>
  )
}
