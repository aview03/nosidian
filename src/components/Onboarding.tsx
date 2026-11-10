import { t } from '../lib/i18n'
import { tx } from '../lib/tx'
import { LANGS, LANG_NAMES, type LangPref } from '../lib/i18n'
import { useState } from 'react'
import { useApp } from '../lib/app'
import { SYNC_LABEL, type CloudKind, type SyncKind } from '../lib/types'
import { importFromPicker } from '../lib/importFiles'
import { authorize, REDIRECT_HINT } from '../lib/sync/oauth'
import { PERSONAS, PERSONA_INFO, type PersonaId } from '../lib/persona'
import { Orb } from './Orb'
import { setPersona } from '../lib/personaApply'

export function parseRepo(input: string) {
  const m = input.trim().replace(/\.git$/, '').match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)\/?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

function GithubForm({ onDone }: { onDone?: () => void }) {
  const saved = useApp((s) => (s.settings.remote?.kind === 'github' ? s.settings.remote : null))
  const [repoIn, setRepoIn] = useState(saved ? `${saved.owner}/${saved.repo}` : '')
  const [branch, setBranch] = useState(saved?.branch ?? 'main')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = parseRepo(repoIn)
    if (!r) return setErr(t('저장소를 "사용자/저장소" 또는 GitHub URL 형식으로 입력해 주세요.'))
    if (!token.trim() && !saved) return setErr(t('토큰을 입력해 주세요.'))
    setBusy(true)
    setErr('')
    try {
      await useApp.getState().connect({ kind: 'github', ...r, branch: branch.trim() || 'main', token: token.trim() || saved!.token })
      onDone?.()
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        {t('GitHub 저장소')}
        <input value={repoIn} onChange={(e) => setRepoIn(e.target.value)} placeholder="username/my-notes" autoCapitalize="off" autoCorrect="off" />
      </label>
      <label>
        {t('브랜치')}
        <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" autoCapitalize="off" />
      </label>
      <label>
        Personal Access Token
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={saved ? t('(저장됨 · 바꾸려면 입력)') : 'github_pat_…'} autoCapitalize="off" autoCorrect="off" />
      </label>
      <details className="howto">
        <summary>{t('토큰은 어떻게 만드나요?')}</summary>
        <ol>
          <li>GitHub → Settings → Developer settings → <b>Fine-grained tokens</b></li>
          <li>{tx('Repository access: 노트 저장소 {only} 선택', { only: <b>{t('하나만')}</b> })}</li>
          <li>Permissions → <b>Contents: Read and write</b></li>
          <li>{t('생성된 토큰을 위에 붙여넣기. 토큰은 이 기기에만 저장되고 GitHub 외에는 전송되지 않습니다.')}</li>
        </ol>
        <p>{t('저장소에는 최소 1개의 커밋(README 등)이 있어야 합니다. 기존 Obsidian vault 저장소도 그대로 열립니다.')}</p>
      </details>
      {err && <p className="error">{err}</p>}
      <button className="primary big" disabled={busy}>{busy ? t('연결 중…') : saved ? t('다시 연결') : t('연결하고 가져오기')}</button>
    </form>
  )
}

const ENV_ID: Record<CloudKind, string> = {
  gdrive: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '',
  onedrive: (import.meta.env.VITE_MS_CLIENT_ID as string | undefined) ?? '',
}

function CloudForm({ kind, onDone }: { kind: CloudKind; onDone?: () => void }) {
  const saved = useApp((s) => (s.settings.remote?.kind === kind ? s.settings.remote : null))
  const [clientId, setClientId] = useState(saved?.clientId ?? ENV_ID[kind])
  const [folder, setFolder] = useState(saved?.folder ?? 'MD Reader')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const label = SYNC_LABEL[kind]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientId.trim()) return setErr(t('클라이언트 ID를 입력해 주세요.'))
    setBusy(true)
    setErr('')
    try {
      const f = folder.trim() || 'MD Reader'
      const tok = await authorize(kind, clientId.trim(), f)
      await useApp.getState().connect({ kind, clientId: clientId.trim(), folder: f, ...tok })
      onDone?.()
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        {t('{label} 폴더', { label })}
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="MD Reader" autoCapitalize="off" />
      </label>
      <label>
        {t('클라이언트 ID')}
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={kind === 'gdrive' ? '…apps.googleusercontent.com' : 'Application (client) ID'} autoCapitalize="off" autoCorrect="off" />
      </label>
      <details className="howto">
        <summary>{t('클라이언트 ID는 어떻게 만드나요?')}</summary>
        {kind === 'gdrive' ? (
          <ol>
            <li>{tx('Google Cloud Console → 새 프로젝트 → {api} 사용 설정', { api: <b>Google Drive API</b> })}</li>
            <li>{t('OAuth 동의 화면 설정 (테스트 사용자에 내 계정 추가)')}</li>
            <li>{tx('사용자 인증 정보 → {id} → 유형 {type}, 패키지 이름 {pkg}', { id: <b>OAuth Client ID</b>, type: <b>Android</b>, pkg: <code>com.amsidian.app</code> })}</li>
            <li>{tx('발급된 클라이언트 ID를 위에 붙여넣기. 리디렉션: {uri}', { uri: <code>{REDIRECT_HINT.gdrive}</code> })}</li>
          </ol>
        ) : (
          <ol>
            <li>{t('Azure Portal → Microsoft Entra ID → 앱 등록 → 새 등록 (계정 유형: 개인 계정 포함)')}</li>
            <li>{tx('인증 → 플랫폼 추가 → {platform} → 리디렉션 URI {uri}', { platform: <b>{t('모바일 및 데스크톱')}</b>, uri: <code>{REDIRECT_HINT.onedrive}</code> })}</li>
            <li>{tx('API 권한 → Microsoft Graph → 위임됨 → {perm}, offline_access', { perm: <b>Files.ReadWrite</b> })}</li>
            <li>{tx('개요의 {id}를 위에 붙여넣기', { id: <b>{t('애플리케이션(클라이언트) ID')}</b> })}</li>
          </ol>
        )}
        <p>{t('입력한 폴더는 {label} 최상위에 만들어지고, 그 안의 마크다운 파일과 이미지만 동기화돼요. 로그인 정보는 이 기기에만 저장됩니다.', { label })}</p>
      </details>
      {err && <p className="error">{err}</p>}
      <button className="primary big" disabled={busy}>{busy ? t('연결 중…') : saved ? t('{label} 다시 로그인', { label }) : t('{label} 로그인', { label })}</button>
    </form>
  )
}

export function ConnectForm({ kind, onDone }: { kind: SyncKind; onDone?: () => void }) {
  return kind === 'github' ? <GithubForm onDone={onDone} /> : <CloudForm kind={kind} onDone={onDone} />
}

/** 천천히 나타나는 묶음: delay(ms) 뒤에 부드럽게 떠오른다(움직임을 줄인 설정이면 바로 보인다) */
function Soft({ d = 0, as: Tag = 'div', className = '', children }: { d?: number; as?: 'div' | 'p' | 'h2' | 'span'; className?: string; children: React.ReactNode }) {
  return <Tag className={`soft-in ${className}`} style={{ ['--d' as string]: `${d}ms` }}>{children}</Tag>
}

type Step = 'lang' | 'hello' | 'name' | 'role' | 'start'

/** 첫 실행: 한 번에 하나씩, 서두르지 않고 묻는다. 이름·역할은 건너뛸 수 있다 */
function Guide({ step, setStep, children }: { step: Step; setStep(s: Step): void; children?: React.ReactNode }) {
  const [name, setName] = useState(useApp.getState().settings.myName)
  const [role, setRole] = useState<PersonaId | null>(null)
  const save = () => {
    const app = useApp.getState()
    if (name.trim()) app.patchSettings({ myName: name.trim() })
    if (role) setPersona(role)
  }
  const call = name.trim()
  const lang = useApp((x) => x.settings.lang)
  if (step === 'lang') {
    return (
      <div className="ob-step" key="lang">
        <Soft d={0} className="ob-orbwrap"><Orb size={104} className="ob-orb" /></Soft>
        <Soft as="h2" d={500} className="ob-q">{t('언어를 선택해 주세요')}</Soft>
        <Soft as="p" d={1100} className="ob-sub">Choose your language</Soft>
        <div className="ob-roles ob-langs" role="radiogroup" aria-label="Language">
          {(['auto', ...LANGS] as LangPref[]).map((l, i) => (
            <Soft key={l} d={1500 + i * 110} className="ob-roleslot">
              <button className={`ob-role ob-lang${lang === l ? ' on' : ''}`} role="radio" aria-checked={lang === l} onClick={() => useApp.getState().patchSettings({ lang: l })}>
                <b>{l === 'auto' ? t('시스템 설정 따라가기') : LANG_NAMES[l]}</b>
              </button>
            </Soft>
          ))}
        </div>
        <Soft d={2500} className="ob-actions"><button className="primary big" onClick={() => setStep('hello')}>{t('계속')}</button></Soft>
      </div>
    )
  }
  if (step === 'hello') {
    return (
      <div className="ob-step" key="hello">
        <Soft d={0} className="ob-orbwrap"><Orb size={104} className="ob-orb" /></Soft>
        <Soft as="h2" d={500} className="ob-q">{t('안녕하세요')}</Soft>
        <Soft as="p" d={1300} className="ob-sub">{t('천천히, 편하게 시작해 볼게요')}</Soft>
        <Soft d={2300} className="ob-actions"><button className="primary big" onClick={() => setStep('name')}>{t('좋아요')}</button></Soft>
      </div>
    )
  }
  if (step === 'name') {
    return (
      <div className="ob-step" key="name">
        <Soft d={0} className="ob-orbwrap"><Orb size={72} className="ob-orb" /></Soft>
        <Soft as="h2" d={300} className="ob-q">{t('먼저, 어떻게 불러 드리면 좋을까요?')}</Soft>
        <Soft d={1100} className="ob-field">
          <input className="ob-name" value={name} placeholder={t('이름이나 별명')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) setStep('role') }} autoFocus />
          <small>{t('나중에 언제든 바꿀 수 있어요')}</small>
        </Soft>
        <Soft d={1700} className="ob-actions">
          <button className="primary big" onClick={() => setStep('role')}>{call ? t('다음') : t('다음에 할게요')}</button>
        </Soft>
      </div>
    )
  }
  if (step === 'role') {
    return (
      <div className="ob-step" key="role">
        <Soft d={0} className="ob-orbwrap"><Orb size={72} className="ob-orb" /></Soft>
        <Soft as="h2" d={300} className="ob-q">{call ? t('{name}님은 주로 어떤 일을 하세요?', { name: call.split(',')[0].trim() }) : t('주로 어떤 일을 하세요?')}</Soft>
        <Soft as="p" d={1000} className="ob-sub">{t('그에 맞춰 첫 화면을 꾸며 드릴게요')}</Soft>
        <div className="ob-roles" role="radiogroup" aria-label={t('내가 하는 일')}>
          {PERSONAS.map((p, i) => (
            <Soft key={p} d={1500 + i * 140} className="ob-roleslot">
              <button className={`ob-role${role === p ? ' on' : ''}`} role="radio" aria-checked={role === p} onClick={() => setRole(role === p ? null : p)}>
                <b>{t(PERSONA_INFO[p].label)}</b>
                <small>{t(PERSONA_INFO[p].hint)}</small>
              </button>
            </Soft>
          ))}
        </div>
        <Soft d={2500} className="ob-actions">
          <button className="primary big" onClick={() => { save(); setStep('start') }}>{role ? t('다음') : t('아직 모르겠어요')}</button>
        </Soft>
      </div>
    )
  }
  return <div className="ob-step" key="start">{children}</div>
}

export function Onboarding() {
  const [kind, setKind] = useState<SyncKind | null>(null)
  const [step, setStep] = useState<Step>(() => {
    const st = useApp.getState().settings
    return st.myName.trim() || st.persona ? 'start' : 'lang' // 이미 정한 적이 있으면 묻지 않는다
  })
  useApp((x) => x.settings.lang) // 언어를 고르면 바로 그 언어로 다시 그린다
  return (
    <div className="onboard">
      <div className="onboard-card">
        {step === 'start' && (
          <Soft d={0}>
            <img className="logo" src="/logo.png" alt="Nosidian" />
            <h1>Nosidian</h1>
            <div className="tag-line">
              <p className="tag-head">{t('Markdown, 딱 필요한 만큼만.')}</p>
              <p className="tag-sub">{t('기록하고, 연결하고, 자유롭게 보관하세요.')}<br />{t('복잡한 기능 없이 기본에 충실한 Markdown 공간.')}</p>
            </div>
          </Soft>
        )}
        {step === 'hello' && <Soft d={0}><h1 className="ob-brand">Nosidian</h1></Soft>}
        <Guide step={step} setStep={setStep}>
          {kind === null ? (
            <>
              <Soft as="h2" d={200} className="ob-q">{t('노트는 어떻게 시작해 볼까요?')}</Soft>
              <div className="onboard-actions">
                <Soft d={700}><button className="primary big" onClick={() => void useApp.getState().startDemo()}>{t('예제 노트로 둘러보기')}</button></Soft>
                <Soft d={900}><button className="big" onClick={() => void importFromPicker()}>{t('내 기기의 md 파일 열기')}</button></Soft>
                <Soft d={1100} className="ob-connect">
                  <small>{t('이미 쓰는 노트가 있다면 연결해서 가져와요')}</small>
                  <div className="ob-connect-row">
                    {(Object.keys(SYNC_LABEL) as SyncKind[]).map((k) => (
                      <button key={k} onClick={() => setKind(k)}>{SYNC_LABEL[k]}</button>
                    ))}
                  </div>
                </Soft>
              </div>
            </>
          ) : (
            <>
              <h2 className="step-title">{t('{name} 연결', { name: SYNC_LABEL[kind] })}</h2>
              <ConnectForm kind={kind} />
              <button className="link-btn" onClick={() => setKind(null)}>{t('← 처음으로')}</button>
            </>
          )}
        </Guide>
      </div>
    </div>
  )
}
