// 프로젝트 허브 "보드"(칸반): 카드를 끌어 놓거나 ‹ › 로 칸을 옮기면 그 줄의 status 가 바뀐다.
// 정렬은 두 가지: "마감순"(기본, 마감 → 우선순위) / "직접 정렬"(노트의 목록 줄 순서 그대로). 직접 정렬에서는 카드를 다른 카드 앞/뒤로
// 끌어 놓거나(PC) ▲▼ 로(폰) 순서를 바꿀 수 있고, 그러면 노트의 줄 순서가 바뀐다. 설계: docs/PROJECT-VIEWS.md
import { useEffect, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { todayYmd } from '../lib/calendar'
import { loadBoardSort, saveBoardSort, type BoardSort } from '../lib/hubViews'
import { uiStateOf, type Task, type UiState } from '../lib/work'
import { moveTask, reorderTask, useWorkUi, withUndo } from '../lib/workOps'

type Col = UiState | 'done'
const COLS: { key: Col; title: string }[] = [
  { key: 'todo', title: '할 일' },
  { key: 'doing', title: '진행 중' },
  { key: 'waiting', title: '대기' },
  { key: 'done', title: '완료' },
]
const colOf = (tk: Task): Col => (tk.done ? 'done' : uiStateOf(tk))
const short = (s: string) => (s.length > 18 ? s.slice(0, 18) + '…' : s)
const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.p ?? 9) - (b.p ?? 9)
/** 직접 정렬: 노트(경로) → 그 안의 줄 순서 */
const byDoc = (a: Task, b: Task) => a.path.localeCompare(b.path) || a.line - b.line

export function Board({ tasks, project }: { tasks: Task[]; project: string }) {
  const [sort, setSortState] = useState<BoardSort>(() => loadBoardSort(project))
  useEffect(() => setSortState(loadBoardSort(project)), [project])
  const setSort = (s: BoardSort) => {
    setSortState(s)
    saveBoardSort(project, s)
  }
  const manual = sort === 'manual'
  const [over, setOver] = useState<string | null>(null)
  const [ind, setInd] = useState<{ id: string; where: 'before' | 'after' } | null>(null)
  const shown = tasks.filter((x) => uiStateOf(x) !== 'dropped')
  const items = (key: Col) => shown.filter((x) => colOf(x) === key).sort(manual ? byDoc : byDue)

  /** tk 를 to 칸으로 옮기고(칸이 다르면), 직접 정렬이면 target 의 앞/뒤로 순서도 바꾼다(같은 노트일 때만). 한 번의 되돌리기로 묶는다 */
  const place = (tk: Task, to: Col, target: Task | null, where: 'before' | 'after') => {
    const colChanged = colOf(tk) !== to
    const canReorder = manual && !!target && target.id !== tk.id && target.path === tk.path
    if (!colChanged && !canReorder) {
      if (manual && target && target.path !== tk.path) useApp.getState().say(t('다른 노트에 있는 업무라서 이 자리로는 옮길 수 없어요'))
      return
    }
    const name = short(tk.title)
    const toTitle = t(COLS.find((c) => c.key === to)!.title)
    const msg = colChanged ? t('"{name}" 을(를) "{to}"(으)로 옮겼어요', { name, to: toTitle }) : t('"{name}" 순서를 바꿨어요', { name })
    withUndo(tk, msg, () => {
      let ok = true
      if (colChanged) ok = moveTask(tk, to)
      if (ok && canReorder) reorderTask(tk, target!, where)
      return ok
    })
  }

  return (
    <div>
      <div className="board-tools">
        <span className="tool-label">{t('정렬')}</span>
        <div className="seg-mini" role="group" aria-label={t('정렬')}>
          <button aria-pressed={!manual} className={!manual ? 'on' : ''} onClick={() => setSort('due')}>{t('마감순')}</button>
          <button aria-pressed={manual} className={manual ? 'on' : ''} onClick={() => setSort('manual')}>{t('직접 정렬')}</button>
        </div>
        {manual && <span className="hint small board-sorthint">{t('▲▼ 로 순서를 바꿔요')}<span className="hint-desktop"> {t('(PC는 카드를 끌어도 돼요)')}</span> · {t('노트의 목록 순서가 바뀌어요')}</span>}
      </div>
      <div className="board">
        {COLS.map((c, ci) => {
          const list = items(c.key)
          return (
            <section
              key={c.key}
              className={`board-col${over === c.key ? ' over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(c.key) }}
              onDragLeave={() => { setOver((o) => (o === c.key ? null : o)); setInd(null) }}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                setInd(null)
                const tk = shown.find((x) => x.id === e.dataTransfer.getData('text/plain'))
                if (!tk) return
                // 칸의 빈 곳에 놓으면: 직접 정렬이면 그 칸의 맨 끝으로, 아니면 칸만 바꾼다
                const last = [...list].reverse().find((x) => x.id !== tk.id) ?? null
                place(tk, c.key, last, 'after')
              }}
            >
              <h3>{t(c.title)}<span className="wrk-count">{list.length}</span></h3>
              {list.map((tk, i) => {
                const up = list[i - 1]
                const down = list[i + 1]
                return (
                  <div
                    key={tk.id}
                    className={`board-card${ind?.id === tk.id ? ` ins-${ind.where}` : ''}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', tk.id)}
                    onDragEnd={() => { setInd(null); setOver(null) }}
                    onDragOver={manual ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const r = e.currentTarget.getBoundingClientRect()
                      setOver(c.key)
                      setInd({ id: tk.id, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' })
                    } : undefined}
                    onDrop={manual ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const r = e.currentTarget.getBoundingClientRect()
                      const where = e.clientY < r.top + r.height / 2 ? 'before' : 'after' // 놓는 순간의 위치로 정한다(이전 dragover 상태에 기대지 않는다)
                      setOver(null)
                      setInd(null)
                      const src = shown.find((x) => x.id === e.dataTransfer.getData('text/plain'))
                      if (src && src.id !== tk.id) place(src, c.key, tk, where)
                    } : undefined}
                  >
                    <button className="board-body" onClick={() => useWorkUi.getState().openEditor(tk)}>
                      <span className="wrk-title">{tk.kind === 'decision' && <b className="wrk-kind">{t('결정')}</b>}{tk.p === 1 && <b className="wrk-p">!</b>}{tk.title}</span>
                      <span className="wrk-meta">
                        {tk.due && <span className={!tk.done && tk.due < todayYmd() ? 'wrk-late' : 'wrk-due'}>{tk.due.slice(5)}</span>}
                        {tk.owner.length > 0 && <span className="wrk-owner">{tk.owner.join(', ')}</span>}
                      </span>
                    </button>
                    {manual && (
                      <span className="board-order">
                        <button disabled={!up || up.path !== tk.path} aria-label={t('위로')} onClick={() => place(tk, c.key, up, 'before')}>▲</button>
                        <button disabled={!down || down.path !== tk.path} aria-label={t('아래로')} onClick={() => place(tk, c.key, down, 'after')}>▼</button>
                      </span>
                    )}
                    <span className="board-move">
                      <button disabled={ci === 0} aria-label={t('이전 칸으로')} onClick={() => place(tk, COLS[ci - 1].key, null, 'after')}>‹</button>
                      <button disabled={ci === COLS.length - 1} aria-label={t('다음 칸으로')} onClick={() => place(tk, COLS[ci + 1].key, null, 'after')}>›</button>
                    </span>
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}
