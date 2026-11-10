import type { CloudCfg, GithubCfg, RemoteCfg } from '../types'
import * as gh from '../github'
import { gdrive } from './gdrive'
import { hostProvider } from './host'
import { pcHostProvider } from './pchost'
import { onedrive } from './onedrive'
import { capOthers } from './others'
import { isHidden, type Provider } from './types'

export * from './types'
export { capOthers } from './others'

function github(cfg: GithubCfg): Provider {
  return {
    label: 'GitHub',
    async test() {
      await gh.testConnection(cfg)
    },
    async list() {
      const head = await gh.getHead(cfg)
      const { tree, truncated } = await gh.getTree(cfg, head.treeSha)
      return {
        truncated,
        entries: capOthers(
          tree
            .filter((e) => e.type === 'blob' && !isHidden(e.path))
            .map((e) => ({ path: e.path, rev: e.sha, id: e.sha, size: e.size })),
        ),
      }
    },
    readText: (e) => gh.getBlobText(cfg, e.rev),
    readBase64: (e) => gh.getBlobBase64(cfg, e.rev),
    push: (changes, message) => gh.pushChanges(cfg, changes, message),
  }
}

export function createProvider(cfg: RemoteCfg, save: (c: CloudCfg) => void): Provider {
  switch (cfg.kind) {
    case 'github':
      return github(cfg)
    case 'gdrive':
      return gdrive(cfg, save)
    case 'onedrive':
      return onedrive(cfg, save)
    case 'host':
      return hostProvider()
    case 'pchost':
      return pcHostProvider()
  }
}
