// 앱 안 AI(Claude Code CLI) 질문 화면의 순수 부분: 프롬프트 만들기, 진행 표시 문구, 준비 상태 판정.
// 실제 실행은 electron/claudeCli.cjs 가 한다(고정된 안전 옵션, 임시 MCP 서버). 여기에는 실행 로직이 없다.
import type { ClaudeStatus } from './externalIO'
import { t } from './i18n'

export type AiMode = 'ask' | 'edit'

/** 이전 대화 한 번(질문과 답변). 후속 질문의 맥락으로 쓴다 */
export interface Turn {
  q: string
  a: string
}

export interface PromptInput {
  question: string
  /** 지금 열려 있는 노트 경로(있으면 AI 에게 알려 준다) */
  note?: string | null
  /** 묻기 = 읽기 전용, 변경 제안 = propose_change 사용 가능 */
  mode?: AiMode
  /** 이전 대화(최근 것부터 HISTORY_TURNS 개까지만 쓴다) */
  history?: Turn[]
}

export const HISTORY_TURNS = 3
const HISTORY_CHARS = 600

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

/**
 * 모델에게 보낼 질문. 앞선 대화(최근 3번, 각 600자까지)와 열려 있는 노트 경로(내용은 싣지 않고 경로만 — 필요하면 AI 가 read_note 로 읽는다),
 * 모드(묻기/변경 제안)를 덧붙인다. CLI 는 매번 새로 실행되므로 앱이 대화 맥락을 이어 준다.
 */
export function buildPrompt({ question, note, mode, history }: PromptInput): string {
  const parts: string[] = []
  const past = (history ?? []).slice(-HISTORY_TURNS)
  if (past.length) parts.push('[Previous conversation — context only]\n' + past.map((h) => `Q: ${clip(h.q, HISTORY_CHARS)}\nA: ${clip(h.a, HISTORY_CHARS)}`).join('\n\n'))
  parts.push(question.trim())
  const ctx: string[] = []
  if (note) ctx.push(`The note currently open in Nosidian: ${note}`)
  if (mode === 'ask') ctx.push('Mode: read-only. Answer from what you read; you cannot propose changes in this conversation.')
  else if (mode === 'edit') ctx.push('Mode: you may propose changes with propose_change when the user asks for a change.')
  if (ctx.length) parts.push('[Context] ' + ctx.join(' '))
  return parts.join('\n\n')
}

/**
 * 답변 속 `경로.md` 를 [[경로|이름]] 링크로 바꿔, 눌러서 본문에서 열 수 있게 한다. 실제로 있는 노트만 바꾼다.
 * (코드 블록 안은 건드리지 않는다)
 */
export function linkifyPaths(text: string, exists: (path: string) => boolean): string {
  const fence = /(```[\s\S]*?```)/g
  return text
    .split(fence)
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk // 코드 블록
      return chunk.replace(/`([^`\n]+?\.md)`/g, (m, p: string) => {
        const path = p.trim()
        if (!exists(path)) return m
        const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
        return `[[${path}|${name}]]`
      })
    })
    .join('')
}

export interface Preset {
  id: string
  label: string
  text: (note?: string | null) => string
}

/** 빠른 질문(눌러서 입력칸에 채운다) */
export const PRESETS: Preset[] = [
  { id: 'note', label: '이 노트 요약', text: (note) => (note ? `"${note}" 노트를 읽고 핵심을 5줄 이내로 요약해 줘.` : '') },
  { id: 'projects', label: '프로젝트 현황', text: () => '모든 프로젝트를 확인해서 프로젝트별로 지금 상태와 신경 써야 할 점을 짧게 정리해 줘.' },
  { id: 'rules', label: '문서 규칙 점검', text: () => '문서 규칙(get_document_rules)을 확인하고, 규칙을 적용하는 프로젝트의 문서가 규칙에 맞는지 살펴서 고칠 점을 알려 줘. 고치는 변경안은 내지 말고 제안만 말로 해 줘.' },
]

const TOOL_LABEL: Record<string, string> = {
  search_notes: '노트 검색',
  read_note: '노트 읽기',
  list_projects: '프로젝트 확인',
  get_document_rules: '문서 규칙 확인',
  propose_change: '변경 제안',
  get_proposal_status: '제안 상태 확인',
}

/** 진행 표시용 도구 이름(알 수 없는 도구는 이름 그대로) */
export const toolLabel = (name: string): string => (TOOL_LABEL[name] ? t(TOOL_LABEL[name]) : name)

export type Readiness = 'ok' | 'notFound' | 'onlyCmd' | 'notLoggedIn' | 'unknown'

/** 실행할 수 있는 상태인가(안내 문구를 고르는 데 쓴다) */
export function readiness(s: ClaudeStatus | null): Readiness {
  if (!s) return 'unknown'
  if (!s.found) return s.onlyCmd ? 'onlyCmd' : 'notFound'
  if (!s.loggedIn) return 'notLoggedIn'
  return 'ok'
}

/** 오류 코드를 사람이 읽는 문장으로(서버가 준 message 를 우선하되 없으면 코드로) */
export function errorText(code: string, message?: string): string {
  if (message) return message
  switch (code) {
    case 'timeout': return t('AI 가 너무 오래 걸려서 멈췄어요')
    case 'cancelled': return t('취소했어요')
    case 'login': return t('Claude 에 로그인되어 있지 않아요')
    case 'notFound': return t('Claude Code CLI 를 찾을 수 없어요')
    case 'noEngine': return t('설정 > AI 연결에서 도구 호출을 지원하는 모델(Ollama·OpenAI 호환)을 저장해 주세요')
    case 'empty': return t('모델이 빈 답을 줬어요')
    case 'loop': return t('같은 도구를 계속 부르고 있어서 멈췄어요')
    default: return t('AI 실행에 실패했어요')
  }
}
