import { t } from './i18n'
import { create } from 'zustand'

interface DialogState {
  kind: 'prompt' | 'confirm' | 'choice' | null
  title: string
  message?: string
  value: string
  okLabel: string
  danger: boolean
  /** 취소 버튼 글자(기본 '취소') */
  cancelLabel?: string
  /** 본문 아래 작은 안내 */
  note?: string
  choices?: { value: string; label: string }[]
  resolve?: (v: string | boolean | null) => void
}

export const useDialog = create<DialogState>(() => ({
  kind: null,
  title: '',
  value: '',
  okLabel: '확인',
  danger: false,
}))

export function ask(title: string, value = '', message?: string, okLabel = t('확인')): Promise<string | null> {
  return new Promise((resolve) =>
    useDialog.setState({ kind: 'prompt', title, value, message, okLabel, danger: false, cancelLabel: undefined, note: undefined, resolve: resolve as never }),
  )
}

export function confirmAsk(title: string, message?: string, okLabel = t('확인'), danger = false, opts?: { cancelLabel?: string; note?: string }): Promise<boolean> {
  return new Promise((resolve) =>
    useDialog.setState({ kind: 'confirm', title, message, value: '', okLabel, danger, cancelLabel: opts?.cancelLabel, note: opts?.note, resolve: resolve as never }),
  )
}

/** 여러 선택지 중 하나를 고르게 한다. 취소하면 null */
export function choose(title: string, message: string, choices: { value: string; label: string }[]): Promise<string | null> {
  return new Promise((resolve) =>
    useDialog.setState({ kind: 'choice', title, message, value: '', okLabel: '', danger: false, cancelLabel: undefined, note: undefined, choices, resolve: resolve as never }),
  )
}
