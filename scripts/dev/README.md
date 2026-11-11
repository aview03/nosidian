# 개발용 검증 스크립트 (CDP)

실제 앱(Electron 시험 인스턴스 / Android 실기기)을 Chrome DevTools Protocol 로 조작·캡처해서 화면을 확인할 때 쓴다. 앱 코드에는 포함되지 않는다.

## PC (Electron 시험 인스턴스)
```
npm run build
# 시험용 프로필로 띄움 (설치된 Nosidian 과 데이터가 섞이지 않게 --user-data-dir 을 따로 준다)
NOSIDIAN_PORT=47399 node_modules/.bin/electron electron/main.cjs --user-data-dir=<임시폴더> --remote-debugging-port=9333
node scripts/dev/cdp.cjs MAIN "document.title"            # 렌더러에서 JS 실행(awaitPromise), 결과는 JSON
node scripts/dev/shot.cjs 9333 MAIN out.png 1280 860       # 스크린샷(창 크기 지정)
```
- 시험 인스턴스를 끌 때는 `taskkill //F //IM electron.exe` — **설치된 `Nosidian.exe` 는 건드리지 않는다**(프로세스 이름이 다름).
- 첫 화면에서 "예제 노트로 둘러보기" 버튼을 눌러 예제 vault 를 만든 뒤 조작한다.

## 시험 데이터 넣기 (PC·폰 똑같이)
```
# 앱에 개발용 훅을 켠다: localStorage nosidian.dev=1 을 넣고 다시 불러온 뒤
node scripts/dev/inject-fixture.cjs 9333 scripts/dev/fixtures/developer "개발 노트"   # PC
node scripts/dev/inject-fixture.cjs 9444 scripts/dev/fixtures/developer "개발 노트"   # 폰(adb forward 후)
```
- `scripts/dev/fixtures/developer/` 는 개발자 역할용 평범한 `.md` 파일들(결제 게이트웨이·모바일 릴리스 프로젝트, ADR·장애 회고·회의록, 코드 블록이 있는 기술 메모, 받은 업무, Daily). 새 보관함을 만들어 거기에 넣으므로 기존 보관함은 건드리지 않는다.
- 역할(`persona: developer`)·내 이름(`동민`)도 함께 맞춘다. 내 업무 화면 구성은 `localStorage nosidian.worklayout` 값을 PC 에서 읽어 폰에 같은 값으로 넣으면 같아진다.

## Android 실기기
```
adb forward tcp:9444 localabstract:webview_devtools_remote_<앱 pid>   # pid 는 `adb shell cat /proc/net/unix | grep webview_devtools`
node scripts/dev/cdp-phone.cjs MAIN "<js>"
node scripts/dev/shot.cjs 9444 MAIN out.png
```
- 빌드·설치: `npm run build && npx cap sync android`, JDK 21(`JAVA_HOME=C:\Program Files\Android\Android Studio\jbr`)로 `android/gradlew.bat assembleDebug`, `adb install -r app/build/outputs/apk/debug/app-debug.apk`.

## 한글 입력
React 입력칸은 `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v)` 후 `input` 이벤트를 보내야 반영된다. 실제 한글 입력기(IME) 동작은 코드 주입으로는 재현되지 않으니 입력이 있는 기능은 실제 키보드로도 확인한다.

## AI 변경 제안 시험
AI 도구가 아직 없어서, 렌더러 localStorage 에 `nosidian.dev` = `1` 을 넣고 새로고침하면 `window.__proposals` = `{ store, contentHash, app }` 가 열린다. `store.getState().submit({ action, path, baseHash: contentHash(내용), content }, "이름", "설명")` 로 제안을 넣고 `setOpen(true)` 로 검토 화면을 연다(예: 규칙을 켠 프로젝트의 공식 문서 수정 → 승인 대기).
