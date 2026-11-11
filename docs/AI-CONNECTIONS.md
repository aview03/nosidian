# AI 연결 여러 개 — 설계 (5-a·5-b)

> 상태: **§9 결정 확정(2026-11-11, 전부 추천안) · 1단계 구현·로컬 커밋.** 2~4단계 미착수. 구현 현황은 §12.
> 배경: `docs/NEXT-SESSION.md` §5.5 의 5번(2026-11-11 사용자 요청).

## 1. 목표

1. **여러 AI 를 동시에 연결해 두고 쓴다.** 내 구독 계정(Claude Code) · 내 컴퓨터에서 돌리는 모델(Ollama·내 서버) · API 키 모델(OpenAI·Claude API·Gemini)이 각각 연결돼 있으면 **전부** 쓸 수 있다. "연결 바꾸기" 가 아니라 "연결 추가".
2. **쓸 수 있는 모델이 목록으로 보인다.** 연결마다 서버가 알려 주는 모델 목록에서 고르고, AI 패널에서도 `연결 › 모델` 로 고른다.
3. 기존 사용자의 설정·키를 잃지 않는다(자동 이전, 실패 시 옛 값 유지).
4. 키·토큰은 기기 밖으로 나가지 않는다(지금 규칙 유지: PC 는 safeStorage, 폰은 Keystore, 동기화에 넣지 않음).

## 2. 지금 구조 (코드로 확인함)

| 항목 | 지금 | 파일 |
| --- | --- | --- |
| 로컬/API 키 연결 | **한 칸** `nosidian.llm` = `LlmConfig{kind, baseUrl, model, apiKey?, keyStored?, viaPc?}`. 저장하면 덮어쓴다 | `lib/llm.ts` `loadLlmConfig/saveLlmConfig` |
| Claude 구독 | 설정이 아니라 **CLI 감지**(`claude.detect()`), 폰은 PC 중계(`pcLink.claude`) | `lib/aiAssistant.ts`, `lib/pcLink.ts` |
| 패널의 엔진 | `engine: 'claude' \| 'ollama'` 둘 중 하나. `'ollama'` 는 "저장된 한 칸" | `lib/aiThread.ts` `currentEngine/localEngine` |
| 패널 선택 상자 | 옵션 2개: `Claude CLI` / `local.label`(저장된 모델 하나) | `components/AiPanel.tsx` |
| 요약 | 한 줄(엔진 하나) | `lib/aiWizard.ts` `aiSummary` |
| API 키 보관 | PC: 메인 프로세스 safeStorage **파일 하나**(`llm-key.bin`), 요청 헤더의 `KEY_MARK` 를 메인이 치환. 폰: Keystore `llm.apiKey` **하나** | `electron/llm.cjs` `createKeyStore`, `lib/secureStore.ts` |
| 폰 중계(PC→폰) | `relay:upstream` 에 **연결 하나**(종류·주소·모델)만 알림 | `lib/relayBridge.ts`, `electron/aiRelay.cjs` |
| 폰 쪽 PC 연결 | 짝을 맺으면 `adoptUpstream` 이 저장된 연결을 **덮어쓴다**(`viaPc:true`) | `lib/pcLink.ts` |
| 자동 분석 | `loadLlmConfig()` 한 칸 / Claude | `lib/autoRunner.ts` |
| 모델 목록 | 마법사가 연결 확인 때 `listModels` 를 쓰고 **하나만 저장**(`pickModel`) | `components/AiWizard.tsx`, `lib/aiWizard.ts` |

`loadLlmConfig()` 를 직접 부르는 곳: `AiWizard`·`LlmSettings`·`aiThread`·`autoRunner`·`llmNet`(키 이전)·`pcLink`·`relayBridge`.

## 3. 데이터 모델

```ts
/** 내가 연결해 둔 AI 하나 (Claude 구독은 여기 없다 — §4) */
interface AiConnection {
  id: string                // 'c_' + 랜덤 8자. 키 보관 이름·선택값에 쓴다
  kind: ProviderKind        // 'ollama' | 'custom' | 'openai' | 'anthropic' | 'gemini'
  label: string             // 화면 이름. 기본값: "Ollama", "OpenAI", "내 서버 (192.168.0.5)"
  baseUrl: string
  model: string             // 이 연결에서 기본으로 쓸 모델
  keyStored?: true          // 키는 보안 저장소에 있다(§6)
  apiKey?: string           // 보안 저장소가 없는 환경에서만 평문(지금과 같은 규칙)
  viaPc?: true              // 폰: PC 중계를 통한 연결(키는 PC 에만 있고 폰은 토큰)
  models?: { list: string[]; at: number }   // 마지막으로 가져온 모델 목록(없거나 실패해도 `model` 은 쓸 수 있다)
  shareToPhone?: boolean    // PC: 이 연결을 휴대폰에 빌려줄까(§8). 기본 false
}
interface AiConnections { v: 2; items: AiConnection[]; selected: { conn: string; model?: string } | null }
```

- 저장 키 `nosidian.aiConnections`. 비밀 필드(키·중계 토큰)는 `secureStore` 규칙대로 **연결별 이름**(`llm.apiKey.<id>`)으로 보안 저장소에. 연결 수 상한 **8개**.
- **호환 장치(핵심)**: `loadLlmConfig()` 는 계속 존재하고 **"지금 선택된 연결 + 모델"을 옛 `LlmConfig` 모양으로** 돌려준다. `saveLlmConfig(cfg)` 는 "선택된 연결을 고친다(없으면 추가)" 로 동작한다. 그래서 `aiThread`·`autoRunner`·`llmNet`·`relayBridge` 는 첫 단계에서 **수정 없이** 동작한다. 이후 필요한 곳만 새 API(`listConnections`, `connectionById`)로 옮긴다.

## 4. Claude 구독 (CLI)

연결 목록의 항목이 아니라 **항상 있는 내장 선택지**다(PC: CLI 가 설치·로그인돼 있을 때, 폰: PC 중계가 `claude:true` 일 때). 패널 목록에서 맨 위 `Claude (구독)`. 모델 고르기는 Claude Code 가 정하므로 목록 없음(추후 `--model` 지원은 별도 과제).

## 5. 선택(어떤 AI 로 답할까)

- 패널의 `engine: 'claude'|'ollama'` → `selected: { conn: 'claude' | <connId>, model? }`. 옛 값은 이전한다(`'ollama'` → 이전된 연결 id).
- 이미 대화에 남은 메시지의 `engine` 필드(표시용)는 그대로 두고, 읽을 때 'ollama' 는 "로컬 모델"로 표시.
- **AI 패널 선택 상자**: 연결 하나당 모델 목록이 있으면 `연결 › 모델` 항목들(구분선·그룹 제목), 없으면 연결의 기본 모델 한 항목. 목록이 길면 최근 쓴 것 위로. 모델이 도구 호출을 못 하면(`supportsTools`) 항목은 보이되 비활성 + "도구 호출을 지원하지 않아요".
- 자동 분석(`autoRunner`): 기본 "지금 선택된 AI". 설정에서 따로 고르게 하는 것은 5-a 이후 과제.

## 6. 키 보관 (연결별)

- **PC**: `llm-key.bin` 한 개 → `llm-keys.bin` 하나에 `{ [connId]: key }` 를 통째로 safeStorage 로 암호화(파일 하나라 부분 손상 영향 작게). IPC: `llm:key:status(id)`, `llm:key:set(id, key)`, `llm:key:clear(id)`. 요청 헤더의 `KEY_MARK` 치환은 요청에 `keyId` 를 같이 보내 해당 키를 쓴다(`electron/llm.cjs` `request(req, keys, ac)` 에 `keyId`).
- **폰**: Keystore 이름이 연결별(`llm.apiKey.<id>`). `secureStore` 의 `SecretSpec` 이 지금 레코드 하나 가정이라 **목록 레코드의 필드별 비밀**을 다루도록 확장(`registerSecret` 을 연결 추가 시 동적으로, 또는 `items[i].apiKey` 를 이름 붙여 저장). 평문 이전은 지금처럼 "쓰기→재읽기 확인 뒤에만 평문 삭제".
- 연결을 해제하면 그 연결의 키도 지운다(PC·폰 모두).

## 7. 이전(migration)

앱 시작 시 한 번(`hydrateSecrets` 뒤):
1. `nosidian.aiConnections` 가 이미 있으면 끝.
2. 옛 `nosidian.llm` 이 있으면 → 연결 1개로 변환(`id` 생성, `label` 자동, 옛 키 보관 위치의 키를 새 이름으로 **복사해 확인한 뒤** 옛 위치 삭제), `selected` 설정. `viaPc` 연결은 그대로 `viaPc`.
3. 옛 패널 `engine` 값 이전.
4. 이전 직후 `nosidian.llm` 은 **한 번의 릴리스 동안 지우지 않고** `nosidian.llm.bak` 로 이름만 바꿔 둔다(되돌릴 수 있게). 다음 버전에서 정리.
5. 어느 단계든 실패하면 옛 설정을 건드리지 않고 "연결 1개 있음(옛 방식)"으로 계속 동작(호환 `loadLlmConfig` 가 옛 키도 읽음).

## 8. PC 중계(휴대폰에 빌려주기)

- 지금: 연결 한 칸이 곧 중계 대상. → 변경: 연결마다 `shareToPhone`(기본 **꺼짐**, 켤 때 확인 "이 AI 의 요청이 이 PC 를 거쳐 가요, 키는 폰에 가지 않아요"). 여러 개를 켤 수 있다.
- `relay:upstream` 을 `relay:upstreams([{id, kind, baseUrl, model, keyStored}])` 로. 폰 쪽 `PcLink.upstream` 도 목록(`upstreams`)이 되고, 폰은 짝 맺을 때 **빌려준 연결 각각을 `viaPc` 연결로 추가**한다(덮어쓰지 않음). 중계 경로는 `/relay/<id>/...` 로 연결을 구분(키 주입은 PC 메인이 id 로).
- 폰에서 PC 연결을 해제하면 `viaPc` 연결들을 함께 제거(지금 `forgetPc` 가 하는 일의 확장).

## 9. 결정 (확정: 2026-11-11, 전부 추천안)

1. **Claude 구독의 모델 고르기**: Claude Code 기본값만. 목록 없이 `Claude (구독)` 한 항목.
2. **폰에 빌려주기**: 연결별 토글, 기본 꺼짐(켤 때 확인 창).
3. **자동 분석에 쓸 AI**: "지금 선택된 AI" 를 따라간다.
4. **연결 수 상한**: 8개.

## 10. 단계 (각 단계마다 시험·로컬 커밋, 푸시는 "푸쉬" 할 때)

| 단계 | 내용 | 위험 |
| --- | --- | --- |
| **1. 저장 모델 + 이전** | `AiConnections`, `nosidian.aiConnections`, 호환 `loadLlmConfig/saveLlmConfig`, 이전·백업, 연결별 키(PC·폰). **화면은 그대로** — 기존 동작이 바뀌지 않는 것을 시험으로 증명 | 키 이전 실수 → 변이 시험·"쓰기→읽기 확인→삭제" 순서로 방어 |
| **2. 설정 UI** | "연결된 AI" 카드 목록 + `+ 연결 추가`(기존 3갈래 마법사 재사용) + 카드별 고치기·테스트·해제, 요약은 "N개 연결됨". PC·모바일 | 마법사가 한 칸 저장 가정(`finish`) → 추가 모드로 |
| **3. 모델 목록 + 패널 선택** | 연결별 모델 목록 가져오기·캐시·새로 고침, 패널 `연결 › 모델` 선택, `selected` 로 엔진 전환(`aiThread`) | 모델 목록 실패 시 처리 |
| **4. 중계 다중화(폰)** | `relay:upstreams`, 폰의 `viaPc` 연결 여러 개, 연결별 공유 토글 | 중계 경로 변경 → 폰 실기 시험 필요(잠금 해제 요청) |

5-c(기기 관리 컴포넌트 통일)는 이 작업과 독립이라 단계 2 와 함께 하거나 따로 한다.

## 11. 시험 계획

- 이전: 옛 한 칸(키 있음/없음/`viaPc`/평문/Keystore) → 연결 1개 + 키 보존, 실패 주입 시 옛 값 유지, 두 번 실행해도 중복 없음.
- 호환: `loadLlmConfig` 가 선택된 연결을 옛 모양으로 반환, `saveLlmConfig(null)` 은 선택된 연결만 해제.
- 키: 연결 A·B 에 다른 키 → 요청이 각자 키를 쓰는지, 해제 시 그 키만 삭제, 키 없는 서버(Ollama) 연결.
- 선택: 연결 해제 시 선택이 남은 연결로 넘어가거나 null, 패널 목록 구성(도구 호출 미지원 비활성).
- 화면: 실제 PC 앱(Electron) + 폰에서 연결 2개 이상 추가→패널에서 전환→한쪽 해제→재시작 후 유지.

## 12. 구현 현황

### 1단계 — 저장 모델 + 이전 (구현·로컬 커밋 `86d9257`)
- `src/lib/aiConnections.ts`: 연결마다 레코드 `nosidian.llm.<id>` + 인덱스 `nosidian.aiConnections`(ids·selected). `addConnection/updateConnection/removeConnection/setSelected/selectedConnection/listConnections`, 상한 8, 이상한 id 무시.
- **설계에서 바뀐 점**: §3·§6 은 "연결별 비밀을 `secureStore` 에 동적으로"였는데, 연결마다 레코드를 따로 두니 **`secureStore` 를 고치지 않고** 기존 규칙(레코드별 `SecretSpec`)으로 그대로 된다. §7 의 이전도 "키 복사→확인→삭제"가 아니라 **레코드 이름만 바꾸는** 방식으로 단순화했다(예전 비밀 이름 `llm.apiKey`·PC 키 파일 `llm-key.bin` 을 `c_legacy` 가 그대로 쓰므로 키가 움직이지 않는다). 옛 레코드는 비밀 없는 사본으로 `nosidian.llm.bak` 에 남긴다.
- 호환: `loadLlmConfig()` = 선택된 연결(옛 모양 + `id`·`label`), `saveLlmConfig(cfg)` = 선택된 연결을 고침(`cfg.id` 있으면 그 연결, 없으면 새로 추가), `null` = 선택된 연결 해제. → `aiThread`·`autoRunner`·`relayBridge`·`pcLink` 는 **수정 없이** 동작. 화면 동작 변화 없음.
- 키: PC 메인 `electron/llm.cjs` 는 `llm-key.<id>.bin`(예전 `c_legacy`·id 없음은 `llm-key.bin`), 요청 자리표시자 `{{KEY:id}}`(`{{KEY}}` = 예전 한 칸), IPC `llm:key:status/set/clear(…, id)`. 폰 Keystore 이름은 `llm.apiKey.<id>`. 폰 중계(`aiRelay`)도 `keyId` 로 해당 연결의 키를 쓴다.
- 시험: 신규 `aiConnections.test.ts`(15) + `electronLlm.test.ts`(연결별 키 3) + 기존 시험 갱신(저장 위치가 바뀐 곳). 전체 776개 통과. 변이 시험: 비밀 이름을 하나로 합치면·PC 키 파일을 나누지 않으면 시험이 실패함을 확인.
- **실제 PC 앱(Electron) 확인**: 옛 `nosidian.llm`(keyStored) → 재시작 시 `c_legacy` 연결로 이전·옛 키(`llm-key.bin`) 유지, 가짜 서버에서 `{{KEY}}`→예전 키·`{{KEY:c_bbbb2222}}`→그 연결 키 확인, 키 없는 연결은 요청을 보내지 않음, 한 연결 키를 지워도 다른 키는 남음.
- **미확인**: 폰(Android Keystore)에서의 이전·연결별 비밀 이름(시험은 가짜 Keystore 로만), 사용자의 실제 설치 앱 데이터로의 이전(설치본은 건드리지 않음 — 다음 설치 파일로 업그레이드할 때 첫 실행에서 일어난다), 폰 중계의 `keyId` 경로(단위 시험 없음, 코드 경로만).

### 2단계 이후: 미착수
