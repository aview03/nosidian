import { askNotifyPermission } from '../lib/reminders'
import { pruneAllDaily } from '../lib/calendar'
import { desktop, type WidgetState } from '../lib/externalIO'
import { t, getLang } from '../lib/i18n'
import { tx } from '../lib/tx'
import { LangSelect } from './LangSelect'
import { PERSONAS, PERSONA_INFO, matchesPreset } from '../lib/persona'
import { applyPersonaLayout, personaOf, resetWorkLayout, setPersona } from '../lib/personaApply'
import { useWorkUi } from '../lib/workOps'
import { Select } from './Select'
import { LlmCard } from './LlmSettings'
import { McpCard } from './McpSettings'
import { AutoCard } from './AutoSettings'
import { AiWizard } from './AiWizard'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useApp } from '../lib/app'
import { confirmAsk } from '../lib/dialog'
import { SYNC_LABEL, type SyncKind } from '../lib/types'
import { ConnectForm } from './Onboarding'
import { Icon } from './Icon'
import { DOCRULES_PATH } from '../lib/docrules'
import { createVaultFlow, deleteVaultFlow, renameVaultFlow, useActiveVault, vaultSub } from './VaultSheet'

function ago(ts: number | null) {
  if (!ts) return t('아직 없음')
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return t('방금')
  if (m < 60) return t('{n}분 전', { n: m })
  if (m < 1440) return t('{n}시간 전', { n: Math.round(m / 60) })
  return new Date(ts).toLocaleDateString(getLang())
}

const SYNC_HINT: Record<SyncKind, string> = { gdrive: '구글 계정으로 로그인해요', onedrive: 'Microsoft 계정으로 로그인해요', github: '개발자용 · 토큰이 필요해요' }
/** 보관 위치를 고르는 순서: 개발자·연구자는 GitHub 이 먼저, 나머지는 로그인만 하면 되는 곳이 먼저 */
const syncOrder = (p: ReturnType<typeof personaOf>): SyncKind[] => (p === 'developer' || p === 'researcher' ? ['github', 'gdrive', 'onedrive'] : ['gdrive', 'onedrive', 'github'])

/** 설정 화면이 열릴 때 "내 이름" 칸으로 바로 가 달라는 요청(내 업무의 "내 이름 설정 →"에서 쓴다) */
const useFocusName = create<{ want: boolean }>(() => ({ want: false }))
export function openMyNameSetting() {
  useFocusName.setState({ want: true })
  useSettingsUi.setState({ group: 'profile' })
  useApp.getState().go('settings')
}

/** 내 이름: 입력해 두고 "적용"을 눌러야 반영된다. 적용된 값과 같으면 버튼은 꺼져 있다 */
/** 내 프로필: 이름 + 내가 하는 일(역할). 설정 맨 위 */
function ProfileCard() {
  const persona = useApp((x) => personaOf(x.settings.persona))
  const options = [{ value: '', label: t('정하지 않음') }, ...PERSONAS.map((p) => ({ value: p as string, label: t(PERSONA_INFO[p].label) }))]
  /** 역할을 고르면 내 업무 화면도 그 구성으로 맞출지 묻는다 */
  const pick = async (v: string) => {
    const id = personaOf(v || null)
    setPersona(id)
    if (!id || matchesPreset(id, useWorkUi.getState().layout)) return
    const ok = await confirmAsk(t('내 업무 화면을 {role} 구성으로 맞출까요?', { role: t(PERSONA_INFO[id].label) }), undefined, t('예'), false, { cancelLabel: t('아니오'), note: t('지금 구성한 화면은 사라질 수 있어요.') })
    if (ok) applyPersonaLayout(id)
  }
  const reset = async () => {
    if (await confirmAsk(t('내 업무 화면을 처음 구성으로 되돌릴까요?'), undefined, t('초기화'), true)) resetWorkLayout(persona)
  }
  return (
    <section className="card profile">
      <h3>{t('내 프로필')}</h3>
      <MyNameField />
      <p className="hint small">{t('내 업무에는 담당자(owner:)가 내 이름인 일만 모여요. 쉼표로 별명도 넣을 수 있어요.')}</p>
      <div className="kv"><span>{t('내가 하는 일')}</span>
        <Select<string> value={persona ?? ''} options={options} title={t('내가 하는 일')} onChange={(v) => void pick(v)} />
      </div>
      <button className="link-btn small-reset" onClick={() => void reset()}>{t('내 업무 화면 초기화')}</button>
    </section>
  )
}

function MyNameField() {
  const saved = useApp((x) => x.settings.myName)
  const [draft, setDraft] = useState(saved)
  const input = useRef<HTMLInputElement>(null)
  const want = useFocusName((x) => x.want)
  useEffect(() => setDraft(saved), [saved])
  useEffect(() => {
    if (!want) return
    useFocusName.setState({ want: false })
    // 화면이 그려진 뒤 칸이 보이는 곳으로 스크롤하고 입력할 수 있게 한다
    setTimeout(() => {
      input.current?.scrollIntoView({ block: 'center' })
      input.current?.focus()
      input.current?.select()
    }, 60)
  }, [want])
  const apply = () => useApp.getState().patchSettings({ myName: draft.trim() })
  const same = draft.trim() === saved.trim()
  return (
    <div className="kv"><span>{t('내 이름')}</span>
      <span className="name-apply">
        <input ref={input} className="inline" value={draft} placeholder={t('홍길동, 길동')} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && !same && apply()} />
        <button className="primary" disabled={same} onClick={apply}>{same && saved.trim() ? t('적용됨') : t('적용')}</button>
      </span>
    </div>
  )
}

type GroupId = 'profile' | 'notes' | 'ai' | 'view' | 'work' | 'about'
/** 모바일: null = 그룹 목록, 그 밖 = 그 그룹 화면. PC: null 이면 첫 그룹 */
const useSettingsUi = create<{ group: GroupId | null }>(() => ({ group: null }))

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const f = () => setM(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [q])
  return m
}

/** 노트와 동기화 */
function VaultCard() {
  const vault = useActiveVault()
  const app = useApp.getState()
  if (!vault) return null
  return (
    <section className="card">
      <h3>{t('내 노트 보관함')}</h3>
      <div className="vault-now">
        <b>{vault.name}</b>
        <span>{vaultSub(vault)}</span>
      </div>
      <button className="big" onClick={() => app.setVaultSheet(true)}>{t('다른 보관함으로 전환')}</button>
      <div className="vault-more">
        <button className="btn-link" onClick={() => void createVaultFlow()}>{t('＋ 새 vault')}</button>
        <button className="btn-link" onClick={() => void renameVaultFlow(vault)}>{t('이름 바꾸기')}</button>
      </div>
      <details className="more">
        <summary>{t('고급')}</summary>
        <button className="danger-link" onClick={() => void deleteVaultFlow(vault)}>{t('이 vault 삭제')}</button>
      </details>
    </section>
  )
}

function SyncCard() {
  const s = useApp((x) => x.settings)
  const files = useApp((x) => x.files)
  const syncing = useApp((x) => x.syncing)
  const app = useApp.getState()
  const [editing, setEditing] = useState(false)
  const [pick, setPick] = useState<SyncKind>('github')
  const [connecting, setConnecting] = useState(false)
  const [picked, setPicked] = useState(false)
  const persona = personaOf(s.persona)
  const dirty = Object.values(files).filter((f) => f.dirty).length
  const conflicts = Object.values(files).filter((f) => f.conflict).length
  const r = s.remote
  return (
    <section className="card">
      <h3>{t('다른 기기와 맞추기')}</h3>
      {r ? (
        <>
          <div className="kv"><span>{t('연결')}</span><b>{SYNC_LABEL[r.kind]} · {r.kind === 'github' ? `${r.owner}/${r.repo}` : r.folder}</b></div>
          <div className="kv"><span>{t('마지막 동기화')}</span><b>{ago(s.lastSync)}</b></div>
          <div className="kv"><span>{t('올리기 대기')}</span><b>{t('{n}개', { n: dirty })}{conflicts ? ' · ' + t('충돌 {n}', { n: conflicts }) : ''}</b></div>
          <button className="primary big" disabled={syncing} onClick={() => void app.sync()}>{syncing ? t('동기화 중…') : t('지금 동기화')}</button>
          <details className="more">
            <summary>{t('고급')}</summary>
            {r.kind === 'github' && <div className="kv"><span>{t('브랜치')}</span><b>{r.branch}</b></div>}
            <div className="btn-row"><button onClick={() => setEditing((v) => !v)}>{t('연결 수정')}</button></div>
            {editing && <ConnectForm kind={r.kind} onDone={() => setEditing(false)} />}
            <p className="hint small">{t('받은 변경을 먼저 가져온 뒤 내 변경을 올려요. 같은 노트를 양쪽에서 고치면 충돌 안내가 떠요.')}</p>
            <button
              className="danger-link"
              onClick={async () => {
                if (await confirmAsk(t('연결 해제'), t('이 vault의 노트 사본과 로그인 정보가 삭제됩니다(vault는 로컬 전용으로 남아요). 올리지 않은 변경은 사라져요.'), t('해제'), true)) await app.disconnect()
              }}
            >
              {t('연결 해제')}
            </button>
          </details>
        </>
      ) : (
        <>
          <p className="hint">{t('지금은 이 기기에만 저장돼요. 연결하면 다른 기기와 맞출 수 있어요.')}</p>
          {!connecting ? (
            <button className="primary big" onClick={() => setConnecting(true)}>{t('연결하기')}</button>
          ) : (
            <>
              {!picked ? (
                <>
                  <p className="aiw-q">{t('어디에 보관할까요?')}</p>
                  {syncOrder(persona).map((k) => (
                    <button key={k} className="aiw-way" onClick={() => { setPick(k); setPicked(true) }}>
                      <b>{SYNC_LABEL[k]}</b>
                      <small>{t(SYNC_HINT[k])}</small>
                    </button>
                  ))}
                  <button className="link-btn" onClick={() => setConnecting(false)}>{t('취소')}</button>
                </>
              ) : (
                <>
                  <p className="aiw-q">{t('{name} 연결', { name: SYNC_LABEL[pick] })}</p>
                  <ConnectForm key={pick} kind={pick} />
                  <button className="link-btn" onClick={() => setPicked(false)}>{t('← 다른 곳 고르기')}</button>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

function NotesGroup() {
  const s = useApp((x) => x.settings)
  const app = useApp.getState()
  return (
    <>
      <VaultCard />
      <SyncCard />
      <section className="card">
        <h3>{t('오늘의 노트')}</h3>
        <div className="kv"><span>{t('저장 폴더')}</span>
          <input className="inline" value={s.dailyFolder} onChange={(e) => app.patchSettings({ dailyFolder: e.target.value })} />
        </div>
      </section>
    </>
  )
}

/** AI: 자주 쓰는 것(앱 안 AI·자동 문서 관리)을 위에, 직접 연결·외부 연결은 "고급"으로 접는다 */
function AiGroup() {
  return (
    <>
      <AiWizard />
      {desktop() && (
        <>
          <AutoCard />
          <details className="more adv-card">
            <summary>{t('고급: 연결 직접 설정 (서버 주소·모델·키)')}</summary>
            <LlmCard />
          </details>
          <details className="more adv-card">
            <summary>{t('고급: 다른 앱의 AI가 내 노트를 쓰게 하기 (MCP)')}</summary>
            <McpCard />
          </details>
        </>
      )}
    </>
  )
}

function ViewGroup() {
  const s = useApp((x) => x.settings)
  const app = useApp.getState()
  const onOff = (key: 'calHolidays' | 'calLunar' | 'showRecent') => (
    <div className="seg">
      <button className={s[key] ? 'on' : ''} onClick={() => app.patchSettings({ [key]: true })}>{t('켜기')}</button>
      <button className={!s[key] ? 'on' : ''} onClick={() => app.patchSettings({ [key]: false })}>{t('끄기')}</button>
    </div>
  )
  return (
    <>
      <section className="card">
        <h3>{t('화면')}</h3>
        <div className="kv"><span>{t('언어')} / Language</span><LangSelect /></div>
        <div className="kv"><span>{t('테마')}</span>
          <div className="seg">
            {(['auto', 'light', 'dark'] as const).map((th) => (
              <button key={th} className={s.theme === th ? 'on' : ''} onClick={() => app.patchSettings({ theme: th })}>{{ auto: t('시스템'), light: t('라이트'), dark: t('다크') }[th]}</button>
            ))}
          </div>
        </div>
        <div className="kv"><span>{t('글자 크기 {n}px', { n: s.fontSize })}</span>
          <input type="range" min={14} max={24} value={s.fontSize} onChange={(e) => app.patchSettings({ fontSize: +e.target.value })} />
        </div>
        <div className="kv"><span>{t('노트를 열 때')}</span>
          <div className="seg">
            <button className={s.startMode === 'read' ? 'on' : ''} onClick={() => app.patchSettings({ startMode: 'read' })}>{t('읽기')}</button>
            <button className={s.startMode === 'edit' ? 'on' : ''} onClick={() => app.patchSettings({ startMode: 'edit' })}>{t('편집')}</button>
          </div>
        </div>
        <div className="kv"><span>{t('최근 연 노트 보이기')}</span>{onOff('showRecent')}</div>
      </section>
      <section className="card">
        <h3>{t('캘린더')}</h3>
        <div className="kv"><span>{t('공휴일 표시')}</span>{onOff('calHolidays')}</div>
        <div className="kv"><span>{t('음력 표시')}</span>{onOff('calLunar')}</div>
        <div className="kv"><span>{t('일정 알림')}</span>
          <div className="seg">
            {[0, 5, 10, 30].map((m) => (
              <button key={m} className={s.remindMin === m ? 'on' : ''} onClick={() => { app.patchSettings({ remindMin: m }); if (m) void askNotifyPermission().then((ok) => !ok && app.say(t('알림 권한이 없어 앱 안에서만 알려 드립니다'))) }}>{m ? t('{n}분', { n: m }) : t('끔')}</button>
            ))}
          </div>
        </div>
        <details className="more">
          <summary>{t('고급')}</summary>
          <div className="kv"><span>{t('비어 버린 Daily 노트')}</span>
            <button onClick={() => { const n = pruneAllDaily(); app.say(n ? t('빈 Daily 노트 {n}개를 정리했습니다', { n }) : t('정리할 빈 Daily 노트가 없습니다')) }}>{t('지금 정리')}</button>
          </div>
        </details>
      </section>
    </>
  )
}

/** 업무와 문서: 내 업무 화면 구성과 문서 규칙으로 바로 가기 */
function WorkGroup() {
  const app = useApp.getState()
  return (
    <section className="card">
      <h3>{t('업무와 문서')}</h3>
      <div className="kv"><span>{t('내 업무 화면 구성')}</span>
        <button onClick={() => { app.go('work'); useWorkUi.setState({ editing: true, returnTo: 'settings' }) }}>{t('편집하기')}</button>
      </div>
      <div className="kv"><span>{t('문서 규칙')}</span>
        <button onClick={() => app.openNote(DOCRULES_PATH)}>{t('규칙 파일 열기')}</button>
      </div>
    </section>
  )
}

function AboutGroup() {
  return (
    <>
      {desktop() && (
        <section className="card">
          <h3>{t('단축키')}</h3>
          <p className="hint small">{tx('{o} 빠른 이동 · {p} 명령 · {e} 읽기/편집 · {s} 동기화', { o: <kbd>Ctrl+O</kbd>, p: <kbd>Ctrl+P</kbd>, e: <kbd>Ctrl+E</kbd>, s: <kbd>Ctrl+S</kbd> })}</p>
          <p className="hint small">{tx('{f} 문서에서 찾기 · {s} 전체 검색 · {a} AI 패널', { f: <kbd>Ctrl+F</kbd>, s: <kbd>Ctrl+Shift+F</kbd>, a: <kbd>Ctrl+Shift+A</kbd> })}</p>
        </section>
      )}
      <WidgetCard />
      <section className="card">
        <h3>{t('정보')}</h3>
        <div className="kv"><span>{t('버전')}</span><b>{__APP_VERSION__}</b></div>
      </section>
    </>
  )
}

export function Settings() {
  const s = useApp((x) => x.settings)
  const vault = useActiveVault()
  const wide = useMedia('(min-width: 900px)')
  const picked = useSettingsUi((x) => x.group)
  const group: GroupId | null = wide ? (picked ?? 'profile') : picked
  const persona = personaOf(s.persona)
  const mobile = !desktop()
  const groups: { id: GroupId; label: string; icon: 'star' | 'sync' | 'spark' | 'sun' | 'tasks' | 'more'; sub: string }[] = [
    { id: 'profile', label: t('내 프로필'), icon: 'star', sub: `${s.myName.trim() || t('이름 없음')} · ${persona ? t(PERSONA_INFO[persona].label) : t('역할 미정')}` },
    { id: 'notes', label: t('노트와 동기화'), icon: 'sync', sub: `${vault?.name ?? ''} · ${s.remote ? SYNC_LABEL[s.remote.kind] : t('이 기기에만')}` },
    { id: 'ai', label: 'AI', icon: 'spark', sub: mobile ? t('PC 앱에서 쓸 수 있어요') : t('연결·자동 문서 관리') },
    { id: 'view', label: t('화면과 캘린더'), icon: 'sun', sub: `${{ auto: t('시스템'), light: t('라이트'), dark: t('다크') }[s.theme]} · ${s.fontSize}px` },
    { id: 'work', label: t('업무와 문서'), icon: 'tasks', sub: t('내 업무 구성·문서 규칙') },
    { id: 'about', label: t('정보'), icon: 'more', sub: `v${__APP_VERSION__}` },
  ]
  const page = {
    profile: <ProfileCard />,
    notes: <NotesGroup />,
    ai: <AiGroup />,
    view: <ViewGroup />,
    work: <WorkGroup />,
    about: <AboutGroup />,
  }
  const cur = groups.find((g) => g.id === group)
  const nav = (
    <nav className={`set-nav${wide ? '' : ' full'}`} aria-label={t('설정')}>
      {groups.map((g) => (
        <button key={g.id} className={`set-nav-row${group === g.id ? ' on' : ''}`} onClick={() => useSettingsUi.setState({ group: g.id })}>
          <span className="set-ico"><Icon name={g.icon} size={20} /></span>
          <span className="set-text"><b>{g.label}</b><small>{g.sub}</small></span>
          {!wide && <span className="set-chev"><Icon name="chevron" size={14} /></span>}
        </button>
      ))}
    </nav>
  )
  return (
    <div className="settings">
      <div className="panel-head">
        {!wide && group && <button className="icon-btn" onClick={() => useSettingsUi.setState({ group: null })} aria-label={t('설정 목록으로')}><Icon name="back" /></button>}
        <h2>{!wide && cur ? cur.label : t('설정')}</h2>
      </div>
      {wide ? (
        <div className="set-split">
          {nav}
          <div className="settings-scroll set-pane" key={group}>{group && page[group]}</div>
        </div>
      ) : group ? (
        <div className="settings-scroll" key={group}>{page[group]}</div>
      ) : (
        <div className="settings-scroll">{nav}</div>
      )}
    </div>
  )
}

/** PC 앱 전용: 바탕화면 위젯 설정 */
function WidgetCard() {
  const api = desktop()?.widget
  const [w, setW] = useState<WidgetState | null>(null)
  useEffect(() => {
    void api?.get().then(setW)
    return api?.onState(setW)
  }, [api])
  if (!api || !w) return null
  const seg = <K extends 'mode' | 'layer' | 'autostart' | 'enabled'>(key: K, opts: [WidgetState[K], string][]) => (
    <div className="seg">
      {opts.map(([v, label]) => (
        <button key={String(v)} className={w[key] === v ? 'on' : ''} onClick={() => void api.set({ [key]: v })}>{label}</button>
      ))}
    </div>
  )
  return (
    <section className="card">
      <h3>{t('바탕화면 위젯')}</h3>
      <div className="kv"><span>{t('위젯 표시')}</span>{seg('enabled', [[true, t('켜기')], [false, t('끄기')]])}</div>
      {w.enabled && (
        <>
          <div className="kv"><span>{t('보기')}</span>{seg('mode', [['month', t('월간')], ['today', t('오늘')], ['agenda', t('목록')]])}</div>
          <div className="kv"><span>{t('위치')}</span>
            {seg('layer', [['desktop', t('바탕화면')], ['top', t('항상 위')]])}
          </div>
          {w.layer === 'desktop' && (
            <div className="kv"><span>{t('배경 진하기 {n}%', { n: Math.round((w.tint ?? 0.25) * 100) })}</span>
              <input type="range" min={0} max={80} value={Math.round((w.tint ?? 0.25) * 100)} onChange={(e) => void api.set({ tint: +e.target.value / 100 })} />
            </div>
          )}
          {w.layer === 'top' && (
            <div className="kv"><span>{t('투명도 {n}%', { n: Math.round(w.opacity * 100) })}</span>
              <input type="range" min={30} max={100} value={Math.round(w.opacity * 100)} onChange={(e) => void api.set({ opacity: +e.target.value / 100 })} />
            </div>
          )}
          {w.layer === 'desktop' && !w.desktopSupported && <p className="hint small">{t('이 PC에서는 바탕화면에 붙이지 못해 일반 창으로 표시합니다.')}</p>}
          <div className="kv"><span>{t('로그인할 때 위젯만 시작')}</span>{seg('autostart', [[true, t('켜기')], [false, t('끄기')]])}</div>
          <p className="hint small">{t('위젯 머리글을 끌어 옮기고, 오른쪽 아래 모서리를 끌어 크기를 바꿉니다. 앱 창을 닫아도 위젯은 남고, 작업 표시줄 오른쪽 아이콘에서 다시 열거나 종료할 수 있습니다.')}</p>
        </>
      )}
    </section>
  )
}
