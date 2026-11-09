// 줄 단위 3자 병합: 같은 노트를 두 사람이 고쳤을 때, 고친 줄이 겹치지 않으면 자동으로 합친다.
//
//   base   = 마지막으로 동기화했을 때의 내용(둘이 갈라지기 전)
//   local  = 내가 고친 내용        remote = 상대가 고쳐서 올린 내용
//
// 합칠 수 없으면(같은 줄을 서로 다르게 고침) null 을 돌려주고, 호출한 쪽이 사람에게 고르게 한다.
// 체크리스트·회의록처럼 "줄을 더하고 한 줄씩 고치는" 노트를 여럿이 쓰는 팀 사용을 위한 것이다.
import type { NoteFile } from './types'

interface Hunk {
  /** base 에서 바뀐 구간 [s, e). s === e 면 순수 삽입 */
  s: number
  e: number
  /** 그 구간을 대신하는 줄들(비면 삭제) */
  lines: string[]
}

/** 이 곱보다 큰 비교는 하지 않는다(아주 큰 노트에서 브라우저가 멈추는 것을 막는다). 넘으면 자동 병합을 포기하고 사람이 고른다 */
const MAX_CELLS = 16_000_000

/** base → other 의 바뀐 구간들(앞에서부터). 비교가 너무 크면 null */
export function diffHunks(base: string[], other: string[]): Hunk[] | null {
  let lo = 0
  while (lo < base.length && lo < other.length && base[lo] === other[lo]) lo++
  let hb = base.length
  let ho = other.length
  while (hb > lo && ho > lo && base[hb - 1] === other[ho - 1]) {
    hb--
    ho--
  }
  const n = hb - lo
  const m = ho - lo
  if (n === 0 && m === 0) return []
  if (n === 0 || m === 0) return [{ s: lo, e: hb, lines: other.slice(lo, ho) }]
  if (n * m > MAX_CELLS) return null
  // 가운데 부분의 최장 공통 부분열(LCS) — 뒤에서부터 채워 앞에서 따라간다
  const w = m + 1
  const t = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = base[lo + i] === other[lo + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
    }
  }
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let cur: Hunk | null = null
  const flush = () => {
    if (cur) hunks.push(cur)
    cur = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && base[lo + i] === other[lo + j]) {
      flush()
      i++
      j++
    } else if (j < m && (i >= n || t[i * w + j + 1] >= t[(i + 1) * w + j])) {
      cur = cur ?? { s: lo + i, e: lo + i, lines: [] }
      cur.lines.push(other[lo + j])
      j++
    } else {
      cur = cur ?? { s: lo + i, e: lo + i, lines: [] }
      i++
      cur.e = lo + i
    }
  }
  flush()
  // 줄 수가 같은 교체(1:1)는 줄마다 쪼갠다: 이웃한 줄을 각자 고쳤을 때 한 덩어리로 묶여 서로 겹치는 것으로 오해하지 않게
  const out: Hunk[] = []
  for (const h of hunks) {
    if (h.e - h.s === h.lines.length && h.lines.length > 1) {
      for (let k = 0; k < h.lines.length; k++) if (base[h.s + k] !== h.lines[k]) out.push({ s: h.s + k, e: h.s + k + 1, lines: [h.lines[k]] })
    } else out.push(h)
  }
  return out
}

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((x, k) => x === b[k])
const order = (x: Hunk, y: Hunk) => x.s - y.s || x.e - x.s - (y.e - y.s) // 같은 자리면 순수 삽입이 먼저
/** 바뀐 구간이 서로 겹치나(맞닿기만 한 건 겹침이 아니다. 같은 자리 두 삽입도 겹침이 아니라 "둘 다"로 처리한다) */
const overlaps = (a: Hunk, b: Hunk) => a.s < b.e && b.s < a.e

/**
 * base 에서 갈라진 local·remote 를 합친다. 겹치는 수정이 없으면 합친 글, 있으면 null.
 * - 서로 다른 줄의 수정·삭제·추가는 모두 반영한다.
 * - 같은 자리에 둘이 서로 다른 줄을 끼워 넣으면 둘 다 남긴다(내 것 먼저). 체크리스트 끝에 각자 업무를 적은 경우를 살리기 위해서다.
 * - 같은 수정을 둘 다 했으면 한 번만 반영한다.
 */
export function merge3(base: string, local: string, remote: string): string | null {
  if (local === remote) return local
  if (base === local) return remote
  if (base === remote) return local
  const b = base.split('\n')
  const A = diffHunks(b, local.split('\n'))
  const B = diffHunks(b, remote.split('\n'))
  if (!A || !B) return null
  const out: string[] = []
  let pos = 0
  let ia = 0
  let ib = 0
  while (ia < A.length || ib < B.length) {
    const a = A[ia]
    const r = B[ib]
    let h: Hunk
    if (a && r) {
      if (overlaps(a, r)) {
        if (a.s === r.s && a.e === r.e && sameLines(a.lines, r.lines)) {
          ib++ // 같은 수정 → 한 번만
        } else return null
      } else if (a.s === r.s && a.e === a.s && r.e === r.s && sameLines(a.lines, r.lines)) {
        ib++ // 같은 자리에 같은 줄을 끼워 넣음 → 한 번만
      }
      h = order(a, r) <= 0 ? a : r
    } else h = (a ?? r) as Hunk
    if (h === a) ia++
    else if (h === r) ib++
    out.push(...b.slice(pos, h.s), ...h.lines)
    pos = h.e
  }
  out.push(...b.slice(pos))
  return out.join('\n')
}

export interface MergeResult {
  file: NoteFile
  /** 자동으로 합쳤나(false 면 file.conflict 에 원격본을 넣어 사람이 고르게 한 것) */
  auto: boolean
}

/**
 * 내가 고치는 중(dirty)인 노트의 원격본이 바뀌어 내려왔을 때의 처리.
 * 갈라지기 전 내용(base)이 있고 줄이 겹치지 않으면 자동으로 합치고, 아니면 충돌로 남긴다.
 * 합친 결과의 base 는 원격본이다(합친 글은 원격본에서 내 수정을 더한 것이므로 다음 동기화의 기준이 된다).
 */
export function mergeNote(f: NoteFile, remote: { sha: string; content: string }): MergeResult {
  const conflict = (): MergeResult => ({ file: { ...f, conflict: { sha: remote.sha, content: remote.content } }, auto: false })
  if (f.base === undefined) return conflict()
  const merged = merge3(f.base, f.content, remote.content)
  if (merged === null) return conflict()
  const rest = { ...f, content: merged, sha: remote.sha, conflict: undefined, mtime: Date.now() }
  // 내 수정이 이미 원격에 들어 있으면 더 올릴 게 없다
  if (merged === remote.content) return { file: { ...rest, dirty: false, base: undefined }, auto: true }
  return { file: { ...rest, dirty: true, base: remote.content }, auto: true }
}
