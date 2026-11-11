// 설정 > AI (PC): "휴대폰에서 이 PC의 AI 쓰기". 켜면 같은 와이파이의 휴대폰이 연결 코드(QR)로 한 번 짝을 맺고, 이 PC 의 AI 를 쓴다.
// 기본은 꺼짐. 연결 코드는 5분·한 번만 쓸 수 있고, 기기는 여기서 언제든 해제할 수 있다.
import { useCallback, useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { desktop, type RelayStatus } from '../lib/externalIO'
import { PairModal } from './PairModal'
import { relayState } from '../lib/pairModal'
import { listConnections, updateConnection } from '../lib/aiConnections'
import { connectionTitle } from '../lib/aiWizard'
import { toLlmConfig } from '../lib/llm'
import { useAiConfigVersion } from '../lib/useAiConfig'
import { confirmAsk } from '../lib/dialog'

const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return t('방금')
  if (m < 60) return t('{n}분 전', { n: m })
  if (m < 1440) return t('{n}시간 전', { n: Math.round(m / 60) })
  return new Date(ts).toLocaleDateString()
}

export function RelayCard() {
  const api = desktop()?.relay
  const [st, setSt] = useState<RelayStatus | null>(null)
  const [adding, setAdding] = useState(false)
  const refresh = useCallback(async () => { if (api) setSt(await api.get()) }, [api])
  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 4000) // 새 기기·코드 만료를 따라간다
    return () => clearInterval(id)
  }, [refresh])
  // 이 PC 에 연결된 내 AI 들(PC 를 거쳐 온 연결은 빌려줄 수 없다). 연결·토글이 바뀌면 다시 읽는다
  useAiConfigVersion()
  const mine = listConnections().filter((c) => !c.viaPc && toLlmConfig(c))
  if (!api || !st) return null

  const noAi = !mine.length && !st.claude
  const toggle = async (id: string, on: boolean) => {
    const c = mine.find((x) => x.id === id)
    if (!c) return
    if (on) {
      const ok = await confirmAsk(t('"{name}" 을(를) 휴대폰에 빌려줄까요?', { name: connectionTitle(toLlmConfig(c)!) }), t('연결한 휴대폰이 이 AI 로 노트에 대해 물을 수 있게 돼요. 요청은 이 PC 를 거쳐 가고, API 키는 휴대폰에 전달되지 않아요. 언제든 끌 수 있어요.'), t('빌려주기'))
      if (!ok) return
    }
    updateConnection(id, { shareToPhone: on ? true : undefined })
    void refresh()
  }

  return (
    <section className="card relay">
      <h3>{t('휴대폰에서 이 PC의 AI 쓰기')}</h3>
      <div className="kv"><span>{t('사용')}</span>
        <div className="seg">
          <button className={st.enabled ? 'on' : ''} onClick={async () => setSt(await api.set({ enabled: true }))}>{t('켜기')}</button>
          <button className={!st.enabled ? 'on' : ''} onClick={async () => setSt(await api.set({ enabled: false }))}>{t('끄기')}</button>
        </div>
      </div>
      {!st.enabled && <p className="hint small">{t('켜면 같은 와이파이의 내 휴대폰이 이 PC의 AI(Claude·Ollama 등)로 노트에 대해 물을 수 있어요.')}</p>}
      {st.enabled && (
        <>
          <div className="relay-share">
            <div className="auto-sub">{t('휴대폰에 빌려줄 AI')}</div>
            <ul>
              {st.claude && <li><span><b>{t('Claude (구독)')}</b><small>{t('휴대폰이 연결되면 항상 쓸 수 있어요')}</small></span></li>}
              {mine.map((c) => {
                const on = c.shareToPhone === true
                return (
                  <li key={c.id}>
                    <span><b>{connectionTitle(toLlmConfig(c)!)}</b><small>{c.model || t('모델 안 고름')}</small></span>
                    <button className={`hc-perm${on ? ' on' : ''}`} aria-pressed={on} onClick={() => void toggle(c.id, !on)}>{on ? t('빌려주는 중') : t('빌려주지 않음')}</button>
                  </li>
                )
              })}
            </ul>
            {noAi && <p className="hint small ai-warn">{t('이 PC에 연결된 AI가 없어요. 위에서 AI를 먼저 연결해 주세요.')}</p>}
            {!noAi && mine.length > 0 && !mine.some((c) => c.shareToPhone) && <p className="hint small">{t('연결한 AI 는 기본으로 휴대폰에 빌려주지 않아요. 빌려줄 AI 를 켜 주세요.')}</p>}
          </div>
          {st.error && <p className="hint small ai-warn">{st.error}</p>}
          {!st.running && !st.error && <p className="hint small">{t('시작하는 중…')}</p>}
          {st.running && st.ips.length === 0 && <p className="hint small ai-warn">{t('와이파이에 연결돼 있지 않아요. 같은 와이파이에 연결해 주세요.')}</p>}
          {st.running && st.ips.length > 0 && <button className="big" onClick={() => setAdding(true)}>{t('기기 추가')}</button>}
          {adding && (
            <PairModal
              title={t('휴대폰 연결')}
              where={t('휴대폰 앱 > 설정 > AI > 내 PC에 연결')}
              source={{ get: async () => relayState(await api.get()), issue: async () => relayState(await api.newCode()), revoke: async () => { await api.revokeCode() } }}
              onClose={() => { setAdding(false); void refresh() }}
            />
          )}
          <div className="relay-devs">
            <div className="auto-sub">{t('연결된 휴대폰')}</div>
            {st.devices.length === 0 ? <p className="hint small">{t('아직 없어요')}</p> : (
              <ul>
                {st.devices.map((d) => (
                  <li key={d.id}>
                    <span><b>{d.name}</b><small>{t('마지막 사용 {when}', { when: ago(d.lastSeen) })}</small></span>
                    <button className="btn-link" onClick={async () => setSt(await api.revoke(d.id))}>{t('해제')}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="hint small">{t('같은 와이파이 안에서만 연결돼요. 공용 와이파이에서는 꺼 두세요. 이 PC 앱이 켜져 있어야 해요.')}</p>
        </>
      )}
    </section>
  )
}
