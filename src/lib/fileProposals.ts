// AI 의 "파일 제안": Claude 등이 노트(.md)가 아닌 텍스트 파일(.py·.json·.csv …)을 vault 저장소에 만들도록 제안한다.
//
// 노트 제안(proposalStore)과 달리 정책 엔진의 자동 반영이 없다 — **항상 사람의 승인**을 받아야 올라간다.
// 안전 규칙(checkAiFile): 텍스트만(도구 인자가 글이라서), 허용 확장자만(실행 파일·스크립트 제외), 200KB 이하,
// 숨김·상위 경로·_workspace/ 불가, 이미 있는 파일은 덮어쓰지 않는다. 승인 전에는 저장소에 아무것도 올라가지 않는다.
// 제안은 기기(localStorage, vault 별)에 보관한다(노트 제안과 같다).
import { create } from 'zustand'
import { uploadAiFile, useApp } from './app'
import { t } from './i18n'

/** AI 가 만들 수 있는 텍스트 파일 확장자. 실행 파일·스크립트(.exe·.bat·.ps1·.sh …)와 노트(.md)·이미지는 제외 */
export const AI_FILE_EXT = new Set(['txt', 'json', 'csv', 'tsv', 'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'xml', 'yaml', 'yml', 'toml', 'ini', 'sql', 'log'])
export const AI_FILE_MAX_BYTES = 200 * 1024

export type FileDeny = 'badPath' | 'protected' | 'badExt' | 'empty' | 'tooBig' | 'exists' | 'noRemote'

export const FILE_DENY_HINT: Record<FileDeny, string> = {
  badPath: 'Use a relative path like "tools/clean.py" (no "..", no hidden folders).',
  protected: 'Files under _workspace/ can never be created by AI.',
  badExt: `Only these text file types can be proposed: ${[...AI_FILE_EXT].join(', ')}. Notes (.md) go through propose_change.`,
  empty: '`content` must not be empty.',
  tooBig: 'The file is too large (max 200 KB of text).',
  exists: 'A file already exists at that path. Propose a different path; files are never overwritten.',
  noRemote: 'No storage (GitHub/Drive/OneDrive) is connected in Nosidian, so files cannot be created. Tell the person.',
}

export type FileCheck = { ok: true; path: string } | { ok: false; reason: FileDeny }

/** 경로 정리와 규칙 검사(순수). taken: 이미 있는 경로들(노트·파일·대기 중 제안) */
export function checkAiFile(rawPath: string, content: string, taken: Set<string>, hasRemote = true): FileCheck {
  const p = rawPath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  const segs = p.split('/')
  if (!p || p.length > 300 || segs.some((s) => !s || s === '.' || s === '..' || s.startsWith('.') || /[\u0000-\u001f<>:"|?*]/.test(s))) return { ok: false, reason: 'badPath' }
  if (p.toLowerCase().startsWith('_workspace/')) return { ok: false, reason: 'protected' }
  const name = segs[segs.length - 1]
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || !AI_FILE_EXT.has(name.slice(dot + 1).toLowerCase())) return { ok: false, reason: 'badExt' }
  if (!content.trim()) return { ok: false, reason: 'empty' }
  if (new TextEncoder().encode(content).length > AI_FILE_MAX_BYTES) return { ok: false, reason: 'tooBig' }
  if (!hasRemote) return { ok: false, reason: 'noRemote' }
  const lower = p.toLowerCase()
  if ([...taken].some((x) => x.toLowerCase() === lower)) return { ok: false, reason: 'exists' }
  return { ok: true, path: p }
}

export interface FileProposal {
  id: string
  createdAt: number
  /** 제안한 쪽(예: "앱 안 Claude") */
  by: string
  summary?: string
  path: string
  content: string
  status: 'pending' | 'uploaded' | 'rejected' | 'failed'
  error?: string
  decidedAt?: number
}

const keyOf = (vault: string | null) => `nosidian.fileprops.${vault ?? 'local'}`
const MAX_KEEP = 40

function read(vault: string | null): FileProposal[] {
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(vault)) ?? '[]') as unknown
    return Array.isArray(v) ? (v as FileProposal[]).filter((p) => p && typeof p.id === 'string' && typeof p.path === 'string' && typeof p.content === 'string') : []
  } catch {
    return []
  }
}
function write(vault: string | null, items: FileProposal[]) {
  try {
    localStorage.setItem(keyOf(vault), JSON.stringify(items))
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}
/** 처리한 제안은 최근 것만 남긴다(대기 중인 것은 모두) */
function prune(items: FileProposal[]): FileProposal[] {
  const pending = items.filter((p) => p.status === 'pending')
  const done = items.filter((p) => p.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)).slice(0, MAX_KEEP)
  return [...pending, ...done].sort((a, b) => a.createdAt - b.createdAt)
}

interface FileProposalStore {
  vault: string | null
  loaded: boolean
  items: FileProposal[]
  ensure(): void
  /** 제안한다. 규칙에 맞으면 승인 대기로 보관하고(저장소에는 아직 아무것도 안 올린다), 아니면 거절 이유를 돌려준다 */
  submit(req: { path: string; content: string }, by: string, summary?: string): { kind: 'pending'; id: string } | { kind: 'denied'; reason: FileDeny }
  find(id: string): FileProposal | undefined
  /** 승인: 저장소에 올린다. 올리지 못하면 failed 로 남기고 이유를 돌려준다 */
  approve(id: string): Promise<void>
  reject(id: string): void
}

export const useFileProposals = create<FileProposalStore>((set, get) => {
  const save = (items: FileProposal[]) => {
    const next = prune(items)
    write(get().vault, next)
    set({ items: next })
  }
  return {
    vault: null,
    loaded: false,
    items: [],
    ensure() {
      const vault = useApp.getState().settings.activeVault ?? null
      if (get().loaded && get().vault === vault) return
      set({ vault, loaded: true, items: read(vault) })
    },
    submit(req, by, summary) {
      get().ensure()
      const app = useApp.getState()
      const taken = new Set([...Object.keys(app.assets), ...Object.keys(app.files), ...get().items.filter((p) => p.status === 'pending').map((p) => p.path)])
      const r = checkAiFile(req.path, req.content, taken, !!app.settings.remote)
      if (!r.ok) return { kind: 'denied', reason: r.reason }
      const id = `fp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      save([...get().items, { id, createdAt: Date.now(), by, ...(summary ? { summary } : {}), path: r.path, content: req.content, status: 'pending' }])
      return { kind: 'pending', id }
    },
    find: (id) => get().items.find((p) => p.id === id),
    async approve(id) {
      get().ensure()
      const p = get().items.find((x) => x.id === id)
      if (!p || p.status !== 'pending') return
      try {
        await uploadAiFile(p.path, p.content)
        save(get().items.map((x) => (x.id === id ? { ...x, status: 'uploaded', decidedAt: Date.now() } : x)))
        useApp.getState().say(t('올렸어요: {name}', { name: p.path.split('/').pop()! }))
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        save(get().items.map((x) => (x.id === id ? { ...x, status: 'failed', error, decidedAt: Date.now() } : x)))
        useApp.getState().say(t('올리지 못했어요: {name} — {why}', { name: p.path.split('/').pop()!, why: error }))
      }
    },
    reject(id) {
      save(get().items.map((x) => (x.id === id && x.status === 'pending' ? { ...x, status: 'rejected', decidedAt: Date.now() } : x)))
    },
  }
})
