import { t } from '../i18n'
import type { CloudCfg } from '../types'
import { refreshTokens } from './oauth'
import { capOthers } from './others'
import { b64ToBytes, bytesToB64, dirOf, isHidden, SyncError, type Provider, type PushChange, type RemoteEntry } from './types'

const API = 'https://www.googleapis.com/drive/v3'
const UP = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'

interface DriveFile { id: string; name: string; mimeType: string; md5Checksum?: string; version?: string; size?: string }
const revOf = (f: DriveFile) => f.md5Checksum ?? `v${f.version}`
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export function gdrive(initial: CloudCfg, save: (c: CloudCfg) => void): Provider {
  let cfg = initial
  const ids = new Map<string, string>() // 파일 경로 → id
  const folders = new Map<string, string>() // 폴더 경로 → id ('' = 루트)

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
  const api = async <T,>(url: string, init?: RequestInit) => (await raw(url, init)).json() as Promise<T>
  const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

  async function mkdir(name: string, parent: string) {
    const f = await api<DriveFile>(`${API}/files?fields=id`, { method: 'POST', ...json({ name, mimeType: FOLDER, parents: [parent] }) })
    return f.id
  }

  async function root() {
    if (folders.has('')) return folders.get('')!
    const name = cfg.folder.replace(/[\\/]/g, '') || 'MD Reader'
    const r = await api<{ files: DriveFile[] }>(
      `${API}/files?fields=files(id)&q=${encodeURIComponent(`name='${esc(name)}' and mimeType='${FOLDER}' and 'root' in parents and trashed=false`)}`,
    )
    const id = r.files[0]?.id ?? (await mkdir(name, 'root'))
    folders.set('', id)
    return id
  }

  async function ensureFolder(dir: string) {
    let cur = ''
    let id = await root()
    for (const part of dir.split('/').filter(Boolean)) {
      cur = cur ? `${cur}/${part}` : part
      let next = folders.get(cur)
      if (!next) {
        next = await mkdir(part, id)
        folders.set(cur, next)
      }
      id = next
    }
    return id
  }

  return {
    label: 'Google Drive',

    async test() {
      await api(`${API}/about?fields=user`)
      await root()
    },

    async list() {
      ids.clear()
      folders.clear()
      const entries: RemoteEntry[] = []
      const stack = [{ id: await root(), prefix: '' }]
      while (stack.length) {
        const { id, prefix } = stack.pop()!
        let page = ''
        do {
          const r = await api<{ files: DriveFile[]; nextPageToken?: string }>(
            `${API}/files?pageSize=1000&fields=nextPageToken,files(id,name,mimeType,md5Checksum,version,size)&q=${encodeURIComponent(`'${id}' in parents and trashed=false`)}${page ? `&pageToken=${page}` : ''}`,
          )
          for (const f of r.files) {
            const path = prefix + f.name
            if (isHidden(path)) continue
            if (f.mimeType === FOLDER) {
              folders.set(path, f.id)
              stack.push({ id: f.id, prefix: path + '/' })
            } else if (!f.mimeType.startsWith('application/vnd.google-apps.') && !ids.has(path)) {
              // Google 문서·시트 같은 구글 전용 형식은 파일로 내려받을 수 없어 뺀다
              ids.set(path, f.id)
              entries.push({ path, rev: revOf(f), id: f.id, size: f.size ? Number(f.size) : undefined })
            }
          }
          page = r.nextPageToken ?? ''
        } while (page)
      }
      return { entries: capOthers(entries) }
    },

    async readText(e) {
      return (await raw(`${API}/files/${e.id}?alt=media`)).text()
    },
    async readBase64(e) {
      return bytesToB64(await (await raw(`${API}/files/${e.id}?alt=media`)).arrayBuffer())
    },

    async push(changes: PushChange[]) {
      const revs = new Map<string, string>()
      for (const c of changes) {
        const id = ids.get(c.path)
        if (c.content === null) {
          if (id) await raw(`${API}/files/${id}`, { method: 'PATCH', ...json({ trashed: true }) })
          ids.delete(c.path)
          continue
        }
        let f: DriveFile
        if (id) {
          f = await api<DriveFile>(`${UP}/files/${id}?uploadType=media&fields=id,md5Checksum,version`, {
            method: 'PATCH',
            body: c.b64 != null ? (b64ToBytes(c.b64) as BlobPart) : c.content,
            headers: { 'Content-Type': c.b64 != null ? 'application/octet-stream' : 'text/markdown; charset=UTF-8' },
          })
        } else {
          const parent = await ensureFolder(dirOf(c.path))
          const b = 'amsidian' + Math.random().toString(36).slice(2)
          const meta = JSON.stringify({ name: c.path.split('/').pop(), parents: [parent] })
          f = await api<DriveFile>(`${UP}/files?uploadType=multipart&fields=id,md5Checksum,version`, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${b}` },
            body: c.b64 != null
              ? new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`, b64ToBytes(c.b64) as BlobPart, `\r\n--${b}--`])
              : `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${c.content}\r\n--${b}--`,
          })
        }
        ids.set(c.path, f.id)
        revs.set(c.path, revOf(f))
      }
      return revs
    },
  }
}
