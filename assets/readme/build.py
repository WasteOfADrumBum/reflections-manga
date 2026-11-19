"""Rebuild the README art from the website's own files.

Makes circular portraits (portraits/<id>.webp) and the family tree
(family-tree.webp) from site/images/characters/*-portrait.webp and the
family tree layout in site/characters.html, so the README matches the site.

Needs Python 3 with Pillow, and the Shippori Mincho B1 800 WOFF from
@fontsource/shippori-mincho-b1 (pass its path as FONT_DISPLAY).
Run from the repository root:  FONT_DISPLAY=/path/font.woff python3 assets/readme/build.py
"""
import html, math, os, re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = os.path.join(ROOT, "site")
OUT = os.path.join(ROOT, "assets", "readme")
INK, SOFT, ACCENT, PAPER, PAPER2, CARD = "#16161a", "#3d3d45", "#9a3412", "#f6f3ec", "#ebe6da", "#fffdf8"
DISPLAY = os.environ.get("FONT_DISPLAY")
BODY = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
SS = 3  # supersampling for smooth circles and lines


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", size)


def face_square(cid):
    im = Image.open(os.path.join(SITE, "images", "characters", f"{cid}-portrait.webp")).convert("RGB")
    w, h = im.size
    side = min(w, h)
    left = round((w - side) * 0.5)
    top = round((h - side) * 0.35)
    return im.crop((left, top, left + side, top + side))


def circle(cid, size, ring):
    big = size * SS
    face = face_square(cid).resize((big, big), Image.LANCZOS)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(face, (0, 0), mask)
    d = ImageDraw.Draw(out)
    r = max(1, int(round(ring * SS)))
    d.ellipse((r / 2, r / 2, big - 1 - r / 2, big - 1 - r / 2), outline=INK, width=r)
    return out.resize((size, size), Image.LANCZOS)


def portraits(ids):
    os.makedirs(os.path.join(OUT, "portraits"), exist_ok=True)
    for cid in ids:
        circle(cid, 240, 6).save(os.path.join(OUT, "portraits", f"{cid}.webp"), quality=86, method=6)


def path_segments(d):
    """Polylines from an SVG path using M, H, V, L and C commands (absolute)."""
    toks = re.findall(r"[MHVLC]|-?[\d.]+", d)
    lines, cur, x, y, i = [], None, 0.0, 0.0, 0
    while i < len(toks):
        t = toks[i]; i += 1
        if t == "M":
            x, y = float(toks[i]), float(toks[i + 1]); i += 2
            cur = [(x, y)]; lines.append(cur)
        elif t == "H":
            x = float(toks[i]); i += 1; cur.append((x, y))
        elif t == "V":
            y = float(toks[i]); i += 1; cur.append((x, y))
        elif t == "L":
            x, y = float(toks[i]), float(toks[i + 1]); i += 2; cur.append((x, y))
        elif t == "C":
            p = [float(v) for v in toks[i:i + 6]]; i += 6
            x0, y0 = x, y
            for k in range(1, 41):
                u = k / 40
                bx = (1-u)**3*x0 + 3*(1-u)**2*u*p[0] + 3*(1-u)*u**2*p[2] + u**3*p[4]
                by = (1-u)**3*y0 + 3*(1-u)**2*u*p[1] + 3*(1-u)*u**2*p[3] + u**3*p[5]
                cur.append((bx, by))
            x, y = p[4], p[5]
    return lines


def dashed(draw, pts, width, fill, dash, gap):
    on, left = True, dash
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        seg = math.hypot(x2 - x1, y2 - y1); pos = 0.0
        while pos < seg:
            step = min(left, seg - pos)
            if on:
                a, b = pos / seg, (pos + step) / seg
                draw.line([(x1 + (x2-x1)*a, y1 + (y2-y1)*a), (x1 + (x2-x1)*b, y1 + (y2-y1)*b)], fill=fill, width=width)
            pos += step; left -= step
            if left <= 1e-6:
                on = not on; left = dash if on else gap


def tree():
    src = open(os.path.join(SITE, "characters.html"), encoding="utf-8").read()
    svg = re.search(r'<svg class="ft-lines ft-lines-wide".*?</svg>', src, re.S).group(0)
    W, H = 1280, 745
    PAD_B = 70  # room for the line key under the tree
    scale = 1.5 * SS
    img = Image.new("RGB", (int(W * scale), int((H + PAD_B) * scale)), PAPER)
    d = ImageDraw.Draw(img)
    S = lambda v: v * scale
    for el in re.finditer(r'<(path|line|text|rect)\b([^>]*?)(/?)>(?:([^<]*)</text>)?', svg):
        tag, attrs, text = el.group(1), el.group(2), el.group(4)
        a = dict(re.findall(r'([\w-]+)="([^"]*)"', attrs))
        cls = a.get("class", "")
        if tag == "path":
            for pts in path_segments(a["d"]):
                pts = [(S(px), S(py)) for px, py in pts]
                if "ft-friend" in cls:
                    dashed(d, pts, int(S(2.5)), SOFT, S(7), S(6))
                else:
                    color, w = (SOFT, 2.5) if "ft-line-soft" in cls else (INK, 3)
                    d.line(pts, fill=color, width=int(S(w)), joint="curve")
        elif tag == "line":
            d.line([(S(float(a["x1"])), S(float(a["y1"]))), (S(float(a["x2"])), S(float(a["y2"])))], fill=ACCENT, width=int(S(3)))
        elif tag == "rect":
            x, y = float(a["x"]), float(a["y"])
            d.rectangle((S(x), S(y), S(x + float(a["width"])), S(y + float(a["height"]))), fill=PAPER)
        elif tag == "text":
            f = font(BODY, int(S(float(a.get("font-size", 18)))))
            d.text((S(float(a["x"])), S(float(a["y"]))), html.unescape(text), font=f, fill=SOFT, anchor="ms")
    nodes = re.findall(r'<li class="ft-node-item[^"]*" style="([^"]+)"><a class="ft-node( ft-parent)?" href="#([^"]+)".*?<span class="ft-nm">([^<]+)</span><span class="ft-ag">([^<]+)</span>(?:<span class="ft-role">([^<]+)</span>)?', src)
    for style, parent, cid, name, age, role in nodes:
        v = dict((k, float(n)) for k, n in re.findall(r"--(\w+):([\d.]+)", style))
        cx, top, size = W * v["x"] / 100, H * v["y"] / 100, W * v["s"] / 100
        face = circle(cid, int(S(size)), S(3))
        img.paste(face, (int(S(cx) - face.width / 2), int(S(top))), face)
        y = top + size + 4
        big = 15 if parent else 19.2
        small = 12.8 if parent else 14.7
        d.text((S(cx), S(y)), html.unescape(name), font=font(DISPLAY, int(S(big))), fill=INK, anchor="mt")
        y += big * 1.15
        d.text((S(cx), S(y)), html.unescape(age), font=font(BODY, int(S(small))), fill=INK, anchor="mt")
        if role:
            y += small * 1.2
            d.text((S(cx), S(y)), html.unescape(role), font=font(BODY, int(S(small))), fill=SOFT, anchor="mt")
    # Line key, as on the site
    ky, kx, f = H + 35, 395, font(BODY, int(S(17)))
    for label, kind in (("Married", "marry"), ("Best friends", "friend"), ("Parent to child", "line")):
        if kind == "marry":
            d.line([(S(kx), S(ky - 4)), (S(kx + 44), S(ky - 4))], fill=ACCENT, width=int(S(3)))
            d.line([(S(kx), S(ky + 4)), (S(kx + 44), S(ky + 4))], fill=ACCENT, width=int(S(3)))
        elif kind == "friend":
            dashed(d, [(S(kx), S(ky)), (S(kx + 44), S(ky))], int(S(2.5)), SOFT, S(7), S(6))
        else:
            d.line([(S(kx), S(ky)), (S(kx + 44), S(ky))], fill=INK, width=int(S(3)))
        d.text((S(kx + 54), S(ky)), label, font=f, fill=INK, anchor="lm")
        kx += 54 + f.getlength(label) / scale + 40
    img = img.resize((img.width // SS, img.height // SS), Image.LANCZOS)
    img.save(os.path.join(OUT, "family-tree.webp"), quality=88, method=6)


if __name__ == "__main__":
    ids = sorted(f[:-len("-portrait.webp")] for f in os.listdir(os.path.join(SITE, "images", "characters")) if f.endswith("-portrait.webp"))
    portraits(ids)
    tree()
    print("portraits:", len(ids))
