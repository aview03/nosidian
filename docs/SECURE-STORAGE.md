# 비밀값 보안 저장소 (v1.39.0)

폰(Android 앱)에 저장되는 비밀값 — **PC 연결 토큰**(AI 중계 `nosidian.pc`, 파일 공유 `nosidian.pcshare`)과 **직접 입력한 API 키**(`nosidian.llm`; PC 중계를 쓰면 이 자리에 중계 토큰이 들어간다) — 을 Android Keystore 로 보호한다.
쓰기 권한을 가진 기기 토큰이 평문으로 남지 않게 하려고 PC 호스트 쓰기 API(v1.41)보다 먼저 구현했다.

## 동작
- 네이티브 `SecureStore` 플러그인(`SecureStorePlugin.java`): Keystore 의 AES-256-GCM 키(`nosidian_secure_v1`, 내보낼 수 없음)로 암호화해 앱 전용 `SharedPreferences`(`nosidian_secure`)에 둔다. 값마다 **이름을 GCM 추가 인증 데이터(AAD)** 로 묶어, 다른 이름의 암호문을 바꿔치기해도 복호화되지 않는다.
- 웹뷰 `localStorage` 의 레코드에서는 비밀 필드를 뺀다(주소·지문·이름 같은 비밀이 아닌 정보만 남는다).
- 기존 코드는 동기 함수(`loadPcShare` 등)를 쓰므로, 앱 시작(`main.tsx`)에서 렌더 전에 한 번 복호화해 메모리 캐시에 올린다(`hydrateSecrets`, 4초를 넘기면 기다리지 않고 띄우고 끝나면 화면 상태를 다시 읽는다).
- 보안 저장소가 없는 환경(웹·PC 앱)은 지금까지처럼 `localStorage`(PC 앱의 API 키는 메인 프로세스 `safeStorage`)를 쓴다.

## 기존 평문 값의 이전
시작할 때 평문이 남아 있으면: ① 보안 저장소에 쓰고 ② 다시 읽어 **같은 값인지 확인**한 뒤에만 ③ 평문을 지운다. 쓰기·확인이 실패하면 평문을 그대로 둔다(값을 잃지 않고, 다음 시작에 다시 시도). 이전 전에도 평문은 읽힌다.

## 실패와 복구
- **키 무효**(백업 복원·기기 이전·보안 재설정): 복호화가 실패하면 그 항목을 지우고 연결을 "안 됨"으로 돌린다 — **평문으로 되돌리지 않는다.** 다시 연결하면 된다(PC 에서 새 코드).
- **저장할 때 쓰기 실패**: 값을 잃지 않도록 평문으로 저장하고 경고를 남긴다(드문 경우의 타협).
- **백업 제외**: `backup_rules.xml`(Android 6–11) · `data_extraction_rules.xml`(Android 12+) 로 `nosidian_secure.xml` 을 클라우드 백업·기기 간 전송에서 뺀다. 키는 기기 밖으로 나가지 않으므로 복원해도 못 읽는다.

## 한계
- 앱이 실행 중이면 복호화된 값이 메모리에 있다(앱 자체가 뚫리면 보호할 수 없다). 루팅·디버그 빌드의 `run-as` 로는 앱 전용 저장소를 볼 수 있지만 **암호문**만 보인다.
- 화면 잠금과 연동하지 않는다(`setUserAuthenticationRequired` 꺼짐) — 백그라운드 동기화가 잠금 해제 없이 토큰을 써야 하기 때문.
- 코드: `src/lib/secureStore.ts`, `SecureStorePlugin.java`. 시험: `secureStore.test.ts`(가짜 Keystore: 이전·실패·불일치·키 무효·재시작).
