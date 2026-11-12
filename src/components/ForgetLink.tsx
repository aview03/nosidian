// 폰의 "PC 연결 해제" 버튼(세 곳 공통: AI · PC 폴더 보기 · 내 PC 동기화).
// 같은 문구·같은 확인 창·같은 결과 안내로 맞춘다(5-c). 해제는 PC 에도 알려서 PC 의 "연결된 휴대폰" 목록에서 빠지게 한다.
import { useState } from 'react'
import { useApp } from '../lib/app'
import { confirmAsk } from '../lib/dialog'
import { t } from '../lib/i18n'

export type LinkKind = 'ai' | 'share' | 'host'

/** 해제하면 무엇이 달라지는지(종류마다 다르다) */
export const forgetNote = (kind: LinkKind): string => {
  switch (kind) {
    case 'ai': return t('이 PC의 AI·Claude를 이 휴대폰에서 더 쓸 수 없어요. PC를 거치는 AI 연결도 함께 지워져요.')
    case 'share': return t('PC 폴더를 더 볼 수 없어요. 이 휴대폰에 이미 받은 파일은 그대로예요.')
    case 'host': return t('이 휴대폰의 노트는 그대로 남아요. 연결 정보만 지워요. 올리지 않은 변경은 노트에 남아 있어요.')
  }
}

/** 해제를 끝낸 뒤의 안내. notified: PC 의 목록에서도 빠졌나 */
export const forgetResult = (notified: boolean): string =>
  notified ? t('연결을 해제했어요. PC의 "연결된 휴대폰" 목록에서도 빠졌어요.') : t('이 휴대폰에서는 해제했어요. PC에 알리지 못했어요(PC가 꺼져 있거나 PC 앱이 옛 버전이에요). PC 앱의 "연결된 휴대폰"에서 직접 해제해 주세요.')

export function ForgetLink({ kind, pcName, onForget, className = 'btn-link', label }: { kind: LinkKind; pcName: string; /** 해제를 실행하고, PC 목록에서도 빠졌는지 돌려준다 */ onForget(): Promise<boolean>; className?: string; /** 같은 화면에 다른 "해제"가 있어 구분이 필요할 때만 */ label?: string }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (busy) return
    if (!(await confirmAsk(t('"{name}" 연결을 해제할까요?', { name: pcName }), forgetNote(kind), t('해제'), true))) return
    setBusy(true)
    try {
      useApp.getState().say(forgetResult(await onForget()))
    } finally {
      setBusy(false)
    }
  }
  return <button className={className} disabled={busy} onClick={() => void go()}>{label ?? t('연결 해제')}</button>
}
