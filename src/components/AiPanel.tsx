// AI 패널(PC): 화면 오른쪽에 붙는 대화 패널. 노트를 보면서 묻고, 답변 속 노트 경로를 눌러 본문에서 열고, 변경 제안을 그 자리에서 검토·승인한다.
// 대화·실행 상태는 lib/aiThread.ts(스토어)에 있어서 패널을 닫아도 실행이 이어진다. 실제 실행은 PC 의 Claude Code CLI(고정된 안전 옵션)이다.
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { desktop, type ClaudeStatus } from '../lib/externalIO'
import { baseName } from '../lib/links'
import { linkifyPaths, PRESETS, readiness, toolLabel } from '../lib/aiAssistant'
import { localEngine, useAiThread, type Engine, type Msg, type Step } from '../lib/aiThread'
import { isStale } from '../lib/proposals'
import { useProposals } from '../lib/proposalStore'
import { useAutomation } from '../lib/automation'
import { changedPaths } from '../lib/autoTriggers'
import { autoInboxCount } from './AutoSettings'
import { Icon } from './Icon'
import { Reader } from './Reader'
import { Select } from './Select'
import orbAnim from '../assets/ai-thinking.webp'
import orbStill from '../assets/ai-thinking-still.webp'
import { Diff, KIND, reasonText } from './ProposalReview'

/** 변경 제안 카드: 패널 안에서 차이를 보고 승인·거절한다(승인하면 반영 직전에 한 번 더 확인한다) */
function ProposalCard({ id }: { id: string }) {
  const p = useProposals((s) => s.items.find((x) => x.id === id))
  const files = useApp((s) => s.files)
  if (!p) return null
  const stale = p.status === 'pending' && isStale(p, files)
  return (
    <section className={`ai-prop ${p.status}`}>
      <header>
        <b className="pr-kind">{t(KIND[p.req.action])}</b>
        <span className="ai-prop-path">{p.req.path}</span>
      </header>
      {p.summary && <p className="ai-prop-sum">{p.summary}</p>}
      <p className="hint small">{reasonText(p.reason, p.text)}</p>
      <div className="ai-prop-diff"><Diff p={p} /></div>
      {p.status === 'pending' ? (
        <footer>
          {stale && <span className="pr-stale">{t('AI 가 읽은 뒤 문서가 바뀌었어요')} — {t('승인해도 반영되지 않아요')}</span>}
          <span className="grow" />
          <button onClick={() => useProposals.getState().reject(p.id)}>{t('거절')}</button>
          <button className="primary" disabled={stale} onClick={() => useProposals.getState().approve(p.id)}>{t('승인하고 반영')}</button>
        </footer>
      ) : (
        <p className="hint small ai-prop-done">{p.status === 'applied' ? t('반영했어요') : p.status === 'rejected' ? t('거절했어요') : `${t('반영하지 못했어요')}${p.failReason ? ` — ${reasonText(p.failReason)}` : ''}`}</p>
      )}
    </section>
  )
}

/** AI 가 일하는 중임을 보여 준다: 빛나는 구(움직이는 이미지) + 지금 하는 일. 움직임을 줄인 설정이면 정지 이미지로 */
function Orb({ size, still }: { size: number; still?: boolean }) {
  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={orbStill} />
      <img className="ai-orb" src={still ? orbStill : orbAnim} alt="" width={size} height={size} draggable={false} />
    </picture>
  )
}

/** 대화 속 프로필 사진: AI 는 빛나는 구(일하는 중이면 움직인다), 나는 이름의 첫 글자 */
function Avatar({ kind, busy }: { kind: 'ai' | 'me'; busy?: boolean }) {
  const name = useApp((s) => s.settings.myName)
  if (kind === 'ai') return <span className="ai-avatar ai" aria-hidden="true"><Orb size={32} still={!busy} /></span>
  const initial = [...(name.split(',')[0] ?? '').trim()][0]
  return <span className="ai-avatar me" aria-hidden="true">{initial ? initial.toUpperCase() : t('나')}</span>
}

function Thinking({ step }: { step?: Step }) {
  return (
    <div className="ai-think" role="status" aria-live="polite">
      <div className="ai-think-text">
        <span className="ai-think-title">{t('생각하는 중…')}</span>
        {step && <span className="ai-think-step">{toolLabel(step.name)}{step.input ? ` · ${step.input}` : ''}</span>}
      </div>
    </div>
  )
}

function UserMsg({ m }: { m: Msg }) {
  return (
    <div className="ai-u">
      <div className="ai-u-body">
        <div className="ai-u-text">{m.text}</div>
        <div className="ai-u-meta">
          {m.mode === 'edit' ? t('변경 제안') : t('묻기')}
          {m.engine === 'ollama' && <> · {t('로컬 모델')}</>}
          {m.note && <> · {baseName(m.note)}</>}
        </div>
      </div>
      <Avatar kind="me" />
    </div>
  )
}

function AiMsg({ m, last }: { m: Msg; last: boolean }) {
  const files = useApp((s) => s.files)
  const items = useProposals((s) => s.items)
  const running = useAiThread((s) => s.running)
  const pendingIds = (m.proposals ?? []).filter((id) => items.find((p) => p.id === id)?.status === 'pending')
  const steps = m.steps ?? []
  const busy = m.status === 'running'
  const stale = !!m.source && changedPaths(m.source.hashes, files).length > 0
  const text = linkifyPaths(m.text, (p) => !!files[p] && !files[p].deleted, Object.keys(files))
  return (
    <div className="ai-a">
      <Avatar kind="ai" busy={busy} />
      <div className="ai-a-body">
      <div className={`ai-bubble${m.status === 'done' && m.text ? '' : ' plain'}`}>
      {steps.length > 0 && (
        busy ? (
          <ul className="ai-steps">{steps.slice(0, -1).slice(-3).map((s, i) => <li key={i}><b>{toolLabel(s.name)}</b>{s.input && <span>{s.input}</span>}</li>)}</ul>
        ) : (
          <details className="ai-steps-done">
            <summary>{t('진행 {n}단계', { n: steps.length })}</summary>
            <ul className="ai-steps">{steps.map((s, i) => <li key={i}><b>{toolLabel(s.name)}</b>{s.input && <span>{s.input}</span>}</li>)}</ul>
          </details>
        )
      )}
      {busy && <Thinking step={steps.at(-1)} />}
      {m.status === 'error' && <p className="hint ai-err">{m.error}</p>}
      {m.status === 'done' && m.text && steps.length === 0 && <p className="hint small ai-notool">{t('노트를 읽지 않고 답했어요 — 내용이 사실과 다를 수 있어요')}</p>}
      {m.status === 'done' && m.text && (
        <>
          <div className="ai-text"><Reader path="AI" content={text} compact /></div>
        </>
      )}
      </div>
      {m.status === 'done' && m.text && (
        <div className="ai-foot">
          <button className="btn-link" onClick={() => void navigator.clipboard.writeText(m.text).then(() => useApp.getState().say(t('복사했어요')))}>{t('복사')}</button>
        </div>
      )}
      {m.status === 'done' && m.fix === 'plan' && last && stale && (
        <div className="ai-plan">
          <span className="hint small ai-warn">{t('문서가 변경되어 재검토가 필요합니다')}</span>
          <button className="primary" onClick={() => useAutomation.getState().reanalyze(m.source!.itemId)}>{t('다시 분석')}</button>
        </div>
      )}
      {m.status === 'done' && m.fix === 'plan' && last && !stale && (
        <div className="ai-plan">
          <span className="hint small">{t('계획을 확인한 뒤 누르세요. 누르기 전에는 아무것도 바뀌지 않아요. "결정 필요" 항목은 아래 입력창에 답하면 계획을 고쳐 드려요.')}</span>
          <button className="primary" disabled={running} onClick={() => void useAiThread.getState().applyPlan(m.id)}>{t('이 계획대로 변경 제안 만들기')}</button>
        </div>
      )}
      {(m.proposals ?? []).map((id) => <ProposalCard key={id} id={id} />)}
      {pendingIds.length >= 2 && (
        <div className="ai-group">
          <p className="hint small">{t('이 제안들은 한 묶음이에요. 함께 승인하면 전부 반영하거나, 하나라도 안 되면 아무것도 반영하지 않아요.')}</p>
          <div className="ai-group-btns">
            <button onClick={() => useProposals.getState().rejectGroup(pendingIds)}>{t('모두 거절')}</button>
            <button className="primary" onClick={() => useProposals.getState().approveGroup(pendingIds)}>{t('모두 승인 ({n}건)', { n: pendingIds.length })}</button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

export function AiPanel() {
  const autoNew = useAutomation((s) => (s.settings.mode === 'off' ? 0 : autoInboxCount(s.st)))
  const pc = !!desktop()
  const claude = desktop()?.claude
  const open = useAiThread((s) => s.open)
  const wide = useAiThread((s) => s.wide)
  const width = useAiThread((s) => s.width)
  const mode = useAiThread((s) => s.mode)
  const engine = useAiThread((s) => s.engine)
  const withNote = useAiThread((s) => s.withNote)
  const messages = useAiThread((s) => s.messages)
  const running = useAiThread((s) => s.running)
  const draft = useAiThread((s) => s.draft)
  const current = useApp((s) => s.current)
  const vault = useApp((s) => s.settings.activeVault)
  const pending = useProposals((s) => s.items.filter((p) => p.status === 'pending').length)
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  const [local, setLocal] = useState(() => localEngine())
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // 사용자가 위로 올려 읽는 중이면 자동 스크롤하지 않는다
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open || !pc) return
    useAiThread.getState().ensure()
    useProposals.getState().ensure()
    void claude?.detect().then(setStatus)
    setLocal(localEngine()) // 설정에서 모델을 바꿨을 수 있다
    setTimeout(() => box.current?.focus(), 50)
  }, [open, pc, claude, vault])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, open])

  if (!pc || !open) return null
  const ready = engine === 'ollama' ? (local.ready ? 'ok' : 'noLocal') : claude ? readiness(status) : 'notFound'
  const canSend = ready === 'ok' && !running && draft.trim().length > 0
  const noteName = current ? baseName(current) : ''
  // Claude 를 쓸 수 없을 때, 로컬 모델이 준비되어 있으면 바로 바꾸게 한다
  const switchBtn = local.ready ? <button className="btn-link" onClick={() => useAiThread.getState().setEngine('ollama')}>{t('로컬 모델로 전환')}</button> : null
  const panelWidth = wide ? Math.min(Math.round(width * 1.7), Math.round(window.innerWidth * 0.7)) : width

  const send = () => canSend && void useAiThread.getState().send(draft)
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width
    const move = (ev: PointerEvent) => useAiThread.getState().setWidth(Math.min(w0 + (x0 - ev.clientX), Math.round(window.innerWidth * 0.55)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <aside className="ai-dock" style={{ width: panelWidth }} aria-label={t('AI')}>
      <div className="ai-resize" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label={t('패널 폭 조절')} />
      <header className="ai-head">
        <h3>{t('AI')}</h3>
        <span className="grow" />
        {pending > 0 && <button className="ai-pending" onClick={() => useProposals.getState().setOpen(true)} title={t('승인을 기다리는 변경 제안 보기')}>{t('제안 {n}', { n: pending })}</button>}
        <button className="icon-btn" disabled={running || messages.length === 0} onClick={() => useAiThread.getState().clear()} title={t('새 채팅')} aria-label={t('새 채팅')}><Icon name="plus" size={18} /></button>
        <button className={`icon-btn${wide ? ' on' : ''}`} onClick={() => useAiThread.getState().setWide(!wide)} title={t('넓게 보기')} aria-label={t('넓게 보기')}><Icon name="expand" size={18} /></button>
        <button className="icon-btn" onClick={() => useAiThread.getState().setOpen(false)} title={t('닫기')} aria-label={t('닫기')}><Icon name="close" size={18} /></button>
      </header>
      {autoNew > 0 && (
        <button className="ai-auto" onClick={() => { useApp.getState().go('settings') }}>
          {t('AI 문서 관리: 확인할 문제 {n}건 — 설정에서 보기', { n: autoNew })}
        </button>
      )}

      <div
        className="ai-thread"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {messages.length === 0 && (
          <div className="ai-empty">
            <Orb size={72} still />
            <p>{t('이 vault 의 노트에 대해 물어보세요.')}</p>
            {PRESETS.map((p) => {
              const text = p.text(withNote ? current : null)
              return text ? <button key={p.id} className="ai-starter" onClick={() => { useAiThread.getState().setDraft(text); box.current?.focus() }}>{t(p.label)}</button> : null
            })}
          </div>
        )}
        {messages.map((m, i) => (m.role === 'user' ? <UserMsg key={m.id} m={m} /> : <AiMsg key={m.id} m={m} last={i === messages.length - 1} />))}
      </div>

      {ready === 'unknown' && <p className="hint small ai-note">{t('Claude Code CLI 를 확인하는 중…')}</p>}
      {ready === 'notFound' && <p className="hint small ai-note ai-warn">{t('이 PC 에서 Claude Code CLI(claude)를 찾지 못했어요. 설치한 뒤 터미널에서 claude 로 로그인하면 쓸 수 있어요.')}{switchBtn}</p>}
      {ready === 'onlyCmd' && <p className="hint small ai-note ai-warn">{t('npm 으로 설치한 Claude Code(claude.cmd)는 아직 지원하지 않아요. 공식 설치 프로그램(claude.exe)으로 설치해 주세요.')}{switchBtn}</p>}
      {ready === 'notLoggedIn' && <p className="hint small ai-note ai-warn">{t('Claude 에 로그인되어 있지 않아요. 터미널에서 claude auth login 을 실행한 뒤 다시 열어 주세요.')}{switchBtn}</p>}
      {ready === 'noLocal' && (
        <p className="hint small ai-note ai-warn">
          {local.problem === 'noTools' ? t('저장된 AI 연결은 아직 도구 호출을 지원하지 않아요. Ollama 나 OpenAI 호환 모델을 고르세요.') : local.problem === 'noModel' ? t('AI 연결에서 모델을 골라 저장해 주세요.') : t('설정 > AI 연결에서 Ollama 같은 모델을 저장하면 API 키 없이 로컬 모델로 답할 수 있어요.')}
          <button className="btn-link" onClick={() => useApp.getState().go('settings')}>{t('설정 열기')}</button>
        </p>
      )}

      <div className="ai-composer">
        {current && (
          <div className="ai-chips">
            <button className={`ai-chip${withNote ? ' on' : ''}`} onClick={() => useAiThread.getState().setWithNote(!withNote)} title={withNote ? t('이 노트를 질문과 함께 보내지 않기') : t('열려 있는 노트를 질문과 함께 보내기')}>
              {t('현재 노트')}: {noteName} {withNote ? '✕' : '＋'}
            </button>
          </div>
        )}
        <textarea
          ref={box}
          className="ai-q"
          rows={2}
          value={draft}
          disabled={ready !== 'ok'}
          placeholder={mode === 'ask' ? t('노트에 대해 물어보세요') : t('바꾸고 싶은 내용을 알려 주세요')}
          onChange={(e) => {
            useAiThread.getState().setDraft(e.target.value)
            e.currentTarget.style.height = 'auto'
            e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 180) + 'px'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="ai-bar">
          <div className="seg ai-mode" role="group" aria-label={t('모드')}>
            <button className={mode === 'ask' ? 'on' : ''} onClick={() => useAiThread.getState().setMode('ask')} title={t('읽기 전용: 노트를 읽고 답만 해요')}>{t('묻기')}</button>
            <button className={mode === 'edit' ? 'on' : ''} onClick={() => useAiThread.getState().setMode('edit')} title={t('노트 변경을 제안해요(승인해야 반영돼요)')}>{t('변경 제안')}</button>
          </div>
          <span className="grow" />
          <Select<Engine>
            className="ai-engine-sel"
            value={engine}
            title={engine === 'claude' ? t('내 PC 의 Claude Code 로 답해요. 질문과 읽은 노트 내용은 Anthropic 으로 전송돼요.') : local.cloud ? t('설정한 클라우드 모델로 답해요. 질문과 읽은 노트 내용이 그 서버로 전송돼요.') : t('내 기기의 로컬 모델로 답해요. 노트 내용이 밖으로 나가지 않아요.')}
            ariaLabel={t('답변 엔진')}
            disabled={running}
            onChange={(v) => useAiThread.getState().setEngine(v)}
            options={[{ value: 'claude', label: 'Claude · PC', hint: t('Anthropic 으로 전송') }, { value: 'ollama', label: local.label || t('로컬 모델 (설정 필요)'), hint: local.ready ? (local.cloud ? t('클라우드로 전송') : t('내 기기에서만 처리')) : t('설정 필요') }]}
          />
          {running ? (
            <button className="ai-send stop" onClick={() => useAiThread.getState().cancel()} aria-label={t('중지')} title={t('중지')}>■</button>
          ) : (
            <button className="ai-send" disabled={!canSend} onClick={send} aria-label={t('보내기')} title={t('보내기 (Enter)')}>↑</button>
          )}
        </div>
      </div>
    </aside>
  )
}

