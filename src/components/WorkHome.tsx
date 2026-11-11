// 내 업무: 앱의 홈. 오늘 일정 + 밀린 일·대기·담당자 없는 일을 프로젝트를 가로질러 한 자리에 모은다.
// 저장하는 데이터는 없다 — 노트에서 매번 계산한다(lib/work.ts). 각 줄은 "왜 여기 있는지"를 보여 주고, 누르면 원본 노트로 간다.
import { useMemo, useState, type ReactNode } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { fmtDay, todayYmd } from '../lib/calendar'
import { addDaysYmd, buildQueues, buildWork, diffDays, parseMe, type Project, type Task, type QueueItem, type Queues, type WorkIndex } from '../lib/work'
import { EventRow, QuickAdd, useCalMap } from './Calendar'
import { Icon } from './Icon'
import { Select } from './Select'
import { TileAdder, TileArranger } from './TileArranger'
import { desktop } from '../lib/externalIO'
import { Orb } from './Orb'
import { useAiThread } from '../lib/aiThread'
import { ProposalBanner } from './ProposalReview'
import { openMyNameSetting } from './Settings'
import { applyView, readViews, type View } from '../lib/views'
import { customName, disableTile, enableTile, isCustom, reorderVisible, resolveTiles, setCollapsed, setLimit, type BuiltinTile } from '../lib/tiles'
import { moveToProject, toggleOrClose, useWorkUi } from '../lib/workOps'
import { projectHealth, readThresholds, type Health, type Signal } from '../lib/health'
import { buildDayItems, type DayItem } from '../lib/dayItems'
import { useCal } from '../lib/calendar'

export function signalText(s: Signal): string {
  switch (s.key) {
    case 'overdue': return t('기한 지난 일 {n}', { n: s.count })
    case 'decisionLate': return t('확인일이 지난 결정 {n}', { n: s.count })
    case 'waitingLate': return t('답을 오래 기다리는 일 {n}', { n: s.count })
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

/** 정리할 업무 한 줄: 어느 프로젝트에도 속하지 않은 업무. 프로젝트를 고르면 그 프로젝트의 할 일 노트로 옮겨 간다 */
function TriageRow({ tk, work }: { tk: Task; work: WorkIndex }) {
  return (
    <div className="wrk-row wrk-triage">
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

/** 업무는 아니지만 날짜가 있는 종일 체크리스트(과제·제출) 한 줄. "이번 주"·"기한이 지난 일"에 업무와 함께 보인다(F21) */
function DayItemRow({ it }: { it: DayItem }) {
  const app = useApp.getState()
  const ev = it.ev
  const late = it.reason === 'overdue'
  return (
    <div className={`wrk-row${late ? ' late' : ''}`}>
      <input type="checkbox" className="task" checked={ev.done} onChange={() => app.toggleTask(ev.path, ev.line)} aria-label={ev.title} />
      <button className="wrk-main" onClick={() => useCal.getState().openEditor(ev.origDate ?? ev.date, ev)}>
        <span className="wrk-body">
          <span className="wrk-title">{ev.title}</span>
          <span className="wrk-meta"><span className="wrk-due">{ev.date.slice(5)}</span></span>
        </span>
        <em className={`wrk-why ${it.reason}`}>{late ? t('기한 {n}일 지남', { n: it.days }) : it.days === 1 ? t('내일 마감') : t('D-{n}', { n: it.days })}</em>
      </button>
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

/** 타일 하나가 보여 줄 내용 */
interface TileData {
  title: string
  tone?: 'danger' | 'warn'
  /** 줄들. 타일의 "처음 보일 줄 수" 제한은 여기에만 적용된다 */
  rows: ReactNode[]
  /** 제목 옆 개수(없으면 표시 안 함) */
  count?: number
  /** 줄 위에 늘 보이는 것 */
  top?: ReactNode
  /** 줄 아래에 늘 보이는 것 */
  footer?: ReactNode
  /** 줄이 없을 때 보일 글 */
  emptyText?: string
  /** 줄이 없어도 타일을 보일지(오늘 일정·프로젝트·사용자 타일). 아니면 비어 있을 땐 화면에서 빠진다 */
  alwaysShow?: boolean
  /** "처음 보일 줄 수" 선택을 줄지 */
  limitable: boolean
  /** 사용자가 만든 타일이면 그 조건 */
  custom?: View
}


function TileView({ id, data, limit, collapsed }: {
  id: string
  data: TileData
  limit: number
  collapsed: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const patch = useWorkUi.getState().patchLayout
  const shown = limit > 0 && !expanded ? data.rows.slice(0, limit) : data.rows
  const rest = data.rows.length - shown.length
  const count = data.count ?? (data.limitable ? data.rows.length : undefined)
  return (
    <section className={`wrk-sec wrk-tile ${data.tone ?? ''}${collapsed ? ' collapsed' : ''}`}>
      <div className="wrk-tilehead">
        <button className="wrk-tiletitle" aria-expanded={!collapsed} onClick={() => patch((l) => setCollapsed(l, id, !collapsed))}>
          {collapsed && <Icon name="chevron" size={14} />}
          <span className="wrk-tname">{data.title}</span>
          {count !== undefined && <span className="wrk-count">{count}</span>}
        </button>
      </div>
      {!collapsed && (
        <div className="wrk-tilebody">
          {data.top}
          {shown}
          {data.rows.length === 0 && data.emptyText && <p className="hint">{data.emptyText}</p>}
          {data.limitable && limit > 0 && data.rows.length > limit && (
            <button className="wrk-more" onClick={() => setExpanded(!expanded)}>{expanded ? t('접기') : t('{n}개 더 보기', { n: rest })}</button>
          )}
          {data.footer}
        </div>
      )}
    </section>
  )
}

const BUILTIN_TITLE: Record<BuiltinTile, string> = {
  today: '오늘 일정',
  overdue: '기한이 지난 일',
  decisions: '결정할 일',
  dueToday: '오늘 마감',
  week: '이번 주',
  waiting: '대기 중인 일',
  doing: '진행 중',
  unowned: '담당자 없는 일',
  triage: '정리할 업무',
  projects: '프로젝트',
}
/** 켜 둔 타일이 비었을 때 마우스를 올리면 보이는 설명(이 타일에 어떤 일이 모이는지). 제목을 되풀이하지 않고 화면에는 "지금은 없어요"만 보인다 */
export const EMPTY_TEXT: Record<BuiltinTile, string> = {
  today: '오늘의 일정과 할 일이 여기에 모여요',
  overdue: '마감이 지났는데 아직 끝나지 않은 일이 여기에 모여요',
  decisions: '결정이 필요한 일이 여기에 모여요',
  dueToday: '오늘이 마감인 일이 여기에 모여요',
  week: '이번 주에 마감인 일이 여기에 모여요',
  waiting: '내가 답이나 결과를 기다리는 일이 여기에 모여요',
  doing: '지금 하고 있는 일이 여기에 모여요',
  unowned: '담당자가 정해지지 않은 일이 여기에 모여요',
  triage: '아직 프로젝트에 넣지 않은 새 업무가 여기에 모여요',
  projects: '프로젝트가 여기에 모여요',
}

/** 켜 둔 타일인데 비어 있을 때: 화면에서 빼지 않고 얇은 한 줄로 보인다(역할에 맞춰 고른 구성이 보이도록) */
export function EmptyTile({ title, text, tone }: { title: string; /** 이 타일에 모이는 일(마우스를 올리면) */ text: string; tone?: string }) {
  return (
    <section className={`wrk-sec wrk-tile wrk-tile-empty ${tone ?? ''}`} title={text}>
      <span className="wrk-tname">{title}</span>
      <span className="hint">{t('지금은 없어요')}</span>
    </section>
  )
}

const QUEUE_OF: Partial<Record<BuiltinTile, keyof Omit<Queues, 'total'>>> = { overdue: 'overdue', decisions: 'decisions', dueToday: 'today', week: 'week', waiting: 'waiting', doing: 'doing', unowned: 'unowned' }

export function WorkHome() {
  const work = useWork()
  const files = useApp((s) => s.files)
  const views = useMemo(() => readViews(files), [files])
  const layout = useWorkUi((s) => s.layout)
  const editing = useWorkUi((s) => s.editing)
  const health = useHealth(work)
  const myName = useApp((s) => s.settings.myName)
  const me = useMemo(() => parseMe(myName), [myName])
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const today = todayYmd()
  const q = useMemo(() => buildQueues(work, today, scope === 'mine' ? me : []), [work, today, scope, me])
  // "내 것"만 보는 중에 다른 사람 담당 일이 얼마나 가려져 있는지(빈 화면의 이유를 알려 주려고)
  const allQ = useMemo(() => buildQueues(work, today, []), [work, today])
  const hiddenByScope = scope === 'mine' ? allQ.total + allQ.doing.length + allQ.unowned.length - (q.total + q.doing.length + q.unowned.length) : 0
  const projects = useMemo(() => new Map(work.projects.map((p) => [p.path, p])), [work])
  const empty = work.tasks.length === 0 && work.projects.length === 0
  // 마감일(due)이 일정으로도 잡히므로, 업무 대기열에 이미 있는 항목은 오늘 일정에서 뺀다 (두 번 보이지 않게)
  const cal = useCalMap()
  const taskIds = useMemo(() => new Set(work.tasks.map((x) => x.id)), [work])
  const todayEvents = (cal.get(today) ?? []).filter((e) => !taskIds.has(e.id))
  // 학생처럼 업무 꼬리표 없이 날짜만 적은 과제(종일 체크리스트)도 이번 주·기한이 지난 일에 함께 보인다(페르소나 F21)
  const dayItems = useMemo(() => buildDayItems(cal, taskIds, today), [cal, taskIds, today])
  const customs = useMemo(() => views.map((v) => v.name), [views])
  const tiles = resolveTiles(layout, customs)
  // 역할 구성에서 빠졌어도(학생) 프로젝트가 하나라도 있으면 프로젝트 타일을 보인다(layout.auto — 직접 끄거나 켜면 그 뜻을 따른다)
  // `정리할 업무`도 같다: 받은 업무(프로젝트에 안 넣은 열린 업무)가 있고 옮겨 넣을 프로젝트가 있으면 보인다
  const hasLoose = work.projects.length > 0 && work.tasks.some((x) => !x.project && !x.done && x.state !== 'dropped')
  const autoShow = (id: string) => !!layout.auto?.includes(id) && (id === 'projects' ? work.projects.length > 0 : id === 'triage' ? hasLoose : false)
  const projectsShown = tiles.some((x) => x.id === 'projects' && (!x.hidden || autoShow('projects')))
  const patch = useWorkUi.getState().patchLayout
  const setEditing = (on: boolean) => useWorkUi.setState({ editing: on })
  /** 완료: 설정에서 들어왔으면 설정으로 돌아간다 */
  const finishEditing = () => {
    const back = useWorkUi.getState().returnTo
    useWorkUi.setState({ editing: false, returnTo: null })
    if (back) useApp.getState().go(back)
  }


  const dataFor = (id: string): TileData | null => {
    if (isCustom(id)) {
      const v = views.find((x) => x.name === customName(id))
      if (!v) return null
      const tasks = applyView(work, v, today, me)
      return { title: v.name, rows: tasks.map((tk) => <TaskRow key={tk.id} q={itemOf(tk, today)} projects={projects} />), limitable: true, alwaysShow: true, emptyText: t('조건에 맞는 열린 업무가 없어요.'), custom: v }
    }
    const b = id as BuiltinTile
    const qk = QUEUE_OF[b]
    if (qk) {
      const tone = b === 'overdue' ? 'danger' : b === 'waiting' ? 'warn' : undefined
      const extra = b === 'week' ? dayItems.week : b === 'overdue' ? dayItems.overdue : []
      // 업무와 과제를 날짜순으로 섞는다(같은 날짜면 업무가 먼저)
      const merged = [
        ...q[qk].map((it) => ({ date: it.task.due ?? '', node: <TaskRow key={it.task.id + qk} q={it} projects={projects} /> })),
        ...extra.map((it) => ({ date: it.ev.date, node: <DayItemRow key={it.ev.id + it.ev.date} it={it} /> })),
      ].sort((a, c) => a.date.localeCompare(c.date))
      return { title: t(BUILTIN_TITLE[b]), tone, rows: merged.map((x) => x.node), limitable: true }
    }
    if (b === 'today') {
      return {
        title: t(BUILTIN_TITLE.today),
        rows: todayEvents.map((e) => <EventRow key={e.id + e.date} ev={e} />),
        top: <div className="wrk-add-inline"><QuickAdd date={today} /></div>,
        emptyText: t('이 날은 일정이 없습니다.'),
        alwaysShow: true,
        limitable: false,
      }
    }
    if (b === 'triage') {
      const loose = work.tasks.filter((x) => !x.project && !x.done && x.state !== 'dropped')
      if (work.projects.length === 0) return { title: t(BUILTIN_TITLE.triage), rows: [], limitable: true }
      return {
        title: t(BUILTIN_TITLE.triage),
        rows: loose.map((tk) => <TriageRow key={tk.id} tk={tk} work={work} />),
        top: loose.length ? <p className="hint wrk-triage-hint">{t('프로젝트를 고르면 그 프로젝트의 할 일 노트로 옮겨져요.')}</p> : undefined,
        limitable: true,
      }
    }
    // projects
    return {
      title: t(BUILTIN_TITLE.projects),
      count: work.projects.length || undefined,
      rows: work.projects.map((p) => {
        const ts = work.byProject.get(p.path) ?? []
        const open = ts.filter((x) => !x.done && x.state !== 'dropped').length
        const h = health.get(p.path)
        return (
          <button key={p.path} className="wrk-projrow" onClick={() => useWorkUi.getState().openHub(p.path)}>
            <span className="wrk-pname">{p.name}</span>
            <span className="wrk-pmeta">
              {p.status && <em>{p.status}</em>}
              {h && h.level !== 'ok' && <span className={`wrk-health ${h.level}`}>{healthLabel(h)}</span>}
              {p.due && <span>{t('마감 {d}', { d: p.due.slice(5) })}</span>}
              <span>{t('열린 일 {n}/{m}', { n: open, m: ts.length })}</span>
            </span>
          </button>
        )
      }),
      footer: <button className="wrk-newproj" onClick={() => useWorkUi.setState({ wizard: true })}>+ {t('새 프로젝트')}</button>,
      alwaysShow: true,
      limitable: false,
    }
  }

  const titleOf = (id: string) => (isCustom(id) ? customName(id) : t(BUILTIN_TITLE[id as BuiltinTile]))
  const arrRows = tiles.map((x) => ({ ...x, title: titleOf(x.id), limitable: x.id !== 'today' && x.id !== 'projects', custom: isCustom(x.id) }))

  return (
    <div className="work">
      <div className="panel-head">
        <h2>{t('내 업무')}<small>{fmtDay(today)}</small></h2>
        <div className="head-actions">
          {!desktop() && !editing && <button className="icon-btn" onClick={() => useAiThread.getState().toggle()} title={t('AI')} aria-label={t('AI')}><Icon name="spark" /></button>}
          {editing ? (
            <button className="primary head-done" onClick={finishEditing}>{t('완료')}</button> // 설정 버튼이 있던 자리(헤더 오른쪽 끝)에서 끝낸다
          ) : (
            <button className="icon-btn" title={t('화면 편집')} aria-pressed={false} onClick={() => setEditing(true)}><Icon name="sliders" /></button>
          )}
        </div>
      </div>
      <div className="wrk-scroll">
        <div className="wrk-inner">
          {editing && (
            <div className="wrk-editbar">
              <span>{t('켜 둔 타일은 끌어서 순서를 바꾸고, 안 쓰는 타일은 스위치를 꺼서 아래로 내리세요. 터치에서는 줄을 꾹 눌러도 돼요.')}</span>
            </div>
          )}

          {!editing && <ProposalBanner />}

          {me.length > 0 ? (
            <div className="seg wrk-scope">
              <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>{t('내 것 ({name})', { name: me[0] })}</button>
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>{t('전체')}</button>
            </div>
          ) : (
            work.tasks.length > 0 && (
              <button className="wrk-setname" onClick={openMyNameSetting}>{t('내 이름 설정 →')}</button>
            )
          )}

          {!editing && me.length > 0 && scope === 'mine' && hiddenByScope > 0 && (
            <p className="hint small wrk-scope-hint">
              {t('담당자가 "{name}"인 일만 보여요. 다른 사람 담당 일 {n}개는 가려져 있어요.', { name: me[0], n: hiddenByScope })}{' '}
              <button className="btn-link" onClick={() => setScope('all')}>{t('전체 보기')}</button>
            </p>
          )}

          {editing ? (
            <>
              <div className="arr-title">{t('켜 둔 타일')}</div>
              <TileArranger
                rows={arrRows.filter((x) => !x.hidden)}
                onOrder={(ids) => patch((l) => reorderVisible(l, customs, ids))}
                onHidden={(id, h) => patch((l) => (h ? disableTile(l, customs, id) : enableTile(l, customs, id)))}
                onLimit={(id, n) => patch((l) => setLimit(l, id, n))}
                onCondition={(id) => { const v = views.find((x) => x.name === customName(id)); if (v) useWorkUi.setState({ viewEditor: { view: v } }) }}
              />
              <div className="arr-title">{t('더 추가하기')}</div>
              <TileAdder rows={arrRows.filter((x) => x.hidden)} onAdd={(id) => patch((l) => enableTile(l, customs, id))} />
              <button className="wrk-newproj" onClick={() => useWorkUi.setState({ viewEditor: {} })}>+ {t('조건으로 새 타일 만들기')}</button>
            </>
          ) : (
            <div className="wrk-tiles">{tiles.filter((x) => !x.hidden || autoShow(x.id)).map((tile) => {
              const data = dataFor(tile.id)
              if (!data) return null
              if (!data.alwaysShow && data.rows.length === 0) return <EmptyTile key={tile.id} title={data.title} text={t(EMPTY_TEXT[tile.id as BuiltinTile] ?? '')} tone={data.tone} /> // 켜 둔 타일은 비어도 한 줄로 남긴다
              return <TileView key={tile.id} id={tile.id} data={data} limit={tile.limit} collapsed={tile.collapsed} />
            })}</div>
          )}

          {!editing && work.tasks.length > 0 && q.total === 0 && q.doing.length === 0 && q.unowned.length === 0 && (
            <p className="hint pad wrk-clear">{t('밀린 일이 없습니다. 👍')}</p>
          )}

          {/* 프로젝트 타일이 없는 구성(학생)에서도 첫 프로젝트를 만들 길이 있게 한다 */}
          {!editing && !empty && !projectsShown && (
            <button className="wrk-newproj" onClick={() => useWorkUi.setState({ wizard: true })}>+ {t('새 프로젝트')}</button>
          )}

          {empty && (
            <div className="wrk-guide">
              <div className="wrk-guide-orb"><Orb size={64} className="ob-orb" /></div>
              <h3>{t('프로젝트를 만들어 시작해 보세요')}</h3>
              <p>{t('프로젝트를 만들면 할 일, 문서, 일정이 한곳에 모여요. 템플릿을 고르면 바로 시작할 수 있어요.')}</p>
              <div className="wrk-guide-actions"><button className="primary" onClick={() => useWorkUi.setState({ wizard: true })}>{t('새 프로젝트 만들기')}</button></div>
              <details className="wrk-guide-adv">
                <summary>{t('노트에 직접 적어서 시작하려면')}</summary>
                <p>{t('노트 맨 위에 프로젝트 표시를 넣고, 할 일은 체크박스 줄로 적으면 여기에 모여요. 마감일과 담당자는 줄 끝에 적어요.')}</p>
                <pre>{`---\ntype: project\nstatus: active\n---\n\n- [ ] 견적서 수정 due:2026-11-12 owner:홍길동\n- [ ] 확인 요청 status:waiting due:2026-11-14`}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
      {!editing && <div className="wrk-foot"><QuickAdd date={today} /></div>}
    </div>
  )
}
