import { describe, expect, it } from 'vitest'
import { blockEnd, moveTaskBlock } from './taskOrder'

const T = (line: number, title: string) => ({ line, title })
const doc = (lines: string[]) => lines.join('\n')

describe('업무 줄 덩어리 옮기기', () => {
  const base = doc(['# 할 일', '', '- [ ] 가', '- [ ] 나', '- [ ] 다', '- [ ] 라'])

  it('위로 올리기: 다 를 나 앞으로', () => {
    expect(moveTaskBlock(base, T(4, '다'), T(3, '나'), 'before')).toBe(doc(['# 할 일', '', '- [ ] 가', '- [ ] 다', '- [ ] 나', '- [ ] 라']))
  })
  it('아래로 내리기: 가 를 다 뒤로', () => {
    expect(moveTaskBlock(base, T(2, '가'), T(4, '다'), 'after')).toBe(doc(['# 할 일', '', '- [ ] 나', '- [ ] 다', '- [ ] 가', '- [ ] 라']))
  })
  it('맨 끝으로, 맨 앞으로', () => {
    expect(moveTaskBlock(base, T(2, '가'), T(5, '라'), 'after')).toBe(doc(['# 할 일', '', '- [ ] 나', '- [ ] 다', '- [ ] 라', '- [ ] 가']))
    expect(moveTaskBlock(base, T(5, '라'), T(2, '가'), 'before')).toBe(doc(['# 할 일', '', '- [ ] 라', '- [ ] 가', '- [ ] 나', '- [ ] 다']))
  })
  it('이미 그 자리면 null(바뀌는 게 없다)', () => {
    expect(moveTaskBlock(base, T(3, '나'), T(4, '다'), 'before')).toBeNull() // 나 는 이미 다 앞
    expect(moveTaskBlock(base, T(4, '다'), T(3, '나'), 'after')).toBeNull() // 다 는 이미 나 뒤
    expect(moveTaskBlock(base, T(3, '나'), T(3, '나'), 'before')).toBeNull()
  })
  it('줄 번호가 밀렸어도 제목으로 찾는다', () => {
    expect(moveTaskBlock(base, T(0, '다'), T(0, '나'), 'before')).toBe(doc(['# 할 일', '', '- [ ] 가', '- [ ] 다', '- [ ] 나', '- [ ] 라']))
  })
  it('없는 업무면 null', () => {
    expect(moveTaskBlock(base, T(2, '없는 일'), T(3, '나'), 'before')).toBeNull()
  })
  it('노트의 다른 줄(제목·설명·빈 줄)은 그대로 둔다', () => {
    const d = doc(['# 할 일', '', '설명 한 줄', '', '- [ ] 가', '- [ ] 나', '', '## 다음', '- [ ] 다'])
    expect(moveTaskBlock(d, T(8, '다'), T(4, '가'), 'before')).toBe(doc(['# 할 일', '', '설명 한 줄', '', '- [ ] 다', '- [ ] 가', '- [ ] 나', '', '## 다음']))
  })
})

describe('하위 줄(들여쓴 줄)은 같이 움직인다', () => {
  const d = doc(['- [ ] 가', '  - [ ] 가-1', '  메모', '- [ ] 나', '- [ ] 다', '    - 다 메모'])
  it('덩어리 끝 찾기', () => {
    expect(blockEnd(d.split('\n'), 0)).toBe(3)
    expect(blockEnd(d.split('\n'), 3)).toBe(4)
    expect(blockEnd(d.split('\n'), 4)).toBe(6)
  })
  it('가 를 다 뒤로 옮기면 가-1·메모도 같이', () => {
    expect(moveTaskBlock(d, T(0, '가'), T(4, '다'), 'after')).toBe(doc(['- [ ] 나', '- [ ] 다', '    - 다 메모', '- [ ] 가', '  - [ ] 가-1', '  메모']))
  })
  it('다 를 가 앞으로 올리면 다 메모도 같이', () => {
    expect(moveTaskBlock(d, T(4, '다'), T(0, '가'), 'before')).toBe(doc(['- [ ] 다', '    - 다 메모', '- [ ] 가', '  - [ ] 가-1', '  메모', '- [ ] 나']))
  })
  it('자기 하위 업무 옆으로는 옮기지 않는다', () => {
    expect(moveTaskBlock(d, T(0, '가'), T(1, '가-1'), 'after')).toBeNull()
  })
  it('하위 업무를 바깥(다 뒤)으로 꺼내면 들여쓰기가 target 에 맞춰진다', () => {
    expect(moveTaskBlock(d, T(1, '가-1'), T(3, '나'), 'after')).toBe(doc(['- [ ] 가', '  메모', '- [ ] 나', '- [ ] 가-1', '- [ ] 다', '    - 다 메모']))
  })
  it('바깥 업무를 하위 업무 뒤로 넣으면 들여쓰기가 늘어난다', () => {
    expect(moveTaskBlock(d, T(3, '나'), T(1, '가-1'), 'after')).toBe(doc(['- [ ] 가', '  - [ ] 가-1', '  - [ ] 나', '  메모', '- [ ] 다', '    - 다 메모']))
  })
})
