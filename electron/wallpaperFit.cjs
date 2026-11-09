// 배경화면이 실제 화면에 어떤 위치·배율로 그려졌는지 "측정"한다.
// Windows 의 "채우기"는 이미지 비율에 따라 가운데가 아닌 위치에서 자르기도 해서(예: 16:10 이미지를 16:9 화면에 → 위에서 1/3 지점),
// 규칙을 추측하면 위젯 속 배경이 실제 바탕화면과 어긋난다. 그래서 화면을 한 번 캡처해 원본 이미지와 겹쳐 보며 가장 잘 맞는 위치를 찾는다.
// 다른 창이 일부 가리고 있어도 되도록 "차이가 작은 픽셀의 비율"이 가장 큰 위치를 고른다.
const { desktopCapturer, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const wallpaperPath = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
exports.wallpaperPath = wallpaperPath
exports.wallpaperMtime = () => {
  try {
    return fs.statSync(wallpaperPath()).mtimeMs
  } catch {
    return 0
  }
}

const lum = (b, i) => 0.114 * b[i] + 0.587 * b[i + 1] + 0.299 * b[i + 2] // BGRA

/** 후보 위치마다 일치하는 픽셀 비율을 구해 가장 잘 맞는 (ox, oy) 를 고른다 */
function search(tgt, tw, th, wp, ww, wh, ox0, ox1, oy0, oy1, step) {
  let best = { score: -1, ox: 0, oy: 0 }
  for (let oy = oy0; oy <= oy1; oy++) {
    for (let ox = ox0; ox <= ox1; ox++) {
      let ok = 0
      let n = 0
      for (let y = 0; y < th; y += step) {
        const wy = y + oy
        if (wy < 0 || wy >= wh) continue
        for (let x = 0; x < tw; x += step) {
          const wx = x + ox
          if (wx < 0 || wx >= ww) continue
          n++
          if (Math.abs(lum(tgt, (y * tw + x) * 4) - lum(wp, (wy * ww + wx) * 4)) < 10) ok++
        }
      }
      const score = n ? ok / n : 0
      if (score > best.score) best = { score, ox, oy }
    }
  }
  return best
}

/**
 * display: Electron Display. 반환: { x, y, w, h } (DIP, 디스플레이 좌상단 기준 — 배경 이미지의 그려진 위치와 크기) 또는 null
 * hideWidget/showWidget: 위젯이 화면을 가리지 않도록 캡처 동안만 숨긴다
 */
exports.measure = async (display, hideWidget, showWidget) => {
  let wpImg
  try {
    wpImg = nativeImage.createFromBuffer(fs.readFileSync(wallpaperPath()))
  } catch {
    return null
  }
  if (wpImg.isEmpty()) return null
  const sf = display.scaleFactor || 1
  const pw = Math.round(display.size.width * sf)
  const ph = Math.round(display.size.height * sf)
  const { width: iw, height: ih } = wpImg.getSize()
  const sc = Math.max(pw / iw, ph / ih) // "채우기"의 배율
  const sw = Math.round(iw * sc)
  const sh = Math.round(ih * sc)
  if (sw < pw || sh < ph) return null

  let cap
  try {
    await hideWidget()
    await new Promise((r) => setTimeout(r, 300))
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: pw, height: ph } })
    const s = srcs.find((x) => x.display_id === String(display.id)) || srcs[0]
    cap = s?.thumbnail
  } finally {
    await showWidget()
  }
  if (!cap || cap.isEmpty()) return null

  // 1단계: 작게 줄여서 대략적인 위치 → 2단계: 원본 크기에서 ±5px 정밀 보정
  const f = 480 / pw
  const tgtS = cap.resize({ width: 480, height: Math.round(ph * f), quality: 'good' })
  const wpS = wpImg.resize({ width: Math.round(sw * f), height: Math.round(sh * f), quality: 'good' })
  const ts = tgtS.getSize()
  const ws = wpS.getSize()
  const coarse = search(tgtS.toBitmap(), ts.width, ts.height, wpS.toBitmap(), ws.width, ws.height, 0, Math.max(0, ws.width - ts.width), 0, Math.max(0, ws.height - ts.height), 3)
  if (coarse.score < 0.35) return null // 맞는 곳을 못 찾음 → 호출 쪽이 가운데 정렬로 대체

  const wpFull = wpImg.resize({ width: sw, height: sh, quality: 'good' })
  const cx = Math.round(coarse.ox / f)
  const cy = Math.round(coarse.oy / f)
  const fine = search(cap.toBitmap(), pw, ph, wpFull.toBitmap(), sw, sh, Math.max(0, cx - 6), Math.min(sw - pw, cx + 6), Math.max(0, cy - 6), Math.min(sh - ph, cy + 6), 7)
  if (fine.score < 0.35) return null
  return { x: fine.ox / sf, y: fine.oy / sf, w: sw / sf, h: sh / sf, score: Math.round(fine.score * 100) / 100 }
}
