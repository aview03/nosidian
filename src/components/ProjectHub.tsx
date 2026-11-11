// 프로젝트 허브: 프로젝트 하나의 할 일·문서·일정을 한 화면에 모은다. 모두 노트에서 파생한 읽기 화면이고, 고치는 일은 업무 편집기가 맡는다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { addDays, fmtDay, todayYmd } from '../lib/calendar'
import { baseName } from '../lib/links'
import { parseMe, uiStateOf, type Task } from '../lib/work'
import { useWorkUi } from '../lib/workOps'
import { EventRow, useCalMap } from './Calendar'
import { buildTimeline, groupByDate } from '../lib/timeline'
import { ask } from '../lib/dialog'
import { templateFromProject } from '../lib/projectTemplates'
import { DocCheck } from './DocCheck'
import { HumanDocs } from './HumanDocs'
import { Icon } from './Icon'
import { TaskLine } from './TaskLine'
import { HubTable } from './HubTable'
import { HubOwners } from './HubOwners'
import { HubGantt } from './HubGantt'
import { Board } from './HubBoard'
import { openNewNote } from './NewNote'
import { HubInfo, levelText } from './HubInfo'
import { filterTasks } from '../lib/projectViews'
import { HUB_VIEWS, loadHubView, saveHubView, type HubView } from '../lib/hubViews'
import { useHealth, useWork } from './WorkHome'

export { TaskLine }

type Tab = 'tasks' | 'views' | 'info' | 'docs' | 'check'

/** 탭·칩 줄에서 좌우 화살표로 옆 항목으로 옮기며 고른다(role=tab 의 키보드 조작) */
function arrowNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  const list = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const i = list.indexOf(document.activeElement as HTMLButtonElement)
  if (i < 0) return
  const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]
  next.focus()
  next.click()
  e.preventDefault()
}

/** 제목 줄 오른쪽의 ⋯ 메뉴(자주 쓰지 않는 동작을 모아 둔다) */
function HubMenu({ items }: { items: { label: string; run(): void }[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', off, true)
    return () => window.removeEventListener('pointerdown', off, true)
  }, [open])
  return (
    <div className="hub-menu" ref={box}>
      <button className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t('더 보기')} onClick={() => setOpen(!open)}><Icon name="more" /></button>
      {open && (
        <div className="menu-pop hub-pop" role="menu">
          {items.map((it) => <button key={it.label} role="menuitem" onClick={() => { setOpen(false); it.run() }}>{it.label}</button>)}
        </div>
      )}
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
  // 보기(보드·타임라인…): 프로젝트마다 마지막에 쓴 것을 기억한다
  const [view, setViewState] = useState<HubView>(() => loadHubView(path ?? ''))
  useEffect(() => setViewState(loadHubView(path ?? '')), [path])
  const setView = (v: HubView) => {
    setViewState(v)
    if (path) saveHubView(path, v)
  }
  // 표·담당자별 공통 필터(보기를 바꿔도 유지)
  const myName = useApp((s) => s.settings.myName)
  const me = useMemo(() => parseMe(myName), [myName])
  const [mineOnly, setMineOnly] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const chips = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chips.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [view, tab])
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
  const health = project ? healthMap.get(project.path) : null

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

  return (
    <div className="work hub">
      <div className="panel-head hub-head">
        <button className="icon-btn" onClick={goBack} aria-label={t('내 업무로')}><Icon name="back" /></button>
        <h2>{project.name}</h2>
        {health && health.level !== 'ok' && (
          <button className={`hub-badge ${health.level}`} title={t('건강도 자세히 보기')} onClick={() => setTab('info')}>{levelText(health)}</button>
        )}
        <div className="head-actions">
          <button className="icon-btn" title={t('업무 추가')} onClick={() => useWorkUi.getState().openEditor(undefined, project.path)}><Icon name="plus" /></button>
          <HubMenu items={[
            { label: t('노트로 열기'), run: () => useApp.getState().openNote(project.path) },
            { label: t('템플릿으로 저장'), run: () => void saveAsTemplate() },
          ]} />
        </div>
      </div>
      {/* 탭 순서: 일을 보는 화면(할 일·보기) → 프로젝트를 설명하는 화면(기본 정보·문서·문서 점검). 보기는 아래 칩 줄에서 고른다 */}
      <div className="seg wide hub-tabs" role="tablist" onKeyDown={arrowNav}>
        <button role="tab" tabIndex={tab === 'tasks' ? 0 : -1} aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>{t('할 일')}</button>
        <button role="tab" tabIndex={tab === 'views' ? 0 : -1} aria-selected={tab === 'views'} className={tab === 'views' ? 'on' : ''} onClick={() => setTab('views')}>{t('보기')}</button>
        <span className="hub-tab-sep" aria-hidden="true" />
        <button role="tab" tabIndex={tab === 'info' ? 0 : -1} aria-selected={tab === 'info'} className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>{t('기본 정보')}</button>
        <button role="tab" tabIndex={tab === 'docs' ? 0 : -1} aria-selected={tab === 'docs'} className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>{t('문서')}</button>
        <button role="tab" tabIndex={tab === 'check' ? 0 : -1} aria-selected={tab === 'check'} className={tab === 'check' ? 'on' : ''} onClick={() => setTab('check')}>{t('문서 점검')}</button>
      </div>
      {tab === 'views' && (
        <div className="hub-views" role="tablist" aria-label={t('보기')} ref={chips} onKeyDown={arrowNav}>
          {HUB_VIEWS.map((v) => (
            <button key={v.key} role="tab" tabIndex={view === v.key ? 0 : -1} aria-selected={view === v.key} className={view === v.key ? 'on' : ''} title={t(v.hint)} onClick={() => setView(v.key)}>{t(v.label)}</button>
          ))}
        </div>
      )}

      <div className="wrk-scroll">
        <div className={`wrk-inner${tab === 'views' && view === 'board' ? ' wide' : ''}`}>
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
              {open.length === 0 && <p className="hint pad">{tasks.length ? t('열린 일이 없어요. 👍') : t('아직 업무가 없어요.')}</p>}
              {/* 목록 안에서도 바로 추가할 수 있게(위 헤더의 + 아이콘은 글자가 없어 찾기 어렵다) */}
              <button className="wrk-newproj hub-addtask" onClick={() => useWorkUi.getState().openEditor(undefined, project.path)}>+ {t('업무 추가')}</button>
              {finished.length > 0 && (
                <details className="wrk-sec hub-done">
                  <summary>{t('완료·취소됨')} <span className="wrk-count">{finished.length}</span></summary>
                  {[...finished].sort(byDue).map((x) => <TaskLine key={x.id} tk={x} />)}
                </details>
              )}
            </>
          )}

          {tab === 'views' && (view === 'table' || view === 'owners' || view === 'gantt') && (
            <div className="hub-filter">
              {me.length > 0 && <button aria-pressed={mineOnly} className={mineOnly ? 'on' : ''} onClick={() => setMineOnly(!mineOnly)}>{t('내 것만')}</button>}
              <button aria-pressed={showDone} className={showDone ? 'on' : ''} onClick={() => setShowDone(!showDone)}>{t('완료 포함')}</button>
            </div>
          )}
          {tab === 'views' && view === 'board' && <Board tasks={tasks} project={project.path} />}
          {tab === 'views' && view === 'table' && <HubTable tasks={filterTasks(tasks, { mineOnly, showDone, me })} owners={[...new Set(tasks.flatMap((x) => x.owner))].sort((a, b) => a.localeCompare(b, 'ko'))} />}
          {tab === 'views' && view === 'gantt' && <HubGantt tasks={filterTasks(tasks, { mineOnly, showDone, me })} projectDue={project.due} />}
          {tab === 'views' && view === 'owners' && <HubOwners tasks={filterTasks(tasks, { mineOnly, showDone, me })} me={me} />}

          {tab === 'info' && <HubInfo project={project} open={open.length} total={tasks.length} health={health} onOpenNote={() => useApp.getState().openNote(project.path)} />}

          {tab === 'docs' && (
            <>
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
            {/* HumanDocs(문서 규칙을 켠 프로젝트의 문서 목록) 안팎 어느 모양이든 보이도록 밖에 둔다 */}
            {project.folder !== '' && <button className="wrk-newproj hub-adddoc" onClick={() => openNewNote(project.folder)}>+ {t('문서 추가')}</button>}
            </>
          )}

          {tab === 'check' && <DocCheck project={project} />}

          {tab === 'views' && view === 'timeline' && (
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
