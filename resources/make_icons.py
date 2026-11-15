"""Draws the launcher icon and splash screens into the Android project. Run: python3 resources/make_icons.py"""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def scene(size):
    S = 1024
    im = Image.new('RGB', (S, S))
    d = ImageDraw.Draw(im)
    horizon = int(S * 0.58)
    top, mid = (43, 63, 120), (255, 143, 82)
    for y in range(horizon):
        t = y / horizon
        d.line([(0, y), (S, y)], fill=lerp(top, mid, t ** 1.6))
    # Sun
    glow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(glow).ellipse([S * 0.3, horizon - S * 0.3, S * 0.7, horizon + S * 0.1], fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    im.paste((255, 214, 140), (0, 0), glow)
    d.ellipse([S * 0.37, horizon - S * 0.2, S * 0.63, horizon + S * 0.06], fill=(255, 226, 150))
    # Hills
    d.polygon([(0, horizon - 40), (S * 0.22, horizon - 150), (S * 0.45, horizon - 30), (S * 0.7, horizon - 120), (S, horizon - 60), (S, S), (0, S)], fill=(92, 60, 110))
    d.polygon([(0, horizon + 10), (S * 0.3, horizon - 50), (S * 0.6, horizon + 5), (S * 0.85, horizon - 40), (S, horizon), (S, S), (0, S)], fill=(60, 120, 80))
    d.rectangle([0, horizon + 5, S, S], fill=(70, 140, 80))
    # Road
    vx = S * 0.5
    d.polygon([(vx - 14, horizon), (vx + 14, horizon), (S * 0.95, S), (S * 0.05, S)], fill=(58, 60, 68))
    d.line([(vx - 12, horizon), (S * 0.12, S)], fill=(236, 236, 230), width=10)
    d.line([(vx + 12, horizon), (S * 0.88, S)], fill=(236, 236, 230), width=10)
    for i in range(7):
        a = (i / 7) ** 2
        b = ((i + 0.5) / 7) ** 2
        y0 = horizon + (S - horizon) * a
        y1 = horizon + (S - horizon) * b
        w0 = 3 + 22 * a
        w1 = 3 + 22 * b
        d.polygon([(vx - w0, y0), (vx + w0, y0), (vx + w1, y1), (vx - w1, y1)], fill=(242, 214, 90))
    # Car from behind
    cx, cy = S * 0.5, S * 0.8
    d.rounded_rectangle([cx - 150, cy - 40, cx + 150, cy + 70], 26, fill=(217, 49, 43))
    d.polygon([(cx - 110, cy - 38), (cx - 80, cy - 115), (cx + 80, cy - 115), (cx + 110, cy - 38)], fill=(217, 49, 43))
    d.polygon([(cx - 92, cy - 42), (cx - 68, cy - 100), (cx + 68, cy - 100), (cx + 92, cy - 42)], fill=(30, 40, 54))
    d.rectangle([cx - 135, cy - 5, cx - 70, cy + 18], fill=(255, 60, 60))
    d.rectangle([cx + 70, cy - 5, cx + 135, cy + 18], fill=(255, 60, 60))
    d.rectangle([cx - 160, cy + 62, cx - 105, cy + 105], fill=(26, 26, 28))
    d.rectangle([cx + 105, cy + 62, cx + 160, cy + 105], fill=(26, 26, 28))
    d.rectangle([cx - 150, cy + 50, cx + 150, cy + 72], fill=(40, 40, 46))
    return im.resize((size, size), Image.LANCZOS)


def circle(im):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).ellipse([0, 0, im.size[0] - 1, im.size[1] - 1], fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out


def rounded(im):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], im.size[0] // 6, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out


dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in dens.items():
    folder = os.path.join(ROOT, f'mipmap-{name}')
    os.makedirs(folder, exist_ok=True)
    n = int(48 * k)
    rounded(scene(n)).save(os.path.join(folder, 'ic_launcher.png'))
    circle(scene(n)).save(os.path.join(folder, 'ic_launcher_round.png'))
    scene(int(108 * k)).save(os.path.join(folder, 'ic_launcher_foreground.png'))

# Splash: dark background with the icon in the middle
for folder in os.listdir(ROOT):
    if not folder.startswith('drawable'):
        continue
    p = os.path.join(ROOT, folder, 'splash.png')
    if not os.path.exists(p):
        continue
    w, h = Image.open(p).size
    sp = Image.new('RGB', (w, h), (13, 20, 36))
    n = int(min(w, h) * 0.32)
    sp.paste(rounded(scene(n)), ((w - n) // 2, (h - n) // 2), rounded(scene(n)))
    sp.save(p)
print('done')
