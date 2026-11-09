// 보기 편집기: 담당자·프로젝트·상태·마감 같은 조건을 골라 이름을 붙여 저장한다. 조건을 바꾸는 동안 맞는 업무 수를 바로 보여 준다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { todayYmd } from '../lib/calendar'
import { parseMe } from '../lib/work'
import { applyView, isEmptyView, readViews, type View, type ViewDue, type ViewStatus } from '../lib/views'
import { confirmAsk } from '../lib/dialog'
import { deleteView, saveView, useWorkUi } from '../lib/workOps'
import { Icon } from './Icon'
import { Select } from './Select'
import { useWork } from './WorkHome'

export function ViewEditor() {
  const ed = useWorkUi((s) => s.viewEditor)
  if (!ed) return null
  return <Form key={ed.view?.name ?? 'new'} view={ed.view} />
}

function Form({ view }: { view?: View }) {
  const close = () => useWorkUi.setState({ viewEditor: null })
  const work = useWork()
  const files = useApp((s) => s.files)
  const myName = useApp((s) => s.settings.myName)
  const me = useMemo(() => parseMe(myName), [myName])
  const [name, setName] = useState(view?.name ?? '')
  const [owner, setOwner] = useState(view?.owner ?? '')
  const [project, setProject] = useState(view?.project ?? '')
  const [status, setStatus] = useState<ViewStatus | ''>(view?.status ?? '')
  const [due, setDue] = useState<ViewDue | ''>(view?.due ?? '')
  const [q, setQ] = useState(view?.q ?? '')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!view) ref.current?.focus()
    const f = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  const cond: View = { name: name.trim(), owner: owner.trim() || undefined, project: project || undefined, status: status || undefined, due: due || undefined, q: q.trim() || undefined }
  const count = useMemo(() => applyView(work, cond, todayYmd(), me).length, [work, owner, project, status, due, q, me])
  const taken = readViews(files).some((v) => v.name.toLowerCase() === cond.name.toLowerCase() && v.name.toLowerCase() !== (view?.name ?? '').toLowerCase())
  const invalid = !cond.name || taken || isEmptyView(cond)

  const save = () => {
    if (invalid) return
    saveView(cond, view?.name)
    close()
  }
  const remove = async () => {
    if (!view) return
    if (!(await confirmAsk(t('타일을 삭제할까요?'), view.name, t('삭제'), true))) return
    deleteView(view.name)
    close()
  }

  const owners = useMemo(() => [...new Set(work.tasks.flatMap((x) => x.owner))].sort(), [work])

  return (
    <div className="ee-wrap" onClick={close}>
      <div className="ee" role="dialog" aria-label={view ? t('타일 수정') : t('새 타일')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{view ? t('타일 수정') : t('새 타일')}</h3>
          <button className="icon-btn" onClick={close} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>
        <div className="ee-body">
          <label className="ee-field">
            <span>{t('타일 이름')}</span>
            <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('예) 이번 주 내 일')} />
          </label>
          {taken && <p className="hint small te-note">{t('같은 이름의 타일이 이미 있어요.')}</p>}

          <label className="ee-field">
            <span>{t('담당자')}</span>
            <input value={owner === 'me' ? '' : owner === 'none' ? '' : owner} onChange={(e) => setOwner(e.target.value)} list="ve-owners" placeholder={owner === 'me' ? t('내 이름(설정)') : owner === 'none' ? t('담당자 없는 일') : t('이름 (비우면 전체)')} disabled={owner === 'me' || owner === 'none'} />
            <datalist id="ve-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
          </label>
          <div className="ee-chips">
            <button className={owner === 'me' ? 'on' : ''} onClick={() => setOwner(owner === 'me' ? '' : 'me')}>{t('나')}{me[0] ? ` (${me[0]})` : ''}</button>
            <button className={owner === 'none' ? 'on' : ''} onClick={() => setOwner(owner === 'none' ? '' : 'none')}>{t('담당자 없음')}</button>
            {owner && <button onClick={() => setOwner('')}>{t('지우기')}</button>}
          </div>

          <div className="ee-field">
            <span>{t('프로젝트')}</span>
            <Select value={project} title={t('프로젝트')} ariaLabel={t('프로젝트')} onChange={setProject} options={[{ value: '', label: t('전체') }, { value: 'none', label: t('프로젝트 없음') }, ...work.projects.map((p) => ({ value: p.name, label: p.name, hint: p.status }))]} />
          </div>
          <div className="ee-field">
            <span>{t('상태')}</span>
            <Select<ViewStatus | ''> value={status} title={t('상태')} ariaLabel={t('상태')} onChange={setStatus} options={[{ value: '', label: t('전체') }, { value: 'todo', label: t('할 일') }, { value: 'doing', label: t('진행 중') }, { value: 'waiting', label: t('대기') }, { value: 'decision', label: t('결정할 일') }]} />
          </div>
          <div className="ee-field">
            <span>{t('마감')}</span>
            <Select<ViewDue | ''> value={due} title={t('마감')} ariaLabel={t('마감')} onChange={setDue} options={[{ value: '', label: t('전체') }, { value: 'overdue', label: t('기한 지남') }, { value: 'today', label: t('오늘') }, { value: 'week', label: t('이번 주 (7일 이내)') }, { value: 'none', label: t('마감일 없음') }]} />
          </div>
          <label className="ee-field">
            <span>{t('제목에 들어간 글')}</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('비우면 전체')} />
          </label>
          <p className="hint small te-note">{isEmptyView(cond) ? t('조건을 하나 이상 골라 주세요.') : t('지금 조건에 맞는 열린 업무: {n}개', { n: count })}</p>
        </div>
        <div className="ee-foot">
          {view && <button className="danger-link ee-del" onClick={() => void remove()}>{t('삭제')}</button>}
          <span className="grow" />
          <button onClick={close}>{t('취소')}</button>
          <button className="primary" disabled={invalid} onClick={save}>{t('저장')}</button>
        </div>
      </div>
    </div>
  )
}
