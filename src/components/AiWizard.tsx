// 설정 > AI: "AI 연결하기" 마법사. 방식 3갈래(내 구독 계정 / 내 컴퓨터 / API 키) 중 하나를 고르면
// 준비 상태를 자동으로 확인하고, 테스트 질문 한 번으로 연결을 확인한 뒤 AI 패널의 엔진으로 정한다. (PC 전용)
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { desktop, type ClaudeStatus } from '../lib/externalIO'
import { readiness } from '../lib/aiAssistant'
import { currentEngine, useAiThread } from '../lib/aiThread'
import { loadAllLlmConfigs, loadLlmConfig, providerOf, saveLlmConfig, supportsTools, type LlmConfig, type ProviderKind } from '../lib/llm'
import { chatTurn, clearStoredKey, keyStoreStatus, listModels, storeKey } from '../lib/llmNet'
import { listConnections, newConnectionId, removeConnection, setSelected, updateConnection } from '../lib/aiConnections'
import { modelList, refreshModels, refreshStaleModels } from '../lib/aiModels'
import { ask, confirmAsk } from '../lib/dialog'
import { LlmCard } from './LlmSettings'
import { startAnalysis } from '../lib/autoRunner'
import { adoptUpstream, loadPcLink, unpairPc, pairWithPc, parsePairing, runClaudeViaPc, syncPcUpstreams, type Pairing } from '../lib/pcLink'
import { useAiConfigVersion } from '../lib/useAiConfig'
import { QrScan } from './QrScan'
import { KEY_PROVIDERS, LOCAL_PROVIDERS, aiSummary, connectionBadge, connectionSub, connectionTitle, countConnected, isInUse, pickModel, type WizardWay } from '../lib/aiWizard'
import { Orb } from './Orb'
import { Select } from './Select'
import { ForgetLink } from './ForgetLink'

type Step = 'home' | 'pick' | WizardWay | 'done'
type Check = { kind: 'idle' } | { kind: 'busy'; text?: string } | { kind: 'ok'; text: string } | { kind: 'err'; text: string }

const claudeless = () => !desktop()?.claude
const TEST_Q = 'Reply with the single word OK.'
/** 연결 확인용 질문 하나. 생각(think)은 꺼서 짧은 답이 비지 않게 한다 */
const ping = async (cfg: LlmConfig) => (await chatTurn(cfg, [{ role: 'user', content: TEST_Q }], { think: false, maxTokens: 64, temperature: 0, timeoutMs: 120_000 })).text

export function AiWizard() {
  const claude = desktop()?.claude
  const mobile = !claude // 폰·웹: Claude Code 가 없으므로 내 컴퓨터/서버·API 키만
  const engine = currentEngine(useAiThread((s) => s.engine))
  const [step, setStep] = useState<Step>('home')
  const [cs, setCs] = useState<ClaudeStatus | null>(null)
  const [conns, setConns] = useState<LlmConfig[]>(() => loadAllLlmConfigs())
  const [pc, setPc] = useState(loadPcLink())
  /** 새로 추가하는 연결의 id(키를 이 이름으로 보관하므로 연결하기 전에 정해 둔다) */
  const [target, setTarget] = useState('')
  /** 지금 "고치기"로 펼쳐 둔 연결 */
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => { void claude?.detect().then(setCs) }, [claude])
  // 모델 목록이 없거나 낡은 연결은 열 때 백그라운드로 가져온다(목록이 오면 저장 이벤트로 화면이 다시 그려진다)
  useEffect(() => { void refreshStaleModels() }, [])
  // 폰: 연결해 둔 PC 가 지금 빌려주는 AI 가 바뀌었으면 목록을 맞춘다(PC 가 꺼져 있으면 조용히 그대로)
  useEffect(() => { if (mobile) void syncPcUpstreams() }, [mobile])
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [note, setNote] = useState<{ id: string; text: string } | null>(null)
  const refresh = async (id: string) => {
    setRefreshing(id)
    setNote(null)
    try {
      const list = await refreshModels(id)
      setNote({ id, text: t('모델 {n}개를 찾았어요', { n: list.length }) })
    } catch (e) {
      setNote({ id, text: (e instanceof Error ? e.message : String(e)) + ' — ' + t('마지막으로 가져온 목록을 보여 줘요') })
    } finally {
      setRefreshing(null)
    }
  }
  // 다른 곳(예: 폰의 PC 연결 해제, 다른 카드)에서 설정이 바뀌어도 목록을 다시 읽는다
  const cfgVersion = useAiConfigVersion()
  useEffect(() => { setConns(loadAllLlmConfigs()); setPc(loadPcLink()) }, [cfgVersion])
  const selectedId = loadLlmConfig()?.id ?? null
  const claudeReady = mobile ? !!pc?.claude : !!(cs?.found && cs.loggedIn)
  const n = countConnected(claudeReady, conns)
  const sum = aiSummary(engine, cs, loadLlmConfig(), pc)

  const finish = (e: 'claude' | 'ollama') => {
    useAiThread.getState().setEngine(e)
    setConns(loadAllLlmConfigs())
    setPc(loadPcLink())
    setStep('done')
  }
  const startAdd = () => { setTarget(newConnectionId()); setStep('pick') }
  const use = (id: string | 'claude') => {
    if (id === 'claude') return useAiThread.getState().setEngine('claude')
    setSelected(id)
    useAiThread.getState().setEngine('ollama')
  }
  /** 연결 이름을 직접 짓는다(비우면 종류와 주소로 만든 이름으로 돌아간다) */
  const rename = async (c: LlmConfig) => {
    if (!c.id) return
    const name = await ask(t('연결 이름'), connectionTitle(c), undefined, t('바꾸기'))
    if (name === null) return
    updateConnection(c.id, { label: name.trim().slice(0, 40) || undefined })
  }
  const remove = async (c: LlmConfig) => {
    if (!c.id) return
    const ok = await confirmAsk(t('"{name}" 연결을 해제할까요?', { name: connectionTitle(c) }), t('이 기기에 저장된 연결 정보와 키가 지워져요. 다른 연결에는 영향이 없어요.'), t('해제'), true)
    if (!ok) return
    removeConnection(c.id)
    void clearStoredKey(c.id)
    if (editing === c.id) setEditing(null)
  }

  return (
    <section className="card aiw">
      <h3>{t('AI 연결')}</h3>
      {step === 'home' && (
        <>
          <div className={`aiw-status${n ? ' on' : ''}`}>
            <Orb size={40} still={!n} />
            <span><b>{n ? t('AI {n}개 연결됨', { n }) : t('아직 연결 안 됨')}</b><small>{n ? (sum.connected ? t('지금 사용 중: {name}', { name: sum.sub ?? sum.title }) : t('아래에서 쓸 AI 를 골라 주세요')) : t('AI를 연결하면 노트에 대해 묻고 정리를 맡길 수 있어요')}</small></span>
          </div>
          {n > 0 && (
            <ul className="aiw-conns" aria-label={t('연결된 AI')}>
              {claudeReady && (
                <li className={`aiw-conn${isInUse(engine, selectedId, 'claude') ? ' on' : ''}`}>
                  <span className="aiw-conn-main"><b>{t('Claude (구독)')}</b><small>{mobile ? `${pc?.name ?? 'PC'} · Claude Code` : cs?.version ? `Claude Code ${cs.version}` : 'Claude Code'}</small></span>
                  <span className="aiw-conn-badge">{mobile ? t('PC 경유') : t('내 구독 계정')}</span>
                  <span className="aiw-conn-act">{isInUse(engine, selectedId, 'claude') ? <em>{t('사용 중')}</em> : <button className="btn-link" onClick={() => use('claude')}>{t('사용')}</button>}</span>
                </li>
              )}
              {conns.map((c) => {
                const inUse = !!c.id && isInUse(engine, selectedId, c.id)
                const full = listConnections().find((x) => x.id === c.id)
                const mods = full ? modelList(full) : []
                // 모델 고르기 상자가 있으면 설명 줄에 모델을 또 쓰지 않는다(도구 호출 미지원 이유만 남긴다)
                const sub = mods.length > 1 ? (supportsTools(c.kind) ? '' : t('도구 호출을 지원하지 않아 AI 패널에서는 쓸 수 없어요')) : connectionSub(c)
                return (
                  <li key={c.id} className={`aiw-conn${inUse ? ' on' : ''}`}>
                    <span className="aiw-conn-main"><b>{connectionTitle(c)}</b>{sub && <small>{sub}</small>}</span>
                    <span className="aiw-conn-badge">{connectionBadge(c)}</span>
                    {mods.length > 1 && c.id && (
                      <span className="aiw-conn-model">
                        <Select<string> className="aiw-model-sel" value={c.model} title={t('모델')} ariaLabel={t('모델')} onChange={(m) => updateConnection(c.id!, { model: m })} options={mods.map((m) => ({ value: m, label: m }))} />
                      </span>
                    )}
                    <span className="aiw-conn-act">
                      {inUse ? <em>{t('사용 중')}</em> : <button className="btn-link" disabled={!supportsTools(c.kind) || !c.model} onClick={() => c.id && use(c.id)}>{t('사용')}</button>}
                      {c.id && <button className="btn-link" disabled={refreshing === c.id} onClick={() => void refresh(c.id!)}>{refreshing === c.id ? t('불러오는 중…') : t('모델 새로 고침')}</button>}
                      {!mobile && <button className="btn-link" onClick={() => setEditing(editing === c.id ? null : c.id ?? null)}>{editing === c.id ? t('접기') : t('고치기')}</button>}
                      {c.id && <button className="btn-link" onClick={() => void rename(c)}>{t('이름 바꾸기')}</button>}
                      <button className="btn-link danger" onClick={() => void remove(c)}>{t('해제')}</button>
                    </span>
                    {note && note.id === c.id && <small className="aiw-conn-note">{note.text}</small>}
                    {editing === c.id && !mobile && <div className="aiw-conn-edit"><LlmCard connId={c.id} onClose={() => setEditing(null)} /></div>}
                  </li>
                )
              })}
            </ul>
          )}
          <button className={n ? 'big' : 'primary big'} onClick={startAdd}>{n ? t('+ AI 연결 추가') : t('AI 연결하기')}</button>
          {n > 0 && <button className="btn-link" onClick={() => useAiThread.getState().setOpen(true)}>{t('AI 패널 열기')}</button>}
          {mobile && pc && <ForgetLink kind="ai" pcName={pc.name} label={t('이 PC 연결 해제 ({name})', { name: pc.name })} onForget={async () => { const ok = await unpairPc(); setPc(null); setConns(loadAllLlmConfigs()); return ok }} />}
        </>
      )}
      {step === 'pick' && (
        <>
          <p className="aiw-q">{t('AI를 어떻게 연결할까요?')}</p>
          {mobile && (
            <button className="aiw-way" onClick={() => setStep('pc')}>
              <b>{t('내 PC에 연결')}</b>
              <small>{t('PC 앱을 함께 쓴다면 가장 쉬워요 (QR 스캔)')}</small>
            </button>
          )}
          {!mobile && (
            <button className="aiw-way" onClick={() => setStep('claude')}>
              <b>{t('내 구독 계정으로')}</b>
              <small>{t('Claude 계정이 있다면 가장 쉬워요')}</small>
            </button>
          )}
          <button className="aiw-way" onClick={() => setStep('local')}>
            <b>{mobile ? t('내 컴퓨터·서버의 AI에 연결') : t('내 컴퓨터에서 돌리기')}</b>
            <small>{mobile ? t('같은 와이파이의 PC나 서버에서 돌아가는 AI를 써요') : t('무료이고 문서가 밖으로 나가지 않아요')}</small>
          </button>
          <button className="aiw-way" onClick={() => setStep('key')}>
            <b>{t('API 키로 연결')}</b>
            <small>{t('키를 붙여 넣으면 끝나요')}</small>
          </button>
          <button className="link-btn" onClick={() => setStep('home')}>{t('취소')}</button>
        </>
      )}
      {step === 'claude' && !mobile && <ClaudeStep cs={cs} refresh={() => void claude.detect().then(setCs)} onBack={() => setStep('pick')} onDone={() => finish('claude')} />}
      {step === 'pc' && mobile && <PcStep onBack={() => setStep('pick')} onDone={finish} />}
      {step === 'local' && <LocalStep mobile={mobile} targetId={target} onBack={() => setStep('pick')} onDone={() => finish('ollama')} />}
      {step === 'key' && <KeyStep targetId={target} onBack={() => setStep('pick')} onDone={() => finish('ollama')} />}
      {step === 'done' && (
        <>
          <div className="aiw-status on"><Orb size={40} /><span><b>{t('연결됐어요')}</b><small>{aiSummary(currentEngine(useAiThread.getState().engine), cs, loadLlmConfig(), loadPcLink()).sub}</small></span></div>
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
function LocalStep({ mobile, targetId, onBack, onDone }: { mobile: boolean; targetId: string; onBack(): void; onDone(): void }) {
  const saved = null as LlmConfig | null // 항상 새 연결을 추가한다(고치기는 목록의 "고치기")
  const [kind, setKind] = useState<ProviderKind>(saved && LOCAL_PROVIDERS.some((p) => p.kind === saved.kind) ? saved.kind : 'ollama')
  // 폰에서는 localhost 가 이 폰 자신이라 쓸 수 없다 — PC·서버의 주소를 직접 입력한다
  const [url, setUrl] = useState(saved && saved.kind === kind ? saved.baseUrl : mobile ? '' : LOCAL_PROVIDERS.find((p) => p.kind === kind)!.url)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [c, setC] = useState<Check>({ kind: 'idle' })
  const base: LlmConfig = { kind, baseUrl: url.trim(), model }
  const pickKind = (k: ProviderKind) => { setKind(k); setUrl(mobile ? '' : LOCAL_PROVIDERS.find((p) => p.kind === k)!.url); setModels([]); setModel(''); setC({ kind: 'idle' }) }
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
      saveLlmConfig({ id: targetId, ...base, model })
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
      {mobile && (
        <>
          <input className="inline wide" value={url} placeholder={kind === 'ollama' ? 'http://192.168.0.10:11434' : 'http://192.168.0.10:1234/v1'} inputMode="url" autoCapitalize="off" autoCorrect="off" onChange={(e) => { setUrl(e.target.value); setModels([]) }} aria-label={t('서버 주소')} />
          <p className="hint small">{t('PC에서 AI를 켜 두고, 같은 와이파이의 PC 주소를 적어 주세요. Ollama는 OLLAMA_HOST=0.0.0.0 으로 열어 두어야 해요.')}</p>
        </>
      )}
      <button className="big" disabled={c.kind === 'busy' || (mobile && !url.trim())} onClick={() => void find()}>{models.length ? t('다시 찾기') : t('AI 찾기')}</button>
      {models.length > 0 && (
        <div className="kv"><span>{t('모델')}</span><Select<string> value={model} title={t('모델')} onChange={setModel} options={models.map((m) => ({ value: m, label: m }))} /></div>
      )}
      <CheckLine c={c} />
      {models.length > 0 && <button className="primary big" disabled={!model || c.kind === 'busy'} onClick={() => void connect()}>{t('테스트하고 연결')}</button>}
      {!mobile && (
        <details className="more"><summary>{t('서버 주소')}</summary><input className="inline wide" value={url} onChange={(e) => { setUrl(e.target.value); setModels([]) }} aria-label={t('서버 주소')} /></details>
      )}
      <button className="link-btn" onClick={onBack}>{t('← 다른 방법')}</button>
    </>
  )
}

/** API 키로 연결 */
function KeyStep({ targetId, onBack, onDone }: { targetId: string; onBack(): void; onDone(): void }) {
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
      const id = targetId // 새 연결 — 키도 이 연결 이름으로 보관한다
      const secure = await keyStoreStatus(id)
      if (secure.available) {
        await storeKey(key.trim(), id)
        saveLlmConfig({ id, kind, baseUrl: base.baseUrl, model, keyStored: true })
      } else saveLlmConfig({ id, ...base, model })
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
      <p className="hint small">{claudeless() ? t('키는 이 휴대폰에만 저장돼요(암호화되지 않아요). AI를 쓰면 노트 내용이 해당 업체로 전송돼요.') : t('키는 이 PC에만 저장돼요. AI를 쓰면 노트 내용이 해당 업체로 전송돼요.')}</p>
      <button className="link-btn" onClick={onBack}>{t('← 다른 방법')}</button>
    </>
  )
}

/** 내 PC에 연결(폰): PC 앱의 연결 코드(QR)로 짝을 맺는다. PC 의 Claude 구독·AI 서버를 폰의 노트로 쓰게 된다 */
function PcStep({ onBack, onDone }: { onBack(): void; onDone(e: 'claude' | 'ollama'): void }) {
  const [text, setText] = useState('')
  const [scan, setScan] = useState(false)
  const [c, setC] = useState<Check>({ kind: 'idle' })
  const connect = async (given?: Pairing) => {
    const pr = given ?? parsePairing(text)
    if (!pr) return setC({ kind: 'err', text: t('PC 화면의 연결 코드를 확인해 주세요(예: 192.168.0.10:47410/482913)') })
    setC({ kind: 'busy', text: t('PC에 연결하는 중…') })
    try {
      const link = await pairWithPc(pr, t('내 휴대폰'))
      const hasModel = adoptUpstream(link)
      if (!link.claude && !hasModel) return setC({ kind: 'err', text: t('PC에서 쓸 수 있는 AI가 없어요. PC 앱에서 AI를 먼저 연결해 주세요.') })
      if (link.claude) {
        // 테스트 질문 한 번(PC 의 Claude Code 가 답한다)
        setC({ kind: 'busy', text: t('테스트 질문을 보내는 중… (몇 초 걸려요)') })
        let ok = false
        let msg = ''
        await runClaudeViaPc(link, { prompt: TEST_Q, mode: 'ask' }, (e) => {
          if (e.type === 'result' && e.ok) ok = true
          else if (e.type === 'error' || (e.type === 'result' && !e.ok)) msg = e.type === 'error' ? e.message : e.text
        }).done
        if (ok) return onDone('claude')
        if (!hasModel) return setC({ kind: 'err', text: msg || t('응답을 받지 못했어요') })
      }
      const cfg = loadLlmConfig()!
      const reply = await ping(cfg)
      setC({ kind: 'ok', text: t('응답을 받았어요: {r}', { r: reply.trim().slice(0, 40) }) })
      onDone('ollama')
    } catch (e) {
      setC({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <>
      <p className="aiw-q">{t('PC 앱에서 연결 코드를 받아 주세요')}</p>
      <ol className="aiw-steps">
        <li>{t('PC 앱 설정 > AI')}</li>
        <li>{t('"휴대폰에서 이 PC의 AI 쓰기"를 켜기')}</li>
        <li>{t('나온 QR을 스캔하거나 코드를 입력')}</li>
      </ol>
      <button className="primary big" disabled={c.kind === 'busy'} onClick={() => setScan(true)}>{t('QR 스캔')}</button>
      <input className="inline wide" value={text} placeholder="192.168.0.10:47410/482913" inputMode="text" autoCapitalize="off" autoCorrect="off" onChange={(e) => { setText(e.target.value); setC({ kind: 'idle' }) }} aria-label={t('연결 코드')} />
      <button className="big" disabled={!text.trim() || c.kind === 'busy'} onClick={() => void connect()}>{t('코드로 연결')}</button>
      <CheckLine c={c} />
      <button className="link-btn" onClick={onBack}>{t('← 다른 방법')}</button>
      {scan && <QrScan parse={parsePairing} onClose={() => setScan(false)} onResult={(p) => { setScan(false); void connect(p) }} />}
    </>
  )
}
