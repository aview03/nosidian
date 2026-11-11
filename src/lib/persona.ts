// 사용자 역할(페르소나): 처음 쓰는 사람에게 "내 업무" 홈의 기본 구성을 골라 주는 데만 쓴다(기능의 유무는 바꾸지 않는다).
// 설계: docs/UX-PERSONAS.md · docs/UX-IA.md. 순수 함수 — 저장소를 쓰지 않는다.
import { BUILTIN_TILES, customId, isCustom, type BuiltinTile, type Layout } from './tiles'

export const PERSONAS = ['designer', 'planner', 'developer', 'marketer', 'researcher', 'student'] as const
export type PersonaId = (typeof PERSONAS)[number]

export interface PersonaInfo {
  id: PersonaId
  /** 카드에 보일 이름 */
  label: string
  /** 한 줄 설명 */
  hint: string
  /** 처음 켜 둘 타일(보이는 순서) */
  tiles: BuiltinTile[]
}

export const PERSONA_INFO: Record<PersonaId, PersonaInfo> = {
  designer: { id: 'designer', label: '디자이너', hint: '시안·리뷰·피드백을 주고받아요', tiles: ['today', 'dueToday', 'waiting', 'projects'] },
  planner: { id: 'planner', label: '기획자', hint: '결정·정책·일정을 조율해요', tiles: ['today', 'decisions', 'overdue', 'waiting', 'projects'] },
  developer: { id: 'developer', label: '개발자', hint: '개발하고 기록하고 이슈를 모아요', tiles: ['today', 'doing', 'overdue', 'triage', 'projects'] },
  marketer: { id: 'marketer', label: '마케터', hint: '캠페인과 콘텐츠 일정을 챙겨요', tiles: ['today', 'week', 'dueToday', 'waiting', 'projects'] },
  researcher: { id: 'researcher', label: '연구자', hint: '읽고 실험하고 아이디어를 모아요', tiles: ['today', 'doing', 'dueToday', 'triage', 'projects'] },
  student: { id: 'student', label: '학생', hint: '수업 필기와 과제 마감을 챙겨요', tiles: ['today', 'week', 'dueToday', 'overdue'] },
}

export const isPersona = (v: unknown): v is PersonaId => typeof v === 'string' && (PERSONAS as readonly string[]).includes(v)

/** 내 업무 타일의 분류와 한 줄 설명(타일 설정 화면에서 이름만 보고 고르지 않게) */
export const TILE_GROUPS: { id: string; label: string; tiles: BuiltinTile[] }[] = [
  { id: 'today', label: '오늘·일정', tiles: ['today', 'dueToday', 'week'] },
  { id: 'attention', label: '주의할 일', tiles: ['overdue', 'waiting'] },
  { id: 'decide', label: '협업·결정', tiles: ['decisions', 'unowned'] },
  { id: 'progress', label: '진행·정리', tiles: ['doing', 'triage', 'projects'] },
]
export const TILE_HINT: Record<BuiltinTile, string> = {
  today: '오늘의 일정과 할 일',
  dueToday: '오늘이 마감인 일',
  week: '이번 주에 마감인 일',
  overdue: '마감이 지났는데 아직 끝나지 않은 일',
  waiting: '내가 답이나 결과를 기다리는 일',
  decisions: '결정이 필요한 일',
  unowned: '담당자가 정해지지 않은 일',
  doing: '지금 하고 있는 일',
  triage: '아직 프로젝트에 넣지 않은 새 업무',
  projects: '프로젝트별 상태 한눈에 보기',
}
export const groupOfTile = (id: string): string => TILE_GROUPS.find((g) => g.tiles.includes(id as BuiltinTile))?.id ?? 'custom'

/**
 * 역할에 맞는 홈 구성. 내가 만든 타일(조건 타일)은 지금 보이는 상태 그대로 뒤에 붙이고,
 * 줄 수·접기 같은 개별 설정은 지운다(새 구성으로 처음부터).
 */
export function presetLayout(persona: PersonaId, current: Layout, customs: string[]): Layout {
  const on: string[] = [...PERSONA_INFO[persona].tiles]
  const off: string[] = BUILTIN_TILES.filter((id) => !on.includes(id))
  const keptCustoms = customs.map(customId)
  const visibleCustoms = keptCustoms.filter((id) => !current.hidden.includes(id))
  const hiddenCustoms = keptCustoms.filter((id) => current.hidden.includes(id))
  // 역할 구성에 프로젝트 타일이 없어도(학생), 프로젝트를 만들면 홈에 저절로 나타난다 — 만든 프로젝트를 홈에서 찾을 수 있게
  const auto = off.includes('projects') ? ['projects'] : undefined
  return { order: [...on, ...visibleCustoms, ...off, ...hiddenCustoms], hidden: [...off, ...hiddenCustoms], collapsed: [], limit: {}, ...(auto ? { auto } : {}) }
}

/** 지금 구성이 역할 프리셋과 같은가(내가 따로 바꿨는지 알려 주는 데 쓴다). 내가 만든 타일은 보지 않는다 */
export function matchesPreset(persona: PersonaId, layout: Layout): boolean {
  const shown = layout.order.filter((id) => !layout.hidden.includes(id) && !isCustom(id))
  const want = PERSONA_INFO[persona].tiles
  return shown.length === want.length && shown.every((id, i) => id === want[i])
}
