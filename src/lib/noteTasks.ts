// 노트 "업무 정리": 회의록 같은 노트의 열린 체크리스트 줄을 모아 담당·마감·결정 여부를 한 번에 정한다(페르소나 F24).
//  - 줄을 다시 쓰는 일은 기존 rewriteTaskLine 이 한다(들여쓰기·일정 꼬리표·모르는 값 보존). 여기서는 줄 → 행 → 줄 변환과 "자연스러운 표기 읽기"만 한다.
//  - 읽는 표기(확신이 있을 때만, 화면에서 사람이 확인·수정한다): `(민수, 11/18까지)` `[지현]` `@민수` `11/18까지` `금요일까지`.
import { parseQuick } from './calendar'
import { formatWorkTokens, splitWorkTokens, type WorkTokens } from './taskTokens'
import { rewriteTaskLine, titleOfLine } from './work'

/** 담당자 이름처럼 보이지만 사실은 말머리인 글 */
const RESERVED = new Set(['참고', '긴급', '중요', '임시', '필수', '선택', '완료', '진행', '대기', '보류', '취소', '예정', '확정', '미정', '메모', '질문', '추가', '수정', 'tbd', 'asap', 'todo', 'fyi'])
const NAME = /^[가-힣A-Za-z]{2,8}$/
const GROUP = /[(（[]([^()（）[\]]{1,40})[)）\]]/g

export interface Hints {
  title: string
  owner: string[]
  due?: string
  /** 제목에서 뭔가 읽어 냈나 */
  found: boolean
}

/** part 가 날짜 표현이면 그 날짜(YYYY-MM-DD). 시간·반복이 붙었거나 날짜가 아니면 null */
function dateOf(part: string, today: string): string | null {
  const p = part.trim().replace(/까지$/, '').trim()
  if (!p || !/[\d월화수목금토일오내모다]/.test(p)) return null
  const q = parseQuick(`${p} x`, today)
  return q.title === 'x' && !q.start && !q.repeat && !q.endDate ? q.date : null
}

/**
 * 제목에서 담당·마감을 읽어 낸다. 읽은 부분은 제목에서 뺀다.
 *  - 괄호 안 모든 조각이 날짜 또는 이름일 때만 읽는다(`(참고 자료 확인)`처럼 다른 글이 섞이면 건드리지 않는다).
 *  - 아는 이름(known)이거나 같은 괄호에 날짜가 있으면 이름으로 본다. `@이름` 은 명시적이라 그대로 읽는다.
 *  - 괄호 밖의 `…까지` 날짜(`11/18까지`, `금요일까지`)도 읽는다.
 */
export function extractHints(title: string, known: Set<string>, today: string): Hints {
  let rest = title
  const owner: string[] = []
  let due: string | undefined
  const take = (o: string) => {
    if (!owner.includes(o)) owner.push(o)
  }

  // 1) 괄호 묶음
  rest = rest.replace(GROUP, (whole, inner: string) => {
    const parts = inner.split(/[,，·、]/).map((x) => x.trim()).filter(Boolean)
    if (!parts.length) return whole
    const dates = parts.map((p) => dateOf(p, today))
    const hasDate = dates.some((d) => d)
    const names: string[] = []
    for (let i = 0; i < parts.length; i++) {
      if (dates[i]) continue
      const p = parts[i]
      if (NAME.test(p) && !RESERVED.has(p.toLowerCase()) && (known.has(p) || hasDate)) names.push(p)
      else return whole // 이름도 날짜도 아닌 조각이 있으면 이 괄호는 그대로 둔다
    }
    if (!names.length && !hasDate) return whole
    names.forEach(take)
    due ??= dates.find((d) => d) ?? undefined
    return ' '
  })

  // 읽지 않고 남긴 괄호는 아래 규칙이 안쪽 글자를 건드리지 못하게 보호한다
  const keep: string[] = []
  rest = rest.replace(GROUP, (whole) => {
    keep.push(whole)
    return `\uE000${keep.length - 1}\uE000`
  })

  // 2) @이름 (@2026-11-18 같은 일정 꼬리표는 건드리지 않는다)
  rest = rest.replace(/(^|\s)@([가-힣A-Za-z]{2,8})(?=\s|$|[,.)])/g, (_m, pre: string, name: string) => {
    take(name)
    return pre
  })

  // 3) 괄호 밖 "…까지" 날짜
  rest = rest.replace(/(^|\s)((?:다음\s*주\s*)?[월화수목금토일]요일|오늘|내일|모레|글피|\d{1,2}\/\d{1,2}|\d{1,4}-\d{1,2}-\d{1,2}|\d{1,2}월\s*\d{1,2}일)\s*까지(?=\s|$|[.,)])/, (whole, pre: string, phrase: string) => {
    const d = dateOf(phrase, today)
    if (!d) return whole
    due ??= d
    return pre
  })

  rest = rest.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => keep[Number(i)])
  const clean = rest.replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').replace(/^[\s\-–:·]+|[\s\-–:·]+$/g, '')
  const found = owner.length > 0 || !!due
  return { title: found && clean ? clean : title.trim(), owner: found ? owner : [], due, found: found && !!clean }
}

export interface TaskRow {
  /** 노트 안 줄 번호(0 부터) */
  line: number
  /** 줄에 지금 적힌 값(바뀌었는지 비교하는 기준) */
  init: { title: string; owner: string[]; due?: string; decision: boolean }
  /** 화면에서 고치는 값 */
  title: string
  owner: string[]
  due?: string
  decision: boolean
  /** 제목에서 담당·마감을 읽어 채웠나(채운 값은 사람이 확인하라고 표시한다) */
  hinted: boolean
}

const OPEN_LINE = /^(\s*[-*+]\s+)\[ \]\s+(.*)$/

/** 노트의 열린 체크리스트 줄(`- [ ] …`)을 행으로. 이미 있는 꼬리표는 그대로 채우고, 비어 있는 담당·마감만 제목에서 읽어 채운다 */
export function buildRows(content: string, known: Set<string>, today: string): TaskRow[] {
  const rows: TaskRow[] = []
  content.split('\n').forEach((raw, line) => {
    const m = OPEN_LINE.exec(raw)
    if (!m) return
    const tokens = splitWorkTokens(m[2]).tokens
    const original = titleOfLine(raw) ?? ''
    if (!original) return
    const init = { title: original, owner: tokens.owner ?? [], due: tokens.due, decision: tokens.kind === 'decision' }
    const h = extractHints(original, known, today)
    const useOwner = init.owner.length === 0 && h.owner.length > 0
    const useDue = !init.due && !!h.due
    const hinted = h.found && (useOwner || useDue)
    rows.push({
      line,
      init,
      // 담당·마감을 하나도 못 채웠다면 제목은 원문 그대로(제목만 바뀌는 일이 없게)
      title: hinted ? h.title : original,
      owner: useOwner ? h.owner : init.owner,
      due: useDue ? h.due : init.due,
      decision: init.decision,
      hinted,
    })
  })
  return rows
}

/** 행이 줄에 적힌 값과 달라졌나 */
export function rowChanged(r: TaskRow): boolean {
  return r.title.trim() !== r.init.title || r.owner.join(',') !== r.init.owner.join(',') || (r.due ?? '') !== (r.init.due ?? '') || r.decision !== r.init.decision
}

/** 바뀐 행들을 노트 내용에 적용한다. 바뀐 줄만 다시 쓴다(들여쓰기·일정 꼬리표 보존). 줄이 그새 바뀌었으면 건너뛴다 */
export function applyRows(content: string, rows: TaskRow[]): string {
  const lines = content.split('\n')
  for (const r of rows) {
    if (!rowChanged(r)) continue
    const raw = lines[r.line]
    const m = raw === undefined ? null : OPEN_LINE.exec(raw)
    if (!m || titleOfLine(raw) !== r.init.title) continue
    const tokens: WorkTokens = { ...splitWorkTokens(m[2]).tokens }
    if (r.owner.length) tokens.owner = r.owner
    else delete tokens.owner
    if (r.due) tokens.due = r.due
    else delete tokens.due
    if (r.decision) tokens.kind = 'decision'
    else delete tokens.kind
    const next = rewriteTaskLine(raw, { title: r.title.trim() || r.init.title, done: false, tokens })
    if (next !== null) lines[r.line] = next
  }
  return lines.join('\n')
}

// ── 결정 사항: "## 결정" 아래에 글로 적은 줄을 결정 기록(완료된 결정 안건 + 결론)으로 남긴다(페르소나 F26) ──
const DECISION_HEAD = /^#{1,6}\s*(?:결정(?:\s*(?:사항|내용|된\s*것|한\s*것))?|decisions?)\s*:?\s*$/i
const ANY_HEAD = /^#{1,6}\s/
const PLAIN_BULLET = /^(\s*)([-*+])\s+(?!\[[ xX]\])(\S.*)$/

export interface DecisionRow {
  /** 노트 안 줄 번호(0 부터) */
  line: number
  /** 줄의 원래 글(글머리 뒤) */
  init: string
  /** 결정 기록으로 남길까(기본 꺼짐 — 사용자의 회의록을 말없이 바꾸지 않는다) */
  on: boolean
  title: string
  conclusion: string
}

/** "행사 날짜는 12월 9일로 확정" → 안건 "행사 날짜" · 결론 "12월 9일로 확정". 나눌 수 없으면 둘 다 문장 전체 */
export function splitDecision(text: string): { title: string; conclusion: string } {
  const m = /^(.+?)(?:은|는)\s+(.*?(?:확정|결정|합의|승인|채택|변경|연기|취소).*)$/.exec(text.trim())
  return m && m[1].trim() && m[2].trim() ? { title: m[1].trim(), conclusion: m[2].trim() } : { title: text.trim(), conclusion: text.trim() }
}

/** 노트의 `## 결정` 머리말 아래(다음 머리말 전까지) 일반 글머리 줄들 */
export function buildDecisionRows(content: string): DecisionRow[] {
  const rows: DecisionRow[] = []
  let inside = false
  content.split('\n').forEach((raw, line) => {
    if (ANY_HEAD.test(raw)) {
      inside = DECISION_HEAD.test(raw.trim())
      return
    }
    if (!inside) return
    const m = PLAIN_BULLET.exec(raw)
    if (!m) return
    const text = m[3].trim()
    rows.push({ line, init: text, on: false, ...splitDecision(text) })
  })
  return rows
}

/** on 인 행을 `- [x] 안건 kind:decision => 결론` 으로 바꾼다(들여쓰기·글머리 모양 보존). 줄이 그새 바뀌었으면 건너뛴다 */
export function applyDecisions(content: string, rows: DecisionRow[]): string {
  const lines = content.split('\n')
  for (const r of rows) {
    if (!r.on) continue
    const m = lines[r.line] === undefined ? null : PLAIN_BULLET.exec(lines[r.line])
    if (!m || m[3].trim() !== r.init) continue
    const title = r.title.replace(/\s+/g, ' ').trim() || r.init
    const conclusion = r.conclusion.replace(/\s+/g, ' ').trim() || r.init
    lines[r.line] = `${m[1]}${m[2]} [x] ${[title, formatWorkTokens({ kind: 'decision', conclusion })].join(' ')}`
  }
  return lines.join('\n')
}
