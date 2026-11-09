import { useApp } from '../lib/app'
import { LANGS, LANG_NAMES, t, type LangPref } from '../lib/i18n'

/** 언어 선택: 시스템(자동) + 지원 언어. 이름은 각 언어의 자기 이름으로 보여준다 */
export function LangSelect() {
  const lang = useApp((s) => s.settings.lang)
  return (
    <select
      className="lang-select"
      value={lang}
      onChange={(e) => useApp.getState().patchSettings({ lang: e.target.value as LangPref })}
      aria-label="Language"
    >
      <option value="auto">{t('시스템 설정 따라가기')}</option>
      {LANGS.map((l) => (
        <option key={l} value={l}>{LANG_NAMES[l]}</option>
      ))}
    </select>
  )
}
