// 설정 > 앱 안 AI (Claude Code CLI): PC 에 설치된 `claude` 로 앱 안에서 AI 를 쓴다. API 키가 필요 없다(로그인된 Claude 계정).
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { desktop, type ClaudeStatus } from '../lib/externalIO'
import { readiness } from '../lib/aiAssistant'
import { useAiThread } from '../lib/aiThread'

export function ClaudeCliCard() {
  const claude = desktop()?.claude
  const [st, setSt] = useState<ClaudeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    if (!claude) return
    setBusy(true)
    setSt(await claude.detect())
    setBusy(false)
  }
  useEffect(() => void check(), [claude]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!claude) return null
  const r = readiness(st)
  return (
    <section className="card claude">
      <h3>{t('앱 안 AI (내 Claude 계정)')}</h3>
      <div className="kv"><span>{t('상태')}</span>
        <b>
          {r === 'ok' ? t('사용할 수 있어요 · {v}', { v: st?.version ?? '' }) : r === 'notLoggedIn' ? t('설치됨 · 로그인 필요') : r === 'notFound' ? t('찾지 못했어요') : r === 'onlyCmd' ? t('지원하지 않는 설치 방식') : t('확인하는 중…')}
        </b>
      </div>
      {r === 'notLoggedIn' && <p className="hint small">{t('터미널에서 claude auth login 을 실행해 로그인해 주세요.')}</p>}
      {r === 'notFound' && <p className="hint small">{t('Claude Code 를 설치하고 터미널에서 claude 로 로그인하면 API 키 없이 쓸 수 있어요.')}</p>}
      {r === 'onlyCmd' && <p className="hint small">{t('npm 설치(claude.cmd)는 지원하지 않아요. 공식 설치 프로그램(claude.exe)을 쓰세요.')}</p>}
      <div className="llm-actions">
        <button disabled={busy} onClick={() => void check()}>{t('다시 확인')}</button>
        <button className="primary" disabled={r !== 'ok'} onClick={() => useAiThread.getState().setOpen(true)}>{t('AI 패널 열기')}</button>
      </div>
      <p className="hint small">{t('왼쪽 막대의 AI 버튼(Ctrl+Shift+A)으로 열어요. 질문과 AI가 읽은 노트는 Anthropic으로 전송되고, 사용량은 로그인한 Claude 계정에서 차감돼요.')}</p>
    </section>
  )
}
