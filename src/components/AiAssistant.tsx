// AI 에게 묻기(PC): 내 PC 의 Claude Code CLI 로 노트에 대해 묻고, 요약하고, 변경을 제안받는다. 사용자가 누를 때만 실행한다.
// AI 는 Nosidian MCP 도구로만 노트를 보고(검색·읽기), 변경은 "변경 제안"으로만 낸다 — 문서 규칙과 사람의 승인을 거친다.
import { create } from 'zustand'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { desktop, type ClaudeEvent, type ClaudeStatus } from '../lib/externalIO'
import { buildPrompt, errorText, PRESETS, readiness, toolLabel } from '../lib/aiAssistant'
import { useProposals } from '../lib/proposalStore'
import { Icon } from './Icon'
import { Reader } from './Reader'

export const useAiUi = create<{ open: boolean; setOpen(o: boolean): void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

const pendingCount = () => useProposals.getState().items.filter((p) => p.status === 'pending').length

interface Step {
  name: string
  input: string
}

export function AiAssistant() {
  const claude = desktop()?.claude
  const open = useAiUi((s) => s.open)
  const note = useApp((s) => s.current)
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [answer, setAnswer] = useState<{ text: string; turns: number } | null>(null)
  const [error, setError] = useState('')
  const [made, setMade] = useState(0) // 이번 실행으로 새로 생긴 변경 제안 수
  const before = useRef(0)
  const box = useRef<HTMLTextAreaElement>(null)

  // 열 때 Claude Code CLI 가 있는지·로그인했는지 확인한다(토큰을 쓰지 않는 확인)
  useEffect(() => {
    if (!open || !claude) return
    setStatus(null)
    void claude.detect().then(setStatus)
    useProposals.getState().ensure()
    setTimeout(() => box.current?.focus(), 50)
  }, [open, claude])

  // 실행 중 이벤트(진행·결과·오류)
  useEffect(() => {
    if (!claude) return undefined
    return claude.onEvent((e: ClaudeEvent) => {
      if (e.type === 'tool') setSteps((s) => [...s, { name: e.name, input: e.input }])
      else if (e.type === 'result') {
        setRunning(false)
        if (e.ok) setAnswer({ text: e.text, turns: e.turns })
        else setError(e.text || errorText('exit'))
        setMade(Math.max(0, pendingCount() - before.current))
      } else if (e.type === 'error') {
        setRunning(false)
        setError(errorText(e.code, e.message))
        setMade(Math.max(0, pendingCount() - before.current))
      }
    })
  }, [claude])

  useEffect(() => {
    if (!open) return undefined
    const f = (e: KeyboardEvent) => e.key === 'Escape' && !running && useAiUi.getState().setOpen(false)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [open, running])

  if (!open || !claude) return null
  const ready = readiness(status)
  const close = () => !running && useAiUi.getState().setOpen(false)

  const run = async () => {
    if (!question.trim() || running || ready !== 'ok') return
    setRunning(true)
    setSteps([])
    setAnswer(null)
    setError('')
    setMade(0)
    before.current = pendingCount()
    await claude.run({ prompt: buildPrompt({ question, note }) })
  }
  const cancel = () => void claude.cancel()

  return (
    <div className="ee-wrap" onClick={close}>
      <div className="ee ai" role="dialog" aria-label={t('AI 에게 묻기')} onClick={(e) => e.stopPropagation()}>
        <div className="ee-head">
          <h3>{t('AI 에게 묻기')}</h3>
          <button className="icon-btn" onClick={close} aria-label={t('닫기')} disabled={running}><Icon name="close" /></button>
        </div>
        <div className="ee-body">
          {ready === 'unknown' && <p className="hint">{t('Claude Code CLI 를 확인하는 중…')}</p>}
          {ready === 'notFound' && <p className="hint ai-warn">{t('이 PC 에서 Claude Code CLI(claude)를 찾지 못했어요. 설치한 뒤 터미널에서 claude 로 로그인하면 쓸 수 있어요.')}</p>}
          {ready === 'onlyCmd' && <p className="hint ai-warn">{t('npm 으로 설치한 Claude Code(claude.cmd)는 아직 지원하지 않아요. 공식 설치 프로그램(claude.exe)으로 설치해 주세요.')}</p>}
          {ready === 'notLoggedIn' && <p className="hint ai-warn">{t('Claude 에 로그인되어 있지 않아요. 터미널에서 claude auth login 을 실행한 뒤 다시 열어 주세요.')}</p>}
          {ready === 'ok' && <p className="hint ai-meta">{t('내 PC 의 Claude Code {v} 로 답해요 · 열려 있는 vault 만 보고, 변경은 제안만 해요', { v: status?.version ?? '' })}</p>}

          <div className="ai-presets">
            {PRESETS.map((p) => {
              const text = p.text(note)
              return <button key={p.id} disabled={running || !text} onClick={() => { setQuestion(text); box.current?.focus() }}>{t(p.label)}</button>
            })}
          </div>
          <textarea
            ref={box}
            className="ai-q"
            rows={3}
            value={question}
            disabled={running}
            placeholder={note ? t('무엇이 궁금한가요? (열려 있는 노트: {note})', { note }) : t('무엇이 궁금한가요?')}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) void run() }}
          />
          <div className="ai-actions">
            <span className="hint small">{t('Ctrl+Enter 로 보내기')}</span>
            <span className="grow" />
            {running ? <button onClick={cancel}>{t('취소')}</button> : <button className="primary" disabled={!question.trim() || ready !== 'ok'} onClick={() => void run()}>{t('물어보기')}</button>}
          </div>

          {(running || steps.length > 0) && (
            <ul className="ai-steps">
              {steps.map((s, i) => <li key={i}><b>{toolLabel(s.name)}</b>{s.input && <span>{s.input}</span>}</li>)}
              {running && <li className="ai-wait">{t('생각하는 중…')}</li>}
            </ul>
          )}
          {error && <p className="hint ai-err">{error}</p>}
          {answer && (
            <div className="ai-answer">
              <div className="ai-text"><Reader path="AI" content={answer.text} compact /></div>
              <div className="ai-foot">
                <button className="wrk-viewedit" onClick={() => void navigator.clipboard.writeText(answer.text).then(() => useApp.getState().say(t('복사했어요')))}>{t('답변 복사')}</button>
                <span className="hint small">{t('도구 호출 {n}번', { n: Math.max(0, answer.turns - 1) })}</span>
              </div>
            </div>
          )}
          {made > 0 && (
            <button className="pr-banner" onClick={() => { useAiUi.getState().setOpen(false); useProposals.getState().setOpen(true) }}>
              {t('AI 가 변경 제안 {n}건을 만들었어요 — 승인해야 반영돼요', { n: made })} <span>{t('검토')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
