import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { t } from '../lib/i18n'
import { useApp } from '../lib/app'
import { editEngine, readEngine, type FindEngine } from '../lib/findEngine'
import { Icon } from './Icon'

/** 노트 안에서 문자열 찾기 (Ctrl+F). 읽기·편집 화면 모두에서 동작하고, Enter / Shift+Enter 로 결과를 넘겨 본다 */
export function FindBar({ mode, scroller, content }: { mode: 'read' | 'edit'; scroller: RefObject<HTMLDivElement | null>; content: string }) {
  const focusTick = useApp((s) => s.findFocus)
  const [q, setQ] = useState('')
  const [cs, setCs] = useState(false)
  const [res, setRes] = useState({ count: 0, index: 0 })
  const input = useRef<HTMLInputElement>(null)

  const engine: FindEngine = useMemo(
    () => (mode === 'edit' ? editEngine() : readEngine(() => scroller.current?.querySelector<HTMLElement>('.reader-wrap') ?? null)),
    [mode, scroller],
  )

  // 검색어·옵션·화면 모드가 바뀌면 다시 찾고 첫 결과로 이동. 화면 전환 직후엔 편집기/본문이 아직 없을 수 있어 조금 늦춘다
  useEffect(() => {
    const id = setTimeout(() => setRes(engine.search(q, cs, true)), 80)
    return () => clearTimeout(id)
  }, [engine, q, cs])

  // 문서 내용이 바뀌면(편집·동기화) 위치는 그대로 두고 개수만 갱신
  useEffect(() => {
    const id = setTimeout(() => setRes(engine.search(q, cs, false)), 150)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // 닫히거나 모드가 바뀌어 엔진이 교체될 때 표시를 지운다
  useEffect(() => () => engine.clear(), [engine])

  // Ctrl+F 를 다시 누르면 입력칸으로 돌아와 전체 선택
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusTick])

  const step = (dir: 1 | -1) => setRes(engine.step(dir))

  return (
    <div className="findbar" role="search">
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('문서에서 찾기…')}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            useApp.getState().closeFind()
          } else if (e.key === 'F3') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          }
        }}
      />
      <span className={`find-count${q && !res.count ? ' none' : ''}`}>{q ? (res.count ? `${res.index || '–'}/${res.count}` : t('결과 없음')) : ''}</span>
      <button className="icon-btn" disabled={!res.count} onClick={() => step(-1)} title={t('이전 결과 (Shift+Enter)')} aria-label={t('이전 결과 (Shift+Enter)')}><Icon name="chevron-up" size={18} /></button>
      <button className="icon-btn" disabled={!res.count} onClick={() => step(1)} title={t('다음 결과 (Enter)')} aria-label={t('다음 결과 (Enter)')}><Icon name="chevron-down" size={18} /></button>
      <button className={`icon-btn find-cs${cs ? ' on' : ''}`} onClick={() => setCs((v) => !v)} title={t('대소문자 구분')} aria-label={t('대소문자 구분')} aria-pressed={cs}>Aa</button>
      <button className="icon-btn" onClick={() => useApp.getState().closeFind()} title={t('닫기')} aria-label={t('닫기')}><Icon name="close" size={18} /></button>
    </div>
  )
}
