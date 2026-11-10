// 모바일 메모 탭: 폴더·노트 목록(한 번에 한 폴더) + 오른쪽 아래 [쓰기] + 꾹 눌러 여러 개 선택(이동·꺼내기·이름 바꾸기·삭제).
// 폴더는 노트 경로에서 생긴다. 계획 계산은 lib/folderOps.ts(순수), 쓰기는 app.moveNotes/deleteNotes.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { ask, confirmAsk } from '../lib/dialog'
import { allFolders, cleanName, dirOf, listDir, newMemoPath, planDelete, planMove, planRenameFolder, projectsIn, protectedFolder, untitledCleanup, type MemoNote } from '../lib/folderOps'
import { renameNoteDialog } from '../lib/noteActions'
import { checkMove, dailyOf, isProjectsRoot, newNoteIn, overviewNote, placeMessage, projectsWithoutOverview, strayInDaily } from '../lib/folderRules'
import { useWorkUi } from '../lib/workOps'
import { desktop } from '../lib/externalIO'
import { useAiThread } from '../lib/aiThread'
import { getLang } from '../lib/i18n'
import { importFromPicker } from '../lib/importFiles'
import { Icon } from './Icon'
import { openNewFolder } from './NewNote'
import { useActiveVault } from './VaultSheet'

/** 메모 탭 상태: 지금 보는 폴더와 선택 모드(안드로이드 뒤로가기가 먼저 이걸 되돌린다) */
interface MemoUi { dir: string; sel: Set<string> | null }
export const useMemoUi = create<MemoUi>(() => ({ dir: '', sel: null }))

/** 뒤로가기: 선택 모드면 선택 해제, 폴더 안이면 한 단계 위로. 처리했으면 true */
export function memoBack(): boolean {
  const { dir, sel } = useMemoUi.getState()
  if (sel) { useMemoUi.setState({ sel: null }); return true }
  if (dir) { useMemoUi.setState({ dir: dirOf(dir) }); return true }
  return false
}

const key = (kind: 'n' | 'd', path: string) => `${kind}:${path}`
const split = (sel: Set<string>) => ({
  notes: [...sel].filter((k) => k.startsWith('n:')).map((k) => k.slice(2)),
  folders: [...sel].filter((k) => k.startsWith('d:')).map((k) => k.slice(2)),
})

/** 꾹 누르기: 0.45초 누르고 있으면 onLong. 이어지는 클릭은 막는다 */
export function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const start = useRef({ x: 0, y: 0 })
  const fired = useRef(0)
  return {
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { fired.current = Date.now(); navigator.vibrate?.(15); onLong() }, 450)
    },
    onPointerMove: (e: RPointerEvent) => { if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clearTimeout(timer.current) },
    onPointerUp: () => clearTimeout(timer.current),
    onPointerCancel: () => clearTimeout(timer.current),
    // 손가락으로 꾹 누르면 우리 타이머가 먼저 선택하고 곧이어 브라우저의 contextmenu 도 온다 — 이때 또 선택하면 방금 선택이 취소돼 선택 모드가 꺼져 버린다. 마우스 우클릭만 선택으로 본다
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      if (Date.now() - fired.current < 1500) return
      clearTimeout(timer.current)
      fired.current = Date.now()
      onLong()
    },
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() - fired.current < 700) { e.stopPropagation(); e.preventDefault() } },
  }
}

/** 끌어서 옮기는 동안 화면 스크롤을 막는다(터치) */
let blockScroll = false

export interface RowGesture {
  selecting: boolean
  selected: boolean
  /** 꾹 눌러 선택 모드로 들어가며 이 행을 선택 */
  onLong(): void
  onDragStart(x: number, y: number): void
  onDragMove(x: number, y: number): void
  /** 손을 뗐다 */
  onDrop(): void
  onDragCancel(): void
}

/**
 * 목록 행의 손짓: 꾹 눌러 선택 → 그대로 끌면 선택한 항목을 끌어 옮긴다(폴더 위에서 놓기).
 * 이미 선택된 행은 0.25초 꾹 누른 뒤 끌면 된다(그냥 끌면 목록이 스크롤된다). 마우스는 선택된 행을 바로 끌 수 있다.
 */
export function useRowGesture(g: RowGesture) {
  const gr = useRef(g)
  gr.current = g
  const st = useRef({ down: false, armed: false, dragging: false, x0: 0, y0: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined, fired: 0, pid: 0 })
  const reset = () => {
    clearTimeout(st.current.timer)
    st.current.down = st.current.armed = st.current.dragging = false
    blockScroll = false
  }
  return {
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const s0 = st.current
      clearTimeout(s0.timer)
      s0.down = true
      s0.armed = s0.dragging = false
      s0.x0 = e.clientX
      s0.y0 = e.clientY
      s0.pid = e.pointerId
      if (!gr.current.selecting) {
        s0.timer = setTimeout(() => { s0.armed = true; s0.fired = Date.now(); blockScroll = true; navigator.vibrate?.(15); gr.current.onLong() }, 450)
      } else if (gr.current.selected) {
        if (e.pointerType === 'mouse') s0.armed = true
        else s0.timer = setTimeout(() => { s0.armed = true; s0.fired = Date.now(); blockScroll = true; navigator.vibrate?.(10) }, 250)
      }
    },
    onPointerMove: (e: RPointerEvent) => {
      const s0 = st.current
      if (!s0.down) return
      const dist = Math.hypot(e.clientX - s0.x0, e.clientY - s0.y0)
      if (!s0.armed) {
        if (dist > 10) reset() // 스크롤하려는 손짓
        return
      }
      if (!s0.dragging) {
        if (dist < 8) return
        s0.dragging = true
        try { (e.currentTarget as HTMLElement).setPointerCapture(s0.pid) } catch { /* 이미 끝난 포인터 */ }
        gr.current.onDragStart(e.clientX, e.clientY)
      }
      gr.current.onDragMove(e.clientX, e.clientY)
    },
    onPointerUp: () => {
      const s0 = st.current
      const was = s0.dragging
      if (was) s0.fired = Date.now()
      reset()
      if (was) gr.current.onDrop()
    },
    onPointerCancel: () => {
      const was = st.current.dragging
      reset()
      if (was) gr.current.onDragCancel()
    },
    // 손가락으로 꾹 누르면 우리 타이머가 먼저 처리하고 곧이어 브라우저의 contextmenu 도 온다 — 마우스 우클릭만 선택으로 본다
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      const s0 = st.current
      if (s0.down || Date.now() - s0.fired < 1500) return
      s0.fired = Date.now()
      if (!gr.current.selecting) gr.current.onLong()
    },
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() - st.current.fired < 700) { e.stopPropagation(); e.preventDefault() } },
  }
}

const when = (ms: number) => {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}`
}

interface DragApi { start(x: number, y: number): void; move(x: number, y: number): void; drop(): void; cancel(): void }

function Row({ k, selecting, selected, onOpen, onSelect, drag, drop, over, children }: { k: string; selecting: boolean; selected: boolean; onOpen(): void; onSelect(): void; drag: DragApi; /** 이 행에 놓을 수 있으면 목적지 */ drop?: string; over?: boolean; children: ReactNode }) {
  const gesture = useRowGesture({ selecting, selected, onLong: onSelect, onDragStart: drag.start, onDragMove: drag.move, onDrop: drag.drop, onDragCancel: drag.cancel })
  return (
    <button key={k} className={`memo-row${selected ? ' sel' : ''}${over ? ' drop-on' : ''}`} data-drop={drop} onClick={() => (selecting ? onSelect() : onOpen())} {...gesture}>
      {selecting && <span className={`memo-check${selected ? ' on' : ''}`} aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>}
      {children}
    </button>
  )
}

export function MemoTab({ sync }: { sync?: ReactNode }) {
  const files = useApp((s) => s.files)
  const bookmarks = useApp((s) => s.settings.bookmarks)
  const dir = useMemoUi((s) => s.dir)
  const sel = useMemoUi((s) => s.sel)
  const vault = useActiveVault()
  const [moving, setMoving] = useState(false)
  /** 끌어 옮기는 중: 손가락 위치와 지금 올라가 있는 목적지(폴더 행 또는 위로) */
  const [dragging, setDragging] = useState<{ x: number; y: number; over: string | null } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const scroller = useRef<HTMLDivElement>(null)
  const app = useApp.getState()
  const daily = dailyOf(useApp((s) => s.settings.dailyFolder))

  // 폴더가 사라졌으면(안의 노트를 모두 옮기거나 지움) 위로 올라간다
  const { folders, notes } = listDir(files, dir)
  useEffect(() => {
    if (dir && folders.length === 0 && notes.length === 0) useMemoUi.setState({ dir: dirOf(dir) })
  }, [dir, folders.length, notes.length])

  // [쓰기]로 만든 "새 메모"는 이름을 따로 정하지 않으므로 목록으로 돌아오면 첫 줄을 이름으로 하고, 비었으면 지운다
  useEffect(() => {
    const r = untitledCleanup(files, null)
    if (r.remove.length) useApp.getState().deleteNotes(r.remove, { silent: true })
    if (r.rename.length) useApp.getState().moveNotes(r.rename, { silent: true })
  }, [files])

  const exit = () => useMemoUi.setState({ sel: null })
  const toggle = (k: string) => {
    const next = new Set(sel ?? [])
    if (next.has(k)) next.delete(k)
    else next.add(k)
    useMemoUi.setState({ sel: next.size ? next : null })
  }
  const begin = (k: string) => { if (!sel) useMemoUi.setState({ sel: new Set([k]) }); else toggle(k) }
  const allKeys = [...folders.map((f) => key('d', f.path)), ...notes.map((n) => key('n', n.path))]
  const picked = sel ? split(sel) : { notes: [], folders: [] }
  const one = sel?.size === 1

  const write = () => {
    // 날짜 노트 폴더에서는 오늘 노트로, 프로젝트 폴더 바로 아래에서는 새 프로젝트로 — 자유 이름의 노트를 만들지 않는다
    const rule = newNoteIn(dir, { daily })
    if (rule === 'today') return app.openDaily()
    if (rule === 'wizard') return void useWorkUi.setState({ wizard: true })
    const p = newMemoPath(files, dir)
    app.createNote(p, '', true) // 이름은 나중에 첫 줄로 정해진다
  }
  /** 앱이 쓰는 폴더(프로젝트·일정·규칙)는 지우거나 이름을 바꾸거나 옮기지 못한다. 막았으면 true */
  const guarded = () => {
    const daily = useApp.getState().settings.dailyFolder
    const hit = picked.folders.find((f) => protectedFolder(f, daily))
    if (!hit) return false
    const kind = protectedFolder(hit, daily)
    app.say(kind === 'projects' ? t('"{name}" 폴더는 모든 프로젝트가 들어 있어서 지우거나 바꿀 수 없어요. 프로젝트 폴더는 안에서 하나씩 지울 수 있어요.', { name: hit }) : kind === 'daily' ? t('"{name}" 폴더는 날짜별 노트(일정)가 들어 있어서 지우거나 바꿀 수 없어요. 노트는 안에서 하나씩 지울 수 있어요.', { name: hit }) : t('"{name}" 폴더는 앱이 쓰는 폴더라 지우거나 바꿀 수 없어요.', { name: hit }))
    return true
  }
  const rename = async () => {
    if (!one || guarded()) return
    if (picked.notes.length) await renameNoteDialog(picked.notes[0])
    else {
      const f = picked.folders[0]
      const name = await ask(t('폴더 이름 바꾸기'), f.slice(f.lastIndexOf('/') + 1), undefined, t('변경'))
      if (name === null) return
      const plan = planRenameFolder(useApp.getState().files, f, name)
      if (plan.error === 'exists') return app.say(t('같은 이름의 폴더가 이미 있어요'))
      if (plan.error) return app.say(t('이름을 확인해 주세요'))
      if (plan.moves.length) app.moveNotes(plan.moves, { silent: true })
      app.say(t('폴더 이름을 바꿨어요'))
    }
    exit()
  }
  const remove = async () => {
    if (guarded()) return
    const plan = planDelete(files, picked.notes, picked.folders)
    if (!plan.paths.length) return
    const projects = picked.folders.reduce((n, f) => n + projectsIn(files, f), 0)
    const msg = projects ? t('프로젝트 {p}개를 포함해 노트 {n}개가 모두 지워져요. 되돌릴 수 없고, 동기화하면 원격에서도 삭제돼요.', { p: projects, n: plan.paths.length }) : plan.inFolders ? t('폴더 안의 노트 {n}개도 함께 지워져요. 동기화하면 원격에서도 삭제됩니다.', { n: plan.inFolders }) : t('동기화하면 원격에서도 삭제됩니다.')
    const title = projects ? t('프로젝트가 들어 있는 폴더예요. 정말 삭제할까요?') : plan.paths.length === 1 && !picked.folders.length ? t('이 메모를 삭제할까요?') : t('{n}개를 삭제할까요?', { n: plan.paths.length })
    if (await confirmAsk(title, msg, t('삭제'), true)) {
      app.deleteNotes(plan.paths)
      exit()
    }
  }
  const moveTo = (dest: string) => {
    if (guarded()) return setMoving(false)
    const bad = checkMove(picked.notes, picked.folders, dest, { daily })
    if (bad) return app.say(placeMessage(bad, dest))
    const plan = planMove(useApp.getState().files, picked.notes, picked.folders, dest)
    if (plan.error === 'intoSelf') return app.say(t('폴더를 자기 안으로는 옮길 수 없어요'))
    if (plan.moves.length) app.moveNotes(plan.moves)
    setMoving(false)
    exit()
  }

  // 끌어서 옮기기: 손가락 아래의 폴더 행(또는 "위로")이 목적지
  const dropAt = (x: number, y: number): string | null => document.elementFromPoint(x, y)?.closest('[data-drop]')?.getAttribute('data-drop') ?? null
  const drag: DragApi = {
    start: (x, y) => { pointer.current = { x, y }; setDragging({ x, y, over: dropAt(x, y) }) },
    move: (x, y) => { pointer.current = { x, y }; setDragging({ x, y, over: dropAt(x, y) }) },
    drop: () => {
      const over = dragging?.over
      setDragging(null)
      if (over === 'up') return moveTo(dirOf(dir))
      if (over?.startsWith('d:')) moveTo(over.slice(2))
    },
    cancel: () => setDragging(null),
  }
  // 끄는 동안 목록 위·아래 가장자리에 가면 스크롤한다
  useEffect(() => {
    if (!dragging) return
    const id = setInterval(() => {
      const el = scroller.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const y = pointer.current.y
      if (y < r.top + 70) el.scrollTop -= 10
      else if (y > r.bottom - 70) el.scrollTop += 10
    }, 16)
    return () => clearInterval(id)
  }, [!!dragging])
  useEffect(() => {
    const block = (e: TouchEvent) => { if (blockScroll) e.preventDefault() }
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [])

  const crumbs = dir ? dir.split('/') : []
  // 날짜 노트 폴더에 날짜 이름이 아닌 노트가 있으면(동기화·가져오기) 정리하도록 안내한다
  const stray = (!dir || dir === daily) ? strayInDaily(files, { daily }) : []
  const noOverview = isProjectsRoot(dir) ? new Set(projectsWithoutOverview(files, dir)) : null
  const cleanStray = () => {
    useMemoUi.setState({ dir: daily, sel: new Set(stray.map((p) => key('n', p))) })
    setMoving(true)
  }
  const root = !dir
  const marked = root ? bookmarks.filter((p) => files[p] && !files[p].deleted) : []
  const noteRow = (n: MemoNote) => (
    <Row key={'n:' + n.path} k={n.path} selecting={!!sel} selected={!!sel?.has(key('n', n.path))} onOpen={() => app.openNote(n.path)} onSelect={() => begin(key('n', n.path))} drag={drag}>
      <span className="memo-main">
        <b className="memo-title">{n.title || t('내용 없음')}</b>
        {n.snippet && <span className="memo-snip">{n.snippet}</span>}
      </span>
      <span className="memo-date">{when(n.mtime)}</span>
    </Row>
  )

  return (
    <div className="memo">
      <div className="panel-head memo-head">
        {sel ? (
          <>
            <button className="icon-btn" onClick={exit} aria-label={t('선택 취소')}><Icon name="close" /></button>
            <h2 className="memo-count">{t('{n}개 선택', { n: sel.size })}</h2>
            {dir && <button className={`memo-up${dragging?.over === 'up' ? ' drop-on' : ''}`} data-drop="up" onClick={() => moveTo(dirOf(dir))}>{t('위 폴더로 꺼내기')}</button>}
            <button className="link-btn memo-all" onClick={() => useMemoUi.setState({ sel: new Set(sel.size === allKeys.length ? [] : allKeys) })}>{sel.size === allKeys.length ? t('선택 해제') : t('전체 선택')}</button>
          </>
        ) : (
          <>
            {dir && <button className="icon-btn" onClick={() => useMemoUi.setState({ dir: dirOf(dir) })} aria-label={t('위 폴더로')}><Icon name="back" /></button>}
            <h2 className="vault-title memo-title-h">
              {dir ? (
                <span className="memo-crumb">{crumbs.map((c, i) => <button key={i} className="memo-crumb-btn" onClick={() => useMemoUi.setState({ dir: crumbs.slice(0, i + 1).join('/') })}>{c}</button>)}</span>
              ) : (
                <button className="vault-btn" onClick={() => app.setVaultSheet(true)} aria-label={t('vault 전환')} title={vault?.name}>
                  <span className="vault-name">{t('메모')}</span>
                  <span className="vault-caret"><Icon name="chevron" size={14} /></span>
                </button>
              )}
            </h2>
            <div className="head-actions">
              {!desktop() && <button className="icon-btn" onClick={() => useAiThread.getState().toggle()} aria-label={t('AI')}><Icon name="spark" /></button>}
              <button className="icon-btn" onClick={() => app.openDaily()} aria-label={t('오늘의 노트')}><Icon name="calendar" /></button>
              <button className="icon-btn" onClick={() => openNewFolder()} aria-label={t('새 폴더')}><Icon name="folder" /></button>
              <button className="icon-btn" onClick={() => void importFromPicker()} aria-label={t('md 파일 가져오기')}><Icon name="import" /></button>
              {sync}
            </div>
          </>
        )}
      </div>

      <div className="memo-scroll" ref={scroller}>
        {stray.length > 0 && !sel && (
          <div className="memo-warn">
            <span>{t('날짜 이름이 아닌 노트 {n}개가 "{name}" 폴더에 있어요', { n: stray.length, name: daily })}</span>
            <button onClick={cleanStray}>{t('옮기기')}</button>
          </div>
        )}
        {marked.length > 0 && !sel && (
          <section>
            <h3 className="memo-sec">{t('★ 북마크')}</h3>
            {marked.map((p) => (
              <button key={p} className="memo-row" onClick={() => app.openNote(p)}>
                <span className="memo-main"><b className="memo-title">{p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '')}</b></span>
              </button>
            ))}
          </section>
        )}
        {folders.length > 0 && (
          <section>
            {marked.length > 0 && !sel && <h3 className="memo-sec">{t('폴더')}</h3>}
            {folders.map((f) => (
              <Row key={'d:' + f.path} k={f.path} selecting={!!sel} selected={!!sel?.has(key('d', f.path))} onOpen={() => useMemoUi.setState({ dir: f.path })} onSelect={() => begin(key('d', f.path))} drag={drag} drop={sel && !sel.has(key('d', f.path)) ? 'd:' + f.path : undefined} over={dragging?.over === 'd:' + f.path}>
                <span className="memo-ico"><Icon name="folder" size={20} /></span>
                <span className="memo-main"><b className="memo-title">{f.name}</b>{noOverview?.has(f.path) && <span className="memo-snip warn">{t('프로젝트 개요 노트가 없어요')}</span>}</span>
                {noOverview?.has(f.path) && !sel && <span className="memo-chip" role="button" onClick={(e) => { e.stopPropagation(); const o = overviewNote(f.path, getLang() === 'ko'); app.createNote(o.path, o.content, false); app.say(t('프로젝트 개요 노트를 만들었어요')) }}>{t('개요 만들기')}</span>}
                <span className="memo-date">{f.count}</span>
                {!sel && <span className="memo-chev"><Icon name="chevron" size={14} /></span>}
              </Row>
            ))}
          </section>
        )}
        {notes.length > 0 && (
          <section>
            {(folders.length > 0 || marked.length > 0) && !sel && <h3 className="memo-sec">{t('메모')}</h3>}
            {notes.map(noteRow)}
          </section>
        )}
        {folders.length === 0 && notes.length === 0 && (
          <div className="memo-empty">
            <p>{t('아직 메모가 없어요')}</p>
            <small>{t('오른쪽 아래 버튼으로 바로 써 보세요')}</small>
          </div>
        )}
        <div className="memo-bottom-space" />
      </div>

      {dragging && <div className="memo-ghost" style={{ left: dragging.x, top: dragging.y }}>{t('{n}개 옮기기', { n: sel?.size ?? 0 })}</div>}

      {!sel && (
        <button className="memo-fab" onClick={write} aria-label={t('새 메모 쓰기')}><Icon name="edit" size={24} /></button>
      )}

      {sel && (
        <div className="memo-bar" role="toolbar" aria-label={t('선택한 항목')}>
          <button onClick={() => setMoving(true)}>{t('이동')}</button>
          <button disabled={!one} onClick={() => void rename()}>{t('이름 바꾸기')}</button>
          <button className="danger" onClick={() => void remove()}>{t('삭제')}</button>
        </div>
      )}

      {moving && <MoveSheet current={dir} folders={picked.folders} count={sel?.size ?? 0} onPick={moveTo} onClose={() => setMoving(false)} />}
    </div>
  )
}

/** 어느 폴더로 옮길지 고르는 시트 */
function MoveSheet({ current, folders, count, onPick, onClose }: { current: string; folders: string[]; count: number; onPick(dest: string): void; onClose(): void }) {
  const files = useApp((s) => s.files)
  const list = allFolders(files)
  const invalid = (d: string) => folders.some((f) => d === f || d.startsWith(f + '/'))
  const newFolder = async () => {
    const n = await ask(t('새 폴더 이름'), '', current ? t('"{dir}" 안에 만들어요', { dir: current }) : undefined, t('만들고 옮기기'))
    const name = n ? cleanName(n) : ''
    if (name) onPick(current ? `${current}/${name}` : name)
  }
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet memo-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="panel-head"><h2>{t('{n}개를 어디로 옮길까요?', { n: count })}</h2></div>
        <div className="list">
          <button className="row memo-dest" disabled={current === ''} onClick={() => onPick('')}>
            <span className="row-title">{current ? t('폴더 밖으로 꺼내기 (맨 위)') : t('맨 위')}</span>
          </button>
          {current && dirOf(current) !== '' && (
            <button className="row memo-dest" onClick={() => onPick(dirOf(current))}><span className="row-title">{t('한 단계 위로 꺼내기')}</span><span className="row-sub">{dirOf(current)}</span></button>
          )}
          {list.map((d) => {
            const depth = d.split('/').length - 1
            const bad = invalid(d) || d === current
            return (
              <button key={d} className="row memo-dest" disabled={bad} style={{ paddingLeft: 12 + depth * 16 }} onClick={() => onPick(d)}>
                <span className="row-title"><Icon name="folder" size={16} /> {d.slice(d.lastIndexOf('/') + 1)}</span>
                {depth > 0 && <span className="row-sub">{d}</span>}
              </button>
            )
          })}
        </div>
        <div className="btn-row vault-actions">
          <button className="primary" onClick={() => void newFolder()}>{t('＋ 새 폴더에 넣기')}</button>
          <button onClick={onClose}>{t('취소')}</button>
        </div>
      </div>
    </div>
  )
}
