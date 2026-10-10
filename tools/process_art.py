"""Turns raw Codex-generated art (.art/*.png, black backgrounds) into game-ready
sprites with alpha in public/assets/.

Run:  python tools/process_art.py
"""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".art"
OUT = ROOT / "public" / "assets"


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def bbox_of(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def save_webp(img: Image.Image, name: str, quality: int = 88) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.webp"
    img.save(path, "WEBP", quality=quality, method=6)
    print(f"  {path.relative_to(ROOT)}  {img.size}  {path.stat().st_size // 1024} KB")


def sphere(raw: str, name: str, size: int = 512) -> None:
    """Crop the planet disc tightly and cut it out with a soft circular mask."""
    rgb = np.asarray(Image.open(RAW / f"{raw}.png").convert("RGB")).astype(np.float32)
    mask = luminance(rgb) > 28
    x0, y0, x1, y1 = bbox_of(mask)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = max(x1 - x0, y1 - y0) / 2
    box = (int(cx - r), int(cy - r), int(cx + r), int(cy + r))
    img = Image.open(RAW / f"{raw}.png").convert("RGB").crop(box).resize((size, size), Image.LANCZOS)

    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    c = (size - 1) / 2
    d = np.sqrt((xx - c) ** 2 + (yy - c) ** 2) / (size / 2)
    # 1.5px feather on the limb
    feather = 1.5 / (size / 2)
    alpha = np.clip((1.0 - d) / feather, 0, 1)
    rgba = np.dstack([np.asarray(img).astype(np.float32), alpha * 255]).astype(np.uint8)
    save_webp(Image.fromarray(rgba, "RGBA"), name)


def glow(raw: str, name: str, size: int) -> None:
    """Light-emitting art on black: derive alpha from brightness and un-premultiply."""
    img = Image.open(RAW / f"{raw}.png").convert("RGB").resize((size, size), Image.LANCZOS)
    rgb = np.asarray(img).astype(np.float32) / 255
    a = rgb.max(axis=2)
    a = np.clip((a - 0.02) / 0.98, 0, 1)
    safe = np.maximum(a, 1e-4)[..., None]
    color = np.clip(rgb / safe, 0, 1)
    rgba = np.dstack([color * 255, a * 255]).astype(np.uint8)
    save_webp(Image.fromarray(rgba, "RGBA"), name, quality=90)


def flood_background(rgb: np.ndarray, threshold: float) -> np.ndarray:
    """Background = near-black pixels connected to the image border."""
    dark = luminance(rgb) < threshold
    h, w = dark.shape
    bg = np.zeros_like(dark)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if dark[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if dark[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and dark[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))
    return bg


def cutout(rgb_img: Image.Image, threshold: float = 14, erode: int = 3) -> Image.Image:
    rgb = np.asarray(rgb_img.convert("RGB")).astype(np.float32)
    bg = flood_background(rgb, threshold)
    alpha = Image.fromarray(((~bg) * 255).astype(np.uint8), "L")
    alpha = alpha.filter(ImageFilter.MinFilter(erode)).filter(ImageFilter.GaussianBlur(0.8))
    out = rgb_img.convert("RGBA")
    out.putalpha(alpha)
    bb = alpha.getbbox()
    return out.crop(bb) if bb else out


def ship() -> None:
    img = cutout(Image.open(RAW / "ship.png"))
    w, h = img.size
    target_w = 320
    save_webp(img.resize((target_w, round(h * target_w / w)), Image.LANCZOS), "ship", quality=92)


def asteroids() -> None:
    src = Image.open(RAW / "asteroids.png").convert("RGB")
    w, h = src.size
    cols, rows = 4, 2
    # rocks sit in the central band of the sheet; split by columns/rows of the content bbox
    rgb = np.asarray(src).astype(np.float32)
    content = luminance(rgb) > 30
    x0, y0, x1, y1 = bbox_of(content)
    cw, ch = (x1 - x0) / cols, (y1 - y0) / rows
    i = 0
    for r in range(rows):
        for c in range(cols):
            box = (
                int(x0 + c * cw - 6), int(y0 + r * ch - 6),
                int(x0 + (c + 1) * cw + 6), int(y0 + (r + 1) * ch + 6),
            )
            rock = cutout(src.crop(box), threshold=22, erode=11)
            rock.thumbnail((128, 128), Image.LANCZOS)
            save_webp(rock, f"asteroid-{i}")
            i += 1


def background() -> None:
    img = Image.open(RAW / "bg-nebula.png").convert("RGB")
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "bg-nebula.jpg"
    img.save(path, "JPEG", quality=86, optimize=True, progressive=True)
    print(f"  {path.relative_to(ROOT)}  {img.size}  {path.stat().st_size // 1024} KB")


def main() -> int:
    if not RAW.exists():
        print("No .art directory with raw images", file=sys.stderr)
        return 1
    for raw, name in [
        ("planet-aqua", "planet-aqua"),
        ("planet-rubra", "planet-rubra"),
        ("planet-colossus-flat", "planet-colossus"),
        ("planet-aurum", "planet-aurum"),
        ("planet-borey", "planet-borey"),
        ("planet-viola", "planet-viola"),
        ("planet-moon", "planet-moon"),
        ("star-lyra", "star-surface"),
    ]:
        sphere(raw, name)
    glow("star-lyra", "star-glow", 512)
    glow("rings", "rings", 768)
    ship()
    asteroids()
    background()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
