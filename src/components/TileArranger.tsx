// 내 업무 "화면 편집": 타일을 한 줄씩 늘어놓고 끌어서 순서를 바꾼다.
// - 오른쪽 손잡이(⋮⋮)를 바로 끌거나, 터치에서는 줄 아무 데나 꾹 눌렀다(0.35초) 끌어도 된다.
// - 왼쪽 스위치로 보이기/숨기기, 오른쪽 선택으로 처음 보일 줄 수. 숨긴 타일도 같은 목록에 흐리게 보인다.
// 끄는 동안은 목록만 미리 바꿔 보여 주고, 손을 뗄 때 한 번에 저장한다.
import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { LIMIT_CHOICES, type ResolvedTile } from '../lib/tiles'
import { Select } from './Select'

const ROW_H = 56
const HOLD_MS = 350

export interface ArrangeRow extends ResolvedTile {
  title: string
  limitable: boolean
  custom: boolean
}

const LIMIT_LABEL = (n: number) => (n === 0 ? t('모두') : t('{n}줄', { n }))

export function TileArranger({ rows, onOrder, onHidden, onLimit, onCondition }: {
  rows: ArrangeRow[]
  onOrder(ids: string[]): void
  onHidden(id: string, hidden: boolean): void
  onLimit(id: string, n: number): void
  onCondition(id: string): void
}) {
  const [live, setLive] = useState<string[] | null>(null) // 끄는 중의 임시 순서
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null)
  const st = useRef<{ id: string; startY: number; startIdx: number; order: string[]; timer?: number; active: boolean; pid: number } | null>(null)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const order = live ?? rows.map((r) => r.id)

  // 끄는 중에는 화면이 스크롤되지 않게 (터치)
  useEffect(() => {
    const block = (e: TouchEvent) => { if (st.current?.active) e.preventDefault() }
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [])

  const begin = (id: string, e: React.PointerEvent, immediate: boolean) => {
    if (e.button !== undefined && e.button > 0) return
    const base = rows.map((r) => r.id)
    const s = { id, startY: e.clientY, startIdx: base.indexOf(id), order: base, active: false, pid: e.pointerId } as NonNullable<typeof st.current>
    st.current = s
    const el = e.currentTarget as HTMLElement
    const go = () => {
      s.active = true
      try { el.setPointerCapture(s.pid) } catch { /* 이미 끝난 포인터 */ }
      setLive(s.order)
      setDrag({ id, dy: 0 })
      navigator.vibrate?.(8)
    }
    if (immediate) go()
    else s.timer = window.setTimeout(go, HOLD_MS)
  }

  const move = (e: React.PointerEvent) => {
    const s = st.current
    if (!s) return
    if (!s.active) {
      // 꾹 누르기 전에 많이 움직였으면 스크롤 의도로 보고 취소
      if (Math.abs(e.clientY - s.startY) > 8) { window.clearTimeout(s.timer); st.current = null }
      return
    }
    const dy = e.clientY - s.startY
    // 현재 자리 = 시작 자리 + 움직인 칸 수
    const idx = Math.max(0, Math.min(s.order.length - 1, s.startIdx + Math.round(dy / ROW_H)))
    const next = s.order.filter((x) => x !== s.id)
    next.splice(idx, 0, s.id)
    const cur = live ?? s.order
    if (next.join('|') !== cur.join('|')) setLive(next)
    setDrag({ id: s.id, dy: dy - (idx - s.startIdx) * ROW_H })
  }

  const end = () => {
    const s = st.current
    if (!s) return
    window.clearTimeout(s.timer)
    st.current = null
    if (s.active && live && live.join('|') !== s.order.join('|')) onOrder(live)
    setLive(null)
    setDrag(null)
  }

  return (
    <div className="arr" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {order.map((id) => {
        const r = byId.get(id)
        if (!r) return null
        const dragging = drag?.id === id
        return (
          <div
            key={id}
            className={`arr-row${r.hidden ? ' off' : ''}${dragging ? ' drag' : ''}`}
            style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('.arr-handle')) return
              if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('button, .sel-btn, [role=switch]')) begin(id, e, false)
            }}
          >
            <button className={`arr-switch${r.hidden ? '' : ' on'}`} role="switch" aria-checked={!r.hidden} aria-label={t('보이기')} onClick={() => onHidden(id, !r.hidden)}><i /></button>
            <span className="arr-name">{r.title}</span>
            <span className="arr-ctl">
              {r.custom && <button className="wrk-tilebtn" onClick={() => onCondition(id)}>{t('조건')}</button>}
              {r.limitable && !r.hidden && (
                <Select<string>
                  value={String(r.limit)}
                  title={t('처음 보일 줄 수')}
                  ariaLabel={t('처음 보일 줄 수')}
                  className="wrk-limitsel"
                  options={LIMIT_CHOICES.map((n) => ({ value: String(n), label: LIMIT_LABEL(n) }))}
                  onChange={(v) => onLimit(id, Number(v))}
                />
              )}
            </span>
            <span
              className="arr-handle"
              role="button"
              aria-label={t('끌어서 순서 바꾸기')}
              title={t('끌어서 순서 바꾸기')}
              onPointerDown={(e) => { e.preventDefault(); begin(id, e, true) }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
            </span>
          </div>
        )
      })}
    </div>
  )
}
