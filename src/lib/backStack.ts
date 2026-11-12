// 안드로이드 뒤로 가기: 열려 있는 시트·창이 스스로 "닫기"를 등록해 두고, 뒤로 가기는 가장 나중에 열린 것부터 닫는다.
// (예전에는 App.tsx 의 처리기가 시트마다 따로 알아야 해서, 모르는 시트가 열린 채 뒤쪽 화면만 물러났다 — 연구자 P3·폰 점검 F46)
import { useEffect, useRef } from 'react'

type Entry = { close: () => void }
const stack: Entry[] = []

/** 닫기를 등록한다. 돌려주는 함수로 등록을 푼다 */
export function pushBack(close: () => void): () => void {
  const e: Entry = { close }
  stack.push(e)
  return () => {
    const i = stack.lastIndexOf(e)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** 뒤로 가기: 가장 나중에 연 것을 닫는다. 닫을 것이 없으면 false(→ 화면 이동) */
export function runBack(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.close()
  return true
}

export const backDepth = () => stack.length

/** 열려 있는 동안 뒤로 가기로 닫히게 한다. close 는 매번 새 함수여도 된다(최신 것을 쓴다) */
export function useBackClose(active: boolean, close: () => void) {
  const ref = useRef(close)
  useEffect(() => {
    ref.current = close
  })
  useEffect(() => {
    if (!active) return
    return pushBack(() => ref.current())
  }, [active])
}
