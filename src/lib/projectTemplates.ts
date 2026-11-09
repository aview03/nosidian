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
]

export const builtinTemplates = (): ProjectTemplate[] => (getLang() === 'ko' ? KO : EN)

export interface Fill { name: string; owner: string; due: string; today: string }

/** 자리표시자를 채운다. 마감일·담당자가 없으면 그 꼬리표(와 빈 머리글 줄)를 지운다 */
export function fillTemplate(text: string, f: Fill): string {
  let s = text
  if (!f.due) s = s.replace(/ ?due:\{\{due[+-]\d+\}\}/g, '').replace(/ ?due:\{\{due\}\}/g, '').replace(/^due: *\{\{due\}\}\n/m, '')
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
  rest = rest.replace(/(?:^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/g, (_all, d: string) => {
    if (!project.due) return ''
    const n = diffDays(project.due, d)
    return ` due:${n === 0 ? '{{due}}' : n > 0 ? `{{due-${n}}}` : `{{due+${-n}}}`}`
  })
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
