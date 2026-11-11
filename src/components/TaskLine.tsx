// 업무 한 줄(체크박스 + 제목·마감·담당). 프로젝트 허브의 할 일·타임라인·담당자별 보기가 함께 쓴다
import { t } from '../lib/i18n'
import { todayYmd } from '../lib/calendar'
import { uiStateOf, type Task } from '../lib/work'
import { toggleOrClose, useWorkUi } from '../lib/workOps'

export function TaskLine({ tk, showProject }: { tk: Task; showProject?: string }) {
  const ui = uiStateOf(tk)
  const today = todayYmd()
  const late = !tk.done && ui !== 'dropped' && !!tk.due && tk.due < today
  return (
    <div className={`wrk-row${late ? ' late' : ''}${tk.done || ui === 'dropped' ? ' fin' : ''}`}>
      <input type="checkbox" className="task" checked={tk.done} onChange={() => toggleOrClose(tk)} aria-label={tk.title} />
      <button className="wrk-main" onClick={() => useWorkUi.getState().openEditor(tk)}>
        <span className="wrk-body">
          <span className="wrk-title">{tk.kind === 'decision' && <b className="wrk-kind">{t('결정')}</b>}{tk.p === 1 && <b className="wrk-p">!</b>}{tk.title}</span>
          <span className="wrk-meta">
            {tk.due && <span className={late ? 'wrk-late' : 'wrk-due'}>{tk.due.slice(5)}</span>}
            {tk.owner.length > 0 && <span className="wrk-owner">{tk.owner.join(', ')}</span>}
            {showProject && <span className="wrk-proj">{showProject}</span>}
            {tk.conclusion && <span className="wrk-concl">→ {tk.conclusion}</span>}
          </span>
        </span>
        {ui !== 'todo' && !tk.done && <em className={`wrk-why ${ui}`}>{ui === 'doing' ? t('진행 중') : ui === 'waiting' ? t('대기') : t('취소됨')}</em>}
        {late && ui === 'todo' && <em className="wrk-why overdue">{t('기한 지남')}</em>}
      </button>
    </div>
  )
}
