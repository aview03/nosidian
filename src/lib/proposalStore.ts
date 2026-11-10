// AI 변경 제안 보관·처리: 승인 대기 중인 제안을 기기에 보관하고, 승인하면 반영 직전에 다시 검증해서 쓴다.
//
// 제안은 vault 노트가 아니라 기기(localStorage, vault 별)에 둔다 — 아직 승인되지 않은 임시 값이고, 팀 동기화 대상이 아니다.
// 규칙 판정은 lib/proposals.ts · lib/docpolicy.ts (순수 함수)가 하고, 여기서는 그 결과를 저장소에 쓴다.
import { create } from 'zustand'
import { useApp } from './app'
import { t } from './i18n'
import { readRules } from './docrules'
import { contentHash, type AiRequest } from './docpolicy'
import { approve as approveCheck, newProposal, prune, triage, type FileOp, type Proposal, type Triage } from './proposals'
import { buildWork } from './work'

const keyOf = (vault: string | null) => `nosidian.proposals.${vault ?? 'local'}`

function read(vault: string | null): Proposal[] {
  try {
    const raw = localStorage.getItem(keyOf(vault))
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? (v as Proposal[]).filter((p) => p && typeof p.id === 'string' && p.req && typeof p.req.path === 'string') : []
  } catch {
    return []
  }
}
function write(vault: string | null, items: Proposal[]) {
  try {
    localStorage.setItem(keyOf(vault), JSON.stringify(items))
  } catch {
    /* 저장소를 못 쓰면 이번 실행에서만 유지 */
  }
}

/** 계산한 쓰기를 실제 저장소에 쓴다 */
export function execute(ops: FileOp[]) {
  const app = useApp.getState()
  for (const o of ops) {
    if (o.op === 'create') app.createNote(o.path, o.content, false)
    else if (o.op === 'set') app.setContent(o.path, o.content)
    else if (o.op === 'rename') app.renameNote(o.path, o.to)
    else app.deleteNote(o.path, { silent: true })
  }
}

const ctxNow = () => {
  const files = useApp.getState().files
  return { files, rules: readRules(files), projects: buildWork(files).projects }
}

interface ProposalStore {
  vault: string | null
  loaded: boolean
  items: Proposal[]
  /** 검토 화면이 열려 있나 */
  open: boolean
  /** 지금 vault 의 제안을 불러온다(vault 가 바뀌었을 때만) */
  ensure(): void
  setOpen(open: boolean): void
  /** AI 도구가 쓰기를 요청한다: 허용이면 바로 반영, 승인 대기면 제안으로 보관, 거절이면 아무것도 안 한다 */
  submit(req: AiRequest, by: string, summary?: string): Triage & { id?: string }
  /** 제안 하나(현재 vault) */
  find(id: string): Proposal | undefined
  approve(id: string): void
  reject(id: string): void
}

export const useProposals = create<ProposalStore>((set, get) => {
  const save = (items: Proposal[]) => {
    const next = prune(items)
    write(get().vault, next)
    set({ items: next })
  }
  const patch = (id: string, f: (p: Proposal) => Proposal) => save(get().items.map((p) => (p.id === id ? f(p) : p)))
  return {
    vault: null,
    loaded: false,
    items: [],
    open: false,
    ensure: () => {
      const vault = useApp.getState().settings.activeVault
      if (get().loaded && get().vault === vault) return
      set({ vault, items: read(vault), loaded: true })
    },
    setOpen: (open) => set({ open }),
    submit: (req, by, summary) => {
      get().ensure()
      const c = ctxNow()
      const r = triage(req, c.rules, c.projects, c.files)
      if (r.kind === 'apply') execute(r.ops)
      else if (r.kind === 'pending') {
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        save([...get().items, newProposal(req, r.verdict, by, summary, Date.now(), id)])
        useApp.getState().say(t('{by} 의 변경 제안이 승인을 기다리고 있어요', { by }))
        return { ...r, id }
      }
      return r
    },
    find: (id) => {
      get().ensure()
      return get().items.find((p) => p.id === id)
    },
    approve: (id) => {
      get().ensure()
      const p = get().items.find((x) => x.id === id)
      if (!p) return
      const c = ctxNow()
      const r = approveCheck(p, c.rules, c.projects, c.files) // 반영 직전 재검증
      if (!r.ok) {
        patch(id, (x) => ({ ...x, status: 'failed', failReason: r.reason, decidedAt: Date.now() }))
        useApp.getState().say(t('반영하지 못했어요 — 문서가 바뀌었거나 규칙이 허용하지 않아요'))
        return
      }
      execute(r.ops)
      patch(id, (x) => ({ ...x, status: 'applied', decidedAt: Date.now() }))
      useApp.getState().say(t('변경을 반영했어요'))
    },
    reject: (id) => patch(id, (x) => (x.status === 'pending' ? { ...x, status: 'rejected', decidedAt: Date.now() } : x)),
  }
})

// 개발·검증용: localStorage 'nosidian.dev' = '1' 이면 콘솔에서 제안을 직접 넣어 볼 수 있다(AI 도구가 아직 없어서). 평소에는 노출하지 않는다.
try {
  if (typeof window !== 'undefined' && localStorage.getItem('nosidian.dev') === '1') (window as unknown as { __proposals?: { store: typeof useProposals; contentHash: typeof contentHash; app: typeof useApp } }).__proposals = { store: useProposals, contentHash, app: useApp }
} catch {
  /* noop */
}
