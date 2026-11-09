; Nosidian 설치 시 .md / .markdown 의 "연결 프로그램"(열기 → 다른 앱 선택) 목록에 등록한다.
; electron-builder 기본 fileAssociations 는 .md 의 '기본 프로그램'까지 덮어쓰기 때문에,
; 이미 쓰는 에디터를 뺏지 않도록 OpenWithProgids(목록에 추가)만 직접 등록한다.

; 이름이 Amsidian 에서 Nosidian 으로 바뀌었다. 예전 이름 폴더(예: C:\Program Files\Amsidian)에 설치돼 있던 경우
; 설치 폴더 이름도 Nosidian 으로 옮긴다. 같은 앱 ID 라서 이전 설치는 설치 중 자동으로 제거되고,
; 노트·설정은 %APPDATA%\Amsidian 에 있어 그대로 유지된다. (직접 지정한 다른 폴더 이름은 건드리지 않는다)
!macro customInit
  Push $R8
  Push $R9
  StrCpy $R9 $INSTDIR "" -9
  ${If} $R9 == "\Amsidian"
    StrCpy $R9 $INSTDIR -9
    StrCpy $INSTDIR "$R9\Nosidian"
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend

!macro customInstall
  ; 파일 형식 클래스
  WriteRegStr SHCTX "Software\Classes\Nosidian.md" "" "Markdown 문서"
  WriteRegStr SHCTX "Software\Classes\Nosidian.md\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Nosidian.md\shell\open" "" "Nosidian으로 열기"
  WriteRegStr SHCTX "Software\Classes\Nosidian.md\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; 확장자별 "연결 프로그램" 후보에 추가 (기본값은 건드리지 않는다)
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "Nosidian.md" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "Nosidian.md" ""

  ; 앱 등록 (목록에 이름·아이콘이 표시되도록)
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Nosidian"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".md" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".markdown" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; 탐색기에 바뀐 연결 정보를 알린다
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "Nosidian.md"
  DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "Nosidian.md"
  DeleteRegKey SHCTX "Software\Classes\Nosidian.md"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
