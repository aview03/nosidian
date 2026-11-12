// 안드로이드 뒤로 가기의 처리 순서(App.tsx 에서 뺐다 — 인라인이면 순서·조건 누락이 시험에 안 잡혔다: 태그에서 들어간 검색 화면의 뒤로 가기가 노트로 가지 않던 문제).
// 위에서부터 첫 번째로 해당하는 것 하나만 한다. 컴포넌트에 있는 두 규칙(메모·설정)과 종료는 부르는 쪽이 넘긴다.
import { homeTab, useApp } from './app'
import { useAiThread } from './aiThread'
import { runBack } from './backStack'
import { useDialog } from './dialog'

export interface BackDeps {
  /** 메모 탭: 선택 해제 → 위 폴더. 했으면 true */
  memoBack(): boolean
  /** 설정: 그룹 안 → 그룹 목록(바로 들어왔으면 들어온 화면). 했으면 true */
  settingsBack(): boolean
  /** 홈에서 한 번 더 누르면 앱 종료 */
  exit(): void
  desktop(): boolean
}

export function androidBack(d: BackDeps): void {
  const app = useApp.getState()
  if (useDialog.getState().kind) return useDialog.setState({ kind: null }) // 확인·입력 창
  if (runBack()) return // 스스로 등록한 시트·창을 가장 나중에 연 것부터 — 안 그러면 뒤쪽 화면만 물러난다
  if (app.vaultSheet) return app.setVaultSheet(false)
  if (app.palette) return app.setPalette(null)
  if (app.sheet) return app.setSheet(null)
  if (useAiThread.getState().open && !d.desktop()) return useAiThread.getState().setOpen(false) // 폰: AI 시트
  // 노트: 이번에 따라온 노트 한 칸씩 → 노트를 연 화면. 태그·그래프로 들어간 검색·그래프 화면: 그 노트로
  if ((app.tab === 'note' || app.drillFrom) && app.backScreen()) return
  if (app.tab === 'files' && d.memoBack()) return
  if (app.tab === 'settings' && d.settingsBack()) return
  if (app.tab !== homeTab()) return app.go(homeTab()) // 홈으로 한 번 돌아간 뒤
  d.exit() // 종료
}
