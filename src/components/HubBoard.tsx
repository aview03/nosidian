// 프로젝트 허브 "보드"(칸반): 카드를 끌어서 다른 칸으로 옮기면 그 줄의 status 가 바뀐다.
// 정렬은 두 가지: "마감순"(기본, 마감 → 우선순위) / "직접 정렬"(노트의 목록 줄 순서 그대로). 직접 정렬에서는 카드를 다른 카드 앞/뒤로 끌어 놓으면
// 노트의 줄 순서가 바뀐다. 설계: docs/PROJECT-VIEWS.md
//
// 끌기는 브라우저의 HTML5 끌어놓기가 아니라 포인터 이벤트로 직접 구현했다(안드로이드 WebView 는 길게 눌러도 HTML5 끌기가 시작되지 않는다).
//  - 마우스·펜: 5px 이상 움직이면 바로 끌기 시작.
//  - 터치: 0.35초 길게 누르면 카드를 집는다(그 전에 손가락이 움직이면 평소처럼 스크롤). 집은 뒤에는 화면 스크롤을 막고, 가장자리에 대면 자동 스크롤.
//  - 키보드: 카드(제목 버튼)에서 Alt+↑↓ 로 순서, Alt+←→ 로 칸 이동(화면에는 화살표 버튼을 두지 않는다).
import { useEffect, useRef, useState } from 'react'
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

/** 터치로 카드를 집는 데 필요한 누름 시간(ms). 그 전에 움직여도 되는 거리(px) / 마우스로 끌기 시작하는 거리(px) / 자동 스크롤을 시작하는 가장자리 폭(px) */
export const HOLD_MS = 350
const TOUCH_SLOP = 10
const MOUSE_SLOP = 5
const EDGE = 56

interface Pending {
  id: string
  title: string
  pointerId: number
  type: string
  sx: number
  sy: number
  ox: number
  oy: number
  w: number
  x: number
  y: number
  timer: number
  started: boolean
}
interface Ghost { title: string; x: number; y: number; w: number }
interface Target { col: Col; cardId: string | null; where: 'before' | 'after' }

/** el 에서 위로 올라가며 스크롤 가능한 조상들(가로·세로 모두) */
function scrollParents(el: HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let n = el; n; n = n.parentElement) {
    const s = getComputedStyle(n)
    if (/(auto|scroll)/.test(s.overflowX + s.overflowY) && (n.scrollWidth > n.clientWidth || n.scrollHeight > n.clientHeight)) out.push(n)
  }
  return out
}

export function Board({ tasks, project }: { tasks: Task[]; project: string }) {
  const [sort, setSortState] = useState<BoardSort>(() => loadBoardSort(project))
  useEffect(() => setSortState(loadBoardSort(project)), [project])
  const setSort = (s: BoardSort) => {
    setSortState(s)
    saveBoardSort(project, s)
  }
  const manual = sort === 'manual'
  const shown = tasks.filter((x) => uiStateOf(x) !== 'dropped')
  const items = (key: Col) => shown.filter((x) => colOf(x) === key).sort(manual ? byDoc : byDue)

  /** tk 를 to 칸으로 옮기고(칸이 다르면), 직접 정렬이면 target 의 앞/뒤로 순서도 바꾼다(같은 노트일 때만). 한 번의 되돌리기로 묶는다 */
  const place = (tk: Task, to: Col, target: Task | null, where: 'before' | 'after') => {
    const colChanged = colOf(tk) !== to
    const canReorder = manual && !!target && target.id !== tk.id && target.path === tk.path
    if (!colChanged && !canReorder) {
      if (manual && target && target.id !== tk.id && target.path !== tk.path) useApp.getState().say(t('다른 노트에 있는 업무라서 이 자리로는 옮길 수 없어요'))
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

  // ── 포인터로 끌기 ──
  const root = useRef<HTMLDivElement>(null)
  const pend = useRef<Pending | null>(null)
  const raf = useRef(0)
  const justDragged = useRef(false)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [srcId, setSrcId] = useState<string | null>(null)
  // 창에 달아 둔 핸들러가 늘 최신 값을 보게 한다
  const latest = useRef({ shown, items, place })
  latest.current = { shown, items, place }

  const targetAt = (x: number, y: number, dragId: string): Target | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const col = el?.closest<HTMLElement>('.board-col')
    if (!col) return null
    const card = el!.closest<HTMLElement>('.board-card')
    if (card && card.dataset.id !== dragId) {
      const r = card.getBoundingClientRect()
      return { col: col.dataset.col as Col, cardId: card.dataset.id!, where: y < r.top + r.height / 2 ? 'before' : 'after' }
    }
    return { col: col.dataset.col as Col, cardId: null, where: 'after' }
  }

  const stopLoop = () => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = 0
  }
  const end = (drop: boolean) => {
    const p = pend.current
    pend.current = null
    if (p) window.clearTimeout(p.timer)
    stopLoop()
    document.body.classList.remove('board-dragging')
    if (p?.started) {
      justDragged.current = true
      window.setTimeout(() => (justDragged.current = false), 0)
      if (drop) {
        const tg = targetAt(p.x, p.y, p.id)
        const { shown: all, items: list, place: put } = latest.current
        const src = all.find((x) => x.id === p.id)
        if (src && tg) {
          const ref = tg.cardId ? all.find((x) => x.id === tg.cardId) ?? null : [...list(tg.col)].reverse().find((x) => x.id !== src.id) ?? null
          put(src, tg.col, ref, tg.cardId ? tg.where : 'after')
        }
      }
    }
    setGhost(null)
    setTarget(null)
    setSrcId(null)
  }

  const begin = (p: Pending) => {
    p.started = true
    setSrcId(p.id)
    setGhost({ title: p.title, x: p.x - p.ox, y: p.y - p.oy, w: p.w })
    setTarget(targetAt(p.x, p.y, p.id))
    document.body.classList.add('board-dragging')
    try {
      navigator.vibrate?.(15) // 집었다는 작은 진동(되는 기기에서만)
    } catch {
      /* 진동을 못 써도 된다 */
    }
    // 가장자리에 대고 있으면 자동 스크롤
    const scrollers = scrollParents(root.current)
    const tick = () => {
      const q = pend.current
      if (!q?.started) return
      for (const s of scrollers) {
        const r = s.getBoundingClientRect()
        if (q.x < r.left + EDGE) s.scrollLeft -= 14
        else if (q.x > r.right - EDGE) s.scrollLeft += 14
        if (q.y < r.top + EDGE) s.scrollTop -= 14
        else if (q.y > r.bottom - EDGE) s.scrollTop += 14
      }
      setTarget(targetAt(q.x, q.y, q.id))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }

  const down = (e: React.PointerEvent<HTMLElement>, tk: Task) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (pend.current) end(false)
    const r = e.currentTarget.getBoundingClientRect()
    const p: Pending = { id: tk.id, title: tk.title, pointerId: e.pointerId, type: e.pointerType, sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, x: e.clientX, y: e.clientY, timer: 0, started: false }
    pend.current = p
    if (e.pointerType !== 'mouse') p.timer = window.setTimeout(() => pend.current === p && !p.started && begin(p), HOLD_MS)
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pend.current
      if (!p || e.pointerId !== p.pointerId) return
      p.x = e.clientX
      p.y = e.clientY
      if (!p.started) {
        const d = Math.hypot(e.clientX - p.sx, e.clientY - p.sy)
        if (p.type === 'mouse') {
          if (d > MOUSE_SLOP) begin(p)
        } else if (d > TOUCH_SLOP) end(false) // 집기 전에 움직였다 = 스크롤하려는 것
        return
      }
      setGhost({ title: p.title, x: e.clientX - p.ox, y: e.clientY - p.oy, w: p.w })
      setTarget(targetAt(e.clientX, e.clientY, p.id))
    }
    const up = (e: PointerEvent) => {
      const p = pend.current
      if (p && e.pointerId === p.pointerId) end(true)
    }
    const cancel = (e: PointerEvent) => {
      const p = pend.current
      if (p && e.pointerId === p.pointerId) end(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pend.current?.started) end(false)
    }
    const noCtx = (e: Event) => {
      if (pend.current?.started) e.preventDefault()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('contextmenu', noCtx)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('contextmenu', noCtx)
      stopLoop()
      document.body.classList.remove('board-dragging')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 집은 뒤에는 손가락을 움직여도 화면이 스크롤되지 않게(터치). 처음부터 non-passive 로 달아 두어야 막을 수 있다
  useEffect(() => {
    const el = root.current
    if (!el) return
    const block = (e: TouchEvent) => {
      if (pend.current?.started && e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])

  /** 키보드: Alt+↑↓ 같은 칸 안 순서, Alt+←→ 이웃 칸으로 */
  const keyMove = (e: React.KeyboardEvent, tk: Task, list: Task[], ci: number) => {
    if (!e.altKey) return
    const i = list.findIndex((x) => x.id === tk.id)
    if (e.key === 'ArrowUp' && list[i - 1]) place(tk, colOf(tk), list[i - 1], 'before')
    else if (e.key === 'ArrowDown' && list[i + 1]) place(tk, colOf(tk), list[i + 1], 'after')
    else if (e.key === 'ArrowLeft' && COLS[ci - 1]) place(tk, COLS[ci - 1].key, null, 'after')
    else if (e.key === 'ArrowRight' && COLS[ci + 1]) place(tk, COLS[ci + 1].key, null, 'after')
    else return
    e.preventDefault()
  }

  return (
    <div ref={root}>
      <div className="board-tools">
        <span className="tool-label">{t('정렬')}</span>
        <div className="seg-mini" role="group" aria-label={t('정렬')}>
          <button aria-pressed={!manual} className={!manual ? 'on' : ''} onClick={() => setSort('due')}>{t('마감순')}</button>
          <button aria-pressed={manual} className={manual ? 'on' : ''} onClick={() => setSort('manual')}>{t('직접 정렬')}</button>
        </div>
        <span className="hint small board-sorthint">
          {manual ? `${t('카드를 끌어 순서를 바꿔요(폰은 길게 눌러서)')} · ${t('노트의 목록 순서가 바뀌어요')}` : t('카드를 끌어 다른 칸으로 옮겨요(폰은 길게 눌러서)')}
        </span>
      </div>
      <div className="board">
        {COLS.map((c, ci) => {
          const list = items(c.key)
          return (
            <section key={c.key} data-col={c.key} className={`board-col${target?.col === c.key ? ' over' : ''}`}>
              <h3>{t(c.title)}<span className="wrk-count">{list.length}</span></h3>
              {list.map((tk) => (
                <div
                  key={tk.id}
                  data-id={tk.id}
                  className={`board-card${srcId === tk.id ? ' src' : ''}${target?.cardId === tk.id && srcId !== tk.id ? ` ins-${target.where}` : ''}`}
                  onPointerDown={(e) => down(e, tk)}
                >
                  <button
                    className="board-body"
                    onKeyDown={(e) => keyMove(e, tk, list, ci)}
                    onClick={() => {
                      if (justDragged.current) return
                      useWorkUi.getState().openEditor(tk)
                    }}
                  >
                    <span className="wrk-title">{tk.kind === 'decision' && <b className="wrk-kind">{t('결정')}</b>}{tk.p === 1 && <b className="wrk-p">!</b>}{tk.title}</span>
                    <span className="wrk-meta">
                      {tk.due && <span className={!tk.done && tk.due < todayYmd() ? 'wrk-late' : 'wrk-due'}>{tk.due.slice(5)}</span>}
                      {tk.owner.length > 0 && <span className="wrk-owner">{tk.owner.join(', ')}</span>}
                    </span>
                  </button>
                </div>
              ))}
            </section>
          )
        })}
      </div>
      {ghost && <div className="board-ghost" style={{ left: ghost.x, top: ghost.y, width: ghost.w }}>{ghost.title}</div>}
    </div>
  )
}
