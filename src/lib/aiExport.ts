// AI 답변 내보내기: 답변을 vault 의 노트로 저장하거나 Markdown 파일로 받는다. 순수 함수(경로·내용 계산).
import type { Lang } from './i18n'

/** 답변 노트를 모아 두는 폴더(언어별 기본 이름) */
export const answersFolder = (lang: Lang) => (lang === 'ko' ? 'AI 답변' : 'AI Answers')

const clean = (s: string) => s.replace(/[\\/:*?"<>|#`*_>\[\]]/g, ' ').replace(/\s+/g, ' ').trim()

/** 답변의 첫 의미 있는 줄(제목으로 쓴다) */
export function titleOfAnswer(answer: string, question: string): string {
  const line = answer.split(/\r?\n/).map((l) => clean(l.replace(/^#{1,6}\s+/, ''))).find((l) => l && !l.startsWith('---'))
  return (line || clean(question) || 'AI').slice(0, 40).trim()
}

/** 답변을 노트로 저장할 때의 경로와 내용. 질문은 인용으로 남긴다 */
export function answerNote(answer: string, question: string, lang: Lang, existing: Set<string>, today: string): { path: string; content: string } {
  const title = titleOfAnswer(answer, question)
  const folder = answersFolder(lang)
  let path = `${folder}/${title}.md`
  for (let n = 2; existing.has(path); n++) path = `${folder}/${title} (${n}).md`
  const q = question.trim() ? question.trim().split(/\r?\n/).map((l) => `> ${l}`).join('\n') : ''
  return { path, content: `---\nsource: ai\ndate: ${today}\n---\n# ${title}\n\n${q ? q + '\n\n' : ''}${answer.trim()}\n` }
}
