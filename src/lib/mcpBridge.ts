// 외부 AI(MCP) 연결의 렌더러 쪽: 메인 프로세스가 중계한 도구 호출을 받아 mcpTools 로 처리하고 답한다. PC(Electron) 전용.
// 어느 vault 를 외부 AI 에 열어 줄지는 설정에서 사용자가 정하며(기본: 없음), 이 기기에만 기억한다.
import { desktop } from './externalIO'
import { useApp } from './app'
import { search } from '../components/Search'
import { callTool, type McpEnv } from './mcpTools'
import { useProposals } from './proposalStore'
import { useFileProposals } from './fileProposals'

const KEY = 'nosidian.mcp.vault'

/** 외부 AI 에 열어 준 vault id(없으면 null = 아무 vault 도 열려 있지 않음) */
export function loadMcpVault(): string | null {
  try {
    return localStorage.getItem(KEY) || null
  } catch {
    return null
  }
}
export function saveMcpVault(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}

/** 지금 상태로 도구 환경을 만든다(호출 때마다 새로 읽어 최신 노트·vault 를 본다) */
/** internal: 앱 안 AI(claude CLI) 호출 — 지금 열려 있는 vault 하나에 닿는다(외부 AI 용 vault 설정과 무관) */
export function buildEnv(internal = false, readOnly = false, forceApproval = false): McpEnv {
  const app = useApp.getState()
  const id = app.settings.activeVault
  const v = app.settings.vaults.find((x) => x.id === id)
  return {
    vault: { id: id ?? null, name: v?.name ?? '' },
    allowedVault: internal ? (id ?? null) : loadMcpVault(),
    files: app.files,
    search: (q, limit) => search(q, limit),
    submit: (req, by, summary) => {
      const r = useProposals.getState().submit(req, by, summary, forceApproval)
      return { kind: r.kind === 'denied' ? 'denied' : r.kind, verdict: r.verdict, ops: r.kind === 'apply' ? r.ops : undefined, id: 'id' in r ? r.id : undefined }
    },
    find: (pid) => useProposals.getState().find(pid),
    submitFile: (req, by, summary) => useFileProposals.getState().submit(req, by, summary),
    findFile: (pid) => useFileProposals.getState().find(pid),
    readOnly,
    forceApproval,
  }
}

/** 메인 프로세스가 넘긴 호출을 처리하기 시작한다. 반환값은 해제 함수 */
export function startMcpBridge(): (() => void) | undefined {
  const mcp = desktop()?.mcp
  if (!mcp) return undefined
  return mcp.onCall(async ({ id, tool, args, client, internal, readOnly, forceApproval }) => {
    try {
      await mcp.reply(id, { ok: callTool(tool, args, buildEnv(internal === true, readOnly === true, forceApproval === true), internal ? '앱 안 Claude' : client) })
    } catch (e) {
      await mcp.reply(id, { error: e instanceof Error ? e.message : String(e) })
    }
  })
}
