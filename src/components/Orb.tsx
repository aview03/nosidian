// 빛나는 구: "AI 가 곁에 있다/생각 중이다"를 보여 주는 공용 그림. 움직임을 줄인 설정이면 정지 이미지로 바뀐다.
import orbAnim from '../assets/ai-thinking.webp'
import orbStill from '../assets/ai-thinking-still.webp'

export function Orb({ size, still, className = '' }: { size: number; still?: boolean; className?: string }) {
  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={orbStill} />
      <img className={`ai-orb ${className}`} src={still ? orbStill : orbAnim} alt="" width={size} height={size} style={{ width: size, height: size }} draggable={false} />
    </picture>
  )
}
