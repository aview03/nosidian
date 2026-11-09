// 다국어: 한국어 원문을 그대로 키로 쓴다. t('한글 문장') → 현재 언어의 번역. 한국어는 키 그대로 나간다.
// 번역에 없는 키는 영어 → 원문 순으로 대체한다 (빠뜨려도 화면이 깨지지 않게).
import en from './locales/en'
import zh from './locales/zh'
import ja from './locales/ja'
import fr from './locales/fr'
import es from './locales/es'

export const LANGS = ['ko', 'en', 'zh', 'ja', 'fr', 'es'] as const
export type Lang = (typeof LANGS)[number]
/** 설정에 저장되는 값: 'auto' = 시스템 언어를 따른다 */
export type LangPref = 'auto' | Lang

/** 언어 선택 목록에 보이는 이름 (각 언어의 자기 이름) */
export const LANG_NAMES: Record<Lang, string> = {
  ko: '한국어',
  en: 'English',
  zh: '中文',
  ja: '日本語',
  fr: 'Français',
  es: 'Español',
}

const DICTS: Record<Exclude<Lang, 'ko'>, Record<string, string>> = { en, zh, ja, fr, es }

/** 시스템 언어 → 지원 언어. 선호 언어 목록을 앞에서부터 보고, 하나도 안 맞으면 영어 */
export function detectLang(): Lang {
  const prefs = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : []
  for (const p of prefs) {
    const base = (p ?? '').toLowerCase().split('-')[0] as Lang
    if ((LANGS as readonly string[]).includes(base)) return base
  }
  return 'en'
}

export const resolveLang = (pref: LangPref | undefined): Lang => (pref && pref !== 'auto' ? pref : detectLang())

let current: Lang = 'en'
export const getLang = () => current
export function setLang(l: Lang) {
  current = l
  if (typeof document !== 'undefined') document.documentElement.lang = l
}

/** 번역. 문장 안의 {이름} 은 params 로 채운다 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = current === 'ko' ? key : (DICTS[current][key] ?? DICTS.en[key] ?? key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
  return s
}
