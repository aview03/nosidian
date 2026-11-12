// 프로젝트의 "깊이"와 "용어"(프로젝트 개요 노트의 속성으로 정한다 — 역할이 아니라 프로젝트가 정한다).
//  - depth: light  → 허브에서 문서·문서 점검 탭을 숨긴다(일정만 가볍게 보는 프로젝트, 예: 디자인 일정). 없으면 표준(모든 탭).
//                     데이터는 그대로이고 보이는 것만 바뀐다 — 허브 메뉴에서 언제든 오간다.
//  - words: design → 상태 이름을 그 일의 말로 보여 준다(시작 전·시안 중·검토 요청·확정). 내부 값(status·side)은 그대로다.
// 설계: docs/PROJECT-DEPTH.md
import { t } from './i18n'

export type Depth = 'light' | 'standard'

const LIGHT = /^(light|가볍게|simple|간단히)$/i
export const depthOf = (fm?: Record<string, unknown> | null): Depth => (LIGHT.test(String(fm?.depth ?? '').trim()) ? 'light' : 'standard')

export interface StateWords {
  todo: string
  doing: string
  waiting: string
  done: string
  dropped: string
}

const DESIGN = /^(design|디자인)$/i

/** 상태 이름. 프로젝트 속성 words 가 없으면 기본 이름 */
export function wordsOf(fm?: Record<string, unknown> | null): StateWords {
  if (DESIGN.test(String(fm?.words ?? '').trim())) {
    return { todo: t('시작 전'), doing: t('시안 중'), waiting: t('검토 요청'), done: t('확정'), dropped: t('취소됨') }
  }
  return { todo: t('할 일'), doing: t('진행 중'), waiting: t('대기'), done: t('완료'), dropped: t('취소됨') }
}
