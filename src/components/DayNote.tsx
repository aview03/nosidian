// 날짜 메모창: 칸을 누르면 그 자리에 뜨는 포스트잇. 한 줄에 일정 하나를 글로 적고 ✓ 로 확정한다.
// "14:00 치과", "내일 3시 약속"처럼 쓰면 시간·날짜가 풀려서 Daily 노트의 일정 줄로 저장된다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { holidayOf } from '../lib/holidays'
import { DAY_COLORS, dayText, fmtDay, openDay, otherEvents, saveDayText, setDayColor, useCal, type CalEvent } from '../lib/calendar'
import { Icon } from './Icon'
import { useCalMap, useDayColors } from './Calendar'

const W = 290
const H = 270

export interface Anchor { left: number; top: number; width: number; height: number }

export function DayNote({ date, anchor, onClose, inline, onEditor }: { date: string; anchor?: Anchor; onClose(): void; inline?: boolean; onEditor?(date: string, ev?: CalEvent): void }) {
  const initial = useMemo(() => dayText(date), [date])
  const ta = useRef<HTMLTextAreaElement>(null)
  const [pick, setPick] = useState(false)
  const showHol = useApp((s) => s.settings.calHolidays)
  const cal = useCalMap()
  const colors = useDayColors()
  const hol = showHol ? holidayOf(date) : null
  const cur = colors.get(date)
  const others = otherEvents(cal.get(date) ?? [], date)

  // 화면 밖으로 나가지 않게 칸 옆에 놓는다 (오른쪽이 모자라면 칸의 왼쪽에)
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = 0
  let top = 0
  if (anchor) {
    left = anchor.left + anchor.width + 6
    if (left + W > vw - 8) left = Math.max(8, anchor.left - W - 6)
    top = Math.min(Math.max(8, anchor.top), Math.max(8, vh - H - 8))
  }

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const finish = () => {
    const v = ta.current?.value ?? ''
    if (v !== initial) saveDayText(date, v) // 바뀐 게 있을 때만 쓴다
    onClose()
  }
  const openEditor = (ev?: CalEvent) => {
    const v = ta.current?.value ?? ''
    if (v !== initial) saveDayText(date, v)
    const d = ev ? (ev.origDate ?? ev.date) : date
    if (onEditor) return onEditor(d, ev) // 작은 창에서는 편집기를 별도 창으로
    onClose()
    useCal.getState().openEditor(d, ev)
  }
  // 작은 창: 포커스를 잃으면(바깥을 누르면) 저장하고 닫는다
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    if (!inline) return
    const f = () => finishRef.current()
    window.addEventListener('blur', f)
    return () => window.removeEventListener('blur', f)
  }, [inline])

  return (
    <>
      {!inline && <div className="dn-back" onPointerDown={finish} />}
      <div className={`dn${inline ? ' dn-inline' : ''}`} style={inline ? undefined : { left, top, width: W, maxHeight: H + 120 }} onKeyDown={(e) => e.key === 'Escape' && finish()}>
        <div className="dn-head">
          <span className="dn-date">{fmtDay(date)}{hol && <em>{hol}</em>}</span>
          <button className="dn-ok" onClick={finish} aria-label={t('확인')} title={t('확인')}><Icon name="check" size={20} /></button>
        </div>
        <textarea
          ref={ta}
          className="dn-text"
          defaultValue={initial}
          placeholder={t('한 줄에 일정 하나\n예) 14:00 치과\n    내일 3시 약속')}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish() } }}
          spellCheck={false}
        />
        {others.length > 0 && (
          <div className="dn-others" aria-label={t('반복·기간 일정')}>
            {others.map((e) => (
              <button key={e.id + e.date} onClick={() => openEditor(e.kind === 'task' ? e : undefined)}>
                {e.inst || e.repeat ? <Icon name="repeat" size={12} /> : null}
                <span>{e.cont ? '↳ ' : ''}{e.start ?? ''} {e.title}</span>
              </button>
            ))}
          </div>
        )}
        {pick && (
          <div className="dn-sw">
            {DAY_COLORS.map((c) => <button key={c} className={cur === c ? 'on' : ''} style={{ background: c }} onClick={() => { setDayColor(date, c); setPick(false) }} aria-label={c} />)}
            <button className="none" onClick={() => { setDayColor(date, null); setPick(false) }} aria-label={t('색상 지우기')}>×</button>
          </div>
        )}
        <div className="dn-foot">
          <button className="dn-pal" onClick={() => setPick((v) => !v)} aria-label={t('날짜 색상')} title={t('날짜 색상')}><span style={{ background: cur ?? 'transparent' }} /></button>
          <button className="dn-link" onClick={() => openEditor()}>{t('시간·반복 설정')}</button>
          <button className="dn-link" onClick={() => { finish(); openDay(date) }}>{t('노트 열기')}</button>
        </div>
      </div>
    </>
  )
}
