# AI 연결 (LLM 연결 인터페이스)

사용자가 쓸 AI 서버를 **직접 고르고 주소까지 정해** 앱이 같은 방식으로 부르게 하는 기반이다. 특정 업체에 묶이지 않고, 운영자가 중앙 AI 서버를 둘 필요도 없다(서버 없음·운영비 0원 원칙 유지). **아직 어떤 기능도 이 연결을 부르지 않는다** — 설정 화면에서 연결을 저장하고 시험하는 것까지다. 앞으로 앱 안 AI 기능(질문·요약·변경 제안)이 같은 설정을 읽는다.

## 지원 제공자
| 제공자 | 기본 주소 | 키 | 시험 상태 |
|---|---|---|---|
| **Ollama** (내 PC·홈 서버) | `http://localhost:11434` | 불필요 | 가짜 서버로 PC·Android 시험 + **이 PC 의 실제 Ollama(`qwen3.5:4b`)로 목록·응답 확인**(앱 전송 경로, 0.3초). 이 모델은 도구 호출(`tools`) 지원 — 앱 안 AI 의 Ollama 백엔드 후보 |
| **사용자 지정** (OpenAI 호환: LM Studio·vLLM …) | `http://localhost:1234/v1` | 선택 | 가짜 서버로 PC 시험 |
| OpenAI | `https://api.openai.com/v1` | 필수 | **요청 형식만 구현·단위 테스트, 실제 서버 미시험(키 없음)** |
| Anthropic | `https://api.anthropic.com` | 필수 | 위와 같음 |
| Google Gemini | `https://generativelanguage.googleapis.com` | 필수 | 위와 같음 |

## 구조
| 파일 | 역할 |
|---|---|
| `src/lib/llm.ts` | 순수 함수: 제공자별 요청 만들기(`buildChat`·`buildListModels`)·응답 읽기(`parseChat`·`parseModels`)·설정 검증(`validateConfig`)·주소 규칙(`isPrivateHost`)·기기 저장(`loadLlmConfig`) |
| `src/lib/llmNet.ts` | 실제 전송: PC 는 메인 프로세스 IPC, Android 는 Capacitor 네이티브 HTTP, 그 밖은 fetch. `listModels`(연결 확인 겸용)·`chat`(한 번, 스트리밍 없음) |
| `electron/llm.cjs` | 메인 프로세스 대행(`llm:request`): 주소·헤더·크기·시간 상한을 **다시 검사**, API 키 보관소(`createKeyStore`)·자리표시자 치환(`injectKey`) |
| `src/components/LlmSettings.tsx` | 설정 > "AI 연결" 카드(제공자·주소·모델·키·연결 시험·저장) |

## 왜 메인 프로세스·네이티브 HTTP 로 보내나
- **PC**: 화면(출처 `http://localhost:47321`)에서 `http://localhost:11434` 로 직접 보내면 브라우저 CORS 에 막힌다(Ollama 의 `OLLAMA_ORIGINS` 를 사용자가 고쳐야 함). 메인 프로세스가 대신 보내면 필요 없다.
- **Android**: 웹뷰 출처가 https 라서 LAN 의 `http://192.168.x.x` 는 혼합 콘텐츠로 막힌다. 네이티브 HTTP(`CapacitorHttp`)로 보내고, 평문 허용을 위해 매니페스트에 `usesCleartextTraffic="true"` 를 켰다. 대신 앱 코드가 **http 는 사설망·내 기기 주소만** 허용한다(아래).

## 안전 규칙
- **주소**: https 는 어디든, http 는 `localhost`·사설 IPv4(10/172.16-31/192.168)·링크로컬·Tailscale(100.64/10)·`*.local` 만. 공개 인터넷으로 http 는 금지(키·글이 평문으로 나가므로). 화면(`validateConfig`)과 메인 프로세스(`check`) 두 곳에서 검사하고, 둘의 규칙이 어긋나지 않는지 테스트(`electronLlm.test.ts`)가 비교한다.
- **메인 프로세스 대행의 상한**: 허용 헤더만(`content-type`·`authorization`·`x-api-key`·`anthropic-version`·`x-goog-api-key`), GET·POST 만, 리다이렉트는 따라가지 않음, 시간 2분·응답 8MB 상한.
- **API 키**
  - **PC**: 운영체제 자격증명 보호(Windows DPAPI, Electron `safeStorage`)로 **암호화**해 사용자 데이터 폴더(`llm-key.bin`)에 둔다. 키는 **메인 프로세스에서만** 복호화된다 — 화면(렌더러)은 저장·삭제·"있는지"만 알고 키를 읽는 API 가 없다. 요청 헤더에는 자리표시자 `{{KEY}}` 만 넣고, 메인 프로세스가 허용 헤더(`authorization`·`x-api-key`·`x-goog-api-key`)에만 실제 키로 바꿔 보낸다. 키가 없으면 요청 자체를 보내지 않고, 오류 메시지에 키가 섞이지 않는다. 예전에 평문(localStorage)으로 저장한 키는 앱 시작 때 보안 저장소로 **자동 이전**하고 평문은 지운다(이전 실패 시 기존 저장을 그대로 둔다).
  - **Android**: 아직 평문 localStorage 에 둔다(vault·동기화에는 안 들어감). Keystore 기반 보관 + 네이티브 요청에 키 주입은 네이티브 플러그인이 필요한 후속 과제다.
  - 어느 쪽이든 vault·동기화·GitHub 로는 나가지 않는다.
- **Gemini 키는 주소가 아니라 헤더**(`x-goog-api-key`)로 보낸다(로그·기록에 남지 않게).
- 문서 내용이 선택한 서버로 전송된다는 안내를 설정 화면에 표시한다.

## Ollama 를 다른 기기에서 쓰려면
PC 에서 `OLLAMA_HOST=0.0.0.0:11434` 로 Ollama 를 실행하고, Windows 방화벽에서 같은 사설망만 허용한다. 11434 포트를 인터넷에 직접 열지 않는다(인증이 없다). 밖에서는 Tailscale 같은 VPN 을 쓴다. PC 가 꺼져 있으면 폰에서도 쓸 수 없다.

## 앱 안 AI 와의 관계
앱 안 AI(AI 패널)는 엔진을 고른다: **Claude Code CLI**([MCP.md](MCP.md)의 "앱 안 AI") 또는 **이 문서의 연결 설정(Ollama·OpenAI 호환)**. 후자는 앱이 **도구 호출 반복(agent loop, `lib/aiAgent.ts`)** 을 돌려 같은 MCP 도구·정책 엔진·승인 흐름을 쓴다. 도구 호출은 Ollama·OpenAI 호환(`supportsTools`)만 지원한다. 요청 취소(`llm:cancel`)·`think`·`num_ctx` 옵션을 `llm.ts`·`llmNet.ts`·`electron/llm.cjs` 가 지원한다.

## 아직 없는 것
스트리밍 응답 · 모델이 도구 호출을 지원하는지 미리 판별(지금은 첫 호출에서 드러남) · Anthropic·Gemini 의 도구 호출 · 앱 안 AI 기능(질문·요약·변경 제안 만들기) · 연결 여러 개 저장 · Android 키 보안 저장(Keystore) · 클라우드 3종의 실서버 시험.
