// 프로젝트 허브 "표" 보기: 업무를 한 줄씩 늘어놓고, 열 머리를 눌러 정렬하고, 상태·담당·마감·우선순위를 그 자리에서 고친다.
// 폭이 좁으면(폰) 같은 줄이 두 줄짜리 카드로 바뀌고 정렬은 위의 "정렬" 상자로 한다. 설계: docs/PROJECT-VIEWS.md §4.2
import { useState } from 'react'
import { t } from '../lib/i18n'
import { todayYmd } from '../lib/calendar'
import { rowStateOf, sortTasks, type RowState, type SortDir, type SortKey } from '../lib/projectViews'
import type { Task } from '../lib/work'
import { moveTask, patchTask, toggleOrClose, useWorkUi, withUndo } from '../lib/workOps'
import { Select } from './Select'

const COLS: { key: SortKey; label: string }[] = [
  { key: 'title', label: '제목' },
  { key: 'state', label: '상태' },
  { key: 'owner', label: '담당' },
  { key: 'due', label: '마감' },
  { key: 'p', label: '우선순위' },
]
const STATE_LABEL: Record<RowState, string> = { todo: '할 일', doing: '진행 중', waiting: '대기', dropped: '취소됨', done: '완료' }
const P_LABEL: Record<string, string> = { '0': '없음', '1': '높음', '2': '보통', '3': '낮음' }
const short = (s: string) => (s.length > 18 ? s.slice(0, 18) + '…' : s)

function Row({ tk, owners }: { tk: Task; owners: string[] }) {
  const state = rowStateOf(tk)
  const late = !tk.done && state !== 'dropped' && !!tk.due && tk.due < todayYmd()
  const multi = tk.owner.length > 1
  const name = short(tk.title)
  return (
    <div role="row" className={`tbl-row${late ? ' late' : ''}${state === 'done' || state === 'dropped' ? ' fin' : ''}`}>
      <div role="cell" className="tbl-c tbl-title-c">
        <input type="checkbox" className="task" checked={tk.done} onChange={() => toggleOrClose(tk)} aria-label={tk.title} />
        <button className="tbl-title" onClick={() => useWorkUi.getState().openEditor(tk)}>
          {tk.kind === 'decision' && <b className="wrk-kind">{t('결정')}</b>}
          {tk.p === 1 && <b className="wrk-p">!</b>}
          {tk.title}
        </button>
      </div>
      <div role="cell" className="tbl-c" data-label={t('상태')}>
        <Select<RowState>
          className="tbl-sel"
          ariaLabel={t('상태')}
          title={t('상태')}
          value={state}
          options={(Object.keys(STATE_LABEL) as RowState[]).map((v) => ({ value: v, label: t(STATE_LABEL[v]) }))}
          onChange={(v) => withUndo(tk, t('"{name}" 상태를 {to}(으)로 바꿨어요', { name, to: t(STATE_LABEL[v]) }), () => moveTask(tk, v))}
        />
      </div>
      <div role="cell" className="tbl-c" data-label={t('담당')}>
        {multi ? (
          <button className="sel-btn tbl-sel" title={t('여러 명이 맡은 일은 편집기에서 바꿔요')} onClick={() => useWorkUi.getState().openEditor(tk)}>
            <span className="sel-label">{tk.owner.join(', ')}</span>
          </button>
        ) : (
          <Select
            className="tbl-sel"
            ariaLabel={t('담당')}
            title={t('담당')}
            value={tk.owner[0] ?? ''}
            placeholder="—"
            options={[{ value: '', label: t('담당 없음') }, ...owners.map((o) => ({ value: o, label: o }))]}
            onChange={(v) =>
              withUndo(tk, v ? t('"{name}" 담당을 {to}(으)로 바꿨어요', { name, to: v }) : t('"{name}" 담당을 비웠어요', { name }), () =>
                patchTask(tk, { owner: v ? [v] : null }),
              )
            }
          />
        )}
      </div>
      <div role="cell" className={`tbl-c${late ? ' late' : ''}`} data-label={t('마감')}>
        <input
          type="date"
          className="tbl-date"
          aria-label={t('마감')}
          value={tk.due ?? ''}
          onChange={(e) => {
            const v = e.target.value
            withUndo(tk, v ? t('"{name}" 마감을 {to}(으)로 바꿨어요', { name, to: v }) : t('"{name}" 마감을 지웠어요', { name }), () => patchTask(tk, { due: v || null }))
          }}
        />
      </div>
      <div role="cell" className="tbl-c" data-label={t('우선순위')}>
        <Select
          className="tbl-sel"
          ariaLabel={t('우선순위')}
          title={t('우선순위')}
          value={String(tk.p ?? 0)}
          placeholder="—"
          options={Object.keys(P_LABEL).map((v) => ({ value: v, label: t(P_LABEL[v]), buttonLabel: `${t('우선')} ${t(P_LABEL[v])}` }))}
          onChange={(v) =>
            withUndo(tk, t('"{name}" 우선순위를 {to}(으)로 바꿨어요', { name, to: t(P_LABEL[v]) }), () => patchTask(tk, { p: v === '0' ? null : (Number(v) as 1 | 2 | 3) }))
          }
        />
      </div>
    </div>
  )
}

export function HubTable({ tasks, owners }: { tasks: Task[]; owners: string[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'due', dir: 'asc' })
  const rows = sortTasks(tasks, sort.key, sort.dir)
  const click = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  return (
    <div className="tbl" role="table" aria-label={t('표')}>
      {/* 좁은 화면: 열 머리 대신 정렬 상자 */}
      <div className="tbl-sortbar">
        <span>{t('정렬')}</span>
        <Select<SortKey>
          className="tbl-sel"
          ariaLabel={t('정렬')}
          title={t('정렬')}
          value={sort.key}
          options={COLS.map((c) => ({ value: c.key, label: t(c.label) }))}
          onChange={(key) => setSort((s) => ({ key, dir: s.dir }))}
        />
        <button className="tbl-dir" aria-label={sort.dir === 'asc' ? t('오름차순') : t('내림차순')} onClick={() => setSort((s) => ({ key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}>
          {sort.dir === 'asc' ? '▲' : '▼'}
        </button>
      </div>
      <div role="row" className="tbl-head">
        {COLS.map((c) => (
          <button key={c.key} role="columnheader" className={sort.key === c.key ? 'on' : ''} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => click(c.key)}>
            {t(c.label)}
            {sort.key === c.key && <span aria-hidden="true"> {sort.dir === 'asc' ? '▲' : '▼'}</span>}
          </button>
        ))}
      </div>
      {rows.length === 0 && <p className="hint pad">{t('보여 줄 일이 없어요. 위의 조건을 바꾸거나 업무를 추가해 보세요.')}</p>}
      {rows.map((tk) => (
        <Row key={tk.id} tk={tk} owners={owners} />
      ))}
    </div>
  )
}
