// AI 가 낸 변경이 사용자의 승인(또는 정책 허용)으로 실제 반영될 때 알리는 작은 통로.
// 자동 관리가 "AI 가 바꾼 문서를 곧바로 다시 분석하는 반복"을 막는 데 쓴다. 순환 import 를 피하려고 따로 둔다.
type Listener = (paths: string[]) => void
const ls = new Set<Listener>()
export const onAiChange = (f: Listener) => {
  ls.add(f)
  return () => void ls.delete(f)
}
export const emitAiChange = (paths: string[]) => ls.forEach((f) => f(paths))
