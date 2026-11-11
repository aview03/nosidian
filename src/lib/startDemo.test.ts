import { describe, expect, it } from 'vitest'
import { useApp } from './app'

describe('예제 노트로 시작', () => {
  it('내 업무(홈)를 먼저 보이고, 환영 노트는 열지 않고 "최근"에 둔다', async () => {
    await useApp.getState().startDemo()
    const s = useApp.getState()
    expect(s.tab).toBe('work')
    expect(s.current).toBeNull() // 노트가 열려 있지 않다
    const welcome = s.settings.recent[0]
    expect(welcome).toMatch(/환영합니다\.md$|Welcome\.md$/)
    expect(s.files[welcome]).toBeTruthy() // 노트 자체는 vault 에 있다
  })
})
