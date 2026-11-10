// 모바일 메모 탭: 폴더·노트 목록(한 번에 한 폴더) + 오른쪽 아래 [쓰기] + 꾹 눌러 여러 개 선택(이동·꺼내기·이름 바꾸기·삭제).
// 폴더는 노트 경로에서 생긴다. 계획 계산은 lib/folderOps.ts(순수), 쓰기는 app.moveNotes/deleteNotes.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { ask, confirmAsk } from '../lib/dialog'
import { allFolders, cleanName, dirOf, listDir, newMemoPath, planDelete, planMove, planRenameFolder, projectsIn, protectedFolder, untitledCleanup, type MemoNote } from '../lib/folderOps'
import { renameNoteDialog } from '../lib/noteActions'
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

const when = (ms: number) => {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}`
}

function Row({ k, selecting, selected, onOpen, onSelect, children }: { k: string; selecting: boolean; selected: boolean; onOpen(): void; onSelect(): void; children: ReactNode }) {
  const lp = useLongPress(onSelect)
  return (
    <button key={k} className={`memo-row${selected ? ' sel' : ''}`} onClick={() => (selecting ? onSelect() : onOpen())} {...lp}>
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
  const app = useApp.getState()

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
    const plan = planMove(useApp.getState().files, picked.notes, picked.folders, dest)
    if (plan.error === 'intoSelf') return app.say(t('폴더를 자기 안으로는 옮길 수 없어요'))
    if (plan.moves.length) app.moveNotes(plan.moves)
    setMoving(false)
    exit()
  }

  const crumbs = dir ? dir.split('/') : []
  const root = !dir
  const marked = root ? bookmarks.filter((p) => files[p] && !files[p].deleted) : []
  const noteRow = (n: MemoNote) => (
    <Row key={'n:' + n.path} k={n.path} selecting={!!sel} selected={!!sel?.has(key('n', n.path))} onOpen={() => app.openNote(n.path)} onSelect={() => begin(key('n', n.path))}>
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
              <button className="icon-btn" onClick={() => app.openDaily()} aria-label={t('오늘의 노트')}><Icon name="calendar" /></button>
              <button className="icon-btn" onClick={() => openNewFolder()} aria-label={t('새 폴더')}><Icon name="folder" /></button>
              <button className="icon-btn" onClick={() => void importFromPicker()} aria-label={t('md 파일 가져오기')}><Icon name="import" /></button>
              {sync}
            </div>
          </>
        )}
      </div>

      <div className="memo-scroll">
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
              <Row key={'d:' + f.path} k={f.path} selecting={!!sel} selected={!!sel?.has(key('d', f.path))} onOpen={() => useMemoUi.setState({ dir: f.path })} onSelect={() => begin(key('d', f.path))}>
                <span className="memo-ico"><Icon name="folder" size={20} /></span>
                <span className="memo-main"><b className="memo-title">{f.name}</b></span>
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
