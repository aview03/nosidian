# 노트가 아닌 파일 (목록 동기화 + 눌러서 받기)

vault 저장소(GitHub·Google Drive·OneDrive)에 있는 `.md`·이미지가 아닌 파일(.py·.docx·.pdf·.zip·.exe …)을 다룬다.

- **동기화**: 이름·크기·rev 만 목록(`assets`)으로 가져온다. 내용은 미리 받지 않는다. 목록은 최대 3000개(`MAX_OTHERS`). 숨김 경로(`.`로 시작)와 구글 문서·시트 형식은 제외.
- **표시**: 메모 탭의 "파일" 구역(해당 폴더의 직속 파일), 파일만 든 폴더도 폴더로 보인다.
- **받기**: 누르면 `readBase64` 로 받아 폰은 공유 시트(다른 앱으로 열기·저장), PC·웹은 브라우저 다운로드. 10MB 초과·실행 파일은 먼저 확인. 폰은 실행 파일과 50MB 초과를 받지 않는다.
- **하지 않는 것(1단계)**: 폰에서 고친 파일 재업로드, PC 에서 파일 올리기(바이너리 push), Claude 가 임의 파일 생성. 다음 단계 후보: Provider `push` 를 base64 로 확장.
- 코드: `src/lib/attachments.ts`, `src/lib/sync/{types,others,index,gdrive,onedrive}.ts`, `MemoTab.tsx`(fileRow/getFile).

## 2단계: 파일 올리기 (v1.35.0)
- 메모 탭 "파일" 구역의 **올리기**(저장소가 연결돼 있을 때): 지금 폴더에 파일을 올린다(여러 개 가능). 바이너리는 `PushChange.b64` 로 — GitHub 는 `encoding: base64` blob, Drive 는 바이너리 multipart/PATCH, OneDrive 는 PUT.
- 규칙(`uploadProblem`/`uploadPath`): `.md` 는 "가져오기"로, 숨김·빈 파일 거절, 1개 최대 25MB, 같은 이름이면 `이름 (2).확장자`. 하나씩 올려 실패한 것만 알린다.
- v1.35.1: 파일 행의 "삭제"(확인 후 저장소에서 삭제, `deleteOther`). v1.36.0: 파일 행 "⋯" 메뉴(이름 바꾸기·폴더로 이동·삭제; 내려받아 새 경로에 올린 뒤 원본 삭제, 25MB 상한, GitHub 는 한 커밋). 아직 없음: 폰에서 고친 파일 덮어쓰기, Claude 의 파일 생성.

## 3단계 (v1.37.0): 새 버전으로 바꾸기 · AI 파일 제안
- **새 버전으로 바꾸기**: 파일 행 ⋯ 메뉴. 고른 파일 내용으로 같은 경로를 덮어쓴다(확인 후). 폰·PC 에서 고친 파일을 다시 올리는 방법 — 자동 동기화가 아니라 사람이 고르는 방식. 25MB 상한.
- **AI 파일 제안(`propose_file`)**: Claude·로컬 모델·외부 MCP 가 노트가 아닌 **텍스트 파일**(.py .js .ts .json .csv .txt .html .css .yaml .sql …)을 만들자고 제안한다. 정책 엔진의 자동 반영이 **없다** — 항상 사람의 승인("AI 변경 제안" 화면의 "새 파일" 카드, 승인하고 올리기)이 있어야 저장소에 올라가고, 그 전에는 아무것도 올라가지 않는다.
- 안전 규칙(`checkAiFile`): 허용 확장자만(.exe·.bat·.ps1·.sh 등 실행 파일·스크립트, .md 노트, 이미지 제외) · 200KB 이하(바이트) · 상위 경로(..)·숨김·`_workspace/` 불가 · 이미 있는 경로(대기 중 제안 포함)는 덮어쓰지 않음 · 저장소가 연결돼 있어야 함 · 묻기(읽기 전용)에서는 불가.
- 제안은 기기(localStorage, vault 별)에 보관, 처리한 것은 최근 40건. 코드: `src/lib/fileProposals.ts`, `mcpTools.ts`(propose_file), `electron/mcp-tools.json`, `ProposalReview.tsx`(FileItem).
