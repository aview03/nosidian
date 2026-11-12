// 바이너리·기타 파일(.docx·.zip·.pdf …)의 쓰기 충돌 선택(설계 docs/SYNC-HOST.md §7): 자동 병합·덮어쓰기는 하지 않는다.
// PC 에서 먼저 바뀌었거나(409) 지워졌을 때 사용자가 ① 내 것을 새 이름으로 보관 ② PC 것 유지 ③ 내 것으로 덮어쓰기 중에서 고른다. 기본 선택 없음 —
// 창을 닫으면(취소) 아무것도 바꾸지 않는다. 덮어쓰기는 한 번 더 확인한다.
import { confirmAsk, choose } from './dialog'
import { t } from './i18n'
import { uploadPath } from './attachments'
import { dirOf, type WriteConflict } from './sync/types'

export type Resolution = 'rename' | 'keep' | 'overwrite'

/** creating: 이 폰이 새 파일로 올리려는 경우(같은 이름이 PC 에 이미 있다) — 바뀐 게 아니라 이미 있다고 알린다 */
export async function askConflict(name: string, c: WriteConflict, creating = false): Promise<Resolution | null> {
  const deleted = c.deleted
  const caseOnly = c.code === 'case'
  const title = deleted ? t('"{name}" 파일이 PC에서 지워졌어요', { name })
    : caseOnly ? t('"{name}" 와(과) 대소문자만 다른 파일이 PC에 있어요', { name })
    : creating ? t('PC에 "{name}" 와(과) 같은 이름의 파일이 이미 있어요', { name })
    : t('"{name}" 파일이 PC에서 먼저 바뀌었어요', { name })
  const message = t('파일은 합치지 않아요. 고르기 전에는 아무것도 바뀌지 않아요.')
  const choices: { value: Resolution; label: string }[] = [
    { value: 'rename', label: t('내 것을 새 이름으로 보관') },
    { value: 'keep', label: deleted ? t('PC 상태 그대로 두기') : t('PC 것을 그대로 두기') },
    // 대소문자만 다른 경로는 같은 파일이 아니라서 덮어쓸 대상이 없다
    ...(caseOnly ? [] : [{ value: 'overwrite' as const, label: deleted ? t('내 것을 다시 올리기') : t('내 것으로 덮어쓰기') }]),
  ]
  const v = (await choose(title, message, choices, { plain: true })) as Resolution | null // 기본 선택이 없다 — 어느 것도 강조하지 않는다
  if (v !== 'overwrite') return v === 'rename' || v === 'keep' ? v : null
  const ok = await confirmAsk(
    deleted ? t('"{name}"을(를) 다시 올릴까요?', { name }) : t('PC의 "{name}"을(를) 내 것으로 덮어쓸까요?', { name }),
    deleted ? t('PC에서 지운 파일이 이 폰의 파일로 다시 생겨요.') : t('PC에 있는 파일의 현재 내용이 사라지고 이 폰의 파일로 바뀌어요.'),
    deleted ? t('다시 올리기') : t('덮어쓰기'),
    true,
  )
  return ok ? 'overwrite' : null
}

/** 내 것을 새 이름으로 보관할 경로: `이름 (내 것).확장자`, 이미 있으면 `(내 것) (2)`…. stamp 를 주면 이름에 넣어 한 번 더 겹침을 피한다 */
export function conflictCopyPath(path: string, taken: Set<string>, stamp = ''): string {
  const dir = dirOf(path)
  const file = path.split('/').pop()!
  const dot = file.lastIndexOf('.')
  const base = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot) : ''
  return uploadPath(dir, `${base} (${t('내 것')}${stamp ? ' ' + stamp : ''})${ext}`, taken)
}
