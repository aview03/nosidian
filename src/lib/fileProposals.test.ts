import { describe, expect, it } from 'vitest'
import { AI_FILE_MAX_BYTES, checkAiFile } from './fileProposals'

const ok = (p: string, c = 'print(1)', taken: string[] = [], remote = true) => checkAiFile(p, c, new Set(taken), remote)

describe('AI 파일 제안 규칙', () => {
  it('허용 확장자의 텍스트 파일은 통과하고 경로를 정리한다', () => {
    expect(ok('tools/clean.py')).toEqual({ ok: true, path: 'tools/clean.py' })
    expect(ok('./data\\rows.CSV', 'a,b')).toEqual({ ok: true, path: 'data/rows.CSV' })
    expect(ok('/conf.yaml', 'a: 1')).toEqual({ ok: true, path: 'conf.yaml' })
  })
  it('실행 파일·스크립트·노트·이미지·확장자 없음은 거절', () => {
    for (const p of ['a.exe', 'run.bat', 'x.ps1', 'x.sh', 'x.cmd', 'n.md', 'i.png', 'noext', 'a.docx', 'a.js.exe']) expect(ok(p), p).toEqual({ ok: false, reason: 'badExt' })
  })
  it('상위 경로·숨김·금지 문자는 badPath, _workspace 는 protected', () => {
    for (const p of ['../a.py', 'a/../b.py', '.git/x.py', 'a/.hidden/x.py', 'a//b.py', '', 'a/b?.py', 'a/b:c.py', '.py']) expect(ok(p), p).toEqual({ ok: false, reason: 'badPath' })
    expect(ok('_workspace/x.py')).toEqual({ ok: false, reason: 'protected' })
    expect(ok('_Workspace/x.py')).toEqual({ ok: false, reason: 'protected' })
  })
  it('빈 내용·너무 큰 내용·저장소 없음·이미 있는 경로(대소문자 무시)', () => {
    expect(ok('a.py', '  \n')).toEqual({ ok: false, reason: 'empty' })
    expect(ok('a.py', 'x'.repeat(AI_FILE_MAX_BYTES + 1))).toEqual({ ok: false, reason: 'tooBig' })
    expect(ok('a.py', '한'.repeat(AI_FILE_MAX_BYTES / 3 + 10))).toEqual({ ok: false, reason: 'tooBig' }) // 글자 수가 아니라 바이트
    expect(ok('a.py', 'x', [], false)).toEqual({ ok: false, reason: 'noRemote' })
    expect(ok('Tools/A.py', 'x', ['tools/a.py'])).toEqual({ ok: false, reason: 'exists' })
  })
})
