import { t } from '../lib/i18n'
import { useEffect, useRef } from 'react'
import { useDialog } from '../lib/dialog'
import { useApp } from '../lib/app'
import { usePresence } from '../lib/presence'

export function Dialogs() {
  const d = useDialog()
  const toast = useApp((s) => s.toast)
  const input = useRef<HTMLInputElement>(null)

  // 닫히는 동안에도 내용이 남아 있어야 퇴장 모션이 자연스럽다 → 마지막 값을 붙들고 있는다
  const lastDialog = useRef(d)
  if (d.kind) lastDialog.current = d
  const v = d.kind ? d : lastDialog.current
  const lastToast = useRef(toast)
  if (toast) lastToast.current = toast

  const modal = usePresence(!!d.kind)
  const toastP = usePresence(!!toast, 200)

  useEffect(() => {
    if (d.kind === 'prompt') setTimeout(() => { input.current?.focus(); input.current?.select() }, 30)
  }, [d.kind])

  const close = (val: string | boolean | null) => {
    d.resolve?.(val)
    useDialog.setState({ kind: null, resolve: undefined })
  }

  return (
    <>
      {modal.mounted && (
        <div className={`modal-wrap${modal.closing ? ' closing' : ''}`} onClick={() => close(v.kind === 'confirm' ? false : null)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              close(d.kind === 'confirm' ? true : input.current!.value)
            }}
          >
            <h3>{v.title}</h3>
            {v.message && <p>{v.message}</p>}
            {v.kind === 'prompt' && <input ref={input} defaultValue={v.value} autoCapitalize="off" />}
            {v.kind === 'choice' ? (
              <div className="modal-actions choice">
                {v.choices?.map((c, i) => (
                  <button key={c.value} type="button" className={i === 0 ? 'primary' : ''} onClick={() => close(c.value)}>{c.label}</button>
                ))}
                <button type="button" onClick={() => close(null)}>{t('취소')}</button>
              </div>
            ) : (
              <div className="modal-actions">
                <button type="button" onClick={() => close(v.kind === 'confirm' ? false : null)}>{t('취소')}</button>
                <button type="submit" className={v.danger ? 'danger-fill' : 'primary'}>{v.okLabel}</button>
              </div>
            )}
          </form>
        </div>
      )}
      {toastP.mounted && <div className={`toast${toastP.closing ? ' closing' : ''}`}>{toast ?? lastToast.current}</div>}
    </>
  )
}
