#!/usr/bin/env python3
"""A contact sheet of rider-shots.mjs pictures: one row per state, one column per view.

    python3 sheet.py shots/tavi ride,crouch,walk front,three,nose,back,chase [scale] [out.png]
"""
import sys

from PIL import Image, ImageDraw

prefix, states, views = sys.argv[1], sys.argv[2].split(','), sys.argv[3].split(',')
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
out = sys.argv[5] if len(sys.argv) > 5 else f'{prefix}-sheet.png'
tiles = [[Image.open(f'{prefix}-{s}-{v}.png').convert('RGB') for v in views] for s in states]
w, h = int(tiles[0][0].width * scale), int(tiles[0][0].height * scale)
sheet = Image.new('RGB', (len(views) * (w + 4), len(states) * (h + 4)), (255, 255, 255))
d = ImageDraw.Draw(sheet)
for r, row in enumerate(tiles):
    for c, im in enumerate(row):
        sheet.paste(im.resize((w, h), Image.LANCZOS), (c * (w + 4), r * (h + 4)))
    d.text((6, r * (h + 4) + 6), states[r], fill=(255, 255, 255))
sheet.save(out)
print(out)
