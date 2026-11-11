import { describe, expect, it } from 'vitest'
import { codeInsert, helpItems, parentFolder, plainSnippet, splitTitleLinks } from './mdSnippets'

describe('툴바 코드 버튼', () => {
  it('한 줄 선택은 인라인 코드, 커서는 닫는 backtick 앞', () => {
    expect(codeInsert('foo', false)).toEqual({ insert: '`foo`', cursor: 5, block: false })
  })
  it('선택이 없고 글이 있는 줄이면 빈 인라인 코드(커서는 가운데)', () => {
    expect(codeInsert('', false)).toEqual({ insert: '``', cursor: 1, block: false })
  })
  it('선택이 없고 빈 줄이면 코드 블록(본문 줄에 커서)', () => {
    expect(codeInsert('', true)).toEqual({ insert: '```\n\n```\n', cursor: 4, block: true })
  })
  it('여러 줄을 고르면 코드 블록으로 감싼다(끝 줄바꿈은 정리)', () => {
    expect(codeInsert('a\nb\n', false)).toEqual({ insert: '```\na\nb\n```\n', cursor: 4, block: true })
  })
})

describe('마크다운 도움 목록', () => {
  const items = helpItems()
  it('필요한 문법이 다 있다(코드 블록·표·콜아웃·다이어그램·링크·태그·할 일)', () => {
    for (const id of ['heading', 'task', 'link', 'tag', 'code', 'table', 'callout', 'diagram']) expect(items.map((x) => x.id)).toContain(id)
  })
  it('id 가 겹치지 않고 커서 위치는 글 길이 안에 있다', () => {
    expect(new Set(items.map((x) => x.id)).size).toBe(items.length)
    for (const it of items) expect(it.cursor ?? it.snippet.length).toBeLessThanOrEqual(it.snippet.length)
  })
  it('코드 블록 예시는 언어 이름이 있어 문법 강조가 된다', () => {
    expect(items.find((x) => x.id === 'code')!.snippet.startsWith('```ts\n')).toBe(true)
  })
})

describe('업무 제목 안의 [[링크]] 나누기', () => {
  it('링크가 없으면 글 하나', () => expect(splitTitleLinks('그냥 제목')).toEqual([{ text: '그냥 제목' }]))
  it('글 + 링크 + 글', () => {
    expect(splitTitleLinks('429 응답 추가 [[ADR-0007 레이트리밋 정책]] 확인')).toEqual([{ text: '429 응답 추가 ' }, { link: 'ADR-0007 레이트리밋 정책', label: 'ADR-0007 레이트리밋 정책' }, { text: ' 확인' }])
  })
  it('별칭(|)과 제목(#)이 있는 링크는 노트 이름과 보일 글을 나눈다', () => {
    expect(splitTitleLinks('[[장애 회고#원인|회고]]')).toEqual([{ link: '장애 회고', label: '회고' }])
    expect(splitTitleLinks('[[장애 회고#원인]] 보기')).toEqual([{ link: '장애 회고', label: '장애 회고' }, { text: ' 보기' }])
  })
  it('링크가 여러 개면 모두', () => {
    expect(splitTitleLinks('[[가]] 와 [[나]]').filter((p) => 'link' in p)).toHaveLength(2)
  })
})

describe('백링크 한 줄 정리', () => {
  it('체크박스·굵게·코드·링크 기호를 걷어 읽기 쉽게', () => {
    expect(plainSnippet('- [ ] 429 응답에 `Retry-After` **헤더** 추가 [[ADR-0007 레이트리밋 정책]] p:1')).toBe('☐ 429 응답에 Retry-After 헤더 추가 ADR-0007 레이트리밋 정책 p:1')
    expect(plainSnippet('- [x] 끝난 일')).toBe('☑ 끝난 일')
    expect(plainSnippet('상태: **Proposed** · [문서](http://x) [[장애 회고|회고]]')).toBe('상태: Proposed · 문서 회고')
  })
  it('목록 기호는 뗀다', () => expect(plainSnippet('- 결정 기록: [[ADR-0007]]')).toBe('결정 기록: ADR-0007'))
})

describe('경로의 바로 위 폴더', () => {
  it('폴더가 있으면 그 이름, 없으면 빈 글', () => {
    expect(parentFolder('프로젝트/결제/할 일.md')).toBe('결제')
    expect(parentFolder('할 일.md')).toBe('')
  })
})
