import { t } from './i18n'
import { create } from 'zustand'

interface DialogState {
  kind: 'prompt' | 'confirm' | 'choice' | null
  title: string
  message?: string
  value: string
  okLabel: string
  danger: boolean
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
    useDialog.setState({ kind: 'prompt', title, value, message, okLabel, danger: false, resolve: resolve as never }),
  )
}

export function confirmAsk(title: string, message?: string, okLabel = t('확인'), danger = false): Promise<boolean> {
  return new Promise((resolve) =>
    useDialog.setState({ kind: 'confirm', title, message, value: '', okLabel, danger, resolve: resolve as never }),
  )
}

/** 여러 선택지 중 하나를 고르게 한다. 취소하면 null */
export function choose(title: string, message: string, choices: { value: string; label: string }[]): Promise<string | null> {
  return new Promise((resolve) =>
    useDialog.setState({ kind: 'choice', title, message, value: '', okLabel: '', danger: false, choices, resolve: resolve as never }),
  )
}
