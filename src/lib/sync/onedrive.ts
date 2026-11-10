import { t } from '../i18n'
import type { CloudCfg } from '../types'
import { refreshTokens } from './oauth'
import { capOthers } from './others'
import { b64ToBytes, bytesToB64, isHidden, SyncError, type Provider, type PushChange, type RemoteEntry } from './types'

const G = 'https://graph.microsoft.com/v1.0/me/drive'

interface Item { id: string; name: string; folder?: unknown; file?: unknown; cTag?: string; eTag?: string; size?: number }
interface Page { value: Item[]; '@odata.nextLink'?: string }

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/')
const revOf = (it: Item) => it.cTag ?? it.eTag ?? it.id

export function onedrive(initial: CloudCfg, save: (c: CloudCfg) => void): Provider {
  let cfg = initial
  const folder = () => cfg.folder.replace(/^\/+|\/+$/g, '') || 'MD Reader'
  const at = (path: string) => `${G}/root:/${enc(folder())}/${enc(path)}`

  async function token() {
    if (Date.now() > cfg.expires - 60_000) {
      cfg = await refreshTokens(cfg)
      save(cfg)
    }
    return cfg.access
  }

  async function raw(url: string, init: RequestInit = {}) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...init.headers } })
    if (!res.ok) {
      let msg = res.statusText
      try {
        msg = (await res.json()).error?.message ?? msg
      } catch { /* ignore */ }
      if (res.status === 401) msg = t('로그인이 만료되었어요. 연결을 다시 설정해 주세요.')
      throw new SyncError(msg, res.status)
    }
    return res
  }

  async function children(url: string) {
    const out: Item[] = []
    let next: string | undefined = `${url}?$select=id,name,folder,file,cTag,eTag&$top=200`
    while (next) {
      let r: Page
      try {
        r = (await (await raw(next)).json()) as Page
      } catch (e) {
        if ((e as SyncError).status === 404) return out // 폴더가 아직 없음 → 비어 있음
        throw e
      }
      out.push(...r.value)
      next = r['@odata.nextLink']
    }
    return out
  }

  return {
    label: 'OneDrive',

    async test() {
      await raw(G)
    },

    async list() {
      const entries: RemoteEntry[] = []
      const stack = [{ url: `${G}/root:/${enc(folder())}:/children`, prefix: '' }]
      while (stack.length) {
        const { url, prefix } = stack.pop()!
        for (const it of await children(url)) {
          const path = prefix + it.name
          if (isHidden(path)) continue
          if (it.folder) stack.push({ url: `${G}/items/${it.id}/children`, prefix: path + '/' })
          else if (it.file) entries.push({ path, rev: revOf(it), id: it.id, size: it.size })
        }
      }
      return { entries: capOthers(entries) }
    },

    async readText(e) {
      return (await raw(`${G}/items/${e.id}/content`)).text()
    },
    async readBase64(e) {
      return bytesToB64(await (await raw(`${G}/items/${e.id}/content`)).arrayBuffer())
    },

    async push(changes: PushChange[]) {
      const revs = new Map<string, string>()
      for (const c of changes) {
        if (c.content === null) {
          try {
            await raw(at(c.path), { method: 'DELETE' })
          } catch (e) {
            if ((e as SyncError).status !== 404) throw e
          }
          continue
        }
        // 경로로 PUT 하면 상위 폴더까지 알아서 만들어진다
        const r = await raw(`${at(c.path)}:/content`, { method: 'PUT', body: c.b64 != null ? (b64ToBytes(c.b64) as BlobPart) : c.content, headers: { 'Content-Type': c.b64 != null ? 'application/octet-stream' : 'text/markdown; charset=UTF-8' } })
        revs.set(c.path, revOf((await r.json()) as Item))
      }
      return revs
    },
  }
}
