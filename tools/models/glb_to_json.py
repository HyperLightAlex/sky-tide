#!/usr/bin/env python3
"""A glTF binary (.glb) as glTF JSON with its data inside (base64), for hosts that serve .json
but not .glb (the published sandbox). The game reads either (src/render/riderModel.js).

    python3 tools/models/glb_to_json.py in.glb out.gltf.json
"""
import base64
import json
import struct
import sys


def convert(src, dst):
    with open(src, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2, 'not a glTF 2 binary'
    off = 12
    gltf, blob = None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            blob = chunk
        off += 8 + clen
    if gltf.get('buffers'):
        gltf['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(blob).decode('ascii')
        gltf['buffers'][0]['byteLength'] = len(blob)
    with open(dst, 'w') as f:
        json.dump(gltf, f, separators=(',', ':'))


if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2])
