// 새 프로젝트 마법사: 템플릿을 고르고 이름·마감일·담당자를 넣으면 폴더와 문서를 만들어 준다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { getLang, t } from '../lib/i18n'
import { projectsRoot } from '../lib/defaultFolders'
import { todayYmd } from '../lib/calendar'
import { parseMe } from '../lib/work'
import { builtinTemplates, planProject, vaultTemplates, defaultTemplateId } from '../lib/projectTemplates'
import { useWorkUi } from '../lib/workOps'
import { Icon } from './Icon'
import { useBackClose } from '../lib/backStack'

export function NewProject() {
  const open = useWorkUi((s) => s.wizard)
  if (!open) return null
  return <Wizard />
}

function Wizard() {
  const close = () => useWorkUi.setState({ wizard: false })
  useBackClose(true, close)
  const myName = useApp((s) => s.settings.myName)
  const files = useApp((x) => x.files)
  const templates = useMemo(() => [...builtinTemplates(), ...vaultTemplates(files)], [files])
  const persona = useApp((s) => s.settings.persona)
  const [tpl, setTpl] = useState(() => defaultTemplateId(persona, templates.map((x) => x.id))) // 역할에 맞는 틀을 먼저 골라 둔다(바꿀 수 있다)
  const [name, setName] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState(parseMe(myName)[0] ?? '')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const f = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  const chosen = templates.find((x) => x.id === tpl) ?? templates[0]
  const needsDue = chosen.mine ? /\{\{due/.test(JSON.stringify(chosen.files)) : chosen.id !== 'general'
  const noName = !name.trim()

  const create = () => {
    if (noName) return
    const app = useApp.getState()
    const live = Object.keys(app.files).filter((p) => !app.files[p].deleted)
    const plan = planProject(chosen, { name: name.trim(), owner: owner.trim(), due, today: todayYmd() }, projectsRoot(live, getLang()), live)
    for (const [path, content] of Object.entries(plan.files)) app.createNote(path, content, false)
    app.say(t('"{name}" 프로젝트를 만들었어요', { name: name.trim() }))
    close()
    useWorkUi.getState().openHub(plan.overview)
  }

  return (
    <div className="ee-wrap" onClick={close}>
      <div className="ee" role="dialog" aria-label={t('새 프로젝트')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{t('새 프로젝트')}</h3>
          <button className="icon-btn" onClick={close} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>
        <div className="ee-body">
          <label className="ee-field">
            <span>{t('프로젝트 이름')}</span>
            <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && create()} placeholder={t('예) 봄 행사')} />
          </label>

          <div className="ee-field">
            <span>{t('템플릿')}</span>
            <div className="np-tpls">
              {templates.map((x) => (
                <button key={x.id} className={`np-tpl${tpl === x.id ? ' on' : ''}`} onClick={() => setTpl(x.id)}>
                  <b>{x.name}{x.mine && <em className="np-mine">{t('내 템플릿')}</em>}</b>
                  <small>{x.desc}</small>
                </button>
              ))}
            </div>
          </div>

          <label className="ee-field">
            <span>{needsDue ? t('마감일 (행사일·배포일)') : t('마감일')}</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          {needsDue && <p className="hint small te-note">{due ? t('준비 일정이 이 날짜에서 거꾸로 잡혀요.') : t('마감일을 넣으면 준비 일정의 날짜가 자동으로 잡혀요.')}</p>}

          <label className="ee-field">
            <span>{t('담당자')}</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={t('이름')} />
          </label>
        </div>
        <div className="ee-foot">
          <span className="grow" />
          <button onClick={close}>{t('취소')}</button>
          <button className="primary" disabled={noName} onClick={create}>{t('만들기')}</button>
        </div>
      </div>
    </div>
  )
}
