// 폰에서 PC 연결을 해제할 때, PC 에도 "이 휴대폰을 해제해 달라"고 알린다(5-c).
// 예전에는 폰이 자기 연결 정보만 지워서 PC 의 "연결된 휴대폰" 목록에 계속 남았다.
// 알림은 best effort 다 — PC 가 꺼져 있어도 폰의 해제는 끝나야 한다.

/**
 * fn(PC 에 /unpair 를 보내는 호출)이 성공하면 true. 이미 PC 쪽에서 해제돼 있어서 401 이 와도 true(목적은 이뤄진 상태).
 * 닿지 않거나 그 밖의 오류면 false → 화면이 "PC 앱에서 직접 해제해 주세요"라고 알린다.
 */
export async function notifyUnpair(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    return (e as { status?: number } | null)?.status === 401
  }
}

/** 해제를 알리는 데 기다리는 시간(ms). 꺼진 PC 때문에 해제 버튼이 오래 멈춰 있으면 안 된다 */
export const UNPAIR_TIMEOUT_MS = 6000
