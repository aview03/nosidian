// 사용자의 AI 요청이 자동 분석보다 우선하게 하는 작은 통로. AI 패널(aiThread)이 질문을 보내기 전에 자동 분석이 돌고 있으면
// 중단시키고 기다린다. 순환 import 를 피하려고 따로 둔다.
let busy: () => boolean = () => false
let interrupt: () => Promise<void> = async () => {}
export function setAutoGate(g: { busy(): boolean; interrupt(): Promise<void> } | null) {
  busy = g?.busy ?? (() => false)
  interrupt = g?.interrupt ?? (async () => {})
}
export const autoBusy = () => busy()
export const yieldToUser = () => interrupt()
