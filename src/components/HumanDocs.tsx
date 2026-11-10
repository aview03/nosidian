// 프로젝트 허브 "문서" 탭의 사람용 보기(Human View).
// 문서 규칙을 적용한 프로젝트에서는 파일이 쌓인 순서가 아니라 "무엇을 먼저 읽어야 하나"로 보여 준다:
//   먼저 읽어야 할 문서(공식·진입) → 지금 확인할 것 → 보조·기타 문서(접힘).
// AI 와 무관한 기능이다: 마크다운과 규칙 노트에서 매번 계산하고, 아무것도 저장하지 않는다. 규칙을 적용하지 않은 프로젝트는 children(기존 문서 목록)을 그대로 보여 준다.
import type { ReactNode } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { baseName } from '../lib/links'
import type { Project } from '../lib/work'
import { useProjectLint } from './DocCheck'

export function HumanDocs({ project, open, decisions, onCheck, children }: { project: Project; open: number; decisions: number; onCheck(): void; children: ReactNode }) {
  const { profile, report } = useProjectLint(project)
  const index = useApp((s) => s.index)
  if (!profile || !report) return <>{children}</>

  const warnBy = new Map<string, number>()
  for (const it of report.items) if (it.severity === 'warn') warnBy.set(it.path, (warnBy.get(it.path) ?? 0) + 1)
  const warnTotal = [...warnBy.values()].reduce((a, b) => a + b, 0)

  const roleRank = (d: (typeof report.docs)[number]) => (d.role ? profile.roles.indexOf(d.role) : 999)
  const main = report.docs
    .filter((d) => !d.archived && (d.path === project.path || d.role?.official))
    .sort((a, b) => (a.path === project.path ? -1 : b.path === project.path ? 1 : roleRank(a) - roleRank(b)))
  const others = report.docs.filter((d) => !d.archived && d.path !== project.path && !d.role?.official)
  const archived = report.docs.filter((d) => d.archived)
  const title = (p: string) => index.notes.get(p)?.title ?? baseName(p)
  const go = (p: string) => useApp.getState().openNote(p)

  return (
    <section className="wrk-sec hdoc">
      <p className="hdoc-stats">
        <span>{t('열린 일 {n}', { n: open })}</span>
        <span>{t('결정할 일 {n}', { n: decisions })}</span>
        <button className={`hdoc-check${warnTotal ? ' warn' : ''}`} onClick={onCheck}>{warnTotal ? t('문서 점검 · 확인할 것 {n}', { n: warnTotal }) : t('문서 점검 · 이상 없음')}</button>
      </p>

      <div className="dchk-group">
        <h3>{t('먼저 읽어야 할 문서')}<span className="wrk-count">{main.length}</span></h3>
        {main.map((d) => (
          <button key={d.path} className="wrk-projrow" onClick={() => go(d.path)}>
            <span className="wrk-pname">{title(d.path)}</span>
            <span className="wrk-pmeta">
              <span>{d.role?.name ?? t('프로젝트 노트')}</span>
              {d.status && d.path !== project.path && <span>{d.status}</span>}
              {warnBy.get(d.path) ? <span className="hdoc-warn">{t('확인 {n}', { n: warnBy.get(d.path)! })}</span> : null}
            </span>
          </button>
        ))}
      </div>

      {others.length > 0 && (
        <details className="dchk-group dchk-info">
          <summary>{t('보조·기타 문서')} <span className="wrk-count">{others.length}</span></summary>
          {others.map((d) => (
            <button key={d.path} className="wrk-projrow" onClick={() => go(d.path)}>
              <span className="wrk-pname">{title(d.path)}</span>
              <span className="wrk-pmeta">
                <span>{d.rel}</span>
                {d.role && <span>{d.role.name}</span>}
                {warnBy.get(d.path) ? <span className="hdoc-warn">{t('확인 {n}', { n: warnBy.get(d.path)! })}</span> : null}
              </span>
            </button>
          ))}
        </details>
      )}

      {archived.length > 0 && <p className="hint dchk-note">{t('보관된 문서 {n}개는 점검과 이 목록에서 빠져 있어요.', { n: archived.length })}</p>}
    </section>
  )
}
