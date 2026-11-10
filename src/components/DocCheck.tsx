// 프로젝트 허브의 "문서 점검" 탭: 프로젝트 문서가 문서 규칙에 얼마나 맞는지 보여 준다.
// 알려 주기만 한다 — 노트를 고치거나 저장을 막지 않는다. 규칙은 일반 노트(_workspace/문서규칙.md)라서 일반 편집기로 고친다.
import { useMemo } from 'react'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { baseName } from '../lib/links'
import { DEFAULT_PROFILE, DOCRULES_PATH, profileFor, readRules, rulesNoteTemplate, setFmKey } from '../lib/docrules'
import { lintProject, type LintItem } from '../lib/doclint'
import type { Project } from '../lib/work'

/** 프로젝트 노트 속성의 docs: 를 바꾼다(null 이면 지움) */
function setProjectDocs(project: Project, value: string | null) {
  const app = useApp.getState()
  const f = app.files[project.path]
  if (f && !f.deleted) app.setContent(project.path, setFmKey(f.content, 'docs', value))
}

/** 규칙 노트를 켠다: 없으면 설명과 함께 만들고, 꺼져 있으면 rules: on 으로 */
function turnOnRules() {
  const app = useApp.getState()
  const f = app.files[DOCRULES_PATH]
  if (!f || f.deleted) app.createNote(DOCRULES_PATH, rulesNoteTemplate(), false)
  else app.setContent(DOCRULES_PATH, setFmKey(f.content, 'rules', 'on'))
}

const REASON: Record<string, string> = { stem: '이름이 비슷함', headings: '제목 구성이 비슷함', body: '본문이 비슷함' }

function messageOf(it: LintItem, rel: (p: string) => string): string {
  switch (it.kind) {
    case 'unknownRole': return t('role: {role} 는 규칙에 없는 역할이에요', { role: it.text ?? '' })
    case 'roleConflict': return t('파일 이름은 "{a}" 인데 role: 은 "{b}" 라서 역할을 정하지 못했어요', { a: it.text ?? '', b: it.text2 ?? '' })
    case 'roleMisplaced': return t('"{role}" 은 공식 역할인데 정해진 자리({where})가 아니라서 역할을 정하지 못했어요', { role: it.text ?? '', where: it.text2 ?? '' })
    case 'singletonDup': return t('"{role}" 문서가 {n}개예요 — 하나만 있어야 해요', { role: it.text ?? '', n: 1 + (it.others?.length ?? 0) })
    case 'missingDoc': return t('"{role}" 문서({file})가 아직 없어요', { role: it.text ?? '', file: it.text2 ?? '' })
    case 'missingSection': return t('필수 제목 "{h}" 이(가) 없어요', { h: it.text ?? '' })
    case 'emptySection': return t('"{h}" 아래가 비어 있어요', { h: it.text ?? '' })
    case 'badStatus': return t('status "{v}" 는 허용된 값이 아니에요', { v: it.text ?? '' })
    case 'noStatus': return t('status 가 없어요')
    case 'brokenLink': return t('[[{n}]] 노트를 찾을 수 없어요', { n: it.text ?? '' })
    case 'brokenAnchor': return t('[[{n}#{h}]] 제목을 찾을 수 없어요', { n: it.text ?? '', h: it.text2 ?? '' })
    case 'orphan': return t('다른 노트에서 링크하지 않아요')
    case 'unreachable': return t('개요에서 링크를 따라 닿을 수 없어요')
    case 'duplicate': return t('겹칠 수 있는 문서(후보): {other}', { other: it.others?.map(rel).join(', ') ?? '' }) + ` · ${(it.reasons ?? []).map((r) => t(REASON[r])).join(' · ')}`
  }
}

export function DocCheck({ project }: { project: Project }) {
  const files = useApp((s) => s.files)
  const index = useApp((s) => s.index)
  const rules = useMemo(() => readRules(files), [files])
  const profile = useMemo(() => profileFor(rules, project.fm), [rules, project.fm])
  const report = useMemo(() => (profile ? lintProject(project, files, rules, profile, index) : null), [profile, project, files, rules, index])
  const rel = (p: string) => (project.folder && p.startsWith(project.folder + '/') ? p.slice(project.folder.length + 1) : p)
  const open = (p: string) => useApp.getState().openNote(p)
  const docsValue = typeof project.fm.docs === 'string' ? project.fm.docs : ''
  const hasDefault = rules.profiles.some((p) => p.name.toLowerCase() === DEFAULT_PROFILE.toLowerCase())

  const ruleBtn = <button className="wrk-viewedit" onClick={() => open(DOCRULES_PATH)}>{t('규칙 파일 열기')}</button>
  const ruleFile = <div className="dchk-foot">{ruleBtn}</div>

  // 규칙이 꺼져 있음
  if (!rules.enabled) {
    return (
      <section className="wrk-sec dchk">
        <p className="dchk-intro">{t('문서 규칙을 켜면, 이 프로젝트의 문서가 정해 둔 구조(개요·정책·할 일 …)에 맞는지 점검해 줘요. 점검은 알려 주기만 하고, 노트를 고치거나 저장을 막지 않아요.')}</p>
        <button className="primary" onClick={() => { turnOnRules(); setProjectDocs(project, DEFAULT_PROFILE) }}>{t('문서 규칙 켜고 이 프로젝트에 적용')}</button>
        {rules.present && ruleFile}
      </section>
    )
  }

  // 켜져 있지만 이 프로젝트에는 적용되지 않음(또는 프로필을 못 찾음)
  if (!profile || !report) {
    const wanted = docsValue && !['on', 'true'].includes(docsValue.toLowerCase()) ? docsValue : DEFAULT_PROFILE
    const off = ['off', 'false', 'no'].includes(docsValue.toLowerCase())
    const missing = !off && (docsValue !== '' || rules.apply === 'all-projects') && !rules.profiles.some((p) => p.name.toLowerCase() === wanted.toLowerCase())
    return (
      <section className="wrk-sec dchk">
        {missing ? (
          <p className="dchk-intro">{t('규칙 파일에 "{name}" 프로필이 없어요. 규칙 파일에서 "## 프로필: {name}" 아래에 역할을 적어 주세요.', { name: wanted })}</p>
        ) : (
          <>
            <p className="dchk-intro">{off ? t('이 프로젝트는 문서 점검을 끈 상태예요.') : t('이 프로젝트에는 아직 문서 규칙을 적용하지 않았어요.')}</p>
            {hasDefault && <button className="primary" onClick={() => setProjectDocs(project, DEFAULT_PROFILE)}>{t('이 프로젝트에 적용')}</button>}
          </>
        )}
        {ruleFile}
      </section>
    )
  }

  const warn = report.items.filter((i) => i.severity === 'warn')
  const info = report.items.filter((i) => i.severity === 'info')
  const official = report.docs.filter((d) => d.role?.official).length
  const row = (it: LintItem, i: number) => (
    <button key={it.kind + it.path + i} className="wrk-projrow" onClick={() => open(it.path)}>
      <span className="wrk-pname">{it.kind === 'missingDoc' ? t('빠진 문서') : rel(it.path) || baseName(it.path)}</span>
      <span className="wrk-pmeta"><span>{messageOf(it, rel)}</span></span>
    </button>
  )

  return (
    <section className="wrk-sec dchk">
      <p className="dchk-sum">
        {t('{profile} 프로필', { profile: report.profile })} · {t('공식 문서 {n}개', { n: official })} · {t('그 밖의 문서 {n}개', { n: report.docs.length - official })}
        {report.unclassified.length > 0 && <> ({t('규칙에 없는 문서 {n}개', { n: report.unclassified.length })})</>}
      </p>
      {rules.problems.length > 0 && (
        <p className="hint dchk-problems">{t('규칙 파일에서 이해하지 못한 줄이 {n}개 있어요 ({lines}번째 줄). 그 줄은 무시했어요.', { n: rules.problems.length, lines: rules.problems.map((p) => p.line).join(', ') })}</p>
      )}
      {warn.length === 0 && info.length === 0 && <p className="hint pad">{t('점검할 문제가 없어요. 👍')}</p>}
      {warn.length > 0 && (
        <div className="dchk-group">
          <h3>{t('확인해 볼 것')}<span className="wrk-count">{warn.length}</span></h3>
          {warn.map(row)}
        </div>
      )}
      {info.length > 0 && (
        <details className="dchk-group dchk-info" open={warn.length === 0}>
          <summary>{t('참고')} <span className="wrk-count">{info.length}</span></summary>
          {info.map(row)}
        </details>
      )}
      <p className="hint dchk-note">{t('중복은 이름·제목·본문이 겹치는 "후보"만 보여 줘요. 의미가 같고 글자가 다른 문서는 찾지 못해요.')}</p>
      <div className="dchk-foot">
        {ruleBtn}
        <button className="wrk-viewedit" onClick={() => setProjectDocs(project, 'off')}>{t('이 프로젝트에서 끄기')}</button>
      </div>
    </section>
  )
}
