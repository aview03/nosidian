// 설정 > AI: "AI 연결하기" 마법사. 방식 3갈래(내 구독 계정 / 내 컴퓨터 / API 키) 중 하나를 고르면
// 준비 상태를 자동으로 확인하고, 테스트 질문 한 번으로 연결을 확인한 뒤 AI 패널의 엔진으로 정한다. (PC 전용)
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { desktop, type ClaudeStatus } from '../lib/externalIO'
import { readiness } from '../lib/aiAssistant'
import { useAiThread } from '../lib/aiThread'
import { loadLlmConfig, providerOf, saveLlmConfig, type LlmConfig, type ProviderKind } from '../lib/llm'
import { chatTurn, keyStoreStatus, listModels, storeKey } from '../lib/llmNet'
import { startAnalysis } from '../lib/autoRunner'
import { KEY_PROVIDERS, LOCAL_PROVIDERS, aiSummary, pickModel, type WizardWay } from '../lib/aiWizard'
import { Orb } from './Orb'
import { Select } from './Select'

type Step = 'home' | 'pick' | WizardWay | 'done'
type Check = { kind: 'idle' } | { kind: 'busy'; text?: string } | { kind: 'ok'; text: string } | { kind: 'err'; text: string }

const TEST_Q = 'Reply with the single word OK.'
/** 연결 확인용 질문 하나. 생각(think)은 꺼서 짧은 답이 비지 않게 한다 */
const ping = async (cfg: LlmConfig) => (await chatTurn(cfg, [{ role: 'user', content: TEST_Q }], { think: false, maxTokens: 64, temperature: 0, timeoutMs: 120_000 })).text

export function AiWizard() {
  const claude = desktop()?.claude
  const engine = useAiThread((s) => s.engine)
  const [step, setStep] = useState<Step>('home')
  const [cs, setCs] = useState<ClaudeStatus | null>(null)
  const [cfg, setCfg] = useState<LlmConfig | null>(loadLlmConfig())
  useEffect(() => { void claude?.detect().then(setCs) }, [claude])
  if (!claude) return null
  const sum = aiSummary(engine, cs, cfg)

  const finish = (e: 'claude' | 'ollama') => {
    useAiThread.getState().setEngine(e)
    setCfg(loadLlmConfig())
    setStep('done')
  }

  return (
    <section className="card aiw">
      <h3>{t('AI 연결')}</h3>
      {step === 'home' && (
        <>
          <div className={`aiw-status${sum.connected ? ' on' : ''}`}>
            <Orb size={40} still={!sum.connected} />
            <span><b>{sum.title}</b>{sum.sub && <small>{sum.sub}</small>}</span>
          </div>
          <button className={sum.connected ? 'big' : 'primary big'} onClick={() => setStep('pick')}>{sum.connected ? t('연결 바꾸기') : t('AI 연결하기')}</button>
          {sum.connected && <button className="btn-link" onClick={() => useAiThread.getState().setOpen(true)}>{t('AI 패널 열기')}</button>}
        </>
      )}
      {step === 'pick' && (
        <>
          <p className="aiw-q">{t('AI를 어떻게 연결할까요?')}</p>
          <button className="aiw-way" onClick={() => setStep('claude')}>
            <b>{t('내 구독 계정으로')}</b>
            <small>{t('Claude 계정이 있다면 가장 쉬워요')}</small>
          </button>
          <button className="aiw-way" onClick={() => setStep('local')}>
            <b>{t('내 컴퓨터에서 돌리기')}</b>
            <small>{t('무료이고 문서가 밖으로 나가지 않아요')}</small>
          </button>
          <button className="aiw-way" onClick={() => setStep('key')}>
            <b>{t('API 키로 연결')}</b>
            <small>{t('키를 붙여 넣으면 끝나요')}</small>
          </button>
          <button className="link-btn" onClick={() => setStep('home')}>{t('취소')}</button>
        </>
      )}
      {step === 'claude' && <ClaudeStep cs={cs} refresh={() => void claude.detect().then(setCs)} onBack={() => setStep('pick')} onDone={() => finish('claude')} />}
      {step === 'local' && <LocalStep onBack={() => setStep('pick')} onDone={() => finish('ollama')} />}
      {step === 'key' && <KeyStep onBack={() => setStep('pick')} onDone={() => finish('ollama')} />}
      {step === 'done' && (
        <>
          <div className="aiw-status on"><Orb size={40} /><span><b>{t('연결됐어요')}</b><small>{aiSummary(useAiThread.getState().engine, cs, loadLlmConfig()).sub}</small></span></div>
          <button className="primary big" onClick={() => { useAiThread.getState().setOpen(true); setStep('home') }}>{t('AI 패널 열기')}</button>
          <button className="link-btn" onClick={() => setStep('home')}>{t('닫기')}</button>
        </>
      )}
    </section>
  )
}

function CheckLine({ c }: { c: Check }) {
  if (c.kind === 'idle') return null
  return <p className={`aiw-check ${c.kind}`} aria-live="polite">{c.kind === 'busy' ? (c.text ?? t('확인하는 중…')) : c.text}</p>
}

/** 내 구독 계정(Claude Code) */
function ClaudeStep({ cs, refresh, onBack, onDone }: { cs: ClaudeStatus | null; refresh(): void; onBack(): void; onDone(): void }) {
  const [c, setC] = useState<Check>({ kind: 'idle' })
  const r = readiness(cs)
  const test = async () => {
    setC({ kind: 'busy', text: t('테스트 질문을 보내는 중… (몇 초 걸려요)') })
    const o = await startAnalysis(TEST_Q, 'claude').done
    if (o.ok) {
      setC({ kind: 'ok', text: t('응답을 받았어요: {r}', { r: o.text.trim().slice(0, 40) }) })
      onDone()
    } else setC({ kind: 'err', text: o.error ?? t('응답을 받지 못했어요') })
  }
  return (
    <>
      <p className="aiw-q">{t('Claude 계정으로 연결해요')}</p>
      <div className="aiw-list">
        <div className={`aiw-item ${r === 'ok' ? 'ok' : ''}`}><b>Claude Code</b><span>{r === 'ok' ? t('준비됐어요') : r === 'notLoggedIn' ? t('설치됨 · 로그인 필요') : r === 'unknown' ? t('확인하는 중…') : t('찾지 못했어요')}</span></div>
        <div className="aiw-item soon"><b>Codex</b><span>{t('준비 중')}</span></div>
        <div className="aiw-item soon"><b>Antigravity</b><span>{t('준비 중')}</span></div>
      </div>
      {r === 'notLoggedIn' && <p className="hint small">{t('터미널에서 claude auth login 을 실행해 로그인해 주세요.')}</p>}
      {(r === 'notFound' || r === 'onlyCmd') && <p className="hint small">{t('Claude Code를 설치하고 터미널에서 claude 로 로그인해 주세요.')}</p>}
      <CheckLine c={c} />
      {r === 'ok' ? <button className="primary big" disabled={c.kind === 'busy'} onClick={() => void test()}>{t('테스트하고 연결')}</button> : <button className="big" onClick={refresh}>{t('다시 확인')}</button>}
      <button className="link-btn" onClick={onBack}>{t('← 다른 방법')}</button>
    </>
  )
}

/** 내 컴퓨터에서 돌리는 AI(Ollama · LM Studio) */
function LocalStep({ onBack, onDone }: { onBack(): void; onDone(): void }) {
  const saved = loadLlmConfig()
  const [kind, setKind] = useState<ProviderKind>(saved && LOCAL_PROVIDERS.some((p) => p.kind === saved.kind) ? saved.kind : 'ollama')
  const [url, setUrl] = useState(saved && saved.kind === kind ? saved.baseUrl : LOCAL_PROVIDERS.find((p) => p.kind === kind)!.url)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [c, setC] = useState<Check>({ kind: 'idle' })
  const base: LlmConfig = { kind, baseUrl: url.trim(), model }
  const pickKind = (k: ProviderKind) => { setKind(k); setUrl(LOCAL_PROVIDERS.find((p) => p.kind === k)!.url); setModels([]); setModel(''); setC({ kind: 'idle' }) }
  const find = async () => {
    setC({ kind: 'busy' })
    try {
      const found = await listModels(base)
      setModels(found)
      setModel(pickModel(kind, found))
      setC(found.length ? { kind: 'ok', text: t('모델 {n}개를 찾았어요', { n: found.length }) } : { kind: 'err', text: t('설치된 모델이 없어요. 모델을 먼저 내려받아 주세요.') })
    } catch (e) {
      setC({ kind: 'err', text: (e instanceof Error ? e.message : String(e)) + ' — ' + t('프로그램이 켜져 있는지 확인해 주세요') })
    }
  }
  const connect = async () => {
    if (!model) return
    setC({ kind: 'busy', text: t('테스트 질문을 보내는 중…') })
    try {
      const reply = await ping({ ...base, model })
      saveLlmConfig({ ...base, model })
      setC({ kind: 'ok', text: t('응답을 받았어요: {r}', { r: reply.trim().slice(0, 40) }) })
      onDone()
    } catch (e) {
      setC({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <>
      <p className="aiw-q">{t('내 컴퓨터의 AI를 찾아요')}</p>
      <div className="seg wide">
        {LOCAL_PROVIDERS.map((p) => <button key={p.kind} className={kind === p.kind ? 'on' : ''} onClick={() => pickKind(p.kind)}>{p.label}</button>)}
      </div>
      <button className="big" disabled={c.kind === 'busy'} onClick={() => void find()}>{models.length ? t('다시 찾기') : t('AI 찾기')}</button>
      {models.length > 0 && (
        <div className="kv"><span>{t('모델')}</span><Select<string> value={model} title={t('모델')} onChange={setModel} options={models.map((m) => ({ value: m, label: m }))} /></div>
      )}
      <CheckLine c={c} />
      {models.length > 0 && <button className="primary big" disabled={!model || c.kind === 'busy'} onClick={() => void connect()}>{t('테스트하고 연결')}</button>}
      <details className="more"><summary>{t('서버 주소')}</summary><input className="inline wide" value={url} onChange={(e) => { setUrl(e.target.value); setModels([]) }} aria-label={t('서버 주소')} /></details>
      <button className="link-btn" onClick={onBack}>{t('← 다른 방법')}</button>
    </>
  )
}

/** API 키로 연결 */
function KeyStep({ onBack, onDone }: { onBack(): void; onDone(): void }) {
  const [kind, setKind] = useState<ProviderKind>('openai')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [c, setC] = useState<Check>({ kind: 'idle' })
  const base: LlmConfig = { kind, baseUrl: providerOf(kind).url, model, apiKey: key.trim() }
  const find = async () => {
    setC({ kind: 'busy' })
    try {
      const found = await listModels(base)
      setModels(found)
      setModel(pickModel(kind, found))
      setC({ kind: 'ok', text: t('키가 확인됐어요') })
    } catch (e) {
      setC({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }
  const connect = async () => {
    setC({ kind: 'busy', text: t('테스트 질문을 보내는 중…') })
    try {
      const reply = await ping({ ...base, model })
      // 키는 운영체제 보안 저장소에 넣고, 화면·localStorage 에는 남기지 않는다(보안 저장소가 없으면 이 기기에만 저장)
      const secure = await keyStoreStatus()
      if (secure.available) {
        await storeKey(key.trim())
        saveLlmConfig({ kind, baseUrl: base.baseUrl, model, keyStored: true })
      } else saveLlmConfig({ ...base, model })
      setC({ kind: 'ok', text: t('응답을 받았어요: {r}', { r: reply.trim().slice(0, 40) }) })
      onDone()
    } catch (e) {
      setC({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <>
      <p className="aiw-q">{t('API 키를 붙여 넣어 주세요')}</p>
      <div className="aiw-list">
        {KEY_PROVIDERS.map((p) => (
          <button key={p.kind} disabled={!p.ready} className={`aiw-item pick${kind === p.kind ? ' ok' : ''}${p.ready ? '' : ' soon'}`} onClick={() => { setKind(p.kind); setModels([]); setC({ kind: 'idle' }) }}>
            <b>{providerOf(p.kind).label}</b><span>{p.ready ? '' : t('준비 중')}</span>
          </button>
        ))}
      </div>
      <input className="inline wide" type="password" autoComplete="off" value={key} placeholder={t('API 키')} onChange={(e) => { setKey(e.target.value); setModels([]); setC({ kind: 'idle' }) }} aria-label={t('API 키')} />
      <button className="big" disabled={!key.trim() || c.kind === 'busy'} onClick={() => void find()}>{t('키 확인')}</button>
      {models.length > 0 && (
        <div className="kv"><span>{t('모델')}</span><Select<string> value={model} title={t('모델')} onChange={setModel} options={models.map((m) => ({ value: m, label: m }))} /></div>
      )}
      <CheckLine c={c} />
      {models.length > 0 && <button className="primary big" disabled={!model || c.kind === 'busy'} onClick={() => void connect()}>{t('테스트하고 연결')}</button>}
      <p className="hint small">{t('키는 이 PC에만 저장돼요. AI를 쓰면 노트 내용이 해당 업체로 전송돼요.')}</p>
      <button className="link-btn" onClick={onBack}>{t('← 다른 방법')}</button>
    </>
  )
}
