// 일정 = 마크다운. 별도 DB 없이 노트에서 파생한다.
//  1) Daily 노트(파일명이 YYYY-MM-DD) 안의 체크리스트 한 줄:  - [ ] 14:00-15:00 치과
//  2) 다른 노트의 체크리스트에 @YYYY-MM-DD 가 붙은 줄:        - [ ] 보고서 제출 @2026-11-20
//  3) 프론트매터에 date 가 있는 노트 (end, time, color 선택):  date: 2026-11-12
import { create } from 'zustand'
import { useApp } from './app'
import { splitFrontmatter, baseName } from './links'
import { t, getLang } from './i18n'
import type { NoteFile } from './types'
import { desktop } from './externalIO'

export interface CalEvent {
  id: string
  date: string // 이 이벤트가 놓이는 날 (YYYY-MM-DD)
  start?: string // HH:MM
  end?: string
  title: string
  done: boolean
  kind: 'task' | 'note'
  path: string
  line: number // task 일 때 줄 번호 (toggleTask 용)
  color?: string
  span?: [string, string] // 기간 일정이면 [시작일, 종료일]
  repeat?: Repeat
  repeatDays?: number[] // 매주 반복일 때 요일 (0=일 … 6=토). 비어 있으면 시작일과 같은 요일
  until?: string
  inst?: boolean // 반복으로 펼쳐진 복제본 (체크 불가)
  cont?: boolean // 며칠에 걸친 일정의 둘째 날부터
  origDate?: string // 원본(시작일). 복제본·연속일에서도 원본 날짜를 알 수 있게
  srcDaily?: boolean // Daily 노트의 줄인가 (날짜가 바뀌면 그날 Daily 노트로 옮겨야 함)
}
export type Repeat = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays'
const REP_ALIAS: Record<string, Repeat> = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly', weekdays: 'weekdays', 매일: 'daily', 매주: 'weekly', 매월: 'monthly', 매년: 'yearly', 평일: 'weekdays' }
const DAYN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_IDX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
export const REPEAT_LABEL: Record<Repeat, string> = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년', weekdays: '평일' }

// ── 날짜 유틸 (로컬 시간 기준) ──
const p2 = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const todayYmd = () => ymd(new Date())
export const addDays = (s: string, n: number) => {
  const d = parseYmd(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
export const monthStart = (s: string) => s.slice(0, 7) + '-01'
export function addMonths(s: string, n: number) {
  const d = parseYmd(monthStart(s))
  d.setMonth(d.getMonth() + n)
  return ymd(d)
}
/** 월간 그리드: 일요일 시작, 항상 6주(42칸) */
export function monthGrid(month: string): string[] {
  const first = parseYmd(monthStart(month))
  const start = addDays(ymd(first), -first.getDay())
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}
/** 선택한 날이 속한 주 (일~토) */
export const weekOf = (d: string): [string, string] => {
  const start = addDays(d, -parseYmd(d).getDay())
  return [start, addDays(start, 6)]
}
export const fmtShort = (s: string) => parseYmd(s).toLocaleDateString(getLang(), { month: 'short', day: 'numeric' })
export const fmtMonth = (s: string) => parseYmd(s).toLocaleDateString(getLang(), { year: 'numeric', month: 'long' })
export const fmtDay = (s: string) => parseYmd(s).toLocaleDateString(getLang(), { month: 'long', day: 'numeric', weekday: 'short' })
export const weekdayLabels = () =>
  Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(getLang(), { weekday: 'short' }))

// ── 파싱 ──
const DATE_NAME = /^(\d{4}-\d{2}-\d{2})$/
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/
const TIME = /^(\d{1,2}):(\d{2})(?:\s*[-–~]\s*(\d{1,2}):(\d{2}))?\s*/
const REP = /(?:^|\s)repeat:(daily|weekly|monthly|yearly|weekdays|매일|매주|매월|매년|평일)(?::([a-z,]+))?(?=\s|$)/i
const END = /(?:^|\s)end:(\d{4}-\d{2}-\d{2})(?=\s|$)/
const UNTIL = /(?:^|\s)until:(\d{4}-\d{2}-\d{2})(?=\s|$)/
const AT_DATE = /(?:^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)/

const hhmm = (h: string, m: string) => `${p2(Math.min(23, +h))}:${m}`

export function isDailyName(path: string) {
  return DATE_NAME.test(baseName(path))
}

function fmDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(+v)) return `${v.getUTCFullYear()}-${p2(v.getUTCMonth() + 1)}-${p2(v.getUTCDate())}` // js-yaml 은 날짜를 UTC 로 읽는다
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return null
}

function parseFile(f: NoteFile): CalEvent[] {
  const out: CalEvent[] = []
  const daily = isDailyName(f.path) ? baseName(f.path) : null
  const lines = f.content.split('\n')
  let fence = false
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence
    if (fence) return
    const m = TASK.exec(raw)
    if (!m) return
    let text = m[2].trim()
    let date = daily
    const at = AT_DATE.exec(text)
    if (at) {
      date = at[1]
      text = text.replace(at[0], ' ').trim()
    }
    let repeat: Repeat | undefined, until: string | undefined, repeatDays: number[] | undefined, endDate: string | undefined
    const rp = REP.exec(text)
    if (rp) {
      repeat = REP_ALIAS[rp[1].toLowerCase()] ?? REP_ALIAS[rp[1]]
      if (rp[2]) {
        const ds = rp[2].toLowerCase().split(',').map((x) => DAY_IDX[x]).filter((x) => x !== undefined)
        if (ds.length) repeatDays = ds
      }
      text = text.replace(rp[0], ' ').trim()
    }
    const en = END.exec(text)
    if (en) { endDate = en[1]; text = text.replace(en[0], ' ').trim() }
    const un = UNTIL.exec(text)
    if (un) { until = un[1]; text = text.replace(un[0], ' ').trim() }
    if (!date) return
    let start: string | undefined, end: string | undefined
    const tm = TIME.exec(text)
    if (tm) {
      start = hhmm(tm[1], tm[2])
      if (tm[3]) end = hhmm(tm[3], tm[4])
      text = text.slice(tm[0].length).trim()
    }
    if (!text) return
    out.push({ id: `${f.path}:${i}`, date, start, end, title: text, done: m[1] !== ' ', kind: 'task', path: f.path, line: i, repeat, repeatDays, until, span: endDate && endDate > date ? [date, endDate] : undefined, origDate: date, srcDaily: !!daily })
  })

  if (!daily && f.content.startsWith('---') && /\bdate\s*:/.test(f.content.slice(0, 600))) {
    const { fm } = splitFrontmatter(f.content)
    const d = fmDate(fm.date)
    if (d) {
      const e = fmDate(fm.end)
      const time = typeof fm.time === 'string' ? TIME.exec(fm.time) : null
      out.push({
        id: `${f.path}:fm`,
        date: d,
        start: time ? hhmm(time[1], time[2]) : undefined,
        end: time?.[3] ? hhmm(time[3], time[4]) : undefined,
        title: typeof fm.title === 'string' && fm.title ? fm.title : baseName(f.path),
        done: false,
        kind: 'note',
        path: f.path,
        line: 0,
        origDate: d,
        color: typeof fm.color === 'string' ? fm.color : undefined,
        span: e && e > d ? [d, e] : undefined,
        repeat: typeof fm.repeat === 'string' ? REP_ALIAS[fm.repeat.toLowerCase()] ?? REP_ALIAS[fm.repeat] : undefined,
        until: fmDate(fm.until) ?? undefined,
      })
    }
  }
  return out
}

// 파일 내용이 그대로면 다시 파싱하지 않는다 (입력 중에도 가볍게)
const cache = new Map<string, { content: string; events: CalEvent[] }>()
function eventsOf(f: NoteFile): CalEvent[] {
  const c = cache.get(f.path)
  if (c && c.content === f.content) return c.events
  const events = parseFile(f)
  cache.set(f.path, { content: f.content, events })
  return events
}

const byTime = (a: CalEvent, b: CalEvent) =>
  Number(!!a.start) === Number(!!b.start) ? (a.start ?? '').localeCompare(b.start ?? '') : a.start ? 1 : -1 // 하루종일(시간 없음) 먼저

export function buildCalendar(files: Record<string, NoteFile>): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()
  const seen = new Set<string>()
  const horizon = addDays(todayYmd(), 730)
  for (const f of Object.values(files)) {
    if (f.deleted) continue
    seen.add(f.path)
    for (const ev of eventsOf(f)) {
      const days = ev.span ? Math.min(366, Math.round((+parseYmd(ev.span[1]) - +parseYmd(ev.span[0])) / 864e5)) : 0
      for (let k = 0; k <= days; k++) {
        const day = k ? addDays(ev.date, k) : ev.date
        const arr = map.get(day)
        const e = k ? { ...ev, date: day, cont: true } : ev
        if (arr) arr.push(e)
        else map.set(day, [e])
      }
      if (ev.repeat) {
        const stop = ev.until && ev.until < horizon ? ev.until : horizon
        const base = parseYmd(ev.date)
        const pushInst = (d: string) => {
          const arr = map.get(d)
          const e = { ...ev, date: d, inst: true, id: `${ev.id}:${d}`, done: false, span: undefined, cont: undefined }
          if (arr) arr.push(e)
          else map.set(d, [e])
        }
        if (ev.repeat === 'weekly' && ev.repeatDays?.length) {
          // 매주 월·수·금 처럼 요일을 골라 반복
          for (let i = 1, n = 0; i <= 730 && n < 900; i++) {
            const d = addDays(ev.date, i)
            if (d > stop) break
            if (ev.repeatDays.includes(parseYmd(d).getDay())) { pushInst(d); n++ }
          }
        } else {
          let n = 0
          for (let i = 1; i < 900; i++) {
            let d: string
            if (ev.repeat === 'daily') d = addDays(ev.date, i)
            else if (ev.repeat === 'weekly') d = addDays(ev.date, 7 * i)
            else if (ev.repeat === 'weekdays') {
              d = addDays(ev.date, i + n)
              while ([0, 6].includes(parseYmd(d).getDay())) d = addDays(d, 1)
              n = (+parseYmd(d) - +base) / 864e5 - i
            } else if (ev.repeat === 'monthly') {
              const x = new Date(base.getFullYear(), base.getMonth() + i, base.getDate())
              if (x.getDate() !== base.getDate()) continue // 31일 등 없는 달은 건너뜀
              d = ymd(x)
            } else {
              const x = new Date(base.getFullYear() + i, base.getMonth(), base.getDate())
              if (x.getMonth() !== base.getMonth()) continue
              d = ymd(x)
            }
            if (d > stop) break
            pushInst(d)
          }
        }
      }
    }
  }
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)
  for (const arr of map.values()) arr.sort(byTime)
  return map
}

// ── 날짜 색상: Daily 노트 프론트매터의 color ──
export const DAY_COLORS = ['#d01010', '#e07a00', '#d4a800', '#2a9d5c', '#2a6fd6', '#8a4fd6']
const NL = String.fromCharCode(10)
/** 맨 앞 프론트매터 구간의 끝(닫는 --- 가 시작하는 위치). 없으면 -1 */
const fmEnd = (c: string) => (c.startsWith('---') ? c.indexOf(NL + '---', 3) : -1)
export function buildDayColors(files: Record<string, NoteFile>): Map<string, string> {
  const m = new Map<string, string>()
  for (const f of Object.values(files)) {
    if (f.deleted || !f.content.startsWith('---') || !isDailyName(f.path)) continue
    const end = fmEnd(f.content)
    if (end < 0) continue
    const c = /^color:\s*["']?(#[0-9a-fA-F]{3,8}|\w+)["']?\s*$/m.exec(f.content.slice(0, end))
    if (c) m.set(baseName(f.path), c[1])
  }
  return m
}
export function setDayColor(date: string, color: string | null) {
  if (!color && !useApp.getState().files[dailyPath(date)]) return
  const path = ensureDaily(date)
  const c = useApp.getState().files[path].content
  const end = fmEnd(c)
  let out: string
  if (end > 0) {
    const rest = c.slice(end + 4)
    const lines = c.slice(4, end).split(NL).filter((l) => !/^color:/.test(l))
    if (color) lines.push(`color: "${color}"`)
    const keep = lines.filter((l) => l.trim())
    out = keep.length ? ['---', ...keep, '---'].join(NL) + rest : rest.replace(/^\r?\n/, '')
  } else out = color ? ['---', `color: "${color}"`, '---', ''].join(NL) + c : c
  useApp.getState().setContent(path, out)
  if (!color) pruneDaily(path) // 색을 지워서 뼈대만 남았으면 정리
}

// ── 빠른 입력 (자연어) ──
const WD = '일월화수목금토'
/** 일정 입력값 (빠른 입력 · 편집기 공용) */
export interface Quick {
  date: string
  endDate?: string // 며칠에 걸친 일정의 마지막 날
  start?: string
  end?: string
  title: string
  repeat?: Repeat
  repeatDays?: number[]
  until?: string
}

export function parseQuick(input: string, base: string): Quick {
  let s = ' ' + input.trim() + ' '
  let date = base
  const now = todayYmd()
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(s)
    if (m) {
      fn(m)
      s = s.replace(m[0], ' ')
    }
  }
  // 날짜
  take(/\s(\d{4})-(\d{1,2})-(\d{1,2})(?=\s)/, (m) => (date = `${m[1]}-${p2(+m[2])}-${p2(+m[3])}`))
  take(/\s(?:(\d{1,2})월\s*(\d{1,2})일)(?=\s|\D)/, (m) => {
    const y = parseYmd(base).getFullYear()
    date = `${y}-${p2(+m[1])}-${p2(+m[2])}`
  })
  take(/\s(\d{1,2})\/(\d{1,2})(?=\s)/, (m) => (date = `${parseYmd(base).getFullYear()}-${p2(+m[1])}-${p2(+m[2])}`))
  take(/\s(오늘|내일|모레|글피)(?=\s|\D)/, (m) => (date = addDays(now, { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 }[m[1]] ?? 0)))
  take(/\s(다음\s*주|이번\s*주)?\s*([일월화수목금토])요일(?=\s)/, (m) => {
    const cur = parseYmd(now)
    const idx = WD.indexOf(m[2])
    if (m[1]?.startsWith('다음')) date = addDays(now, 7 - cur.getDay() + idx) // 다음 주 일요일 + 요일
    else if (m[1]) date = addDays(now, idx - cur.getDay()) // 이번 주
    else date = addDays(now, idx - cur.getDay() + (idx < cur.getDay() ? 7 : 0)) // 가장 가까운 그 요일
  })
  let repeat: Repeat | undefined
  take(/\s(매일|매주|매월|매년|평일)(?=\s|\D)/, (m) => (repeat = REP_ALIAS[m[1]]))
  // 시간
  let start: string | undefined, end: string | undefined
  take(/\s(\d{1,2}):(\d{2})(?:\s*[-~]\s*(\d{1,2}):(\d{2}))?(?=\s)/, (m) => {
    start = hhmm(m[1], m[2])
    if (m[3]) end = hhmm(m[3], m[4])
  })
  if (!start)
    take(/\s(오전|오후|아침|저녁|밤)?\s*(\d{1,2})시(?:\s*(?:(\d{1,2})분|(반)))?(?=\s|\D)/, (m) => {
      let h = +m[2]
      const pm = m[1] === '오후' || m[1] === '저녁' || m[1] === '밤'
      if (pm && h < 12) h += 12
      else if (!m[1] && h >= 1 && h <= 6) h += 12 // "3시" 는 보통 오후 3시
      start = `${p2(h % 24)}:${m[4] ? '30' : p2(+(m[3] ?? 0))}`
    })
  const title = s.replace(/\s+/g, ' ').trim()
  return { date, start, end, title: title || input.trim(), repeat }
}

// ── 쓰기 ──
export function dailyPath(date: string) {
  const folder = useApp.getState().settings.dailyFolder.trim().replace(/\/$/, '')
  return (folder ? folder + '/' : '') + date + '.md'
}
const dailyTemplate = (date: string, body = '- [ ] ') => `# ${date}\n\n## ${t('할 일')}\n${body}\n\n## ${t('메모')}\n\n`

// ── 비어 버린 Daily 노트 정리 ──
const TEMPLATE_HEADINGS = new Set(['할 일', '메모', 'to do', 'todo', 'notes', 'tasks'])
/** 템플릿 뼈대만 남았는가: 제목(# 날짜)·'할 일/메모' 소제목·빈 체크박스·빈 줄뿐이고 내용이 하나도 없다.
 *  프론트매터(날짜 색 등)가 있으면 데이터가 있는 것으로 본다 */
function isSkeleton(content: string): boolean {
  if (content.startsWith('---')) return false
  const names = new Set([...TEMPLATE_HEADINGS, t('할 일').toLowerCase(), t('메모').toLowerCase()])
  return content.split('\n').every((l) => {
    const x = l.trim()
    if (!x) return true
    if (/^#\s+\d{4}-\d{2}-\d{2}$/.test(x)) return true
    const h = /^#{2}\s+(.+)$/.exec(x)
    if (h) return names.has(h[1].trim().toLowerCase())
    return /^[-*+]\s+\[ \]\s*$/.test(x)
  })
}

/** 일정·메모를 모두 지워서 뼈대만 남은 Daily 노트는 파일이 필요 없으니 지운다 (동기화하면 원격에서도 삭제됨) */
export function pruneDaily(path: string) {
  const app = useApp.getState()
  const f = app.files[path]
  if (!f || f.deleted || !isDailyName(path) || !isSkeleton(f.content)) return
  app.deleteNote(path, { silent: true })
}

/** 지금 vault 에 이미 있는 '뼈대만 남은' Daily 노트를 모두 지운다. 지운 개수를 돌려준다.
 *  (메모·일정·소제목·날짜 색이 하나라도 있는 노트는 건드리지 않는다) */
export function pruneAllDaily(): number {
  const app = useApp.getState()
  let n = 0
  for (const f of Object.values(app.files)) {
    if (f.deleted || !isDailyName(f.path) || !isSkeleton(f.content)) continue
    app.deleteNote(f.path, { silent: true })
    n++
  }
  return n
}

/** 그날의 Daily 노트가 있으면 경로를, 없으면 만들어서 경로를 돌려준다 */
export function ensureDaily(date: string, open = false): string {
  const app = useApp.getState()
  const path = dailyPath(date)
  const f = app.files[path]
  if (f && !f.deleted) {
    if (open) app.openNote(path, null, { edit: true })
    return path
  }
  return app.createNote(path, dailyTemplate(date), open)
}

/** 노트 열기. 위젯 창이면 본 창을 띄워서 거기서 연다 */
export function openPath(path: string, edit = false) {
  const w = desktop()?.widget
  if (isWidgetWindow() && w) return w.openNote(path)
  useApp.getState().openNote(path, null, edit ? { edit: true } : undefined)
}
export function openDay(date: string) {
  openPath(ensureDaily(date, false), true)
}
export const isWidgetWindow = () => new URLSearchParams(location.search).has('widget')

/** 일정 한 줄. withAt: Daily 노트가 아닌 노트에 두는 줄이라 날짜를 @로 붙인다 */
export function eventLine(q: Quick, done = false, withAt = false) {
  const parts = [`- [${done ? 'x' : ' '}]`]
  if (q.start) parts.push(q.start + (q.end ? '-' + q.end : ''))
  parts.push(q.title.replace(/\s+/g, ' ').trim())
  if (withAt) parts.push('@' + q.date)
  if (q.endDate && q.endDate > q.date) parts.push('end:' + q.endDate)
  if (q.repeat) {
    const days = q.repeat === 'weekly' && q.repeatDays?.length ? ':' + [...q.repeatDays].sort().map((d) => DAYN[d]).join(',') : ''
    parts.push('repeat:' + q.repeat + days)
    if (q.until) parts.push('until:' + q.until)
  }
  return parts.join(' ')
}

/** 편집기에 채울 값 (반복 복제본·연속일이어도 원본 기준) */
export function quickOf(ev: CalEvent): Quick {
  return { title: ev.title, date: ev.origDate ?? ev.date, endDate: ev.span?.[1], start: ev.start, end: ev.end, repeat: ev.repeat, repeatDays: ev.repeatDays, until: ev.until }
}

export function updateEvent(ev: CalEvent, q: Quick) {
  const app = useApp.getState()
  const f = app.files[ev.path]
  if (!f || ev.kind !== 'task') return
  const lines = f.content.split('\n')
  const cur = lines[ev.line]
  if (cur === undefined) return
  const done = /\[[xX]\]/.test(cur)
  if (ev.srcDaily && q.date !== (ev.origDate ?? ev.date)) {
    // 날짜가 바뀌면 그 날의 Daily 노트로 옮긴다
    lines.splice(ev.line, 1)
    app.setContent(ev.path, lines.join('\n'))
    addEvent(q, done)
    pruneDaily(ev.path) // 옮기고 나서 원래 날이 비었으면 정리
    return
  }
  lines[ev.line] = (/^(\s*)/.exec(cur)?.[1] ?? '') + eventLine(q, done, !ev.srcDaily)
  app.setContent(ev.path, lines.join('\n'))
}

export function deleteEvent(ev: CalEvent) {
  const app = useApp.getState()
  const f = app.files[ev.path]
  if (!f || ev.kind !== 'task') return
  const lines = f.content.split('\n')
  if (lines[ev.line] === undefined) return
  lines.splice(ev.line, 1)
  app.setContent(ev.path, lines.join('\n'))
  pruneDaily(ev.path) // 마지막 일정을 지웠으면 빈 노트는 남기지 않는다
}

// ── 날짜 메모창(한 줄에 일정 하나): Daily 노트의 '단순 일정' 줄을 글로 보여 주고 다시 저장 ──
/** 반복·기간이 없는 그날 Daily 노트의 체크리스트 줄 (메모창에서 글로 편집하는 대상) */
function simpleEvents(date: string): CalEvent[] {
  const f = useApp.getState().files[dailyPath(date)]
  if (!f || f.deleted) return []
  return eventsOf(f).filter((e) => e.kind === 'task' && e.srcDaily && e.origDate === date && !e.repeat && !e.span && e.line >= 0)
}

/** 메모창에 보일 글: 한 줄 = 일정 하나. 완료한 일은 앞에 ✓ */
export function dayText(date: string): string {
  return simpleEvents(date)
    .map((e) => (e.done ? '✓ ' : '') + (e.start ? e.start + (e.end ? '-' + e.end : '') + ' ' : '') + e.title)
    .join('\n')
}

/** 메모창의 글을 그날의 일정으로 저장. "내일 3시 치과"처럼 쓰면 다른 날짜/시간으로 풀어서 옮긴다 */
export function saveDayText(date: string, text: string) {
  const app = useApp.getState()
  const mine: string[] = []
  const moved: Quick[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const done = /^[✓✔]\s*/.test(line)
    const body = line.replace(/^[✓✔]\s*/, '')
    const q = parseQuick(body, date)
    if (q.date === date) mine.push(eventLine(q, done))
    else moved.push(q)
  }
  const path = dailyPath(date)
  const f = app.files[path]
  const old = simpleEvents(date).map((e) => e.line).sort((a, b) => a - b)
  if (!f || f.deleted) {
    if (mine.length) app.createNote(path, dailyTemplate(date, mine.join('\n')), false)
  } else if (old.length || mine.length) {
    const lines = f.content.split('\n')
    const at = old.length ? old[0] : -1
    for (const i of [...old].reverse()) lines.splice(i, 1)
    if (at >= 0) lines.splice(at, 0, ...mine)
    else {
      const blank = lines.findIndex((l) => /^\s*-\s+\[ \]\s*$/.test(l))
      if (blank >= 0) lines.splice(blank, 1, ...mine)
      else {
        let last = -1
        lines.forEach((l, i) => TASK.test(l) && (last = i))
        if (last >= 0) lines.splice(last + 1, 0, ...mine)
        else lines.push(...(f.content.endsWith('\n') ? [] : ['']), ...mine, '')
      }
    }
    app.setContent(path, lines.join('\n'))
  }
  for (const q of moved) addEvent(q)
  pruneDaily(path) // 글을 모두 지웠으면 빈 노트는 남기지 않는다
}

/** 메모창에서는 글로 못 다루는 일정(반복·기간·다른 노트의 일정) — 눌러서 편집기로 연다 */
export function otherEvents(all: CalEvent[], date: string): CalEvent[] {
  const simple = new Set(simpleEvents(date).map((e) => e.id))
  return all.filter((e) => !simple.has(e.id))
}

export function addEvent(q: Quick, done = false) {
  const app = useApp.getState()
  const line = eventLine(q, done)
  const path = dailyPath(q.date)
  const f = app.files[path]
  if (!f || f.deleted) {
    app.createNote(path, dailyTemplate(q.date, line), false)
    return
  }
  const lines = f.content.split('\n')
  const blank = lines.findIndex((l) => /^\s*-\s+\[ \]\s*$/.test(l))
  if (blank >= 0) lines[blank] = line // 템플릿의 빈 체크박스 자리를 채운다
  else {
    let last = -1
    lines.forEach((l, i) => TASK.test(l) && (last = i))
    if (last >= 0) lines.splice(last + 1, 0, line)
    else lines.push(...(f.content.endsWith('\n') ? [] : ['']), line, '')
  }
  app.setContent(path, lines.join('\n'))
}

// ── 화면 상태 (캘린더 전용, 저장하지 않음) ──
interface CalState {
  sel: string
  month: string
  view: 'month' | 'week' | 'agenda'
  focusAdd: number
  editor: null | { date: string; ev?: CalEvent }
  openEditor(date: string, ev?: CalEvent): void
  closeEditor(): void
  select(d: string): void
  shift(n: number): void
  goToday(): void
  setView(v: 'month' | 'week' | 'agenda'): void
  focus(): void
}
export const useCal = create<CalState>((set, get) => ({
  sel: todayYmd(),
  month: monthStart(todayYmd()),
  view: 'month',
  focusAdd: 0,
  editor: null,
  openEditor: (date, ev) => set({ editor: { date, ev } }),
  closeEditor: () => set({ editor: null }),
  select: (d) => set({ sel: d, month: d.slice(0, 7) === get().month.slice(0, 7) ? get().month : monthStart(d) }),
  shift: (n) => {
    if (get().view === 'week') {
      const sel = addDays(get().sel, 7 * n)
      return set({ sel, month: monthStart(sel) })
    }
    const month = addMonths(get().month, n)
    set({ month, sel: month }) // 달을 넘기면 그 달 1일을 고른다
  },
  goToday: () => set({ sel: todayYmd(), month: monthStart(todayYmd()) }),
  setView: (view) => set({ view }),
  focus: () => set({ focusAdd: get().focusAdd + 1 }),
}))

/** 이벤트 목록에서 구간 [from, from+days) 을 날짜별로 */
export function range(cal: Map<string, CalEvent[]>, from: string, days: number) {
  const out: [string, CalEvent[]][] = []
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i)
    const ev = cal.get(d)
    if (ev?.length) out.push([d, ev])
  }
  return out
}
