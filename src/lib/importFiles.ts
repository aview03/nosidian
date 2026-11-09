import { t } from './i18n'
import { Capacitor } from '@capacitor/core'
import { useApp } from './app'
import { OpenFile, desktop, type DesktopApi, type ExternalSource, type Pending } from './externalIO'

export interface ImportItem {
  path: string
  content: string
  source?: ExternalSource
}

const NOTE_EXT = /\.(md|markdown|txt)$/i

/** 파일명을 노트 경로로: 확장자를 .md 로 맞추고, 금지 문자·숨김 폴더를 정리 */
export function toNotePath(name: string) {
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean)
  const clean = parts.map((p) => p.replace(/[:*?"<>|]/g, '').trim()).filter(Boolean)
  if (!clean.length || clean.some((p) => p.startsWith('.'))) return null
  const last = clean[clean.length - 1]
  clean[clean.length - 1] = NOTE_EXT.test(last) ? last.replace(NOTE_EXT, '.md') : last + '.md'
  return clean.join('/')
}

/** 파일 선택기를 열어 마크다운/텍스트 파일을 읽는다 (folder=true 면 폴더째 — 웹 전용) */
export function pickNotes(folder = false): Promise<ImportItem[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (folder) input.setAttribute('webkitdirectory', '')
    input.style.display = 'none'
    document.body.appendChild(input)
    const done = (v: ImportItem[]) => {
      input.remove()
      resolve(v)
    }
    input.addEventListener('cancel', () => done([]))
    input.addEventListener('change', async () => {
      const out: ImportItem[] = []
      for (const f of Array.from(input.files ?? [])) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
        if (!NOTE_EXT.test(f.name) || f.size > 5 * 1024 * 1024) continue
        const path = toNotePath(rel)
        if (path) out.push({ path, content: await f.text() })
      }
      done(out)
    })
    input.click()
  })
}

export async function importFromPicker(folder = false) {
  const items = await pickNotes(folder)
  const app = useApp.getState()
  if (!items.length) return app.say(t('가져올 마크다운(.md) 파일이 없어요'))
  app.importNotes(items)
}

// ── 다른 앱에서 열기 / 공유 (Android) ──
async function takePending() {
  const p = await OpenFile.getPending().catch(() => ({}) as Pending)
  const path = p.name !== undefined ? toNotePath(p.name) : null
  if (path && p.content !== undefined) useApp.getState().openExternal({ path, content: p.content, source: p.uri ? { kind: 'android', uri: p.uri } : undefined })
}

// ── Windows 앱: 탐색기 "연결 프로그램"/실행 인자로 들어온 파일 ──
async function takeDesktopFiles(api: DesktopApi) {
  const items: ImportItem[] = []
  for (const f of await api.takeFiles().catch(() => [])) {
    const path = toNotePath(f.name)
    if (path) items.push({ path, content: f.content, source: f.path ? { kind: 'desktop', path: f.path } : undefined })
  }
  openFirst(items)
}

/** 외부에서 연 파일은 vault 에 넣지 않고 열람만 한다 (여러 개면 첫 파일) */
function openFirst(items: ImportItem[]) {
  if (!items.length) return
  const app = useApp.getState()
  app.openExternal(items[0])
  if (items.length > 1) app.say(t('여러 파일 중 첫 번째만 열었습니다'))
}

/** 끌어다 놓은 파일의 원본 경로 (데스크톱 앱에서만 알 수 있다) */
function dropSource(f: File): ExternalSource | undefined {
  try {
    const p = desktop()?.pathForFile(f)
    return p ? { kind: 'desktop', path: p } : undefined
  } catch {
    return undefined
  }
}

/** 창으로 끌어다 놓은 .md 파일 가져오기 (놓았을 때 파일 자체로 이동해 버리는 기본 동작도 막는다) */
function listenDrop() {
  const over = (e: DragEvent) => e.preventDefault()
  const drop = async (e: DragEvent) => {
    e.preventDefault()
    const items: ImportItem[] = []
    for (const f of Array.from(e.dataTransfer?.files ?? [])) {
      if (!NOTE_EXT.test(f.name) || f.size > 5 * 1024 * 1024) continue
      const path = toNotePath(f.name)
      if (path) items.push({ path, content: await f.text(), source: dropSource(f) })
    }
    if (items.length) openFirst(items)
    else useApp.getState().say(t('가져올 마크다운(.md) 파일이 없어요'))
  }
  window.addEventListener('dragover', over)
  window.addEventListener('drop', drop)
  return () => {
    window.removeEventListener('dragover', over)
    window.removeEventListener('drop', drop)
  }
}

/** 앱 시작 시 한 번 호출. 이미 대기 중인 파일을 열고, 이후 들어오는 파일도 처리한다. */
export function listenExternalFiles() {
  const api = desktop()
  if (api) {
    void takeDesktopFiles(api)
    const off = api.onFiles(() => void takeDesktopFiles(api))
    const offDrop = listenDrop()
    return () => {
      off()
      offDrop()
    }
  }
  if (!Capacitor.isNativePlatform()) return listenDrop()
  void takePending()
  const h = OpenFile.addListener('fileOpened', () => void takePending())
  return () => void h.then((x) => x.remove())
}
