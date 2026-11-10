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
- **아직 실제 Claude Code·Codex 로는 시험하지 못했다**(JSON-RPC 를 흉내 내는 클라이언트로만 확인). 등록 명령·설정은 두 도구의 문서를 따른 것이다.

## 아직 없는 것
- 제안의 기기 간 동기화(PC 에서 받은 제안을 폰에서 승인) — 지금 제안은 기기별 localStorage.
- 도구 호출 기록(누가 언제 무엇을 읽었는지), 읽기 도구의 경로별 허용 범위(지금은 vault 전체).
- 여러 vault 동시 연결, 클라이언트별 토큰·권한.
- `resources`·`prompts`·스트리밍 알림(도구만 제공).
