import { describe, expect, it } from 'vitest'
import { ASSETS_DIR, IMAGE_MAX_BYTES, SHRINK_BYTES, SHRINK_EDGE, assetsDirOf, fitSize, imageExt, imageFileName, imageMarkdown, imageProblem, isGenericName, isImageFile, pastedName, relativeTo, shouldShrink, shrunkExt } from './images'
import { t } from './i18n'

describe('이미지로 받을 수 있는 파일', () => {
  it('확장자(대소문자 무시)로 판단하고 jpeg 는 jpg 로 통일한다', () => {
    expect(imageExt('a.PNG')).toBe('png')
    expect(imageExt('a.jpeg')).toBe('jpg')
    expect(imageExt('a.webp')).toBe('webp')
  })
  it('확장자가 없는 클립보드 이미지는 형식(mime)으로 판단한다', () => {
    expect(imageExt('', 'image/png')).toBe('png')
    expect(imageExt('blob', 'image/jpeg')).toBe('jpg')
    expect(imageExt('', 'text/plain')).toBeNull()
  })
  it('이미지가 아니거나 svg·heic 처럼 받지 않는 형식은 null', () => {
    for (const n of ['a.pdf', 'a.svg', 'a.heic', 'a.exe', 'noext.txt']) expect(imageExt(n, 'image/png'), n).toBeNull()
  })
  it('isImageFile', () => {
    expect(isImageFile({ name: 'x.png' })).toBe(true)
    expect(isImageFile({ name: 'x.svg', type: 'image/svg+xml' })).toBe(false)
  })
})

describe('넣을 수 있나', () => {
  it('정상', () => expect(imageProblem('a.png', 1000)).toBeNull())
  it('형식·빈 파일·너무 큰 파일은 이유를 돌려준다', () => {
    expect(imageProblem('a.svg', 10)).toContain('a.svg')
    expect(imageProblem('a.png', 0)).toContain('a.png')
    expect(imageProblem('a.png', IMAGE_MAX_BYTES + 1)).toContain('a.png')
    expect(imageProblem('a.png', IMAGE_MAX_BYTES)).toBeNull()
  })
})

describe('이름·경로·마크다운', () => {
  it('붙여넣은 이미지는 날짜 이름', () => {
    expect(pastedName(new Date(2026, 10, 11, 9, 5, 3), 'png')).toBe(`${t('이미지')}-20261111-090503.png`)
  })
  it('흔한 가짜 이름(image.png 등)은 날짜 이름으로 바꿀 대상', () => {
    for (const n of ['image.png', 'Image.PNG', 'blob', 'photo.jpg', 'clipboard.png', 'pasted-image.png', '']) expect(isGenericName(n), n).toBe(true)
    for (const n of ['시안 v2.png', 'logo.png', 'IMG_2043.jpg', 'imagery.png']) expect(isGenericName(n), n).toBe(false)
  })
  it('링크를 깨는 문자·공백을 다듬는다(한글은 그대로)', () => {
    expect(imageFileName('시안 v2 (최종).PNG', 'png')).toBe('시안-v2-_최종.png')
    expect(imageFileName('a[1]#2%.jpg', 'jpg')).toBe('a_1__2.jpg')
    expect(imageFileName('...', 'png')).toBe(`${t('이미지')}.png`)
  })
  it('노트 옆 _assets 폴더', () => {
    expect(assetsDirOf('프로젝트/시험/회의.md')).toBe(`프로젝트/시험/${ASSETS_DIR}`)
    expect(assetsDirOf('루트.md')).toBe(ASSETS_DIR)
  })
  it('노트 기준 상대 경로와 마크다운 한 줄', () => {
    expect(relativeTo('프로젝트/시험/_assets/a.png', '프로젝트/시험/회의.md')).toBe('_assets/a.png')
    expect(relativeTo('_assets/a.png', '루트.md')).toBe('_assets/a.png')
    expect(relativeTo('다른/_assets/a.png', '프로젝트/시험/회의.md')).toBe('다른/_assets/a.png')
    expect(imageMarkdown('프로젝트/시험/_assets/시안-v2.png', '프로젝트/시험/회의.md')).toBe('![시안-v2](_assets/시안-v2.png)')
  })
})

describe('줄이기', () => {
  it('gif 는 줄이지 않는다(움직임)', () => expect(shouldShrink('gif', SHRINK_BYTES * 3, 5000, 5000)).toBe(false))
  it('작고 짧으면 그대로, 크기나 긴 변이 기준을 넘으면 줄인다', () => {
    expect(shouldShrink('jpg', 500_000, 1200, 800)).toBe(false)
    expect(shouldShrink('jpg', SHRINK_BYTES + 1, 1200, 800)).toBe(true)
    expect(shouldShrink('png', 500_000, SHRINK_EDGE + 1, 100)).toBe(true)
    expect(shouldShrink('png', 500_000, SHRINK_EDGE, SHRINK_EDGE)).toBe(false)
  })
  it('비율을 지켜 긴 변을 맞춘다', () => {
    expect(fitSize(4000, 3000)).toEqual({ w: 2048, h: 1536 })
    expect(fitSize(3000, 4000)).toEqual({ w: 1536, h: 2048 })
    expect(fitSize(1000, 800)).toEqual({ w: 1000, h: 800 })
    expect(fitSize(10000, 1)).toEqual({ w: 2048, h: 1 })
  })
  it('줄인 결과의 형식: png·webp 는 유지(투명), 그 밖은 jpg', () => {
    expect(shrunkExt('png')).toBe('png')
    expect(shrunkExt('webp')).toBe('webp')
    expect(shrunkExt('bmp')).toBe('jpg')
    expect(shrunkExt('jpg')).toBe('jpg')
  })
})
