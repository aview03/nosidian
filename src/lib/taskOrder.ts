// 보드에서 업무 순서를 바꾸는 순수 부분: 노트 안에서 업무 줄(과 그 아래 들여쓴 줄들)을 다른 업무 앞/뒤로 옮긴다.
// 순서는 따로 저장하지 않고 "노트의 목록 줄 순서" 그 자체다(어느 도구로 열어도 같다). 설계: docs/PROJECT-VIEWS.md §보드 순서
import { findTaskLine } from './work'

/** 줄 앞 공백의 너비(탭은 4칸) */
const indentOf = (l: string) => {
  let n = 0
  for (const ch of /^[ \t]*/.exec(l)![0]) n += ch === '\t' ? 4 : 1
  return n
}

/** i 번째 줄에서 시작하는 덩어리의 끝(제외). 바로 아래에 이어지는, 더 깊이 들여쓴 비어 있지 않은 줄들이 이 줄의 하위 내용이다 */
export function blockEnd(lines: string[], i: number): number {
  const base = indentOf(lines[i])
  let e = i + 1
  while (e < lines.length && lines[e].trim() !== '' && indentOf(lines[e]) > base) e++
  return e
}

/** 들여쓰기를 delta 칸만큼 늘리거나(줄이거나) 한다. 빈 줄은 그대로 */
function reindent(l: string, delta: number): string {
  if (delta === 0 || l.trim() === '') return l
  if (delta > 0) return ' '.repeat(delta) + l
  let rest = -delta
  let i = 0
  while (i < l.length && rest > 0 && (l[i] === ' ' || l[i] === '\t')) {
    rest -= l[i] === '\t' ? 4 : 1
    i++
  }
  return l.slice(i)
}

/**
 * task 의 줄 덩어리를 target 줄 덩어리의 앞(before)/뒤(after)로 옮긴 새 노트 내용. 옮길 수 없거나 바뀌는 게 없으면 null.
 *  - 줄 번호가 밀렸어도 제목으로 찾는다(findTaskLine).
 *  - 옮기는 줄의 들여쓰기는 target 에 맞춘다(하위 줄도 같이): 하위 업무를 바깥으로 꺼내거나 그 반대도 줄 모양이 깨지지 않게.
 *  - target 이 옮기려는 덩어리 안에 있으면(자기 하위 업무 옆으로 옮기기) null.
 */
export function moveTaskBlock(content: string, task: { line: number; title: string }, target: { line: number; title: string }, where: 'before' | 'after'): string | null {
  const lines = content.split('\n')
  const a = findTaskLine(content, task)
  const b = findTaskLine(content, target)
  if (a < 0 || b < 0 || a === b) return null
  const aEnd = blockEnd(lines, a)
  if (b >= a && b < aEnd) return null
  let at = where === 'before' ? b : blockEnd(lines, b)
  const delta = indentOf(lines[b]) - indentOf(lines[a])
  const block = lines.slice(a, aEnd).map((l) => reindent(l, delta))
  const rest = [...lines.slice(0, a), ...lines.slice(aEnd)]
  if (at > a) at -= aEnd - a
  rest.splice(at, 0, ...block)
  const out = rest.join('\n')
  return out === content ? null : out
}
