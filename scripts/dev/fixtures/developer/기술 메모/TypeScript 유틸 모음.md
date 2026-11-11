# TypeScript 유틸 모음

## 재시도 + 지수 백오프
```ts
export async function retry<T>(fn: () => Promise<T>, tries = 5, base = 500): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const wait = Math.min(30_000, base * 2 ** attempt) + Math.random() * 250
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}
```

## 정규식 모음
```js
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const semver = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/
const kebab = /([a-z0-9])([A-Z])/g  // fooBar -> foo-bar : s.replace(kebab, '$1-$2').toLowerCase()
```

## 유용한 타입
```ts
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
type Awaited2<T> = T extends Promise<infer U> ? U : T
```

관련: [[ADR-0007 레이트리밋 정책]] #typescript
