// 사용자 템플릿이 놓이는 곳: vault 루트의 `Templates/`(또는 `템플릿/`) 아래 폴더 하나가 템플릿 하나다.
//   Templates/행사 준비 틀/프로젝트 개요.md
//   Templates/행사 준비 틀/할 일.md
// 이 폴더 안의 노트는 "틀"일 뿐 진짜 프로젝트·업무가 아니므로 업무 인덱스에서 뺀다(work.ts).
export const TEMPLATE_ROOTS = ['templates', '템플릿']
/** 새로 저장할 때 쓰는 폴더 이름 */
export const TEMPLATES_DIR = 'Templates'

const lower = (s: string) => s.toLowerCase()

/** 템플릿 폴더 안의 경로면 { name: 템플릿 이름, rel: 템플릿 폴더 기준 상대 경로 }. 템플릿 루트 바로 아래 파일(폴더 없음)은 템플릿이 아니다 */
export function templateParts(path: string): { name: string; rel: string } | null {
  const parts = path.split('/')
  if (parts.length < 3 || !TEMPLATE_ROOTS.includes(lower(parts[0]))) return null
  return { name: parts[1], rel: parts.slice(2).join('/') }
}

/** 템플릿 루트 아래의 모든 경로(업무·프로젝트 인덱스에서 뺄 대상) */
export const isTemplatePath = (path: string) => {
  const i = path.indexOf('/')
  return i > 0 && TEMPLATE_ROOTS.includes(lower(path.slice(0, i)))
}
