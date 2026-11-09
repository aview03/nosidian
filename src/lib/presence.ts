import { useEffect, useState } from 'react'

/**
 * 닫힐 때도 사라지는 모션을 보여 주기 위해 언마운트를 잠깐 미룬다.
 * mounted: 화면에 둘지 / closing: 지금 닫히는 중인지 (클래스 `closing` 으로 CSS 퇴장 모션 연결)
 */
export function usePresence(open: boolean, ms = 180) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true) // 렌더 중 상태 보정 (React 권장 패턴)
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setMounted(false), ms)
    return () => clearTimeout(t)
  }, [open, ms])
  return { mounted: open || mounted, closing: !open && mounted }
}
