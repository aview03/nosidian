// 프로젝트 템플릿: 폴더 하나(문서 몇 개)를 만들어 주는 틀. 결과는 평범한 마크다운 노트라서 만든 뒤엔 자유롭게 고치면 된다.
//
// 자리표시자: {{name}} 프로젝트 이름, {{owner}} 담당자, {{due}} 마감일, {{today}} 오늘, {{due-14}} 마감일 14일 전(+도 가능).
// 마감일을 정하지 않았으면 `due:{{due-N}}` 꼬리표는 줄에서 빠진다.
import { getLang, t } from './i18n'
import { TEMPLATES_DIR, templateParts } from './templatePaths'
import type { NoteFile } from './types'
import { addDaysYmd, diffDays, type Project } from './work'

export interface ProjectTemplate {
  id: string
  name: string
  desc: string
  /** 프로젝트 폴더 안의 상대 경로 → 내용 */
  files: Record<string, string>
  /** vault 의 Templates/ 폴더에서 읽은 사용자 템플릿이면 true */
  mine?: boolean
}

const OVERVIEW = (ko: boolean) =>
  `---\ntype: project\nstatus: ${ko ? '진행 중' : 'In progress'}\nowner: {{owner}}\ndue: {{due}}\n---\n# {{name}}\n\n`

const KO: ProjectTemplate[] = [
  {
    id: 'general', name: '일반', desc: '개요와 할 일만 있는 가장 단순한 틀',
    files: {
      '프로젝트 개요.md': OVERVIEW(true) + '## 목표\n\n\n## 범위\n\n\n같은 폴더의 [[할 일]] 노트에 적은 체크리스트가 **내 업무**에 모입니다.\n',
      '할 일.md': '# 할 일\n\n- [ ] 첫 할 일 owner:{{owner}} due:{{due-7}}\n',
    },
  },
  {
    id: 'event', name: '행사', desc: '준비 일정이 마감일에서 거꾸로 잡힌 행사용 틀',
    files: {
      '프로젝트 개요.md': OVERVIEW(true) + '## 개요\n\n- 일시: {{due}}\n- 장소:\n- 인원:\n- 예산:\n\n같은 폴더의 [[할 일]] 노트에 적은 체크리스트가 **내 업무**에 모입니다.\n',
      '할 일.md': '# 할 일\n\n- [ ] 날짜·장소 확정 owner:{{owner}} due:{{due-30}} p:1\n- [ ] 예산 확정 owner:{{owner}} due:{{due-28}}\n- [ ] 초대·공지 발송 due:{{due-21}}\n- [ ] 업체 견적·계약 due:{{due-14}}\n- [ ] 참석자 최종 확인 due:{{due-7}}\n- [ ] 현장 리허설 due:{{due-1}}\n- [ ] 정산·후기 정리 due:{{due+3}}\n',
      '회의록.md': '# 회의록\n\n## {{today}}\n\n- 참석:\n- 결정:\n- 할 일:\n',
    },
  },
  {
    id: 'content', name: '콘텐츠', desc: '기획 → 제작 → 검수 → 배포 흐름의 콘텐츠용 틀',
    files: {
      '프로젝트 개요.md': OVERVIEW(true) + '## 기획\n\n- 대상:\n- 메시지:\n- 채널:\n\n같은 폴더의 [[할 일]] 노트에 적은 체크리스트가 **내 업무**에 모입니다.\n',
      '할 일.md': '# 할 일\n\n- [ ] 기획안 작성 owner:{{owner}} due:{{due-21}} p:1\n- [ ] 초안 제작 due:{{due-14}}\n- [ ] 내부 검수 due:{{due-7}}\n- [ ] 수정 반영 due:{{due-3}}\n- [ ] 배포 due:{{due}}\n- [ ] 성과 확인 due:{{due+7}}\n',
    },
  },
  {
    id: 'design', name: '디자인 일정', desc: '시안 일정과 검토 받은 날만 가볍게 적는 틀(문서·점검 탭은 숨겨요)',
    files: {
      '프로젝트 개요.md': '---\ntype: project\nstatus: 진행 중\nowner: {{owner}}\ndue: {{due}}\ndepth: light\nwords: design\n---\n# {{name}}\n\n무엇을 언제까지 만드는지만 적어요. 같은 폴더의 [[할 일]] 노트에 적은 체크리스트가 **내 업무**에 모입니다.\n\n상태 이름은 시작 전 → 시안 중 → 검토 요청 → 확정으로 보여요. 문서·점검이 필요해지면 프로젝트 화면의 ⋯ 메뉴에서 "문서·점검 탭 보이기"를 누르세요.\n',
      '할 일.md': '# 할 일\n\n- [ ] 시안 1차 owner:{{owner}} start:{{due-21}} due:{{due-14}}\n- [ ] 1차 검토 받기 owner:{{owner}} start:{{due-14}} due:{{due-10}}\n- [ ] 수정 반영 owner:{{owner}} start:{{due-10}} due:{{due-5}}\n- [ ] 최종 확정 owner:{{owner}} due:{{due}}\n',
    },
  },
  {
    id: 'planning', name: '기획 정식', desc: 'PRD·정책서·기능설계서·IA·결정 기록·일정(간트)이 있는 기획용 틀',
    files: {
      '프로젝트 개요.md': OVERVIEW(true) + '## 목표\n\n\n## 범위\n\n\n## 이해관계자\n\n\n같은 폴더의 [[할 일]] 노트에 적은 체크리스트가 **내 업무**에 모입니다. 결정이 필요한 안건은 [[결정 기록]] 에, 문서는 아래 틀을 채워 가세요: [[PRD]] · [[정책서]] · [[기능설계서]] · [[IA 구조도]]\n',
      'PRD.md': '# PRD\n\n## 배경과 문제\n\n\n## 목표와 성공 지표\n\n\n## 사용자와 시나리오\n\n\n## 요구사항\n\n| 번호 | 요구사항 | 우선순위 | 비고 |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## 범위 밖\n\n\n## 일정\n\n\n## 열린 질문\n\n',
      '정책서.md': '# 정책서\n\n## 적용 범위\n\n\n## 정책\n\n| 번호 | 정책 | 예외 | 근거 |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## 변경 이력\n\n',
      '기능설계서.md': '# 기능설계서\n\n## 기능 개요\n\n\n## 사용자 흐름\n\n\n## 화면별 동작\n\n\n## 예외·오류 처리\n\n\n## 연관 정책\n\n[[정책서]]\n',
      'IA 구조도.md': '# IA 구조도\n\n## 메뉴 구조\n\n- 홈\n  - \n- \n\n## 화면 목록\n\n| 화면 | 진입 경로 | 설명 |\n| --- | --- | --- |\n|  |  |  |\n',
      '결정 기록.md': '# 결정 기록\n\n결정이 필요한 안건은 아래처럼 적으면 **결정할 일** 목록에 모이고, 결정하면 결론을 한 줄 적어 닫아요.\n\n- [ ] 핵심 지표 정의 kind:decision owner:{{owner}} due:{{due-21}}\n',
      '할 일.md': '# 할 일\n\n- [ ] 요구사항 정리 owner:{{owner}} start:{{due-60}} due:{{due-45}} p:1\n- [ ] PRD 초안 owner:{{owner}} start:{{due-45}} due:{{due-35}}\n- [ ] 정책 확정 owner:{{owner}} start:{{due-35}} due:{{due-28}}\n- [ ] 기능설계서 작성 owner:{{owner}} start:{{due-28}} due:{{due-14}}\n- [ ] 이해관계자 검토 owner:{{owner}} start:{{due-14}} due:{{due-7}}\n- [ ] 최종 확정 owner:{{owner}} due:{{due}}\n',
      '회의록.md': '# 회의록\n\n## {{today}}\n\n- 참석:\n- 결정:\n- 할 일:\n',
    },
  },
]

const EN: ProjectTemplate[] = [
  {
    id: 'general', name: 'General', desc: 'The simplest: an overview and a task list',
    files: {
      'Project Overview.md': OVERVIEW(false) + '## Goal\n\n\n## Scope\n\n\nChecklists in the [[Tasks]] note in this folder show up in **My Work**.\n',
      'Tasks.md': '# Tasks\n\n- [ ] First task owner:{{owner}} due:{{due-7}}\n',
    },
  },
  {
    id: 'event', name: 'Event', desc: 'Prep schedule counted back from the date',
    files: {
      'Project Overview.md': OVERVIEW(false) + '## Overview\n\n- Date: {{due}}\n- Venue:\n- Guests:\n- Budget:\n\nChecklists in the [[Tasks]] note in this folder show up in **My Work**.\n',
      'Tasks.md': '# Tasks\n\n- [ ] Confirm date and venue owner:{{owner}} due:{{due-30}} p:1\n- [ ] Confirm budget owner:{{owner}} due:{{due-28}}\n- [ ] Send invitations due:{{due-21}}\n- [ ] Vendor quotes and contracts due:{{due-14}}\n- [ ] Final headcount due:{{due-7}}\n- [ ] On-site rehearsal due:{{due-1}}\n- [ ] Settle costs and write up due:{{due+3}}\n',
      'Meeting Notes.md': '# Meeting Notes\n\n## {{today}}\n\n- Attendees:\n- Decisions:\n- Actions:\n',
    },
  },
  {
    id: 'content', name: 'Content', desc: 'Plan → produce → review → publish',
    files: {
      'Project Overview.md': OVERVIEW(false) + '## Plan\n\n- Audience:\n- Message:\n- Channel:\n\nChecklists in the [[Tasks]] note in this folder show up in **My Work**.\n',
      'Tasks.md': '# Tasks\n\n- [ ] Write the brief owner:{{owner}} due:{{due-21}} p:1\n- [ ] First draft due:{{due-14}}\n- [ ] Internal review due:{{due-7}}\n- [ ] Apply feedback due:{{due-3}}\n- [ ] Publish due:{{due}}\n- [ ] Check results due:{{due+7}}\n',
    },
  },
  {
    id: 'design', name: 'Design schedule', desc: 'Just the draft schedule and review dates (hides the Docs and Check tabs)',
    files: {
      'Project Overview.md': '---\ntype: project\nstatus: In progress\nowner: {{owner}}\ndue: {{due}}\ndepth: light\nwords: design\n---\n# {{name}}\n\nJust write what is due when. Checklists in the [[Tasks]] note of this folder appear in **My work**.\n\nStatus names read Not started → Drafting → In review → Final. When you need docs and checks, use the ⋯ menu on the project screen: "Show docs & check tabs".\n',
      'Tasks.md': '# Tasks\n\n- [ ] First draft owner:{{owner}} start:{{due-21}} due:{{due-14}}\n- [ ] Get first review owner:{{owner}} start:{{due-14}} due:{{due-10}}\n- [ ] Apply feedback owner:{{owner}} start:{{due-10}} due:{{due-5}}\n- [ ] Final sign-off owner:{{owner}} due:{{due}}\n',
    },
  },
  {
    id: 'planning', name: 'Planning (full)', desc: 'PRD, policy, feature spec, IA, decision log and a schedule (Gantt)',
    files: {
      'Project Overview.md': OVERVIEW(false) + '## Goal\n\n\n## Scope\n\n\n## Stakeholders\n\n\nChecklists in the [[Tasks]] note appear in **My work**. Put open decisions in the [[Decision Log]] and fill in the docs: [[PRD]] · [[Policy]] · [[Feature Spec]] · [[IA Map]]\n',
      'PRD.md': '# PRD\n\n## Background and problem\n\n\n## Goals and success metrics\n\n\n## Users and scenarios\n\n\n## Requirements\n\n| No. | Requirement | Priority | Notes |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Out of scope\n\n\n## Schedule\n\n\n## Open questions\n\n',
      'Policy.md': '# Policy\n\n## Scope\n\n\n## Policies\n\n| No. | Policy | Exceptions | Rationale |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Change history\n\n',
      'Feature Spec.md': '# Feature Spec\n\n## Overview\n\n\n## User flow\n\n\n## Behavior per screen\n\n\n## Errors and edge cases\n\n\n## Related policy\n\n[[Policy]]\n',
      'IA Map.md': '# IA Map\n\n## Menu structure\n\n- Home\n  - \n- \n\n## Screen list\n\n| Screen | Entry path | Description |\n| --- | --- | --- |\n|  |  |  |\n',
      'Decision Log.md': '# Decision Log\n\nWrite open decisions like this and they collect under **Decisions**; when decided, add the conclusion on one line and close it.\n\n- [ ] Define the key metric kind:decision owner:{{owner}} due:{{due-21}}\n',
      'Tasks.md': '# Tasks\n\n- [ ] Gather requirements owner:{{owner}} start:{{due-60}} due:{{due-45}} p:1\n- [ ] PRD draft owner:{{owner}} start:{{due-45}} due:{{due-35}}\n- [ ] Settle policies owner:{{owner}} start:{{due-35}} due:{{due-28}}\n- [ ] Write the feature spec owner:{{owner}} start:{{due-28}} due:{{due-14}}\n- [ ] Stakeholder review owner:{{owner}} start:{{due-14}} due:{{due-7}}\n- [ ] Final sign-off owner:{{owner}} due:{{due}}\n',
      'Meeting Notes.md': '# Meeting Notes\n\n## {{today}}\n\n- Attendees:\n- Decisions:\n- To do:\n',
    },
  },
]

/** 새 프로젝트 마법사에서 처음 골라 둘 템플릿: 역할이 디자이너면 디자인 일정, 기획자면 기획 정식, 그 밖에는 첫 번째(일반). 고를 수 있는 것만 */
export function defaultTemplateId(persona: string | null | undefined, ids: string[]): string {
  const want = persona === 'designer' ? 'design' : persona === 'planner' ? 'planning' : null
  return want && ids.includes(want) ? want : ids[0]
}

export const builtinTemplates = (): ProjectTemplate[] => (getLang() === 'ko' ? KO : EN)

export interface Fill { name: string; owner: string; due: string; today: string }

/** 자리표시자를 채운다. 마감일·담당자가 없으면 그 꼬리표(와 빈 머리글 줄)를 지운다 */
export function fillTemplate(text: string, f: Fill): string {
  let s = text
  if (!f.due) s = s.replace(/ ?(?:due|start):\{\{due[+-]\d+\}\}/g, '').replace(/ ?due:\{\{due\}\}/g, '').replace(/^due: *\{\{due\}\}\n/m, '')
  if (!f.owner) s = s.replace(/ ?owner:\{\{owner\}\}/g, '').replace(/^owner: *\{\{owner\}\}\n/m, '')
  s = s.replace(/\{\{due([+-])(\d+)\}\}/g, (_, sign: string, n: string) => addDaysYmd(f.due, (sign === '-' ? -1 : 1) * Number(n)))
  return s.replace(/\{\{name\}\}/g, f.name).replace(/\{\{owner\}\}/g, f.owner).replace(/\{\{due\}\}/g, f.due).replace(/\{\{today\}\}/g, f.today)
}

/** 머리말(--- … ---) 안의 한 줄 값. 템플릿의 `owner: {{owner}}` 는 YAML 문법이 아니라서 머리말 해석기를 쓰지 않고 줄 단위로 읽는다 */
function fmValue(content: string, key: string): string | undefined {
  const m = /^---\n([\s\S]*?)\n---/.exec(content)
  if (!m) return undefined
  const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(m[1])
  return line ? line[1].trim().replace(/^["']|["']$/g, '') : undefined
}
const isProjectNote = (content: string) => fmValue(content, 'type')?.toLowerCase() === 'project'

/** 템플릿 설명용 머리말 키(`template: 한 줄 설명`)는 새 프로젝트에 복사하지 않는다 */
const stripTemplateKey = (content: string) => (content.startsWith('---') ? content.replace(/^(---\n[\s\S]*?)^template:[^\n]*\n/m, '$1') : content)

/** vault 의 `Templates/<이름>/…` 폴더들을 사용자 템플릿으로 읽는다(삭제된 노트·`.md` 가 아닌 것 제외, 이름순) */
export function vaultTemplates(files: Record<string, NoteFile>): ProjectTemplate[] {
  const byName = new Map<string, Record<string, string>>()
  for (const f of Object.values(files)) {
    if (f.deleted || !/\.md$/i.test(f.path)) continue
    const p = templateParts(f.path)
    if (!p) continue
    const g = byName.get(p.name) ?? byName.set(p.name, {}).get(p.name)!
    g[p.rel] = f.content
  }
  return [...byName.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
    .map(([name, tfiles]) => {
      const overview = Object.values(tfiles).find(isProjectNote)
      const d = overview ? fmValue(overview, 'template') : undefined
      return {
        id: `vault:${name}`,
        name,
        desc: d ? d : t('내 템플릿 · 문서 {n}개', { n: Object.keys(tfiles).length }),
        files: tfiles,
        mine: true,
      }
    })
}

/** 새 프로젝트로 만들 파일 목록 (폴더 경로 포함). 같은 이름의 폴더가 있으면 ` (2)` 를 붙인다. 프로젝트 노트가 없는 템플릿에는 개요 노트를 하나 만들어 넣는다 */
export function planProject(tpl: ProjectTemplate, f: Fill, root: string, existing: string[]): { folder: string; files: Record<string, string>; overview: string } {
  const base = `${root}/${f.name.replace(/[\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()}`
  let folder = base
  for (let n = 2; existing.some((p) => p.startsWith(folder + '/')); n++) folder = `${base} (${n})`
  const files: Record<string, string> = {}
  let overview = ''
  for (const [rel, raw] of Object.entries(tpl.files)) {
    const content = tpl.mine ? stripTemplateKey(raw) : raw
    const path = `${folder}/${fillTemplate(rel, f)}`
    files[path] = fillTemplate(content, f)
    if (!overview && isProjectNote(content)) overview = path
  }
  if (!overview) {
    overview = `${folder}/${getLang() === 'ko' ? '프로젝트 개요.md' : 'Project Overview.md'}`
    while (overview in files) overview = overview.replace(/\.md$/, ' (2).md')
    files[overview] = fillTemplate(OVERVIEW(getLang() === 'ko'), f)
  }
  return { folder, files, overview }
}

// ── 프로젝트를 템플릿으로 저장 ──
const FM_LINE = (key: string) => new RegExp(`^(${key}:)[^\n]*$`, 'm')

/** 프로젝트 한 줄 업무를 틀로 바꾼다: 완료 해제·결론/상태 제거, 마감일은 프로젝트 마감 기준 `{{due±N}}`(프로젝트 마감이 없으면 뺌), 프로젝트 담당자는 `{{owner}}` */
function taskLineToTemplate(line: string, project: Pick<Project, 'due' | 'owner'>): string {
  const m = /^(\s*[-*+]\s+)\[[ xX]\](\s+.*)$/.exec(line)
  if (!m) return line
  let rest = m[2]
  rest = rest.replace(/\s+=>\s.*$/, '') // 결론
  rest = rest.replace(/(?:^|\s)(?:status|side):\S+/g, '')
  // 날짜 꼬리표(마감일·시작일)는 프로젝트 마감일 기준 {{due±N}} 로(프로젝트 마감이 없으면 뺀다)
  for (const key of ['due', 'start']) {
    rest = rest.replace(new RegExp(String.raw`(?:^|\s)${key}:(\d{4}-\d{2}-\d{2})(?=\s|$)`, 'g'), (_all, d: string) => {
      if (!project.due) return ''
      const n = diffDays(project.due, d)
      return ` ${key}:${n === 0 ? '{{due}}' : n > 0 ? `{{due-${n}}}` : `{{due+${-n}}}`}`
    })
  }
  rest = rest.replace(/(?:^|\s)owner:(?:"([^"]+)"|(\S+))(?=\s|$)/g, (all, q: string | undefined, w: string | undefined) => {
    const who = (q ?? w ?? '').trim()
    return project.owner.length && project.owner.some((o) => o.toLowerCase() === who.toLowerCase()) ? ' owner:{{owner}}' : all
  })
  return `${m[1]}[ ]${rest.replace(/[ \t]+/g, ' ').replace(/ +$/, '')}`
}

/** 노트 한 개를 틀로: 프로젝트 이름 → {{name}}, 프로젝트 노트의 머리말(owner·due·title) → 자리표시자 */
function noteToTemplate(content: string, project: Project, isProject: boolean): string {
  let s = content
  if (isProject && s.startsWith('---')) {
    s = s.replace(FM_LINE('owner'), '$1 {{owner}}').replace(FM_LINE('due'), '$1 {{due}}')
    if (/^title:/m.test(s)) s = s.replace(FM_LINE('title'), '$1 {{name}}')
    s = s.replace(/^health:[^\n]*\n/m, '')
  }
  s = s.split('\n').map((l) => taskLineToTemplate(l, project)).join('\n')
  return project.name ? s.split(project.name).join('{{name}}') : s
}

/** 프로젝트를 `Templates/<이름>/` 로 저장할 파일 목록. 같은 이름의 템플릿이 있으면 ` (2)`. 프로젝트 노트가 폴더 밖에 있으면 그 노트 하나만 담는다 */
export function templateFromProject(project: Project, files: Record<string, NoteFile>, name: string, existing: string[]): { name: string; files: Record<string, string> } {
  const clean = name.replace(/[\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || project.name
  const taken = new Set(existing.map((p) => templateParts(p)?.name).filter(Boolean) as string[])
  let unique = clean
  for (let n = 2; taken.has(unique); n++) unique = `${clean} (${n})`
  const out: Record<string, string> = {}
  for (const f of Object.values(files)) {
    if (f.deleted || !/\.md$/i.test(f.path) || templateParts(f.path)) continue
    const inFolder = project.folder !== '' && f.path.startsWith(project.folder + '/')
    if (!inFolder && f.path !== project.path) continue
    const rel = inFolder ? f.path.slice(project.folder.length + 1) : f.path.slice(f.path.lastIndexOf('/') + 1)
    out[`${TEMPLATES_DIR}/${unique}/${rel}`] = noteToTemplate(f.content, project, f.path === project.path)
  }
  return { name: unique, files: out }
}
