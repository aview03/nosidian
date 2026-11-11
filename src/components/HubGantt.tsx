// 프로젝트 허브 "간트" 보기: 시작일~마감을 막대로, 마감만 있는 일은 마름모 점으로 그린다. 설계: docs/PROJECT-VIEWS.md §4.1
//  - 왼쪽 제목 열은 고정, 날짜 영역만 가로 스크롤. 열자마자 오늘이 왼쪽 1/4 쯤에 오도록 스크롤한다.
//  - PC(마우스·펜): 막대 가운데를 끌면 이동, 양 끝을 끌면 기간 조절(하루 단위로 붙음). 놓으면 줄이 고쳐지고 되돌리기 알림.
//  - 폰(터치): 끌기는 가로 스크롤과 부딪히므로 막고, 누르면 업무 편집기(날짜 선택기)가 열린다.
//  - 키보드: 막대에서 Alt+←/→ 로 하루씩 이동, Alt+Shift+←/→ 로 마감만 하루씩.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { t } from '../lib/i18n'
import { addDays, fmtDay, parseYmd, todayYmd } from '../lib/calendar'
import { DAY_PX, boxOf, buildGantt, dayDiff, dragResult, groupBars, isWeekend, monthSegments, type DragMode, type GanttBar, type GanttScale, type GroupBy } from '../lib/gantt'
import { rowStateOf, type RowState } from '../lib/projectViews'
import type { Task } from '../lib/work'
import { patchTask, useWorkUi, withUndo } from '../lib/workOps'
import { Select } from './Select'
import { TaskLine } from './TaskLine'

const STATE_LABEL: Record<RowState, string> = { todo: '할 일', doing: '진행 중', waiting: '대기', dropped: '취소됨', done: '완료' }
const short = (s: string) => (s.length > 18 ? s.slice(0, 18) + '…' : s)

interface Drag {
  id: string
  mode: DragMode
  x0: number
  delta: number
  moved: boolean
}

/** 끌고 있는 동안 보여 줄 막대(미리보기). 안 끌고 있으면 그대로 */
function preview(bar: GanttBar, drag: Drag | null): GanttBar {
  if (!drag || drag.id !== bar.task.id) return bar
  const r = dragResult(drag.mode, drag.delta, bar)
  if (!r) return bar
  if (bar.kind === 'point') {
    const d = r.due ?? r.start ?? bar.start
    return { ...bar, start: d, end: d }
  }
  return { ...bar, start: r.start ?? bar.start, end: r.due ?? bar.end }
}

export function HubGantt({ tasks, projectDue }: { tasks: Task[]; projectDue?: string }) {
  const today = todayYmd()
  const [scale, setScale] = useState<GanttScale>('week')
  const [group, setGroup] = useState<GroupBy>('none')
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const justDragged = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const dw = DAY_PX[scale]

  const model = useMemo(() => buildGantt(tasks, today, projectDue), [tasks, today, projectDue])
  const { from, days } = model
  const groups = useMemo(() => groupBars(model.bars, group), [model.bars, group])
  const todayIdx = dayDiff(from, today)
  const segs = useMemo(() => monthSegments(from, days), [from, days])

  // 열자마자(그리고 눈금을 바꿀 때) 오늘이 왼쪽 1/4 쯤에 오게
  useEffect(() => {
    const el = scroller.current
    if (!el || !el.clientWidth) return
    const label = parseFloat(getComputedStyle(el).getPropertyValue('--gl')) || 112
    el.scrollLeft = Math.max(0, todayIdx * dw - (el.clientWidth - label) * 0.25)
  }, [scale, todayIdx, dw])

  // 주말 칸 배경: 7일 무늬를 첫 토요일에 맞춰 깐다
  const firstSat = (6 - parseYmd(from).getDay() + 7) % 7
  const trackStyle = {
    width: days * dw,
    backgroundImage: `linear-gradient(to right, var(--g-weekend) 0, var(--g-weekend) ${2 * dw}px, transparent ${2 * dw}px)`,
    backgroundSize: `${7 * dw}px 100%`,
    backgroundPositionX: `${(firstSat - 7) * dw}px`,
  } as const

  const commit = (bar: GanttBar, mode: DragMode, delta: number) => {
    const r = dragResult(mode, delta, bar)
    if (!r) return
    const name = short(bar.task.title)
    const msg =
      bar.kind === 'point'
        ? bar.field === 'start'
          ? t('"{name}" 시작일을 {to}(으)로 바꿨어요', { name, to: r.start! })
          : t('"{name}" 마감을 {to}(으)로 바꿨어요', { name, to: r.due! })
        : t('"{name}" 일정을 {a} ~ {b}(으)로 바꿨어요', { name, a: r.start!, b: r.due! })
    withUndo(bar.task, msg, () => patchTask(bar.task, r))
  }

  const down = (e: PointerEvent<HTMLElement>, bar: GanttBar) => {
    if (e.pointerType === 'touch' || e.button !== 0) return // 터치는 스크롤과 부딪히므로 끌지 않는다(누르면 편집기)
    const h = (e.target as HTMLElement).dataset.h as DragMode | undefined
    const d: Drag = { id: bar.task.id, mode: bar.kind === 'point' ? 'move' : h ?? 'move', x0: e.clientX, delta: 0, moved: false }
    dragRef.current = d
    setDrag(d)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d) return
    const delta = Math.round((e.clientX - d.x0) / dw)
    const moved = d.moved || Math.abs(e.clientX - d.x0) > 4
    if (delta !== d.delta || moved !== d.moved) {
      const next = { ...d, delta, moved }
      dragRef.current = next
      setDrag(next)
    }
  }
  const up = (bar: GanttBar) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d) return
    if (d.moved) {
      justDragged.current = true
      setTimeout(() => (justDragged.current = false), 0)
      commit(bar, d.mode, d.delta)
    }
  }
  const key = (e: KeyboardEvent<HTMLElement>, bar: GanttBar) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    const step = e.key === 'ArrowRight' ? 1 : -1
    commit(bar, e.shiftKey && bar.kind === 'bar' ? 'end' : 'move', step)
  }
  const open = (tk: Task) => {
    if (justDragged.current) return
    useWorkUi.getState().openEditor(tk)
  }

  const header = (
    <div className="g-row g-head">
      <div className="g-label" />
      <div className="g-track g-headtrack" style={{ width: days * dw }}>
        <div className="g-months">
          {segs.map((s) => (
            <span key={s.month} style={{ left: s.idx * dw, width: s.span * dw }}>{s.month.slice(0, 4)}.{s.month.slice(5)}</span>
          ))}
        </div>
        <div className="g-days">
          {Array.from({ length: days }, (_, i) => {
            const d = addDays(from, i)
            const wd = parseYmd(d).getDay()
            if (scale === 'month' && wd !== 1) return null // 월 눈금은 월요일 날짜만
            return (
              <span key={d} className={`${isWeekend(from, i) ? 'wk ' : ''}${i === todayIdx ? 'now' : ''}`} style={{ left: i * dw, width: scale === 'week' ? dw : 7 * dw }}>
                {Number(d.slice(8)) === 1 ? `${Number(d.slice(5, 7))}/1` : Number(d.slice(8))}
              </span>
            )
          })}
        </div>
        {todayIdx >= 0 && todayIdx < days && <i className="g-today" style={{ left: (todayIdx + 0.5) * dw }} />}
      </div>
    </div>
  )

  const row = (b: GanttBar) => {
    const shown = preview(b, drag)
    const box = boxOf(shown, from, days, dw)
    const tk = b.task
    const st = rowStateOf(tk)
    const late = !tk.done && st !== 'dropped' && !!tk.due && tk.due < today
    const range = b.kind === 'bar' ? `${shown.start} ~ ${shown.end}` : shown.start
    const aria = `${tk.title}, ${range}, ${t(STATE_LABEL[st])}${late ? `, ${t('기한 지남')}` : ''}`
    return (
      <div role="listitem" key={tk.id} className={`g-row${st === 'done' || st === 'dropped' ? ' fin' : ''}`}>
        <button className="g-label" onClick={() => open(tk)} title={tk.title}>
          {tk.kind === 'decision' && <b className="wrk-kind">{t('결정')}</b>}
          {tk.p === 1 && <b className="wrk-p">!</b>}
          <span>{tk.title}</span>
        </button>
        <div className="g-track" style={trackStyle}>
          {todayIdx >= 0 && todayIdx < days && <i className="g-today" style={{ left: (todayIdx + 0.5) * dw }} />}
          {box && b.kind === 'bar' && (
            <button
              className={`g-bar s-${st}${late ? ' late' : ''}${box.clipLeft ? ' cl' : ''}${box.clipRight ? ' cr' : ''}${drag?.id === tk.id ? ' dragging' : ''}`}
              style={{ left: box.left, width: box.width }}
              aria-label={aria}
              title={`${tk.title}\n${range}`}
              onPointerDown={(e) => down(e, b)}
              onPointerMove={move}
              onPointerUp={() => up(b)}
              onPointerCancel={() => up(b)}
              onKeyDown={(e) => key(e, b)}
              onClick={() => open(tk)}
            >
              <i className="g-h l" data-h="start" aria-hidden="true" />
              {late && <em aria-hidden="true">!</em>}
              <i className="g-h r" data-h="end" aria-hidden="true" />
            </button>
          )}
          {box && b.kind === 'point' && (
            <button
              className={`g-pt s-${st}${late ? ' late' : ''}${drag?.id === tk.id ? ' dragging' : ''}`}
              style={{ left: box.left + dw / 2 }}
              aria-label={aria}
              title={`${tk.title}\n${range}${b.field === 'due' ? ` (${t('마감')})` : ` (${t('시작일')})`}`}
              onPointerDown={(e) => down(e, b)}
              onPointerMove={move}
              onPointerUp={() => up(b)}
              onPointerCancel={() => up(b)}
              onKeyDown={(e) => key(e, b)}
              onClick={() => open(tk)}
            />
          )}
        </div>
      </div>
    )
  }

  const groupTitle = (key: string) => (group === 'owner' ? (key || t('담당 없음')) : t(STATE_LABEL[key as RowState]))

  return (
    <div className="gantt">
      <div className="g-tools">
        <span className="tool-label">{t('눈금')}</span>
        <div className="seg-mini g-scale" role="group" aria-label={t('눈금')}>
          {(['week', 'month'] as const).map((s) => (
            <button key={s} aria-pressed={scale === s} className={scale === s ? 'on' : ''} onClick={() => setScale(s)}>{s === 'week' ? t('주') : t('월')}</button>
          ))}
        </div>
        <Select<GroupBy>
          className="g-groupsel"
          ariaLabel={t('묶기')}
          title={t('묶기')}
          value={group}
          options={[
            { value: 'none', label: t('묶지 않음') },
            { value: 'owner', label: t('담당자별') },
            { value: 'state', label: t('상태별') },
          ]}
          onChange={setGroup}
        />
      </div>

      {model.bars.length === 0 ? (
        <p className="hint pad">{t('시작일이나 마감일이 있는 업무가 없어요. 업무에 날짜를 넣으면 여기에 막대로 나타나요.')}</p>
      ) : (
        <div className="gantt-scroll" ref={scroller} role="list" aria-label={t('간트')}>
          <div className="g-grid" style={{ width: `calc(var(--gl) + ${days * dw}px)` }}>
            {header}
            {projectDue && (
              <div className="g-row g-proj" role="listitem">
                <div className="g-label g-static"><span>⚑ {t('프로젝트 마감')}</span></div>
                <div className="g-track" style={trackStyle}>
                  {todayIdx >= 0 && todayIdx < days && <i className="g-today" style={{ left: (todayIdx + 0.5) * dw }} />}
                  {boxOf({ start: projectDue, end: projectDue }, from, days, dw) && (
                    <span className="g-flag" style={{ left: dayDiff(from, projectDue) * dw + dw / 2 }} title={`${t('프로젝트 마감')} ${fmtDay(projectDue)}`}>⚑</span>
                  )}
                </div>
              </div>
            )}
            {groups.map((g) => (
              <div key={g.key || '(none)'} role="group" aria-label={group === 'none' ? undefined : groupTitle(g.key)}>
                {group !== 'none' && (
                  <div className="g-row g-grouphead">
                    <div className="g-label g-static"><span>{groupTitle(g.key)} <small>{g.bars.length}</small></span></div>
                    <div className="g-track" style={{ width: days * dw }} />
                  </div>
                )}
                {g.bars.map(row)}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="hint g-help">{t('막대를 끌어 일정을 옮기고, 양 끝을 끌어 기간을 바꿔요(PC). 폰에서는 눌러서 날짜를 고쳐요. 마름모는 마감일만 정해진 일이에요.')}</p>

      {model.undated.length > 0 && (
        <section className="wrk-sec g-undated">
          <h3>{t('날짜가 없는 일')}<span className="wrk-count">{model.undated.length}</span></h3>
          <p className="hint small">{t('시작일이나 마감일을 정하면 막대로 나타나요.')}</p>
          {model.undated.map((tk) => <TaskLine key={tk.id} tk={tk} />)}
        </section>
      )}
    </div>
  )
}
