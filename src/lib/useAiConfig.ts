// AI 연결 설정(연결한 모델·PC 짝 맺기)이 바뀌면 화면을 다시 그리게 하는 훅.
// 설정 저장(saveLlmConfig)·PC 짝 정보 저장(savePcLink)이 window 로 내보내는 이벤트를 듣는다.
// 다른 창에서 localStorage 가 바뀐 경우(storage 이벤트)도 포함한다.
import { useEffect, useState } from 'react'

/** 연결 설정이 바뀌었음을 알리는 이벤트 이름 */
export const AI_CONFIG_EVENTS = ['nosidian-llm-changed', 'nosidian-pclink-changed'] as const

/** 바뀔 때마다 숫자가 올라간다. 값 자체가 아니라 "다시 계산하라"는 신호로 쓴다 */
export function useAiConfigVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const bump = () => setV((n) => n + 1)
    for (const e of AI_CONFIG_EVENTS) window.addEventListener(e, bump)
    window.addEventListener('storage', bump)
    return () => {
      for (const e of AI_CONFIG_EVENTS) window.removeEventListener(e, bump)
      window.removeEventListener('storage', bump)
    }
  }, [])
  return v
}
