// AI 변경 제안 검토: 승인 대기 중인 제안을 전후 차이와 함께 보여 주고, 사람이 승인(반영)하거나 거절한다.
// 승인 버튼은 "허가"가 아니라 재검증 요청이다 — 그새 문서가 바뀌었으면 반영되지 않는다(lib/proposals.ts · docpolicy.ts).
import { useEffect, useMemo } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { diffHunks } from '../lib/merge'
import { isStale, type Proposal } from '../lib/proposals'
import type { Reason } from '../lib/docpolicy'
import { useProposals } from '../lib/proposalStore'
import { Icon } from './Icon'

/** 정책 판정 이유를 사람이 읽는 문장으로 */
export function reasonText(reason: Reason, text?: string): string {
  switch (reason) {
    case 'officialApprove': return t('공식 문서({role})의 변경은 승인이 필요해요', { role: text ?? '' })
    case 'newFileApprove': return t('새 문서는 승인이 필요해요')
    case 'planApprove': return t('정리 계획을 실행하는 변경은 최종 승인이 필요해요')
    case 'noRules': return t('문서 규칙이 꺼져 있어서 AI 의 자동 변경은 허용하지 않아요')
    case 'outside': return t('문서 규칙을 적용하지 않는 곳이라 AI 의 자동 변경은 허용하지 않아요')
    case 'noProfile': return t('규칙 파일에서 이 프로젝트의 프로필을 읽지 못해 AI 의 자동 변경은 허용하지 않아요')
    case 'leavesProject': return t('다른 프로젝트나 규칙 밖으로 옮기는 것은 승인이 필요해요')
    case 'stale': return t('AI 가 읽은 뒤 문서가 바뀌었어요')
    case 'exists': return t('그 자리에 이미 문서가 있어요')
    case 'missing': return t('대상 문서를 찾을 수 없어요')
    case 'readOnly': return t('규칙이 AI 의 쓰기를 허용하지 않아요 (읽기 전용)')
    case 'protected': return t('규칙 파일 등 보호된 경로예요')
    case 'singletonExists': return t('하나뿐이어야 하는 문서가 이미 있어요')
    case 'officialDelete': case 'officialMove': return t('공식 문서는 AI 가 지우거나 옮길 수 없어요')
    case 'newFileDenied': case 'notInTemplate': return t('규칙이 AI 의 새 문서를 허용하지 않아요')
    case 'noBase': return t('AI 가 문서를 읽은 기록이 없어요')
    default: return ''
  }
}

export const KIND: Record<string, string> = { create: '새 문서', modify: '수정', delete: '삭제', move: '이동' }

interface Row { sign: ' ' | '+' | '-' | '…'; text: string }

/** 줄 단위 전후 차이(바뀐 줄 주변 2줄만) */
function diffRows(before: string, after: string): Row[] | null {
  const a = before.split('\n')
  const b = after.split('\n')
  const hunks = diffHunks(a, b)
  if (hunks === null) return null
  const rows: Row[] = []
  let at = 0
  const ctx = 2
  const ctxLines = (from: number, to: number, first: boolean, last: boolean) => {
    const n = to - from
    if (n <= 0) return
    if (first && last && n > ctx * 2) { rows.push({ sign: '…', text: '' }); a.slice(to - ctx, to).forEach((x) => rows.push({ sign: ' ', text: x })); return }
    if (!first && !last && n > ctx * 2) { a.slice(from, from + ctx).forEach((x) => rows.push({ sign: ' ', text: x })); rows.push({ sign: '…', text: '' }); a.slice(to - ctx, to).forEach((x) => rows.push({ sign: ' ', text: x })); return }
    if (first && n > ctx) { rows.push({ sign: '…', text: '' }); a.slice(to - ctx, to).forEach((x) => rows.push({ sign: ' ', text: x })); return }
    if (last && n > ctx) { a.slice(from, from + ctx).forEach((x) => rows.push({ sign: ' ', text: x })); rows.push({ sign: '…', text: '' }); return }
    a.slice(from, to).forEach((x) => rows.push({ sign: ' ', text: x }))
  }
  hunks.forEach((h, i) => {
    ctxLines(at, h.s, i === 0, false)
    a.slice(h.s, h.e).forEach((x) => rows.push({ sign: '-', text: x }))
    h.lines.forEach((x) => rows.push({ sign: '+', text: x }))
    at = h.e
  })
  ctxLines(at, a.length, hunks.length === 0, true)
  return rows
}

export function Diff({ p }: { p: Proposal }) {
  const files = useApp((s) => s.files)
  const cur = files[p.req.path]?.content ?? ''
  const rows = useMemo(() => {
    if (p.req.action === 'create') return (p.req.content ?? '').split('\n').map((x): Row => ({ sign: '+', text: x }))
    if (p.req.action === 'modify') return diffRows(cur, p.req.content ?? '')
    return []
  }, [p, cur])
  if (p.req.action === 'move') return <p className="pr-move">{p.req.path} → {p.req.to}</p>
  if (p.req.action === 'delete') return <p className="pr-move">{t('삭제 대신 보관함(_보관/)으로 옮겨요')}</p>
  if (rows === null) return <p className="hint">{t('문서가 커서 차이를 계산하지 못했어요')}</p>
  if (rows.length === 0 || rows.every((r) => r.sign === ' ' || r.sign === '…')) return <p className="hint">{t('바뀌는 내용이 없어요')}</p>
  return (
    <pre className="pr-diff">
      {rows.map((r, i) => <div key={i} className={`pr-row ${r.sign === '+' ? 'add' : r.sign === '-' ? 'del' : r.sign === '…' ? 'gap' : ''}`}><b>{r.sign === '…' ? '' : r.sign}</b>{r.sign === '…' ? '⋯' : r.text || ' '}</div>)}
    </pre>
  )
}

function Item({ p }: { p: Proposal }) {
  const files = useApp((s) => s.files)
  const stale = p.status === 'pending' && isStale(p, files)
  return (
    <section className={`pr-item ${p.status}`}>
      <header>
        <b className="pr-kind">{t(KIND[p.req.action])}</b>
        <span className="pr-path">{p.req.path}</span>
        <span className="pr-by">{p.by}</span>
      </header>
      {p.summary && <p className="pr-sum">{p.summary}</p>}
      <p className="hint pr-why">{reasonText(p.reason, p.text)}</p>
      <Diff p={p} />
      {p.status === 'pending' && (
        <footer>
          {stale && <span className="pr-stale">{reasonText('stale')} — {t('승인해도 반영되지 않아요')}</span>}
          <span className="grow" />
          <button onClick={() => useProposals.getState().reject(p.id)}>{t('거절')}</button>
          <button className="primary" disabled={stale} onClick={() => useProposals.getState().approve(p.id)}>{t('승인하고 반영')}</button>
        </footer>
      )}
      {p.status !== 'pending' && (
        <p className="hint pr-done">
          {p.status === 'applied' ? t('반영했어요') : p.status === 'rejected' ? t('거절했어요') : `${t('반영하지 못했어요')}${p.failReason ? ` — ${reasonText(p.failReason)}` : ''}`}
        </p>
      )}
    </section>
  )
}

/** 내 업무 위쪽 알림 줄: 승인을 기다리는 제안이 있을 때만 */
export function ProposalBanner() {
  const items = useProposals((s) => s.items)
  useEffect(() => useProposals.getState().ensure(), [])
  const n = items.filter((p) => p.status === 'pending').length
  if (!n) return null
  return (
    <button className="pr-banner" onClick={() => useProposals.getState().setOpen(true)}>
      {t('AI 의 변경 제안 {n}건이 승인을 기다려요', { n })} <span>{t('검토')}</span>
    </button>
  )
}

export function ProposalReview() {
  const open = useProposals((s) => s.open)
  const items = useProposals((s) => s.items)
  useEffect(() => {
    if (!open) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && useProposals.getState().setOpen(false)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [open])
  if (!open) return null
  const close = () => useProposals.getState().setOpen(false)
  const pending = items.filter((p) => p.status === 'pending')
  const done = items.filter((p) => p.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
  return (
    <div className="ee-wrap" onClick={close}>
      <div className="ee pr" role="dialog" aria-label={t('AI 변경 제안')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{t('AI 변경 제안')}</h3>
          <button className="icon-btn" onClick={close} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>
        <div className="ee-body">
          <p className="hint pr-intro">{t('승인하면 반영 직전에 한 번 더 확인해요. AI 가 읽은 뒤 문서가 바뀌었다면 반영하지 않아요.')}</p>
          {pending.length === 0 && <p className="hint pad">{t('승인을 기다리는 제안이 없어요.')}</p>}
          {pending.map((p) => <Item key={p.id} p={p} />)}
          {done.length > 0 && (
            <details className="pr-donelist">
              <summary>{t('처리한 제안')} <span className="wrk-count">{done.length}</span></summary>
              {done.map((p) => <Item key={p.id} p={p} />)}
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
