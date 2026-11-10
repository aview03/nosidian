import { askNotifyPermission } from '../lib/reminders'
import { pruneAllDaily } from '../lib/calendar'
import { desktop, type WidgetState } from '../lib/externalIO'
import { CalendarBridge, isAndroid } from '../lib/nativeCal'
import { t, getLang } from '../lib/i18n'
import { tx } from '../lib/tx'
import { LangSelect } from './LangSelect'
import { LlmCard } from './LlmSettings'
import { McpCard } from './McpSettings'
import { ClaudeCliCard } from './ClaudeCliSettings'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useApp } from '../lib/app'
import { confirmAsk } from '../lib/dialog'
import { SYNC_LABEL, type SyncKind } from '../lib/types'
import { ConnectForm } from './Onboarding'
import { createVaultFlow, deleteVaultFlow, renameVaultFlow, useActiveVault, vaultSub } from './VaultSheet'

function ago(ts: number | null) {
  if (!ts) return t('아직 없음')
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return t('방금')
  if (m < 60) return t('{n}분 전', { n: m })
  if (m < 1440) return t('{n}시간 전', { n: Math.round(m / 60) })
  return new Date(ts).toLocaleDateString(getLang())
}

const KINDS = Object.keys(SYNC_LABEL) as SyncKind[]

/** 설정 화면이 열릴 때 "내 이름" 칸으로 바로 가 달라는 요청(내 업무의 "내 이름 설정 →"에서 쓴다) */
const useFocusName = create<{ want: boolean }>(() => ({ want: false }))
export function openMyNameSetting() {
  useFocusName.setState({ want: true })
  useApp.getState().go('settings')
}

/** 내 이름: 입력해 두고 "적용"을 눌러야 반영된다. 적용된 값과 같으면 버튼은 꺼져 있다 */
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

export function Settings() {
  const s = useApp((x) => x.settings)
  const files = useApp((x) => x.files)
  const syncing = useApp((x) => x.syncing)
  const app = useApp.getState()
  const [editing, setEditing] = useState(false)
  const [pick, setPick] = useState<SyncKind>('github')
  const dirty = Object.values(files).filter((f) => f.dirty).length
  const conflicts = Object.values(files).filter((f) => f.conflict).length
  const r = s.remote
  const vault = useActiveVault()

  return (
    <div className="settings">
      <div className="panel-head"><h2>{t('설정')}</h2></div>
      <div className="settings-scroll">
        {vault && (
          <section className="card">
            <h3>Vault</h3>
            <div className="kv"><span>{t('현재')}</span><b>{vault.name}</b></div>
            <div className="kv"><span>{t('동기화')}</span><b>{vaultSub(vault)}</b></div>
            <div className="btn-row">
              <button onClick={() => app.setVaultSheet(true)}>{t('전환')}</button>
              <button onClick={() => void createVaultFlow()}>{t('＋ 새 vault')}</button>
              <button onClick={() => void renameVaultFlow(vault)}>{t('이름 바꾸기')}</button>
            </div>
            <button className="danger-link" onClick={() => void deleteVaultFlow(vault)}>{t('이 vault 삭제')}</button>
          </section>
        )}

        <section className="card">
          <h3>{t('동기화')}{r ? ` · ${SYNC_LABEL[r.kind]}` : ''}</h3>
          {r ? (
            <>
              {r.kind === 'github' ? (
                <>
                  <div className="kv"><span>{t('저장소')}</span><b>{r.owner}/{r.repo}</b></div>
                  <div className="kv"><span>{t('브랜치')}</span><b>{r.branch}</b></div>
                </>
              ) : (
                <div className="kv"><span>{t('폴더')}</span><b>{r.folder}</b></div>
              )}
              <div className="kv"><span>{t('마지막 동기화')}</span><b>{ago(s.lastSync)}</b></div>
              <div className="kv"><span>{t('올리기 대기')}</span><b>{t('{n}개', { n: dirty })}{conflicts ? ' · ' + t('충돌 {n}', { n: conflicts }) : ''}</b></div>
              <div className="btn-row">
                <button className="primary" disabled={syncing} onClick={() => void app.sync()}>{syncing ? t('동기화 중…') : t('지금 동기화')}</button>
                <button onClick={() => setEditing((v) => !v)}>{t('연결 수정')}</button>
              </div>
              {editing && <ConnectForm kind={r.kind} onDone={() => setEditing(false)} />}
              <button
                className="danger-link"
                onClick={async () => {
                  if (await confirmAsk(t('연결 해제'), t('이 vault의 노트 사본과 로그인 정보가 삭제됩니다(vault는 로컬 전용으로 남아요). 올리지 않은 변경은 사라져요.'), t('해제'), true)) await app.disconnect()
                }}
              >
                {t('이 vault의 연결 해제 및 로컬 데이터 삭제')}
              </button>
            </>
          ) : (
            <>
              <p className="hint">{t('로컬 전용 vault예요. 이 기기에만 저장돼요. 아래에서 연결하면 지금 노트도 함께 올라가요.')}</p>
              <div className="seg wide">
                {KINDS.map((k) => (
                  <button key={k} className={pick === k ? 'on' : ''} onClick={() => setPick(k)}>{SYNC_LABEL[k]}</button>
                ))}
              </div>
              <ConnectForm key={pick} kind={pick} />
            </>
          )}
          <p className="hint small">{t('동기화 = 원격의 변경분을 받고(pull) → 이 기기의 변경분을 올립니다(push). 같은 노트를 양쪽에서 고치면 충돌 안내가 표시됩니다.')}</p>
        </section>

        <WidgetCard />
        {isAndroid() && (
          <section className="card">
            <h3>{t('홈 화면 위젯')}</h3>
            <div className="btn-row">
              <button onClick={() => void CalendarBridge.pinWidget({ type: 'month' }).catch(() => app.say(t('이 런처는 앱에서 위젯 추가를 지원하지 않습니다. 홈 화면을 길게 눌러 위젯에서 Nosidian을 고르세요.')))}>{t('월간 달력 추가')}</button>
              <button onClick={() => void CalendarBridge.pinWidget({ type: 'agenda' }).catch(() => app.say(t('이 런처는 앱에서 위젯 추가를 지원하지 않습니다. 홈 화면을 길게 눌러 위젯에서 Nosidian을 고르세요.')))}>{t('일정 목록 추가')}</button>
            </div>
            <p className="hint small">{t('위젯의 날짜나 일정을 누르면 앱의 그 날로 이동하고, + 를 누르면 바로 일정을 추가할 수 있습니다.')}</p>
          </section>
        )}
        <section className="card">
          <h3>{t('업무')}</h3>
          <MyNameField />
          <p className="hint small">{t('할 일 줄의 owner:이름 이 내 이름과 같은 일만 내 업무에 모아 보여 줍니다. 쉼표로 여러 이름(별명)을 쓸 수 있어요.')}</p>
        </section>
        <LlmCard />
        <ClaudeCliCard />
        <McpCard />
        <section className="card">
          <h3>{t('캘린더')}</h3>
          <div className="kv"><span>{t('공휴일 표시')}</span>
            <div className="seg">
              <button className={s.calHolidays ? 'on' : ''} onClick={() => app.patchSettings({ calHolidays: true })}>{t('켜기')}</button>
              <button className={!s.calHolidays ? 'on' : ''} onClick={() => app.patchSettings({ calHolidays: false })}>{t('끄기')}</button>
            </div>
          </div>
          <div className="kv"><span>{t('음력 표시')}</span>
            <div className="seg">
              <button className={s.calLunar ? 'on' : ''} onClick={() => app.patchSettings({ calLunar: true })}>{t('켜기')}</button>
              <button className={!s.calLunar ? 'on' : ''} onClick={() => app.patchSettings({ calLunar: false })}>{t('끄기')}</button>
            </div>
          </div>
          <div className="kv"><span>{t('일정 알림')}</span>
            <div className="seg">
              {[0, 5, 10, 30].map((m) => (
                <button key={m} className={s.remindMin === m ? 'on' : ''} onClick={() => { app.patchSettings({ remindMin: m }); if (m) void askNotifyPermission().then((ok) => !ok && app.say(t('알림 권한이 없어 앱 안에서만 알려 드립니다'))) }}>{m ? t('{n}분', { n: m }) : t('끔')}</button>
              ))}
            </div>
          </div>
          <div className="kv"><span>{t('일정·메모가 비어 버린 Daily 노트')}</span>
            <button onClick={() => { const n = pruneAllDaily(); app.say(n ? t('빈 Daily 노트 {n}개를 정리했습니다', { n }) : t('정리할 빈 Daily 노트가 없습니다')) }}>{t('지금 정리')}</button>
          </div>
        </section>

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
          <div className="kv"><span>{t('파일 목록에 최근 연 노트 표시')}</span>
            <div className="seg">
              <button className={s.showRecent ? 'on' : ''} onClick={() => app.patchSettings({ showRecent: true })}>{t('켜기')}</button>
              <button className={!s.showRecent ? 'on' : ''} onClick={() => app.patchSettings({ showRecent: false })}>{t('끄기')}</button>
            </div>
          </div>
          <div className="kv"><span>{t('오늘의 노트 폴더')}</span>
            <input className="inline" value={s.dailyFolder} onChange={(e) => app.patchSettings({ dailyFolder: e.target.value })} />
          </div>
        </section>

        <section className="card">
          <h3>{t('단축키 (PC)')}</h3>
          <p className="hint small">{tx('{o} 빠른 이동 · {p} 명령 · {e} 읽기/편집 · {s} 동기화 · {alt} 뒤로/앞으로 · 링크는 {click}', { o: <kbd>Ctrl+O</kbd>, p: <kbd>Ctrl+P</kbd>, e: <kbd>Ctrl+E</kbd>, s: <kbd>Ctrl+S</kbd>, alt: <kbd>Alt+←/→</kbd>, click: <kbd>Ctrl+Click</kbd> })}</p>
          <p className="hint small">{tx('{f} 문서에서 찾기 · {s} 전체 검색', { f: <kbd>Ctrl+F</kbd>, s: <kbd>Ctrl+Shift+F</kbd> })}</p>
          {desktop()?.claude && <p className="hint small">{tx('{a} AI 패널', { a: <kbd>Ctrl+Shift+A</kbd> })}</p>}
        </section>
      </div>
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
