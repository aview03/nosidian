// 이 기기를 PC 가 알아보는 안정적인 id. 같은 폰이 같은 PC 에 다시 연결할 때 서버가 "새 기기"가 아니라 "같은 기기의 새 링크"로 처리하게 한다.
// 비밀이 아니다(토큰이 아님) — 그래서 localStorage 에 그대로 둔다. 지워지면 새 기기로 보일 뿐이다.
const KEY = 'nosidian.clientId'

function random(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto
    if (c?.randomUUID) return c.randomUUID()
    if (c?.getRandomValues) return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    /* 아래 대체 */
  }
  return Math.random().toString(16).slice(2).padEnd(16, '0') + Date.now().toString(16)
}

export function clientId(): string {
  try {
    const v = localStorage.getItem(KEY)
    if (v && /^[A-Za-z0-9-]{8,64}$/.test(v)) return v
    const n = random()
    localStorage.setItem(KEY, n)
    return n
  } catch {
    return random() // 저장소를 못 쓰면 이번 연결에서만 쓰는 값
  }
}
