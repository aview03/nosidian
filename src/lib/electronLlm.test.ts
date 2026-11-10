import { describe, expect, it } from 'vitest'
import { isPrivateHost } from './llm'
// @ts-expect-error 메인 프로세스용 CommonJS 파일이라 타입 선언이 없다
import mainRaw from '../../electron/llm.cjs'

// 메인 프로세스(electron/llm.cjs)는 화면(src/lib/llm.ts)과 같은 주소 규칙을 따로 한 번 더 검사한다. 둘이 어긋나지 않는지 본다.
const main = mainRaw as { check(req: unknown): string | null; isPrivateHost(h: string): boolean }

describe('메인 프로세스 요청 검사(electron/llm.cjs)', () => {
  it('주소 규칙이 화면(llm.ts)과 같다', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '172.32.0.1', '192.168.1.1', '192.169.1.1', '169.254.0.1', '100.64.0.1', '100.128.0.1', 'nas.local', '[::1]', '::1', 'example.com', '8.8.8.8', 'api.openai.com']) {
      expect(main.isPrivateHost(h), h).toBe(isPrivateHost(h))
    }
  })
  it('허용: 사설망 http, 어디든 https, GET·POST', () => {
    expect(main.check({ url: 'http://192.168.0.10:11434/api/tags', method: 'GET', headers: {} })).toBeNull()
    expect(main.check({ url: 'https://api.openai.com/v1/models', method: 'GET', headers: {} })).toBeNull()
    expect(main.check({ url: 'http://localhost:11434/api/chat', method: 'POST', headers: {}, body: '{}' })).toBeNull()
  })
  it('거절: 공개 http, http/https 가 아닌 주소, 다른 메서드, 문자열이 아닌 본문, 깨진 요청', () => {
    expect(main.check({ url: 'http://example.com/', method: 'GET' })).not.toBeNull()
    expect(main.check({ url: 'file:///c:/x', method: 'GET' })).not.toBeNull()
    expect(main.check({ url: 'ftp://localhost/', method: 'GET' })).not.toBeNull()
    expect(main.check({ url: 'http://localhost/', method: 'DELETE' })).not.toBeNull()
    expect(main.check({ url: 'http://localhost/', method: 'POST', body: { a: 1 } })).not.toBeNull()
    expect(main.check({ url: '이상한' , method: 'GET' })).not.toBeNull()
    expect(main.check(null)).not.toBeNull()
  })
})
