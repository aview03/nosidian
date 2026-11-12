// 노트 "업무 정리" 화면: 회의록 같은 노트의 열린 체크리스트 줄을 모아 제목·담당·마감·결정 여부를 한 번에 정한다(페르소나 F24).
// 제목의 `(민수, 11/18까지)`·`@민수`·`11/18까지` 는 미리 읽어 채워 두고(확인 표시), 적용은 되돌리기 한 번으로 묶는다. 로직: lib/noteTasks.ts
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { todayYmd } from '../lib/calendar'
import { applyDecisions, applyRows, buildDecisionRows, buildRows, rowChanged, suggestOwner, type DecisionRow, type TaskRow } from '../lib/noteTasks'
import { parseMe } from '../lib/work'
import { useWorkUi, withUndo } from '../lib/workOps'
import { baseName } from '../lib/links'
import { Icon } from './Icon'
import { useWork } from './WorkHome'
import { useBackClose } from '../lib/backStack'

export function NoteTasksSheet() {
  const path = useWorkUi((s) => s.tidy)
  if (!path) return null
  return <Sheet key={path} path={path} />
}

const splitNames = (v: string) => v.split(/[,，]/).map((x) => x.trim()).filter(Boolean)

function Sheet({ path }: { path: string }) {
  const close = () => useWorkUi.getState().closeTidy()
  useBackClose(true, close)
  const work = useWork()
  const myName = useApp((s) => s.settings.myName)
  const content = useApp((s) => s.files[path]?.content ?? '')
  const today = todayYmd()
  // 아는 이름: 업무·프로젝트의 담당자 + 내 이름
  const known = useMemo(() => {
    const set = new Set<string>(parseMe(myName))
    for (const x of work.tasks) x.owner.forEach((o) => set.add(o))
    for (const x of work.projects) x.owner.forEach((o) => set.add(o))
    return set
  }, [work, myName])
  const [rows, setRows] = useState<TaskRow[]>(() => buildRows(content, known, today))
  // 담당 입력칸은 쉼표·공백을 치는 도중에도 그대로 보여야 하므로 글자를 따로 들고 있는다
  const [ownerText, setOwnerText] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((r) => [r.line, r.owner.join(', ')])))
  const [drows, setDrows] = useState<DecisionRow[]>(() => buildDecisionRows(content))
  const changed = rows.filter(rowChanged)
  const decided = drows.filter((d) => d.on)
  const total = changed.length + decided.length

  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  const set = (line: number, patch: Partial<TaskRow>) => setRows((rs) => rs.map((r) => (r.line === line ? { ...r, ...patch } : r)))
  const setD = (line: number, patch: Partial<DecisionRow>) => setDrows((rs) => rs.map((r) => (r.line === line ? { ...r, ...patch } : r)))

  const apply = () => {
    if (!total) return
    const n = total
    withUndo({ path }, t('업무 {n}개를 정리했어요', { n }), () => {
      const app = useApp.getState()
      const f = app.files[path]
      if (!f || f.deleted) return false
      const next = applyDecisions(applyRows(f.content, rows), drows)
      if (next === f.content) return false
      app.setContent(path, next)
      return true
    })
    close()
  }

  const owners = [...known].sort((a, b) => a.localeCompare(b, 'ko'))

  return (
    <div className="ee-wrap" onClick={close}>
      <div className="ee nt" role="dialog" aria-label={t('업무 정리')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{t('업무 정리')} <small className="nt-name">{baseName(path)}</small></h3>
          <button className="icon-btn" onClick={close} aria-label={t('닫기')}><Icon name="close" /></button>
        </div>
        <div className="ee-body">
          {rows.length === 0 && drows.length === 0 ? (
            <p className="hint pad">{t('이 노트에는 열린 할 일 줄(- [ ])이 없어요.')}</p>
          ) : (
            <>
              <p className="hint small nt-intro">{t('이 노트의 할 일 줄이에요. 담당·마감을 한 번에 정하면 프로젝트 허브와 내 업무에 반영돼요. 제목에서 읽어 채운 값은 맞는지 확인해 주세요.')}</p>
              {rows.map((r) => (
                <div key={r.line} className={`nt-row${rowChanged(r) ? ' changed' : ''}`}>
                  <input className="nt-title" value={r.title} aria-label={t('제목')} onChange={(e) => set(r.line, { title: e.target.value })} />
                  <div className="nt-fields">
                    <input
                      className="nt-owner"
                      list="nt-owners"
                      placeholder={t('담당')}
                      aria-label={t('담당')}
                      value={ownerText[r.line] ?? ''}
                      onChange={(e) => {
                        setOwnerText((o) => ({ ...o, [r.line]: e.target.value }))
                        set(r.line, { owner: splitNames(e.target.value) })
                      }}
                    />
                    <input className="nt-due" type="date" aria-label={t('마감')} value={r.due ?? ''} onChange={(e) => set(r.line, { due: e.target.value || undefined })} />
                    <button className={`nt-dec${r.decision ? ' on' : ''}`} aria-pressed={r.decision} title={t('결정이 필요한 안건')} onClick={() => set(r.line, { decision: !r.decision })}>{t('결정')}</button>
                  </div>
                  {(() => {
                    const sg = (ownerText[r.line] ?? '').trim() ? null : suggestOwner(r.title, known)
                    return sg ? (
                      <p className="nt-suggest">
                        <span>{t('"{name}"을(를) 담당으로 쓸까요?', { name: sg.name })}</span>
                        <button onClick={() => { setOwnerText((o) => ({ ...o, [r.line]: sg.name })); set(r.line, { title: sg.title, owner: [sg.name] }) }}>{t('담당으로 쓰기')}</button>
                      </p>
                    ) : null
                  })()}
                  {r.hinted && (
                    <p className="nt-hint">
                      <b>{t('제목에서 읽었어요')}</b> · {t('원문')}: {r.init.title}
                    </p>
                  )}
                </div>
              ))}
              {drows.length > 0 && (
                <>
                  <h4 className="nt-sec">{t('결정 사항')}</h4>
                  <p className="hint small nt-intro">{t('"결정" 아래에 글로 적은 내용이에요. 기록으로 남기면 완료된 결정 안건(결론 포함)이 되어 프로젝트 허브에서 찾을 수 있어요.')}</p>
                  {drows.map((d) => (
                    <div key={d.line} className={`nt-row dec${d.on ? ' changed' : ''}`}>
                      <label className="nt-check">
                        <input type="checkbox" checked={d.on} onChange={(e) => setD(d.line, { on: e.target.checked })} />
                        <span>{t('결정 기록으로 남기기')}</span>
                      </label>
                      {d.on ? (
                        <div className="nt-concl">
                          <input className="nt-title" value={d.title} aria-label={t('안건')} placeholder={t('안건')} onChange={(e) => setD(d.line, { title: e.target.value })} />
                          <input className="nt-owner" value={d.conclusion} aria-label={t('결론')} placeholder={t('결론')} onChange={(e) => setD(d.line, { conclusion: e.target.value })} />
                        </div>
                      ) : (
                        <p className="nt-hint">{d.init}</p>
                      )}
                    </div>
                  ))}
                </>
              )}
              <datalist id="nt-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
            </>
          )}
        </div>
        <div className="ee-foot">
          <span className="grow" />
          <button onClick={close}>{t('취소')}</button>
          <button className="primary" disabled={!total} onClick={apply}>{total ? t('{n}개 적용', { n: total }) : t('적용')}</button>
        </div>
      </div>
    </div>
  )
}
