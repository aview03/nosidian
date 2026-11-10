// 설정 > AI 자동 문서 관리 (PC 전용). 설계: docs/AUTOMATION.md
// v1.28: 새 문제를 감지해 분석 대기열에 올리고 알려 준다. AI 는 부르지 않는다(자동 분석은 v1.29).
// 확인할 문제 = 새 문제와 앞으로 AI 분석이 필요한 작업 목록. 시험 실행 = 이 설정이었다면 무엇을 AI 에 보냈을지(이유 포함).
import { useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { desktop } from '../lib/externalIO'
import { runDry, useAutomation } from '../lib/automation'
import { CAPS, DEBOUNCES, changedPaths, describePolicy, type AutoMode, type SkipReason } from '../lib/autoTriggers'
import type { LintKind } from '../lib/doclint'
import { Select } from './Select'

const KIND: Record<LintKind, string> = {
  duplicate: '중복 문서 후보', singletonDup: '하나뿐이어야 하는 역할이 둘 이상', roleConflict: '역할 충돌', roleMisplaced: '역할의 자리가 어긋남',
  unknownRole: '모르는 역할', missingDoc: '없는 문서', missingSection: '필수 제목 누락', emptySection: '빈 제목', badStatus: '허용되지 않는 status',
  noStatus: 'status 없음', brokenLink: '끊어진 링크', brokenAnchor: '끊어진 앵커', orphan: '고아 문서', unreachable: '개요에서 닿지 않음',
}
const REASON: Record<SkipReason, string> = {
  baseline: '기존 문제(기준선) — 새 문제가 아니에요',
  known: '이미 알고 있는 문제',
  analyzed: '같은 문서 버전을 이미 분석했어요(중복 분석)',
  aiExcluded: 'AI 가 바꾼 문서라 24시간 제외',
  truncated: '문서가 너무 길어 잘려서 자동 분석 안 함',
  mechanical: '규칙만으로 고칠 수 있어 AI 가 필요 없어요',
  triggerOff: '이 트리거가 꺼져 있어요',
  projectOff: '이 프로젝트는 자동 관리에서 뺐어요',
  capReached: '하루 분석 한도를 넘어서 다음에 분석해요',
}
const MODES: { v: AutoMode; label: string; hint: string; soon?: boolean }[] = [
  { v: 'off', label: '쓰지 않음', hint: '문서 점검 탭에서 직접 [AI로 고치기]를 누를 때만 AI 가 일해요' },
  { v: 'notify', label: '알림만', hint: '새 문제가 생기면 알려 줘요. AI 는 부르지 않아요' },
  { v: 'analyze', label: 'AI 자동 분석', hint: '새 문제를 AI 가 읽기 전용으로 분석해 정리 계획을 만들어 둬요', soon: true },
]

export const autoInboxCount = (st: ReturnType<typeof useAutomation.getState>['st']) => (st ? st.queue.filter((q) => q.status === 'queued' || q.status === 'running').length : 0)

const rel = (project: string, p: string) => {
  const folder = project.includes('/') ? project.slice(0, project.lastIndexOf('/') + 1) : ''
  return folder && p.startsWith(folder) ? p.slice(folder.length) : p
}
const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function AutoCard() {
  const au = useAutomation()
  const files = useApp((s) => s.files)
  const [dry, setDry] = useState<ReturnType<typeof runDry> | null>(null)
  const [ignoreSeen, setIgnoreSeen] = useState(true)
  if (!desktop()) return null
  const { settings: s, st } = au
  const queue = st?.queue.filter((q) => q.status === 'queued' || q.status === 'running') ?? []
  const baseline = st ? Object.values(st.seen).filter((e) => e.origin === 'baseline').length : 0
  const logs = [...(st?.log ?? [])].reverse().slice(0, 12)

  return (
    <section className="card auto">
      <h3>{t('AI 자동 문서 관리')}</h3>
      <p className="hint small">{t('규칙 검사는 항상, AI 분석은 조건에 맞을 때만, 문서 변경은 항상 승인을 거쳐요. 이 기능은 이 기기에서만 동작하고, 앱이 켜져 있을 때 문서가 바뀌면 점검해요.')}</p>
      <div className="auto-modes" role="radiogroup" aria-label={t('자동 관리 방식')}>
        {MODES.map((m) => (
          <label key={m.v} className={`auto-mode${s.mode === m.v ? ' on' : ''}${m.soon ? ' soon' : ''}`}>
            <input type="radio" name="auto-mode" checked={s.mode === m.v} disabled={m.soon} onChange={() => au.setSettings({ mode: m.v })} />
            <span><b>{t(m.label)}</b>{m.soon && <em>{t('v1.29 예정')}</em>}<small>{t(m.hint)}</small></span>
          </label>
        ))}
      </div>

      {s.mode !== 'off' && (
        <>
          <div className="auto-sub">{t('새로 생기면 알릴 문제')}</div>
          <label className="auto-check"><input type="checkbox" checked={s.triggers.duplicate} onChange={(e) => au.setSettings({ triggers: { ...s.triggers, duplicate: e.target.checked } })} />{t('새 중복 문서 후보')}</label>
          <label className="auto-check"><input type="checkbox" checked={s.triggers.roleIssue} onChange={(e) => au.setSettings({ triggers: { ...s.triggers, roleIssue: e.target.checked } })} />{t('역할 충돌·중복')}</label>
          <p className="hint small">{t('제목 누락·status·끊어진 링크처럼 규칙만으로 알 수 있는 문제는 AI 없이 문서 점검 탭에서 알려 줘요.')}</p>
          <div className="kv"><span>{t('문서 변경 후 점검까지 대기')}</span>
            <Select value={String(s.debounceSec)} onChange={(v) => au.setSettings({ debounceSec: Number(v) })} options={DEBOUNCES.map((d) => ({ value: String(d), label: d >= 60 ? t('{n}분', { n: d / 60 }) : t('{n}초', { n: d }) }))} />
          </div>
          <div className="kv"><span>{t('하루 최대 AI 분석')}</span>
            <Select value={String(s.dailyCap)} onChange={(v) => au.setSettings({ dailyCap: Number(v) })} options={CAPS.map((c) => ({ value: String(c), label: t('{n}회', { n: c }) }))} />
          </div>
          <label className="auto-check"><input type="checkbox" checked={s.paused} onChange={(e) => au.setSettings({ paused: e.target.checked })} />{t('잠시 멈추기')}</label>
        </>
      )}
      <p className="auto-policy" aria-live="polite">{t(describePolicy(s))}</p>

      {s.mode !== 'off' && (
        <>
          <div className="auto-sub">{t('확인할 문제')}{queue.length > 0 && <span className="auto-count">{queue.length}</span>}</div>
          {queue.length === 0 ? (
            <p className="hint small">{t('아직 새 문제가 없어요.')}{baseline > 0 && ' ' + t('지금 있는 문제 {n}건은 기존 문제로 기록했고, 문서 점검 탭에서 직접 고칠 수 있어요.', { n: baseline })}</p>
          ) : (
            <ul className="auto-inbox">
              {queue.map((q) => {
                const changed = q.result ? changedPaths(q.result.hashes, files).length > 0 : false
                return (
                  <li key={q.id}>
                    <div><b>{q.projectName}</b> · {t(KIND[q.kind])}</div>
                    <div className="auto-paths">{q.paths.map((p) => rel(q.project, p)).join(' ↔ ')}</div>
                    <div className="auto-state">{changed ? t('문서가 변경되어 재검토가 필요합니다') : t('AI 분석 대기 — 자동 분석은 v1.29 에서 연결돼요')} · {when(q.createdAt)}</div>
                    <div className="auto-act"><button className="btn-link" onClick={() => useApp.getState().openNote(q.paths[0])}>{t('문서 열기')}</button><button className="btn-link" onClick={() => au.dismiss(q.id)}>{t('무시')}</button></div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="auto-sub">{t('시험 실행')}</div>
          <p className="hint small">{t('이 설정이었다면 지금 문서의 어떤 문제를 AI 분석 대기열에 올리고, 어떤 것은 왜 건너뛰는지 AI 호출 없이 보여 줘요.')}</p>
          <label className="auto-check"><input type="checkbox" checked={ignoreSeen} onChange={(e) => { setIgnoreSeen(e.target.checked); setDry(null) }} />{t('기존 문제도 새 문제인 것처럼 판정(정책 확인용)')}</label>
          <div className="llm-actions"><button onClick={() => setDry(runDry(ignoreSeen))}>{t('시험 실행')}</button></div>
          {dry && (
            dry.length === 0 ? <p className="hint small">{t('점검할 문제가 없어요. 문서 규칙이 켜져 있고 프로젝트에 적용돼 있는지 확인해 보세요.')}</p> : (
              <ul className="auto-dry">
                {dry.map((v) => (
                  <li key={v.finding.id} className={v.decision}>
                    <div><b>{v.finding.projectName}</b> · {t(KIND[v.finding.kind])} <span className="auto-paths">{v.finding.paths.map((p) => rel(v.finding.project, p)).join(' ↔ ')}</span></div>
                    <div className="auto-state">{v.decision === 'queue' ? t('→ 분석 대기열에 올려요') : v.decision === 'wait' ? t('→ 대기열에는 올리되 {r}', { r: t(REASON[v.reason!]) }) : t('→ 건너뛰어요: {r}', { r: t(REASON[v.reason!]) })}</div>
                  </li>
                ))}
              </ul>
            )
          )}

          {logs.length > 0 && (
            <>
              <div className="auto-sub">{t('최근 판정 기록')}</div>
              <ul className="auto-log">
                {logs.map((e, i) => (
                  <li key={i}>
                    <span>{when(e.at)}</span>
                    {e.type === 'baseline' ? t('기존 문제 {n}건을 기준선으로 기록했어요', { n: e.count ?? 0 }) : `${e.projectName} · ${t(KIND[e.kind!])} → ${e.decision === 'skip' ? t('건너뜀: {r}', { r: t(REASON[e.reason!]) }) : e.decision === 'wait' ? t('대기: {r}', { r: t(REASON[e.reason!]) }) : t('분석 대기열')}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
