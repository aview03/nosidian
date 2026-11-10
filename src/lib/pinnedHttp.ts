// 인증서 지문 고정 HTTPS 요청의 JS 쪽. 안드로이드는 네이티브 플러그인(PinnedHttp)이 하고, 시험은 transport 를 바꿔 끼운다.
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface PinnedReq {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  /** 서버 인증서 SHA-256 지문(소문자 16진 64자). 반드시 필요하다 */
  pin: string
  timeoutMs?: number
}
export interface PinnedRes {
  status: number
  text: string
  /** 실제로 본 서버 인증서 지문 */
  fp: string
}

const Native = registerPlugin<{ request(o: PinnedReq): Promise<PinnedRes> }>('PinnedHttp')

type Transport = (r: PinnedReq) => Promise<PinnedRes>
let transport: Transport = async (r) => {
  if (!Capacitor.isNativePlatform()) throw new Error('이 기능은 휴대폰 앱에서만 쓸 수 있어요')
  return Native.request(r)
}
/** 시험·특수 환경용: 요청을 보내는 방법을 바꾼다(되돌리려면 null) */
export function setPinnedTransport(t: Transport | null) {
  transport = t ?? (async (r) => (Capacitor.isNativePlatform() ? Native.request(r) : Promise.reject(new Error('이 기능은 휴대폰 앱에서만 쓸 수 있어요'))))
}

export function pinnedRequest(r: PinnedReq): Promise<PinnedRes> {
  if (!/^https:\/\//i.test(r.url)) return Promise.reject(new Error('https only'))
  if (!/^[0-9a-f]{64}$/.test(r.pin)) return Promise.reject(new Error('pin required'))
  return transport(r)
}
