// 업무 편집기: 제목·상태·마감·담당자·우선순위·프로젝트를 폼으로 고른다. 결과는 노트의 체크리스트 한 줄(꼬리표)로 저장된다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { confirmAsk } from '../lib/dialog'
import { fmtDay, todayYmd } from '../lib/calendar'
import { addDaysYmd, parseMe, tokensForState, uiStateOf, type Task, type UiState } from '../lib/work'
import { addTask, deleteTask, updateTask, useWorkUi } from '../lib/workOps'
import { Icon } from './Icon'
import { useWork } from './WorkHome'

export function TaskEditor() {
  const ed = useWorkUi((s) => s.editor)
  if (!ed) return null
  return <Form key={ed.task?.id ?? 'new:' + (ed.project ?? '')} task={ed.task} project={ed.project ?? null} />
}

const STATES: [UiState, string][] = [
  ['todo', '할 일'],
  ['doing', '진행 중'],
  ['waiting', '답 대기'],
  ['dropped', '접음'],
]

function Form({ task, project }: { task?: Task; project: string | null }) {
  const work = useWork()
  const myName = useApp((s) => s.settings.myName)
  const close = () => useWorkUi.getState().closeEditor()
  const titleRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState(task?.title ?? '')
  const [ui, setUi] = useState<UiState>(task ? uiStateOf(task) : 'todo')
  const [done, setDone] = useState(task?.done ?? false)
  const [due, setDue] = useState(task?.due ?? '')
  const [owner, setOwner] = useState(task?.owner.join(', ') ?? '')
  const [p, setP] = useState<0 | 1 | 2 | 3>(task?.p ?? 0)
  const [proj, setProj] = useState(task ? task.project ?? '' : project ?? '')
  const [conclusion, setConclusion] = useState(task?.conclusion ?? '')

  useEffect(() => {
    if (!task) titleRef.current?.focus()
    const f = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [task])

  // 담당자 입력 제안: 지금까지 쓰인 이름들
  const owners = useMemo(() => {
    const set = new Set<string>(parseMe(myName))
    for (const x of work.tasks) x.owner.forEach((o) => set.add(o))
    for (const x of work.projects) x.owner.forEach((o) => set.add(o))
    return [...set].sort()
  }, [work, myName])

  const today = todayYmd()
  const projects = work.projects
  const noTitle = !title.trim()

  const save = () => {
    if (noTitle) return
    const ownerList = owner.split(/[,，]/).map((x) => x.trim()).filter(Boolean)
    const curProj = task?.project ?? ''
    const projName = proj ? projects.find((x) => x.path === proj)?.name : undefined
    const base = {
      due: due || undefined,
      owner: ownerList.length ? ownerList : undefined,
      p: p || undefined,
      impact: task?.impact,
      conclusion: (done || ui === 'dropped') && conclusion.trim() ? conclusion.trim() : undefined,
      // 프로젝트를 바꿨을 때만 proj: 를 쓴다 (폴더로 이미 소속된 경우는 건드리지 않는다)
      // 새 업무는 프로젝트의 노트에 넣으므로 꼬리표가 필요 없다
      proj: task ? (proj === curProj ? task.explicitProj : projName) : undefined,
    }
    const edit = { title: title.trim(), done, tokens: tokensForState(ui, base) }
    if (task) {
      if (!updateTask(task, edit)) return
    } else {
      const path = addTask(edit, proj || null)
      useApp.getState().say(t('{path} 에 추가했어요', { path: path.replace(/\.md$/, '') }))
    }
    close()
  }

  const remove = async () => {
    if (!task) return
    if (!(await confirmAsk(t('업무를 삭제할까요?'), task.title, t('삭제'), true))) return
    deleteTask(task)
    close()
  }

  return (
    <div className="ee-wrap" onClick={close}>
      <div className="ee" role="dialog" aria-label={task ? t('업무 수정') : t('새 업무')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{task ? t('업무 수정') : t('새 업무')}</h3>
          <button className="icon-btn" onClick={close} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>

        <div className="ee-body">
          <label className="ee-field">
            <span>{t('제목')}</span>
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && save()} placeholder={t('무슨 일인가요?')} />
          </label>

          <div className="ee-field">
            <span>{t('상태')}</span>
            <div className="ee-days te-states">
              {STATES.map(([v, l]) => <button key={v} className={ui === v ? 'on' : ''} onClick={() => setUi(v)}>{t(l)}</button>)}
            </div>
          </div>
          <label className="ee-check">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            <span>{t('완료')}</span>
          </label>
          {(done || ui === 'dropped') && (
            <label className="ee-field">
              <span>{t('결론 (한 줄)')}</span>
              <input value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder={t('어떻게 하기로 했나요?')} />
            </label>
          )}

          <label className="ee-field">
            <span>{t('마감일')}</span>
            <span className="ee-clearable">
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              {due && <button className="ee-x" onClick={() => setDue('')} aria-label={t('마감일 지우기')}>×</button>}
            </span>
          </label>
          <div className="ee-chips">
            {([[0, '오늘'], [1, '내일'], [7, '일주일 뒤']] as const).map(([n, l]) => {
              const v = addDaysYmd(today, n)
              return <button key={n} className={due === v ? 'on' : ''} onClick={() => setDue(v)}>{t(l)}</button>
            })}
          </div>
          {due && <p className="hint small te-note">{fmtDay(due)}{due < today && !done ? ` · ${t('기한이 지났어요')}` : ''}</p>}

          <label className="ee-field">
            <span>{t('담당자')}</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} list="te-owners" placeholder={t('이름 (쉼표로 여러 명)')} />
            <datalist id="te-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
          </label>
          {parseMe(myName).length > 0 && !owner && (
            <div className="ee-chips"><button onClick={() => setOwner(parseMe(myName)[0])}>{t('나')} ({parseMe(myName)[0]})</button></div>
          )}

          <div className="ee-field">
            <span>{t('우선순위')}</span>
            <div className="ee-days te-states">
              {([[0, '없음'], [1, '높음'], [2, '보통'], [3, '낮음']] as const).map(([v, l]) => <button key={v} className={p === v ? 'on' : ''} onClick={() => setP(v)}>{t(l)}</button>)}
            </div>
          </div>

          <label className="ee-field">
            <span>{t('프로젝트')}</span>
            <select value={proj} onChange={(e) => setProj(e.target.value)}>
              <option value="">{t('프로젝트 없음')}</option>
              {projects.map((x) => <option key={x.path} value={x.path}>{x.name}</option>)}
            </select>
          </label>
          {!task && <p className="hint small te-note">{proj ? t('선택한 프로젝트 폴더의 "할 일" 노트에 추가돼요.') : t('"받은 업무" 노트에 추가돼요. 나중에 프로젝트로 옮길 수 있어요.')}</p>}
        </div>

        <div className="ee-foot">
          {task && <button className="danger-link ee-del" onClick={() => void remove()}>{t('삭제')}</button>}
          {task && <button className="link-btn" onClick={() => { close(); useApp.getState().openNote(task.path) }}>{t('노트에서 보기')}</button>}
          <span className="grow" />
          <button onClick={close}>{t('취소')}</button>
          <button className="primary" disabled={noTitle} onClick={save}>{t('저장')}</button>
        </div>
      </div>
    </div>
  )
}
