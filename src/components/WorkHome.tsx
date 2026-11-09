// 내 업무: 앱의 홈. 오늘 일정 + 밀린 일·대기·담당자 없는 일을 프로젝트를 가로질러 한 자리에 모은다.
// 저장하는 데이터는 없다 — 노트에서 매번 계산한다(lib/work.ts). 각 줄은 "왜 여기 있는지"를 보여 주고, 누르면 원본 노트로 간다.
import { useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { fmtDay, openDay, todayYmd } from '../lib/calendar'
import { buildQueues, buildWork, parseMe, type Project, type QueueItem, type Queues, type WorkIndex } from '../lib/work'
import { EventRow, QuickAdd, useCalMap } from './Calendar'
import { Icon } from './Icon'
import { useWorkUi } from '../lib/workOps'

export function useWork(): WorkIndex {
  const files = useApp((s) => s.files)
  return useMemo(() => buildWork(files), [files])
}

function reasonText(q: QueueItem): string {
  const n = q.days ?? 0
  switch (q.reason) {
    case 'overdue': return t('기한 {n}일 지남', { n })
    case 'today': return t('오늘 마감')
    case 'week': return n === 1 ? t('내일 마감') : t('D-{n}', { n })
    case 'waiting': return n > 0 ? t('대기 · 기한 {n}일 지남', { n }) : t('대기')
    case 'doing': return t('진행 중')
    case 'unowned': return t('담당자 없음')
    default: return ''
  }
}

const SECTIONS: { key: keyof Omit<Queues, 'total'>; title: string; tone?: 'danger' | 'warn' }[] = [
  { key: 'overdue', title: '기한이 지난 일', tone: 'danger' },
  { key: 'today', title: '오늘 마감' },
  { key: 'week', title: '이번 주' },
  { key: 'waiting', title: '대기 중인 일', tone: 'warn' },
  { key: 'doing', title: '진행 중' },
  { key: 'unowned', title: '담당자 없는 일' },
]

function TaskRow({ q, projects }: { q: QueueItem; projects: Map<string, Project> }) {
  const app = useApp.getState()
  const tk = q.task
  const proj = tk.project ? projects.get(tk.project) : undefined
  return (
    <div className={`wrk-row${q.reason === 'overdue' ? ' late' : ''}`}>
      <input type="checkbox" className="task" checked={tk.done} onChange={() => app.toggleTask(tk.path, tk.line)} aria-label={tk.title} />
      <button className="wrk-main" onClick={() => useWorkUi.getState().openEditor(tk)}>
        <span className="wrk-body">
          <span className="wrk-title">{tk.p === 1 && <b className="wrk-p">!</b>}{tk.title}</span>
          <span className="wrk-meta">
            {proj && <span className="wrk-proj">{proj.name}</span>}
            {tk.owner.length > 0 && <span className="wrk-owner">{tk.owner.join(', ')}</span>}
            {tk.due && q.reason !== 'overdue' && q.reason !== 'today' && <span className="wrk-due">{tk.due.slice(5)}</span>}
          </span>
        </span>
        <em className={`wrk-why ${q.reason}`}>{reasonText(q)}</em>
      </button>
      <button className="icon-btn wrk-note" title={t('노트에서 보기')} onClick={() => app.openNote(tk.path)}><Icon name="note" size={16} /></button>
    </div>
  )
}

export function WorkHome() {
  const work = useWork()
  const myName = useApp((s) => s.settings.myName)
  const me = useMemo(() => parseMe(myName), [myName])
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const today = todayYmd()
  const q = useMemo(() => buildQueues(work, today, scope === 'mine' ? me : []), [work, today, scope, me])
  const projects = useMemo(() => new Map(work.projects.map((p) => [p.path, p])), [work])
  const empty = work.tasks.length === 0 && work.projects.length === 0
  // 마감일(due)이 일정으로도 잡히므로, 업무 대기열에 이미 있는 항목은 오늘 일정에서 뺀다 (두 번 보이지 않게)
  const cal = useCalMap()
  const taskIds = useMemo(() => new Set(work.tasks.map((x) => x.id)), [work])
  const todayEvents = (cal.get(today) ?? []).filter((e) => !taskIds.has(e.id))

  return (
    <div className="work">
      <div className="panel-head">
        <h2>{t('내 업무')}<small>{fmtDay(today)}</small></h2>
        <div className="head-actions">
          <button className="icon-btn" title={t('업무 추가')} onClick={() => useWorkUi.getState().openEditor()}><Icon name="plus" /></button>
          <button className="icon-btn" title={t('오늘의 노트 열기')} onClick={() => openDay(today)}><Icon name="edit" /></button>
        </div>
      </div>
      <div className="wrk-scroll">
        <div className="wrk-inner">
          {me.length > 0 ? (
            <div className="seg wrk-scope">
              <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>{t('내 것 ({name})', { name: me[0] })}</button>
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>{t('전체')}</button>
            </div>
          ) : (
            work.tasks.length > 0 && (
              <button className="wrk-setname" onClick={() => useApp.getState().go('settings')}>{t('설정에서 내 이름을 입력하면 내 담당 업무만 모아 볼 수 있어요 →')}</button>
            )
          )}

          <section className="wrk-sec">
            <h3>{t('오늘 일정')}</h3>
            <QuickAdd date={today} />
            {todayEvents.length ? <div className="ev-list">{todayEvents.map((e) => <EventRow key={e.id + e.date} ev={e} />)}</div> : <p className="hint">{t('이 날은 일정이 없습니다.')}</p>}
          </section>

          {SECTIONS.map(({ key, title, tone }) =>
            q[key].length > 0 ? (
              <section key={key} className={`wrk-sec ${tone ?? ''}`}>
                <h3>{t(title)}<span className="wrk-count">{q[key].length}</span></h3>
                {q[key].map((it) => <TaskRow key={it.task.id + key} q={it} projects={projects} />)}
              </section>
            ) : null,
          )}

          {work.tasks.length > 0 && q.total === 0 && q.doing.length === 0 && q.unowned.length === 0 && (
            <p className="hint pad wrk-clear">{t('밀린 일이 없습니다. 👍')}</p>
          )}

          {work.projects.length > 0 && (
            <section className="wrk-sec">
              <h3>{t('프로젝트')}<span className="wrk-count">{work.projects.length}</span></h3>
              {work.projects.map((p) => {
                const ts = work.byProject.get(p.path) ?? []
                const open = ts.filter((x) => !x.done && x.state !== 'dropped').length
                return (
                  <button key={p.path} className="wrk-projrow" onClick={() => useWorkUi.getState().openHub(p.path)}>
                    <span className="wrk-pname">{p.name}</span>
                    <span className="wrk-pmeta">
                      {p.status && <em>{p.status}</em>}
                      {p.due && <span>{t('마감 {d}', { d: p.due.slice(5) })}</span>}
                      <span>{t('열린 일 {n}/{m}', { n: open, m: ts.length })}</span>
                    </span>
                  </button>
                )
              })}
            </section>
          )}

          {empty && (
            <div className="wrk-guide">
              <h3>{t('프로젝트 업무를 시작해 보세요')}</h3>
              <p>{t('위의 + 로 업무를 추가하거나, 노트 맨 위에 프로젝트 속성을 넣고 할 일 줄에 마감·담당자를 적으면 여기에 모입니다.')}</p>
              <pre>{`---\ntype: project\nstatus: active\n---\n\n- [ ] 견적서 수정 due:2026-11-12 owner:홍길동\n- [ ] 확인 요청 status:waiting due:2026-11-14`}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
