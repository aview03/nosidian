// 문서 점검 → AI로 고치기: 점검에서 나온 문제(LintItem)를 AI 가 분석하고 "정리 계획"을 먼저 보여 주게 하는 프롬프트를 만든다.
//
// 흐름(2단계):
//  1) 분석(묻기·읽기 전용): 점검 문제 + 관련 노트 경로 + 판정 근거를 주고, AI 가 관련 노트를 전부 읽어 원인과 정리 계획을 낸다. 이 단계에서는 변경을 제출하지 않는다.
//  2) 계획 실행: 사용자가 "이 계획대로 변경 제안 만들기"를 누르면 계획 전체를 변경 제안(propose_change)으로 낸다 → 기존 정책 엔진·승인 화면.
//
// 원칙(프롬프트에 고정):
//  - 중복 문서를 발견했다고 하나를 삭제하지 않는다. 합친 뒤에도 삭제가 아니라 보관(archive)만 계획하고, 내용이 상충하거나 결정 이력이 서로 다르면 승자를 정하지 않고 사람에게 묻는다.
//  - 사실을 지어내지 않는다(모르면 "(확인 필요)").
//  - 규칙 노트(_workspace/)는 AI 가 고치지 않는다 — 규칙을 바꿔야 하면 사용자가 하도록 알린다.
// 순수 함수: 네트워크·저장소를 쓰지 않는다.
import type { LintItem, LintKind } from './doclint'

export interface FixContext {
  projectName: string
  /** 프로젝트 폴더(없으면 '') */
  folder: string
}

const KIND_LABEL: Record<LintKind, string> = {
  unknownRole: '모르는 역할(role:)',
  roleConflict: '역할 충돌',
  roleMisplaced: '역할 위치 불일치',
  singletonDup: '하나뿐이어야 하는 문서가 여러 개',
  missingDoc: '꼭 있어야 하는 문서가 없음',
  missingSection: '필수 제목 누락',
  emptySection: '필수 제목 아래가 비어 있음',
  badStatus: '허용되지 않은 status 값',
  noStatus: 'status 없음',
  brokenLink: '끊어진 링크',
  brokenAnchor: '없는 제목 링크',
  orphan: '고아 문서(들어오는 링크 없음)',
  unreachable: '개요에서 닿을 수 없는 문서',
  duplicate: '중복 문서 후보',
}

const REASON_LABEL: Record<string, string> = { stem: '이름이 비슷함', headings: '제목 구성이 비슷함', body: '본문이 비슷함' }

/** 문제 종류별로 AI 에게 시키는 일 */
const GUIDE: Record<LintKind, string> = {
  duplicate:
    'Compare the notes carefully: list what is the same, what only one of them says, and anything that CONFLICTS (different decisions, numbers, dates, owners). ' +
    'Recommend which note should be the main one and what text from the other should be merged into it. ' +
    'Only if the other note is fully covered after merging, plan to ARCHIVE it (never delete). Use search_notes to find notes that link to it and plan the link updates.',
  singletonDup:
    'Only one document with this role is allowed. Compare the notes, recommend which one should be the official document, what to merge from the others, and plan to archive the rest only if fully covered.',
  missingDoc: 'Plan the missing document: which headings it needs (see get_document_rules), draft each section from what already exists in the project, and mark unknowns "(확인 필요)".',
  missingSection: 'Read the note and draft the missing section using only facts that are already in the project notes; mark unknown parts "(확인 필요)".',
  emptySection: 'Read the note and draft content for the empty section using only facts that are already in the project notes; mark unknown parts "(확인 필요)".',
  badStatus: 'Check the allowed statuses (get_document_rules) and recommend the right one from the note\'s content. If it is unclear, ask instead of guessing.',
  noStatus: 'Check the allowed statuses (get_document_rules) and recommend the right one from the note\'s content. If it is unclear, ask instead of guessing.',
  brokenLink: 'Use search_notes to find the note the link most likely meant. Plan the exact text fix; if there is no likely target, say so and ask.',
  brokenAnchor: 'Read the target note, find its real headings, and plan the corrected link text.',
  orphan: 'Decide whether this note belongs in the project. If so, plan where to link it from (an overview or entry note) and the exact link line. If it looks obsolete, say so and ask — archiving needs a person\'s decision.',
  unreachable: 'Plan a link to this note from the project\'s overview/entry note (read it first) and the exact link line to add.',
  roleConflict: 'Explain the conflict between the file name and the `role:` property and recommend the correct role or the correct file name/location. Changing the rules note is not allowed for you — say what the user should change.',
  roleMisplaced: 'Explain why the note is not in the place its role requires and recommend moving/renaming it or fixing `role:`. Changing the rules note is not allowed for you — say what the user should change.',
  unknownRole: 'Explain that the role is not in the rules profile and recommend a role that exists (see get_document_rules) or a rules change the user should make. You cannot change the rules note.',
}

const code = (p: string) => '`' + p + '`'

/** 화면에 보일 한 줄(사용자 메시지로 표시) */
export function fixTitle(item: LintItem, rel: (p: string) => string): string {
  const notes = [item.path, ...(item.others ?? [])].map(rel)
  const what = item.kind === 'missingDoc' ? `${item.text ?? ''}${item.text2 ? ` (${item.text2})` : ''}` : item.kind === 'duplicate' || item.kind === 'singletonDup' ? notes.join(' ↔ ') : notes[0]
  return `점검 · ${KIND_LABEL[item.kind]}: ${what}`
}

/** 1단계(분석·계획) 프롬프트. 변경은 제출하지 말라고 못 박는다 */
export function fixPrompt(item: LintItem, ctx: FixContext, rel: (p: string) => string): string {
  const paths = [item.path, ...(item.others ?? [])]
  const facts: string[] = [`- Finding: ${KIND_LABEL[item.kind]} (${item.kind})`, `- Project: ${ctx.projectName}${ctx.folder ? ` (folder: ${ctx.folder})` : ''}`]
  if (item.kind === 'missingDoc') facts.push(`- Missing document: role "${item.text ?? ''}", expected file ${code(item.text2 ?? '')} inside the project folder`)
  else facts.push(`- Notes involved: ${paths.map((p) => `${code(p)}`).join(', ')}`)
  if (item.text && item.kind !== 'missingDoc') facts.push(`- Detail: ${item.text}${item.text2 ? ` / ${item.text2}` : ''}`)
  if (item.kind !== 'missingDoc' && item.text2 && !item.text) facts.push(`- Detail: ${item.text2}`)
  if (item.reasons?.length) facts.push(`- Why it was flagged: ${item.reasons.map((r) => REASON_LABEL[r] ?? r).join(', ')} (a heuristic — they may well be different documents)`)
  facts.push(`- Short names: ${paths.map(rel).join(', ')}`)
  return [
    '[Task] A document check in Nosidian found the problem below. Prepare a cleanup PLAN. In THIS answer, only analyse and plan — do NOT call propose_change.',
    '',
    '[Finding]',
    ...facts,
    '',
    '[What to do]',
    '1. Call get_document_rules, then read EVERY note involved in full with read_note (and any notes you need to compare).',
    '2. Say briefly what is wrong and why it matters.',
    `3. ${GUIDE[item.kind]}`,
    '4. Write the plan as a numbered list of concrete steps: which note changes, the exact text to add or change, which notes to archive, which links to update. Put anything that needs a person\'s decision as "결정 필요: …" and do not decide it yourself.',
    '5. End with the single line: "이 계획대로 변경 제안을 만들까요?"',
    '',
    '[Rules] Never plan to delete a note outright — archiving after a full merge is the most you may plan. If notes disagree or hold different decisions or history, do NOT pick a winner: list the differences and ask. Do not invent facts; write "(확인 필요)" instead. Never plan changes to files under _workspace/ (the rules note) — tell the user what to change instead. If read_note says a note is truncated, plan nothing for it except asking the user. Answer in Korean.',
  ].join('\n')
}

export const PLAN_LIMIT = 6000

/** 2단계(계획 실행) 프롬프트: 사용자가 승인한 계획 전체를 변경 제안으로 낸다 */
export function planApplyPrompt(plan: string): string {
  const p = plan.length > PLAN_LIMIT ? plan.slice(0, PLAN_LIMIT) + '\n…(계획이 길어 여기까지만 전달됨)' : plan
  return [
    '[Task] The user approved the cleanup plan below. Carry it out by submitting change proposals with propose_change.',
    '',
    '[How]',
    '- For every note you change: read it first with read_note, send its content_hash as base_hash, and send the COMPLETE new text as content.',
    '- Submit ALL steps of the plan in this turn (all notes belong to one logical change — do not stop after the first). Use delete only to archive a note when the plan says so.',
    '- Skip any step marked "결정 필요" or "(확인 필요)" that needs a person; do not guess. Say which steps you skipped and why.',
    '- Do not touch files under _workspace/.',
    '- Afterwards summarise in Korean: what you proposed per note, what you skipped, and remind the user that these proposals belong together and should be approved together.',
    '',
    '[Plan]',
    p,
  ].join('\n')
}
