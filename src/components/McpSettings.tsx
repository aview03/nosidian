// 설정 > 외부 AI 연결(MCP): Claude Code·Codex 같은 외부 에이전트가 이 앱의 노트를 찾고 읽고 "변경안을 제출"하게 한다. PC 전용.
// 기본은 꺼짐. 켜도 127.0.0.1 에만 열리고 토큰이 필요하다. 어느 vault 를 열어 줄지는 여기서 사용자가 정한다(기본: 없음).
// 외부 AI 는 노트를 직접 쓰지 못한다 — 모든 변경은 문서 규칙(정책 엔진)과 내 업무의 "AI 변경 제안" 승인을 거친다.
import { useEffect, useState } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { desktop, type McpStatus } from '../lib/externalIO'
import { loadMcpVault, saveMcpVault } from '../lib/mcpBridge'
import { Select } from './Select'

export function McpCard() {
  const mcp = desktop()?.mcp
  const vaults = useApp((s) => s.settings.vaults)
  const activeVault = useApp((s) => s.settings.activeVault)
  const [st, setSt] = useState<McpStatus | null>(null)
  const [vault, setVault] = useState<string>(loadMcpVault() ?? '')
  const [show, setShow] = useState(false)

  useEffect(() => {
    void mcp?.get().then(setSt)
  }, [mcp])
  if (!mcp) return null

  const url = st ? `http://127.0.0.1:${st.port}/mcp` : ''
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      useApp.getState().say(t('복사했어요'))
    } catch {
      useApp.getState().say(t('복사하지 못했어요'))
    }
  }
  const toggle = async (enabled: boolean) => setSt(await mcp.set({ enabled }))
  const regen = async () => setSt(await mcp.set({ regenerate: true }))
  const pick = (id: string) => {
    setVault(id)
    saveMcpVault(id || null)
  }
  const connected = vaults.find((v) => v.id === vault)
  const mismatch = !!vault && vault !== activeVault

  const claudeCmd = st ? `claude mcp add --transport http nosidian ${url} --header "Authorization: Bearer ${st.token}"` : ''
  const codexToml = st ? `[mcp_servers.nosidian]\ncommand = "node"\nargs = ["${st.stdioPath.replace(/\\/g, '\\\\')}"]\nenv = { NOSIDIAN_MCP_URL = "${url}", NOSIDIAN_MCP_TOKEN = "${st.token}" }` : ''

  return (
    <section className="card mcp">
      <h3>{t('외부 AI 연결 (MCP)')}</h3>
      <div className="kv"><span>{t('MCP 서버')}</span>
        <div className="seg">
          <button className={st?.enabled ? 'on' : ''} onClick={() => void toggle(true)}>{t('켜기')}</button>
          <button className={!st?.enabled ? 'on' : ''} onClick={() => void toggle(false)}>{t('끄기')}</button>
        </div>
      </div>
      {st?.enabled && (
        <p className="hint small">{st.running ? t('실행 중 · {url}', { url }) : t('시작하지 못했어요: {e}', { e: st.error ?? '' })}</p>
      )}
      <div className="kv"><span>{t('열어 줄 vault')}</span>
        <Select<string>
          value={vault}
          title={t('열어 줄 vault')}
          ariaLabel={t('열어 줄 vault')}
          onChange={pick}
          options={[{ value: '', label: t('없음 (연결 안 함)') }, ...vaults.map((v) => ({ value: v.id, label: v.name }))]}
        />
      </div>
      <p className="hint small">
        {!vault
          ? t('vault 를 고르기 전에는 외부 AI 가 아무 노트도 볼 수 없어요.')
          : mismatch
            ? t('지금 열려 있는 vault 가 "{name}" 이 아니라서, 그 vault 를 열기 전까지 외부 AI 의 요청은 거절돼요.', { name: connected?.name ?? '' })
            : t('외부 AI 는 "{name}" vault 만 볼 수 있어요. 다른 vault 는 열지 않아요.', { name: connected?.name ?? '' })}
      </p>

      {st?.enabled && st.running && (
        <>
          <div className="kv"><span>{t('토큰')}</span>
            <span className="name-apply">
              <input className="inline" readOnly type={show ? 'text' : 'password'} value={st.token} onFocus={(e) => e.currentTarget.select()} />
              <button onClick={() => setShow(!show)}>{show ? t('숨기기') : t('보기')}</button>
              <button onClick={() => void copy(st.token)}>{t('복사')}</button>
            </span>
          </div>
          <div className="row llm-actions">
            <button onClick={() => void copy(claudeCmd)}>{t('Claude Code 등록 명령 복사')}</button>
            <button onClick={() => void copy(codexToml)}>{t('Codex 설정(config.toml) 복사')}</button>
            <button onClick={() => void regen()}>{t('토큰 새로 만들기')}</button>
          </div>
        </>
      )}
      <p className="hint small">{t('앱이 켜져 있는 동안만 쓸 수 있어요. 외부 AI는 노트를 읽고 변경안만 낼 수 있고, 반영은 내 업무의 "AI 변경 제안"에서 승인해야 해요. 토큰은 다른 사람에게 알려 주지 마세요.')}</p>
    </section>
  )
}
