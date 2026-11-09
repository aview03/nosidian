"""앱 아이콘 변형 일괄 생성.  사용: python scripts/make_icons.py

원본(assets/icon/source.png) → 마스터 정리 → 플랫폼별:
  Windows   build/icon.png, build/icon.ico            (인스톨러·exe·창)
  Android   mipmap-*/ic_launcher{,_round,_foreground}.png, 적응형 배경색, splash.png
  Web/앱 내 public/favicon.png, public/icon-192.png, public/icon-512.png, public/logo.png
"""
from pathlib import Path

from PIL import Image, ImageDraw

import icon_base as b

APP = b.ROOT
RES = APP / "android" / "app" / "src" / "main" / "res"
RED = (190, 2, 16)  # 적응형 배경 기본색 (플레이트 중앙부 색으로 아래에서 덮어씀)

DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def save(im, path, **kw):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, **kw)


def rounded_mask(size, radius_ratio):
    ss = 4
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=int(size * ss * radius_ratio), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def circle_mask(size):
    ss = 4
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size * ss - 1, size * ss - 1], fill=255)
    return m.resize((size, size), Image.LANCZOS)


def fit_crystal(canvas, height_ratio, dy_ratio=0.0, plate=None):
    """canvas(px) 정사각 안에 크리스털을 세로 height_ratio 비율로 앉힌 RGBA."""
    big = 1024
    cry = b.crystal(big)
    x0, y0, x1, y1 = b.crystal_bbox(big)
    cry = cry.crop((int(x0) - 2, int(y0) - 2, int(x1) + 3, int(y1) + 3))
    h = int(canvas * height_ratio)
    w = int(cry.width * h / cry.height)
    cry = cry.resize((w, h), Image.LANCZOS)
    out = plate.convert("RGBA") if plate is not None else Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(cry, ((canvas - w) // 2, int((canvas - h) / 2 + canvas * dy_ratio)))
    return out


def icon_squircle(size):
    """마스터(원본 모양 그대로)를 정사각 size 로."""
    return b.master(1024).resize((size, size), Image.LANCZOS)


def main():
    master = b.master(1024)
    plate = b.plate(1024)

    # ── Windows ──
    win = APP / "build"
    save(master, win / "icon.png")
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]  # 참고용(NSIS 3.0.4 는 PNG 압축 ico 를 못 읽어 빌드에는 icon.png 를 쓴다)
    master.save(APP / "assets" / "icon" / "icon-pillow.ico", sizes=[(s, s) for s in ico_sizes])

    # ── Web / 앱 내부 ──
    pub = APP / "public"
    save(master.resize((64, 64), Image.LANCZOS), pub / "favicon.png")
    save(master.resize((192, 192), Image.LANCZOS), pub / "icon-192.png")
    save(master.resize((512, 512), Image.LANCZOS), pub / "icon-512.png")
    save(master.resize((256, 256), Image.LANCZOS), pub / "logo.png")

    # ── Android ──
    # 적응형: 108dp 캔버스, 가운데 66dp 안전영역 → 크리스털 높이 ≈ 55%
    for d, k in DENSITY.items():
        px = int(108 * k)
        bg = plate.resize((px, px), Image.LANCZOS)
        # 플레이트는 둥근 사각형 본체만 담고 있으므로 가장자리 투명 영역을 안쪽 색으로 확장해 꽉 채운다
        bg = plate_full(px)
        fg = fit_crystal(px, 0.50)
        save(fg, RES / f"mipmap-{d}" / "ic_launcher_foreground.png")
        save(bg.convert("RGB"), RES / f"mipmap-{d}" / "ic_launcher_background.png")

        # 레거시(48dp): 마스터 그대로 / 원형: 플레이트 + 크리스털을 원으로 자름
        s = int(48 * k)
        save(icon_squircle(s), RES / f"mipmap-{d}" / "ic_launcher.png")
        circ = fit_crystal(s, 0.56, plate=plate_full(s))
        circ.putalpha(circle_mask(s))
        save(circ, RES / f"mipmap-{d}" / "ic_launcher_round.png")

    # 적응형 정의: 배경을 이미지로
    (RES / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(ADAPTIVE, encoding="utf-8")
    (RES / "mipmap-anydpi-v26" / "ic_launcher_round.xml").write_text(ADAPTIVE, encoding="utf-8")

    # 스플래시: 검정 바탕에 아이콘 (기존 각 파일의 크기를 그대로 유지)
    for p in RES.rglob("splash.png"):
        w, h = Image.open(p).size
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 255))
        s = int(min(w, h) * 0.30)
        ic = icon_squircle(s)
        canvas.alpha_composite(ic, ((w - s) // 2, (h - s) // 2))
        save(canvas.convert("RGB"), p)

    print("done")


def plate_full(px):
    """플레이트 중앙 영역(크리스털과 둥근 모서리를 피한 안쪽)을 잘라 px 로 늘린 꽉 찬 붉은 면."""
    big = b.plate(1024)
    inset = int(1024 * 0.06)
    return big.crop((inset, inset, 1024 - inset, 1024 - inset)).resize((px, px), Image.LANCZOS)


ADAPTIVE = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""

if __name__ == "__main__":
    main()
