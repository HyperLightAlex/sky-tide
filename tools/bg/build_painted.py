#!/usr/bin/env python3
"""Build Skytide's painted sets (the sky, the cloud cards, the cloud sea and the puffs) from
the sheets in art/sky-sheets, one set per time of day, and write src/world/paintedSets.js,
which the game reads: each set's files, where its sun is, and each cloud card's rectangle and
outline (the outline, turned round the card's upright, is the volume you fly into).

    python3 tools/bg/build_painted.py

A set is built when its four sheets are there (sky-g1-sky.png, sky-g1b-sky.png,
sky-g2-clouds.png, sky-g3-cloud.png for golden hour; m for midday, n for night). Until then
the game uses Zenith GP's sets in assets/painted (Meridian at golden hour, Helios under a high
sun), listed here as they are. Run it again after replacing a sheet.

The cutting is Zenith GP's (tools/bg/build_backgrounds.py there), unchanged:
- Sky: the sun-side half and the half facing away side by side, their colours matched across
  both joins, resampled so the horizon sits on a fixed row; horizon to zenith.
- Clouds: each cloud cut out of the green by its own outline (grouped by the cell of the sheet
  its middle falls in) and packed into an atlas, in the sheet's cell order.
- Surfaces: each square cut to the length that wraps best both ways, its seams blended.
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SHEETS = os.path.join(ROOT, 'art', 'sky-sheets')
OUT = os.path.join(ROOT, 'assets', 'painted')
MODULE = os.path.join(ROOT, 'src', 'world', 'paintedSets.js')
ROWS = 32   # outline rows per card

# The sky texture: SKY_W x SKY_H, the horizon HAZE rows above the bottom.
SKY_W, SKY_H, HAZE = 3072, 768, 24

# The cloud-surface squares, in sheet order.
TILES = ['cloudsea', 'cloudsea-broken', 'puffs', 'stratus', 'cloudsea-shade', 'puffs-shade']

# Skytide's sets, by time of day (card 4, index 3, is the storm in every one).
SETS = {
    'golden': dict(letter='g', light='golden'),
    'midday': dict(letter='m', light='midday'),
    'night': dict(letter='n', light='night'),
}

# Zenith GP's sets, reused until ours are made (already built; their card rectangles are from
# its build). Meridian has no storm card or cloud sea of its own: it borrows Helios's, warmed.
ZENITH = {
    'meridian': dict(light='golden', sky='assets/painted/sky-meridian.webp', sunU=0.2633, horizonV=0.03125,
                     clouds='assets/painted/clouds-meridian.webp', anvil=None, warm=True,
                     surfaces={'cloudsea': 'assets/painted/cloudsea.webp'},
                     cards=[{"u0": 0.022135416666666668, "v0": 0.6201171875, "u1": 0.3111979166666667, "v1": 0.880859375, "aspect": 1.6629}, {"u0": 0.3372395833333333, "v0": 0.65625, "u1": 0.6627604166666666, "v1": 0.84375, "aspect": 2.6042}, {"u0": 0.6940104166666666, "v0": 0.541015625, "u1": 0.9720052083333334, "v1": 0.9599609375, "aspect": 0.9953}, {"u0": 0.014973958333333334, "v0": 0.1318359375, "u1": 0.318359375, "v1": 0.3681640625, "aspect": 1.9256}, {"u0": 0.33984375, "v0": 0.1865234375, "u1": 0.6595052083333334, "v1": 0.314453125, "aspect": 3.7481}, {"u0": 0.6868489583333334, "v0": 0.109375, "u1": 0.9798177083333334, "v1": 0.3916015625, "aspect": 1.5571}]),
    'helios': dict(light='midday', sky='assets/painted/sky-helios.webp', sunU=0.4043, horizonV=0.03125,
                   clouds='assets/painted/clouds-helios.webp', anvil=3, warm=False,
                   surfaces={'cloudsea': 'assets/painted/cloudsea.webp'},
                   cards=[{"u0": 0.00390625, "v0": 0.5478515625, "u1": 0.3294270833333333, "v1": 0.9521484375, "aspect": 1.2077}, {"u0": 0.3372395833333333, "v0": 0.6337890625, "u1": 0.6627604166666666, "v1": 0.8662109375, "aspect": 2.1008}, {"u0": 0.6901041666666666, "v0": 0.6103515625, "u1": 0.9765625, "v1": 0.8896484375, "aspect": 1.5385}, {"u0": 0.00390625, "v0": 0.060546875, "u1": 0.3294270833333333, "v1": 0.4404296875, "aspect": 1.2853}, {"u0": 0.3372395833333333, "v0": 0.1064453125, "u1": 0.6627604166666666, "v1": 0.3935546875, "aspect": 1.7007}, {"u0": 0.6803385416666666, "v0": 0.072265625, "u1": 0.986328125, "v1": 0.427734375, "aspect": 1.2912}]),
}


def load(name):
    return np.asarray(Image.open(os.path.join(SHEETS, name)).convert('RGB')).astype(np.float32) / 255


def save(arr, path, quality=86):
    mode = 'RGBA' if arr.shape[-1] == 4 else 'RGB'
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode).save(path, 'WEBP', quality=quality, method=6)
    return os.path.getsize(path)


# ---- sky -------------------------------------------------------------------

def horizon_row(sky):
    """The row where the painted sky meets the flat haze."""
    rowdiff = np.abs(np.diff(sky.mean(1), axis=0)).sum(1)
    lo = sky.shape[0] // 2
    return int(np.argmax(rowdiff[lo:]) + lo)


def sun_column(sky, hz):
    """Where the sun's glow is brightest, across the sheet."""
    from PIL import ImageFilter
    im = Image.fromarray((sky[:hz] * 255).astype(np.uint8)).convert('L').filter(ImageFilter.GaussianBlur(40))
    a = np.asarray(im).astype(np.float32)
    return int(np.unravel_index(np.argmax(a), a.shape)[1])


def sky_half(sky, width):
    """Horizon to the top edge, resampled so the horizon lands on a fixed row, with haze below."""
    hz = horizon_row(sky)
    up = Image.fromarray((sky[:hz] * 255).astype(np.uint8)).resize((width, SKY_H - HAZE), Image.LANCZOS)
    down = Image.fromarray((sky[hz + 4:hz + 4 + HAZE * 2] * 255).astype(np.uint8)).resize((width, HAZE), Image.LANCZOS)
    out = np.concatenate([np.asarray(up), np.asarray(down)], 0).astype(np.float32) / 255
    return out, hz


def edge_colour(img, side, n=40):
    """The sky's own colour along one edge, row by row: the median across a
    band by the edge, then down the rows (so the clouds in it do not count),
    smoothed; the sky and the haze below the horizon each on their own."""
    cols = img[:, :n] if side == 'left' else img[:, -n:]
    c = np.median(cols, 1)
    h = SKY_H - HAZE
    sky = ndimage.gaussian_filter1d(ndimage.median_filter(c[:h], size=(61, 1), mode='nearest'), 12, axis=0, mode='nearest')
    haze = ndimage.gaussian_filter1d(ndimage.median_filter(c[h:], size=(9, 1), mode='nearest'), 2, axis=0, mode='nearest')
    return np.concatenate([sky, haze], 0)


def match_joins(a, b, band=320):
    """Shift b's colours near both its edges to meet a's (a | b, wrapping round)."""
    b = b.copy()
    w = b.shape[1]
    ramp = (1 - np.arange(band) / band)[None, :, None]
    d1 = edge_colour(a, 'right') - edge_colour(b, 'left')
    b[:, :band] += d1[:, None, :] * ramp
    d2 = edge_colour(a, 'left') - edge_colour(b, 'right')
    b[:, w - band:] += (d2[:, None, :] * ramp)[:, ::-1]
    return b


def soften_seams(p, xs, r=10):
    """Blur a few columns either side of each join a little, so a cloud cut there fades across it."""
    p = p.copy()
    w = p.shape[1]
    for x in xs:
        idx = (np.arange(x - r * 3, x + r * 3)) % w
        seg = p[:, idx]
        blurred = ndimage.gaussian_filter1d(seg, r * 0.6, axis=1, mode='wrap')
        k = np.exp(-((np.arange(len(idx)) - r * 3) / r) ** 2)[None, :, None]
        p[:, idx] = seg * (1 - k) + blurred * k
    return p


def build_sky(spec):
    halves = [load(n) for n in spec['sky']]
    a, hz = sky_half(halves[0], SKY_W // 2)
    sun = sun_column(halves[0], hz) / halves[0].shape[1] * 0.5
    if len(halves) > 1:
        b, _ = sky_half(halves[1], SKY_W // 2)
        b = match_joins(a, b, spec.get('join_band', 320))
    else:
        b = a.copy()
    pano = np.concatenate([a, b], 1)
    pano = soften_seams(pano, [0, SKY_W // 2])
    return np.clip(pano, 0, 1), sun


# ---- keyed sheets ------------------------------------------------------------

def key_channels(bg):
    """The key's channels (those it is bright in: green's one, magenta's two) and the rest."""
    K = [c for c in range(3) if bg[c] > 0.5]
    return K, [c for c in range(3) if c not in K]


def keyness(x, K, O):
    """How far a colour leans toward the key: its weakest key channel over its strongest other one."""
    return np.min(x[..., K], -1) - np.max(x[..., O], -1)


def keyed(rgb, refine=True):
    """Cut a sheet out of its flat key colour (green, or magenta for art that
    is itself green). Alpha is how little the key's channels stand above the
    rest; edge pixels have the key taken back out; any of the key's hue left
    over is clamped away (nothing painted on these sheets is that colour); and
    the hidden colour under transparent pixels is filled from the nearest
    solid one, so filtering never pulls in the key."""
    bg = np.median(np.concatenate([rgb[:24, :24], rgb[-24:, -24:]]).reshape(-1, 3), 0)
    K, O = key_channels(bg)
    excess = keyness(rgb, K, O)
    full = float(keyness(bg, K, O))
    a = np.clip(1 - (excess - 0.04) / (full * 0.9 - 0.04), 0, 1)
    col = np.where(a[..., None] > 0.02, (rgb - (1 - a[..., None]) * bg) / np.maximum(a[..., None], 0.02), 0)
    col = np.clip(col, 0, 1)
    if len(K) == 1:
        k, o = K[0], O
        col[..., k] = np.minimum(col[..., k], np.maximum(col[..., o[0]], col[..., o[1]]))
    else:
        col[..., K] -= np.maximum(keyness(col, K, O), 0)[..., None]
    _, (iy, ix) = ndimage.distance_transform_edt(a < 0.98, return_indices=True)
    solid = a >= 0.98
    col = np.where(solid[..., None], col, col[iy, ix])
    if refine:
        a, col = refine_edges(rgb, bg, a, col)
    return np.concatenate([col, a[..., None]], -1)


def refine_edges(rgb, bg, a, col, inset=3, reach=40):
    """A second, closer look at the edges. The key alone misjudges an edge
    whose colour has some of the key's channel in it: a blue-white cloud's
    rim against green reads as solid (its blue hides the green; it comes out
    teal), an orange one as more solid than it is (it comes out olive).
    Instead each edge pixel is taken as a mix of the key and the colour a few
    pixels further in, and its alpha is how far along that line it lies."""
    core = ndimage.binary_erosion(a >= 0.98, iterations=inset)
    dist, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    F = rgb[iy, ix]
    d = F - bg
    al = np.clip(((rgb - bg) * d).sum(-1) / np.maximum((d * d).sum(-1), 1e-4), 0, 1)
    edge = ~core & (dist <= reach)
    a2 = np.where(edge, np.minimum(a, al), a)
    un = np.clip((rgb - (1 - a2[..., None]) * bg) / np.maximum(a2[..., None], 0.02), 0, 1)
    K, O = key_channels(bg)
    # Nothing on the sheets leans further toward the key than the colour inside it.
    if len(K) == 1:
        k, o = K[0], O
        lim = np.maximum(np.maximum(un[..., o[0]], un[..., o[1]]), F[..., k] - np.maximum(F[..., o[0]], F[..., o[1]]) + np.maximum(un[..., o[0]], un[..., o[1]]))
        un[..., k] = np.minimum(un[..., k], lim)
    else:
        un[..., K] -= np.maximum(keyness(un, K, O) - np.maximum(keyness(F, K, O), 0), 0)[..., None]
    w = np.clip((a2 - 0.2) / 0.5, 0, 1)[..., None]
    c2 = un * w + F * (1 - w)
    col = np.where(edge[..., None], c2, col)
    return a2, col


def wrap_ends(img, ov=32):
    """Blend a strip's last `ov` columns into its first ones and drop them, so it repeats end to end."""
    out = img[:, :-ov].copy()
    w = np.linspace(0, 1, ov)[None, :, None]
    pm_a = img[:, :ov, :3] * img[:, :ov, 3:]
    pm_b = img[:, -ov:, :3] * img[:, -ov:, 3:]
    al = img[:, :ov, 3:] * w + img[:, -ov:, 3:] * (1 - w)
    pm = pm_a * w + pm_b * (1 - w)
    out[:, :ov, :3] = np.where(al > 1e-3, pm / np.maximum(al, 1e-3), img[:, :ov, :3])
    out[:, :ov, 3:] = al
    return out


def build_horizon(spec):
    rgba = keyed(load(spec['horizon']))
    solid = rgba[..., 3] > 0.5
    rows = np.nonzero(solid.sum(1) > 20)[0]
    bands, s0, prev = [], rows[0], rows[0]
    for y in rows[1:]:
        if y > prev + 5:
            bands.append((s0, prev + 1))
            s0 = y
        prev = y
    bands.append((s0, prev + 1))
    strips = []
    for y0, y1 in bands:
        # A few rows of headroom above the highest peak, none below the flat bottom.
        strips.append(wrap_ends(rgba[max(0, y0 - 4):y1]))
    return strips


def build_clouds(spec):
    rgba = keyed(load(spec['clouds']))
    # Bits of the green left in a ragged cloud's gaps come out teal: no cloud's colour is much
    # greener than the mean of its red and blue.
    rgba[..., 1] = np.minimum(rgba[..., 1], (rgba[..., 0] + rgba[..., 2]) / 2 + 0.03)
    lab, n = ndimage.label(rgba[..., 3] > 0.5)
    sizes = ndimage.sum(np.ones(lab.shape), lab, range(1, n + 1))
    cents = ndimage.center_of_mass(np.ones(lab.shape), lab, range(1, n + 1))
    H, W = lab.shape
    cell_of = {}
    for i, (cy, cx) in enumerate(cents):
        if sizes[i] < 200:
            continue
        cell = int(cy // (H / 2)) * 3 + int(cx // (W / 3))
        cell_of.setdefault(cell, []).append(i + 1)
    atlas = np.zeros((1024, 1536, 4), np.float32)
    cards = []
    for cell in range(6):
        ids = cell_of.get(cell, [])
        if not ids:
            continue
        m = np.isin(lab, ids)
        # The soft edge around each cloud as well.
        m = ndimage.binary_dilation(m, iterations=3)
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        card = rgba[y0:y1, x0:x1].copy()
        card[..., 3] *= m[y0:y1, x0:x1]
        h, w = card.shape[:2]
        s = min(1.0, 500 / w, 500 / h)
        if s < 1:
            im = Image.fromarray((card * 255).astype(np.uint8), 'RGBA').resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
            card = np.asarray(im).astype(np.float32) / 255
            h, w = card.shape[:2]
        r, c = divmod(cell, 3)
        ox = c * 512 + (512 - w) // 2
        oy = r * 512 + (512 - h) // 2
        atlas[oy:oy + h, ox:ox + w] = card
        # Texture coordinates run up from the bottom.
        cards.append(dict(u0=ox / 1536, v0=1 - (oy + h) / 1024, u1=(ox + w) / 1536, v1=1 - oy / 1024, aspect=round(w / h, 4)))
    # Fill the colour under the empty atlas with its neighbours', for clean filtering.
    _, (iy, ix) = ndimage.distance_transform_edt(atlas[..., 3] < 0.02, return_indices=True)
    atlas[..., :3] = np.where(atlas[..., 3:] >= 0.02, atlas[..., :3], atlas[iy, ix, :3])
    return atlas, cards


# ---- surfaces ------------------------------------------------------------------

def best_len(t, axis, lo=320):
    first = np.take(t, 0, axis=axis)
    return min((np.abs(np.take(t, L, axis=axis) - first).mean(), L) for L in range(lo, t.shape[axis]))[1]


def fade(t, axis, ov=16):
    t = np.moveaxis(t, axis, 0).copy()
    n = t.shape[0]
    w = np.linspace(0, 1, ov)[:, None, None]
    t[:ov] = t[:ov] * w + t[n - ov:] * (1 - w)
    return np.moveaxis(t[:n - ov], 0, axis)


def seamless(t):
    t = t[:, :best_len(t, 1)]
    t = t[:best_len(t, 0)]
    t = fade(fade(t, 1), 0)
    im = Image.fromarray((np.clip(t, 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255


def build_surfaces(spec):
    sheet = load(spec['surfaces'])
    out = {}
    for i, name in enumerate(spec['tiles']):
        r, c = divmod(i, 3)
        out[name] = seamless(sheet[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512])
    return out


# ---- outlines and the module the game reads ----------------------------------------

def outline(img, c):
    """A card's silhouette, bottom to top, as a half-width and a centre per row (fractions of
    the card's width)."""
    W, H = img.size
    a = np.asarray(img.getchannel('A'))
    x0, x1 = int(c['u0'] * W), int(c['u1'] * W)
    y0, y1 = int((1 - c['v1']) * H), int((1 - c['v0']) * H)
    cw, ch = x1 - x0, y1 - y0
    hw, cx = [], []
    for i in range(ROWS):
        y = y1 - 1 - int((i + 0.5) / ROWS * ch)
        xs = np.nonzero(a[y, x0:x1] > 127)[0]
        if len(xs) == 0:
            hw.append(0.0); cx.append(0.0)
        else:
            hw.append(round((xs[-1] - xs[0] + 1) / 2 / cw, 4))
            cx.append(round(((xs[0] + xs[-1] + 1) / 2 - cw / 2) / cw, 4))
    return hw, cx


def with_outlines(atlas_path, cards):
    img = Image.open(os.path.join(ROOT, atlas_path)).convert('RGBA')
    out = []
    for c in cards:
        hw, cx = outline(img, c)
        out.append({**c, 'hw': hw, 'cx': cx})
    return out


def main():
    sets = {}
    for name, spec in SETS.items():
        L = spec['letter']
        names = dict(sky=[f'sky-{L}1-sky.png', f'sky-{L}1b-sky.png'], clouds=f'sky-{L}2-clouds.png', surfaces=f'sky-{L}3-cloud.png', tiles=TILES)
        missing = [n for n in names['sky'] + [names['clouds'], names['surfaces']] if not os.path.exists(os.path.join(SHEETS, n))]
        if missing:
            print(f'{name}: not built (missing {", ".join(missing)})')
            continue
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        sky, sun = build_sky(names)
        save(sky, os.path.join(d, 'sky.webp'), 84)
        atlas, cards = build_clouds(names)
        save(atlas, os.path.join(d, 'clouds.webp'))
        surf = build_surfaces(names)
        for k, t in surf.items():
            save(t, os.path.join(d, f'{k}.webp'), 84)
        rel = lambda f: f'assets/painted/{name}/{f}'
        sets[name] = dict(light=spec['light'], sky=rel('sky.webp'), sunU=round(sun, 4), horizonV=round(HAZE / SKY_H, 5),
                          clouds=rel('clouds.webp'), anvil=3 if len(cards) > 3 else None, warm=False,
                          surfaces={k: rel(f'{k}.webp') for k in surf}, cards=cards)
        print(f'{name}: built ({len(cards)} cards)')
    for name, spec in ZENITH.items():
        sets[name] = dict(spec)
    for name, s in sets.items():
        s['cards'] = with_outlines(s['clouds'], s['cards'])
    js = ('// Generated by tools/bg/build_painted.py. Do not edit by hand.\n'
          '// The painted sets: per set, its light (golden, midday, night), sky panorama (where its sun\n'
          '// is across it, where its horizon is), cloud-card atlas and cards (rectangle, v from the\n'
          '// bottom; width over height; outline bottom to top in %d rows as half-width hw and centre cx,\n'
          '// fractions of the card\'s width), which card is the storm (anvil), whether its cloud surfaces\n'
          '// need warming for golden hour (warm), and its cloud-surface textures.\n'
          'export const PAINTED_SETS = %s;\n') % (ROWS, json.dumps(sets, separators=(',', ':')))
    with open(MODULE, 'w') as fh:
        fh.write(js)
    print('wrote', os.path.relpath(MODULE, ROOT))


if __name__ == '__main__':
    main()
