// 최초 연결 미리보기(공통): PC 앱의 "폴더로 맞추기"와 폰의 "내 PC에 연결"이 같이 쓴다. 확인하기 전에는 아무것도 바꾸지 않는다.
import { t } from '../lib/i18n'
import type { Choice, ConnectPlan } from '../lib/hostConnect'

const SHOW = 12
function PathList({ title, paths, note }: { title: string; paths: string[]; note?: string }) {
  if (!paths.length) return null
  return (
    <details className="hc-group">
      <summary>{title} <span className="wrk-count">{paths.length}</span></summary>
      {note && <p className="hint small">{note}</p>}
      <ul>
        {paths.slice(0, SHOW).map((p) => <li key={p}>{p}</li>)}
        {paths.length > SHOW && <li className="hint">{t('… 외 {n}개', { n: paths.length - SHOW })}</li>}
      </ul>
    </details>
  )
}

export function HostPlanView({ plan, choices, setChoices, busy, side, canWrite, onStart }: {
  plan: ConnectPlan
  choices: Record<string, Choice>
  setChoices: (f: (cur: Record<string, Choice>) => Record<string, Choice>) => void
  busy: boolean
  /** pc: PC 앱의 폴더 연결 / phone: 폰의 내 PC 연결 */
  side: 'pc' | 'phone'
  /** 이 기기가 호스트 폴더에 올릴 수 있는가(폰은 PC 에서 쓰기를 허용했을 때) */
  canWrite: boolean
  onStart: () => void
}) {
  const phone = side === 'phone'
  const total = plan.pcOnly.length + plan.hostOnly.length + plan.same.length + plan.differ.length
  const unresolved = plan.differ.filter((p) => !choices[p]).length
  const mine = phone ? t('이 휴대폰') : t('PC 앱')
  const set = (p: string, c: Choice) => setChoices((cur) => ({ ...cur, [p]: c }))
  const all = (c: Choice) => setChoices(() => Object.fromEntries(plan.differ.map((p) => [p, c])))
  const label = (c: Choice) => (c === 'pc' ? (phone ? t('폰 것') : t('PC 것')) : c === 'host' ? (phone ? t('PC 것') : t('폴더 것')) : t('둘 다'))
  const blocked = (c: Choice) => !canWrite && (c === 'pc' || c === 'both')
  return (
    <div className="hc-plan">
      <p className="aiw-q">{t('미리 보기')}</p>
      {!canWrite && (
        <p className="hint small ai-warn">{t('이 휴대폰은 지금 읽기만 가능해요. PC 앱에서 이 휴대폰의 쓰기를 허용하기 전에는 PC로 올릴 수 없어요. 받기와 "PC 것으로 받기"만 할 수 있고, 올릴 노트는 허용된 뒤에 올라가요.')}</p>
      )}
      <ul className="hc-sum">
        <li><b>{plan.pcOnly.length}</b> {phone ? (canWrite ? t('이 휴대폰에만 있는 노트 → PC 폴더에 올려요') : t('이 휴대폰에만 있는 노트 → 올리기 대기(허용된 뒤 올라가요)')) : t('PC 앱에만 있는 노트 → 폴더에 올려요')}</li>
        <li><b>{plan.hostOnly.length}</b> {phone ? t('PC 폴더에만 있는 노트 → 이 휴대폰으로 받아요') : t('폴더에만 있는 노트 → PC 앱으로 받아요')}</li>
        <li><b>{plan.same.length}</b> {t('같은 노트 → 그대로 맞춰요')}</li>
        <li><b>{plan.differ.length}</b> {t('내용이 다른 노트 → 아래에서 골라 주세요')}</li>
        {plan.hostOther.length > 0 && <li><b>{plan.hostOther.length}</b> {t('노트가 아닌 파일 → 파일 목록으로만 보여요')}</li>}
      </ul>
      <p className="hint small">{phone ? t('삭제는 하지 않아요. 시작하기 전에 이 휴대폰의 노트(와 허용된 경우 PC 폴더)를 스냅샷으로 저장하고, 저장하지 못하면 시작하지 않아요.') : t('삭제는 하지 않아요. 시작하기 전에 폴더와 이 PC 앱의 노트를 스냅샷으로 저장하고, 저장하지 못하면 시작하지 않아요.')}</p>
      {total === 0 && plan.hostOther.length === 0 && <p className="hint">{t('양쪽 모두 비어 있어요. 바로 연결할 수 있어요.')}</p>}

      <PathList title={phone ? t('이 휴대폰에만 있는 노트') : t('PC 앱에만 있는 노트')} paths={plan.pcOnly} />
      {plan.revived.length > 0 && <p className="hint small ai-warn">{t('이 중 {n}개는 폴더에서 지워졌던 노트예요. 올리면 다시 생겨요.', { n: plan.revived.length })}</p>}
      <PathList title={phone ? t('PC 폴더에만 있는 노트') : t('폴더에만 있는 노트')} paths={plan.hostOnly} />
      <PathList title={t('노트가 아닌 파일')} paths={plan.hostOther} />

      {plan.differ.length > 0 && (
        <div className="hc-differ">
          <div className="auto-sub">{t('내용이 다른 노트')}</div>
          {plan.differ.length > 1 && (
            <div className="hc-all">
              <small>{t('모두:')}</small>
              {canWrite && <button className="btn-link" onClick={() => all('pc')}>{label('pc')}</button>}
              <button className="btn-link" onClick={() => all('host')}>{label('host')}</button>
              {canWrite && <button className="btn-link" onClick={() => all('both')}>{t('둘 다 보관')}</button>}
            </div>
          )}
          {plan.differ.map((p) => (
            <div key={p} className="hc-row">
              <b title={p}>{p}</b>
              <div className="seg">
                {(['pc', 'host', 'both'] as Choice[]).map((c) => (
                  <button key={c} disabled={blocked(c)} className={choices[p] === c ? 'on' : ''} onClick={() => set(p, c)}>{label(c)}</button>
                ))}
              </div>
            </div>
          ))}
          <p className="hint small">
            {phone
              ? t('"폰 것": PC 폴더의 파일을 이 휴대폰의 내용으로 바꿔요. "PC 것": 이 휴대폰의 내용을 PC 폴더의 내용으로 바꿔요. "둘 다": PC 것을 받고 이 휴대폰의 내용은 "(PC 사본)" 노트로 남겨요. 어느 쪽이든 스냅샷에 원본이 남아요.')
              : t('"PC 것": 폴더의 파일을 PC 앱의 내용으로 바꿔요. "폴더 것": PC 앱의 내용을 폴더의 내용으로 바꿔요. "둘 다": 폴더 것을 받고 PC 앱의 내용은 "(PC 사본)" 노트로 남겨요. 어느 쪽이든 스냅샷에 원본이 남아요.')}
          </p>
        </div>
      )}
      <button className="primary big" disabled={busy || unresolved > 0} onClick={onStart}>
        {busy ? t('연결하는 중…') : unresolved > 0 ? t('{n}개를 먼저 골라 주세요', { n: unresolved }) : t('확인했어요, 시작하기')}
      </button>
      <small className="hint">{t('{who}의 노트는 지우지 않아요.', { who: mine })}</small>
    </div>
  )
}
