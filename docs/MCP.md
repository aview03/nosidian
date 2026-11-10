# 외부 AI 연결 (MCP 서버)

Claude Code·Codex 같은 **외부 AI 에이전트**가 Nosidian 의 노트를 찾고 읽고 **변경안을 제출**하게 하는 통로다. PC(Electron) 전용이고 **기본은 꺼짐**이다. 핵심 원칙은 하나 — *외부 AI 에게는 노트를 직접 쓰는 길이 없다.* 모든 변경은 기존 정책 엔진([DOCRULES.md](DOCRULES.md))과 제안·승인 흐름을 거친다.

## 구조
```
외부 AI ──HTTP(JSON-RPC)──▶ electron/mcp.cjs (127.0.0.1, 토큰)        [메인 프로세스: 문서 데이터 없음]
 (또는 stdio ▶ mcp-stdio.cjs)        │ mcp:call (IPC)
                                     ▼
                    src/lib/mcpBridge.ts → mcpTools.ts               [렌더러: 데이터가 있는 곳]
                       ├ vault 범위 확인(연결된 vault 만)
                       ├ 읽기: 검색·읽기·프로젝트·규칙
                       └ propose_change → proposalStore.submit → 정책 엔진(triage)
                                           ├ allow            → 바로 반영
                                           ├ require_approval → "AI 변경 제안"에 보관 → 사람이 승인 → 반영 직전 재검증
                                           └ deny             → 거절
```
- 문서(IndexedDB)는 렌더러에만 있어서 메인 프로세스는 호출을 **중계**만 한다(`mcp:call` → `mcp:reply`). `electron/mcp.cjs`·`mcpHost.cjs` 에는 노트를 읽거나 쓰는 코드가 없다.
- 본 창이 닫혀 있으면 호출은 "Nosidian 창이 닫혀 있어요" 오류가 된다(앱이 켜져 있어야 한다). 외부 요청이 창을 띄우지는 않는다.
- Android 는 지원하지 않는다(앱 안에서 외부 프로세스가 접속할 서버를 열 수 없다).

## 켜는 법 (설정 > 외부 AI 연결 (MCP))
1. **MCP 서버 켜기** — `http://127.0.0.1:47322/mcp`(포트가 쓰이는 중이면 빈 포트, 화면에 표시).
2. **열어 줄 vault 고르기** — 기본은 "없음". 고르기 전에는 외부 AI 가 아무 노트도 볼 수 없다.
3. **등록 명령 복사** — "Claude Code 등록 명령 복사"(`claude mcp add --transport http nosidian <주소> --header "Authorization: Bearer <토큰>"`) 또는 "Codex 설정 복사"(stdio 중계: `command = "node"` + `mcp-stdio.cjs` 경로 + 환경 변수 `NOSIDIAN_MCP_URL`·`NOSIDIAN_MCP_TOKEN`).
4. 토큰을 노출했다면 **토큰 새로 만들기**.

## 도구 6개
| 도구 | 하는 일 | 쓰기? |
|---|---|---|
| `search_notes` | 검색(`tag:`·`path:`·`file:` 필터 지원, 앱 검색과 같은 엔진). 경로·제목·발췌·점수 | 아니오 |
| `read_note` | 노트 내용과 `content_hash`(수정·삭제·이동 제안에 `base_hash` 로 되돌려 줘야 함). 큰 노트는 20만 자에서 잘라 `truncated` 표시 | 아니오 |
| `list_projects` | 프로젝트(`type: project`)와 문서 규칙 적용 프로필 | 아니오 |
| `get_document_rules` | 규칙 켜짐 여부·`ai_write`·`ai_new_file`·프로필의 역할·허용 status·보호 경로 | 아니오 |
| `propose_change` | `create`·`modify`·`delete`·`move` 변경안 제출. 결과: `applied` / `pending_approval`(+`proposal_id`) / `denied`(+`reason`·`hint`) | **정책을 거쳐서만** |
| `get_proposal_status` | 제안의 `pending` / `applied` / `rejected` / `failed` | 아니오 |

- `modify` 는 **전체 새 내용**(`content`)과 `base_hash` 가 필요하다. 읽은 뒤 사람이 고쳤으면 `stale` 로 거절되고, 다시 읽어 최신 내용에서 다시 제안하라는 `hint` 가 붙는다.
- 삭제는 지우지 않고 `_보관/` 으로 옮긴다(`archived: true`). `_workspace/`(규칙 노트 포함)는 읽을 수는 있어도(`protected: true` 표시) 어떤 경우에도 바꿀 수 없다.
- 규칙이 꺼져 있거나 규칙을 적용하지 않는 곳이면 **모든 변경이 승인 대기**다(기본값은 안전하게).
- 제안자 이름은 `MCP · <클라이언트 이름>` 으로 "AI 변경 제안" 화면에 보인다.

## 안전 규칙
- **127.0.0.1 에만** 열린다. **Bearer 토큰**(48자 16진, 사용자 데이터 폴더에 `mcp.json` 으로 저장) 없으면 401. 토큰 비교는 상수 시간.
- **Origin 헤더가 있는 요청은 거절**(브라우저의 웹페이지가 보낸 요청 차단), **Host 가 `127.0.0.1:<포트>`·`localhost:<포트>` 가 아니면 거절**(DNS 리바인딩). CORS 헤더는 주지 않는다.
- 요청 본문 1MB 상한, 도구 호출 30초 시간 제한(렌더러 응답 25초).
- **vault 범위**: 설정에서 고른 vault 가 지금 열려 있는 vault 와 같을 때만 모든 도구가 동작한다. 다르거나 고르지 않았으면 모든 도구가 오류. 다른 vault 에 자동으로 닿지 않는다(vault 를 바꾸면 연결도 거절된다).
- 쓰기 경로는 `propose_change` 하나뿐이고 정책 엔진을 우회하지 않는다. 도구 이름에 `write`·`update`·`delete`·`create` 류가 없는지 테스트가 확인한다.
- 토큰을 아는 프로그램은 연결된 vault 를 **읽을 수 있다** — 화면에도 경고가 있다. 읽은 내용은 그 에이전트(와 그 모델 제공자)에게 전달된다.

## 시험 상태
- 단위·통신 테스트(`mcpTools.test.ts` 22개 · `mcpServer.test.ts` 13개): 도구 동작, vault 범위, 토큰·Origin·Host 거절, 프로토콜(initialize·세션·tools/list·tools/call·알림·오류·시간 초과).
- Electron 실제 실행에서 별도 Node 프로세스(에이전트 흉내)로: 토큰 없음 401·Origin 403, 읽기 도구 5종, `propose_change` 4가지 결과, **앱에서 승인 → `get_proposal_status` 가 `applied` → 노트에 실제 반영**, 다른 vault·연결 없음 거절, stdio 중계(`mcp-stdio.cjs`)와 잘못된 토큰 오류.
- **실제 Claude Code 로 확인**(`claude -p --mcp-config … --strict-mcp-config`): 규칙 확인 → 검색 → 읽기 → `propose_change` → `pending_approval`, 제안자 `MCP · claude-code`. 등록 명령(`claude mcp add`)은 개인 설정을 건드리므로 실행해 보지 않았다. **Codex 는 설치되어 있지 않아 시험하지 못했다.**

## 아직 없는 것
- 제안의 기기 간 동기화(PC 에서 받은 제안을 폰에서 승인) — 지금 제안은 기기별 localStorage.
- 도구 호출 기록(누가 언제 무엇을 읽었는지), 읽기 도구의 경로별 허용 범위(지금은 vault 전체).
- 여러 vault 동시 연결, 클라이언트별 토큰·권한.
- `resources`·`prompts`·스트리밍 알림(도구만 제공).

## 앱 안 AI — Claude Code CLI (v1.24.0)

API 키 없이, PC 에 설치된 **Claude Code CLI(`claude`)** 를 별도 프로세스로 띄워 앱 안에서 질문·요약·변경 제안을 받는다. 로그인된 Claude 계정(구독)으로 동작한다. PC 전용, **사용자가 누를 때만** 실행한다(수동 모드).

### 흐름
```
내 업무 [✦ AI 에게 묻기] ─ 질문 ─▶ electron/claudeCli.cjs ──spawn──▶ claude -p (stdin 으로 질문)
                                      │  임시 MCP 서버(실행 한 번 동안만, 무작위 포트·토큰, 열려 있는 vault 하나)
                                      ▼                         ▲ search_notes / read_note / propose_change …
                            mcpHost.startInternal ──▶ 렌더러 mcpTools ──▶ 정책 엔진 → (승인 대기) → "AI 변경 제안" 화면
```
- 외부 AI 용 MCP 설정(켜기·vault 선택·토큰)과 **별개**다. 앱 안 AI 는 실행하는 동안만 임시 서버를 열고 끝나면 닫는다. 이 서버는 지금 열려 있는 vault 하나에만 닿는다(`internal`).
- 제안자는 `MCP · 앱 안 Claude` 로 "AI 변경 제안"에 보인다. 이 화면에서 승인해야 반영된다.

### 고정된 안전 옵션 (`buildArgs`, 테스트로 고정)
| 옵션 | 효과 |
|---|---|
| `--tools ""` | 내장 도구(파일 읽기·쓰기·셸 …) 전부 끔 — PC 파일에 닿을 수 없다 |
| `--strict-mcp-config` + 임시 `--mcp-config` | 개인 MCP 설정은 무시하고 Nosidian 하나만 쓴다 |
| `--allowedTools` | Nosidian MCP 도구 6개만(노트를 직접 쓰는 도구 없음) |
| `--setting-sources project` + 빈 임시 작업 폴더 | 사용자 설정(훅·권한 규칙·CLAUDE.md)의 영향을 받지 않는다(인증은 유지됨을 확인) |
| `--no-session-persistence` | 대화 기록을 디스크에 남기지 않는다 |
| 프롬프트는 **stdin** | 길이·이스케이프 문제 없음, 사용자 입력이 인자에 들어가지 않는다 |

- `--dangerously-skip-permissions`·`--add-dir`·`--permission-mode` 등 권한을 넓히는 옵션은 없고, 있으면 테스트가 실패한다. 모델 이름은 `[A-Za-z0-9][A-Za-z0-9._:-]*` 만 받는다(앞의 `-` 금지 — `--tools` 같은 값이 옵션으로 해석되지 않게).
- 모델에는 시스템 프롬프트로 "Nosidian 도구만 쓴다 · 직접 쓸 수 없다 · `applied` 가 나오기 전에는 반영됐다고 말하지 않는다 · 수정 전 `read_note` 로 읽고 `content_hash` 를 보낸다"를 덧붙인다.

### 안정성
- **한 번에 하나**: 실행 중 또 요청하면 `busy`. **시간 상한 4분**, **취소** 가능(Windows 는 `taskkill /T` 로 자식까지). 결과를 낸 뒤 프로세스가 3초 안에 안 끝나면 끝낸다.
- 끝(`result`/`error`) 이벤트는 **정리(프로세스·임시 MCP 서버·임시 폴더)가 끝난 뒤에** 화면으로 보낸다 — 화면이 "끝남"을 받았을 때는 바로 다시 실행할 수 있다(이 순서 결함을 실제 취소 시험에서 발견해 고쳤다).
- 오류 분류: CLI 없음(`notFound`)·npm 설치만 있음(`.cmd` 미지원)·로그인 안 됨(`login`)·시간 초과·취소·비정상 종료(stderr 끝 3줄 포함).
- 준비 상태 확인은 `claude --version`·`claude auth status`(토큰을 쓰지 않는다).

### 시험 상태
- 단위 테스트(`claudeCli.test.ts` 23개 · `aiAssistant.test.ts` 6개): 찾기, 안전 옵션 고정, 출력 해석, 성공·정리·시간 초과·취소·동시 실행·오류 분류, 끝 이벤트 순서.
- **실제 Claude Code 2.1.321 로 E2E**: 읽기 질문(도구 호출 → 답변, 3~5턴·약 2~3센트), 변경 제안(공식 문서 → 승인 대기, 제안자 표시), 취소, 취소 직후 재실행, 동시 실행 방어, 종료 후 프로세스·임시 폴더 없음, 마크다운 답변 렌더링.
- 한계: 질문과 AI 가 읽은 노트 내용은 Anthropic 으로 전송되고 사용량은 Claude 계정에서 차감된다. 응답은 스트리밍 표시가 아니라 도구 호출 진행 + 최종 답변이다. Android 는 지원하지 않는다(CLI 가 없다).
