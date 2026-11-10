# Nosidian 이어서 시작하기 (2026-11-10 기준 · v1.42.0)

> 새 세션을 시작할 때 이 문서를 그대로 붙여 넣으세요. Claude 는 이 문서를 읽은 뒤, 아래 "첫 행동"을 하고 사용자에게 다음 작업을 확인합니다.
> 상세 기억은 `C:\Users\USER\.claude\projects\C--Users-USER-Desktop-MD-Reader\memory\nosidian-project-state.md`(자동 메모리)에도 있습니다. 둘이 다르면 **저장소의 코드·git 로그가 사실**입니다.

## 1. 프로젝트
- **Nosidian**: 사용자 본인의 Markdown 노트·일정·프로젝트 관리 앱. PC(Electron) + Android(Capacitor). 사용자가 개발자이자 소유자.
- 앱 루트 `C:\Users\USER\Desktop\MD_Reader\app` (git, remote `github.com/movemin03/nosidian`, 브랜치 `main`). 사용자와는 **한국어**로 대화한다.
- 노트는 IndexedDB(Vault)에 있고, 동기화는 GitHub·Google Drive·OneDrive(클라우드) **또는** 이 PC 를 호스트로 쓰는 "내 PC" 방식(클라우드 없이)이 있다.

## 2. 현재 상태
- 원격 `origin/main` = **v1.42.0 (`f85e9f3`)** 까지 푸시됨. (이 문서를 넣는 커밋 1개만 로컬에 더 있을 수 있음 — `git status -sb` 로 확인)
- 테스트 **725개 통과**(`npm test`), `npx tsc -b` 오류 없음. 설치 파일 `release/Nosidian-Setup-1.42.0.exe`(~125MB) 빌드됨, 폰에는 v1.42.0 APK 설치됨.
- 폰: Android(삼성 One UI 추정), USB 연결, 화면 꺼짐 30초(시험할 때만 `svc power stayon true`). **PIN 잠금이 걸려 있어 잠기면 CDP 가 멈춘다 → 폰 시험 전에 사용자에게 "잠금 풀어 주세요" 요청.**

## 3. 반드시 지킬 규칙 (사용자 지시)
1. **푸시는 사용자가 "푸쉬"라고 할 때만.** 평소엔 로컬 커밋만. 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
2. **푸시 전 검사**(매번): `git diff --name-only origin/main..HEAD` 에 `docs/phase2/reference/`·키/인증서/토큰/설정 파일(`*.pem`, `share-tls.json`, `llm-key.bin`, `host.json`, `hostsrv.json` 등)·`release/` 없음 + 추가된 줄에 API 키·토큰·개인키 패턴 없음. 결과를 정직하게 보고.
3. `docs/phase2/reference/` 는 gitignore 대상 — **절대 커밋·푸시 금지**.
4. Android **홈 화면 위젯 선택 화면은 자동화하지 않는다.** 폰은 시험 기기라 데이터를 덮어써도 된다. 사용자의 개인 Claude 설정은 시험 중 건드리지 않는다(시험용 프로필 `scratchpad/ud_verify`만 쓴다).
5. **미확인 항목을 확인된 것처럼 말하지 않는다.** 확인한 것과 못 한 것을 분리해 보고한다(이 프로젝트의 보고 형식: 구현한 것 / 확인한 것 / 미확인·한계).
6. **호스트 폴더·동기화 정책(확정)**: 새 동기화 엔진을 만들지 않고 기존 `Provider` 인터페이스 재사용 · Vault 당 동기화 대상 1개 · 쓰기는 기기별로 **PC 화면에서만** 허용(기본 읽기 전용) · 삭제 권한은 별도·현재 꺼짐 · 모바일→PC 실행 파일 쓰기 거부 · 어떤 파일도 자동 실행/자동 신뢰하지 않음 · 최초 연결은 미리보기→항목별 선택→**스냅샷(실패 시 시작 안 함)**→반영, 삭제 없음 · 폰은 PC 가 꺼져 있어도 노트를 읽고 고칠 수 있어야 함(오프라인 우선).
7. UX 선호: 설명문은 짧게, 계층·그룹이 보이게, 버튼은 또렷하게(옅은 유리 느낌 금지), 모바일에선 PC 전용 항목 숨김. 기존 클라우드 동기화와 AI 문서 정책·승인 기능은 건드리지 않는다.

## 4. 최근 작업 지도 (v1.32 → v1.42) — 문서 위치
| 버전 | 내용 | 문서 |
| --- | --- | --- |
| v1.32~1.33 | 모바일 AI 패널, 폰이 PC 의 AI(Ollama·API 키 모델·Claude 구독)를 QR/코드로 연결(LAN 중계) | `docs/RELAY.md` |
| v1.34~1.37 | 노트가 아닌 파일(.py·.docx…) 목록 동기화·받기·올리기·삭제·이동·교체, Claude 의 파일 제안(`propose_file`, 항상 승인) | `docs/FILES.md` |
| v1.38 | "내 PC 폴더 보기": 폰이 PC 폴더를 읽기 전용으로 보고 받기(HTTPS·인증서 지문 고정) | `docs/SHARE.md` |
| v1.38.1 | 인증서 회귀 시험, 호스트 동기화 설계 | `docs/SYNC-HOST.md` (정책 전체) |
| v1.39 | Android Keystore 로 토큰·API 키 보호 | `docs/SECURE-STORAGE.md` |
| v1.40 | PC 호스트 저장 계층(manifest·rev·삭제 기록·원자적 저장 복구·외부 변경 감지·스냅샷) + "내 PC 폴더" Provider | `docs/HOST-STORE.md` |
| v1.41 | 호스트 동기화 서버: 기기별 쓰기 권한·조건부 쓰기·실행 파일 거부 | `docs/HOST-SERVER.md` |
| v1.42 | 폰의 "내 PC" 연결(클라우드 없이 폰↔PC 동기화) | `docs/HOST-PHONE.md` |

주요 코드: `electron/{hostStore,hostServer,hostIpc,fileShare,aiRelay}.cjs`, `src/lib/{pcHost,hostConnect,phoneSnapshot,secureStore,pinnedHttp}.ts`, `src/lib/sync/{host,pchost}.ts`, `src/components/{HostConnect,HostPlan,PcHostConnect}.tsx`, 네이티브 `android/.../{PinnedHttpPlugin,SecureStorePlugin}.java`.

## 5. 검증 상태
**확인함**: 위 기능 전부 단위·통합 시험 + 실제 PC 앱(Electron) 화면 조작 + (v1.38·1.39·1.42) 실제 폰. v1.42 는 폰↔PC 앱으로 짝 맺기·읽기 전용 미리보기·허용 후 업로드·양쪽 병합·삭제 미전파 안내·오프라인·주소 변경·재시작 후 토큰·PC 해제·연결 끊기까지 확인.

**미확인/미완**:
- 폰 **카메라로 QR 스캔**(지금까지 전부 연결 문자열 붙여 넣기로 대체)
- 폰에서 **"스냅샷에서 복원" 버튼** 직접 클릭 (단위 시험으로만)
- **바이너리 충돌 선택 화면**(내 것 새 이름 / PC 것 유지 / 덮어쓰기) — 지금은 409 를 "PC에서 먼저 바뀌었어요"로 알리고 덮어쓰지 않음
- 실제 **GitHub·Drive·OneDrive 계정**으로 파일 올리기·받기·이동·삭제·교체 (계정이 필요 — 사용자가 시험용 저장소를 연결해 줘야 함)
- 자동 동기화 트리거 없음(수동 "지금 동기화"), 연결 정보는 기기당 1개, 삭제 전파·삭제 권한 없음, 휴지통에서 되살리는 화면 없음
- 호스트 폴더 스캔은 메인 프로세스에서 동기적(파일 수만 개면 멈춤 가능), Windows 에서 다른 프로그램이 파일을 잠근 경우 쓰기 재시도 없음, 주소 후보가 다 죽으면 첫 주소에서 ~8초 대기
- 창으로 폴더 고르는 대화상자 경로(공유 폴더↔호스트 폴더 겹침 거절)는 자동 시험 못 함

## 5.5 수정 필요한 항목 (알려진 버그 — 사용자가 직접 발견, 아직 고치지 않음)
1. **설정에서 AI 를 새로 등록/변경해도 열려 있는 AI 패널에 바로 반영되지 않는다.** AI 패널을 닫았다가 다시 열어야 새 모델(엔진 선택 목록·모델 이름·준비 상태)이 뜬다. *(2026-11-10 사용자 보고)*
   - 원인(코드로 확인): `src/components/AiPanel.tsx` 의 `const [local, setLocal] = useState(() => localEngine())` 는 패널이 **열릴 때만** 갱신된다(`useEffect([open, claude, vault])` 안의 `setLocal(localEngine())`). `saveLlmConfig()`(`src/lib/llm.ts`)가 설정 저장 때 `window` 에 `nosidian-llm-changed` 이벤트를 내보내지만 AI 패널은 이 이벤트를 듣지 않는다(지금은 `relayBridge.ts` 만 듣는다).
   - 고칠 방향: AI 패널(PC 도킹 패널·모바일 시트 모두)이 `nosidian-llm-changed`(필요하면 `storage`)를 구독해 `setLocal(localEngine())` 하고 `ready`/엔진 목록을 다시 계산. 같은 이유로 **`AiWizard`(설정의 "AI 연결" 카드)의 `cfg`/요약**과 폰의 PC 연결(`viaPc`) 설정 변경, `pcLink` 변경 후 `currentEngine()` 도 같은 방식으로 최신화되는지 함께 확인.
   - 시험으로 남길 것: 패널이 열린 채 `saveLlmConfig(...)` 를 호출하면 재오픈 없이 모델 이름·`ready` 가 바뀐다 / 설정 삭제(`saveLlmConfig(null)`) 시 "연결 필요" 상태로 돌아간다 / 구독 해제(언마운트)로 누수가 없다.
   - 확인 방법: PC 앱에서 AI 패널을 연 채 설정 > AI 에서 다른 모델(또는 API 키 모델)을 연결 → 패널의 엔진 선택·모델 이름이 즉시 바뀌는지.

## 6. 다음 작업 후보 (사용자가 정함 — 추천 순)
1. **v1.43 실기기 통합 검증**: PC 종료·재시작 중 동기화, 오프라인에서 폰 수정 후 재연결, 동시 수정 충돌, 삭제·복구(휴지통), 주소 변경, 장기 미접속(180일) 재연결 미리보기, 호스트 폴더를 탐색기로 직접 조작. (설계: `docs/SYNC-HOST.md` §13)
2. **바이너리 충돌 선택 화면** 만들기.
3. 폰 QR 카메라 스캔 실제 시험, 폰 "스냅샷에서 복원" 직접 시험.
4. 자동 동기화 트리거(앱 켤 때·주기), 휴지통 복구 화면, 삭제 전파(별도 권한 설계 필요).
5. 클라우드 실계정 시험(사용자가 시험용 저장소를 준비해야 함).

## 7. 실행·검증 도구 (Windows, Git Bash)
```
cd /c/Users/USER/Desktop/MD_Reader/app
npx tsc -b                 # 타입 검사
npm test                   # 전체 시험(vitest). mcpServer 시험이 가끔 포트 문제로 한 번 실패 → 재실행하면 통과(알려진 불안정)
npm run build              # 웹 번들
npm run dist               # 설치 파일(release/Nosidian-Setup-X.exe, ~125MB). 405KB 처럼 작게 나오면 실패: makensis 종료·release/Nosidian-Setup-* 삭제 후 재빌드
# Android
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"; npx cap sync android
(cd android && ./gradlew.bat assembleDebug -q)
export MSYS_NO_PATHCONV=1; ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
"$ADB" install -r android/app/build/outputs/apk/debug/app-debug.apk
# 폰 WebView 디버깅(CDP): 앱 실행 후
"$ADB" forward tcp:9444 localabstract:webview_devtools_remote_$("$ADB" shell pidof com.amsidian.app | tr -d '\r')
timeout 30 node scripts/dev/cdp-phone.cjs MAIN "<JS 식>"     # 폰
node scripts/dev/shot.cjs 9444 MAIN out.png 400 860          # 폰 스크린샷
# PC 앱 시험(격리된 프로필, 사용자 데이터와 분리)
(NOSIDIAN_PORT=47399 node_modules/.bin/electron electron/main.cjs --user-data-dir="<scratchpad>/ud_verify" --remote-debugging-port=9333 &)
timeout 30 node scripts/dev/cdp.cjs MAIN "<JS 식>"           # PC 앱, 스토어는 window.__proposals.app
node scripts/dev/shot.cjs 9333 MAIN out.png 1200 760
```
- 버전은 기능 하나 끝날 때마다 `package.json` 올림 → 설치 파일 빌드 → 폰 설치 → 문서 갱신 → 로컬 커밋.
- 변경 후 **변이 시험**(안전장치를 일부러 빼 보고 시험이 실패하는지)으로 시험이 실제로 막아 주는지 확인하는 방식을 써 왔다.

## 8. 겪은 함정 (되풀이하지 말 것)
- **긴 Bash heredoc 이 중간에 잘리거나 따옴표/백슬래시가 망가진다** → 긴 파일은 Write 도구로, 편집은 Edit 도구 또는 Write 로 만든 파이썬 스크립트 파일(`python -I 파일`)로. 한국어가 든 인라인 `python -` 치환은 불일치가 잦다.
- Git Bash 가 `/data/local/tmp` 같은 안드로이드 경로를 윈도 경로로 바꾼다 → `export MSYS_NO_PATHCONV=1`.
- 앱 확인 창은 `[role=dialog]` 가 아니라 **`form.modal`** (시험 스크립트 선택자 주의). 설정 화면의 "고급"은 카드마다 있다(올바른 카드의 `details` 를 열 것).
- 폰 WebView 의 `localStorage` 는 디스크에 **비동기**로 써진다 → 값을 넣고 바로 `am force-stop` 하면 사라진다(몇 초 기다릴 것).
- 폰 화면이 잠기면 WebView 가 멈춰 CDP 호출이 안 끝난다(백그라운드로 밀림) → 사용자에게 잠금 해제 요청.
- 안드로이드 `RemoteViews` 에 `<View>` 를 쓰면 위젯 오류. `electron` 은 `app.whenReady()` 전에 `safeStorage` 를 쓰면 안 된다(인증서 재생성 버그의 원인이었음).
- 클라우드 `connect()` 는 로컬 사본을 원격 기준으로 바꾸는 흐름이다 → 호스트 연결은 별도 흐름(`hostConnect.ts`)을 쓴다.

## 9. 첫 행동 (Claude 가 새 세션에서 할 일)
1. `cd /c/Users/USER/Desktop/MD_Reader/app && git status -sb && git log --oneline -5` 로 위 "현재 상태"가 맞는지 확인(다르면 사용자에게 알린다).
2. `npx tsc -b` 와 `npm test` 를 돌려 기준선이 725개 통과인지 확인(1회 불안정은 재실행).
3. 사용자에게 한 줄로 현재 상태를 요약하고, 위 "다음 작업 후보" 중 무엇을 할지 묻는다(추천: 1번 통합 검증과 2번 바이너리 충돌 화면).
4. 폰 시험이 필요한 작업이면 먼저 "폰 잠금을 풀어 주세요"라고 요청한다.
