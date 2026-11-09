import { t } from './i18n'
import { useApp } from './app'
import { baseName } from './links'
import { ask, confirmAsk } from './dialog'

/** 노트 메뉴(점 3개 / 길게 누르기 / 우클릭)가 함께 쓰는 동작 */
export async function renameNoteDialog(path: string) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const n = await ask(t('이름 바꾸기'), dir + baseName(path), t('다른 노트의 [[링크]]도 함께 갱신됩니다'), t('변경'))
  if (n?.trim()) useApp.getState().renameNote(path, n.trim())
}

export async function deleteNoteDialog(path: string) {
  if (await confirmAsk(t('"{name}" 삭제', { name: baseName(path) }), t('동기화하면 원격에서도 삭제됩니다.'), t('삭제'), true)) useApp.getState().deleteNote(path)
}

export function copyNoteLink(path: string) {
  void navigator.clipboard?.writeText(`[[${baseName(path)}]]`)
  useApp.getState().say(t('링크를 복사했습니다'))
}

/** 그래프의 "현재 노트" 기준이므로 먼저 그 노트를 연 다음 그래프로 간다 */
export function showInGraph(path: string) {
  const app = useApp.getState()
  app.openNote(path)
  app.go('graph')
}
