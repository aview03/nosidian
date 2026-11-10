// 프로젝트 허브: 프로젝트 하나의 할 일·문서·일정을 한 화면에 모은다. 모두 노트에서 파생한 읽기 화면이고, 고치는 일은 업무 편집기가 맡는다.
import { useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { addDays, fmtDay, todayYmd } from '../lib/calendar'
import { baseName } from '../lib/links'
import { uiStateOf, type Task, type UiState } from '../lib/work'
import { moveTask, toggleOrClose, useWorkUi } from '../lib/workOps'
import { EventRow, useCalMap } from './Calendar'
import { buildTimeline, groupByDate } from '../lib/timeline'
import { ask } from '../lib/dialog'
import { templateFromProject } from '../lib/projectTemplates'
import { DocCheck } from './DocCheck'
import { HumanDocs } from './HumanDocs'
import { Icon } from './Icon'
import { healthLabel, signalText, useHealth, useWork } from './WorkHome'

type Tab = 'tasks' | 'board' | 'docs' | 'timeline' | 'check'

const COLS: { key: UiState | 'done'; title: string }[] = [
  { key: 'todo', title: '할 일' },
  { key: 'doing', title: '진행 중' },
  { key: 'waiting', title: '대기' },
  { key: 'done', title: '완료' },
]
const colOf = (tk: Task): UiState | 'done' => (tk.done ? 'done' : uiStateOf(tk))

/** 칸반 보드: 카드를 끌어 놓거나 ‹ › 로 옮기면 그 줄의 status 가 바뀐다 */
function Board({ tasks }: { tasks: Task[] }) {
  const [over, setOver] = useState<string | null>(null)
  const shown = tasks.filter((x) => uiStateOf(x) !== 'dropped')
  const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.p ?? 9) - (b.p ?? 9)
  return (
    <div className="board">
      {COLS.map((c, ci) => {
        const items = shown.filter((x) => colOf(x) === c.key).sort(byDue)
        return (
          <section
            key={c.key}
            className={`board-col${over === c.key ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(c.key) }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault()
              setOver(null)
              const tk = shown.find((x) => x.id === e.dataTransfer.getData('text/plain'))
              if (tk && colOf(tk) !== c.key) moveTask(tk, c.key)
            }}
          >
            <h3>{t(c.title)}<span className="wrk-count">{items.length}</span></h3>
            {items.map((tk) => (
              <div key={tk.id} className="board-card" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', tk.id)}>
                <button className="board-body" onClick={() => useWorkUi.getState().openEditor(tk)}>
                  <span className="wrk-title">{tk.kind === 'decision' && <b className="wrk-kind">{t('결정')}</b>}{tk.p === 1 && <b className="wrk-p">!</b>}{tk.title}</span>
                  <span className="wrk-meta">
                    {tk.due && <span className={!tk.done && tk.due < todayYmd() ? 'wrk-late' : 'wrk-due'}>{tk.due.slice(5)}</span>}
                    {tk.owner.length > 0 && <span className="wrk-owner">{tk.owner.join(', ')}</span>}
                  </span>
                </button>
                <span className="board-move">
                  <button disabled={ci === 0} aria-label={t('이전 칸으로')} onClick={() => moveTask(tk, COLS[ci - 1].key)}>‹</button>
                  <button disabled={ci === COLS.length - 1} aria-label={t('다음 칸으로')} onClick={() => moveTask(tk, COLS[ci + 1].key)}>›</button>
                </span>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export function TaskLine({ tk, showProject }: { tk: Task; showProject?: string }) {
  const ui = uiStateOf(tk)
  const today = todayYmd()
  const late = !tk.done && ui !== 'dropped' && !!tk.due && tk.due < today
  return (
    <div className={`wrk-row${late ? ' late' : ''}${tk.done || ui === 'dropped' ? ' fin' : ''}`}>
      <input type="checkbox" className="task" checked={tk.done} onChange={() => toggleOrClose(tk)} aria-label={tk.title} />
      <button className="wrk-main" onClick={() => useWorkUi.getState().openEditor(tk)}>
        <span className="wrk-body">
          <span className="wrk-title">{tk.kind === 'decision' && <b className="wrk-kind">{t('결정')}</b>}{tk.p === 1 && <b className="wrk-p">!</b>}{tk.title}</span>
          <span className="wrk-meta">
            {tk.due && <span className={late ? 'wrk-late' : 'wrk-due'}>{tk.due.slice(5)}</span>}
            {tk.owner.length > 0 && <span className="wrk-owner">{tk.owner.join(', ')}</span>}
            {showProject && <span className="wrk-proj">{showProject}</span>}
            {tk.conclusion && <span className="wrk-concl">→ {tk.conclusion}</span>}
          </span>
        </span>
        {ui !== 'todo' && !tk.done && <em className={`wrk-why ${ui}`}>{ui === 'doing' ? t('진행 중') : ui === 'waiting' ? t('대기') : t('취소됨')}</em>}
        {late && ui === 'todo' && <em className="wrk-why overdue">{t('기한 지남')}</em>}
      </button>
    </div>
  )
}

export function ProjectHub() {
  const path = useWorkUi((s) => s.hub)
  const work = useWork()
  const healthMap = useHealth(work)
  const files = useApp((s) => s.files)
  const index = useApp((s) => s.index)
  const cal = useCalMap()
  const [tab, setTab] = useState<Tab>('tasks')
  const project = work.projects.find((p) => p.path === path)
  const tasks = useMemo(() => (project ? work.byProject.get(project.path) ?? [] : []), [work, project])

  // 이 프로젝트의 노트들 (프로젝트 폴더 아래 + 프로젝트 노트)
  const notePaths = useMemo(() => {
    if (!project) return []
    return Object.values(files)
      .filter((f) => !f.deleted && (f.path === project.path || (project.folder !== '' && f.path.startsWith(project.folder + '/'))))
      .map((f) => f.path)
  }, [files, project])

  const goBack = () => useApp.getState().go('work')

  // 이 프로젝트의 문서·할 일을 틀로 만들어 vault 의 Templates/ 에 저장한다(새 프로젝트에서 고를 수 있다)
  const saveAsTemplate = async () => {
    if (!project) return
    const name = await ask(t('템플릿으로 저장'), project.name, t('이 프로젝트의 문서와 할 일이 템플릿이 돼요. 완료 표시·결론·상태는 지워지고, 마감일은 프로젝트 마감 기준으로 바뀌어요.'), t('저장'))
    if (!name?.trim()) return
    const app = useApp.getState()
    const out = templateFromProject(project, app.files, name, Object.keys(app.files).filter((p) => !app.files[p].deleted))
    for (const [p, c] of Object.entries(out.files)) app.createNote(p, c, false)
    app.say(t('"{name}" 템플릿으로 저장했어요. 새 프로젝트에서 고를 수 있어요.', { name: out.name }))
  }

  if (!project) {
    return (
      <div className="work">
        <div className="panel-head"><h2>{t('프로젝트')}</h2><button className="link-btn" onClick={goBack}>{t('내 업무로')}</button></div>
        <p className="hint pad">{t('프로젝트를 찾을 수 없어요. 노트가 삭제되었거나 type: project 가 빠졌을 수 있어요.')}</p>
      </div>
    )
  }

  const open = tasks.filter((x) => !x.done && uiStateOf(x) !== 'dropped')
  const decisions = open.filter((x) => x.kind === 'decision')
  const rest = open.filter((x) => x.kind !== 'decision')
  const groups: { key: string; title: string; items: Task[] }[] = [
    { key: 'decision', title: t('결정할 일'), items: decisions },
    { key: 'doing', title: t('진행 중'), items: rest.filter((x) => uiStateOf(x) === 'doing') },
    { key: 'todo', title: t('할 일'), items: rest.filter((x) => uiStateOf(x) === 'todo') },
    { key: 'waiting', title: t('대기'), items: rest.filter((x) => uiStateOf(x) === 'waiting') },
  ]
  const finished = tasks.filter((x) => x.done || uiStateOf(x) === 'dropped')
  const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.p ?? 9) - (b.p ?? 9)

  const today = todayYmd()
  // 타임라인: 이 프로젝트 노트의 일정(지난 60일 ~ 앞으로 1년) + 업무·결정·프로젝트 마감
  const pathSet = new Set(notePaths)
  const events: NonNullable<ReturnType<typeof cal.get>> = []
  for (let i = -60; i < 365; i++) for (const e of cal.get(addDays(today, i)) ?? []) if (pathSet.has(e.path)) events.push(e)
  const timeline = buildTimeline(project, tasks, events)
  const grouped = groupByDate(timeline.entries, today)

  const docs = notePaths.filter((p) => p !== project.path).sort((a, b) => a.localeCompare(b))
  const statusLabel = project.status

  return (
    <div className="work hub">
      <div className="panel-head hub-head">
        <button className="icon-btn" onClick={goBack} aria-label={t('내 업무로')}><Icon name="back" /></button>
        <h2>{project.name}</h2>
        <div className="head-actions">
          <button className="icon-btn" title={t('업무 추가')} onClick={() => useWorkUi.getState().openEditor(undefined, project.path)}><Icon name="plus" /></button>
          <button className="icon-btn" title={t('노트로 열기')} onClick={() => useApp.getState().openNote(project.path)}><Icon name="edit" /></button>
        </div>
      </div>
      <div className="hub-meta">
        {statusLabel && <em>{statusLabel}</em>}
        {project.owner.length > 0 && <span className="wrk-owner">{project.owner.join(', ')}</span>}
        {project.due && <span>{t('마감 {d}', { d: project.due })}</span>}
        {project.health && <span className="hub-health">{t('판단')}: {project.health}</span>}
        {healthMap.get(project.path) && <span className={`wrk-health ${healthMap.get(project.path)!.level}`} title={healthMap.get(project.path)!.signals.map(signalText).join(' · ')}>{t('점검')}: {healthLabel(healthMap.get(project.path)!)}</span>}
        <span>{t('열린 일 {n}/{m}', { n: open.length, m: tasks.length })}</span>
        <button className="wrk-viewedit hub-savetpl" onClick={() => void saveAsTemplate()}>{t('템플릿으로 저장')}</button>
      </div>
      <div className="seg wide hub-tabs">
        <button className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>{t('할 일')}</button>
        <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>{t('보드')}</button>
        <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>{t('문서')}</button>
        <button className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')}>{t('타임라인')}</button>
        <button className={tab === 'check' ? 'on' : ''} onClick={() => setTab('check')}>{t('문서 점검')}</button>
      </div>

      <div className="wrk-scroll">
        <div className={`wrk-inner${tab === 'board' ? ' wide' : ''}`}>
          {tab === 'tasks' && (
            <>
              {groups.map((g) =>
                g.items.length ? (
                  <section key={g.key} className="wrk-sec">
                    <h3>{g.title}<span className="wrk-count">{g.items.length}</span></h3>
                    {[...g.items].sort(byDue).map((x) => <TaskLine key={x.id} tk={x} />)}
                  </section>
                ) : null,
              )}
              {open.length === 0 && <p className="hint pad">{tasks.length ? t('열린 일이 없어요. 👍') : t('아직 업무가 없어요. 위의 + 로 추가해 보세요.')}</p>}
              {finished.length > 0 && (
                <details className="wrk-sec hub-done">
                  <summary>{t('완료·취소됨')} <span className="wrk-count">{finished.length}</span></summary>
                  {[...finished].sort(byDue).map((x) => <TaskLine key={x.id} tk={x} />)}
                </details>
              )}
            </>
          )}

          {tab === 'board' && <Board tasks={tasks} />}

          {tab === 'docs' && (
            <HumanDocs project={project} open={open.length} decisions={decisions.length} onCheck={() => setTab('check')}>
            <section className="wrk-sec">
              {project.folder === '' && <p className="hint pad">{t('이 프로젝트 노트는 폴더 밖에 있어요. 노트를 폴더로 옮기면 그 폴더의 문서가 여기 모여요.')}</p>}
              {docs.length === 0 && project.folder !== '' && <p className="hint pad">{t('프로젝트 폴더에 다른 문서가 없어요.')}</p>}
              {docs.map((p) => (
                <button key={p} className="wrk-projrow" onClick={() => useApp.getState().openNote(p)}>
                  <span className="wrk-pname">{index.notes.get(p)?.title ?? baseName(p)}</span>
                  <span className="wrk-pmeta"><span>{p.slice(project.folder.length + 1)}</span></span>
                </button>
              ))}
            </section>
            </HumanDocs>
          )}

          {tab === 'check' && <DocCheck project={project} />}

          {tab === 'timeline' && (
            <div className="tl">
              {grouped.days.length === 0 && <p className="hint pad">{t('아직 날짜가 있는 항목이 없어요. 업무에 마감일을 넣거나 프로젝트에 마감을 적으면 여기에 나타나요.')}</p>}
              {grouped.days.map((d, i) => (
                <div key={d.date}>
                  {i === grouped.todayIndex && <div className="tl-now"><span>{t('오늘')} · {fmtDay(today)}</span></div>}
                  <section className={`tl-day${d.date < today ? ' past' : ''}`}>
                    <h3>{fmtDay(d.date)}</h3>
                    {d.items.map((e, j) =>
                      e.type === 'task' ? <TaskLine key={e.task.id} tk={e.task} />
                      : e.type === 'event' ? <EventRow key={e.event.id + j} ev={e.event} />
                      : <div key={'m' + j} className="tl-milestone"><Icon name="check" /><span>{t('프로젝트 마감')}</span></div>,
                    )}
                  </section>
                </div>
              ))}
              {grouped.days.length > 0 && grouped.todayIndex === grouped.days.length && <div className="tl-now"><span>{t('오늘')} · {fmtDay(today)}</span></div>}
              {timeline.undated > 0 && <p className="hint tl-undated">{t('마감일이 없는 열린 일 {n}개는 "할 일" 탭에서 볼 수 있어요.', { n: timeline.undated })}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
