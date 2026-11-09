// 일정 알림: 앱(또는 PC 창)이 열려 있는 동안 시작 N분 전에 알린다.
// 앱이 완전히 꺼진 상태의 알림(안드로이드 네이티브)은 아직 지원하지 않는다.
import { useApp } from './app'
import { buildCalendar, todayYmd } from './calendar'
import { t } from './i18n'
import { CalendarBridge, isAndroid } from './nativeCal'

const fired = new Set<string>()

export async function askNotifyPermission(): Promise<boolean> {
  if (isAndroid()) {
    try {
      return (await CalendarBridge.requestNotify()).granted
    } catch {
      return false
    }
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

function tick() {
  const app = useApp.getState()
  const min = app.settings.remindMin
  if (min <= 0 || !app.ready) return
  const now = new Date()
  const today = todayYmd()
  const evs = buildCalendar(app.files).get(today) ?? []
  for (const e of evs) {
    if (!e.start || e.done) continue
    const [h, m] = e.start.split(':').map(Number)
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime()
    const diff = at - now.getTime()
    const id = e.id + '@' + today
    if (diff > min * 60000 || diff < -60000 || fired.has(id)) continue
    fired.add(id)
    const body = diff > 0 ? t('{n}분 후 {time}', { n: Math.max(1, Math.round(diff / 60000)), time: e.start }) : t('지금 시작: {time}', { time: e.start })
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(e.title, { body })
    else app.say(`${e.title} · ${body}`)
  }
}

let timer: ReturnType<typeof setInterval> | undefined
function run() {
  clearInterval(timer)
  timer = setInterval(tick, 30000)
  tick()
}
/** 본 창과 위젯이 함께 열려 있어도 한 창만 알림을 맡는다 (그 창이 닫히면 다른 창이 이어받는다) */
export function startReminders() {
  if (isAndroid()) return () => {} // 안드로이드는 네이티브 알람(앱이 꺼져 있어도 울림)이 맡는다
  const abort = new AbortController()
  if (navigator.locks) {
    void navigator.locks.request('nosidian-reminders', { signal: abort.signal }, () => new Promise<void>((resolve) => {
      run()
      abort.signal.addEventListener('abort', () => resolve())
    })).catch(() => {})
  } else run()
  return () => {
    abort.abort()
    clearInterval(timer)
  }
}
