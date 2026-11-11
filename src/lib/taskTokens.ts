// 업무 한 줄의 토큰(`key:value`)을 읽고 쓴다. 일정 파서(calendar.ts)와 업무 인덱스(work.ts)가 같은 규격을 쓰도록 한 곳에 둔다.
//
//   - [ ] 견적서 수정 due:2026-11-12 owner:홍길동 p:1 proj:[[행사 준비]]
//   - [ ] 상장 재고 확인 status:waiting side:other due:2026-11-12
//   - [x] 영상 이벤트 정책 => 중복 수상은 불가로 결정
//
// 호환성 원칙: 체크박스는 표준 마크다운(`[ ]`/`[x]`)만 쓴다. 진행 중·대기·취소됨 같은 상태는 `status:` 토큰으로 둔다
// (Obsidian 등 다른 마크다운 도구에서도 그냥 체크박스 + 글자로 읽힌다).

export type WorkStatus = 'doing' | 'waiting' | 'dropped'
export type Side = 'me' | 'other'
/** 줄의 종류: 'decision' 이면 협의·결정 안건(닫을 때 결론이 필수) */
export type Kind = 'decision'

export interface WorkTokens {
  start?: string // YYYY-MM-DD 시작일(간트 막대의 왼쪽 끝). 없으면 마감일 한 점
  due?: string // YYYY-MM-DD
  owner?: string[] // 담당자(쉼표로 여러 명)
  p?: 1 | 2 | 3 // 우선순위 (1 이 가장 높음)
  status?: WorkStatus // 없으면 '할 일'(todo)
  side?: Side // 공이 누구에게 있나
  kind?: Kind // 안건 종류
  proj?: string // 프로젝트 이름 ([[이름]] 또는 이름)
  impact?: string // 과업·비용에 미치는 영향 한 줄
  conclusion?: string // 닫을 때의 결론 (`=> 결론`)
}

const D = String.raw`\d{4}-\d{2}-\d{2}`
const RE = {
  due: new RegExp(String.raw`(?:^|\s)due:(${D})(?=\s|$)`),
  start: new RegExp(String.raw`(?:^|\s)start:(${D})(?=\s|$)`),
  owner: /(?:^|\s)owner:(?:"([^"]+)"|(\S+))(?=\s|$)/,
  p: /(?:^|\s)p:([123])(?=\s|$)/,
  status: /(?:^|\s)status:(\S+)(?=\s|$)/,
  side: /(?:^|\s)side:(\S+)(?=\s|$)/,
  kind: /(?:^|\s)kind:(\S+)(?=\s|$)/,
  proj: /(?:^|\s)proj:(?:\[\[([^\]]+)\]\]|(\S+))(?=\s|$)/,
  impact: /(?:^|\s)impact:(?:"([^"]+)"|(\S+))(?=\s|$)/,
  // 결론은 줄 끝까지. 앞에 공백이 있는 `=>` 만 인정한다
  conclusion: /(?:^|\s)=>\s*(.+)$/,
}

const STATUS_ALIAS: Record<string, WorkStatus> = {
  doing: 'doing', 진행: 'doing', 진행중: 'doing', '진행-중': 'doing',
  waiting: 'waiting', 대기: 'waiting', 대기중: 'waiting', 답대기: 'waiting',
  dropped: 'dropped', 취소됨: 'dropped', 취소: 'dropped', 접음: 'dropped', 보류: 'dropped', // 예전 이름(접음)도 계속 읽는다
}
const KIND_ALIAS: Record<string, Kind> = { decision: 'decision', 결정: 'decision', 미결: 'decision', 안건: 'decision', issue: 'decision' }
const SIDE_ALIAS: Record<string, Side> = { me: 'me', 나: 'me', 우리: 'me', other: 'other', 상대: 'other', 상대방: 'other', 고객: 'other' }

/** 줄의 본문(체크박스 뒤)에서 업무 토큰을 떼어 낸다. rest 는 토큰을 뺀 나머지 글(제목·일정 토큰 등). */
export function splitWorkTokens(text: string): { rest: string; tokens: WorkTokens; has: boolean } {
  let rest = ` ${text} `
  const tokens: WorkTokens = {}
  let has = false
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(rest)
    if (!m) return
    fn(m)
    rest = rest.replace(m[0], ' ')
    has = true
  }
  // 결론이 가장 먼저(줄 끝까지 먹으므로 다른 토큰이 결론 안에 있어도 건드리지 않는다)
  take(RE.conclusion, (m) => (tokens.conclusion = m[1].trim()))
  take(RE.due, (m) => (tokens.due = m[1]))
  take(RE.start, (m) => (tokens.start = m[1]))
  take(RE.owner, (m) => (tokens.owner = (m[1] ?? m[2]).split(/[,，]/).map((x) => x.trim()).filter(Boolean)))
  take(RE.p, (m) => (tokens.p = Number(m[1]) as 1 | 2 | 3))
  take(RE.status, (m) => {
    const s = STATUS_ALIAS[m[1].toLowerCase()]
    if (s) tokens.status = s
    else rest += ` status:${m[1]}` // 모르는 값은 건드리지 않는다
  })
  take(RE.side, (m) => {
    const s = SIDE_ALIAS[m[1].toLowerCase()]
    if (s) tokens.side = s
    else rest += ` side:${m[1]}`
  })
  take(RE.kind, (m) => {
    const k = KIND_ALIAS[m[1].toLowerCase()]
    if (k) tokens.kind = k
    else rest += ` kind:${m[1]}`
  })
  take(RE.proj, (m) => (tokens.proj = (m[1] ?? m[2]).trim()))
  take(RE.impact, (m) => (tokens.impact = (m[1] ?? m[2]).trim()))
  return { rest: rest.replace(/\s+/g, ' ').trim(), tokens, has }
}

/** 토큰을 한 줄의 꼬리표 문자열로 (순서 고정: 읽기 쉽게) */
export function formatWorkTokens(t: WorkTokens): string {
  const parts: string[] = []
  if (t.status) parts.push(`status:${t.status}`)
  if (t.kind) parts.push(`kind:${t.kind}`)
  if (t.side) parts.push(`side:${t.side}`)
  if (t.start) parts.push(`start:${t.start}`)
  if (t.due) parts.push(`due:${t.due}`)
  if (t.owner?.length) parts.push(t.owner.length === 1 && !/\s/.test(t.owner[0]) ? `owner:${t.owner[0]}` : `owner:"${t.owner.join(', ')}"`)
  if (t.p) parts.push(`p:${t.p}`)
  if (t.proj) parts.push(/\s/.test(t.proj) ? `proj:[[${t.proj}]]` : `proj:${t.proj}`)
  if (t.impact) parts.push(/\s/.test(t.impact) ? `impact:"${t.impact}"` : `impact:${t.impact}`)
  if (t.conclusion) parts.push(`=> ${t.conclusion}`)
  return parts.join(' ')
}
