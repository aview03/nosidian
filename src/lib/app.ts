import { create } from 'zustand'
import { store as db, onDbChange } from './db'
import { buildIndex, baseName, dirName, type LinkIndex } from './links'
import { DEFAULT_SETTINGS, DEFAULT_VAULT_ID, SYNC_LABEL, defaultVaultName, type CloudCfg, type NoteFile, type RemoteCfg, type Settings, type VaultMeta } from './types'
import { createProvider, isNote, bytesToB64, type Provider, type RemoteEntry } from './sync'
import { uploadPath, uploadProblem } from './attachments'
import { resumeWebAuth } from './sync/oauth'
import { demoNotes } from './demo'
import { t, setLang, resolveLang, getLang } from './i18n'
import { confirmAsk, choose } from './dialog'
import { writeSource, downloadText, type ExternalSource } from './externalIO'
import { mergeNote } from './merge'

export interface ExternalDoc {
  name: string
  content: string
  source?: ExternalSource
  dirty: boolean
  hideBanner?: boolean // 안내 배너를 무시함
}

export type Tab = 'note' | 'files' | 'search' | 'graph' | 'settings' | 'calendar' | 'today' | 'work' | 'project'

/** 앱을 켰을 때의 첫 화면(홈): PC·모바일 모두 내 업무. 안드로이드 뒤로가기의 종착지이기도 하다 */
export const homeTab = (): Tab => 'work'

const SETTINGS_KEY = 'amsidian.settings'
function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    // 이전 버전(GitHub 전용) 설정 이전
    if (raw.repo && !raw.remote) raw.remote = { kind: 'github', ...raw.repo }
    delete raw.repo
    // 단일 vault → 다중 vault 이전: 기존 데이터는 'default' vault 가 그대로 이어받는다
    if (!Array.isArray(raw.vaults)) {
      const had = !!(raw.remote || raw.demo)
      raw.vaults = had
        ? [{ id: DEFAULT_VAULT_ID, name: defaultVaultName(raw.remote ?? null), remote: raw.remote ?? null, bookmarks: raw.bookmarks ?? [], recent: raw.recent ?? [], lastSync: raw.lastSync ?? null }]
        : []
      raw.activeVault = had ? DEFAULT_VAULT_ID : null
    }
    delete raw.demo
    const s: Settings = { ...DEFAULT_SETTINGS, ...raw }
    // 화면 코드가 읽는 사본을 활성 vault 기준으로 맞춘다
    const v = s.vaults.find((x) => x.id === s.activeVault)
    return v
      ? { ...s, remote: v.remote, bookmarks: v.bookmarks, recent: v.recent, lastSync: v.lastSync }
      : { ...s, activeVault: null, remote: null, bookmarks: [], recent: [], lastSync: null }
  } catch {
    return DEFAULT_SETTINGS
  }
}

const NO_VAULT = '__none__'
const newVaultId = () => Math.random().toString(36).slice(2, 10)

const IMG_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
}
const live = (files: Record<string, NoteFile>) => Object.values(files).filter((f) => !f.deleted)

interface AppState {
  ready: boolean
  settings: Settings
  files: Record<string, NoteFile>
  assets: Record<string, { sha: string | null; id?: string; size?: number }>
  index: LinkIndex

  tab: Tab
  current: string | null
  anchor: string | null
  history: string[]
  hpos: number
  mode: 'read' | 'edit'
  sheet: null | 'info'
  palette: null | 'switcher' | 'command'
  syncing: boolean
  toast: string | null
  searchQuery: string
  vaultSheet: boolean
  /** 문서 안 찾기(Ctrl+F) 막대가 열려 있는가. findFocus 는 다시 누를 때마다 올라가 입력칸으로 포커스를 돌려준다 */
  findOpen: boolean
  findFocus: number
  /** vault 밖에서 열린 문서 (열람 전용, 가져오기를 눌러야 vault 에 사본이 생긴다) */
  external: ExternalDoc | null

  init(): Promise<void>
  /** 위젯 창: 동기화 없이 저장소만 읽는다 */
  initLocal(): Promise<void>
  /** 다른 창이 쓴 변경을 IndexedDB 에서 다시 읽어 합친다 */
  reloadFromDb(): Promise<void>
  patchSettings(p: Partial<Settings>): void
  go(tab: Tab): void
  openNote(path: string, anchor?: string | null, opts?: { replace?: boolean; edit?: boolean }): void
  openLink(target: string, anchor?: string | null): void
  back(): boolean
  forward(): void
  setMode(m: 'read' | 'edit'): void
  setSheet(s: 'info' | null): void
  setPalette(p: 'switcher' | 'command' | null): void
  setSearch(q: string): void
  openFind(): void
  closeFind(): void
  say(msg: string): void

  setContent(path: string, content: string): void
  createNote(path: string, content?: string, open?: boolean): string
  renameNote(path: string, newPath: string): void
  deleteNote(path: string, opts?: { silent?: boolean }): void
  /** 여러 노트를 한 번에 옮긴다(폴더 이동·이름 바꾸기). 목적지가 비어 있는 것만 옮기고, 옮긴 개수를 돌려준다. 노트 이름이 같아서 링크는 그대로다 */
  moveNotes(pairs: [string, string][], opts?: { silent?: boolean }): number
  /** 여러 노트를 한 번에 지운다(한 번만 색인을 다시 만든다). 지운 개수를 돌려준다 */
  deleteNotes(paths: string[], opts?: { silent?: boolean }): number
  openDaily(): void
  toggleBookmark(path: string): void
  toggleTask(path: string, line: number): void
  resolveConflict(path: string, how: 'local' | 'remote' | 'both'): void
  importNotes(items: { path: string; content: string }[]): Promise<void>
  openExternal(item: { path: string; content: string; source?: ExternalSource }): void
  setExternalContent(content: string): void
  dismissExternalBanner(): void
  saveExternal(): Promise<boolean>
  closeExternal(): Promise<void>
  importExternal(): Promise<void>

  addVault(name: string, opts?: { silent?: boolean }): Promise<void>
  switchVault(id: string): Promise<void>
  renameVault(id: string, name: string): void
  deleteVault(id: string): Promise<void>
  setVaultSheet(open: boolean): void

  connect(cfg: RemoteCfg): Promise<void>
  startDemo(): Promise<void>
  disconnect(): Promise<void>
  sync(retried?: boolean): Promise<void>
}

/** 400ms 디바운스로 저장 대기 중인 편집을 지금 바로 IndexedDB 에 쓴다 (작은 창을 닫기 직전에 호출) */
export async function flushPersist() {
  const paths = [...persistTimers.keys()]
  for (const p of paths) {
    clearTimeout(persistTimers.get(p))
    persistTimers.delete(p)
    const f = useApp.getState().files[p]
    if (f) await db.putFile(f)
  }
}

/** 현재 연결된 동기화 대상의 프로바이더 (토큰 갱신 시 설정에 자동 저장) */
export function providerOf(cfg: RemoteCfg): Provider {
  return createProvider(cfg, (c: CloudCfg) => useApp.getState().patchSettings({ remote: c }))
}

let rebuildTimer: ReturnType<typeof setTimeout> | undefined
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useApp = create<AppState>((set, get) => {
  const initialSettings = loadSettings()
  setLang(resolveLang(initialSettings.lang)) // 화면이 그려지기 전에 언어부터 정한다
  const rebuild = (now = false) => {
    const run = () => set({ index: buildIndex(live(get().files)) })
    clearTimeout(rebuildTimer)
    if (now) run()
    else rebuildTimer = setTimeout(run, 250)
  }
  const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(get().settings))
  /** 내용을 고친 노트. 처음 고치는 순간의 내용을 base 로 남겨 둔다(원격과 갈라졌을 때 줄 단위로 합치는 기준) */
  const edited = (f: NoteFile, content: string, mtime = Date.now()): NoteFile => ({ ...f, content, dirty: true, mtime, base: f.dirty ? f.base : f.content })
  const putFile = (f: NoteFile, debounce = false) => {
    set((s) => ({ files: { ...s.files, [f.path]: f } }))
    if (debounce) {
      clearTimeout(persistTimers.get(f.path))
      persistTimers.set(
        f.path,
        setTimeout(() => {
          persistTimers.delete(f.path)
          void db.putFile(get().files[f.path] ?? f)
        }, 400),
      )
    } else void db.putFile(f)
  }
  let watching = false
  const watchDb = () => {
    if (watching) return
    watching = true
    let timer: ReturnType<typeof setTimeout> | undefined
    onDbChange(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void get().reloadFromDb(), 150)
    })
  }
  const uniquePath = (path: string) => {
    const files = get().files
    if (!files[path] || files[path].deleted) return path
    const base = path.replace(/\.md$/i, '')
    for (let i = 2; ; i++) if (!files[`${base} ${i}.md`] || files[`${base} ${i}.md`].deleted) return `${base} ${i}.md`
  }

  /**
   * 노트 하나를 vault 에 들인다. 이미 같은 노트가 있으면 사본을 쌓지 않는다:
   * 내용이 같으면 그대로 그 노트, 다르면 덮어쓰기 / 다른 이름으로 저장(이름 (1)) 중에서 고르게 한다.
   * 취소하면 null.
   */
  const placeNote = async (it: { path: string; content: string }): Promise<{ path: string; created: boolean } | null> => {
    const norm = (t: string) => t.replace(/\r\n/g, '\n')
    const notes = live(get().files)
    const sameName = it.path.includes('/') ? [] : notes.filter((f) => baseName(f.path) === baseName(it.path))
    const match =
      notes.find((f) => f.path === it.path) ??
      notes.find((f) => baseName(f.path) === baseName(it.path) && norm(f.content) === norm(it.content)) ??
      (sameName.length === 1 ? sameName[0] : undefined)
    if (!match) return { path: get().createNote(it.path, it.content, false), created: true }
    if (norm(match.content) === norm(it.content)) return { path: match.path, created: false }
    const how = await choose(t('"{name}" 노트가 이미 있습니다', { name: baseName(match.path) }), t('내용이 다릅니다. 어떻게 할까요?'), [
      { value: 'overwrite', label: t('기존 노트에 덮어쓰기') },
      { value: 'copy', label: t('다른 이름으로 저장 (이름 (1))') },
    ])
    if (how === 'overwrite') {
      get().setContent(match.path, it.content)
      return { path: match.path, created: false }
    }
    if (how === 'copy') {
      const base = match.path.replace(/\.md$/i, '')
      let n = 1
      while (get().files[`${base} (${n}).md`] && !get().files[`${base} (${n}).md`].deleted) n++
      return { path: get().createNote(`${base} (${n}).md`, it.content, false), created: true }
    }
    return null
  }

  /** 대기 중인 디바운스 저장을 지금 현재 vault 의 저장소에 쓴다 (vault 를 바꾸기 전에 반드시 호출) */
  const flushPersist = async () => {
    const paths = [...persistTimers.keys()]
    for (const t of persistTimers.values()) clearTimeout(t)
    persistTimers.clear()
    const files = get().files
    await Promise.all(paths.map((p) => (files[p] ? db.putFile(files[p]) : undefined)))
  }

  /** 해당 vault 의 저장소를 열어 화면 상태를 통째로 바꾼다. id=null 이면 vault 없음(온보딩) */
  const enterVault = async (id: string | null) => {
    await db.use(id ?? NO_VAULT)
    assetUrls.clear()
    const v = id ? get().settings.vaults.find((x) => x.id === id) : undefined
    const files: Record<string, NoteFile> = {}
    const assets: AppState['assets'] = {}
    if (v) {
      const [fs, as] = await Promise.all([db.allFiles(), db.allAssets()])
      for (const f of fs) files[f.path] = f
      for (const a of as) assets[a.path] = { sha: a.sha, id: a.id, ...(a.size != null ? { size: a.size } : {}) }
    }
    set((s) => ({
      files,
      assets,
      // 시작할 때는 아무 노트도 열지 않는다 (홈 = 노트를 고르거나 추가하라는 안내). 최근 노트는 목록에서 고른다
      current: null,
      history: [],
      hpos: -1,
      anchor: null,
      sheet: null,
      palette: null,
      vaultSheet: false,
      tab: homeTab(),
      mode: 'read',
      searchQuery: '',
      settings: {
        ...s.settings,
        activeVault: v ? v.id : null,
        remote: v?.remote ?? null,
        bookmarks: v?.bookmarks ?? [],
        recent: v?.recent ?? [],
        lastSync: v?.lastSync ?? null,
      },
    }))
    saveSettings()
    rebuild(true)
  }

  return {
    ready: false,
    settings: initialSettings,
    files: {},
    assets: {},
    index: buildIndex([]),
    tab: homeTab(),
    current: null,
    anchor: null,
    history: [],
    hpos: -1,
    mode: 'read',
    sheet: null,
    palette: null,
    syncing: false,
    toast: null,
    searchQuery: '',
    vaultSheet: false,
    findOpen: false,
    findFocus: 0,
    external: null,

    async initLocal() {
      const id = get().settings.activeVault
      await db.use(id ?? NO_VAULT)
      const files: Record<string, NoteFile> = {}
      if (id) for (const f of await db.allFiles()) files[f.path] = f
      set({ files, ready: true })
      rebuild(true)
      watchDb()
    },
    async reloadFromDb() {
      const all = await db.allFiles()
      let changed = false
      const files = { ...get().files }
      for (const f of all) {
        const cur = files[f.path]
        if (persistTimers.has(f.path)) continue // 이 창이 아직 저장하지 못한 편집은 덮어쓰지 않는다
        if (!cur || cur.mtime < f.mtime || (cur.mtime === f.mtime && (cur.dirty !== f.dirty || cur.sha !== f.sha))) {
          files[f.path] = f
          changed = true
        }
      }
      if (changed) {
        set({ files })
        rebuild()
      }
    },
    async init() {
      await enterVault(get().settings.activeVault)
      set({ ready: true })
      watchDb()
      const { settings } = get()
      // 웹: 로그인 후 돌아온 경우 이어서 연결
      try {
        const back = await resumeWebAuth()
        if (back) return void (await get().connect(back))
      } catch (e) {
        get().say((e as Error).message)
      }
      if (settings.remote) setTimeout(() => void get().sync(), 300)
    },

    patchSettings(p) {
      if ('lang' in p) setLang(resolveLang(p.lang))
      set((s) => {
        const next = { ...s.settings, ...p }
        // 활성 vault 의 값이 바뀌면 vaults 목록에도 반영 (vault 마다 따로 저장)
        if (next.activeVault && ('remote' in p || 'bookmarks' in p || 'recent' in p || 'lastSync' in p)) {
          next.vaults = next.vaults.map((v) =>
            v.id === next.activeVault ? { ...v, remote: next.remote, bookmarks: next.bookmarks, recent: next.recent, lastSync: next.lastSync } : v,
          )
        }
        return { settings: next }
      })
      saveSettings()
    },
    go(tab) {
      set({ tab, sheet: null })
    },
    say(msg) {
      set({ toast: msg })
      setTimeout(() => get().toast === msg && set({ toast: null }), 2600)
    },

    openNote(path, anchor = null, opts = {}) {
      const s = get()
      if (!s.files[path] || s.files[path].deleted) return
      let { history, hpos } = s
      if (!opts.replace && history[hpos] !== path) {
        history = [...history.slice(0, hpos + 1), path].slice(-100)
        hpos = history.length - 1
      }
      const recent = [path, ...s.settings.recent.filter((r) => r !== path)].slice(0, 20)
      set({
        current: path,
        anchor,
        history,
        hpos,
        tab: 'note',
        sheet: null,
        palette: null,
        external: null,
        mode: opts.edit ? 'edit' : s.settings.startMode,
      })
      get().patchSettings({ recent })
    },
    openLink(target, anchor) {
      const s = get()
      const path = s.index.resolve(target, s.current ?? undefined)
      if (path) return s.openNote(path, anchor)
      if (!target.trim()) return
      const dir = s.current ? dirName(s.current) : ''
      const np = (dir ? dir + '/' : '') + target.replace(/[\\:*?"<>|]/g, '') + '.md'
      void confirmAsk(t('"{name}" 노트가 없습니다', { name: target }), t('새 노트로 만들까요?'), t('만들기')).then((ok) => {
        if (ok) get().createNote(np, `# ${target}\n\n`, true)
      })
    },
    back() {
      const { history, hpos } = get()
      if (hpos <= 0) return false
      set({ hpos: hpos - 1 })
      get().openNote(history[hpos - 1], null, { replace: true })
      return true
    },
    forward() {
      const { history, hpos } = get()
      if (hpos >= history.length - 1) return
      set({ hpos: hpos + 1 })
      get().openNote(history[hpos + 1], null, { replace: true })
    },
    setMode: (mode) => set({ mode }),
    setSheet: (sheet) => set({ sheet }),
    setPalette: (palette) => set({ palette }),
    setSearch: (searchQuery) => set({ searchQuery }),
    openFind() {
      const s = get()
      const f = s.current ? s.files[s.current] : null
      const shown = !!s.external || (!!f && !f.deleted)
      const visible = s.tab === 'note' || (s.tab !== 'graph' && s.tab !== 'settings' && s.tab !== 'calendar' && s.tab !== 'today' && s.tab !== 'work' && s.tab !== 'project' && window.matchMedia('(min-width: 900px)').matches)
      if (!shown || !visible) return
      set({ findOpen: true, findFocus: s.findFocus + 1 })
    },
    closeFind() {
      if (get().findOpen) set({ findOpen: false })
    },

    setContent(path, content) {
      const f = get().files[path]
      if (!f || f.content === content) return
      putFile(edited(f, content), true)
      rebuild()
    },
    createNote(path, content = '', open = true) {
      const p = uniquePath(path.endsWith('.md') ? path : path + '.md')
      const old = get().files[p]
      putFile({ path: p, content, sha: old?.sha ?? null, dirty: true, mtime: Date.now() })
      rebuild(true)
      if (open) get().openNote(p, null, { edit: true })
      return p
    },
    renameNote(path, newPath) {
      newPath = newPath.endsWith('.md') ? newPath : newPath + '.md'
      const s = get()
      const f = s.files[path]
      if (!f || newPath === path) return
      if (s.files[newPath] && !s.files[newPath].deleted) return get().say(t('같은 이름의 노트가 이미 있습니다'))
      const oldName = baseName(path)
      const newName = baseName(newPath)
      const now = Date.now()
      // 원본은 삭제 표시(tombstone), 새 경로로 복사
      putFile({ ...f, deleted: true, dirty: true, mtime: now })
      putFile({ path: newPath, content: f.content, sha: null, dirty: true, mtime: now })
      let updated = 0
      if (oldName !== newName) {
        const re = new RegExp(`(!?\\[\\[)${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\]#|])`, 'gi')
        for (const g of live(get().files)) {
          if (g.path === newPath) continue
          const next = g.content.replace(re, `$1${newName}`)
          if (next !== g.content) {
            putFile(edited(g, next, now))
            updated++
          }
        }
      }
      if (!f.sha) {
        // 원격에 없던 파일이면 tombstone 불필요
        void db.delFile(path)
        set((st) => {
          const files = { ...st.files }
          delete files[path]
          return { files }
        })
      }
      rebuild(true)
      set((st) => ({
        current: st.current === path ? newPath : st.current,
        history: st.history.map((h) => (h === path ? newPath : h)),
      }))
      get().patchSettings({
        bookmarks: get().settings.bookmarks.map((b) => (b === path ? newPath : b)),
        recent: get().settings.recent.map((b) => (b === path ? newPath : b)),
      })
      get().say(updated ? t('이름 변경 · 링크 {n}개 노트 갱신', { n: updated }) : t('이름을 변경했습니다'))
    },
    deleteNote(path, opts) {
      const f = get().files[path]
      if (!f) return
      if (f.sha) putFile({ ...f, deleted: true, dirty: true, mtime: Date.now() })
      else {
        void db.delFile(path)
        set((st) => {
          const files = { ...st.files }
          delete files[path]
          return { files }
        })
      }
      rebuild(true)
      const s = get()
      const history = s.history.filter((h) => h !== path)
      const cur = s.current === path ? (history[history.length - 1] ?? null) : s.current
      set({ history, hpos: history.length - 1, current: cur, tab: s.current === path ? 'files' : s.tab })
      get().patchSettings({
        bookmarks: s.settings.bookmarks.filter((b) => b !== path),
        recent: s.settings.recent.filter((b) => b !== path),
      })
      if (!opts?.silent) get().say(t('삭제했습니다 (다음 동기화 때 원격에서도 삭제)'))
    },
    moveNotes(pairs, opts) {
      const moved = new Map<string, string>()
      const now = Date.now()
      for (const [from, to] of pairs) {
        const f = get().files[from]
        const taken = get().files[to]
        if (!f || f.deleted || from === to || (taken && !taken.deleted)) continue
        putFile({ ...f, deleted: true, dirty: true, mtime: now })
        putFile({ path: to, content: f.content, sha: null, dirty: true, mtime: now })
        if (!f.sha) {
          // 원격에 없던 파일이면 tombstone 불필요
          void db.delFile(from)
          set((st) => {
            const files = { ...st.files }
            delete files[from]
            return { files }
          })
        }
        moved.set(from, to)
      }
      if (!moved.size) return 0
      rebuild(true)
      const map = (p: string) => moved.get(p) ?? p
      set((st) => ({ current: st.current ? map(st.current) : st.current, history: st.history.map(map) }))
      get().patchSettings({ bookmarks: get().settings.bookmarks.map(map), recent: get().settings.recent.map(map) })
      if (!opts?.silent) get().say(t('{n}개를 옮겼습니다', { n: moved.size }))
      return moved.size
    },
    deleteNotes(paths, opts) {
      const gone = new Set<string>()
      for (const path of paths) {
        const f = get().files[path]
        if (!f || f.deleted) continue
        if (f.sha) putFile({ ...f, deleted: true, dirty: true, mtime: Date.now() })
        else {
          void db.delFile(path)
          set((st) => {
            const files = { ...st.files }
            delete files[path]
            return { files }
          })
        }
        gone.add(path)
      }
      if (!gone.size) return 0
      rebuild(true)
      const s = get()
      const history = s.history.filter((h) => !gone.has(h))
      const cur = s.current && gone.has(s.current) ? (history[history.length - 1] ?? null) : s.current
      set({ history, hpos: history.length - 1, current: cur, tab: s.current && gone.has(s.current) ? 'files' : s.tab })
      get().patchSettings({ bookmarks: s.settings.bookmarks.filter((b) => !gone.has(b)), recent: s.settings.recent.filter((b) => !gone.has(b)) })
      if (!opts?.silent) get().say(t('{n}개를 삭제했습니다 (다음 동기화 때 원격에서도 삭제)', { n: gone.size }))
      return gone.size
    },
    openDaily() {
      const d = new Date()
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const folder = get().settings.dailyFolder.trim().replace(/\/$/, '')
      const path = (folder ? folder + '/' : '') + ymd + '.md'
      const f = get().files[path]
      if (f && !f.deleted) get().openNote(path, null, { edit: true })
      else get().createNote(path, `# ${ymd}\n\n## ${t('할 일')}\n- [ ] \n\n## ${t('메모')}\n\n`)
    },
    toggleBookmark(path) {
      const b = get().settings.bookmarks
      get().patchSettings({ bookmarks: b.includes(path) ? b.filter((x) => x !== path) : [...b, path] })
    },
    toggleTask(path, line) {
      const f = get().files[path]
      if (!f) return
      const lines = f.content.split('\n')
      const l = lines[line]
      if (l === undefined) return
      if (/\[ \]/.test(l) && /(?:^|\s)kind:(?:decision|결정|미결|안건|issue)(?=\s|$)/i.test(l) && !/(?:^|\s)=>\s*\S/.test(l)) {
        get().say(t('결정 안건은 결론을 적어야 닫을 수 있어요. 내 업무에서 안건을 눌러 결론을 적어 주세요.'))
        return
      }
      lines[line] = /\[ \]/.test(l) ? l.replace('[ ]', '[x]') : l.replace(/\[[xX]\]/, '[ ]')
      get().setContent(path, lines.join('\n'))
    },
    resolveConflict(path, how) {
      const f = get().files[path]
      if (!f?.conflict) return
      const c = f.conflict
      if (how === 'remote') putFile({ ...f, content: c.content, sha: c.sha, dirty: false, conflict: undefined, base: undefined })
      else if (how === 'local') putFile({ ...f, sha: c.sha, dirty: true, conflict: undefined, base: c.content })
      else {
        putFile({ ...f, sha: c.sha, dirty: true, conflict: undefined, base: c.content })
        get().createNote(path.replace(/\.md$/i, '') + ' (' + t('원격 버전') + ').md', c.content, false)
      }
      rebuild(true)
    },

    async importNotes(items) {
      if (!items.length) return
      // vault 가 없으면(처음 실행) 로컬 전용 vault 를 만들어 넣는다. 있으면 지금 열려 있는 vault 로 들어간다
      if (!get().settings.activeVault) await get().addVault(t('내 노트'), { silent: true })
      const paths: string[] = []
      let created = 0
      for (const it of items) {
        const r = await placeNote(it)
        if (!r) continue
        paths.push(r.path)
        if (r.created) created++
      }
      if (!paths.length) return
      rebuild(true)
      if (paths.length === 1) get().openNote(paths[0])
      else get().go('files')
      const sync = get().settings.remote ? t(' · 동기화하면 올라가요') : ''
      get().say(paths.length === 1 ? `${t('노트를 열었습니다')}${created ? sync : ''}` : `${t('노트 {n}개를 가져왔습니다', { n: created })}${sync}`)
    },

    openExternal(item) {
      set({ external: { name: item.path, content: item.content, source: item.source, dirty: false }, tab: 'note', sheet: null, palette: null, mode: get().settings.startMode })
    },
    dismissExternalBanner() {
      const e = get().external
      if (e) set({ external: { ...e, hideBanner: true } })
    },
    setExternalContent(content) {
      const e = get().external
      if (e && e.content !== content) set({ external: { ...e, content, dirty: true } })
    },
    /** 원본 파일에 저장한다. 원본을 모르는 문서는 파일로 내려받는다 */
    async saveExternal() {
      const e = get().external
      if (!e) return false
      const written = e.content
      try {
        if (e.source) await writeSource(e.source, written)
        else downloadText(e.name, written)
        set((s) => (s.external ? { external: { ...s.external, dirty: s.external.content !== written } } : {}))
        get().say(e.source ? t('저장했습니다') : t('파일로 내려받았습니다'))
        return true
      } catch {
        get().say(t('원본에 저장할 수 없어요 · "vault 로 가져오기"로 보관할 수 있어요'))
        return false
      }
    },
    async closeExternal() {
      const e = get().external
      if (!e) return
      if (e.dirty) {
        const how = await choose(t('"{name}" 변경 사항이 있습니다', { name: baseName(e.name) }), t('저장하지 않고 닫으면 수정한 내용이 사라집니다.'), [
          { value: 'save', label: t('저장하고 닫기') },
          { value: 'discard', label: t('저장하지 않고 닫기') },
        ])
        if (how === null) return
        if (how === 'save' && !(await get().saveExternal())) return
      }
      set({ external: null })
    },
    async importExternal() {
      const ext = get().external
      if (!ext) return
      if (!get().settings.activeVault) await get().addVault(t('내 노트'), { silent: true })
      const r = await placeNote({ path: ext.name, content: ext.content })
      if (!r) return
      rebuild(true)
      get().openNote(r.path)
      get().say(r.created ? t('vault 에 가져왔습니다') : t('vault 의 노트를 열었습니다'))
    },

    // ── vault ──
    async addVault(name, opts) {
      if (get().syncing) return get().say(t('동기화가 끝난 뒤에 만들 수 있어요'))
      await flushPersist()
      const meta: VaultMeta = { id: newVaultId(), name: name.trim() || t('내 노트'), remote: null, bookmarks: [], recent: [], lastSync: null }
      set((s) => ({ settings: { ...s.settings, vaults: [...s.settings.vaults, meta] } }))
      await enterVault(meta.id)
      if (!opts?.silent) get().say(t('"{name}" vault를 만들었습니다', { name: meta.name }))
    },
    async switchVault(id) {
      const s = get()
      if (id === s.settings.activeVault) return set({ vaultSheet: false })
      const v = s.settings.vaults.find((x) => x.id === id)
      if (!v) return
      if (s.syncing) return get().say(t('동기화가 끝난 뒤에 전환할 수 있어요'))
      await flushPersist()
      await enterVault(id)
      get().say(`"${v.name}"`)
      // 연결된 vault 는 오래됐으면 전환하면서 한 번 동기화
      if (v.remote && (!v.lastSync || Date.now() - v.lastSync > 60_000)) setTimeout(() => void get().sync(), 200)
    },
    renameVault(id, name) {
      const n = name.trim()
      if (!n) return
      set((s) => ({ settings: { ...s.settings, vaults: s.settings.vaults.map((v) => (v.id === id ? { ...v, name: n } : v)) } }))
      saveSettings()
    },
    async deleteVault(id) {
      const s = get()
      if (s.syncing) return get().say(t('동기화가 끝난 뒤에 삭제할 수 있어요'))
      if (!s.settings.vaults.some((v) => v.id === id)) return
      await flushPersist()
      const rest = s.settings.vaults.filter((v) => v.id !== id)
      set((st) => ({ settings: { ...st.settings, vaults: rest } }))
      if (s.settings.activeVault === id) await enterVault(rest[0]?.id ?? null)
      else saveSettings()
      await db.drop(id) // 로컬 사본과 로그인 정보만 지운다. 원격(GitHub·Drive 등)은 그대로
    },
    setVaultSheet: (vaultSheet) => set({ vaultSheet }),

    async connect(cfg) {
      await providerOf(cfg).test()
      // vault 가 없으면 이 연결로 첫 vault 를 만든다
      if (!get().settings.activeVault) await get().addVault(defaultVaultName(cfg), { silent: true })
      // 연결 전에 만들거나 가져온 로컬 노트(원격에 없는 새 파일)는 지우지 않고 첫 동기화 때 올린다
      const keep = Object.values(get().files).filter((f) => f.dirty && !f.sha && !f.deleted)
      await db.clearAll()
      await db.putFiles(keep)
      assetUrls.clear()
      set({ files: Object.fromEntries(keep.map((f) => [f.path, f])), assets: {}, current: null, history: [], hpos: -1 })
      get().patchSettings({ remote: cfg, lastSync: null, bookmarks: [], recent: [] })
      await get().sync()
    },
    async startDemo() {
      await get().addVault(t('예제 노트'), { silent: true })
      const demo = demoNotes(getLang(), get().settings.dailyFolder.trim().replace(/\/$/, '') || undefined)
      const files: Record<string, NoteFile> = {}
      for (const [path, content] of Object.entries(demo.notes)) files[path] = { path, content, sha: null, dirty: false, mtime: Date.now() }
      await db.putFiles(Object.values(files))
      set({ files, assets: {} })
      rebuild(true)
      get().openNote(demo.home)
    },
    /** 이 vault 의 동기화 연결을 끊고 로컬 사본도 비운다 (vault 자체는 남는다) */
    async disconnect() {
      await db.clearAll()
      assetUrls.clear()
      set({ files: {}, assets: {}, current: null, history: [], hpos: -1, index: buildIndex([]) })
      get().patchSettings({ remote: null, lastSync: null, bookmarks: [], recent: [] })
    },

    async sync(retried = false) {
      const { settings, syncing } = get()
      const cfg = settings.remote
      if (!cfg || syncing) return
      set({ syncing: true })
      try {
        const prov = providerOf(cfg)
        // ── pull ──
        const { entries, truncated } = await prov.list()
        if (truncated) get().say(t('저장소가 너무 커서 일부만 불러왔습니다'))
        const remote = new Map<string, RemoteEntry>()
        const assets: AppState['assets'] = {}
        for (const e of entries) {
          if (isNote(e.path)) remote.set(e.path, e)
          else assets[e.path] = { sha: e.rev, id: e.id, ...(e.size != null ? { size: e.size } : {}) }
        }
        const files = { ...get().files }
        const toFetch: RemoteEntry[] = []
        const changed: NoteFile[] = []
        let merged = 0
        for (const [path, e] of remote) {
          const l = files[path]
          if (!l) toFetch.push(e)
          else if (l.sha !== e.rev) {
            if (l.deleted) continue // 로컬 삭제 대기 중
            if (l.dirty) {
              if (l.conflict?.sha !== e.rev) toFetch.push(e)
            } else toFetch.push(e)
          }
        }
        // 원격에서 사라진 파일
        for (const l of Object.values(files)) {
          if (remote.has(l.path)) continue
          if (l.sha && !l.dirty) {
            delete files[l.path]
            void db.delFile(l.path)
          } else if (l.sha && l.dirty && !l.deleted) {
            files[l.path] = { ...l, sha: null } // 원격에서 지워졌지만 로컬 수정 있음 → 새 파일로 다시 올림
          } else if (l.deleted && !l.sha) {
            delete files[l.path]
            void db.delFile(l.path)
          }
        }
        let done = 0
        const queue = [...toFetch]
        const worker = async () => {
          for (let e = queue.shift(); e; e = queue.shift()) {
            const content = await prov.readText(e)
            const l = files[e.path]
            if (l?.dirty && !l.deleted) {
              // 내가 고치는 중인데 원격도 바뀌었다 → 고친 줄이 겹치지 않으면 자동으로 합친다
              const r = mergeNote(l, { sha: e.rev, content })
              files[e.path] = r.file
              if (r.auto) merged++
            } else files[e.path] = { path: e.path, content, sha: e.rev, dirty: false, mtime: Date.now() }
            changed.push(files[e.path])
            if (++done % 10 === 0) get().say(t('가져오는 중… {done}/{total}', { done, total: toFetch.length }))
          }
        }
        await Promise.all(Array.from({ length: 6 }, worker))
        await db.putFiles(changed)
        for (const p of Object.keys(get().assets)) if (!assets[p]) void db.delAsset(p) // 원격에서 사라진 파일·이미지
        for (const [p, a] of Object.entries(assets)) void db.putAsset({ path: p, sha: a.sha, id: a.id, ...(a.size != null ? { size: a.size } : {}) })
        set({ files, assets })
        rebuild(true)

        // ── push ──
        const pending = Object.values(get().files).filter((f) => f.dirty && !f.conflict && !(f.deleted && !f.sha))
        let pushed = 0
        if (pending.length) {
          const msg =
            pending.length === 1
              ? `Nosidian: ${pending[0].deleted ? 'delete' : 'update'} ${baseName(pending[0].path)}`
              : `Nosidian: sync ${pending.length} notes`
          const revs = await prov.push(
            pending.map((f) => ({ path: f.path, content: f.deleted ? null : f.content })),
            msg,
          )
          const next = { ...get().files }
          const upd: NoteFile[] = []
          for (const f of pending) {
            if (f.deleted) {
              delete next[f.path]
              void db.delFile(f.path)
            } else {
              // 푸시하는 사이 편집이 있었다면 dirty 유지
              const cur = next[f.path]
              const stillDirty = cur.content !== f.content
              next[f.path] = { ...cur, sha: revs.get(f.path)!, dirty: stillDirty, base: stillDirty ? f.content : undefined }
              upd.push(next[f.path])
            }
          }
          await db.putFiles(upd)
          set({ files: next })
          pushed = pending.length
        }
        get().patchSettings({ lastSync: Date.now() })
        const conflicts = Object.values(get().files).filter((f) => f.conflict).length
        get().say(
          conflicts
            ? t('동기화 완료 · 충돌 {n}건 확인 필요', { n: conflicts })
            : merged
              ? t('동기화 완료 · 받음 {pulled} · 올림 {pushed} · 자동 병합 {merged}', { pulled: toFetch.length, pushed, merged })
              : t('동기화 완료 · 받음 {pulled} · 올림 {pushed}', { pulled: toFetch.length, pushed }),
        )
      } catch (e) {
        const err = e as Error & { status?: number }
        if ((err.status === 422 || err.status === 409) && !retried) {
          // 올리는 사이 다른 사람이 먼저 올렸다 → 한 번은 알아서 다시 받아 합친 뒤 올려 본다
          set({ syncing: false })
          return await get().sync(true)
        }
        get().say(
          err.status === 422 || err.status === 409
            ? t('원격이 먼저 변경되었습니다. 다시 동기화해 주세요')
            : t('{name} 동기화 실패: {msg}', { name: SYNC_LABEL[cfg.kind], msg: err.message }),
        )
      } finally {
        set({ syncing: false })
      }
    },
  }
})

// ── 자산(이미지) ──
const assetUrls = new Map<string, Promise<string | null>>()
/**
 * 파일들을 vault 저장소의 dir 폴더에 올린다(노트가 아닌 파일). 하나씩 올려서 실패한 것만 따로 알린다.
 * 반환: 올린 경로들과 실패(이름·이유)
 */
export async function uploadOthers(list: File[], dir: string): Promise<{ done: string[]; failed: { name: string; why: string }[] }> {
  const { settings } = useApp.getState()
  if (!settings.remote) throw new Error(t('저장소에 연결돼 있지 않아요'))
  const prov = providerOf(settings.remote)
  const done: string[] = []
  const failed: { name: string; why: string }[] = []
  for (const f of list) {
    const why = uploadProblem(f.name, f.size)
    if (why) {
      failed.push({ name: f.name, why })
      continue
    }
    try {
      const st = useApp.getState()
      const path = uploadPath(dir, f.name, new Set([...Object.keys(st.assets), ...Object.keys(st.files)]))
      const b64 = bytesToB64(await f.arrayBuffer())
      const revs = await prov.push([{ path, content: '', b64 }], t('파일 추가: {name}', { name: path.split('/').pop()! }))
      const rev = revs.get(path) ?? null
      const a = { sha: rev, size: f.size }
      useApp.setState((s) => ({ assets: { ...s.assets, [path]: a } }))
      void db.putAsset({ path, sha: rev, size: f.size })
      done.push(path)
    } catch (e) {
      failed.push({ name: f.name, why: e instanceof Error ? e.message : String(e) })
    }
  }
  return { done, failed }
}

/** 올린 파일(노트가 아닌 파일) 하나를 저장소에서 지운다. 다른 기기에서도 다음 동기화 때 사라진다 */
export async function deleteOther(path: string): Promise<void> {
  const { settings, assets } = useApp.getState()
  if (!settings.remote) throw new Error(t('저장소에 연결돼 있지 않아요'))
  if (!assets[path]) return
  const prov = providerOf(settings.remote)
  await prov.push([{ path, content: null }], t('파일 삭제: {name}', { name: path.split('/').pop()! }))
  useApp.setState((s) => {
    const next = { ...s.assets }
    delete next[path]
    return { assets: next }
  })
  void db.delAsset(path)
}

/** 노트·이미지가 아닌 파일 하나를 원격 저장소에서 받아 base64 로 돌려준다(저장해 두지 않는다) */
export async function fetchOther(path: string): Promise<string> {
  const { settings, assets } = useApp.getState()
  const a = assets[path]
  if (!settings.remote || !a?.sha) throw new Error(t('저장소에 연결돼 있지 않아요'))
  return providerOf(settings.remote).readBase64({ path, rev: a.sha, id: a.id })
}

export function loadAsset(path: string): Promise<string | null> {
  if (!path) return Promise.resolve(null)
  let p = assetUrls.get(path)
  if (!p) {
    p = (async () => {
      const { settings, assets } = useApp.getState()
      const vid = settings.activeVault
      const mime = IMG_MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'
      const all = await db.allAssets()
      let rec = all.find((a) => a.path === path)
      if (!rec?.b64) {
        if (!settings.remote || !assets[path]?.sha) return null
        const b64 = await providerOf(settings.remote).readBase64({ path, rev: assets[path].sha!, id: assets[path].id })
        rec = { path, sha: assets[path].sha, id: assets[path].id, b64, mime }
        if (useApp.getState().settings.activeVault !== vid) return null
        await db.putAsset(rec)
      }
      const bin = atob(rec.b64!)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return URL.createObjectURL(new Blob([bytes], { type: mime }))
    })().catch(() => null)
    assetUrls.set(path, p)
  }
  return p
}

export function resolveAsset(name: string, from?: string): string | null {
  const assets = Object.keys(useApp.getState().assets)
  const n = name.replace(/^\.?\//, '')
  if (from) {
    const rel = (dirName(from) ? dirName(from) + '/' : '') + n
    if (assets.includes(rel)) return rel
  }
  if (assets.includes(n)) return n
  const low = n.toLowerCase()
  return assets.find((a) => a.toLowerCase() === low || a.toLowerCase().endsWith('/' + low)) ?? null
}
