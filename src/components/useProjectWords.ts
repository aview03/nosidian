import { useApp } from '../lib/app'
import { wordsOf, type StateWords } from '../lib/projectKind'

/** 그 프로젝트(개요 노트 경로)의 상태 이름. 프로젝트가 없거나 속성이 없으면 기본 이름 */
export function useProjectWords(projectPath: string | null | undefined): StateWords {
  const fm = useApp((s) => (projectPath ? s.index.notes.get(projectPath)?.fm : undefined))
  return wordsOf(fm)
}
