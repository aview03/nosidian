// 편집기 툴바의 코드 블록 삽입과 "마크다운 도움" 목록, 업무 제목 안의 [[링크]] 분해, 백링크 한 줄 정리. 화면 없이 시험할 수 있는 순수 함수만 둔다.
// 배경: 개발자 페르소나 점검(P2) — 코드 블록을 넣는 버튼·문법 도움이 없었고, 이슈 줄의 [[링크]]가 대괄호 글자 그대로 보였다.
import { t } from './i18n'

const FENCE = '```'

/**
 * 툴바 `코드` 버튼의 삽입 방식. 한 줄 안(또는 선택 없음, 글이 있는 줄)이면 인라인 코드, 여러 줄을 골랐거나 빈 줄이면 코드 블록.
 * 반환: 바꿀 글(insert)과 삽입 후 커서가 놓일 위치(insert 앞에서부터의 글자 수, offset).
 */
export function codeInsert(selection: string, lineIsEmpty: boolean): { insert: string; cursor: number; block: boolean } {
  if (selection.includes('\n')) {
    const body = selection.replace(/\n+$/, '')
    return { insert: `${FENCE}\n${body}\n${FENCE}\n`, cursor: FENCE.length + 1, block: true } // 커서: 여는 울타리 다음 줄 맨 앞(언어를 윗줄에 적을 수 있게)
  }
  if (!selection && lineIsEmpty) return { insert: `${FENCE}\n\n${FENCE}\n`, cursor: FENCE.length + 1, block: true } // 빈 줄: 빈 코드 블록, 커서는 본문 줄
  return { insert: `\`${selection}\``, cursor: selection ? selection.length + 2 : 1, block: false }
}

export interface HelpItem {
  id: string
  label: string
  /** 눌렀을 때 넣을 글 */
  snippet: string
  /** 삽입 후 커서가 놓일 위치(snippet 맨 앞부터의 글자 수). 없으면 끝 */
  cursor?: number
}

/** "마크다운 도움" 목록: 이름 · 넣을 예. 예시는 번역하지 않는다(문법 그대로 보인다) */
export const helpItems = (): HelpItem[] => [
  { id: 'heading', label: t('제목'), snippet: '## ', cursor: 3 },
  { id: 'bold', label: t('굵게 · 기울임'), snippet: '**굵게** *기울임*', cursor: 2 },
  { id: 'list', label: t('목록'), snippet: '- 항목', cursor: 2 },
  { id: 'task', label: t('할 일 (담당·마감)'), snippet: '- [ ] 할 일 owner:이름 due:2026-12-01', cursor: 8 },
  { id: 'link', label: t('다른 노트 링크'), snippet: '[[노트 이름]]', cursor: 2 },
  { id: 'tag', label: t('태그'), snippet: '#태그', cursor: 1 },
  { id: 'code', label: t('코드 블록 (언어 이름 적기)'), snippet: `${FENCE}ts\n코드\n${FENCE}\n`, cursor: FENCE.length + 3 },
  { id: 'table', label: t('표'), snippet: '| 열1 | 열2 |\n| --- | --- |\n| 값 | 값 |\n', cursor: 2 },
  { id: 'callout', label: t('콜아웃'), snippet: '> [!tip] 제목\n> 내용\n', cursor: 9 },
  { id: 'diagram', label: t('다이어그램 (mermaid)'), snippet: `${FENCE}mermaid\nflowchart LR\n  A --> B\n${FENCE}\n`, cursor: FENCE.length + 8 },
  { id: 'quote', label: t('인용'), snippet: '> 인용', cursor: 2 },
]

export type TitlePart = { text: string } | { link: string; label: string }

/**
 * 업무 제목을 글과 [[링크]]로 나눈다. `[[노트]]`·`[[노트#제목]]`·`[[노트|보일 글]]`. 링크는 노트 이름(link)과 보일 글(label).
 * 링크가 없으면 글 하나.
 */
export function splitTitleLinks(title: string): TitlePart[] {
  const out: TitlePart[] = []
  const re = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/g
  let last = 0
  for (let m = re.exec(title); m; m = re.exec(title)) {
    if (m.index > last) out.push({ text: title.slice(last, m.index) })
    out.push({ link: m[1].trim(), label: (m[3] ?? m[1]).trim() })
    last = m.index + m[0].length
  }
  if (last < title.length) out.push({ text: title.slice(last) })
  return out.length ? out : [{ text: title }]
}

/** 백링크 목록에 보일 한 줄: 마크다운 기호(굵게·코드·링크·체크박스)를 걷어 읽기 쉽게 */
export function plainSnippet(raw: string): string {
  return raw
    .replace(/^\s*[-*+]\s+\[ \]\s+/, '☐ ')
    .replace(/^\s*[-*+]\s+\[[xX]\]\s+/, '☑ ')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 경로의 바로 위 폴더 이름(없으면 빈 글) */
export const parentFolder = (path: string): string => {
  const parts = path.split('/')
  return parts.length > 1 ? parts[parts.length - 2] : ''
}
