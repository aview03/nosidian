// 설정 > AI 자동 문서 관리 (PC 전용). 설계: docs/AUTOMATION.md
// v1.28: 새 문제를 감지해 분석 대기열에 올리고 알려 준다. AI 는 부르지 않는다(자동 분석은 v1.29).
// 확인할 문제 = 새 문제와 앞으로 AI 분석이 필요한 작업 목록. 시험 실행 = 이 설정이었다면 무엇을 AI 에 보냈을지(이유 포함).
import { useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { desktop } from '../lib/externalIO'
import { analysisEngine, runDry, useAutomation, type HoldReason } from '../lib/automation'
import { CAPS, DEBOUNCES, changedPaths, describePolicy, inboxCount, usedToday, type AutoMode, type QueueItem, type SkipReason } from '../lib/autoTriggers'
import type { LintKind } from '../lib/doclint'
import { Select } from './Select'
import { Orb } from './Orb'

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
  { v: 'off', label: '쓰지 않음', hint: '직접 [AI로 고치기]를 누를 때만 AI 가 일해요' },
  { v: 'notify', label: '알림만', hint: '새 문제가 생기면 알려 줘요 (AI 호출 없음)' },
  { v: 'analyze', label: 'AI 자동 분석', hint: '새 문제를 AI 가 읽기만 하고 정리 계획을 만들어 둬요' },
]

export const autoInboxCount = inboxCount

const HOLD: Record<HoldReason, string> = {
  paused: '잠시 멈춘 상태예요',
  consent: 'Claude 로 자동 분석하려면 아래에서 동의해 주세요',
  noEngine: '분석에 쓸 AI 를 쓸 수 없어요(Claude Code 설치·로그인 또는 설정의 로컬 모델을 확인하세요)',
  userBusy: 'AI 패널에서 대화하는 중이라 끝난 뒤에 이어서 해요',
  battery: '배터리로 전원을 쓰는 중이라 보류했어요',
  cap: '오늘 분석 한도를 다 썼어요. 내일 이어서 해요',
  failures: '연속으로 실패해서 자동 분석을 멈췄어요',
}
const OUTCOME: Record<string, string> = { done: '완료', failed: '실패', interrupted: '중단(한도 안 씀)' }

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
  const list = st?.queue.filter((q) => q.status === 'queued' || q.status === 'running' || q.status === 'failed' || (q.status === 'done' && q.result)) ?? []
  const shown = inboxCount(st)
  const usage = [...(st?.usage ?? [])].reverse().slice(0, 6)
  const baseline = st ? Object.values(st.seen).filter((e) => e.origin === 'baseline').length : 0
  const logs = [...(st?.log ?? [])].reverse().slice(0, 12)

  return (
    <section className="card auto">
      <h3>{t('AI 자동 문서 관리')}</h3>
      <p className="hint small">{t('문서가 바뀌면 이 기기에서 점검해요. AI 분석은 새 문제가 생길 때만, 문서 변경은 항상 승인을 거쳐요.')}</p>
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
          <p className="hint small">{t('제목 누락·끊어진 링크 같은 단순한 문제는 AI 없이 문서 점검 탭에서 알려 줘요.')}</p>
          <div className="kv"><span>{t('문서 변경 후 점검까지 대기')}</span>
            <Select value={String(s.debounceSec)} onChange={(v) => au.setSettings({ debounceSec: Number(v) })} options={DEBOUNCES.map((d) => ({ value: String(d), label: d >= 60 ? t('{n}분', { n: d / 60 }) : t('{n}초', { n: d }) }))} />
          </div>
          <div className="kv"><span>{t('하루 최대 AI 분석')}</span>
            <Select value={String(s.dailyCap)} onChange={(v) => au.setSettings({ dailyCap: Number(v) })} options={CAPS.map((c) => ({ value: String(c), label: t('{n}회', { n: c }) }))} />
          </div>
          {s.mode === 'analyze' && (
            <>
              <div className="kv"><span>{t('분석에 쓸 AI')}</span>
                <Select value={s.engine} onChange={(v) => au.setSettings({ engine: v })} options={[{ value: 'panel', label: t('AI 패널에서 고른 것') }, { value: 'ollama', label: t('로컬 모델(Ollama) 우선') }]} />
              </div>
              {analysisEngine(s) === 'claude' && (
                <label className="auto-check consent"><input type="checkbox" checked={s.claudeConsent} onChange={(e) => au.setSettings({ claudeConsent: e.target.checked })} />
                  <span>{t('Claude 로 자동 분석 허용')}<small>{t('문서 내용이 Anthropic으로 전송되고 Claude 계정 사용량이 차감돼요. 로컬 모델은 동의가 필요 없어요.')}</small></span>
                </label>
              )}
              <label className="auto-check"><input type="checkbox" checked={s.holdOnBattery} onChange={(e) => au.setSettings({ holdOnBattery: e.target.checked })} />{t('배터리로 전원을 쓸 때는 보류')}</label>
            </>
          )}
          <label className="auto-check"><input type="checkbox" checked={s.paused} onChange={(e) => au.setSettings({ paused: e.target.checked })} />{t('잠시 멈추기')}</label>
        </>
      )}
      <p className="auto-policy" aria-live="polite">{t(describePolicy(s))}</p>

      {s.mode !== 'off' && (
        <>
          <div className="auto-sub">{t('확인할 문제')}{shown > 0 && <span className="auto-count">{shown}</span>}</div>
          {s.mode === 'analyze' && (
            <p className="auto-status" aria-live="polite">
              {st && au.hold ? t(HOLD[au.hold]) : t('오늘 {n}/{cap}회 분석했어요', { n: st ? usedToday(st.usage, Date.now()) : 0, cap: s.dailyCap })}
              {au.hold === 'failures' && <button className="btn-link" onClick={() => au.resume()}>{t('다시 시작')}</button>}
            </p>
          )}
          {list.length === 0 ? (
            <p className="hint small">{t('아직 새 문제가 없어요.')}{baseline > 0 && ' ' + t('지금 있는 문제 {n}건은 기존 문제로 기록했고, 문서 점검 탭에서 직접 고칠 수 있어요.', { n: baseline })}</p>
          ) : (
            <ul className="auto-inbox">
              {list.map((q) => <InboxItem key={q.id} q={q} files={files} />)}
            </ul>
          )}

          <div className="auto-sub">{t('시험 실행')}</div>
          <p className="hint small">{t('이 설정이면 어떤 문제를 분석하고 어떤 것은 왜 건너뛰는지 AI 없이 미리 보여 줘요.')}</p>
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

          {s.mode === 'analyze' && usage.length > 0 && (
            <>
              <div className="auto-sub">{t('최근 분석')}</div>
              <ul className="auto-log">
                {usage.map((u, i) => <li key={i}><span>{when(u.at)}</span>{t(OUTCOME[u.outcome])} · {Math.round(u.ms / 1000)}{t('초')}{u.costUsd ? ` · $${u.costUsd.toFixed(3)}` : ''}{u.error ? ` · ${u.error.slice(0, 90)}` : ''}</li>)}
              </ul>
            </>
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

function InboxItem({ q, files }: { q: QueueItem; files: ReturnType<typeof useApp.getState>['files'] }) {
  const au = useAutomation.getState()
  const changed = q.result ? changedPaths(q.result.hashes, files).length > 0 : false
  const plan = q.result?.plan ?? ''
  const decisions = plan.split(/\r?\n/).filter((l) => l.includes('결정 필요')).length
  const gist = plan.replace(/[*`]/g, '').split(/\r?\n/).map((l) => l.replace(/^[#>\-\s]+/, '').trim()).filter((l) => l && !l.startsWith('이 계획대로')).slice(0, 2).join(' ').slice(0, 150)
  return (
    <li>
      <div><b>{q.projectName}</b> · {t(KIND[q.kind])}</div>
      <div className="auto-paths">{q.paths.map((p) => rel(q.project, p)).join(' ↔ ')}</div>
      {q.status === 'done' && q.result ? (
        <>
          <div className="auto-gist">{gist}{plan.length > 150 ? '…' : ''}</div>
          {decisions > 0 && <div className="auto-state">{t('내가 결정할 항목 {n}건', { n: decisions })}</div>}
          {changed && <div className="auto-warn">{t('문서가 변경되어 재검토가 필요합니다')}</div>}
          <div className="auto-act">
            {changed ? <button className="primary" onClick={() => au.reanalyze(q.id)}>{t('다시 분석')}</button> : <button className="primary" onClick={() => au.review(q.id)}>{t('정리 계획 검토')}</button>}
            {changed && <button className="btn-link" onClick={() => au.review(q.id)}>{t('이전 계획 보기')}</button>}
            <button className="btn-link" onClick={() => au.dismiss(q.id)}>{t('무시')}</button>
          </div>
        </>
      ) : (
        <>
          <div className="auto-state">
            {q.status === 'running' ? <><Orb size={22} className="auto-orb" />{t('AI 가 분석하는 중이에요…')}</> : q.status === 'failed' ? t('분석하지 못했어요') : q.retryAt && q.retryAt > Date.now() ? t('분석에 실패해서 잠시 뒤 다시 시도해요') : q.interrupted ? t('AI 대화 때문에 잠시 멈췄어요. 이어서 분석해요') : t('AI 분석 대기')} · {when(q.createdAt)}
          </div>
          <div className="auto-act">
            {q.status === 'failed' && <button className="btn-link" onClick={() => au.reanalyze(q.id)}>{t('다시 시도')}</button>}
            <button className="btn-link" onClick={() => useApp.getState().openNote(q.paths[0])}>{t('문서 열기')}</button>
            <button className="btn-link" onClick={() => au.dismiss(q.id)}>{t('무시')}</button>
          </div>
        </>
      )}
    </li>
  )
}
