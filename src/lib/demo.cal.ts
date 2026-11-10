// 예제 vault 의 일정 체험용 노트. 날짜는 만드는 날(오늘) 기준이라 캘린더를 열면 바로 일정이 보인다.
const p2 = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export function calendarDemo(ko: boolean, daily = ko ? '할 일' : 'Tasks'): Record<string, string> {
  const t0 = day(0)
  const t1 = day(1)
  const start = day(8)
  const end = day(10)
  if (ko) {
    return {
      '프로젝트/행사 준비/프로젝트 개요.md': `---\ntype: project\nstatus: 진행 중\nowner: 민수\ndue: ${day(30)}\n---\n# 행사 준비\n\n지인 모임을 준비하는 작은 프로젝트입니다. 같은 폴더의 [[할 일]] 노트에 적은 체크리스트가 **내 업무**에 모입니다.\n\n- 장소: 시내 한식당\n- 인원: 20명\n`,
      '프로젝트/행사 준비/할 일.md': `# 할 일\n\n마감일(\`due:\`)·담당자(\`owner:\`)·상태(\`status:\`)를 한 줄에 적으면 내 업무에서 기한이 지난 일, 오늘 마감, 대기 중인 일로 나뉘어 보입니다.\n\n- [ ] 장소 예약금 입금 due:${day(-3)} owner:민수 p:1\n- [ ] 참석자 최종 확인 due:${t0} owner:지현\n- [ ] 케이크 주문 due:${day(3)} owner:지현\n- [ ] 식당에 룸 가능 여부 문의 status:waiting side:상대 due:${day(-1)} owner:민수\n- [ ] 현수막 시안 정하기 status:doing owner:지현\n- [ ] 사진 담당 정하기 due:${day(10)}\n- [ ] 장소를 식당으로 할지 집으로 할지 kind:decision due:${day(2)} owner:민수
- [x] 날짜 확정 kind:decision owner:민수 => 토요일 저녁으로 결정\n`,
      [`${daily}/${t0}.md`]: `# ${t0}\n\n## 할 일\n- [ ] 09:00 아침 산책\n- [ ] 12:30 점심 약속\n- [ ] 장보기 목록 확인\n- [x] 물 한 잔 마시기\n\n## 메모\n이 노트의 체크리스트 한 줄이 곧 오늘의 일정입니다. **캘린더** 탭에서 확인해 보세요.\n`,
      [`${daily}/${t1}.md`]: `# ${t1}\n\n## 할 일\n- [ ] 15:00 치과 예약\n- [ ] 19:00-20:00 저녁 운동\n\n## 메모\n\n`,
      '일상/주간 루틴.md': `# 주간 루틴\n\n날짜 뒤에 \`repeat:weekly\` 를 붙이면 매주 반복돼요.\n\n- [ ] 19:00 요가 @${t0} repeat:weekly\n\n#일상\n`,
      '일상/제주 여행 일정.md': `---\ntitle: 제주 여행\ndate: ${start}\nend: ${end}\n---\n# 제주 여행 일정\n\n맨 위의 \`date\` 와 \`end\` 로 기간이 정해집니다. 자세한 준비는 [[제주 여행]]에서.\n`,
    }
  }
  return {
    'Projects/Party Planning/Project Overview.md': `---\ntype: project\nstatus: active\nowner: Alex\ndue: ${day(30)}\n---\n# Party Planning\n\nA small project for a get-together. The checklists in the [[Tasks]] note in this folder show up in **My Work**.\n\n- Venue: downtown restaurant\n- Guests: 20\n`,
    'Projects/Party Planning/Tasks.md': `# Tasks\n\nAdd a due date (\`due:\`), an owner (\`owner:\`) and a status (\`status:\`) to a line and it is sorted into overdue, due today or waiting in My Work.\n\n- [ ] Pay the venue deposit due:${day(-3)} owner:Alex p:1\n- [ ] Confirm final guest list due:${t0} owner:Sam\n- [ ] Order the cake due:${day(3)} owner:Sam\n- [ ] Ask the restaurant about a private room status:waiting side:other due:${day(-1)} owner:Alex\n- [ ] Pick a banner design status:doing owner:Sam\n- [ ] Choose a photographer due:${day(10)}\n- [ ] Restaurant or home for the venue? kind:decision due:${day(2)} owner:Alex
- [x] Fix the date kind:decision owner:Alex => decided on Saturday evening\n`,
    [`${daily}/${t0}.md`]: `# ${t0}\n\n## To do\n- [ ] 09:00 Morning walk\n- [ ] 12:30 Lunch with a friend\n- [ ] Check the grocery list\n- [x] Drink a glass of water\n\n## Notes\nEach checklist line in this note is an event for today. Open the **Calendar** tab to see it.\n`,
    [`${daily}/${t1}.md`]: `# ${t1}\n\n## To do\n- [ ] 15:00 Dentist appointment\n- [ ] 19:00-20:00 Evening workout\n\n## Notes\n\n`,
    'Life/Weekly Routine.md': `# Weekly Routine\n\nAdd \`repeat:weekly\` after the date to repeat an event every week.\n\n- [ ] 19:00 Yoga @${t0} repeat:weekly\n\n#life\n`,
    'Life/Weekend Trip Dates.md': `---\ntitle: Weekend Trip\ndate: ${start}\nend: ${end}\n---\n# Weekend Trip Dates\n\nThe \`date\` and \`end\` properties at the top set the range. Preparation details are in [[Weekend Trip]].\n`,
  }
}
