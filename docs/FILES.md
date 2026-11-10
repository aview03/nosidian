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
- v1.35.1: 파일 행의 "삭제"(확인 후 저장소에서 삭제, `deleteOther`). 아직 없음: 이름 바꾸기·폴더로 옮기기(내려받아 다시 올려야 함), 폰에서 고친 파일 덮어쓰기, Claude 의 파일 생성.
