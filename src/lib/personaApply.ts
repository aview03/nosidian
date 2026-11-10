// 역할(페르소나) 저장과 내 업무 홈 구성 적용. 순수 계산은 persona.ts, 여기서는 설정·화면 저장소에 쓴다.
import { useApp } from './app'
import { isPersona, presetLayout, type PersonaId } from './persona'
import { readViews } from './views'
import { useWorkUi } from './workOps'

/** 내 업무 홈을 이 역할 구성으로 맞춘다(내가 만든 타일은 그대로 둔다) */
export function applyPersonaLayout(id: PersonaId) {
  const customs = readViews(useApp.getState().files).map((v) => v.name)
  useWorkUi.getState().patchLayout((l) => presetLayout(id, l, customs))
}

/** 역할을 정한다(null = 정하지 않음). "역할에 맞춰 자동 적용"이 켜져 있으면 홈 구성도 맞춘다 */
export function setPersona(id: PersonaId | null) {
  const app = useApp.getState()
  app.patchSettings({ persona: id })
  if (id && app.settings.personaApply) applyPersonaLayout(id)
}

export const personaOf = (raw: string | null): PersonaId | null => (isPersona(raw) ? raw : null)
