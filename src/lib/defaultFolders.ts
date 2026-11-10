// 처음 만드는 기본 폴더 이름: 한국어는 한글, 그 밖의 언어는 영어. 한 번 만든 뒤에는 언어를 바꿔도 이름이 바뀌지 않는다.
import type { Lang } from './i18n'

/** 일정·할 일을 적는 날짜별 노트(Daily)를 모아 두는 폴더 */
export const defaultDailyFolder = (lang: Lang) => (lang === 'ko' ? '할 일' : 'Tasks')
/** 프로젝트 폴더들을 모아 두는 최상위 폴더 */
export const defaultProjectsFolder = (lang: Lang) => (lang === 'ko' ? '프로젝트' : 'Projects')

/** 새 프로젝트를 만들 최상위 폴더: 이미 쓰고 있는 폴더(프로젝트/Projects)가 있으면 그것을, 없으면 언어에 맞는 기본값 */
export function projectsRoot(existingPaths: string[], lang: Lang): string {
  const top = (p: string) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '')
  for (const p of existingPaths) {
    const t0 = top(p)
    if (t0 === '프로젝트' || t0 === 'Projects') return t0
  }
  return defaultProjectsFolder(lang)
}
