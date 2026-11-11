// 설정 > 노트와 동기화 (PC): "내 휴대폰에서 이 PC의 폴더 보기". PC 에서 폴더 하나를 지정하면, 같은 와이파이의 내 휴대폰이
// QR(또는 복사한 연결 문자열)로 한 번 짝을 맺고 그 폴더의 파일을 **읽기만** 한다. 암호화(HTTPS)·인증서 지문 확인이 들어 있다.
// 기본은 꺼짐. 폴더 밖·쓰기·삭제·실행은 되지 않고, 기기는 여기서 언제든 해제한다.
import { useCallback, useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { desktop, type ShareStatus } from '../lib/externalIO'
import { useApp } from '../lib/app'
import { PairModal } from './PairModal'
import { shareState } from '../lib/pairModal'
import { DeviceList } from './DeviceList'

const PICK_ERR: Record<string, string> = {
  'drive root': '드라이브 전체는 공유할 수 없어요. 폴더를 하나 골라 주세요',
  'too broad': '이 폴더는 너무 넓어요(홈 폴더·앱 폴더). 안의 폴더를 골라 주세요',
  'system folder': '시스템 폴더는 공유할 수 없어요',
  'overlaps host': '이 폴더는 동기화 호스트 폴더(Vault 저장소)와 겹쳐요. 다른 폴더를 골라 주세요',
  'not found': '폴더를 찾을 수 없어요',
  'not a directory': '폴더가 아니에요',
}

export function ShareCard() {
  const api = desktop()?.share
  const [st, setSt] = useState<ShareStatus | null>(null)
  const [adding, setAdding] = useState(false)
  const refresh = useCallback(async () => { if (api) setSt(await api.get()) }, [api])
  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 4000)
    return () => clearInterval(id)
  }, [refresh])
  if (!api || !st) return null

  const say = useApp.getState().say
  const pick = async () => {
    const r = await api.pickDir()
    setSt(r)
    if (r.pickError) say(t(PICK_ERR[r.pickError] ?? '이 폴더는 공유할 수 없어요'))
  }

  return (
    <section className="card relay share">
      <h3>{t('내 휴대폰에서 이 PC의 폴더 보기')}</h3>
      <div className="kv"><span>{t('사용')}</span>
        <div className="seg">
          <button className={st.enabled ? 'on' : ''} onClick={async () => setSt(await api.set({ enabled: true }))}>{t('켜기')}</button>
          <button className={!st.enabled ? 'on' : ''} onClick={async () => setSt(await api.set({ enabled: false }))}>{t('끄기')}</button>
        </div>
      </div>
      {!st.enabled && <p className="hint small">{t('켜면 같은 와이파이의 내 휴대폰이 이 PC에서 고른 폴더의 파일을 보고 받을 수 있어요. 읽기만 가능하고 암호화돼요.')}</p>}
      {st.enabled && (
        <>
          <div className="kv"><span>{t('공유 폴더')}</span>
            <span className="share-dir">
              <b title={st.dir ?? ''}>{st.dir ?? t('아직 없어요')}</b>
              <button className="btn-link" onClick={() => void pick()}>{st.dir ? t('바꾸기') : t('폴더 고르기')}</button>
              {st.dir && <button className="btn-link" onClick={async () => setSt(await api.clearDir())}>{t('공유 끝내기')}</button>}
            </span>
          </div>
          {st.error && <p className="hint small ai-warn">{st.error}</p>}
          {!st.running && !st.error && <p className="hint small">{t('시작하는 중…')}</p>}
          {st.running && st.ips.length === 0 && <p className="hint small ai-warn">{t('와이파이에 연결돼 있지 않아요. 같은 와이파이에 연결해 주세요.')}</p>}
          {st.running && st.dir && st.ips.length > 0 && <button className="big" onClick={() => setAdding(true)}>{t('기기 추가')}</button>}
          {adding && (
            <PairModal
              title={t('휴대폰 연결')}
              where={t('휴대폰 앱 > 설정 > 노트와 동기화 > 내 PC 폴더 보기')}
              source={{ get: async () => shareState(await api.get()), issue: async () => shareState(await api.newCode()), revoke: async () => { await api.revokeCode() } }}
              onClose={() => { setAdding(false); void refresh() }}
            />
          )}
          <DeviceList devices={st.devices} onRevoke={async (id) => setSt(await api.revoke(id))} />
          <p className="hint small">{t('이 PC가 켜져 있고 같은 와이파이일 때만 연결돼요. 폴더 밖 파일·숨김 파일은 보이지 않고, 쓰기·삭제는 되지 않아요.')}</p>
          <p className="hint small share-fp">{t('인증서 지문')}: {st.fingerprint.slice(0, 16).toUpperCase().replace(/(.{4})/g, '$1 ').trim()}…</p>
        </>
      )}
    </section>
  )
}
