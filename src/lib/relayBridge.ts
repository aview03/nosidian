// PC 앱: 화면(렌더러)에 저장된 AI 연결 설정(종류·주소·모델)을 메인 프로세스의 중계에 알린다. 키는 보내지 않는다 — 키는 PC 보안 저장소에 있다.
import { desktop } from './externalIO'
import { listConnections } from './aiConnections'

export function startRelayBridge(): (() => void) | undefined {
  const relay = desktop()?.relay
  if (!relay) return undefined
  const push = () => {
    // "휴대폰에 빌려주기"를 켠 내 연결만(PC 를 거쳐 온 연결은 제외). 키는 보내지 않고 연결 id 로 메인 프로세스가 찾는다
    const shared = listConnections().filter((c) => c.shareToPhone === true && !c.viaPc && !!c.baseUrl)
    void relay.upstreams(shared.map((c) => ({ id: c.id, kind: c.kind, baseUrl: c.baseUrl, model: c.model, keyStored: c.keyStored === true, keyId: c.id })))
  }
  push()
  window.addEventListener('nosidian-llm-changed', push)
  window.addEventListener('storage', push)
  return () => {
    window.removeEventListener('nosidian-llm-changed', push)
    window.removeEventListener('storage', push)
  }
}
