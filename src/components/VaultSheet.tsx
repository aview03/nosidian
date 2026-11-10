import { t } from '../lib/i18n'
import { useApp } from '../lib/app'
import { usePresence } from '../lib/presence'
import { ask, confirmAsk } from '../lib/dialog'
import { SYNC_LABEL, remoteDetail, type VaultMeta } from '../lib/types'

export function vaultSub(v: VaultMeta) {
  const r = v.remote
  if (!r) return t('로컬 전용')
  return `${SYNC_LABEL[r.kind]} · ${remoteDetail(r)}`
}

export function useActiveVault() {
  return useApp((s) => s.settings.vaults.find((v) => v.id === s.settings.activeVault) ?? null)
}

/** 새 vault: 이름을 받아 만들고, 설정 탭으로 이동해 동기화 연결을 고르게 한다 */
export async function createVaultFlow() {
  const name = await ask(t('새 vault'), '', t('vault 이름 (예: 업무, 개인)'), t('만들기'))
  if (!name?.trim()) return
  const app = useApp.getState()
  await app.addVault(name)
  app.go('settings')
}

export async function renameVaultFlow(v: VaultMeta) {
  const name = await ask(t('이름 바꾸기'), v.name, undefined, t('변경'))
  if (name?.trim()) useApp.getState().renameVault(v.id, name)
}

export async function deleteVaultFlow(v: VaultMeta) {
  const ok = await confirmAsk(
    t('"{name}" 삭제', { name: v.name }),
    t('이 기기의 노트 사본과 로그인 정보가 삭제됩니다. GitHub·Drive 등 원격 파일은 그대로 남아요. 올리지 않은 변경은 사라져요.'),
    t('삭제'),
    true,
  )
  if (ok) await useApp.getState().deleteVault(v.id)
}

export function VaultSheet() {
  const open = useApp((s) => s.vaultSheet)
  const vaults = useApp((s) => s.settings.vaults)
  const active = useApp((s) => s.settings.activeVault)
  const app = useApp.getState()
  const { mounted, closing } = usePresence(open)
  if (!mounted) return null
  const cur = vaults.find((v) => v.id === active)

  return (
    <div className={`sheet-wrap vault-wrap${closing ? " closing" : ""}`} onClick={() => app.setVaultSheet(false)}>
      <div className="sheet vault-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="panel-head"><h2>Vault <small>{vaults.length}</small></h2></div>
        <div className="list">
          {vaults.map((v) => (
            <button key={v.id} className={`row vault-row ${v.id === active ? 'on' : ''}`} onClick={() => void app.switchVault(v.id)}>
              <span className="row-title">
                {v.name}
                {v.id === active && <span className="dot" />}
              </span>
              <span className="row-sub">{vaultSub(v)}</span>
            </button>
          ))}
        </div>
        <div className="btn-row vault-actions">
          <button className="primary" onClick={() => void createVaultFlow()}>{t('＋ 새 vault')}</button>
          {cur && <button onClick={() => void renameVaultFlow(cur)}>{t('이름 바꾸기')}</button>}
          {cur && <button onClick={() => void deleteVaultFlow(cur)}>{t('삭제')}</button>}
        </div>
        <p className="hint small vault-hint">{t('이름 바꾸기·삭제는 지금 열려 있는 vault에 적용돼요.')}</p>
      </div>
    </div>
  )
}
