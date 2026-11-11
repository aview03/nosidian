// 프로젝트 허브 "기본 정보" 탭: 상태·담당·마감·열린 일·건강도 같은 프로젝트 요약. 예전에는 제목 아래 띠로 늘 보여서 자리를 많이 차지했다.
// 값은 프로젝트 노트 첫머리의 속성(status·owner·due·health)에서 오고, 여기서는 읽기만 한다(고치려면 노트를 연다).
import { t } from '../lib/i18n'
import { fmtDay, todayYmd } from '../lib/calendar'
import { dayDiff } from '../lib/gantt'
import type { Health } from '../lib/health'
import type { Project } from '../lib/work'
import { signalText } from './WorkHome'

const dash = <span className="hub-info-none">—</span>

/** 마감일까지 남은 날 설명: "3일 남음" / "오늘" / "5일 지남" */
export function dueNote(due: string, today: string): string {
  const d = dayDiff(today, due)
  if (d === 0) return t('오늘')
  return d > 0 ? t('{n}일 남음', { n: d }) : t('{n}일 지남', { n: -d })
}

export const levelText = (h: Health) => (h.level === 'ok' ? t('정상') : h.level === 'risk' ? t('위험') : t('주의'))

export function HubInfo({ project, open, total, health, onOpenNote }: { project: Project; open: number; total: number; health: Health | null | undefined; onOpenNote(): void }) {
  const today = todayYmd()
  return (
    <div className="hub-info">
      <dl>
        <div><dt>{t('상태')}</dt><dd>{project.status ? <b className="hub-info-status">{project.status}</b> : dash}</dd></div>
        <div><dt>{t('담당')}</dt><dd>{project.owner.length ? project.owner.join(', ') : dash}</dd></div>
        <div>
          <dt>{t('마감')}</dt>
          <dd>{project.due ? <>{fmtDay(project.due)} <span className={`hub-info-note${project.due < today ? ' late' : ''}`}>({dueNote(project.due, today)})</span></> : dash}</dd>
        </div>
        <div><dt>{t('열린 일')}</dt><dd>{open}/{total}</dd></div>
        {project.health && <div><dt>{t('판단')}</dt><dd>{project.health}</dd></div>}
        <div>
          <dt>{t('건강도')}</dt>
          <dd>
            {health ? (
              <>
                <span className={`hub-info-level ${health.level}`}>{levelText(health)}</span>
                {health.signals.length > 0 && (
                  <ul className="hub-info-signals">
                    {health.signals.map((s) => <li key={s.key}>{signalText(s)}</li>)}
                  </ul>
                )}
              </>
            ) : dash}
          </dd>
        </div>
      </dl>
      <p className="hint small">{t('건강도는 기한이 지난 일·오래 기다리는 일·담당자 없는 일을 보고 정한 프로젝트 상태예요.')}</p>
      <p className="hint small">{t('상태·담당·마감은 프로젝트 노트 맨 위 속성에서 바꿔요.')}</p>
      <button className="link-btn" onClick={onOpenNote}>{t('노트로 열기')}</button>
    </div>
  )
}
