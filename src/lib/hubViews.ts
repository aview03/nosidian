// 프로젝트 허브의 "보기" 목록과, 프로젝트마다 마지막으로 쓴 보기를 기억하는 곳. 설계: docs/PROJECT-VIEWS.md
//  - 보기를 새로 만들면 HUB_VIEWS 에 한 줄 더하고 ProjectHub 가 그리는 곳을 연결한다.
//  - 기억은 이 기기 브라우저 저장소(편의 기능)라 없어도 기본 보기로 동작한다.

export type HubView = 'board' | 'timeline' | 'table' | 'owners'

/** 칩 순서 = 자주 쓰는 순. label·hint 는 화면에서 t() 로 번역해 쓴다 */
export const HUB_VIEWS: { key: HubView; label: string; hint: string }[] = [
  { key: 'board', label: '보드', hint: '상태별 칸으로 나눠 보고, 끌어서 옮겨요' },
  { key: 'timeline', label: '타임라인', hint: '날짜 순으로 쭉 늘어놓아 봐요' },
  { key: 'table', label: '표', hint: '열 머리를 눌러 정렬하고, 상태·담당·마감을 바로 고쳐요' },
  { key: 'owners', label: '담당자별', hint: '사람마다 모아서 맡은 일과 업무량을 봐요' },
]

export const DEFAULT_HUB_VIEW: HubView = 'board'
const KEY = 'nosidian.hubViews'

const isView = (v: unknown): v is HubView => HUB_VIEWS.some((x) => x.key === v)

function read(): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 이 프로젝트에서 마지막으로 쓴 보기(없거나 이제 없는 보기면 기본 보드) */
export function loadHubView(project: string): HubView {
  const v = read()[project]
  return isView(v) ? v : DEFAULT_HUB_VIEW
}

export function saveHubView(project: string, view: HubView): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [project]: view }))
  } catch {
    /* 저장소를 못 써도 화면은 동작한다 */
  }
}
