#!/usr/bin/env python3
"""A glTF binary (.glb) as files a host that does not serve .glb can serve (the published
sandbox): glTF JSON with its geometry inside as base64 (<name>.gltf.json), and its images as
their own files beside it (<name>.jpg, <name>.1.png, ...).

    python3 tools/models/glb_to_json.py in.glb out_dir

The game reads these when the .glb does not load (src/render/riderModel.js): it decodes the
geometry itself and loads the images as the page's own files, because the sandbox's page may
fetch only its own files (not data: or blob: addresses).
"""
import base64
import json
import os
import struct
import sys


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2, 'not a glTF 2 binary'
    off, gltf, blob = 12, None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            blob = chunk
        off += 8 + clen
    return gltf, blob


def convert(src, out_dir):
    gltf, blob = read_glb(src)
    name = os.path.splitext(os.path.basename(src))[0]
    views = gltf.get('bufferViews', [])
    # the images out to their own files
    image_views = set()
    for i, im in enumerate(gltf.get('images', [])):
        if 'bufferView' not in im:
            continue
        bv = views[im['bufferView']]
        data = blob[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        ext = '.png' if im.get('mimeType') == 'image/png' else '.jpg'
        fname = f'{name}{"" if i == 0 else f".{i}"}{ext}'
        with open(os.path.join(out_dir, fname), 'wb') as f:
            f.write(data)
        image_views.add(im['bufferView'])
        gltf['images'][i] = {k: v for k, v in im.items() if k not in ('bufferView', 'mimeType')}
        gltf['images'][i]['uri'] = fname
    # the rest of the buffer, packed again without them
    keep = [i for i in range(len(views)) if i not in image_views]
    remap = {old: new for new, old in enumerate(keep)}
    out = bytearray()
    new_views = []
    for i in keep:
        bv = dict(views[i])
        data = blob[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        out += b'\0' * ((-len(out)) % 4)
        bv['byteOffset'] = len(out)
        out += data
        new_views.append(bv)
    gltf['bufferViews'] = new_views
    for a in gltf.get('accessors', []):
        if 'bufferView' in a:
            a['bufferView'] = remap[a['bufferView']]
    for im in gltf.get('images', []):
        if 'bufferView' in im:
            im['bufferView'] = remap[im['bufferView']]
    gltf['buffers'] = [{'byteLength': len(out), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(bytes(out)).decode('ascii')}]
    with open(os.path.join(out_dir, f'{name}.gltf.json'), 'w') as f:
        json.dump(gltf, f, separators=(',', ':'))


if __name__ == '__main__':
    os.makedirs(sys.argv[2], exist_ok=True)
    convert(sys.argv[1], sys.argv[2])
