// 앱 전용 선택 상자: 기본 <select> 대신 쓴다. 넓은 화면에서는 버튼 아래(또는 위)에 목록이 뜨고, 좁은 화면(모바일)에서는 아래에서 올라오는 시트로 뜬다.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../lib/i18n'
import { Icon } from './Icon'

export interface Option<V extends string = string> {
  value: V
  label: string
  /** 라벨 옆의 흐린 보조 글 */
  hint?: string
  /** 목록에서 이 항목 위에 보일 묶음 제목(앞 항목과 같으면 한 번만 보인다) */
  group?: string
  /** 고를 수 없는 항목(흐리게 보이고 키보드로도 건너뛴다) */
  disabled?: boolean
  /** 닫힌 버튼에 보일 글(없으면 label). 묶음 제목이 있는 목록에서 "묶음 · 항목"처럼 보이게 할 때 쓴다 */
  buttonLabel?: string
}

/** 키보드로 다음(+1)/이전(-1) 고를 수 있는 항목. 끝이면 그대로 */
export function stepActive(options: { disabled?: boolean }[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i
  return from
}

interface Props<V extends string> {
  value: V
  options: Option<V>[]
  onChange(v: V): void
  /** 값이 비었거나 없는 값일 때 버튼에 보일 글 */
  placeholder?: string
  /** 목록 위쪽 제목(모바일 시트에서 보임) */
  title?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function Select<V extends string>({ value, options, onChange, placeholder, title, disabled, className = '', ariaLabel }: Props<V>) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; max: number } | null>(null)
  const [active, setActive] = useState(0)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const sheet = typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches
  const cur = options.find((o) => o.value === value)

  const show = () => {
    if (disabled) return
    const at = options.findIndex((o) => o.value === value)
    setActive(at >= 0 ? at : Math.max(0, options.findIndex((o) => !o.disabled)))
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    btn.current?.focus()
  }
  const pick = (o: Option<V>) => {
    onChange(o.value)
    setOpen(false)
    btn.current?.focus()
  }

  // 넓은 화면: 버튼 바로 아래, 공간이 모자라면 위쪽에
  useLayoutEffect(() => {
    if (!open || sheet || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const up = below < 220 && above > below
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 220) - 8)), width: Math.max(r.width, 220), max: Math.min(320, up ? above : below), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) })
  }, [open, sheet])

  useEffect(() => {
    if (!open) return
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => stepActive(options, a, 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => stepActive(options, a, -1)) }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (options[active] && !options[active].disabled) pick(options[active]) }
    }
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [open, active, options])

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const items = (
    <div className="sel-list" ref={list} role="listbox" aria-label={ariaLabel ?? title}>
      {options.map((o, i) => (
        <Fragment key={o.value}>
          {o.group && o.group !== options[i - 1]?.group && <div className="sel-group" role="presentation">{o.group}</div>}
          <button role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined} data-active={i === active} className={`sel-opt${o.value === value ? ' on' : ''}${i === active ? ' hl' : ''}${o.disabled ? ' off' : ''}${o.group ? ' grouped' : ''}`} onMouseEnter={() => !o.disabled && setActive(i)} onClick={() => !o.disabled && pick(o)}>
            <span className="sel-label">{o.label}</span>
            {o.hint && <small>{o.hint}</small>}
            {o.value === value && <Icon name="check" />}
          </button>
        </Fragment>
      ))}
    </div>
  )

  return (
    <>
      <button ref={btn} type="button" className={`sel-btn ${className}${cur ? '' : ' sel-empty'}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => (open ? close() : show())}>
        <span className="sel-label">{cur?.buttonLabel ?? cur?.label ?? placeholder ?? ''}</span>
        <Icon name="chevron-down" />
      </button>
      {open && createPortal(
        <div className={sheet ? 'sel-wrap sheet-mode' : 'sel-wrap'} onClick={close}>
          {sheet ? (
            <div className="sel-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-grip" />
              {title && <h4 className="sel-title">{title}</h4>}
              {items}
              <button className="sel-cancel" onClick={close}>{t('취소')}</button>
            </div>
          ) : (
            <div className="sel-pop" style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.max } : { visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
              {items}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
