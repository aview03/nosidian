// 안드로이드: 일정 스냅샷을 네이티브(홈 화면 위젯)로, 알림 목록을 AlarmManager 로 넘긴다.
// 앱이 꺼져 있어도 위젯이 그려지고 알림이 울리게 하는 다리. 노트가 바뀔 때마다 조금 기다렸다가 한 번에 보낸다.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { useApp } from './app'
import { addDays, buildCalendar, todayYmd } from './calendar'
import { holidayOf } from './holidays'
import { t } from './i18n'

interface Reminder { id: number; at: number; title: string; body: string; date: string }
interface Bridge {
  setSnapshot(o: { snapshot: string; reminders: Reminder[] }): Promise<void>
  notifyStatus(): Promise<{ granted: boolean }>
  requestNotify(): Promise<{ granted: boolean }>
  pinWidget(o: { type: 'month' | 'agenda' }): Promise<void>
}
export const CalendarBridge = registerPlugin<Bridge>('CalendarBridge')
export const isAndroid = () => Capacitor.getPlatform() === 'android'

const hash = (s: string) => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 2000000000
}

export function buildPayload() {
  const s = useApp.getState()
  const cal = buildCalendar(s.files)
  const today = todayYmd()
  const from = addDays(today, -35)
  const days = 155 // 지난 35일 ~ 앞으로 120일
  const ev: [string, string, string, number][] = []
  const hol: string[] = []
  for (let i = 0; i < days && ev.length < 1500; i++) {
    const d = addDays(from, i)
    for (const e of cal.get(d) ?? []) ev.push([d, e.start ?? '', e.title, e.done ? 1 : 0])
    if (s.settings.calHolidays && holidayOf(d)) hol.push(d)
  }

  const reminders: Reminder[] = []
  const min = s.settings.remindMin
  if (min > 0) {
    const now = Date.now()
    for (let i = 0; i < 8 && reminders.length < 60; i++) {
      const d = addDays(today, i)
      for (const e of cal.get(d) ?? []) {
        if (!e.start || e.done) continue
        const [y, m, dd] = d.split('-').map(Number)
        const [h, mi] = e.start.split(':').map(Number)
        const start = new Date(y, m - 1, dd, h, mi).getTime()
        const at = start - min * 60000
        if (at <= now) continue
        reminders.push({ id: hash(e.id + '@' + d), at, title: e.title, body: t('{n}분 후 {time}', { n: min, time: e.start }), date: d })
      }
    }
  }
  return { snapshot: JSON.stringify({ ev, hol }), reminders }
}

async function push() {
  try {
    await CalendarBridge.setSnapshot(buildPayload())
  } catch {
    /* 플러그인이 없는 빌드(웹 등)에서는 조용히 넘어간다 */
  }
}

export function startNativeBridge() {
  if (!isAndroid()) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void push(), 1200)
  }
  const unsub = useApp.subscribe((s, prev) => {
    if (s.files !== prev.files || s.settings.remindMin !== prev.settings.remindMin || s.settings.calHolidays !== prev.settings.calHolidays || s.settings.activeVault !== prev.settings.activeVault) later()
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer)
      void push()
    }
  }
  document.addEventListener('visibilitychange', onHide)
  void push()
  return () => {
    clearTimeout(timer)
    unsub()
    document.removeEventListener('visibilitychange', onHide)
  }
}
