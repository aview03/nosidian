import { t } from '../lib/i18n'
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react'
import { useApp } from '../lib/app'
import { renameNoteDialog, deleteNoteDialog, copyNoteLink, showInGraph } from '../lib/noteActions'

interface Menu { path: string; x: number; y: number }

/** 파일 목록 행에 붙이는 메뉴: PC 는 우클릭, 모바일은 길게 누르기 */
export function useNoteMenu() {
  const [menu, setMenu] = useState<Menu | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const start = useRef({ x: 0, y: 0 })
  const suppressClick = useRef(0)

  const bind = (path: string) => ({
    onContextMenu: (e: RMouseEvent) => {
      e.preventDefault()
      clearTimeout(timer.current)
      suppressClick.current = Date.now()
      setMenu({ path, x: e.clientX, y: e.clientY })
    },
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType === 'mouse') return
      start.current = { x: e.clientX, y: e.clientY }
      const { clientX: x, clientY: y } = e
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        suppressClick.current = Date.now()
        navigator.vibrate?.(15)
        setMenu({ path, x, y })
      }, 450)
    },
    onPointerMove: (e: RPointerEvent) => {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clearTimeout(timer.current)
    },
    onPointerUp: () => clearTimeout(timer.current),
    onPointerCancel: () => clearTimeout(timer.current),
    /** 메뉴가 열린 직후의 클릭은 노트 열기로 이어지지 않게 한다 */
    onClickCapture: (e: RMouseEvent) => {
      if (Date.now() - suppressClick.current < 700) {
        e.stopPropagation()
        e.preventDefault()
      }
    },
  })

  return { bind, menu, close: () => setMenu(null) }
}

export function NoteContextMenu({ menu, close }: { menu: Menu | null; close(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const marked = useApp((s) => (menu ? s.settings.bookmarks.includes(menu.path) : false))
  const [pos, setPos] = useState({ left: 0, top: 0 })

  // 화면 밖으로 나가지 않게 위치 보정
  useEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu, close])

  if (!menu) return null
  const app = useApp.getState()
  const p = menu.path
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <div className="ctx-menu menu-pop" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      <button onClick={run(() => app.toggleBookmark(p))}>{marked ? t('★ 북마크 해제') : t('☆ 북마크')}</button>
      <button onClick={run(() => void renameNoteDialog(p))}>{t('이름 바꾸기')}</button>
      <button onClick={run(() => showInGraph(p))}>{t('그래프에서 보기')}</button>
      <button onClick={run(() => copyNoteLink(p))}>{t('링크 복사')}</button>
      <button className="danger" onClick={run(() => void deleteNoteDialog(p))}>{t('삭제')}</button>
    </div>
  )
}
