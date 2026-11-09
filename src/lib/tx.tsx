import { Fragment, type ReactNode } from 'react'
import { t } from './i18n'

/** 문장 안에 <b>·<code> 같은 요소를 끼워 넣는 번역: tx('... {name} ...', { name: <b>..</b> }) */
export function tx(key: string, parts: Record<string, ReactNode>): ReactNode {
  return t(key)
    .split(/(\{\w+\})/)
    .map((p, i) => {
      const m = p.match(/^\{(\w+)\}$/)
      return m && m[1] in parts ? <Fragment key={i}>{parts[m[1]]}</Fragment> : p
    })
}
