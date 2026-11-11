#!/bin/bash
# 페르소나별 첫 실행 자동 점검: 새 시험 프로필로 온보딩(역할 선택)→예제 노트→내 업무 화면 텍스트·스크린샷을 남긴다. docs/personas/README.md 참고
# 사용법: persona_run.sh <역할 라벨> <출력 이름>
cd /c/Users/USER/Desktop/MD_Reader/app
SP="${SCRATCH:-/tmp/nosidian-persona}"; mkdir -p "$SP"
LABEL="$1"; OUT="$2"
rm -rf "$SP/ud_p_$OUT"
(NOSIDIAN_PORT=47399 node_modules/.bin/electron electron/main.cjs --user-data-dir="$SP/ud_p_$OUT" --remote-debugging-port=9333 >/dev/null 2>&1 &)
sleep 8
C="timeout 30 node scripts/dev/cdp.cjs MAIN"
click(){ $C "(function(){const i=document.querySelector('input'); if(i&&!i.value){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'시험'); i.dispatchEvent(new Event('input',{bubbles:true}));} const bs=[...document.querySelectorAll('button')].filter(x=>!x.disabled); const b=bs.find(x=>x.textContent.trim().startsWith('$1')); b&&b.click(); return b?'$1':'MISSING $1'})()" | tr '\n' ' '; sleep ${2:-2}; }
click 한국어 1.5; click 계속; click 좋아요; click 다음; click "$LABEL"; click 다음; click "예제 노트로 둘러보기" 3; echo
sleep 2
$C "(function(){const b=document.querySelector('nav.rail button[title=\"내 업무\"]'); b&&b.click(); return !!b})()" >/dev/null; sleep 2.5
$C "JSON.stringify({tiles:[...document.querySelectorAll('.tile h3, .wk-tile h3, section h3, .tile-title')].map(x=>x.textContent.trim()).slice(0,14), text:(document.querySelector('.work, .work-home, main')||document.body).innerText.replace(/\n+/g,' / ').slice(0,500)})"
node scripts/dev/shot.cjs 9333 MAIN "$SP/persona_$OUT.png" 1200 860
# "전체"(담당자와 상관없이 모든 일)로 바꿨을 때 어떤 타일이 보이는지도 남긴다 — "내 것" 필터 때문에 비어 보이는지 확인용
$C "(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='전체'); b&&b.click(); return !!b})()" >/dev/null; sleep 2
echo "[전체]"; $C "(document.querySelector('.work, .work-home, main')||document.body).innerText.replace(/\n+/g,' / ').slice(0,700)"
node scripts/dev/shot.cjs 9333 MAIN "$SP/persona_${OUT}_all.png" 1200 860
taskkill //F //IM electron.exe >/dev/null 2>&1
sleep 2
