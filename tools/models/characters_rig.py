#!/usr/bin/env python3
"""Rig Tavi and Mara from scratch: a skeleton found from each model's own anatomy, skin weights,
and a skinned glTF for the game, which poses it itself (render/riderModel.js), reaching for the
same hip, chest, hand and foot targets it gives the placeholder rider.

    python3 tools/models/characters_rig.py [--debug]

Reads the prepared models (assets/models/<name>.glb, from characters_prepare.py) and writes them
back skinned. Python 3 with numpy, scipy, trimesh, shapely and Pillow; no Blender.

The skeleton (glTF frame: +Y up, the character facing +Z, its left toward +X; bones named _L for
the character's left):

    Hips ── Spine ── Chest ── Neck ── Head
     │                 ├── Shoulder_L ── UpperArm_L ── Forearm_L ── Hand_L
     │                 └── Shoulder_R ── ...
     ├── Thigh_L ── Shin_L ── Foot_L ── Toe_L
     └── Thigh_R ── ...

Joints come from horizontal sections of the model (where the legs part, where the arms hang
free, the centres of the limbs at the knee, elbow and wrist, the shoes) and the head and chin
found by characters_prepare.py, with ordinary human proportions where the clothes hide the body
(the hip joint above a baggy crotch, the shoulder inside a puffed sleeve). Every bone rests with
no rotation, so the game turns a bone simply by where its limb should point.
"""
import io
import json
import os
import struct
import sys

import numpy as np
import shapely.geometry as sg
import trimesh
from PIL import Image, ImageDraw
from scipy import sparse
from scipy.sparse import linalg as splinalg
from scipy.spatial import Delaunay

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import characters_prepare as cp  # noqa: E402

ROOT = cp.ROOT
NAMES = ['tavi', 'mara']
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')

BONES = [  # name, parent
    ('Hips', None), ('Spine', 'Hips'), ('Chest', 'Spine'), ('Neck', 'Chest'), ('Head', 'Neck'),
    ('Shoulder_L', 'Chest'), ('UpperArm_L', 'Shoulder_L'), ('Forearm_L', 'UpperArm_L'), ('Hand_L', 'Forearm_L'),
    ('Shoulder_R', 'Chest'), ('UpperArm_R', 'Shoulder_R'), ('Forearm_R', 'UpperArm_R'), ('Hand_R', 'Forearm_R'),
    ('Thigh_L', 'Hips'), ('Shin_L', 'Thigh_L'), ('Foot_L', 'Shin_L'), ('Toe_L', 'Foot_L'),
    ('Thigh_R', 'Hips'), ('Shin_R', 'Thigh_R'), ('Foot_R', 'Shin_R'), ('Toe_R', 'Foot_R'),
]
BI = {b: i for i, (b, _) in enumerate(BONES)}


def prepared(name):
    """The prepared model (characters_prepare.prepare), kept in tools/models/.cache between runs
    while its source and the preparation are unchanged."""
    spec = cp.CHARACTERS[name]
    src = os.path.join(ROOT, spec['source'])
    key = f"{os.path.getmtime(src):.0f}-{os.path.getmtime(cp.__file__):.0f}"
    path = os.path.join(CACHE, f'{name}-{key}.npz')
    if os.path.exists(path):
        z = np.load(path, allow_pickle=True)
        M = {k: z[k] for k in ['P', 'N', 'UV', 'F', 'CELN', 'col']}
        M['info'] = json.loads(str(z['info']))
        M['tex'] = Image.open(io.BytesIO(z['tex'].tobytes())).convert('RGB')
        return M
    M = cp.prepare(name, spec)
    os.makedirs(CACHE, exist_ok=True)
    for f in os.listdir(CACHE):
        if f.startswith(name + '-'):
            os.remove(os.path.join(CACHE, f))
    bio = io.BytesIO(); M['tex'].save(bio, 'PNG')
    np.savez(path, **{k: M[k] for k in ['P', 'N', 'UV', 'F', 'CELN', 'col']}, info=json.dumps(M['info']),
             tex=np.frombuffer(bio.getvalue(), np.uint8))
    return M


# ---- the anatomy ----------------------------------------------------------------------------

def sections(mesh, ys):
    """At each height, the outlines of the body: (centre x, centre z, width, depth, area, polygon)."""
    out = []
    for y in ys:
        sec = mesh.section(plane_origin=[0, y, 0], plane_normal=[0, 1, 0])
        polys = []
        if sec is not None:
            for ent in sec.discrete:
                if len(ent) < 4:
                    continue
                pg = sg.Polygon(ent[:, [0, 2]])
                if not pg.is_valid:
                    pg = pg.buffer(0)
                if pg.area < 2e-4:
                    continue
                c = pg.centroid
                bx = pg.bounds
                polys.append(dict(x=c.x, z=c.y, w=bx[2] - bx[0], d=bx[3] - bx[1], area=pg.area, x0=bx[0], x1=bx[2], z0=bx[1], z1=bx[3]))
        out.append(polys)
    return out


def outline_notches(poly, sgn, lo=0.08, hi=0.36, min_depth=0.006):
    """The arm's notches on one side of a body outline (shapely polygon, x and z): the deepest
    dents in the front and the back where an arm lies against the body, or None."""
    hull = poly.convex_hull.exterior
    pts = np.asarray(poly.exterior.coords)[:-1]
    zc = poly.centroid.y
    depth = np.array([hull.distance(sg.Point(p)) for p in pts])
    out = []
    for front in (True, False):
        sel = (sgn * pts[:, 0] > lo) & (sgn * pts[:, 0] < hi) & ((pts[:, 1] > zc) if front else (pts[:, 1] < zc))
        if not sel.any():
            return None
        i = np.flatnonzero(sel)[np.argmax(depth[sel])]
        if depth[i] < min_depth:
            return None
        out.append((pts[i], depth[i]))
    return out


def arm_tracks(mesh, H):
    """Each arm's centre, width and depth from where it hangs free of the body (the fingertips up to
    where it joins the body) and, above that, the part of the body outline beyond the arm's
    notches (an arm lying against the body)."""
    fr = np.arange(0.30, 0.86, 0.005)
    tracks = {1: [], -1: []}
    crease = {1: [], -1: []}
    for f in fr:
        sec = mesh.section(plane_origin=[0, f * H, 0], plane_normal=[0, 1, 0])
        if sec is None:
            continue
        polys = []
        for ent in sec.discrete:
            if len(ent) < 4:
                continue
            pg = sg.Polygon(ent[:, [0, 2]])
            if not pg.is_valid:
                pg = pg.buffer(0)
            if pg.geom_type != 'Polygon' or pg.area < 2e-4:
                continue
            polys.append(pg)
        for sgn in (1, -1):
            side = [p for p in polys if sgn * p.centroid.x > 0.03]
            body = [p for p in polys if p.bounds[0] < -0.02 and p.bounds[2] > 0.02]
            arm = None
            if body or len(side) >= 2:
                # free: the outermost outline on this side that is not the body (below the crotch,
                # with a leg beside it)
                cand = [p for p in side if not (p.bounds[0] < -0.02 and p.bounds[2] > 0.02)]
                if body or len(cand) >= 2:
                    cand = sorted(cand, key=lambda p: sgn * p.centroid.x)
                    if cand and (body or len(cand) >= 2):
                        p = cand[-1]
                        if not body and len(cand) < 2:
                            p = None
                        if p is not None and (body or sgn * p.centroid.x > sgn * cand[0].centroid.x + 0.06):
                            arm = ('free', p)
            if arm is None and body:
                big = max(body, key=lambda p: p.area)
                nt = outline_notches(big, sgn)
                if nt is not None:
                    (pf, df), (pb, db) = nt
                    # the part of the outline beyond the line through the notches
                    d = pb - pf
                    nrm = np.array([d[1], -d[0]]); nrm /= np.linalg.norm(nrm)
                    if nrm[0] * sgn < 0:
                        nrm = -nrm
                    far = sg.Point(pf + nrm * 1.0)
                    half = sg.Polygon([pf - d * 3, pb + d * 3, pb + d * 3 + nrm * 2, pf - d * 3 + nrm * 2])
                    lobe = big.intersection(half)
                    if lobe.area > 1e-4:
                        arm = ('lobe', lobe)
                        crease[sgn].append((f * H, pf, pb, min(df, db)))
            if arm is not None:
                kind, p = arm
                b = p.bounds
                tracks[sgn].append(dict(y=f * H, x=p.centroid.x, z=p.centroid.y, w=b[2] - b[0], d=b[3] - b[1], area=p.area, kind=kind))
    return tracks, crease


def skeleton(P, F, info):
    H = P[:, 1].max()
    mesh = trimesh.Trimesh(P, F, process=False)
    mesh.merge_vertices()
    fr = np.arange(0.01, 0.99, 0.005)
    S = sections(mesh, fr * H)

    def at(f):
        return S[int(np.argmin(np.abs(fr - f)))]

    def side(polys, sgn, lo, hi):
        c = [p for p in polys if lo <= sgn * p['x'] <= hi]
        return max(c, key=lambda p: p['area']) if c else None

    # where the legs part: the lowest height with one outline across the middle
    crotch = next(f * H for f, polys in zip(fr, S) if f > 0.3 and any(abs(p['x']) < 0.03 and p['w'] > 0.2 for p in polys))
    tracks, crease = arm_tracks(mesh, H)

    J = {}
    # ---- legs: the hip joint a little above the crotch (at least half the height), the knee and
    # the ankle in the middle of the leg at their usual heights, the ball of the foot and the toe
    # along the shoe
    hip_y = max(0.51 * H, crotch + 0.035 * H)
    for sgn, s in [(1, 'L'), (-1, 'R')]:
        top = side(at(crotch / H - 0.03), sgn, 0.03, 0.3)
        knee = side(at(0.285), sgn, 0.03, 0.3)
        shin = side(at(0.10), sgn, 0.03, 0.3)
        shoe = side(at(0.018), sgn, 0.03, 0.4)
        J[f'Thigh_{s}'] = np.array([sgn * 0.8 * abs(top['x']), hip_y, top['z']])
        J[f'Shin_{s}'] = np.array([knee['x'], 0.285 * H, knee['z']])
        J[f'Foot_{s}'] = np.array([shin['x'], 0.045 * H, shoe['z0'] + 0.3 * (shoe['z1'] - shoe['z0'])])
        J[f'Toe_{s}'] = np.array([shoe['x'], 0.018 * H, shoe['z0'] + 0.72 * (shoe['z1'] - shoe['z0'])])
        J[f'Toe_{s}_end'] = np.array([shoe['x'], 0.018 * H, shoe['z1'] - 0.01])
        J[f'Sole_{s}'] = np.array([shoe['x'], 0.0, (shoe['z0'] + shoe['z1']) / 2])     # (the middle of the sole)

    # ---- arms
    arm = {}
    for sgn, s in [(1, 'L'), (-1, 'R')]:
        T = tracks[sgn]
        Y = np.array([t['y'] for t in T]); X = np.array([t['x'] for t in T]); Z = np.array([t['z'] for t in T])
        A = np.array([t['area'] for t in T]); free = np.array([t['kind'] == 'free' for t in T])
        tip = Y.min()
        # the wrist: the narrowest of the arm a hand's length above the fingertips
        sel = (Y > tip + 0.07 * H) & (Y < tip + 0.17 * H) & free
        wrist_y = Y[sel][np.argmin(A[sel])] if sel.any() else tip + 0.11 * H
        top_free = Y[free].max()
        arm[sgn] = dict(Y=Y, X=X, Z=Z, A=A, free=free, tip=tip, wrist=wrist_y, top_free=top_free)
    # the shoulder joint: under the top of the shoulder, inside the sleeve
    def surface_top(x, z):
        near = (np.abs(P[:, 0] - x) < 0.02) & (np.abs(P[:, 2] - z) < 0.05) & (P[:, 1] < info['chin_m'])
        return P[near, 1].max()

    sym = lambda a, b: (abs(a) + abs(b)) / 2
    tip = sym(arm[1]['tip'], arm[-1]['tip']); wrist_y = sym(arm[1]['wrist'], arm[-1]['wrist'])
    for sgn in (1, -1):
        a = arm[sgn]
        # the arm's line: through the centres of the arm from the wrist up (free and lying
        # against the body), fitted straight for the forearm and for the upper arm
        Y, X, Z = a['Y'], a['X'], a['Z']
        fa = (Y > wrist_y + 0.02 * H) & (Y < wrist_y + 0.11 * H)
        a['fx'] = np.polyfit(Y[fa], X[fa], 1); a['fz'] = np.polyfit(Y[fa], Z[fa], 1)
        ua = (Y > wrist_y + 0.15 * H)
        a['ux'] = np.polyfit(Y[ua], X[ua], 1) if ua.sum() >= 4 else a['fx']
        a['uz'] = np.polyfit(Y[ua], Z[ua], 1) if ua.sum() >= 4 else a['fz']
        a['top'] = Y.max()
    sh_x = sym(*[np.polyval(arm[s]['ux'], 0.79 * H) for s in (1, -1)])
    sh_z = np.mean([np.polyval(arm[s]['uz'], 0.79 * H) for s in (1, -1)])
    top = max(surface_top(sh_x, sh_z), surface_top(-sh_x, sh_z))
    sh_y = top - 0.035 * H
    sh_x = sym(*[np.polyval(arm[s]['ux'], sh_y) for s in (1, -1)])
    elbow_y = wrist_y + 0.44 * (sh_y - wrist_y)
    hand_end = tip + 0.015 * H
    for sgn, s in [(1, 'L'), (-1, 'R')]:
        a = arm[sgn]
        ex = sym(np.polyval(arm[1]['fx'], elbow_y), np.polyval(arm[-1]['fx'], elbow_y))
        wx = sym(np.polyval(arm[1]['fx'], wrist_y), np.polyval(arm[-1]['fx'], wrist_y))
        ez = np.mean([np.polyval(arm[k]['fz'], elbow_y) for k in (1, -1)])
        wz = np.mean([np.polyval(arm[k]['fz'], wrist_y) for k in (1, -1)])
        hx = sym(*[arm[k]['X'][np.argmin(np.abs(arm[k]['Y'] - (tip + 0.04 * H)))] for k in (1, -1)])
        hz = np.mean([arm[k]['Z'][np.argmin(np.abs(arm[k]['Y'] - (tip + 0.04 * H)))] for k in (1, -1)])
        J[f'Shoulder_{s}'] = np.array([sgn * 0.02 * H, sh_y + 0.012 * H, sh_z])
        J[f'UpperArm_{s}'] = np.array([sgn * sh_x, sh_y, sh_z])
        J[f'Forearm_{s}'] = np.array([sgn * ex, elbow_y, ez])
        J[f'Hand_{s}'] = np.array([sgn * wx, wrist_y, wz])
        J[f'Hand_{s}_end'] = np.array([sgn * hx, hand_end, hz])

    # ---- spine: through the middle of the body, a little toward the back
    def mid(y):
        p = min(at(y / H), key=lambda p: abs(p['x']))
        return p['z'] - 0.15 * p['d']
    chin = info['chin_m']
    hc = info['head_center_m']
    J['Hips'] = np.array([0.0, hip_y, mid(hip_y)])
    J['Spine'] = np.array([0.0, 0.60 * H, mid(0.60 * H)])
    J['Chest'] = np.array([0.0, 0.71 * H, mid(0.71 * H)])
    J['Neck'] = np.array([0.0, sh_y + 0.02 * H, mid(sh_y + 0.02 * H)])
    neck = min(at((chin - 0.015 * H) / H), key=lambda p: abs(p['x']))
    J['Head'] = np.array([0.0, chin + 0.012 * H, neck['z'] - 0.1 * neck['d']])
    J['Head_end'] = np.array([0.0, H, hc[2]])
    # symmetric legs too
    for b in ['Thigh', 'Shin', 'Foot', 'Toe', 'Toe_end', 'Sole']:
        l, r = J[f'{b}_L' if b != 'Toe_end' else 'Toe_L_end'], J[f'{b}_R' if b != 'Toe_end' else 'Toe_R_end']
        x = sym(l[0], r[0]); y = (l[1] + r[1]) / 2; z = (l[2] + r[2]) / 2
        l[:] = [x, y, z]; r[:] = [-x, y, z]
    # the underarm creases (where an arm lies against the body), to be cut
    cr = {s: crease[sgn] for sgn, s in [(1, 'L'), (-1, 'R')]}
    landmarks = dict(height=H, crotch=crotch, hip=hip_y, fingertips=tip, wrist=wrist_y, elbow=elbow_y, shoulder=sh_y,
                     arm_free_top=sym(arm[1]['top_free'], arm[-1]['top_free']), chin=chin)
    return J, landmarks, cr


# ---- the underarms ----------------------------------------------------------------------------

def weld_groups(P):
    return cp.weld(P)


def group_positions(P, grp):
    n = grp.max() + 1
    g = np.zeros((n, 3)); np.add.at(g, grp, P)
    return g / np.bincount(grp, minlength=n)[:, None]


def boundary_edges(FG):
    e = np.concatenate([FG[:, [0, 1]], FG[:, [1, 2]], FG[:, [2, 0]]])
    k = np.sort(e, 1)
    u, inv, cnt = np.unique(k, axis=0, return_inverse=True, return_counts=True)
    one = cnt[inv.ravel()] == 1
    return e[one]


def cotan_laplacian(V, T):
    """The cotangent Laplacian (positive semi-definite) and lumped areas of a triangle mesh."""
    n = len(V)
    I, Jx, W = [], [], []
    area = np.zeros(n)
    for a, b, c in [(0, 1, 2), (1, 2, 0), (2, 0, 1)]:
        u = V[T[:, a]] - V[T[:, c]]; v = V[T[:, b]] - V[T[:, c]]
        cr = np.cross(u, v) if V.shape[1] == 3 else (u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0])
        crn = np.linalg.norm(cr, axis=1) if cr.ndim > 1 else np.abs(cr)
        cot = (u * v).sum(1) / np.maximum(crn, 1e-12)
        I += [T[:, a], T[:, b]]; Jx += [T[:, b], T[:, a]]; W += [0.5 * cot, 0.5 * cot]
        np.add.at(area, T[:, a], crn / 6)
    I = np.concatenate(I); Jx = np.concatenate(Jx); W = np.concatenate(W)
    Wm = sparse.coo_matrix((W, (I, Jx)), shape=(n, n)).tocsr()
    L = sparse.diags(np.asarray(Wm.sum(1)).ravel()) - Wm
    return L, area


def fill_patch(loop3, inner_spacing):
    """Triangulate the inside of a closed loop of 3D points that lies roughly in a plane: a grid
    of points inside it, Delaunay, the boundary kept as given. Returns (2D points, triangles,
    number of boundary points, the plane's frame)."""
    c = loop3.mean(0)
    _, _, vt = np.linalg.svd(loop3 - c)
    e1, e2, e3 = vt
    q = np.stack([(loop3 - c) @ e1, (loop3 - c) @ e2], 1)
    poly = sg.Polygon(q)
    if not poly.is_valid:
        poly = poly.buffer(0)
    h = inner_spacing
    xs = np.arange(q[:, 0].min(), q[:, 0].max(), h); ys = np.arange(q[:, 1].min(), q[:, 1].max(), h * 0.87)
    pts = []
    for j, y in enumerate(ys):
        for x in xs + (h / 2 if j % 2 else 0):
            pt = sg.Point(x, y)
            if poly.contains(pt) and poly.exterior.distance(pt) > 0.6 * h:
                pts.append((x, y))
    allq = np.concatenate([q, np.array(pts).reshape(-1, 2)])
    tri = Delaunay(allq).simplices
    cen = allq[tri].mean(1)
    keep = np.array([poly.contains(sg.Point(p)) for p in cen])
    tri = tri[keep]
    # every edge of the loop must be in the triangulation (else the patch would leave a gap)
    nb = len(q)
    have = set(map(tuple, np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), 1)))
    missing = [(i, (i + 1) % nb) for i in range(nb) if tuple(sorted((i, (i + 1) % nb))) not in have]
    return allq, tri, nb, (c, e1, e2, e3), missing


def face_adjacency(FG):
    """Pairs of faces sharing an edge, and the shared edge's two groups."""
    e = np.concatenate([FG[:, [0, 1]], FG[:, [1, 2]], FG[:, [2, 0]]])
    fid = np.tile(np.arange(len(FG)), 3)
    key = np.sort(e, 1)
    order = np.lexsort((key[:, 1], key[:, 0]))
    ks = key[order]
    same = np.all(ks[1:] == ks[:-1], 1)
    return fid[order][:-1][same], fid[order][1:][same], ks[:-1][same]


def split_faces(gP, FG, ys, PF, PB, sgn, y0, y1):
    """Which faces near an arm's crease are the arm's and which the body's: the faces clearly
    on either side of the line through the notches seed the two sides, and between them the
    split follows the cheapest way round, along the fold itself (a minimum cut where concave
    edges cost little)."""
    from scipy.sparse.csgraph import maximum_flow, breadth_first_order
    D = PB - PF
    ln = np.linalg.norm(D, axis=1)
    good = ln > 0.03
    # (where the notches meet, under the arm, the line takes the direction found just above)
    Dg = D / np.maximum(ln, 1e-9)[:, None]
    for i in range(len(D)):
        if not good[i]:
            j = np.flatnonzero(good)[np.argmin(np.abs(np.flatnonzero(good) - i))]
            Dg[i] = Dg[j]
    cen = gP[FG].mean(1)
    yc = np.clip(cen[:, 1], ys[0], ys[-1])
    pf = np.stack([np.interp(yc, ys, PF[:, 0]), np.interp(yc, ys, PF[:, 1])], 1)
    dx = np.interp(yc, ys, Dg[:, 0]); dz = np.interp(yc, ys, Dg[:, 1])
    dd = np.stack([dx, dz], 1); dd /= np.linalg.norm(dd, axis=1, keepdims=True)
    nrm = np.stack([dd[:, 1], -dd[:, 0]], 1)
    nrm[sgn * nrm[:, 0] < 0] *= -1
    rel = cen[:, [0, 2]] - pf
    sd = (rel * nrm).sum(1)
    t = (rel * dd).sum(1)
    seglen = np.interp(yc, ys, np.maximum(ln, 0.0))
    near = (np.abs(sd) < 0.07) & (t > -0.05) & (t < seglen + 0.05)
    zone = (cen[:, 1] > y0) & (cen[:, 1] < y1) & (sgn * cen[:, 0] > 0.04) & near
    zi = np.flatnonzero(zone)
    nz = len(zi)
    pos = -np.ones(len(FG), np.int64); pos[zi] = np.arange(nz)
    fa, fb, eg = face_adjacency(FG)
    m = zone[fa] & zone[fb]
    fa, fb, eg = fa[m], fb[m], eg[m]
    # cost of cutting between two faces: the shared edge's length, much less where it folds inward
    def fnormal(f):
        a, b, c = gP[FG[f, 0]], gP[FG[f, 1]], gP[FG[f, 2]]
        n = np.cross(b - a, c - a)
        return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    na, nb_ = fnormal(fa), fnormal(fb)
    conc = ((cen[fb] - cen[fa]) * na).sum(1) > 0
    ang = np.arccos(np.clip((na * nb_).sum(1), -1, 1))
    elen = np.linalg.norm(gP[eg[:, 0]] - gP[eg[:, 1]], axis=1)
    cost = elen * np.where(conc, np.exp(-5 * ang), 1.0 + ang)
    cap = np.maximum(1, np.round(cost * 1e5)).astype(np.int32)
    # seeds: clearly on one side, or on the zone's edge away from the crease's ends
    edge_face = np.zeros(len(FG), bool)
    fa_all, fb_all, _ = face_adjacency(FG)
    edge_face[fa_all[zone[fa_all] & ~zone[fb_all]]] = True
    edge_face[fb_all[zone[fb_all] & ~zone[fa_all]]] = True
    side_edge = edge_face & ((np.abs(sd) > 0.05) | (t < -0.03) | (t > seglen + 0.03))
    arm_seed = zone & ((sd > 0.035) | (side_edge & (sd > 0)))
    tor_seed = zone & ((sd < -0.035) | (side_edge & (sd <= 0)))
    S, T = nz, nz + 1
    big = np.int32(2 ** 30)
    rows = np.concatenate([pos[fa], pos[fb], np.full(arm_seed.sum(), S), pos[tor_seed]])
    cols = np.concatenate([pos[fb], pos[fa], pos[arm_seed], np.full(tor_seed.sum(), T)])
    caps = np.concatenate([cap, cap, np.full(arm_seed.sum(), big), np.full(tor_seed.sum(), big)]).astype(np.int32)
    G = sparse.csr_matrix((caps, (rows, cols)), shape=(nz + 2, nz + 2))
    G.sum_duplicates()
    flow = maximum_flow(G, S, T).flow
    resid = (G - flow).tocsr()
    resid.data[resid.data < 0] = 0
    resid.eliminate_zeros()
    reach = breadth_first_order(resid, S, directed=True, return_predecessors=False)
    lab = np.zeros(nz + 2, bool); lab[reach] = True
    armF = np.zeros(len(FG), bool); armF[zi] = lab[:nz]
    # no islands: each side keeps only its largest piece (counting the faces beyond the zone
    # it joins on to), the rest going to the other side
    from scipy.sparse.csgraph import connected_components
    for _ in range(2):
        for side in (True, False):
            mask = zone & (armF == side)
            mm = mask[fa_all] & mask[fb_all]
            Gf = sparse.coo_matrix((np.ones(mm.sum()), (fa_all[mm], fb_all[mm])), shape=(len(FG), len(FG))).tocsr()
            _, comp = connected_components(Gf, directed=False)
            cs = comp[mask]
            if len(cs) == 0:
                continue
            big_c = np.bincount(cs).argmax()
            stray = mask & (comp != big_c)
            armF[stray] = not side
    torF = zone & ~armF
    return armF, torF, zone


def cut_underarms(M, crease, H, report):
    """Where an arm lies against the body below the armpit (Tavi's puffed sleeves against his
    jacket), the delivered surface runs straight from the arm onto the body: raising the arm
    would stretch it into a web. Cut it along the creases (the notches between the arm and the
    body, front and back, and under the arm), and close each side with a new surface that the
    two hid between them: the inside of the arm, rounded like it, and the side of the body.
    At rest both lie inside the model, so it looks as delivered; raised, the arm comes away
    clean. They are painted the colour of the clothes beside them (a spot added in a free part
    of the texture)."""
    P, N, UV, CELN, F = [M[k].copy() for k in ['P', 'N', 'UV', 'CELN', 'F']]
    tex = M['tex'].copy()
    grp = weld_groups(P)
    ng = grp.max() + 1
    gP = group_positions(P, grp)
    forced = {}          # group -> 'L'/'R' arm or 'T' body (for the weights)
    patch_tris = []
    spots = {}           # the new surfaces' colours in the texture (arm, body)
    ax_y = {}
    for sgn, s in [(1, 'L'), (-1, 'R')]:
        run = []
        for c in crease[s]:
            if run and c[0] - run[-1][0] > 0.012:
                break
            if c[3] < 0.01:
                break
            run.append(c)
        if len(run) < 4:
            continue
        ys = np.array([c[0] for c in run]); PF = np.array([c[1] for c in run]); PB = np.array([c[2] for c in run])
        y0, y1 = ys[0] - 0.03, ys[-1]
        ax_y[s] = y1
        FG = grp[F]
        armF, torF, zone = split_faces(gP, FG, ys, PF, PB, sgn, y0, y1)
        cA = np.bincount(FG[armF].ravel(), minlength=ng)
        cT = np.bincount(FG[torF].ravel(), minlength=ng)
        cU = np.bincount(FG[~zone].ravel(), minlength=ng)
        dup = (cA > 0) & (cT > 0) & (cU == 0)
        # copies of the crease's vertices for the arm's faces
        dv = np.flatnonzero(dup[grp])
        newidx = np.arange(len(P), len(P) + len(dv))
        remap = np.arange(len(P)); remap[dv] = newidx
        P = np.concatenate([P, P[dv]]); N = np.concatenate([N, N[dv]]); UV = np.concatenate([UV, UV[dv]]); CELN = np.concatenate([CELN, CELN[dv]])
        newgrp_of = {}
        add_g = []
        for v in dv:
            g = grp[v]
            if g not in newgrp_of:
                newgrp_of[g] = ng + len(newgrp_of)
            add_g.append(newgrp_of[g])
        grp = np.concatenate([grp, np.array(add_g, np.int64)])
        F = F.copy(); F[armF] = remap[F[armF]]
        ng = grp.max() + 1
        gP = group_positions(P, grp)
        for g in np.unique(grp[F[armF]].ravel()):
            forced[g] = s
        for g in np.unique(grp[F[torF]].ravel()):
            if g not in forced:
                forced[g] = 'T'
        # the slit's edge: one loop, down the arm's side of the crease and back up the body's
        FG = grp[F]
        be = boundary_edges(FG)
        be = be[(gP[be[:, 0], 1] < y1 + 0.05) & (sgn * gP[be[:, 0], 0] > 0.03)]
        armset = set(np.unique(grp[F[armF]].ravel()))
        nxt = {}
        for a_, b_ in be:
            nxt.setdefault(a_, []).append(b_)
        # walk the loop
        start = be[0, 0]
        loop = [start]
        cur = start
        while True:
            nx = nxt.get(cur, [])
            if len(nx) != 1:
                break
            cur = nx[0]
            if cur == start:
                break
            loop.append(cur)
        ok = cur == start and len(loop) == len(be)
        newg = set(newgrp_of.values())
        # the two ends: the loop's points that are on both sides (not copied)
        ends = [i for i, g in enumerate(loop) if g not in newg and g not in {k for k in newgrp_of}]
        report[f'cut_{s}'] = dict(y=[round(float(y0), 3), round(float(y1), 3)], copied=int(len(newgrp_of)), loop=len(loop), closed=bool(ok), ends=len(ends))
        if not ok or len(ends) != 2:
            print(f'   cut {s}: the slit is not one clean loop ({len(loop)} of {len(be)} edges, {len(ends)} ends); leaving it', file=sys.stderr)
            continue
        i0, i1 = ends
        Lp = loop[i0:i1 + 1]; Rp = loop[i1:] + loop[:i0 + 1]
        # which half is the arm's (its copies)
        arm_path = Lp if sum(g in newg for g in Lp) > sum(g in newg for g in Rp) else Rp
        tor_path = Rp if arm_path is Lp else Lp
        if gP[arm_path[0], 2] < gP[arm_path[-1], 2]:
            arm_path = arm_path[::-1]
        if gP[tor_path[0], 2] < gP[tor_path[-1], 2]:
            tor_path = tor_path[::-1]
        # (both now run from the front end to the back end; the arm's copies sit on the body's points)
        if len(arm_path) != len(tor_path) or np.abs(gP[arm_path] - gP[tor_path]).max() > 1e-6:
            print(f'   cut {s}: the two sides of the slit do not match; leaving it open', file=sys.stderr)
            continue
        Ef, Eb = gP[arm_path[0]], gP[arm_path[-1]]
        el = np.median(np.linalg.norm(np.diff(gP[arm_path], axis=0), axis=1))
        nch = max(2, int(np.linalg.norm(Ef - Eb) / max(el, 0.004)))
        chord = [Eb + (Ef - Eb) * k / nch for k in range(1, nch)]
        loop3 = np.concatenate([gP[arm_path], np.array(chord)])
        q, tri, nb, (c, e1, e2, e3), missing = fill_patch(loop3, inner_spacing=max(el, 0.006) * 1.1)
        if missing:
            print(f'   cut {s}: {len(missing)} loop edges missing from the fill', file=sys.stderr)
        report[f'cut_{s}'].update(fill_points=int(len(q)), fill_triangles=int(len(tri)), missing=len(missing))
        # the flat fill, then bulged: harmonic inside the loop, plus a round profile
        L2, area = cotan_laplacian(q, tri)
        nq = len(q)
        inner = np.arange(nb, nq)
        base = np.zeros((nq, 3)); base[:nb] = loop3
        if len(inner):
            Lii = L2[inner][:, inner].tocsc(); Lib = L2[inner][:, :nb]
            base[inner] = splinalg.spsolve(Lii, -(Lib @ loop3))
            phi = np.zeros(nq)
            phi[inner] = splinalg.spsolve(Lii, area[inner])
        else:
            phi = np.zeros(nq)
        bump = np.sqrt(2 * np.maximum(phi, 0))
        to_body = e3 if e3[0] * sgn < 0 else -e3
        # the colour of the clothes on each side of the crease: the lighter half of what is painted
        # there (the delivered texture paints the fold itself dark, as shadow)
        def clothes(faces):
            vv = np.unique(F[faces].ravel()); vv = vv[vv < len(M['col'])]
            cc = M['col'][vv]; lum = cc @ LUM
            return np.median(cc[lum >= np.median(lum)], 0)
        side_col = {'arm': clothes(armF), 'body': clothes(torF)}
        # that shadow paint would show along a raised arm: lift it to the clothes' colour near
        # the cut, on the arm (and on the body where the cut runs well below the armpit)
        tex = clean_fold_paint(tex, P, UV, F, grp, arm_path + tor_path, armF, torF, side_col, H)
        for k in ('arm', 'body'):
            if k not in spots:
                spots[k], tex = paint_spot(tex, UV, F, side_col[k] * 0.92, avoid=list(spots.values()))
        for which, path, amt, dirn in [('arm', arm_path, 0.85, to_body), ('body', tor_path, 0.3, -to_body)]:
            V = base + (amt * bump)[:, None] * dirn
            V[:nb] = loop3
            base_i = len(P)
            P = np.concatenate([P, V])
            UV = np.concatenate([UV, np.tile(spots[which], (nq, 1))])
            CELN = np.concatenate([CELN, np.zeros((nq, 4))])
            # groups: the loop's points join the crease's groups, the chord's are shared by both pieces
            gq = np.empty(nq, np.int64)
            gq[:len(path)] = path
            if which == 'arm':
                chord_g = np.arange(ng, ng + (nb - len(path)))
                inner_arm = np.arange(ng + len(chord_g), ng + len(chord_g) + len(inner))
                ng += len(chord_g) + len(inner)
                gq[len(path):nb] = chord_g; gq[nb:] = inner_arm
            else:
                gq[len(path):nb] = chord_g
                inner_body = np.arange(ng, ng + len(inner)); ng += len(inner)
                gq[nb:] = inner_body
            grp = np.concatenate([grp, gq])
            T = tri + base_i
            # face outward: the arm's piece toward the body, the body's toward the arm
            fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
            if (fn @ dirn).sum() < 0:
                T = T[:, [0, 2, 1]]
            vn = np.zeros((nq, 3))
            fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
            for k in range(3):
                np.add.at(vn, T[:, k] - base_i, fn)
            vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
            N = np.concatenate([N, vn])
            F = np.concatenate([F, T])
            patch_tris.append((which, s, T))
            for g in gq[nb:]:
                forced[g] = s if which == 'arm' else 'T'
            for g in gq[len(path):nb]:
                forced[g] = 'chord_' + s
        gP = group_positions(P, grp)
    return dict(P=P, N=N, UV=UV, CELN=CELN, F=F, grp=grp, forced=forced, tex=tex, axilla=ax_y, patches=patch_tris)


LUM = np.array([0.3, 0.59, 0.11])


def paint_spot(tex, UV, F, colour, avoid=()):
    """A spot of one colour in the emptiest part of the texture (away from the UVs in use and
    from the spots in avoid); returns its UV and the texture."""
    from scipy import ndimage
    R = 256
    im = Image.new('L', (R, R), 0); d = ImageDraw.Draw(im)
    for f in F:
        d.polygon([(UV[i, 0] * R, UV[i, 1] * R) for i in f], fill=255)
    for a in avoid:
        d.ellipse([a[0] * R - 6, a[1] * R - 6, a[0] * R + 6, a[1] * R + 6], fill=255)
    used = np.asarray(im) > 0
    dist = ndimage.distance_transform_edt(~used)
    y, x = np.unravel_index(np.argmax(dist), dist.shape)
    rad = min(dist[y, x], 5)
    uv = np.array([(x + 0.5) / R, (y + 0.5) / R])
    t = tex.copy(); W, Hh = t.size
    dd = ImageDraw.Draw(t)
    r = rad / R * W * 0.9
    cx, cy = uv[0] * W, uv[1] * Hh
    dd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=tuple(int(v * 255) for v in np.clip(colour, 0, 1)))
    return uv, t


def clean_fold_paint(tex, P, UV, F, grp, seeds, armF, torF, side_col, H, radius=0.03):
    """Lift the dark paint of a fold toward the clothes' colour within radius of the cut: on the
    arm's side always, on the body's where the cut is below 0.7 of the height (a natural armpit
    keeps its painted shading)."""
    from scipy.sparse.csgraph import dijkstra
    ng = grp.max() + 1
    gP = group_positions(P, grp)
    FG = grp[F]
    e = np.concatenate([FG[:, [0, 1]], FG[:, [1, 2]], FG[:, [2, 0]]])
    w = np.linalg.norm(gP[e[:, 0]] - gP[e[:, 1]], axis=1) + 1e-9
    G = sparse.coo_matrix((w, (e[:, 0], e[:, 1])), shape=(ng, ng)).tocsr()
    G = G.maximum(G.T)
    dist = dijkstra(G, indices=np.unique(seeds), min_only=True, limit=radius * 1.5)
    near = (dist[FG] < radius).all(1)
    low = gP[FG].mean(1)[:, 1] < 0.7 * H
    arr = np.asarray(tex).astype(np.float32) / 255
    Wt, Ht = tex.size
    for faces, col in [(near & armF, side_col['arm']), (near & torF & low, side_col['body'])]:
        if not faces.any():
            continue
        mask = Image.new('L', (Wt, Ht), 0); d = ImageDraw.Draw(mask)
        for f in F[faces]:
            d.polygon([(UV[i, 0] * Wt, UV[i, 1] * Ht) for i in f], fill=255)
        m = np.asarray(mask) > 0
        cl = float(col @ LUM)
        lum = arr[..., :3] @ LUM
        k = np.clip((0.78 * cl - lum) / (0.3 * cl), 0, 1) * m
        arr[..., :3] = arr[..., :3] * (1 - k[..., None]) + col[None, None, :] * k[..., None]
    return Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8))


# ---- skin weights -------------------------------------------------------------------------------

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def polyline_param(X, pts):
    """For each point, the parameter of the nearest point on the polyline pts (0 at the first
    point, 1 at the second, ...)."""
    best = np.full(len(X), np.inf); par = np.zeros(len(X))
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        t = np.clip(((X - a) @ ab) / (ab @ ab), 0, 1)
        dd = np.linalg.norm(X - (a + t[:, None] * ab), axis=1)
        m = dd < best
        best[m] = dd[m]; par[m] = i + t[m]
    return par, best


def skin_weights(R, J, lm, H):
    """Per vertex, up to four bones and their weights.

    Each arm (below its armpit, the part of the surface joined to the hand; above, beyond a
    plane through the shoulder joint, blended across it) goes to the arm's bones, shared
    between them across the elbow and the wrist. The rest goes to the legs (below the hips,
    blended over the hip joint, left and right across the middle; the knee, the ankle and
    the ball of the foot as blends by height and length) and to the body's chain by height
    (hips, spine, chest, neck, head; the face and hair wholly the head's), with the top of each
    shoulder on its shoulder bone. Then smoothed over the surface a little (never across a
    cut), and kept to the four largest."""
    P, F, grp, forced = R['P'], R['F'], R['grp'], R['forced']
    ng = grp.max() + 1
    gP = group_positions(P, grp)
    A = cp.adjacency(F, grp, ng)
    celw = np.zeros(ng); np.maximum.at(celw, grp, R['CELN'][:, 3])
    W = np.zeros((ng, len(BONES)))
    y = gP[:, 1]; x = gP[:, 0]; z = gP[:, 2]
    u = H / 1.8          # (blend widths scale with the height)
    w_arm = {}
    report_arm = R.setdefault('arm_free', {})
    for sgn, s in [(1, 'L'), (-1, 'R')]:
        ya = R['axilla'].get(s, lm['arm_free_top'])
        fl = np.array([forced.get(g, '') for g in range(ng)], dtype=object)

        def arm_piece(top):
            """The surface joined to this hand below the height top (None if that reaches the
            body)."""
            below = (y < top) & (fl != 'T') & (fl != 'chord_' + s) & (sgn * x > 0.02)
            idx = np.flatnonzero(below)
            comp = cp.components(A[below][:, below])
            h = np.argmin(np.linalg.norm(gP[idx] - J[f'Hand_{s}_end'], axis=1))
            piece = np.zeros(ng, bool); piece[idx[comp == comp[h]]] = True
            if (gP[piece, 1] < lm['fingertips'] - 0.02).any() or piece.sum() > 0.2 * ng:
                return None
            return piece
        # the arm hangs free (or is cut free) up to some height under the armpit: the highest at
        # which the surface joined to the hand is still only the arm
        lo, hi = lm['arm_free_top'] - 0.02 * u, ya
        armc = arm_piece(lo)
        if armc is None:
            raise RuntimeError(f'arm {s}: not free of the body even below {lo:.3f} m')
        for _ in range(8):
            mid_ = (lo + hi) / 2
            pc = arm_piece(mid_)
            if pc is None:
                hi = mid_
            else:
                lo, armc = mid_, pc
        ya = lo
        report_arm[s] = round(float(ya), 3)
        # above: beyond a plane through the shoulder joint, tilted along the armpit
        n = np.array([sgn, -0.25, 0.0]); n /= np.linalg.norm(n)
        t = (gP - J[f'UpperArm_{s}']) @ n
        plane = smoothstep(-0.03 * u, 0.03 * u, t + 0.005 * u)
        wa = np.where(y < ya, armc.astype(float), plane)
        for g, f in forced.items():
            if f == s:
                wa[g] = 1.0
            elif f == 'chord_' + s:
                wa[g] = 0.5
            elif f == 'T' and sgn * x[g] > 0:
                wa[g] = 0.0
        w_arm[s] = wa
        # along the arm
        pts = np.array([J[f'UpperArm_{s}'], J[f'Forearm_{s}'], J[f'Hand_{s}'], J[f'Hand_{s}_end']])
        par, _ = polyline_param(gP, pts)
        l1 = np.linalg.norm(pts[1] - pts[0]); l2 = np.linalg.norm(pts[2] - pts[1])
        fore = smoothstep(1 - 0.045 * u / l1, 1 + 0.045 * u / l2, par)
        hand = smoothstep(2 - 0.02 * u / l2, 2 + 0.015 * u / np.linalg.norm(pts[3] - pts[2]), par)
        W[:, BI[f'UpperArm_{s}']] += wa * (1 - fore)
        W[:, BI[f'Forearm_{s}']] += wa * (fore - hand)
        W[:, BI[f'Hand_{s}']] += wa * hand
    rest = 1 - np.clip(w_arm['L'] + w_arm['R'], 0, 1)
    # legs
    leg = 1 - smoothstep(lm['crotch'] - 0.02 * u, lm['hip'] + 0.025 * u, y)
    for sgn, s in [(1, 'L'), (-1, 'R')]:
        side = smoothstep(-0.02 * u, 0.02 * u, sgn * x)
        wl = rest * leg * side
        knee = J[f'Shin_{s}'][1]; ank = J[f'Foot_{s}'][1]; ball = J[f'Toe_{s}'][2]
        shin = 1 - smoothstep(knee - 0.045 * u, knee + 0.045 * u, y)
        foot = 1 - smoothstep(ank - 0.012 * u, ank + 0.03 * u, y)
        toe = smoothstep(ball - 0.015 * u, ball + 0.02 * u, z) * foot
        W[:, BI[f'Thigh_{s}']] += wl * (1 - shin)
        W[:, BI[f'Shin_{s}']] += wl * (shin - foot)
        W[:, BI[f'Foot_{s}']] += wl * (foot - toe)
        W[:, BI[f'Toe_{s}']] += wl * toe
    body = rest * (1 - leg)
    # the body's chain, by height
    ys = [J['Spine'][1], J['Chest'][1], J['Neck'][1], J['Head'][1]]
    hw = [0.045 * u, 0.05 * u, 0.025 * u, 0.015 * u]
    up = [smoothstep(a - w, a + w, y) for a, w in zip(ys, hw)]
    head = np.maximum(up[3], (celw > 0.05).astype(float))
    chain = [1 - up[0], up[0] - up[1], up[1] - up[2], up[2] - head, head]
    chain = [np.clip(c, 0, 1) for c in chain]
    # the top of each shoulder rides on its shoulder bone
    for sgn, s in [(1, 'L'), (-1, 'R')]:
        sh = smoothstep(0.045 * u, 0.11 * u, sgn * x) * smoothstep(J['Chest'][1] + 0.03 * u, J[f'UpperArm_{s}'][1] - 0.01 * u, y) * (1 - head)
        W[:, BI[f'Shoulder_{s}']] += body * chain[2] * sh
        chain[2] = chain[2] * (1 - sh)
    for b, c in zip(['Hips', 'Spine', 'Chest', 'Neck', 'Head'], chain):
        W[:, BI[b]] += body * c
    # (the shoulder bones' share came out of the chest's)
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    # smooth a little over the surface (never across a cut: its sides are not joined)
    W = cp.blur(A, W, 6)
    # the four largest
    order = np.argsort(-W, 1)[:, :4]
    top = np.take_along_axis(W, order, 1)
    top[top < 0.01] = 0
    top /= np.maximum(top.sum(1, keepdims=True), 1e-9)
    return order[grp], top[grp], W


# ---- posing (the same as the game's, for the previews) --------------------------------------------

def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = a @ b
    if c < -0.999999:
        p = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        p /= np.linalg.norm(p)
        return 2 * np.outer(p, p) - np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


def frame(d, n):
    d = d / np.linalg.norm(d); n = n - d * (n @ d); n /= np.linalg.norm(n)
    return np.stack([d, n, np.cross(d, n)], 1)


def axis_rot(axis, ang):
    axis = np.asarray(axis, float); axis /= np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K


def two_bone(a, b, c, target, pole):
    """Where the middle joint goes for a limb a-b-c reaching for target, bending toward pole."""
    l1 = np.linalg.norm(b - a); l2 = np.linalg.norm(c - b)
    d = target - a; dl = np.linalg.norm(d)
    dl = np.clip(dl, abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
    dn = d / np.linalg.norm(d)
    ca = (l1 * l1 + dl * dl - l2 * l2) / (2 * l1 * dl)
    ang = np.arccos(np.clip(ca, -1, 1))
    pn = pole - dn * (pole @ dn); pn /= np.linalg.norm(pn)
    mid = a + l1 * (dn * np.cos(ang) + pn * np.sin(ang))
    end = a + dn * dl
    return mid, end


def pose_world(J, spec):
    """World rotation (3x3) and position of each bone for a pose: spec gives the hips' position
    and turn, the chest's turn, and targets for the hands and feet (with which way the knees and
    elbows point) and where the head looks."""
    G = {}
    Rw = {}
    hip_R = spec.get('hips_R', np.eye(3))
    hip_p = spec.get('hips', J['Hips'])
    Rw['Hips'] = hip_R; G['Hips'] = hip_p
    def child(b, parent):
        G[b] = G[parent] + Rw[parent] @ (J[b] - J[parent])
    Rw['Spine'] = spec.get('spine_R', hip_R); child('Spine', 'Hips')
    Rw['Chest'] = spec.get('chest_R', Rw['Spine']); child('Chest', 'Spine')
    Rw['Neck'] = Rw['Chest']; child('Neck', 'Chest')
    Rw['Head'] = spec.get('head_R', Rw['Neck']); child('Head', 'Neck')
    for s in 'LR':
        Rw[f'Shoulder_{s}'] = spec.get(f'clav_{s}', np.eye(3)) @ Rw['Chest'] if f'clav_{s}' in spec else Rw['Chest']
        child(f'Shoulder_{s}', 'Chest')
        # arm
        G[f'UpperArm_{s}'] = G[f'Shoulder_{s}'] + Rw[f'Shoulder_{s}'] @ (J[f'UpperArm_{s}'] - J[f'Shoulder_{s}'])
        a, b, c = J[f'UpperArm_{s}'], J[f'Forearm_{s}'], J[f'Hand_{s}']
        if f'hand_{s}' in spec:
            tgt = spec[f'hand_{s}']; pole = spec.get(f'elbow_{s}', np.array([0, 0, -1.0]))
            A0 = G[f'UpperArm_{s}']
            mid, end = two_bone(A0, A0 + (b - a), A0 + (c - a), tgt, pole)
            rest_n = np.cross(c - a, np.array([0, 0, -1.0])) if True else None
            n_new = np.cross(end - A0, pole)
            Rw[f'UpperArm_{s}'] = frame(mid - A0, n_new) @ frame(b - a, rest_n).T
            Rw[f'Forearm_{s}'] = frame(end - mid, n_new) @ frame(c - b, rest_n).T
        else:
            Rw[f'UpperArm_{s}'] = Rw[f'Shoulder_{s}']; Rw[f'Forearm_{s}'] = Rw[f'Shoulder_{s}']
        child(f'Forearm_{s}', f'UpperArm_{s}')
        Rw[f'Hand_{s}'] = Rw[f'Forearm_{s}']; child(f'Hand_{s}', f'Forearm_{s}')
        # leg
        child(f'Thigh_{s}', 'Hips')
        a, b, c = J[f'Thigh_{s}'], J[f'Shin_{s}'], J[f'Foot_{s}']
        if f'foot_{s}' in spec:
            tgt = spec[f'foot_{s}']; pole = spec.get(f'knee_{s}', np.array([0, 0, 1.0]))
            A0 = G[f'Thigh_{s}']
            mid, end = two_bone(A0, A0 + (b - a), A0 + (c - a), tgt, pole)
            rest_n = np.cross(c - a, np.array([0, 0, 1.0]))
            n_new = np.cross(end - A0, pole)
            Rw[f'Thigh_{s}'] = frame(mid - A0, n_new) @ frame(b - a, rest_n).T
            Rw[f'Shin_{s}'] = frame(end - mid, n_new) @ frame(c - b, rest_n).T
        else:
            Rw[f'Thigh_{s}'] = hip_R; Rw[f'Shin_{s}'] = hip_R
        child(f'Shin_{s}', f'Thigh_{s}')
        Rw[f'Foot_{s}'] = spec.get(f'foot_R_{s}', hip_R); child(f'Foot_{s}', f'Shin_{s}')
        Rw[f'Toe_{s}'] = Rw[f'Foot_{s}']; child(f'Toe_{s}', f'Foot_{s}')
    return Rw, G


def skin(P, joints, weights, J, Rw, G):
    out = np.zeros_like(P)
    for k in range(joints.shape[1]):
        w = weights[:, k]
        for bi, (b, _) in enumerate(BONES):
            m = (joints[:, k] == bi) & (w > 0)
            if m.any():
                out[m] += w[m, None] * ((P[m] - J[b]) @ Rw[b].T + G[b])
    return out


def test_poses(J, H):
    """Rest, riding (sideways, knees bent, arms out), arms raised, a walking stride, skydiving."""
    hip = J['Hips']
    legl = J['Thigh_L'][1] - J['Foot_L'][1]
    P = {}
    P['rest'] = {}
    # riding: feet apart along the board (the character's left toward the nose: +X here), crouched
    cr = 0.35
    hy = J['Hips'][1] - legl * 0.16 * (1 + cr)
    ride = dict(hips=np.array([0, hy, -0.03]), hips_R=axis_rot([0, 1, 0], 0.25),
                chest_R=axis_rot([0, 1, 0], 0.45) @ axis_rot([1, 0, 0], 0.25),
                foot_L=np.array([0.33, J['Foot_L'][1], 0.0]), foot_R=np.array([-0.33, J['Foot_R'][1], 0.0]),
                knee_L=np.array([0.45, 0, 1.0]), knee_R=np.array([-0.2, 0, 1.0]),
                foot_R_L=axis_rot([0, 1, 0], 0.5), foot_R_R=axis_rot([0, 1, 0], 0.5))
    sh = J['UpperArm_L'][1] - 0.2
    ride['hand_L'] = np.array([0.72, hy + 0.32, 0.18]); ride['hand_R'] = np.array([-0.66, hy + 0.28, 0.12])
    ride['elbow_L'] = np.array([0.2, -1, -0.6]); ride['elbow_R'] = np.array([-0.2, -1, -0.6])
    P['ride'] = ride
    up = dict(hand_L=J['UpperArm_L'] + np.array([0.55, 0.32, 0.05]), hand_R=J['UpperArm_R'] + np.array([-0.55, 0.32, 0.05]),
              elbow_L=np.array([0, -1, -0.3]), elbow_R=np.array([0, -1, -0.3]))
    P['arms up'] = up
    walk = dict(foot_L=J['Foot_L'] + np.array([0, 0.03, 0.22]), foot_R=J['Foot_R'] + np.array([0, 0.08, -0.25]),
                hips=J['Hips'] + np.array([0, -0.03, 0]),
                hand_L=J['Hand_L'] + np.array([0.02, 0.06, -0.18]), hand_R=J['Hand_R'] + np.array([-0.02, 0.1, 0.22]),
                elbow_L=np.array([0, 0, -1.0]), elbow_R=np.array([0, 0, -1.0]))
    P['walk'] = walk
    sky = dict(hand_L=J['UpperArm_L'] + np.array([0.45, 0.45, 0.2]), hand_R=J['UpperArm_R'] + np.array([-0.45, 0.45, 0.2]),
               elbow_L=np.array([0.3, -1, -0.5]), elbow_R=np.array([-0.3, -1, -0.5]),
               foot_L=J['Foot_L'] + np.array([0.08, 0.25, -0.3]), foot_R=J['Foot_R'] + np.array([-0.08, 0.35, -0.25]),
               knee_L=np.array([0, -0.3, 1.0]), knee_R=np.array([0, -0.3, 1.0]))
    P['skydive'] = sky
    return P


# ---- pictures ---------------------------------------------------------------------------------

def render(P, F, col, path_or_none=None, ang=(0, 90), S=560, J=None, Jw=None, label=None, light=(0.4, 0.7, 0.6)):
    """The model from the given angles about Y (triangles nearest last, lit simply), with the
    skeleton drawn over it when J is given (Jw: posed joint positions)."""
    lo = P.min(0); hi = P.max(0); mid = (lo + hi) / 2; span = max(hi - lo) * 1.08
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    L = np.array(light, float); L /= np.linalg.norm(L)
    fc = col[F].mean(1)
    out = Image.new('RGB', (S * len(ang) + 8 * (len(ang) - 1), S), (255, 255, 255))
    for k, a in enumerate(ang):
        t = np.radians(a)
        R = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
        Q = (P - mid) @ R.T
        px = (Q[:, 0] / span + 0.5) * S; py = (0.5 - Q[:, 1] / span) * S
        im = Image.new('RGB', (S, S), (40, 44, 52)); d = ImageDraw.Draw(im)
        nr = fn @ R.T
        vis = nr[:, 2] > -0.05
        lit = np.clip(fn @ L, 0, 1) * 0.55 + 0.45
        order = np.argsort(Q[F].mean(1)[:, 2])
        for i in order:
            if not vis[i]:
                continue
            v = F[i]
            c = fc[i] * lit[i]
            d.polygon([(px[j], py[j]) for j in v], fill=tuple(int(x * 255) for x in np.clip(c, 0, 1)))
        if J is not None:
            JJ = Jw if Jw is not None else J
            def proj(p):
                q = (p - mid) @ R.T
                return ((q[0] / span + 0.5) * S, (0.5 - q[1] / span) * S)
            for name, parent in BONES:
                if parent:
                    d.line([proj(JJ[parent]), proj(JJ[name])], fill=(255, 230, 60), width=2)
            for name, _ in BONES:
                x, y = proj(JJ[name]); d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 80, 60))
        if label and k == 0:
            d.text((8, 8), label, fill=(255, 255, 255))
        out.paste(im, (k * (S + 8), 0))
    if path_or_none:
        out.save(path_or_none)
    return out


def weight_colours(joints, weights, bones):
    """A colour per bone, mixed by weight (for checking the weights)."""
    rng = np.random.default_rng(3)
    pal = rng.uniform(0.25, 1.0, (len(BONES), 3))
    pal[BI['Chest']] = [0.9, 0.85, 0.3]; pal[BI['Spine']] = [0.9, 0.55, 0.2]; pal[BI['Hips']] = [0.75, 0.3, 0.2]
    pal[BI['Neck']] = [0.4, 0.9, 0.4]; pal[BI['Head']] = [0.3, 0.6, 1.0]
    for s, base in [('L', [0.2, 0.9, 0.9]), ('R', [0.9, 0.3, 0.9])]:
        pal[BI[f'Shoulder_{s}']] = [1, 1, 1]
        pal[BI[f'UpperArm_{s}']] = base; pal[BI[f'Forearm_{s}']] = np.array(base) * 0.6; pal[BI[f'Hand_{s}']] = np.array(base) * 0.35
        pal[BI[f'Thigh_{s}']] = np.array(base)[::-1]; pal[BI[f'Shin_{s}']] = np.array(base)[::-1] * 0.6
        pal[BI[f'Foot_{s}']] = np.array(base)[::-1] * 0.35; pal[BI[f'Toe_{s}']] = [0.1, 0.1, 0.1]
    c = np.zeros((len(joints), 3))
    for k in range(joints.shape[1]):
        c += weights[:, k:k + 1] * pal[joints[:, k]]
    return c


# ---- writing -----------------------------------------------------------------------------------

def write_skinned_glb(path, name, R, joints, weights, J, extras, jpeg):
    P, N, UV, CELN, F = R['P'], R['N'], R['UV'], R['CELN'], R['F']
    chunks, views, accs = [], [], []

    def add(data, target=None):
        off = sum(len(c) for c in chunks)
        chunks.append(data + b'\0' * ((-len(data)) % 4))
        v = dict(buffer=0, byteOffset=off, byteLength=len(data))
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def acc(arr, ctype, typ, target=None, normalized=False, minmax=False):
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
    jo = acc(joints.astype(np.uint8), 5121, 'VEC4', 34962)
    we = acc(np.round(weights * 65535).astype(np.uint16), 5123, 'VEC4', 34962, normalized=True)
    idx_t = np.uint16 if len(P) < 65535 else np.uint32
    ind = acc(F.astype(idx_t).ravel(), 5123 if idx_t == np.uint16 else 5125, 'SCALAR', 34963)
    ibm = np.zeros((len(BONES), 16), np.float32)
    for i, (b, _) in enumerate(BONES):
        m = np.eye(4); m[:3, 3] = -J[b]
        ibm[i] = m.T.ravel()          # (column-major)
    ibm_a = acc(ibm, 5126, 'MAT4')
    img = add(jpeg)
    nodes = [dict(name=name, mesh=0, skin=0, extras=extras)]
    for b, parent in BONES:
        t = J[b] - (J[parent] if parent else 0)
        nodes.append(dict(name=b, translation=[float(v) for v in t]))
    for i, (b, parent) in enumerate(BONES):
        kids = [j + 1 for j, (c, p) in enumerate(BONES) if p == b]
        if kids:
            nodes[i + 1]['children'] = kids
    gltf = dict(
        asset=dict(version='2.0', generator='Sky Tide tools/models/characters_rig.py'),
        scene=0, scenes=[dict(nodes=[0, 1])],
        nodes=nodes,
        skins=[dict(name=f'{name}_rig', joints=list(range(1, len(BONES) + 1)), inverseBindMatrices=ibm_a, skeleton=1)],
        meshes=[dict(name=name, primitives=[dict(attributes=dict(POSITION=pos, NORMAL=nor, TEXCOORD_0=uv, _CELN=cel, JOINTS_0=jo, WEIGHTS_0=we), indices=ind, material=0)])],
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


def main():
    debug = '--debug' in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith('--')] or NAMES
    prev = os.path.join(ROOT, 'art', 'models', 'previews')
    for name in only:
        M = prepared(name)
        H = M['P'][:, 1].max()
        J, lm, crease = skeleton(M['P'], M['F'], M['info'])
        report = dict(landmarks={k: (round(float(v), 4) if np.isscalar(v) else v) for k, v in lm.items()})
        R = cut_underarms(M, crease, H, report)
        joints, weights, Wg = skin_weights(R, J, lm, H)
        report['arm_free_to'] = R['arm_free']
        print(name, json.dumps(report))
        extras = dict(rig=dict(height=float(H), bones=[b for b, _ in BONES],
                               points={k: [round(float(v), 4) for v in J[k]] for k in ['Head_end', 'Hand_L_end', 'Hand_R_end', 'Toe_L_end', 'Toe_R_end', 'Sole_L', 'Sole_R']},
                               landmarks={k: round(float(v), 4) for k, v in lm.items() if np.isscalar(v)}))
        out = os.path.join(ROOT, 'assets', 'models', f'{name}.glb')
        write_skinned_glb(out, name, R, joints, weights, J, extras, cp.jpeg(R['tex']))
        report.update(vertices=int(len(R['P'])), triangles=int(len(R['F'])), bytes=os.path.getsize(out))
        with open(os.path.join(ROOT, 'art', 'models', 'production', f'{name}-rig.json'), 'w') as fh:
            json.dump(dict(report, joints={b: [round(float(v), 4) for v in J[b]] for b, _ in BONES}), fh, indent=1)
        if debug:
            col = cp.sample(R['tex'].resize((1024, 1024), Image.BOX), R['UV'])
            render(R['P'], R['F'], col, os.path.join(prev, f'{name}-skeleton.png'), J=J, ang=(0, 90))
            render(R['P'], R['F'], weight_colours(joints, weights, BONES), os.path.join(prev, f'{name}-weights.png'), ang=(0, 90, 180, 35))
            poses = test_poses(J, H)
            tiles = []
            for pname, spec in poses.items():
                Rw, G = pose_world(J, spec)
                Q = skin(R['P'], joints, weights, J, Rw, G)
                tiles.append(render(Q, R['F'], col, ang=(0, 45, 90, 180), S=420, J=J, Jw=G, label=pname))
            sheet = Image.new('RGB', (tiles[0].width, sum(t.height for t in tiles) + 6 * (len(tiles) - 1)), (255, 255, 255))
            yy = 0
            for t in tiles:
                sheet.paste(t, (0, yy)); yy += t.height + 6
            sheet.save(os.path.join(prev, f'{name}-poses.png'))


if __name__ == '__main__':
    main()
