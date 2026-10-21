#!/usr/bin/env python3
"""Prepare the original character models (Hunyuan3D-2mv, art/models/source) for the game.

    python3 tools/models/characters_prepare.py [--debug] [--static]

For each character it keeps the delivered surface, UVs and colour texture (they read well
under the game's cel shading as they are) and:

- stands it at its design height (Tavi 1.72 m, Mara 1.82 m: the concept sheets), feet at
  Y=0, centred, facing +Z; drops the loose fragments a few triangles in size;
- drops the metallic-roughness map and metal (the cel shader paints its own light) and halves
  the colour texture to 2048 px;
- finds the face and the hair, and gives them shaped normals for the cel shader, stored
  beside the model's own as the attribute _CELN (xyz the shaped normal, w how much of it to
  use): the face lit as one smooth oval round the head (so its cel shadow falls as one clean
  shape, the way a 2005 TV anime painted a face, instead of following every sculpted bump),
  the hair as a heavily smoothed version of itself leaning toward the same oval. The shader
  (render/cel.js) blends it in before any skinning, so a rig added later keeps it.

The face is the skin-coloured surface of the head, closed over the painted eyes, brows and
mouth; the hair is the surface of the head coloured like the crown. --debug writes front
and side views of both to art/models/previews/ for checking.

characters_rig.py runs this (prepare()) and then rigs the result, writing the game's
assets/models/<name>.glb. Run alone, this writes art/models/production/<name>-prepare.json
(and, with --static, the unrigged models to assets/models/ for comparison).
"""
import io
import json
import os
import struct
import sys

import numpy as np
import pygltflib
from PIL import Image, ImageDraw
from scipy import sparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
CHARACTERS = {
    'tavi': dict(source='art/models/source/tavi.glb', height=1.72),
    'mara': dict(source='art/models/source/mara.glb', height=1.82),
}
TEX = 2048
FRAGMENT = 50          # loose pieces under this many triangles are dropped


# ---- reading --------------------------------------------------------------------------------

def accessor(g, blob, i):
    a = g.accessors[i]
    bv = g.bufferViews[a.bufferView]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a.type]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5120: np.int8, 5122: np.int16}[a.componentType]
    off = (bv.byteOffset or 0) + (a.byteOffset or 0)
    arr = np.frombuffer(blob, dt, a.count * n, off)
    return arr.reshape(a.count, n) if n > 1 else arr


def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def load(path):
    g = pygltflib.GLTF2().load(path)
    blob = g.binary_blob()
    prim = g.meshes[0].primitives[0]
    P = accessor(g, blob, prim.attributes.POSITION).astype(np.float64)
    N = accessor(g, blob, prim.attributes.NORMAL).astype(np.float64)
    UV = accessor(g, blob, prim.attributes.TEXCOORD_0).astype(np.float64)
    F = accessor(g, blob, prim.indices).astype(np.int64).reshape(-1, 3)
    node = next(n for n in g.nodes if n.mesh is not None)
    if node.rotation:
        R = quat_mat(node.rotation)
        P = P @ R.T
        N = N @ R.T
    mat = g.materials[prim.material]
    im = g.images[g.textures[mat.pbrMetallicRoughness.baseColorTexture.index].source]
    bv = g.bufferViews[im.bufferView]
    tex = Image.open(io.BytesIO(blob[(bv.byteOffset or 0):(bv.byteOffset or 0) + bv.byteLength])).convert('RGB')
    return P, N, UV, F, tex


# ---- the mesh as a surface (UV seams welded) ------------------------------------------------

def weld(P):
    """A group per position: vertices split only by UV or normal seams share one."""
    key = np.round(P / 1e-6).astype(np.int64)
    _, grp = np.unique(key, axis=0, return_inverse=True)
    return grp.ravel()


def adjacency(F, grp, n):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = grp[e]
    e = e[e[:, 0] != e[:, 1]]
    A = sparse.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()
    A = ((A + A.T) > 0).astype(np.float64)
    return A


def components(A):
    from scipy.sparse.csgraph import connected_components
    return connected_components(A, directed=False)[1]


def dilate(A, m, k):
    for _ in range(k):
        m = m | ((A @ m.astype(np.float64)) > 0)
    return m


def erode(A, m, k):
    return ~dilate(A, ~m, k)


def blur(A, v, k):
    deg = np.asarray(A.sum(1)).ravel() + 1
    for _ in range(k):
        v = (A @ v + v) / deg[:, None] if v.ndim > 1 else (A @ v + v) / deg
    return v


# ---- the face and the hair ------------------------------------------------------------------

def sample(tex, UV):
    a = np.asarray(tex).astype(np.float64) / 255
    h, w = a.shape[:2]
    x = np.clip((UV[:, 0] % 1) * w, 0, w - 1).astype(int)
    y = np.clip((UV[:, 1] % 1) * h, 0, h - 1).astype(int)
    return a[y, x]


def shape_normals(P, N, F, col, grp, A):
    """Per surface point (group): the shaped normal and how much of it to use."""
    n = grp.max() + 1
    # per group: position, normal, colour (averaged over its split vertices)
    cnt = np.bincount(grp, minlength=n)[:, None]
    gP = np.zeros((n, 3)); np.add.at(gP, grp, P); gP /= cnt
    gN = np.zeros((n, 3)); np.add.at(gN, grp, N); gN /= np.maximum(np.linalg.norm(gN, axis=1, keepdims=True), 1e-9)
    gC = np.zeros((n, 3)); np.add.at(gC, grp, col); gC /= cnt
    H = gP[:, 1].max()
    yf = gP[:, 1] / H
    head = yf > 0.84
    # the crown's colour is the hair's; the front of the head below it, warm and lighter, the skin's
    crown = gC[yf > 0.975]
    hair_ref = np.median(crown, 0)
    lum = gC @ np.array([0.3, 0.59, 0.11])
    front = head & (gN[:, 2] > 0.35) & (yf < 0.93) & (np.abs(gP[:, 0]) < 0.06)
    warm = (gC[:, 0] > gC[:, 2] + 0.08) & (lum > lum[front].mean() * 0.8 if front.any() else True)
    skin_ref = np.median(gC[front & warm], 0) if (front & warm).sum() > 20 else np.median(gC[front], 0)
    # (by hue and lightness apart: a mustard collar is as light as skin but yellower)
    def cdist(a, ref):
        ca = a / np.maximum(a.sum(1, keepdims=True), 1e-6); cr = ref / max(ref.sum(), 1e-6)
        return np.linalg.norm(ca - cr, axis=1) * 3 + np.abs(a @ np.array([0.3, 0.59, 0.11]) - ref @ np.array([0.3, 0.59, 0.11]))
    dist_skin = cdist(gC, skin_ref)
    dist_hair = np.linalg.norm(gC - hair_ref, axis=1)
    skin = head & (dist_skin < 0.14) & (dist_skin < dist_hair)
    # the chin: going down the profile, where the front of the skin steps back furthest (jaw to neck)
    ys = np.arange(0.80, 0.95, 0.004) * H
    zf = np.array([gP[skin & (np.abs(gP[:, 0]) < 0.05 * H / 1.8) & (np.abs(gP[:, 1] - y) < 0.004 * H), 2].max(initial=-9) for y in ys])
    # (a bare neck stands well behind the face: the chin is the top of the run of such skin at
    # the bottom of the profile; with none, as over a high collar, it is where the skin starts)
    ok = zf > -9
    first = int(np.argmax(ok))
    chin = float(ys[first])
    back = ok & (zf < zf.max() - 0.06 * H / 1.8)
    i = first
    while i < len(ys) and back[i]:
        i += 1
    if i > first:
        chin = float(ys[min(i, len(ys) - 1)])
    hair = head & (dist_hair < 0.2) & ~skin & (yf > 0.88)
    # the face: the head's skin, closed over the painted eyes, brows and mouth; then softened
    face = erode(A, dilate(A, skin, 6), 6) & head & ~hair & (gP[:, 1] > chin)
    # (only the piece of it joined to the front of the face, not a collar or stray specks)
    Af = (sparse.diags(face.astype(np.float64)) @ A @ sparse.diags(face.astype(np.float64))).tocsr()
    lab = components(Af)
    mid_y = np.median(gP[face, 1])
    cand = np.nonzero(face & (np.abs(gP[:, 1] - mid_y) < 0.03 * H) & (np.abs(gP[:, 0]) < 0.04 * H / 1.8))[0]
    if len(cand):
        face = face & (lab == lab[cand[np.argmax(gP[cand, 2])]])
    fw = blur(A, face.astype(np.float64), 4)
    hw = blur(A, hair.astype(np.float64), 4)
    # the head's oval: round the face and the hair at the face's height
    fP = gP[face & (gP[:, 1] > chin)]
    cx = np.median(fP[:, 0])
    y0, y1 = np.percentile(fP[:, 1], [5, 95])
    cy = (y0 + y1) / 2 + 0.01 * H
    band = head & (np.abs(gP[:, 1] - cy) < 0.04 * H)
    z0, z1 = np.percentile(gP[band, 2], [2, 98])
    x0, x1 = np.percentile(gP[band, 0], [2, 98])
    # (taller than wide, as a head is, and its middle a little back: the front of the face
    # lights evenly and the shadow's edge runs down the far side, not across the mouth)
    rx, rz = (x1 - x0) / 2, (z1 - z0) / 2
    c = np.array([cx, cy, (z0 + z1) / 2 - 0.25 * rz])
    r = np.array([rx, max((y1 - y0) / 2 * 1.15, 1.5 * rx), rz * 1.1])
    ov = (gP - c) / (r * r)
    ov /= np.maximum(np.linalg.norm(ov, axis=1, keepdims=True), 1e-9)
    # the hair: its own normals smoothed heavily (over the hair only), leaning toward the oval
    hn = gN.copy()
    hm = sparse.diags((hair | (hw > 0.05)).astype(np.float64))
    Ah = (hm @ A @ hm).tocsr()
    for _ in range(40):
        hn = (Ah @ hn) + hn
        hn /= np.maximum(np.linalg.norm(hn, axis=1, keepdims=True), 1e-9)
    hn = hn * 0.55 + ov * 0.45
    hn /= np.maximum(np.linalg.norm(hn, axis=1, keepdims=True), 1e-9)
    # (full on the face from a little above the chin: under the jaw and the neck keep their
    # own, so there is a shadow under the chin)
    w_face = np.clip(fw * 1.15, 0, 1) * np.clip((gP[:, 1] - chin) / (0.02 * H), 0, 1)
    w_hair = np.clip(hw * 1.1, 0, 1) * (1 - w_face)
    out = gN.copy()
    out = out * (1 - w_face - w_hair)[:, None] + ov * w_face[:, None] + hn * w_hair[:, None]
    out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-9)
    weight = np.clip(w_face + w_hair, 0, 1)
    info = dict(chin_m=round(chin, 4), head_center_m=[round(float(v), 4) for v in c], head_radii_m=[round(float(v), 4) for v in r],
                skin_rgb=[round(float(v), 3) for v in skin_ref], hair_rgb=[round(float(v), 3) for v in hair_ref],
                face_points=int((w_face > 0.5).sum()), hair_points=int((w_hair > 0.5).sum()))
    return out, weight, w_face, w_hair, info


# ---- writing --------------------------------------------------------------------------------

def write_glb(path, name, P, N, UV, CELN, F, jpeg):
    chunks, views, accs = [], [], []

    def add(data, target=None):
        off = sum(len(c) for c in chunks)
        pad = (-len(data)) % 4
        chunks.append(data + b'\0' * pad)
        v = dict(buffer=0, byteOffset=off, byteLength=len(data))
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def acc(arr, ctype, typ, target, normalized=False, minmax=False):
        bv = add(arr.tobytes(), target)
        a = dict(bufferView=bv, componentType=ctype, count=int(arr.shape[0]), type=typ)
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(v) for v in arr.min(0)]; a['max'] = [float(v) for v in arr.max(0)]
        accs.append(a)
        return len(accs) - 1

    pos = acc(P.astype(np.float32), 5126, 'VEC3', 34962, minmax=True)
    nor = acc(N.astype(np.float32), 5126, 'VEC3', 34962)
    uv = acc(UV.astype(np.float32), 5126, 'VEC2', 34962)
    cel = acc(np.clip(np.round(CELN * 127), -127, 127).astype(np.int8), 5120, 'VEC4', 34962, normalized=True)
    idx_t = np.uint16 if P.shape[0] < 65535 else np.uint32
    ind = acc(F.astype(idx_t).ravel(), 5123 if idx_t == np.uint16 else 5125, 'SCALAR', 34963)
    img = add(jpeg)
    gltf = dict(
        asset=dict(version='2.0', generator='Sky Tide tools/models/characters_prepare.py'),
        scene=0, scenes=[dict(nodes=[0])],
        nodes=[dict(name=name, mesh=0)],
        meshes=[dict(name=name, primitives=[dict(attributes=dict(POSITION=pos, NORMAL=nor, TEXCOORD_0=uv, _CELN=cel), indices=ind, material=0)])],
        materials=[dict(name=f'cel_{name}', pbrMetallicRoughness=dict(baseColorTexture=dict(index=0), metallicFactor=0.0, roughnessFactor=1.0))],
        textures=[dict(source=0, sampler=0)], samplers=[dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
        images=[dict(bufferView=img, mimeType='image/jpeg')],
        accessors=accs, bufferViews=views, buffers=[dict(byteLength=sum(len(c) for c in chunks))],
    )
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    bin_ = b''.join(chunks)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)


def debug_views(path, P, F, col, wf, wh):
    """The head from the front, the side and three quarters: the model's own colour (top) and
    the face (red) and hair (blue) found on it (bottom); triangles drawn nearest last."""
    H = P[:, 1].max()
    tri = F[(P[F, 1].min(1) > 0.8 * H)]
    S = 520
    lo = P[tri.ravel()].min(0); hi = P[tri.ravel()].max(0)
    mid = (lo + hi) / 2; span = max(hi - lo) * 1.05
    out = Image.new('RGB', (S * 3 + 20, S * 2 + 10), (255, 255, 255))
    for k, ang in enumerate([0, 90, 35]):
        t = np.radians(ang)
        R = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
        Q = (P - mid) @ R.T
        px = (Q[:, 0] / span + 0.5) * S; py = (0.5 - Q[:, 1] / span) * S
        order = np.argsort(Q[tri].mean(1)[:, 2])
        for row, paint in enumerate(['own', 'mask']):
            im = Image.new('RGB', (S, S), (40, 44, 52)); d = ImageDraw.Draw(im)
            for i in order:
                v = tri[i]
                c = col[v].mean(0)
                if paint == 'mask':
                    f, h = wf[v].mean(), wh[v].mean()
                    c = c * (1 - 0.75 * max(f, h)) + np.array([0.9, 0.15, 0.15]) * 0.75 * f + np.array([0.2, 0.35, 0.95]) * 0.75 * h
                d.polygon([(px[j], py[j]) for j in v], fill=tuple(int(x * 255) for x in np.clip(c, 0, 1)))
            out.paste(im, (k * (S + 10), row * (S + 10)))
    out.save(path)


def prepare(name, spec, debug=False):
    """The model as the game uses it, before rigging: positions, normals, UVs, shaped normals,
    triangles, the colour texture (JPEG bytes) and what was found on it."""
    P, N, UV, F, tex = load(os.path.join(ROOT, spec['source']))
    grp = weld(P)
    n = grp.max() + 1
    A = adjacency(F, grp, n)
    comp = components(A)
    tri_comp = comp[grp[F[:, 0]]]
    sizes = np.bincount(tri_comp)
    keep = sizes[tri_comp] >= FRAGMENT
    dropped = int((~keep).sum())
    F = F[keep]
    used = np.unique(F)
    remap = -np.ones(len(P), np.int64); remap[used] = np.arange(len(used))
    P, N, UV, F = P[used], N[used], UV[used], remap[F]
    # stand it at its height: feet on Y=0, centred, facing +Z
    lo, hi = P.min(0), P.max(0)
    s = spec['height'] / (hi[1] - lo[1])
    P = (P - np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])) * s
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    small = tex.resize((1024, 1024), Image.BOX)
    col = sample(small, UV)
    grp = weld(P)
    n = grp.max() + 1
    A = adjacency(F, grp, n)
    gout, gw, gf, gh, info = shape_normals(P, N, F, col, grp, A)
    CELN = np.concatenate([gout[grp], gw[grp][:, None]], 1)
    info.update(source=spec['source'], height_m=spec['height'], scale=round(float(s), 5), dropped_fragment_triangles=dropped)
    if debug:
        debug_views(os.path.join(ROOT, 'art', 'models', 'previews', f'{name}-face-mask.png'), P, F, col, gf[grp], gh[grp])
    return dict(P=P, N=N, UV=UV, F=F, CELN=CELN, tex=tex, col=col, info=info)


def jpeg(tex):
    bio = io.BytesIO()
    tex.resize((TEX, TEX), Image.LANCZOS).save(bio, 'JPEG', quality=88)
    return bio.getvalue()


def main():
    """Checks the preparation (and with --static writes the unrigged models; the game's models are
    written by characters_rig.py, which runs this first)."""
    debug = '--debug' in sys.argv
    for name, spec in CHARACTERS.items():
        M = prepare(name, spec, debug)
        info = M['info']
        info.update(vertices=int(len(M['P'])), triangles=int(len(M['F'])), texture_px=TEX)
        if '--static' in sys.argv:
            out = os.path.join(ROOT, 'assets', 'models', f'{name}.glb')
            write_glb(out, name, M['P'], M['N'], M['UV'], M['CELN'], M['F'], jpeg(M['tex']))
            info['bytes'] = os.path.getsize(out)
        os.makedirs(os.path.join(ROOT, 'art', 'models', 'production'), exist_ok=True)
        with open(os.path.join(ROOT, 'art', 'models', 'production', f'{name}-prepare.json'), 'w') as fh:
            json.dump(info, fh, indent=1)
        print(name, json.dumps(info))


if __name__ == '__main__':
    main()
