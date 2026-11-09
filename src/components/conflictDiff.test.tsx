import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConflictDiff } from './NoteView'
import { setLang } from '../lib/i18n'

setLang('ko')

describe('충돌 안내: 다른 곳 보기', () => {
  it('내 글과 원격 글이 다른 구간만 보여 준다', () => {
    const html = renderToStaticMarkup(<ConflictDiff mine={'a\n케이크 owner:민수\nc'} theirs={'a\n케이크 owner:지현\nc'} />)
    expect(html).toContain('케이크 owner:민수')
    expect(html).toContain('케이크 owner:지현')
    expect(html).toContain('1군데')
  })
  it('다른 곳이 없으면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<ConflictDiff mine={'같음'} theirs={'같음'} />)).toBe('')
  })
  it('6곳 이상이면 5곳만 보이고 나머지 개수를 알려 준다', () => {
    const mine = Array.from({ length: 12 }, (_, i) => `줄${i}`).join('\n\n')
    const theirs = Array.from({ length: 12 }, (_, i) => `줄${i}'`).join('\n\n')
    const html = renderToStaticMarkup(<ConflictDiff mine={mine} theirs={theirs} />)
    expect((html.match(/cd-hunk/g) ?? []).length).toBe(5)
    expect(html).toContain('외 7군데')
  })
})
