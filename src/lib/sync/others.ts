import { isOther, MAX_OTHERS } from './types'

/** 다른 파일은 MAX_OTHERS 개까지만 목록에 넣는다(노트·이미지는 전부) */
export function capOthers<T extends { path: string }>(entries: T[]): T[] {
  let n = 0
  return entries.filter((e) => !isOther(e.path) || ++n <= MAX_OTHERS)
}
