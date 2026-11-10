// 역할(페르소나) 저장과 내 업무 홈 구성 적용. 순수 계산은 persona.ts, 여기서는 설정·화면 저장소에 쓴다.
import { useApp } from './app'
import { defaultLayout } from './tiles'
import { isPersona, presetLayout, type PersonaId } from './persona'
import { readViews } from './views'
import { useWorkUi } from './workOps'

/** 내 업무 홈을 이 역할 구성으로 맞춘다(내가 만든 타일은 그대로 둔다) */
export function applyPersonaLayout(id: PersonaId) {
  const customs = readViews(useApp.getState().files).map((v) => v.name)
  useWorkUi.getState().patchLayout((l) => presetLayout(id, l, customs))
}

/** 역할만 저장한다(null = 정하지 않음). 화면 구성은 따로 묻고 applyPersonaLayout 으로 맞춘다 */
export function setPersona(id: PersonaId | null) {
  useApp.getState().patchSettings({ persona: id })
}

/** 내 업무 화면을 처음 구성으로 되돌린다: 역할이 있으면 그 역할의 구성, 없으면 기본 구성(내가 만든 타일은 그대로) */
export function resetWorkLayout(persona: PersonaId | null) {
  if (persona) return applyPersonaLayout(persona)
  useWorkUi.getState().patchLayout((l) => ({ ...defaultLayout(), order: [...defaultLayout().order, ...l.order.filter((id) => !defaultLayout().order.includes(id))], hidden: [...defaultLayout().hidden, ...l.hidden.filter((id) => !defaultLayout().order.includes(id))] }))
}

export const personaOf = (raw: string | null): PersonaId | null => (isPersona(raw) ? raw : null)
