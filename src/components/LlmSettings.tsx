// 설정 > AI 연결의 직접 설정: 어떤 AI 서버를 쓸지(제공자·서버 주소·모델·키)를 이 기기에 저장하고 연결을 시험한다.
//  - connId 가 있으면 그 연결을 고친다(목록의 "고치기"). 없으면 새 연결을 추가한다(고급: 직접 입력해서 추가). 키는 vault·동기화에 넣지 않는다.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { PROVIDERS, providerOf, saveLlmConfig, supportsTools, toLlmConfig, validateConfig, type LlmConfig, type ProviderKind } from '../lib/llm'
import { connectionById, newConnectionId, removeConnection } from '../lib/aiConnections'
import { desktop } from '../lib/externalIO'
import { chat, clearStoredKey, keyStoreStatus, listModels, storeKey } from '../lib/llmNet'
import { Select } from './Select'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; text: string } | { kind: 'err'; text: string }

const BLANK: LlmConfig = { kind: 'ollama', baseUrl: providerOf('ollama').url, model: '' }

export function LlmCard({ connId, onClose }: { connId?: string; onClose?(): void } = {}) {
  const saved = connId ? toLlmConfig(connectionById(connId)) : null
  // 새 연결을 추가할 때는 키를 이 id 로 보관하므로 미리 정해 둔다
  const [newId, setNewId] = useState(() => newConnectionId())
  const target = connId ?? newId
  const [cfg, setCfg] = useState<LlmConfig>(saved ?? BLANK)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [dirty, setDirty] = useState(false)
  const [secure, setSecure] = useState<{ available: boolean; has: boolean }>({ available: false, has: false })
  useEffect(() => void keyStoreStatus(target).then(setSecure), [target])
  const prov = providerOf(cfg.kind)
  const set = (p: Partial<LlmConfig>) => { setCfg((c) => ({ ...c, ...p })); setDirty(true); setStatus({ kind: 'idle' }) }

  const pickKind = (kind: ProviderKind) => {
    setCfg({ kind, baseUrl: providerOf(kind).url, model: '', apiKey: cfg.apiKey }) // 보안 저장소의 키는 제공자마다 다르므로 이어받지 않는다(keyStored 해제)
    setModels([])
    setDirty(true)
    setStatus({ kind: 'idle' })
  }

  // 방금 새로 입력한 키가 있으면 그 키로, 없으면 보안 저장소의 키로 시험한다
  const effective = (): LlmConfig => (cfg.apiKey?.trim() ? { ...cfg, keyStored: false } : cfg)

  const test = async () => {
    setStatus({ kind: 'busy' })
    try {
      const found = await listModels(effective())
      setModels(found)
      if (!cfg.model.trim()) {
        setStatus({ kind: 'ok', text: found.length ? t('연결됐어요. 모델 {n}개를 찾았어요. 아래에서 골라 주세요.', { n: found.length }) : t('연결됐어요. 서버에 설치된 모델이 없어요.') })
        return
      }
      const reply = await chat(effective(), [{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 16, temperature: 0 })
      setStatus({ kind: 'ok', text: t('연결됐어요. 모델 응답: {reply}', { reply: reply.trim().slice(0, 60) }) })
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const save = async () => {
    const typed = cfg.apiKey?.trim()
    if (typed && secure.available) {
      // 키는 운영체제 보안 저장소(메인 프로세스)로 보내고, 화면과 localStorage 에는 남기지 않는다
      try {
        await storeKey(typed, target)
      } catch (e) {
        setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
        return
      }
      const next: LlmConfig = { id: target, kind: cfg.kind, baseUrl: cfg.baseUrl, model: cfg.model, keyStored: true }
      saveLlmConfig(next)
      setCfg(next)
      setSecure({ available: true, has: true })
    } else {
      saveLlmConfig({ ...cfg, id: target })
    }
    setDirty(false)
    if (!connId) {
      // 추가 모드: 저장했으면 다음 연결을 위해 빈 칸으로 돌아간다
      setCfg(BLANK)
      setModels([])
      setNewId(newConnectionId())
      setSecure((x) => ({ ...x, has: false }))
      setStatus({ kind: 'ok', text: t('연결을 추가했어요. 위 목록에서 쓸 AI 를 고를 수 있어요') })
      return
    }
    setStatus({ kind: 'ok', text: t('이 기기에 저장했어요') })
  }
  const clear = () => {
    void clearStoredKey(target)
    setSecure((x) => ({ ...x, has: false }))
    if (connId) removeConnection(connId)
    setCfg(BLANK)
    setModels([])
    setDirty(false)
    setStatus({ kind: 'idle' })
    onClose?.()
  }

  const problems = validateConfig(cfg, { needModel: false })

  return (
    <section className="card llm">
      {!connId && <h3>{t('AI 연결')}</h3>}
      <div className="kv"><span>{t('제공자')}</span>
        <Select<ProviderKind> value={cfg.kind} title={t('제공자')} ariaLabel={t('제공자')} onChange={pickKind} options={PROVIDERS.map((p) => ({ value: p.kind, label: p.label }))} />
      </div>
      <div className="kv"><span>{t('서버 주소')}</span>
        <input className="inline" value={cfg.baseUrl} placeholder={prov.url} onChange={(e) => set({ baseUrl: e.target.value })} />
      </div>
      <div className="kv"><span>{t('모델')}</span>
        {models.length > 0 ? (
          <Select<string> value={cfg.model} title={t('모델')} ariaLabel={t('모델')} placeholder={t('모델 고르기…')} onChange={(m) => set({ model: m })} options={models.map((m) => ({ value: m, label: m }))} />
        ) : (
          <input className="inline" value={cfg.model} placeholder={t('연결 시험 후 고르거나 직접 입력')} onChange={(e) => set({ model: e.target.value })} />
        )}
      </div>
      <div className="kv"><span>{t('API 키')}</span>
        <input className="inline" type="password" autoComplete="off" value={cfg.apiKey ?? ''} placeholder={cfg.keyStored ? t('보안 저장소에 저장됨 — 바꾸려면 새 키 입력') : prov.needsKey ? t('필수') : t('필요하면 입력')} onChange={(e) => set({ apiKey: e.target.value })} />
      </div>
      {prov.hint && <p className="hint small">{t(prov.hint)}</p>}
      {supportsTools(cfg.kind) && desktop() && <p className="hint small">{t('AI 패널에서 이 모델로 답해요(도구 호출을 지원하는 모델 필요).')}</p>}
      {problems.includes('httpPublic') && <p className="hint small llm-err">{t('공개 인터넷 주소는 https 로만 연결할 수 있어요 (http 는 같은 사설망·내 기기만)')}</p>}
      <div className="llm-actions">
        <button disabled={problems.length > 0 || status.kind === 'busy'} onClick={() => void test()}>{status.kind === 'busy' ? t('시험하는 중…') : t('연결 시험')}</button>
        <button className="primary" disabled={!dirty || problems.length > 0} onClick={() => void save()}>{t('저장')}</button>
        {connId && <button onClick={clear}>{t('연결 지우기')}</button>}
      </div>
      {status.kind === 'ok' && <p className="hint small llm-ok">{status.text}</p>}
      {status.kind === 'err' && <p className="hint small llm-err">{status.text}</p>}
      <p className="hint small">{secure.available ? t('API 키는 이 PC의 보안 저장소에 암호화해 저장돼요. 동기화에는 들어가지 않아요.') : t('API 키는 이 기기에만 저장되고 vault·동기화에는 들어가지 않아요. 이 기기에서는 암호화되지 않은 채로 저장돼요.')} {t('AI를 쓰면 노트 내용이 여기서 고른 서버로 전송돼요.')}</p>
    </section>
  )
}
