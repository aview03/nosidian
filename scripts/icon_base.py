"""아이콘 원본(붉은 크리스털) 정리 + 크리스털 분리.

assets/icon/source.png  (원본, 모서리 바깥에 노이즈 있음)
 → master()  : 노이즈를 걷어낸 둥근 사각형 마스터 (RGBA)
 → crystal() : 크리스털만 잘라낸 레이어 (투명 배경)  — Android 적응형 아이콘 전경용
 → plate()   : 크리스털을 지운 붉은 바탕 (그라데이션)  — 적응형 배경 / 둥근 아이콘용
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "icon" / "source.png"

# 원본(1254px) 기준 크리스털 외곽 꼭짓점 (위 → 오른쪽 → 아래 → 왼쪽 아래 → 왼쪽 → 왼쪽 위)
CRYSTAL_POLY = [(700, 208), (874, 487), (792, 811), (648, 970), (472, 890), (360, 698), (438, 478)]


def _load():
    return Image.open(SOURCE).convert("RGBA")


def body_box(im):
    """아이콘 본체(가장 큰 불투명 덩어리)의 외곽 상자와 마스크."""
    a = np.array(im)
    solid = a[..., 3] > 200
    lab, n = ndi.label(solid)
    sizes = ndi.sum(solid, lab, range(1, n + 1))
    body = lab == (1 + int(np.argmax(sizes)))
    body = ndi.binary_fill_holes(body)
    ys, xs = np.where(body)
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), body


def master(size=1024):
    """노이즈 제거 + 본체만 정사각으로 잘라 size 로 맞춘 RGBA."""
    im = _load()
    box, body = body_box(im)
    # 가장자리를 살짝 부드럽게: 본체 마스크를 1px 침식 후 블러 → 안티앨리어싱된 알파
    m = Image.fromarray((ndi.binary_erosion(body, iterations=2) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.6))
    im.putalpha(m)
    im = im.crop(box)
    w, h = im.size
    s = max(w, h)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - w) // 2, (s - h) // 2))
    return sq.resize((size, size), Image.LANCZOS)


def _poly_in_master(size):
    """원본 좌표의 크리스털 꼭짓점을 master(size) 좌표로 변환."""
    box, _ = body_box(_load())
    x0, y0, x1, y1 = box
    s = max(x1 - x0, y1 - y0)
    ox = x0 - (s - (x1 - x0)) / 2
    oy = y0 - (s - (y1 - y0)) / 2
    k = size / s
    return [((x - ox) * k, (y - oy) * k) for x, y in CRYSTAL_POLY]


def crystal_mask(size=1024, grow=False):
    ss = 4
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).polygon([(x * ss, y * ss) for x, y in _poly_in_master(size)], fill=255)
    m = m.resize((size, size), Image.LANCZOS)
    if grow:
        m = m.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    return m


def crystal(size=1024):
    """크리스털만 (투명 배경)."""
    im = master(size)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), crystal_mask(size))
    return out


def crystal_bbox(size=1024):
    pts = _poly_in_master(size)
    xs, ys = zip(*pts)
    return min(xs), min(ys), max(xs), max(ys)


def plate(size=1024):
    """붉은 바탕만: 크리스털(과 그 그림자) 바깥 픽셀로 2차 곡면을 맞춰 만든 매끈한 그라데이션.
    원본을 메워 쓰면 크리스털 모양의 잔상이 남아서, 곡면 근사로 새로 그린다."""
    im = master(size)
    a = np.array(im).astype(float)
    body = a[..., 3] > 250
    body = ndi.binary_erosion(body, iterations=max(2, size // 40))
    cm = np.array(crystal_mask(size)) > 10
    cm = ndi.binary_dilation(cm, iterations=max(4, size // 9))  # 그림자까지 넉넉히 제외
    use = body & ~cm
    ys, xs = np.nonzero(use)
    step = max(1, len(xs) // 40000)
    xs, ys = xs[::step], ys[::step]
    u, v = xs / size, ys / size
    A = np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1)
    gx, gy = np.meshgrid(np.arange(size) / size, np.arange(size) / size)
    G = np.stack([np.ones_like(gx), gx, gy, gx * gx, gx * gy, gy * gy], -1).reshape(-1, 6)
    out = np.empty((size * size, 3))
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, a[ys, xs, c], rcond=None)
        out[:, c] = G @ coef
    return Image.fromarray(out.reshape(size, size, 3).clip(0, 255).astype('uint8'))
