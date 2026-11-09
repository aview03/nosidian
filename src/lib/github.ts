import { t } from './i18n'
import type { RepoCfg } from './types'
import type { PushChange } from './sync/types'

export class GhError extends Error {
  status: number
  constructor(msg: string, status: number) {
    super(msg)
    this.status = status
  }
}

async function gh<T>(cfg: RepoCfg, path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = (await res.json()).message ?? msg
    } catch {
      /* ignore */
    }
    if (res.status === 401) msg = t('토큰이 올바르지 않거나 만료되었습니다.')
    if (res.status === 404) msg = t('저장소/브랜치를 찾을 수 없습니다. (private 저장소면 토큰 권한을 확인하세요)')
    throw new GhError(msg, res.status)
  }
  return res.json() as Promise<T>
}

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

export async function testConnection(cfg: RepoCfg) {
  const r = await gh<{ permissions?: { push?: boolean }; default_branch: string }>(cfg, '')
  return { canPush: r.permissions?.push !== false, defaultBranch: r.default_branch }
}

export async function getHead(cfg: RepoCfg) {
  const ref = await gh<{ object: { sha: string } }>(cfg, `/git/ref/heads/${encodeURIComponent(cfg.branch).replace(/%2F/g, '/')}`)
  const commit = await gh<{ tree: { sha: string } }>(cfg, `/git/commits/${ref.object.sha}`)
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha }
}

export async function getTree(cfg: RepoCfg, treeSha: string) {
  const r = await gh<{ tree: TreeEntry[]; truncated: boolean }>(cfg, `/git/trees/${treeSha}?recursive=1`)
  return r
}

function b64ToBytes(b64: string) {
  const bin = atob(b64.replace(/\n/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function getBlobText(cfg: RepoCfg, sha: string) {
  const r = await gh<{ content: string }>(cfg, `/git/blobs/${sha}`)
  return new TextDecoder('utf-8').decode(b64ToBytes(r.content))
}

export async function getBlobBase64(cfg: RepoCfg, sha: string) {
  const r = await gh<{ content: string }>(cfg, `/git/blobs/${sha}`)
  return r.content.replace(/\n/g, '')
}

/** 변경분을 단일 커밋으로 올린다. 새 blob sha 맵을 반환. */
export async function pushChanges(cfg: RepoCfg, changes: PushChange[], message: string) {
  const head = await getHead(cfg)
  const shas = new Map<string, string>()
  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = []
  for (const c of changes) {
    if (c.content === null) {
      tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null })
    } else {
      const b = await gh<{ sha: string }>(cfg, '/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: c.content, encoding: 'utf-8' }),
      })
      shas.set(c.path, b.sha)
      tree.push({ path: c.path, mode: '100644', type: 'blob', sha: b.sha })
    }
  }
  const t = await gh<{ sha: string }>(cfg, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: head.treeSha, tree }),
  })
  const commit = await gh<{ sha: string }>(cfg, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: t.sha, parents: [head.commitSha] }),
  })
  await gh(cfg, `/git/refs/heads/${cfg.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) })
  return shas
}
