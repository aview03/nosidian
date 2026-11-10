import { describe, expect, it } from 'vitest'
import { fixPrompt, fixTitle, PLAN_LIMIT, planApplyPrompt } from './aiFix'
import type { LintItem, LintKind } from './doclint'

const ctx = { projectName: '인증 시스템', folder: '프로젝트/인증' }
const rel = (p: string) => p.replace(/^프로젝트\/인증\//, '')
const ALL: LintKind[] = ['unknownRole', 'roleConflict', 'roleMisplaced', 'singletonDup', 'missingDoc', 'missingSection', 'emptySection', 'badStatus', 'noStatus', 'brokenLink', 'brokenAnchor', 'orphan', 'unreachable', 'duplicate']
const dup: LintItem = { kind: 'duplicate', severity: 'info', path: '프로젝트/인증/auth-final.md', others: ['프로젝트/인증/auth-final-v2.md'], reasons: ['stem', 'body'] }

describe('분석(정리 계획) 프롬프트', () => {
  it('중복 후보: 관련 노트 경로·판정 근거·프로젝트를 주고, 이번 답변에서는 변경을 제출하지 말라고 한다', () => {
    const p = fixPrompt(dup, ctx, rel)
    expect(p).toContain('`프로젝트/인증/auth-final.md`')
    expect(p).toContain('`프로젝트/인증/auth-final-v2.md`')
    expect(p).toContain('인증 시스템')
    expect(p).toContain('프로젝트/인증')
    expect(p).toContain('이름이 비슷함')
    expect(p).toContain('본문이 비슷함')
    expect(p).toMatch(/do NOT call propose_change/)
    expect(p).toContain('이 계획대로 변경 제안을 만들까요?')
    expect(p).toMatch(/heuristic/) // 근거는 휴리스틱일 뿐 다른 문서일 수 있다
  })
  it('중복 문서를 무조건 삭제하지 않는다: 삭제 금지·보관만·상충하면 승자를 정하지 않고 묻는다', () => {
    const p = fixPrompt(dup, ctx, rel)
    expect(p).toMatch(/Never plan to delete a note outright/)
    expect(p).toMatch(/ARCHIVE/)
    expect(p).toMatch(/CONFLICT/)
    expect(p).toMatch(/do NOT pick a winner/)
    expect(p).toContain('결정 필요')
    expect(p).toMatch(/Do not invent facts/)
  })
  it('규칙 노트(_workspace/)는 건드리지 않고, 잘린 노트는 묻기만 하라고 한다', () => {
    const p = fixPrompt(dup, ctx, rel)
    expect(p).toMatch(/_workspace\//)
    expect(p).toMatch(/truncated/)
  })
  it('관련 노트를 전부 읽고 규칙을 확인하라고 시킨다', () => {
    const p = fixPrompt(dup, ctx, rel)
    expect(p).toMatch(/get_document_rules/)
    expect(p).toMatch(/read EVERY note involved in full/)
  })
  it('모든 점검 종류에 구체적인 지침이 있다(빈 안내가 없다)', () => {
    for (const kind of ALL) {
      const item: LintItem = { kind, severity: 'warn', path: '프로젝트/인증/a.md', text: '값', text2: '값2' }
      const p = fixPrompt(item, ctx, rel)
      expect(p, kind).toContain(`(${kind})`)
      expect(p, kind).toMatch(/3\. [A-Z]/) // 종류별 지침이 3번 항목에 실린다
      expect(p, kind).toMatch(/do NOT call propose_change/)
      expect(fixTitle(item, rel), kind).toMatch(/^점검 · /)
    }
  })
  it('종류별 핵심 지침: 필수 제목은 있는 사실만, 상태값은 허용 목록에서, 규칙 노트 변경은 사용자에게', () => {
    const at = (kind: LintKind) => fixPrompt({ kind, severity: 'warn', path: '프로젝트/인증/a.md', text: 'X', text2: 'Y' }, ctx, rel)
    expect(at('missingSection')).toMatch(/only facts that are already/)
    expect(at('badStatus')).toMatch(/allowed statuses/)
    expect(at('roleConflict')).toMatch(/not allowed for you/)
    expect(at('brokenLink')).toMatch(/search_notes/)
    expect(at('orphan')).toMatch(/ask/)
    expect(at('singletonDup')).toMatch(/official/)
  })
  it('없는 문서(missingDoc)는 역할과 기대 파일 이름을 알려 준다', () => {
    const p = fixPrompt({ kind: 'missingDoc', severity: 'info', path: '프로젝트/인증/개요.md', text: '정책', text2: 'SPEC.md' }, ctx, rel)
    expect(p).toContain('role "정책"')
    expect(p).toContain('`SPEC.md`')
  })
  it('화면에 보일 제목', () => {
    expect(fixTitle(dup, rel)).toBe('점검 · 중복 문서 후보: auth-final.md ↔ auth-final-v2.md')
    expect(fixTitle({ kind: 'missingSection', severity: 'warn', path: '프로젝트/인증/SPEC.md', text: '규칙' }, rel)).toBe('점검 · 필수 제목 누락: SPEC.md')
    expect(fixTitle({ kind: 'missingDoc', severity: 'info', path: '프로젝트/인증/개요.md', text: '정책', text2: 'SPEC.md' }, rel)).toBe('점검 · 꼭 있어야 하는 문서가 없음: 정책 (SPEC.md)')
  })
})

describe('계획 실행 프롬프트', () => {
  const plan = '1. B 에 A 의 3절을 합친다\n2. A 를 보관한다\n3. 결정 필요: 일정이 서로 다름'
  it('승인된 계획 전체와, 모든 단계를 한 번에 내고 읽은 해시를 쓰라는 지시를 담는다', () => {
    const p = planApplyPrompt(plan)
    expect(p).toContain(plan)
    expect(p).toMatch(/Submit ALL steps/)
    expect(p).toMatch(/content_hash as base_hash/)
    expect(p).toMatch(/COMPLETE new text/)
    expect(p).toMatch(/approved together/)
  })
  it('삭제는 계획이 보관이라고 한 경우만, 결정 필요 단계는 건너뛰고 알린다, 규칙 노트 금지', () => {
    const p = planApplyPrompt(plan)
    expect(p).toMatch(/Use delete only to archive/)
    expect(p).toMatch(/Skip any step marked/)
    expect(p).toMatch(/_workspace\//)
  })
  it('너무 긴 계획은 잘라서 보내고 그 사실을 알린다', () => {
    const p = planApplyPrompt('가'.repeat(PLAN_LIMIT + 500))
    expect(p).toContain('계획이 길어 여기까지만 전달됨')
    expect(p).not.toContain('가'.repeat(PLAN_LIMIT + 1))
  })
})
