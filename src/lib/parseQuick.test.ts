import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventLine, parseQuick } from './calendar'

const BASE = '2026-11-11' // 수요일

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T09:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('빠른 입력: 하루 일정(기존 동작 유지)', () => {
  it('내일 3시 → 내일 15:00', () => {
    expect(parseQuick('내일 3시 치과', BASE)).toMatchObject({ date: '2026-11-12', start: '15:00', title: '치과' })
  })
  it('매주 월요일 10시 → 가장 가까운 월요일 + 주간 반복', () => {
    expect(parseQuick('매주 월요일 10시 콘텐츠 발행', BASE)).toMatchObject({ date: '2026-11-16', start: '10:00', repeat: 'weekly', title: '콘텐츠 발행' })
  })
  it('다음주 금요일 오후 2시', () => {
    expect(parseQuick('다음주 금요일 오후 2시 시안 리뷰', BASE)).toMatchObject({ date: '2026-11-20', start: '14:00', title: '시안 리뷰' })
  })
  it('날짜 하나는 endDate 가 없다', () => {
    expect(parseQuick('11월 20일 회의', BASE).endDate).toBeUndefined()
  })
  it('시간 범위(10:00-11:00)를 날짜 기간으로 착각하지 않는다', () => {
    expect(parseQuick('내일 10:00-11:00 회의', BASE)).toMatchObject({ date: '2026-11-12', start: '10:00', end: '11:00', title: '회의' })
    expect(parseQuick('내일 10:00-11:00 회의', BASE).endDate).toBeUndefined()
  })
})

describe('빠른 입력: 며칠에 걸친 일정(기간)', () => {
  it('"11월 20일부터 12월 3일까지" → 시작일과 마지막 날, 제목에는 기간 글자가 남지 않는다', () => {
    expect(parseQuick('11월 20일부터 12월 3일까지 캠페인', BASE)).toMatchObject({ date: '2026-11-20', endDate: '2026-12-03', title: '캠페인' })
  })
  it('"11/20~12/3", "11월 20일~12월 3일"', () => {
    expect(parseQuick('11/20~12/3 캠페인', BASE)).toMatchObject({ date: '2026-11-20', endDate: '2026-12-03', title: '캠페인' })
    expect(parseQuick('11월 20일 ~ 12월 3일 캠페인', BASE)).toMatchObject({ date: '2026-11-20', endDate: '2026-12-03', title: '캠페인' })
  })
  it('"2026-11-20 ~ 2026-12-03"', () => {
    expect(parseQuick('2026-11-20 ~ 2026-12-03 캠페인', BASE)).toMatchObject({ date: '2026-11-20', endDate: '2026-12-03', title: '캠페인' })
  })
  it('"내일부터 모레까지 출장"', () => {
    expect(parseQuick('내일부터 모레까지 출장', BASE)).toMatchObject({ date: '2026-11-12', endDate: '2026-11-13', title: '출장' })
  })
  it('해를 넘기는 기간: 12월 28일~1월 3일 → 끝은 다음 해', () => {
    expect(parseQuick('12월 28일~1월 3일 휴가', BASE)).toMatchObject({ date: '2026-12-28', endDate: '2027-01-03', title: '휴가' })
  })
  it('같은 날이면 하루 일정, 끝이 시작보다 빠르면(같은 해 안에서 되돌릴 수 없는 경우 제외) 기간으로 보지 않는다', () => {
    expect(parseQuick('11월 20일~11월 20일 워크숍', BASE).endDate).toBeUndefined()
  })
  it('기간 + 시간 + 반복도 함께 읽는다', () => {
    expect(parseQuick('11월 20일~11월 22일 오전 9시 워크숍', BASE)).toMatchObject({ date: '2026-11-20', endDate: '2026-11-22', start: '09:00', title: '워크숍' })
  })
  it('쓰는 줄에는 end: 가 붙는다', () => {
    expect(eventLine(parseQuick('11월 20일부터 12월 3일까지 캠페인', BASE))).toBe('- [ ] 캠페인 end:2026-12-03')
  })
})

describe('빠른 입력: 마감("까지")·매월 N일·이번/다음 달·요일 여러 개·시각 범위', () => {
  it('"다음주 월요일까지 과제 제출" → 그날, 제목에 "까지"가 남지 않는다', () => {
    expect(parseQuick('다음주 월요일까지 과제 제출', BASE)).toMatchObject({ date: '2026-11-16', title: '과제 제출' })
  })
  it('"11월 30일까지", "내일까지"', () => {
    expect(parseQuick('11월 30일까지 보고서', BASE)).toMatchObject({ date: '2026-11-30', title: '보고서' })
    expect(parseQuick('내일까지 시안 공유', BASE)).toMatchObject({ date: '2026-11-12', title: '시안 공유' })
  })
  it('"매월 1일" → 매월 반복, 다음에 오는 1일', () => {
    expect(parseQuick('매월 1일 월간 리포트', BASE)).toMatchObject({ date: '2026-12-01', repeat: 'monthly', title: '월간 리포트' })
    expect(parseQuick('매월 15일 정산', BASE)).toMatchObject({ date: '2026-11-15', repeat: 'monthly', title: '정산' })
  })
  it('오늘이 그 날이면 오늘(포함)', () => {
    expect(parseQuick('매월 11일 회비', BASE).date).toBe('2026-11-11')
  })
  it('"매월 31일" 은 그 달에 31일이 없으면 말일', () => {
    expect(parseQuick('매월 31일 마감', BASE).date).toBe('2026-11-30')
  })
  it('"다음 달 5일", "이번 달 25일"', () => {
    expect(parseQuick('다음달 5일 정산', BASE)).toMatchObject({ date: '2026-12-05', title: '정산' })
    expect(parseQuick('이번 달 25일 발표', BASE)).toMatchObject({ date: '2026-11-25', title: '발표' })
  })
  it('"매주 화,목", "매주 월수금" → 주간 반복 + 요일 목록, 시작은 가장 가까운 그 요일', () => {
    expect(parseQuick('매주 화,목 7시 수업', BASE)).toMatchObject({ date: '2026-11-12', repeat: 'weekly', repeatDays: [2, 4], title: '수업' })
    expect(parseQuick('매주 월수금 운동', BASE)).toMatchObject({ date: '2026-11-11', repeat: 'weekly', repeatDays: [1, 3, 5], title: '운동' }) // 오늘(수)도 후보라 오늘
    expect(parseQuick('매주 월금 운동', BASE).date).toBe('2026-11-13') // 오늘이 후보가 아니면 가장 가까운 금요일
  })
  it('"매주 수업" 같은 말을 요일로 잘못 읽지 않는다', () => {
    const q = parseQuick('매주 수업 준비', BASE)
    expect(q.repeatDays).toBeUndefined()
    expect(q.title).toContain('수업')
  })
  it('"매주 월요일"(요일 하나)은 예전 그대로', () => {
    expect(parseQuick('매주 월요일 10시 콘텐츠 발행', BASE)).toMatchObject({ date: '2026-11-16', repeat: 'weekly', title: '콘텐츠 발행' })
  })
  it('"3시~5시", "오후 3시-5시", "10시부터 12시까지"', () => {
    expect(parseQuick('내일 3시~5시 워크숍', BASE)).toMatchObject({ date: '2026-11-12', start: '15:00', end: '17:00', title: '워크숍' })
    expect(parseQuick('내일 오후 2시-4시 30분 회의', BASE)).toMatchObject({ start: '14:00', end: '16:30', title: '회의' })
    expect(parseQuick('내일 10시부터 12시까지 회의', BASE)).toMatchObject({ start: '10:00', end: '12:00', title: '회의' })
  })
  it('"오전 11시~1시" 는 끝을 오후로 읽는다', () => {
    expect(parseQuick('내일 오전 11시~1시 점심 세미나', BASE)).toMatchObject({ start: '11:00', end: '13:00' })
  })
  it('시각 하나는 예전 그대로("3시"=오후 3시, "3시 반")', () => {
    expect(parseQuick('내일 3시반 치과', BASE)).toMatchObject({ start: '15:30', title: '치과' })
    expect(parseQuick('내일 오전 9시 30분 수업', BASE)).toMatchObject({ start: '09:30' })
  })
  it('기간·시각 범위·반복을 한 문장에서 같이 읽는다', () => {
    expect(parseQuick('11월 20일~11월 22일 오전 9시~11시 워크숍', BASE)).toMatchObject({ date: '2026-11-20', endDate: '2026-11-22', start: '09:00', end: '11:00', title: '워크숍' })
  })
  it('쓰는 줄: 요일 목록·시각 범위가 그대로 적힌다', () => {
    expect(eventLine(parseQuick('매주 화,목 3시~5시 수업', BASE))).toBe('- [ ] 15:00-17:00 수업 repeat:weekly:tue,thu')
  })
})
