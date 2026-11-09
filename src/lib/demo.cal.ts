// 예제 vault 의 일정 체험용 노트. 날짜는 만드는 날(오늘) 기준이라 캘린더를 열면 바로 일정이 보인다.
const p2 = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export function calendarDemo(ko: boolean): Record<string, string> {
  const t0 = day(0)
  const t1 = day(1)
  const start = day(8)
  const end = day(10)
  if (ko) {
    return {
      [`Daily/${t0}.md`]: `# ${t0}\n\n## 할 일\n- [ ] 09:00 아침 산책\n- [ ] 12:30 점심 약속\n- [ ] 장보기 목록 확인\n- [x] 물 한 잔 마시기\n\n## 메모\n이 노트의 체크리스트 한 줄이 곧 오늘의 일정입니다. **캘린더** 탭에서 확인해 보세요.\n`,
      [`Daily/${t1}.md`]: `# ${t1}\n\n## 할 일\n- [ ] 15:00 치과 예약\n- [ ] 19:00-20:00 저녁 운동\n\n## 메모\n\n`,
      '일상/주간 루틴.md': `# 주간 루틴\n\n날짜 뒤에 \`repeat:weekly\` 를 붙이면 매주 반복돼요.\n\n- [ ] 19:00 요가 @${t0} repeat:weekly\n\n#일상\n`,
      '일상/제주 여행 일정.md': `---\ntitle: 제주 여행\ndate: ${start}\nend: ${end}\n---\n# 제주 여행 일정\n\n맨 위의 \`date\` 와 \`end\` 로 기간이 정해집니다. 자세한 준비는 [[제주 여행]]에서.\n`,
    }
  }
  return {
    [`Daily/${t0}.md`]: `# ${t0}\n\n## To do\n- [ ] 09:00 Morning walk\n- [ ] 12:30 Lunch with a friend\n- [ ] Check the grocery list\n- [x] Drink a glass of water\n\n## Notes\nEach checklist line in this note is an event for today. Open the **Calendar** tab to see it.\n`,
    [`Daily/${t1}.md`]: `# ${t1}\n\n## To do\n- [ ] 15:00 Dentist appointment\n- [ ] 19:00-20:00 Evening workout\n\n## Notes\n\n`,
    'Life/Weekly Routine.md': `# Weekly Routine\n\nAdd \`repeat:weekly\` after the date to repeat an event every week.\n\n- [ ] 19:00 Yoga @${t0} repeat:weekly\n\n#life\n`,
    'Life/Weekend Trip Dates.md': `---\ntitle: Weekend Trip\ndate: ${start}\nend: ${end}\n---\n# Weekend Trip Dates\n\nThe \`date\` and \`end\` properties at the top set the range. Preparation details are in [[Weekend Trip]].\n`,
  }
}
