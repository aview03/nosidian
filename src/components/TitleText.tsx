// 업무 제목 안의 [[노트 링크]]를 대괄호 없이 링크 글자로 보여 주고, 눌렀을 때 그 노트로 가게 한다(개발자 P2: 이슈 → 기록 노트).
// 제목은 목록의 줄 버튼 안에 있으므로 링크도 같은 버튼의 클릭에서 data-link 로 가려낸다(버튼 안에 버튼을 두지 않는다).
import type { MouseEvent } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { splitTitleLinks } from '../lib/mdSnippets'

export function TitleText({ title }: { title: string }) {
  const parts = splitTitleLinks(title)
  if (parts.length === 1 && 'text' in parts[0]) return <>{title}</>
  return (
    <>
      {parts.map((p, i) =>
        'link' in p ? (
          <span key={i} className="tl-link" data-link={p.link} title={t('{name} 열기', { name: p.link })}>{p.label}</span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

/** 줄 버튼의 클릭이 제목 안 링크 글자 위에서 일어났으면 그 노트를 열고 true. 아니면 false(원래 동작대로 편집기) */
export function openTitleLink(e: MouseEvent): boolean {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-link]')
  if (!el?.dataset.link) return false
  e.stopPropagation()
  useApp.getState().openLink(el.dataset.link)
  return true
}
