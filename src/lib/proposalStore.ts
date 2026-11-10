// AI 변경 제안 보관·처리: 승인 대기 중인 제안을 기기에 보관하고, 승인하면 반영 직전에 다시 검증해서 쓴다.
//
// 제안은 vault 노트가 아니라 기기(localStorage, vault 별)에 둔다 — 아직 승인되지 않은 임시 값이고, 팀 동기화 대상이 아니다.
// 규칙 판정은 lib/proposals.ts · lib/docpolicy.ts (순수 함수)가 하고, 여기서는 그 결과를 저장소에 쓴다.
import { create } from 'zustand'
import { useApp } from './app'
import { t } from './i18n'
import { readRules } from './docrules'
import { contentHash, type AiRequest } from './docpolicy'
import { approveAll, approve as approveCheck, newProposal, prune, triage, type FileOp, type Proposal, type Triage } from './proposals'
import { buildWork } from './work'
import { emitAiChange } from './aiChangeHook'

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
  emitAiChange(ops.flatMap((o) => (o.op === 'rename' ? [o.path, o.to] : [o.path])))
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
  /** forceApproval: 정책이 허용한 변경도 승인 대기로 둔다(문서 점검 계획 실행용) */
  submit(req: AiRequest, by: string, summary?: string, forceApproval?: boolean): Triage & { id?: string }
  /** 제안 하나(현재 vault) */
  find(id: string): Proposal | undefined
  approve(id: string): void
  reject(id: string): void
  /** 여러 제안을 함께 승인한다(전부 반영하거나 전부 반영하지 않는다). 반영했으면 true */
  approveGroup(ids: string[]): boolean
  rejectGroup(ids: string[]): void
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
    submit: (req, by, summary, forceApproval) => {
      get().ensure()
      const c = ctxNow()
      let r = triage(req, c.rules, c.projects, c.files)
      // 계획 실행 제안은 정책이 허용해도 사람의 최종 승인을 받는다(거절 판정은 그대로)
      if (r.kind === 'apply' && forceApproval) r = { kind: 'pending', verdict: { decision: 'require_approval', reason: 'planApprove' } }
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
    approveGroup: (ids) => {
      get().ensure()
      const items = ids.map((id) => get().items.find((p) => p.id === id)).filter((p): p is Proposal => !!p)
      const c = ctxNow()
      const r = approveAll(items, c.rules, c.projects, c.files) // 전부 먼저 재검증
      if (!r.ok) {
        if (r.id && r.reason !== 'overlap') {
          const reason = r.reason
          patch(r.id, (x) => ({ ...x, status: 'failed', failReason: reason, decidedAt: Date.now() }))
        }
        useApp.getState().say(r.reason === 'overlap' ? t('같은 노트를 바꾸는 제안이 겹쳐서 한꺼번에 반영할 수 없어요 — 하나씩 확인해 주세요') : t('한 건이라도 반영할 수 없어서 아무것도 반영하지 않았어요 — 문서가 바뀌었거나 규칙이 허용하지 않아요'))
        return false
      }
      execute(r.ops)
      const done = new Set(r.ids)
      save(get().items.map((x) => (done.has(x.id) ? { ...x, status: 'applied', decidedAt: Date.now() } : x)))
      useApp.getState().say(t('{n}건을 함께 반영했어요', { n: r.ids.length }))
      return true
    },
    rejectGroup: (ids) => {
      const set = new Set(ids)
      save(get().items.map((x) => (set.has(x.id) && x.status === 'pending' ? { ...x, status: 'rejected', decidedAt: Date.now() } : x)))
    },
  }
})

// 개발·검증용: localStorage 'nosidian.dev' = '1' 이면 콘솔에서 제안을 직접 넣어 볼 수 있다(AI 도구가 아직 없어서). 평소에는 노출하지 않는다.
try {
  if (typeof window !== 'undefined' && localStorage.getItem('nosidian.dev') === '1') (window as unknown as { __proposals?: { store: typeof useProposals; contentHash: typeof contentHash; app: typeof useApp } }).__proposals = { store: useProposals, contentHash, app: useApp }
} catch {
  /* noop */
}
