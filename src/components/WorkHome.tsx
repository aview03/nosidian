// 내 업무: 앱의 홈. 오늘 일정 + 밀린 일·대기·담당자 없는 일을 프로젝트를 가로질러 한 자리에 모은다.
// 저장하는 데이터는 없다 — 노트에서 매번 계산한다(lib/work.ts). 각 줄은 "왜 여기 있는지"를 보여 주고, 누르면 원본 노트로 간다.
import { useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { fmtDay, openDay, todayYmd } from '../lib/calendar'
import { addDaysYmd, buildQueues, buildWork, diffDays, parseMe, type Project, type Task, type QueueItem, type Queues, type WorkIndex } from '../lib/work'
import { EventRow, QuickAdd, useCalMap } from './Calendar'
import { Icon } from './Icon'
import { Select } from './Select'
import { applyView, readViews, type View } from '../lib/views'
import { moveToProject, toggleOrClose, useWorkUi } from '../lib/workOps'
import { projectHealth, readThresholds, type Health, type Signal } from '../lib/health'

export function signalText(s: Signal): string {
  switch (s.key) {
    case 'overdue': return t('기한 지난 일 {n}', { n: s.count })
    case 'decisionLate': return t('확인일이 지난 결정 {n}', { n: s.count })
    case 'waitingLate': return t('답이 늦은 대기 {n}', { n: s.count })
    default: return t('담당자 없는 일 {n}', { n: s.count })
  }
}
export const healthLabel = (h: Health) => (h.level === 'ok' ? t('정상') : `${h.level === 'risk' ? t('위험') : t('주의')} · ${h.signals.map(signalText).join(' · ')}`)

/** 프로젝트별 시스템 점검(파생). 사람이 적은 health: 와 따로 쓴다 */
export function useHealth(work: WorkIndex): Map<string, Health | null> {
  const files = useApp((s) => s.files)
  return useMemo(() => {
    const th = readThresholds(files)
    const today = todayYmd()
    return new Map(work.projects.map((p) => [p.path, projectHealth(work.byProject.get(p.path) ?? [], today, th)]))
  }, [files, work])
}

/** 정리할 업무: 어느 프로젝트에도 속하지 않은 업무(받은 업무 등). 고르면 그 프로젝트의 할 일 노트로 옮겨 간다 */
function Triage({ work }: { work: WorkIndex }) {
  const loose = work.tasks.filter((x) => !x.project && !x.done && x.state !== 'dropped')
  if (!loose.length) return null
  return (
    <section className="wrk-sec">
      <h3>{t('정리할 업무')}<span className="wrk-count">{loose.length}</span></h3>
      <p className="hint wrk-triage-hint">{t('프로젝트를 고르면 그 프로젝트의 할 일 노트로 옮겨져요.')}</p>
      {loose.map((tk) => (
        <div key={tk.id} className="wrk-row wrk-triage">
          <button className="wrk-main" onClick={() => useWorkUi.getState().openEditor(tk)}>
            <span className="wrk-body">
              <span className="wrk-title">{tk.title}</span>
              <span className="wrk-meta">{tk.due && <span className="wrk-due">{tk.due.slice(5)}</span>}{tk.owner.length > 0 && <span className="wrk-owner">{tk.owner.join(', ')}</span>}</span>
            </span>
          </button>
          <Select
            className="wrk-moveto"
            value=""
            ariaLabel={t('프로젝트로 옮기기')}
            title={t('프로젝트로 옮기기')}
            placeholder={t('프로젝트로 옮기기…')}
            options={work.projects.map((p) => ({ value: p.path, label: p.name, hint: p.status }))}
            onChange={(path) => {
              const p = work.projects.find((x) => x.path === path)
              if (p && moveToProject(tk, p.path)) useApp.getState().say(t('"{name}" 로 옮겼어요', { name: p.name }))
            }}
          />
        </div>
      ))}
    </section>
  )
}

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
    case 'decision': return n > 0 ? t('다시 확인 {n}일 지남', { n }) : n === 0 ? t('오늘 다시 확인') : q.days === undefined ? t('미결') : t('D-{n}', { n: -n })
    default: return ''
  }
}

const SECTIONS: { key: keyof Omit<Queues, 'total'>; title: string; tone?: 'danger' | 'warn' }[] = [
  { key: 'overdue', title: '기한이 지난 일', tone: 'danger' },
  { key: 'decisions', title: '결정할 일' },
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
      <input type="checkbox" className="task" checked={tk.done} onChange={() => toggleOrClose(tk)} aria-label={tk.title} />
      <button className="wrk-main" onClick={() => useWorkUi.getState().openEditor(tk)}>
        <span className="wrk-body">
          <span className="wrk-title">{tk.kind === 'decision' && <b className="wrk-kind">{t('결정')}</b>}{tk.p === 1 && <b className="wrk-p">!</b>}{tk.title}</span>
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

/** 업무 한 줄을 QueueItem 으로 (보기 결과에서 "왜 여기 있나" 문구를 쓰기 위해) */
function itemOf(task: Task, today: string): QueueItem {
  if (task.kind === 'decision') return { task, reason: 'decision', days: task.due ? diffDays(today, task.due) : undefined }
  if (task.state === 'waiting' || task.side === 'other') return { task, reason: 'waiting', days: task.due ? diffDays(today, task.due) : undefined }
  if (task.due && task.due < today) return { task, reason: 'overdue', days: diffDays(today, task.due) }
  if (task.due === today) return { task, reason: 'today' }
  if (task.due && task.due <= addDaysYmd(today, 7)) return { task, reason: 'week', days: diffDays(task.due, today) }
  if (task.state === 'doing') return { task, reason: 'doing' }
  return { task, reason: '' }
}

/** 보기 선택줄: 기본 화면 / 저장된 보기들 / 새 보기 */
function ViewBar({ views, active }: { views: View[]; active: View | null }) {
  const NEW = '__new'
  return (
    <div className="wrk-viewbar">
      <Select
        value={active?.name ?? ''}
        title={t('보기')}
        ariaLabel={t('보기')}
        className="wrk-viewsel"
        options={[{ value: '', label: t('기본 화면') }, ...views.map((v) => ({ value: v.name, label: v.name })), { value: NEW, label: '+ ' + t('새 보기…') }]}
        onChange={(v) => (v === NEW ? useWorkUi.setState({ viewEditor: {} }) : useWorkUi.getState().setView(v || null))}
      />
      {active && <button className="wrk-viewedit" onClick={() => useWorkUi.setState({ viewEditor: { view: active } })}>{t('편집')}</button>}
    </div>
  )
}

export function WorkHome() {
  const work = useWork()
  const files = useApp((s) => s.files)
  const views = useMemo(() => readViews(files), [files])
  const viewName = useWorkUi((s) => s.view)
  const active = views.find((v) => v.name.toLowerCase() === viewName?.toLowerCase()) ?? null
  const health = useHealth(work)
  const myName = useApp((s) => s.settings.myName)
  const me = useMemo(() => parseMe(myName), [myName])
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const today = todayYmd()
  const q = useMemo(() => buildQueues(work, today, scope === 'mine' ? me : []), [work, today, scope, me])
  const projects = useMemo(() => new Map(work.projects.map((p) => [p.path, p])), [work])
  const viewTasks = useMemo(() => (active ? applyView(work, active, today, me) : []), [work, active, today, me])
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
          {(work.tasks.length > 0 || views.length > 0) && <ViewBar views={views} active={active} />}

          {active && (
            <section className="wrk-sec wrk-viewres">
              <h3>{active.name}<span className="wrk-count">{viewTasks.length}</span></h3>
              {viewTasks.length === 0 && <p className="hint pad">{t('조건에 맞는 열린 업무가 없어요.')}</p>}
              {viewTasks.map((tk) => <TaskRow key={tk.id} q={itemOf(tk, today)} projects={projects} />)}
            </section>
          )}

          {!active && <>
          {me.length > 0 ? (
            <div className="seg wrk-scope">
              <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>{t('내 것 ({name})', { name: me[0] })}</button>
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>{t('전체')}</button>
            </div>
          ) : (
            work.tasks.length > 0 && (
              <button className="wrk-setname" onClick={() => useApp.getState().go('settings')}>{t('내 이름 설정 →')}</button>
            )
          )}

          <section className="wrk-sec">
            <h3>{t('오늘 일정')}</h3>
            <div className="wrk-add-inline"><QuickAdd date={today} /></div>
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

          {work.projects.length > 0 && <Triage work={work} />}

          <section className="wrk-sec">
              <h3>{t('프로젝트')}{work.projects.length > 0 && <span className="wrk-count">{work.projects.length}</span>}</h3>
              {work.projects.map((p) => {
                const ts = work.byProject.get(p.path) ?? []
                const open = ts.filter((x) => !x.done && x.state !== 'dropped').length
                return (
                  <button key={p.path} className="wrk-projrow" onClick={() => useWorkUi.getState().openHub(p.path)}>
                    <span className="wrk-pname">{p.name}</span>
                    <span className="wrk-pmeta">
                      {p.status && <em>{p.status}</em>}
                      {health.get(p.path) && health.get(p.path)!.level !== 'ok' && <span className={`wrk-health ${health.get(p.path)!.level}`}>{healthLabel(health.get(p.path)!)}</span>}
                      {p.due && <span>{t('마감 {d}', { d: p.due.slice(5) })}</span>}
                      <span>{t('열린 일 {n}/{m}', { n: open, m: ts.length })}</span>
                    </span>
                  </button>
                )
              })}
              <button className="wrk-newproj" onClick={() => useWorkUi.setState({ wizard: true })}>+ {t('새 프로젝트')}</button>
            </section>

          {empty && (
            <div className="wrk-guide">
              <h3>{t('프로젝트 업무를 시작해 보세요')}</h3>
              <p>{t('위의 + 로 업무를 추가하거나, 아래 "새 프로젝트"로 템플릿에서 시작하세요. 노트 맨 위에 프로젝트 속성을 넣고 할 일 줄에 마감·담당자를 적어도 여기에 모입니다.')}</p>
              <pre>{`---\ntype: project\nstatus: active\n---\n\n- [ ] 견적서 수정 due:2026-11-12 owner:홍길동\n- [ ] 확인 요청 status:waiting due:2026-11-14`}</pre>
            </div>
          )}
          </>}
        </div>
      </div>
      {!active && <div className="wrk-foot"><QuickAdd date={today} /></div>}
    </div>
  )
}
