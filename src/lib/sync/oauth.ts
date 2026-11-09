import { t } from '../i18n'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type { CloudCfg, CloudKind } from '../types'
import { SyncError } from './types'

/** Android 패키지명 = 커스텀 URI 스킴. AndroidManifest 의 intent-filter 와 같아야 합니다. */
export const REDIRECT_SCHEME = 'com.amsidian.app'

const SPEC = {
  gdrive: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive',
    native: `${REDIRECT_SCHEME}:/oauth`,
    extra: { access_type: 'offline', prompt: 'consent' } as Record<string, string>,
  },
  onedrive: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'Files.ReadWrite offline_access',
    native: `${REDIRECT_SCHEME}://oauth`,
    extra: {} as Record<string, string>,
  },
}

export const REDIRECT_HINT: Record<CloudKind, string> = {
  gdrive: SPEC.gdrive.native,
  onedrive: SPEC.onedrive.native,
}

export interface Tokens {
  access: string
  refresh: string
  expires: number
}

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const rand = () => b64url(crypto.getRandomValues(new Uint8Array(32)))
const challenge = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))

async function postForm(url: string, params: Record<string, string>) {
  let status: number
  let data: Record<string, unknown>
  if (Capacitor.isNativePlatform()) {
    // 네이티브 HTTP: WebView 의 CORS 제약을 받지 않는다
    const r = await CapacitorHttp.post({ url, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: params })
    status = r.status
    data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
  } else {
    const r = await fetch(url, { method: 'POST', body: new URLSearchParams(params) })
    status = r.status
    data = await r.json().catch(() => ({}))
  }
  if (status >= 400) throw new SyncError(String(data.error_description ?? data.error ?? t('로그인 실패 ({status})', { status })), status)
  return data
}

function toTokens(d: Record<string, unknown>, prevRefresh = ''): Tokens {
  return {
    access: String(d.access_token),
    refresh: String(d.refresh_token ?? prevRefresh),
    expires: Date.now() + (Number(d.expires_in) || 3600) * 1000,
  }
}

async function exchange(kind: CloudKind, clientId: string, code: string, verifier: string, redirect: string) {
  const d = await postForm(SPEC[kind].token, {
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
  })
  return toTokens(d)
}

export async function refreshTokens(c: CloudCfg): Promise<CloudCfg> {
  const expired = () => new SyncError(t('로그인이 만료되었어요. 연결을 다시 설정해 주세요.'), 401)
  if (!c.refresh) throw expired()
  try {
    const d = await postForm(SPEC[c.kind].token, { client_id: c.clientId, grant_type: 'refresh_token', refresh_token: c.refresh, scope: SPEC[c.kind].scope })
    return { ...c, ...toTokens(d, c.refresh) }
  } catch {
    throw expired()
  }
}

function authUrl(kind: CloudKind, clientId: string, redirect: string, state: string, ch: string) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SPEC[kind].scope,
    state,
    code_challenge: ch,
    code_challenge_method: 'S256',
    ...SPEC[kind].extra,
  })
  return `${SPEC[kind].auth}?${q}`
}

const WEB_KEY = 'amsidian.oauth'
// Windows 앱(Electron)은 시스템 브라우저로 로그인하고 /oauth 로 돌아온다
const isElectron = () => navigator.userAgent.includes('Electron')
const webRedirect = () => location.origin + (isElectron() ? '/oauth' : '/')

/**
 * 로그인. 앱(Android)에서는 시스템 브라우저로 열고 커스텀 스킴으로 돌아온다.
 * 웹에서는 페이지를 이동했다가 돌아오므로 이 함수는 resolve 되지 않고, [resumeWebAuth] 가 이어받는다.
 */
export async function authorize(kind: CloudKind, clientId: string, folder: string): Promise<Tokens> {
  const verifier = rand()
  const state = rand()
  const ch = await challenge(verifier)

  if (!Capacitor.isNativePlatform()) {
    sessionStorage.setItem(WEB_KEY, JSON.stringify({ kind, clientId, folder, verifier, state }))
    const url = authUrl(kind, clientId, webRedirect(), state, ch)
    if (isElectron()) window.open(url)
    else location.href = url
    return new Promise<Tokens>(() => {})
  }

  const redirect = SPEC[kind].native
  return new Promise<Tokens>((resolve, reject) => {
    let done = false
    const cleanup: (() => void)[] = []
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      cleanup.forEach((c) => c())
      fn()
    }
    void (async () => {
      const l1 = await App.addListener('appUrlOpen', ({ url }) => {
        if (!url.startsWith(REDIRECT_SCHEME + ':')) return
        void Browser.close().catch(() => {})
        const u = new URL('https://x/?' + (url.split('?')[1] ?? ''))
        const err = u.searchParams.get('error')
        const code = u.searchParams.get('code')
        if (err || !code) return finish(() => reject(new SyncError(u.searchParams.get('error_description') ?? err ?? t('로그인이 취소되었어요'))))
        if (u.searchParams.get('state') !== state) return finish(() => reject(new SyncError(t('잘못된 로그인 응답이에요'))))
        exchange(kind, clientId, code, verifier, redirect).then(
          (t) => finish(() => resolve(t)),
          (e) => finish(() => reject(e)),
        )
      })
      const l2 = await Browser.addListener('browserFinished', () => {
        setTimeout(() => finish(() => reject(new SyncError(t('로그인이 취소되었어요')))), 1500)
      })
      cleanup.push(() => void l1.remove(), () => void l2.remove())
      await Browser.open({ url: authUrl(kind, clientId, redirect, state, ch) })
    })().catch((e) => finish(() => reject(e)))
    setTimeout(() => finish(() => reject(new SyncError(t('로그인 시간이 초과되었어요')))), 5 * 60000)
  })
}

/** 웹: 로그인 후 돌아온 페이지에서 code 를 토큰으로 바꾼다. 해당 없으면 null. */
export async function resumeWebAuth(): Promise<CloudCfg | null> {
  const raw = sessionStorage.getItem(WEB_KEY)
  const q = new URLSearchParams(location.search)
  if (!raw || !q.has('state')) return null
  sessionStorage.removeItem(WEB_KEY)
  history.replaceState(null, '', location.pathname)
  const p = JSON.parse(raw) as { kind: CloudKind; clientId: string; folder: string; verifier: string; state: string }
  if (q.get('state') !== p.state) throw new SyncError(t('잘못된 로그인 응답이에요'))
  const code = q.get('code')
  if (!code) throw new SyncError(q.get('error_description') ?? q.get('error') ?? t('로그인이 취소되었어요'))
  const tokens = await exchange(p.kind, p.clientId, code, p.verifier, webRedirect())
  return { kind: p.kind, clientId: p.clientId, folder: p.folder, ...tokens }
}
