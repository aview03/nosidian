import { act, createElement, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAiConfigVersion } from './useAiConfig'
import { localEngine } from './aiThread'
import { saveLlmConfig } from './llm'
import { savePcLink } from './pcLink'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let renders = 0
/** AI 패널이 하는 일과 같다: 연결 설정이 바뀌면 localEngine() 을 다시 계산해 그린다 */
function Probe() {
  const v = useAiConfigVersion()
  const local = useMemo(() => localEngine(), [v])
  renders++
  return createElement('span', { id: 'out' }, `${local.ready ? 'ready' : 'no'}|${local.label}|${local.problem ?? ''}`)
}

describe('AI 연결 설정 변경이 열려 있는 패널에 바로 반영된다', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const text = () => host.querySelector('#out')!.textContent
  beforeEach(() => {
    saveLlmConfig(null)
    renders = 0
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(createElement(Probe)))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    saveLlmConfig(null)
  })

  it('설정이 없으면 "연결 필요" 상태', () => {
    expect(text()).toBe('no||noConfig')
  })

  it('패널이 열린 채 모델을 저장하면 다시 열지 않아도 모델 이름과 준비 상태가 바뀐다', () => {
    act(() => saveLlmConfig({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:4b' }))
    expect(text()).toBe('ready|Ollama qwen3.5:4b|')
    act(() => saveLlmConfig({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1:8b' }))
    expect(text()).toBe('ready|Ollama llama3.1:8b|')
  })

  it('설정을 지우면 "연결 필요" 로 돌아온다', () => {
    act(() => saveLlmConfig({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:4b' }))
    expect(text()).toContain('ready')
    act(() => saveLlmConfig(null))
    expect(text()).toBe('no||noConfig')
  })

  it('PC 짝 정보가 바뀌어도 다시 그린다', () => {
    const before = renders
    act(() => savePcLink(null))
    expect(renders).toBeGreaterThan(before)
  })

  it('언마운트하면 구독을 해제한다(이후 저장해도 다시 그리지 않는다)', () => {
    act(() => root.unmount())
    const before = renders
    saveLlmConfig({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'x' })
    window.dispatchEvent(new Event('nosidian-pclink-changed'))
    expect(renders).toBe(before)
    root = createRoot(host) // afterEach 의 unmount 가 짝이 맞도록
  })
})
