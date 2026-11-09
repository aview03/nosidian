// 한국 공휴일 + 음력 표시. 외부 데이터 없이 Intl 의 중국력(음력)으로 계산한다 → 오프라인 동작.
// 대체공휴일은 일반 규칙(토·일 겹침)만 반영한다. 임시공휴일·선거일은 포함하지 않는다.
import { t } from './i18n'

const p2 = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const addD = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

const lunarFmt = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric' })
const lunarCache = new Map<string, { m: number; d: number; leap: boolean } | null>()

/** 양력 날짜의 음력 월·일 */
export function lunarOf(d: Date) {
  const k = key(d)
  if (lunarCache.has(k)) return lunarCache.get(k)!
  let r: { m: number; d: number; leap: boolean } | null = null
  try {
    const parts = lunarFmt.formatToParts(d)
    const m = parts.find((x) => x.type === 'month')?.value ?? ''
    const day = parts.find((x) => x.type === 'day')?.value ?? ''
    if (/^\d+/.test(m) && day) r = { m: parseInt(m), d: parseInt(day), leap: /bis|윤/i.test(m) }
  } catch { /* Intl 이 중국력을 모르면 음력 표시만 빠진다 */ }
  lunarCache.set(k, r)
  return r
}

const yearCache = new Map<number, Map<string, string>>()

function build(year: number): Map<string, string> {
  const h = new Map<string, string>() // yyyy-mm-dd → 이름
  const subst = new Set<string>() // 대체공휴일 대상 날짜
  const overlap: Date[] = [] // 대체공휴일 대상 공휴일끼리 같은 날 겹친 경우 (예: 어린이날 + 부처님오신날)
  const put = (d: Date, name: string, sub = false) => {
    if (sub && h.has(key(d)) && subst.has(key(d))) overlap.push(d)
    h.set(key(d), name)
    if (sub) subst.add(key(d))
  }
  const fixed: [number, number, string, boolean][] = [
    [1, 1, '신정', false], [3, 1, '삼일절', true], [5, 5, '어린이날', true], [6, 6, '현충일', false],
    [8, 15, '광복절', true], [10, 3, '개천절', true], [10, 9, '한글날', true], [12, 25, '성탄절', true],
  ]
  for (const [m, d, n, s] of fixed) put(new Date(year, m - 1, d), n, s)

  const spans: { days: Date[]; ov: boolean }[] = []
  const span = (d: Date, a: string, b: string) => {
    const days = [addD(d, -1), d, addD(d, 1)]
    spans.push({ days, ov: days.some((x) => h.has(key(x))) }) // 다른 공휴일과 겹치는가
    put(days[0], a); put(d, b); put(days[2], a)
  }
  for (let i = 0; i < 366; i++) {
    const d = new Date(year, 0, 1 + i)
    if (d.getFullYear() !== year) break
    const l = lunarOf(d)
    if (!l || l.leap) continue
    if (l.m === 4 && l.d === 8) put(d, '부처님오신날', true)
    if (l.m === 1 && l.d === 1) span(d, '설날 연휴', '설날')
    if (l.m === 8 && l.d === 15) span(d, '추석 연휴', '추석')
  }
  // 대체공휴일
  const free = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6 && !h.has(key(d))
  const nextFree = (d: Date) => { let x = addD(d, 1); while (!free(x)) x = addD(x, 1); return x }
  for (const k of subst) {
    const [y, m, dd] = k.split('-').map(Number)
    const d = new Date(y, m - 1, dd)
    if (d.getDay() === 0 || d.getDay() === 6) put(nextFree(d), '대체공휴일')
  }
  for (const d of overlap) put(nextFree(d), '대체공휴일')
  for (const sp of spans) if (sp.ov || sp.days.some((d) => d.getDay() === 0)) put(nextFree(sp.days[2]), '대체공휴일')
  return h
}

/** 공휴일 이름 (없으면 null) */
export function holidayOf(ymd: string): string | null {
  const y = +ymd.slice(0, 4)
  let m = yearCache.get(y)
  if (!m) yearCache.set(y, (m = build(y)))
  const n = m.get(ymd)
  return n ? t(n) : null
}

/** 음력 라벨: 1일·15일 또는 달의 첫날만 "음 10.1" 형태로 (칸이 복잡해지지 않게) */
export function lunarLabel(d: Date): string | null {
  const l = lunarOf(d)
  if (!l || (l.d !== 1 && l.d !== 15)) return null
  return `${t('음')} ${l.leap ? t('윤') : ''}${l.m}.${l.d}`
}
