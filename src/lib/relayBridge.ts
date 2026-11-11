// PC 앱: 화면(렌더러)에 저장된 AI 연결 설정(종류·주소·모델)을 메인 프로세스의 중계에 알린다. 키는 보내지 않는다 — 키는 PC 보안 저장소에 있다.
import { desktop } from './externalIO'
import { loadLlmConfig } from './llm'

export function startRelayBridge(): (() => void) | undefined {
  const relay = desktop()?.relay
  if (!relay) return undefined
  const push = () => {
    const c = loadLlmConfig()
    void relay.upstream(c && !c.viaPc ? { kind: c.kind, baseUrl: c.baseUrl, model: c.model, keyStored: c.keyStored === true, keyId: c.id } : null)
  }
  push()
  window.addEventListener('nosidian-llm-changed', push)
  window.addEventListener('storage', push)
  return () => {
    window.removeEventListener('nosidian-llm-changed', push)
    window.removeEventListener('storage', push)
  }
}
