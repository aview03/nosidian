#!/bin/bash
# 빌드 → APK → 폰 설치 → 실행 → 스크린샷
export PATH="$PATH:/c/Users/USER/AppData/Local/Android/Sdk/platform-tools"
export JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
cd "$(dirname "$0")"
npm run build >/dev/null 2>&1 || { echo BUILD FAIL; exit 1; }
npx cap sync android >/dev/null 2>&1
(cd android && ./gradlew.bat assembleDebug -q 2>&1 | grep -E "error|FAIL" )
adb install -r android/app/build/outputs/apk/debug/app-debug.apk | tail -1
adb logcat -c
adb shell am force-stop com.amsidian.app
adb shell am start -n com.amsidian.app/.MainActivity >/dev/null
sleep 4
adb exec-out screencap -p > "${1:-/tmp/s.png}"
adb logcat -d -s Capacitor:E | tail -3
