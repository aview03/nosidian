// 일정 편집기: 제목 · 날짜 · 종일/시간 · 며칠 걸리는 일정 · 반복을 폼으로 입력한다. 결과는 노트의 한 줄(마크다운)로 저장된다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { confirmAsk } from '../lib/dialog'
import {
  addDays, addEvent, deleteEvent, fmtDay, openPath, parseYmd, quickOf, updateEvent, useCal, weekdayLabels,
  type CalEvent, type Quick, type Repeat,
} from '../lib/calendar'
import { Icon } from './Icon'

const addHour = (hhmm: string, h: number) => {
  const [a, b] = hhmm.split(':').map(Number)
  return `${String(Math.min(23, a + h)).padStart(2, '0')}:${String(b).padStart(2, '0')}`
}

export function EventEditor() {
  const ed = useCal((s) => s.editor)
  if (!ed) return null
  return <Form key={(ed.ev?.id ?? 'new') + ed.date} date={ed.date} ev={ed.ev} />
}

function Form({ date, ev }: { date: string; ev?: CalEvent }) {
  const init = ev ? quickOf(ev) : null
  const [title, setTitle] = useState(init?.title ?? '')
  const [d, setD] = useState(init?.date ?? date)
  const [multi, setMulti] = useState(!!init?.endDate)
  const [endD, setEndD] = useState(init?.endDate ?? addDays(init?.date ?? date, 1))
  const [timed, setTimed] = useState(!!init?.start)
  const [start, setStart] = useState(init?.start ?? '09:00')
  const [end, setEnd] = useState(init?.start ? (init.end ?? '') : '10:00')
  const [rep, setRep] = useState<'' | Repeat>(init?.repeat ?? '')
  const [days, setDays] = useState<number[]>(init?.repeatDays ?? [])
  const [hasUntil, setHasUntil] = useState(!!init?.until)
  const [until, setUntil] = useState(init?.until ?? addDays(init?.date ?? date, 30))
  const titleRef = useRef<HTMLInputElement>(null)
  const close = () => useCal.getState().closeEditor()
  const wd = useMemo(() => weekdayLabels(), [])
  const dow = parseYmd(d).getDay()
  const effDays = days.length ? days : [dow]

  useEffect(() => {
    if (!ev) titleRef.current?.focus() // 새 일정은 바로 제목을 쓸 수 있게
    const f = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [ev])

  // 오류 (저장 버튼을 막고 이유를 보여 준다)
  const noTitle = !title.trim() // 제목이 비어 있으면 문구 없이 저장 버튼만 막는다 (쓰기 전부터 오류를 보이지 않게)
  const error =
    multi && endD < d ? t('끝나는 날이 시작하는 날보다 빠릅니다.')
    : timed && end && end <= start ? t('끝나는 시각이 시작 시각보다 빠릅니다.')
    : rep && hasUntil && until < d ? t('반복 종료일이 시작일보다 빠릅니다.')
    : ''

  // 한 문장 요약: 입력한 내용이 어떻게 저장되는지 비개발자도 바로 확인
  const summary = useMemo(() => {
    const parts: string[] = [fmtDay(d) + (multi && endD > d ? ` ~ ${fmtDay(endD)}` : '')]
    parts.push(timed ? start + (end ? `–${end}` : '') : t('종일'))
    if (rep) {
      const r =
        rep === 'daily' ? t('매일')
        : rep === 'weekdays' ? t('평일(월~금)')
        : rep === 'weekly' ? t('매주 {days}', { days: effDays.slice().sort().map((x) => wd[x]).join(', ') })
        : rep === 'monthly' ? t('매월 {n}일', { n: +d.slice(8) })
        : t('매년 {m}월 {n}일', { m: +d.slice(5, 7), n: +d.slice(8) })
      parts.push(r + (hasUntil ? ' · ' + t('{date}까지', { date: fmtDay(until) }) : ''))
    }
    return parts.join(' · ')
  }, [d, multi, endD, timed, start, end, rep, effDays, hasUntil, until, wd])

  const save = () => {
    if (error || noTitle) return
    const q: Quick = {
      title: title.trim(),
      date: d,
      endDate: multi && endD > d ? endD : undefined,
      start: timed ? start : undefined,
      end: timed && end ? end : undefined,
      repeat: !multi && rep ? rep : undefined,
      repeatDays: !multi && rep === 'weekly' && !(effDays.length === 1 && effDays[0] === dow) ? effDays : undefined,
      until: !multi && rep && hasUntil ? until : undefined,
    }
    if (ev) updateEvent(ev, q)
    else addEvent(q)
    useCal.getState().select(d)
    close()
  }

  const remove = async () => {
    if (!ev) return
    const series = !!ev.repeat
    const ok = await confirmAsk(t('일정을 삭제할까요?'), series ? t('반복 일정은 모두 사라집니다.') : ev.title, t('삭제'), true)
    if (!ok) return
    deleteEvent(ev)
    close()
  }

  const REPS: [('' | Repeat), string][] = [
    ['', t('반복 안 함')], ['daily', t('매일')], ['weekdays', t('평일')], ['weekly', t('매주')], ['monthly', t('매월')], ['yearly', t('매년')],
  ]

  return (
    <div className="ee-wrap" onClick={close}>
      <div className="ee" role="dialog" aria-label={ev ? t('일정 수정') : t('새 일정')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{ev ? t('일정 수정') : t('새 일정')}</h3>
          <button className="icon-btn" onClick={close} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>

        <div className="ee-body">
          <label className="ee-field">
            <span>{t('제목')}</span>
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && save()} placeholder={t('무슨 일정인가요?')} />
          </label>

          <div className="ee-row">
            <label className="ee-field">
              <span>{multi ? t('시작일') : t('날짜')}</span>
              <input type="date" value={d} onChange={(e) => e.target.value && setD(e.target.value)} />
            </label>
            {multi && (
              <label className="ee-field">
                <span>{t('종료일')}</span>
                <input type="date" value={endD} min={d} onChange={(e) => e.target.value && setEndD(e.target.value)} />
              </label>
            )}
          </div>
          <label className="ee-check">
            <input type="checkbox" checked={multi} onChange={(e) => { setMulti(e.target.checked); if (e.target.checked) { setRep(''); if (endD <= d) setEndD(addDays(d, 1)) } }} />
            <span>{t('며칠에 걸친 일정 (예: 출장, 여행, 프로젝트)')}</span>
          </label>

          <label className="ee-check">
            <input type="checkbox" checked={!timed} onChange={(e) => setTimed(!e.target.checked)} />
            <span>{t('종일')}</span>
          </label>
          {timed && (
            <div className="ee-row">
              <label className="ee-field">
                <span>{t('시작 시각')}</span>
                <input type="time" value={start} step={300} onChange={(e) => { const v = e.target.value; if (!v) return; setStart(v); if (!end || end <= v) setEnd(addHour(v, 1)) }} />
              </label>
              <label className="ee-field">
                <span>{t('종료 시각')}</span>
                <span className="ee-clearable">
                  <input type="time" value={end} step={300} min={start} onChange={(e) => setEnd(e.target.value)} />
                  {end && <button className="ee-x" onClick={() => setEnd('')} aria-label={t('종료 시각 지우기')}>×</button>}
                </span>
              </label>
            </div>
          )}
          {timed && (
            <div className="ee-chips" aria-label={t('길이')}>
              {[30, 60, 90, 120, 180].map((m) => {
                const [h, mi] = start.split(':').map(Number)
                const tot = Math.min(23 * 60 + 59, h * 60 + mi + m)
                const v = `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
                return <button key={m} className={end === v ? 'on' : ''} onClick={() => setEnd(v)}>{m % 60 === 0 && m >= 60 ? t('{n}시간', { n: m / 60 }) : t('{n}분', { n: m })}</button>
              })}
            </div>
          )}

          <label className="ee-field">
            <span>{t('반복')}</span>
            <select value={rep} disabled={multi} onChange={(e) => setRep(e.target.value as '' | Repeat)}>
              {REPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {multi && <p className="hint small ee-note">{t('며칠에 걸친 일정은 반복할 수 없어요.')}</p>}
          {rep === 'weekly' && !multi && (
            <div className="ee-days" aria-label={t('반복할 요일')}>
              {wd.map((w, i) => (
                <button key={i} className={effDays.includes(i) ? 'on' : ''} onClick={() => setDays((prev) => { const cur = prev.length ? prev : [dow]; return cur.includes(i) ? (cur.length > 1 ? cur.filter((x) => x !== i) : cur) : [...cur, i] })}>{w}</button>
              ))}
            </div>
          )}
          {rep && !multi && (
            <>
              <label className="ee-check">
                <input type="checkbox" checked={hasUntil} onChange={(e) => setHasUntil(e.target.checked)} />
                <span>{t('반복 종료일 정하기')}</span>
              </label>
              {hasUntil && (
                <label className="ee-field">
                  <span>{t('이 날까지 반복')}</span>
                  <input type="date" value={until} min={d} onChange={(e) => e.target.value && setUntil(e.target.value)} />
                </label>
              )}
            </>
          )}

          <div className="ee-summary" aria-live="polite">{summary}</div>
          {error && <p className="error ee-error">{error}</p>}
        </div>

        <div className="ee-foot">
          {ev && <button className="danger-link ee-del" onClick={() => void remove()}>{t('삭제')}</button>}
          {ev && <button className="link-btn" onClick={() => { close(); openPath(ev.path) }}>{t('노트에서 보기')}</button>}
          <span className="grow" />
          <button onClick={close}>{t('취소')}</button>
          <button className="primary" disabled={!!error || noTitle} onClick={save}>{t('저장')}</button>
        </div>
      </div>
    </div>
  )
}
