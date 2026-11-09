import 'fake-indexeddb/auto' // 저장소(IndexedDB) 대역: 노트를 쓰는 연산까지 테스트한다
// jsdom 에는 matchMedia 가 없다 (app.ts 의 homeTab 이 PC/모바일을 가릴 때 쓴다)
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
  })
}
