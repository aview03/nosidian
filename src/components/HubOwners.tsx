// 프로젝트 허브 "담당자별" 보기: 사람마다 한 구역. 구역 머리에 열린 일·진행·지난 마감 수와 업무량 막대를 보인다(점수·순위가 아니라 숫자만).
// PC 에서는 일을 다른 사람 구역으로 끌어 놓으면 담당이 바뀐다(되돌리기 알림). 폰은 눌러서 편집기. 설계: docs/PROJECT-VIEWS.md §4.3
import { useMemo, useState } from 'react'
import { t } from '../lib/i18n'
import { todayYmd } from '../lib/calendar'
import { loadRatio, ownerLanes, ownersAfterDrop, type Lane } from '../lib/projectViews'
import type { Task } from '../lib/work'
import { patchTask, withUndo } from '../lib/workOps'
import { TaskLine } from './TaskLine'

export function HubOwners({ tasks, me }: { tasks: Task[]; me: string[] }) {
  const lanes = useMemo(() => ownerLanes(tasks, me, todayYmd()), [tasks, me])
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [over, setOver] = useState<string | null>(null)
  // 처음엔 나와 "담당 없음"만 펼친다(나머지는 머리줄 숫자로 충분하고, 눌러서 연다)
  const isOpen = (l: Lane) => openMap[l.key] ?? (l.isMe || l.name === null)

  if (lanes.length === 0) return <p className="hint pad">{t('보여 줄 일이 없어요. 위의 조건을 바꾸거나 업무를 추가해 보세요.')}</p>

  const drop = (l: Lane, id: string) => {
    const tk = tasks.find((x) => x.id === id)
    if (!tk) return
    const next = ownersAfterDrop(l)
    if (tk.owner.length === next.length && tk.owner.every((o, i) => o === next[i])) return // 이미 그 사람 혼자 맡은 일
    const name = tk.title.length > 18 ? tk.title.slice(0, 18) + '…' : tk.title
    withUndo(tk, l.name ? t('"{name}" 담당을 {to}(으)로 바꿨어요', { name, to: l.name }) : t('"{name}" 담당을 비웠어요', { name }), () => patchTask(tk, { owner: next.length ? next : null }))
  }

  return (
    <div className="own">
      {lanes.map((l) => {
        const open = isOpen(l)
        return (
          <section
            key={l.key || '(none)'}
            className={`own-lane${l.name === null ? ' none' : ''}${over === l.key ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(l.key)
            }}
            onDragLeave={() => setOver((o) => (o === l.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault()
              setOver(null)
              drop(l, e.dataTransfer.getData('text/plain'))
            }}
          >
            <button className="own-head" aria-expanded={open} onClick={() => setOpenMap((m) => ({ ...m, [l.key]: !open }))}>
              <span className="own-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
              <span className="own-name">
                {l.name === null ? `⚠ ${t('담당 없음')}` : l.name}
                {l.isMe && <em> ({t('나')})</em>}
              </span>
              <span className="own-stats">
                {t('열린 {n}', { n: l.open })}
                {l.doing > 0 && ` · ${t('진행 {n}', { n: l.doing })}`}
                {l.late > 0 && <b className="own-late"> · {t('지남 {n}', { n: l.late })}</b>}
              </span>
              <span className="own-bar" aria-hidden="true"><i style={{ width: `${Math.round(loadRatio(l, lanes) * 100)}%` }} /></span>
            </button>
            {open && (
              <div className="own-body">
                {l.name === null && <p className="hint own-hint">{t('아직 아무도 맡지 않은 일이에요. 사람 구역으로 끌어 놓거나, 눌러서 담당을 정해요.')}</p>}
                {l.tasks.map((tk) => (
                  <div key={tk.id} className="own-task" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', tk.id)}>
                    <TaskLine tk={tk} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
