# Nosidian

**메모·일정·프로젝트 업무를 한곳에서 관리하는 마크다운 노트 앱.** Obsidian 스타일의 노트(링크·백링크·그래프)에 캘린더·위젯·알림을 얹었고,
그 위에 **소규모 팀용 프로젝트 관리(내 업무·칸반·결정·타임라인)** 를 올렸다. 데이터는 전부 **일반 `.md` 파일**이며 사용자 본인의 GitHub / Google Drive / OneDrive에 동기화된다. 서버는 없다.

**한눈에 보기** — 앱을 열면 **내 업무**가 먼저 나온다: 오늘 일정 · 기한 지난 일 · 결정할 일 · 대기 중인 일 · 프로젝트 목록. 업무는 노트의 체크리스트 한 줄(`- [ ] 견적서 수정 due:2026-11-12 owner:민수`)이고, 폼(편집기)으로 만들어도 같은 한 줄이 된다.

| 플랫폼 | 셸 | 상태 |
|---|---|---|
| Windows | Electron (로컬 서버 `localhost:47321`로 `dist` 서빙) | 설치 파일(NSIS) 빌드 가능, 바탕화면 위젯 포함 |
| Android | Capacitor 8 + 네이티브(Java) 플러그인 | 디버그 APK로 실기기 검증, 홈 화면 위젯·네이티브 알림 포함 |
| 브라우저 | Vite 개발 서버 | 개발·확인용 (배포 설정 없음) |

> 이 문서는 "지금 무엇이 어떻게 되어 있는가"를 한 번에 파악하기 위한 개요다. 세부 규격은 **프로젝트·업무: [docs/WORK.md](docs/WORK.md)**, **일정·위젯: [docs/CALENDAR.md](docs/CALENDAR.md)**, **문서 규칙·점검: [docs/DOCRULES.md](docs/DOCRULES.md)**, **AI 연결: [docs/LLM.md](docs/LLM.md)**, **외부 AI(MCP): [docs/MCP.md](docs/MCP.md)**, 기획·결정 기록: [docs/phase2/](docs/phase2/).

---

## 1. 설계 원칙 (이걸 깨는 제안은 구조를 바꿔야 한다)

1. **마크다운이 유일한 진실.** 노트도, 일정도, 날짜 색상도 `.md` 안의 텍스트다. 별도 DB·전용 포맷이 없다. 앱을 지워도 파일은 남는다.
2. **로컬 우선, 서버 없음.** 모든 데이터는 기기의 IndexedDB(vault마다 하나)에 있고, 동기화는 사용자의 계정(GitHub 저장소 / Drive 폴더 / OneDrive 폴더)으로 직접 한다. 운영 비용·계정 시스템·백엔드가 없다.
3. **파생 데이터는 저장하지 않고 계산한다.** 링크 인덱스, 태그, 그래프, 캘린더(일정 목록), 날짜 색상, **프로젝트·업무 대기열·건강도·타임라인·보기 결과**는 노트에서 매번 만든다(캐시만 있음). 팀이 같이 쓰는 설정(건강도 문턱·내 타일의 조건)도 기기가 아니라 vault 안의 노트(`_workspace/`)에 둔다.
4. **UI는 단순하고 평평하게.** 흰색·검정·빨강, 2px 모서리, 얇은 선, 그림자 없음. PC(≥900px)는 3단 레이아웃, 그 미만은 하단 탭.
5. **비개발자도 쓸 수 있어야 한다.** 마크다운 문법을 몰라도 GUI로 일정을 넣을 수 있고, 결과는 사람이 읽을 수 있는 한 줄로 저장된다.

---

## 2. 기능 전체 목록

### 노트 (1차 기능)
- **읽기 뷰**: markdown-it 기반. 프론트매터 속성 패널, 콜아웃(`> [!tip]`, 접기 지원), 수식(KaTeX), 다이어그램(Mermaid), 코드 하이라이트(highlight.js), 각주, 표, 체크리스트, `==하이라이트==`, 이미지/노트 임베드(`![[노트#제목]]`).
- **에디터**: CodeMirror 6 + 라이브 프리뷰(서식이 입력 중 바로 렌더링), `[[` 노트 자동완성, `#태그` 자동완성, 서식 툴바, 실행 취소/다시 실행, 문서 안 찾기.
- **링크**: `[[노트]]`, `[[노트|별칭]]`, `[[노트#제목]]`, 앵커 이동, 없는 노트 링크(눌러서 생성), 이름 변경 시 다른 노트의 링크 자동 갱신.
- **백링크 / 링크되지 않은 언급 / 목차**: 우측 패널(PC) 또는 시트(모바일).
- **그래프**: d3-force. 전체/로컬(깊이 조절), 고립 노트 표시, 이름 필터, 폴더별 색. 노트 우측 패널의 "로컬 그래프 → 크게 보기"와 명령 팔레트에서 연다(최상위 탭이 아님).
- **검색**: 전체 본문 검색, 연산자 `tag:` `path:` `file:`, 태그 목록, 스니펫·하이라이트.
- **파일 관리**: 폴더 트리, 북마크(★), 최근 연 노트, 이름 변경, 삭제, 컨텍스트 메뉴, 노트 링크 복사. 새 노트/폴더는 "이름 + 저장할 폴더(선택 상자)" 대화창으로 만든다.
- **Daily 노트**: `Daily/YYYY-MM-DD.md`(폴더는 설정에서 변경). 오늘의 노트 열기.
- **명령 팔레트·단축키**: `Ctrl+O` 노트 전환, `Ctrl+P` 명령, `Ctrl+E` 읽기/편집, `Ctrl+F` 문서 찾기, `Ctrl+Shift+F` 검색, `Ctrl+S` 동기화, `Alt+←/→` 이동 기록.
- **외부 파일 열기**: 탐색기/파일 관리자에서 `.md`를 "연결 프로그램"으로 열기, 공유(Android), 드래그. vault 밖 문서는 열람·저장 가능하고 "가져오기"를 누르면 vault에 사본이 생긴다. 파일/폴더 가져오기도 지원.
- **다중 vault**: vault마다 별도 IndexedDB + 별도 동기화 연결 + 별도 북마크/최근. 전환·추가·이름 변경·삭제.
- **동기화**: GitHub(PAT) · Google Drive(OAuth) · OneDrive(OAuth). 이미지는 필요할 때 받아 캐시. 충돌은 노트마다 "내 것 / 원격 것 / 둘 다(원격은 별도 노트로)"를 고른다.
- **테마·글자 크기·언어**: 라이트/다크/시스템, 14–24px, 한국어·English·中文·日本語·Français·Español(시스템 언어 자동).
- **예제 vault**: 첫 화면의 "예제 노트로 둘러보기"로 일상 소재(여행 준비) 노트와 오늘 기준 일정 노트를 만든다.

### 프로젝트·업무 — 내 업무 (Phase 2, 앱의 시작 화면) — 자세한 규격은 docs/WORK.md
- **프로젝트** = 프론트매터 `type: project` 노트. **업무** = 체크리스트 한 줄 + 꼬리표 `due:` `owner:` `p:` `status:` `side:` `kind:` `proj:` `=> 결론`(체크박스는 표준 `[ ]`/`[x]`만 — 다른 마크다운 도구에서도 그냥 읽힌다).
- **내 업무 화면**(시작 화면): 프로젝트를 가로질러 *기한이 지난 일 · 결정할 일 · 오늘 마감 · 이번 주 · 대기 중인 일 · 진행 중 · 담당자 없는 일 · 정리할 업무*를 모으고, 각 줄 오른쪽에 *왜 여기 있는지*를 표시한다. 설정의 "내 이름"으로 내 담당만 모아 본다. 화면은 **타일**의 모음이라(내 업무 화면이 넓으면 — 대략 980px 이상, PC — 타일이 **2열**로 놓이고 좁으면 한 줄) "화면 편집"에서 타일을 한 줄씩 늘어놓은 목록의 오른쪽 손잡이를 끌어(터치는 꾹 눌러) 순서를 바꾸고, 스위치로 숨기고, 줄 수를 정하며, 조건(담당·프로젝트·상태·마감·글)으로 **내 타일**을 만들 수 있다.
- **업무 편집기(GUI)**: 상태·마감·담당·우선순위·프로젝트·결정 여부를 폼으로 고르면 한 줄로 저장. 그 줄만 고치고(들여쓰기·일정 꼬리표 보존) 줄 번호가 밀려도 제목으로 찾는다. 새 업무는 프로젝트의 "할 일" 노트나 "받은 업무" 노트에 모인다.
- **프로젝트 허브**: 할 일 · **보드(칸반, 카드를 옮기면 `status` 가 바뀜)** · 문서 · **타임라인**(마감·업무·결정·일정을 날짜순으로). 머리글에 사람이 적은 판단(`health:`)과 시스템 **점검**(기한 지난 일·확인일 지난 결정·늦은 대기·담당자 없는 일)을 따로 보여 준다.
- **새 프로젝트 마법사**: 템플릿(내장 일반·행사·콘텐츠 + **내 템플릿**)에서 폴더와 문서를 만들고, 마감일에서 거꾸로 준비 일정 날짜를 채운다. 허브의 "템플릿으로 저장"으로 내 프로젝트를 틀로 만들 수 있고(vault 의 `Templates/`), 손으로 만들어도 된다.
- **결정·미결**: `kind:decision` 안건은 **결론 한 줄 없이는 닫히지 않는다**(편집기가 잠기고, 다른 화면에서의 체크도 거절).
- **받은 업무 정리**: 프로젝트 없이 적은 업무를 프로젝트의 할 일 노트로 옮긴다(줄이 이동).
- 저장하는 데이터는 새로 없고 모두 노트에서 매번 계산한다(파생).

### 일정 관리 (2차 기능) — 자세한 규격은 docs/CALENDAR.md
- **일정 = 노트의 한 줄**: Daily 노트의 `- [ ] 14:00-15:00 치과`, 다른 노트의 `- [ ] 보고서 @2026-11-20`, 또는 프론트매터 `date`.
- **문서 규칙·점검**(선택, 기본 꺼짐): vault 의 `_workspace/문서규칙.md` 에 프로젝트 문서의 역할(개요·정책·할 일 …)과 필수 제목·상태 값을 사람이 읽는 줄로 정해 두면, 프로젝트 허브의 **"문서 점검"** 탭이 역할 충돌·필수 제목 누락·끊어진 링크·고아·개요에서 닿지 않는 문서·중복 후보를 알려 준다. 알려 주기만 하고 노트를 고치거나 저장을 막지 않는다. 규칙을 적용한 프로젝트의 "문서" 탭은 먼저 읽어야 할 공식 문서를 앞세워 보여 준다(Human View). 같은 규칙으로 AI 쓰기를 판정하는 정책 엔진(`lib/docpolicy.ts`: allow / require_approval / deny, 이동·이름 바꾸기·보호 경로·버전 검사·승인 후 재검증)까지 있고, 아직 어떤 AI(MCP·LLM)에도 연결하지 않았다. 정책이 "승인 대기"로 돌린 AI 변경은 내 업무의 "검토" 화면에서 전후 차이를 보고 승인·거절하며, 승인할 때 반영 직전에 한 번 더 검증한다(문서가 그새 바뀌었으면 반영하지 않음). 규격은 [docs/DOCRULES.md](docs/DOCRULES.md).
- **외부 AI 연결 — MCP 서버**(PC, 설정, 기본 꺼짐): Claude Code·Codex 같은 에이전트가 127.0.0.1 로 접속해(토큰 필수) 연결해 준 **vault 하나만** 검색·읽기하고(`search_notes`·`read_note`·`list_projects`·`get_document_rules`), 변경은 `propose_change` 로 **제안만** 낸다. 노트를 직접 쓰는 길은 없고 문서 규칙(정책 엔진)과 "AI 변경 제안" 승인을 거친다. 규격 [docs/MCP.md](docs/MCP.md).
- **AI 연결**(설정, 기본 꺼짐): 제공자(Ollama · OpenAI 호환 · OpenAI · Anthropic · Gemini)와 서버 주소·모델·키를 이 기기에 저장하고 연결을 시험한다. PC 는 메인 프로세스, Android 는 네이티브 HTTP 가 대신 보내고, http 는 사설망·내 기기만 허용한다. API 키는 PC 에서는 운영체제 보안 저장소(DPAPI)로 암호화해 메인 프로세스에서만 쓰고(화면은 못 읽음), Android 는 아직 평문이다. 앱 안에서 이 연결을 부르는 기능은 아직 없다. 규격은 [docs/LLM.md](docs/LLM.md).
- **캘린더**: 월간 / 주간 / 목록. 헤더는 `‹ 연월 ›` 다음에 `오늘` 버튼, 오른쪽에 보기 전환. 모바일은 월간(격자+선택한 날)·주간(7일 세로)·목록이 각각 다른 화면. 오늘 일정은 시작 화면 "내 업무"에도 나온다.
- **일정 편집기(GUI)**: 제목, 날짜, 종일/시작·종료 시각, 며칠에 걸친 일정, 반복(매일/평일/매주+요일 선택/매월/매년, 종료일), 한 문장 요약, 수정·삭제.
- **빠른 입력(자연어)**: "내일 3시 치과", "금요일 19:00-20:30 저녁", "매주 금요일 7시 스터디", "11월 20일 보고서".
- **공휴일·음력**: 외부 데이터 없이 계산(설날·추석·부처님오신날, 대체공휴일 일반 규칙). 날짜별 색상.
- **알림**: PC는 앱/위젯이 열려 있는 동안, Android는 앱이 꺼져 있어도(AlarmManager).

### 위젯 (3·4차 기능)
- **Windows 바탕화면 위젯**: Electron 별도 창을 바탕화면 창(Progman)의 자식으로 붙여 아이콘 위·일반 창 아래에 둔다. 기본은 **화면을 크게 채우는 반투명 월간 달력**(배경화면이 비치고 일정 글자가 칸마다 전부 보임)이며, 칸을 누르면 칸 옆에 **포스트잇 메모창**(한글 입력이 되도록 별도의 일반 창)이 떠서 한 줄에 일정 하나씩 적어 바로 수정한다. 월간/오늘/목록 보기, 이동·가로세로 크기 조절(끄는 동안은 흐리게 고정했다가 끝나면 한 번에 그림), 트레이 아이콘, 로그인 시 위젯만 시작. 본 창과 같은 DB를 공유하며 실시간 동기화.
- **Android 홈 화면 위젯**: 월간 달력(`‹ 연월 ›` 양옆 달 넘기기, 오른쪽에 `오늘`; 칸마다 일정 제목 1개 이상 + 넘치면 `+N`, 공휴일 이름, 위젯 크기에 맞춰 줄 수·글자 수 조정) + 일정 목록(30일). 누르면 앱의 해당 날짜로, 목록 위젯의 `+`는 일정 입력으로.

---

## 3. 화면 구성

```
PC (≥900px)                                          모바일 (<900px)
┌레일┬─ 왼쪽 사이드바 ─┬──── 본문 ────┬─ 오른쪽 ─┐       ┌──────────────┐
│내업│ 파일 트리 /      │ 내 업무        │ 백링크   │       │     본문      │
│캘린│ 검색 /           │ 캘린더(월·주·목)│ 목차    │       ├──────────────┤
│메모│ 다가오는 일정    │ 노트(읽기·편집)│ 로컬그래프│       │내업무 캘린더 메모 검색 설정│
│검색│                  │ 설정 / 그래프  │ 선택한 날 │       └──────────────┘
│설정│
└───┴─────────────────┴──────────────┴─────────┘
```
탭 = `note | files | search | graph | settings | calendar | today | work | project` (`src/lib/app.ts`의 `Tab`). 시작 화면은 `work`(내 업무, `homeTab()`), `project` 는 프로젝트 허브(레일/탭은 "내 업무"가 활성). 모바일 하단 탭은 내 업무 · 캘린더 · 메모 · 검색 · 설정. 선택 목록은 PC에서는 팝오버, 모바일에서는 아래에서 올라오는 시트로 뜬다(`Select`).

---

## 4. 아키텍처

```
┌────────────────────────── 렌더러 (React 19 + TypeScript) ──────────────────────────┐
│ components/  Calendar · EventEditor · NoteView · Editor · Reader · Graph · Search … │
│                         │ zustand 구독                                              │
│ lib/app.ts  ── 단일 스토어(상태 + 액션 + 동기화) ──┐                                 │
│                         │                         ├─ lib/calendar.ts  (일정 파생)    │
│ lib/links.ts (링크·태그 인덱스)                    ├─ lib/holidays.ts  (공휴일·음력)  │
│ lib/markdown.ts (렌더)  lib/livepreview.ts (에디터) └─ lib/reminders.ts · nativeCal.ts │
│                         │                                                           │
│ lib/db.ts  ── IndexedDB (vault마다 1개: files / assets) + BroadcastChannel          │
│ lib/sync/  ── Provider 인터페이스: github · gdrive · onedrive                        │
└──────────┬──────────────────────────────┬───────────────────────────┬───────────────┘
           │ Electron (electron/)          │ Capacitor (android/)      │ 원격(사용자 계정)
           │  main.cjs 서버·창·IPC          │  OpenFilePlugin           │  GitHub 저장소
           │  widget.cjs 위젯 창·트레이     │  CalendarBridgePlugin     │  Google Drive 폴더
           │  desktopLayer.cjs (koffi)      │  Month/Agenda 위젯·알림   │  OneDrive 폴더
           │  preload.cjs (contextBridge)   │  SharedPreferences        │
```

### 데이터 흐름 (한 번 이해하면 거의 전부 설명된다)
1. 사용자가 노트를 고치면 `setContent` → 메모리(`files`) 즉시 반영 → 400ms 디바운스로 IndexedDB 저장, `dirty=true`.
2. 메모리 상태가 바뀌면 파생 데이터가 다시 계산된다: 링크 인덱스(`buildIndex`, 짧은 지연 후), 캘린더(`buildCalendar`, 파일 내용이 같으면 파싱 캐시 재사용).
3. 동기화(`sync`): 원격 목록을 받아 새/변경 파일만 내려받고(6개 병렬), `dirty` 파일을 한 번에 올린다(GitHub는 트리 API로 커밋 1개, 메시지 `Nosidian: sync N notes`). 로컬이 수정 중인데 원격도 바뀌면 **줄 단위로 자동 병합**을 시도한다(고친 줄이 겹치지 않으면 합쳐서 올림). 같은 줄을 서로 다르게 고쳤을 때만 `conflict`에 원격본을 보관하고 사용자가 해결한다(다른 곳 보기 포함). 올리는 사이 원격이 먼저 바뀌면(409/422) 한 번은 자동으로 다시 받아 합친다. 병합 기준은 노트를 처음 고칠 때의 내용(`NoteFile.base`, 고치는 중일 때만 보관).
4. **창 간(PC)**: 위젯 창과 본 창은 같은 origin이라 같은 IndexedDB를 쓴다. 쓴 쪽이 `BroadcastChannel`로 알리면 받은 쪽이 DB를 다시 읽어 합친다(저장 대기 중인 자기 편집은 덮어쓰지 않음). 동기화는 본 창만.
5. **네이티브(Android)**: 노트 변경 후 1.2초 뒤(백그라운드 진입 시 즉시) 지난 35일~앞으로 120일의 일정 스냅샷과 알림 목록을 `CalendarBridge.setSnapshot`으로 넘긴다 → SharedPreferences 저장 → 위젯 갱신 + AlarmManager 재등록. 위젯은 이 스냅샷만 읽으므로 앱이 꺼져 있어도 그려진다.

### 핵심 데이터 모델
```ts
NoteFile { path, content, sha | null, dirty, deleted?, mtime, conflict?: { sha, content }, base? }
VaultMeta { id, name, remote: GitHub | GDrive | OneDrive | null, bookmarks, recent, lastSync }
Settings  { theme, fontSize, dailyFolder, startMode, lang, leftOpen, rightOpen,
            calHolidays, calLunar, remindMin, vaults[], activeVault, ... }   // localStorage('amsidian.settings')
CalEvent  { date, start?, end?, title, done, kind: 'task'|'note', path, line,
            span?, repeat?, repeatDays?, until?, inst?, cont?, origDate? }    // 노트에서 파생, 저장 안 함
Task      { id, path, line, title, done, state: todo|doing|waiting|dropped, due?, owner[], p?,
            side?, kind?: 'decision', conclusion?, project }                  // 체크리스트 한 줄에서 파생
Project   { path, name, folder, status?, owner[], due?, health? }              // type: project 노트에서 파생
```
삭제는 `deleted` 표식(tombstone) 후 다음 동기화에서 원격 삭제. 이름 변경은 "원본 삭제 + 새 경로 생성"이며 다른 노트의 `[[링크]]`도 같이 고친다.

### 일정 문법 요약
| 용도 | 예 |
|---|---|
| 시간 일정 | `- [ ] 14:00-15:00 치과` (Daily 노트 안) |
| 다른 노트에서 날짜 지정 | `- [ ] 보고서 @2026-11-20` |
| 며칠에 걸침 | `- [ ] 부산 출장 end:2026-11-12` |
| 반복 | `repeat:weekly` · `repeat:weekly:mon,wed,fri` · `until:2026-12-31` |
| 프론트매터 일정 | `date:`, `end:`, `time:`, `title:`, `color:`, `repeat:`, `until:` |
| 날짜 색상 | Daily 노트 프론트매터 `color: "#d01010"` |
| 업무 | `- [ ] 견적서 수정 due:2026-11-12 owner:민수 p:1` (프로젝트에 속하거나 꼬리표가 있으면 업무) |
| 대기(상대 차례) | `- [ ] 확인 요청 status:waiting side:other due:2026-11-14` |
| 결정 안건 | `- [ ] 장소 정하기 kind:decision due:2026-11-12` → 닫을 땐 `- [x] … => 결론` |
| 프로젝트 | 노트 프론트매터 `type: project` (`status` `owner` `due` `health` `title`) |

---

## 5. 코드 지도

```
app/
├─ src/
│  ├─ App.tsx                 레이아웃(PC/모바일 분기), 단축키, 안드로이드 뒤로가기, 딥링크
│  ├─ lib/
│  │  ├─ app.ts               ★ 단일 zustand 스토어: 탭/노트/vault/설정/동기화 (≈800줄)
│  │  ├─ db.ts                IndexedDB(idb) + 창 간 BroadcastChannel
│  │  ├─ links.ts             프론트매터·링크·태그·제목 파싱, 링크 인덱스
│  │  ├─ markdown.ts          markdown-it 확장(위키링크·임베드·콜아웃·수식·mermaid)
│  │  ├─ livepreview.ts       CodeMirror 라이브 프리뷰 확장
│  │  ├─ findEngine.ts        문서 안 찾기(읽기/편집 공용)
│  │  ├─ calendar.ts          ★ 일정 파서/펼치기/쓰기/수정/삭제, 자연어 파서, 캘린더 화면 상태
│  │  ├─ taskTokens.ts        업무 꼬리표(due·owner·p·status·side·kind·proj·결론) 읽기/쓰기
│  │  ├─ work.ts              ★ 프로젝트·업무 인덱스, 대기열, 한 줄 다시 쓰기 (순수 함수, 내용 해시 캐시)
│  │  ├─ workOps.ts           노트에 쓰는 업무 연산(추가·수정·삭제·이동·보기 저장) + 화면 상태
│  │  ├─ merge.ts             줄 단위 3자 병합(동기화에서 같은 노트를 둘이 고쳤을 때)
│  │  ├─ health.ts · timeline.ts · views.ts · tiles.ts · projectTemplates.ts · docrules.ts · doclint.ts · docpolicy.ts   건강도·타임라인·타일 조건·타일 배치·템플릿·문서 규칙·문서 점검·AI 쓰기 정책 (순수 함수)
│  │  ├─ holidays.ts          공휴일·음력(Intl 중국력)
│  │  ├─ reminders.ts         PC 알림(Web Locks로 한 창만)
│  │  ├─ nativeCal.ts         Android 브리지(스냅샷·알림 목록 생성)
│  │  ├─ sync/                Provider 인터페이스 + github/gdrive/onedrive + oauth(PKCE)
│  │  ├─ importFiles.ts · externalIO.ts   파일 가져오기·외부 문서·데스크톱 브리지 타입
│  │  ├─ demo*.ts             예제 vault (한/영) + 일정 체험 노트
│  │  ├─ i18n.ts · locales/   한국어 문장이 곧 키. en/zh/ja/fr/es
│  │  └─ types.ts · dialog.ts · tx.tsx · noteActions.ts
│  ├─ components/             Calendar, EventEditor, Widget, NoteView, Editor, Reader, Graph,
│  │                          Search, FileTree, InfoPanel, Palette, FindBar, Settings, Onboarding, VaultSheet, Dialogs …
│  │                          WorkHome(내 업무) · ProjectHub · TaskEditor · NewProject · ViewEditor · NewNote · Select
│  └─ lib/*.test.ts · test/   vitest 테스트 20개 파일(업무·건강도·타임라인·타일·보기·템플릿·일정 공존·예제 vault)
├─ electron/                  main.cjs(서버·창·IPC) · widget.cjs · desktopLayer.cjs · preload.cjs
├─ android/app/src/main/java/com/amsidian/app/
│                             MainActivity · OpenFilePlugin · CalendarBridgePlugin · CalStore · Links
│                             MonthWidgetProvider · AgendaWidgetProvider · Reminders
├─ docs/WORK.md               프로젝트·업무 규격(문법·화면·결정·건강도·타임라인·보기)과 구현·검증
├─ docs/MCP.md                외부 AI 연결(MCP 서버)
├─ docs/LLM.md                AI 연결(제공자·전송·안전 규칙)
├─ docs/DOCRULES.md           문서 규칙·점검·AI 쓰기 정책 규격
├─ docs/CALENDAR.md           일정·위젯 규격, PC/Android 위젯 구현 세부, 시도했다 버린 방식
├─ docs/phase2/               Phase 2 기획 입력(Codex 제안)과 구현 계획·결정 기록
└─ deploy.sh                  빌드 → APK → 폰 설치 → 실행 → 스크린샷 (개발 편의)
```
규모: TypeScript/CJS 약 1만 줄(번역·테스트 제외), 의존성은 React · zustand · CodeMirror 6 · markdown-it · KaTeX · Mermaid · d3-force · idb · js-yaml · Capacitor · Electron · koffi.

---

## 6. 개발 · 빌드

```
npm run dev                         브라우저 개발 (http://127.0.0.1:5173)
npm run desktop                     Electron 개발 실행
npm run dist                        Windows 설치 파일 (release/)
npm run build && npx cap sync android
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr     # JDK 21 + jlink 필요 (IntelliJ JBR은 jlink 없음)
cd android && gradlew.bat assembleDebug                        # → android/app/build/outputs/apk/debug/app-debug.apk
```
- **GitHub 연결**: Fine-grained PAT(대상 저장소 1개, Contents: Read and write)를 첫 화면에 입력. 저장소에 커밋이 1개 이상 있어야 한다.
- **Google Drive / OneDrive**: 사용자가 OAuth 클라이언트 ID를 직접 넣는다(앱이 공용 ID를 제공하지 않음).
- 린트 `npm run lint`(oxlint), 타입체크 `npx tsc -b`, **테스트 `npm test`**(vitest + jsdom + fake-indexeddb, 247개: 문서 규칙·점검·AI 정책·변경 제안·LLM 연결·MCP, 업무 문법·대기열·노트에 쓰는 연산·건강도·타임라인·타일·보기·템플릿). 화면은 실제 앱(Electron 시험 인스턴스·Android 실기기)에서 CDP 스크립트와 스크린샷으로 확인한다. 캘린더·위젯·동기화·에디터에는 자동화 테스트가 거의 없다.
- 저장 위치 이름은 옛 이름 그대로 `Amsidian`/`amsidian`(IndexedDB, Electron userData, localStorage 키). 바꾸면 기존 사용자의 데이터가 사라진 것처럼 보이므로 유지한다.

---

## 7. 알려진 한계 · 기술 부채

**제품**
- 데스크톱 위젯은 진짜 투명 창이 아니다(바탕화면 레이어에서는 투명 창을 쓸 수 없음). 배경화면 이미지를 창 뒤에 맞춰 그려서 투명해 보이게 하며(위치는 화면 캡처로 실측), 배경 채우기 방식·모니터별 배경화면에 제약이 있다(docs/CALENDAR.md).
- 일정은 노트 안의 한 줄이라 **"이 반복 중 하루만 수정/삭제"(예외 처리)가 없다**. 반복·기간 일정은 시리즈 전체를 바꾼다. 기간+반복 동시 사용 불가.
- 외부 캘린더(Google/Outlook/ICS) 연동 없음. 참석자·초대·시간대 개념 없음.
- 공휴일은 임시공휴일·선거일 미포함. 음력은 1·15일에만 표시.
- 알림: PC는 앱/위젯이 열려 있어야 울린다. Android는 정확 알람이 아니라 절전 모드에서 몇 분 늦을 수 있다. Android 위젯은 읽기+열기 전용이며(RemoteViews 는 `View` 를 쓸 수 없다 — 넣으면 "위젯을 추가할 수 없습니다" 오류), 클라우드로 들어온 변경은 앱을 한 번 열어야 위젯에 반영된다.
- 번역은 노트 기능까지 6개 언어, 캘린더·위젯·업무(내 업무 등) 문구는 한국어/영어만.
- **프로젝트 관리는 소규모 팀 전제**: `owner:` 는 문자열일 뿐 인증이 아니고, 권한·승인·감사가 없다. 같은 노트를 두 사람이 동시에 고치면 파일 단위 충돌이 난다(회의·받은 업무를 사람/회의별 노트로 나누도록 유도). 조직용 서버는 별도 결정(docs/phase2).
- 프로젝트 관리의 알려진 빈 곳(동시 편집은 위 줄 병합으로 줄었음): "며칠째 멈춘 일" 같은 활동 기반 지표와 변경 이력 타임라인은 만들지 않음(변경 시각을 믿을 수 없음), 칸반 끌어놓기는 PC 마우스로만(모바일은 ‹ › 버튼), 업무·프로젝트 화면은 한국어/영어만.
- 동기화는 파일 단위 전송이고, 같은 노트를 동시에 고쳤을 때는 **줄 단위 3자 병합**(`lib/merge.ts`)으로 겹치지 않는 수정을 자동으로 합친다. 같은 줄을 서로 다르게 고치거나 한쪽이 지운 줄을 다른 쪽이 고치면 수동 해결(내 것/원격 것/둘 다)이며, 문단 이동 감지·글자 단위 병합은 없다. 이 병합은 **기준(base)이 있는 노트**(이 기능이 들어간 뒤 고친 노트)에만 적용된다. 암호화·E2E 없음(원격 서비스가 평문 `.md`를 본다). 매우 큰 저장소는 일부만 가져온다(GitHub 트리 truncated).

**코드**
- `lib/app.ts`가 상태·동기화·vault·설정을 한 파일에 모두 담고 있다(분리 후보).
- 캘린더는 `files`가 바뀔 때마다 전체 일정 맵을 다시 만든다(내용 캐시로 완화). 노트가 수천 개면 측정이 필요하다.
- CI 없음(테스트는 로컬 `npm test`). 소스는 GitHub 저장소 `movemin03/nosidian` 에서 관리한다(사내 백오피스 참고 문서는 `.gitignore` 로 제외).
- Android는 디버그 빌드만 검증(릴리스 서명·재부팅 후 알람 재등록 미검증). Windows 바탕화면 위젯은 Win11 24H2에서만 검증.

---

## 8. 개선 아이디어 회의용: 열린 질문

회의에서 다룰 만한 축과, 각 축에서 **구조적으로 이미 정해진 제약**을 함께 적는다.

1. **일정 모델**: 반복 예외("이번 주만 취소"), 알림 시각 사용자 지정(일정별), 할 일(마감일/우선순위) 분리, 일정에 색/카테고리. *제약: 저장은 사람이 읽는 마크다운 한 줄을 유지해야 한다(원칙 1).*
2. **외부 연동**: ICS 가져오기/내보내기, Google Calendar·Outlook 읽기 전용 구독, 안드로이드 기본 캘린더 공유. *제약: 서버가 없다(원칙 2) — 클라이언트 OAuth만 가능.*
3. **동기화·협업**: 문단/글자 단위 병합, 공유 vault(여러 사람) 운영 가이드, 동기화 주기·백그라운드 동기화(특히 Android 위젯 최신성), 선택적 암호화.
4. **지식 관리 쪽 확장**: 템플릿, 주간/월간 리뷰 자동 생성, 태그·속성 기반 쿼리(Dataview 유사), 캘린더와 노트 링크의 결합(그날 만든/수정한 노트 보기), 할 일 모아보기.
5. **위젯·알림**: iOS 지원 여부(현재 없음), Android 위젯 상호작용(체크 토글), 위젯 크기별 레이아웃, 투명 위젯(Windows) 대안, 정확 알람 권한 도입 여부.
6. **온보딩·비개발자 UX**: 첫 실행 시 예제 자동 생성 여부, 동기화 연결 마법사(Drive/OneDrive 클라이언트 ID 입력이 가장 큰 허들), GitHub PAT 발급 가이드, 마크다운 모름 사용자를 위한 서식 UI.
7. **품질·운영**: 자동화 테스트 도입 범위, 성능 측정(노트 수천 개), 앱 스토어 배포(Android 서명·Play 정책, Windows 서명), 크래시/오류 수집(서버 없이 가능한 방법), 접근성.
8. **프로젝트 관리 확장(Phase 2 이후)**: 회의록 안의 안건 문법, 줄 단위 병합과 충돌 UX, 팀 공유 vault 운영 가이드, 프로젝트 팩(고객·계약·비용·리소스), 조직용 서버(권한·승인·감사). *제약: 서버 없음(원칙 2), 파생은 저장하지 않음(원칙 3), 체크박스는 표준만(호환성).*
9. **차별화 포지션**: 이 앱의 핵심 차별점은 "일정이 노트의 일부(날짜 칸 = 노트)이고 파일이 열려 있다"는 점이다. 이것을 강화할지, 일반 캘린더 앱과의 기능 격차를 메울지.

### 회의 전에 AI에게 같이 주면 좋은 정보
- 이 README + `docs/WORK.md`(프로젝트·업무) + `docs/CALENDAR.md`(일정·위젯)
- 타깃 사용자(현재 가정: 한국어 사용 개인, 메모+일정을 한 앱에서 쓰고 싶은 사람, 비개발자 포함)
- 비용 제약(현재 운영비 0원: 서버·유료 API 없음)
- 디자인 원칙(흑백+빨강, 평평한 UI) — Figma 디자인 시스템 파일 "Nosidian Design System"이 있다(Starter 플랜, 변수·컴포넌트 일부 구축).
