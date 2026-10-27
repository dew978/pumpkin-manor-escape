# TRELLIS 모델의 단면을 재서 뼈대 관절 높이를 정할 때 쓴다 (2026-10-18).
# blender -b --factory-startup -P probe3d.py -- <glb 경로> <키> [rot]
#   키: 모델을 맞출 높이 (사람형 1.0, 네발 0.6). rot: z축 회전(도)
# 결과: 같은 폴더의 probe.txt(높이·앞뒤·좌우 띠마다 범위)와 probe_front/side/back/side2/top.png
import bpy, sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
GLB = os.path.abspath(argv[0]); H = float(argv[1]); ROT = float(argv[2]) if len(argv) > 2 else 0.0
OUT = os.path.dirname(GLB)
common.reset()
o = common.import_glb(GLB, height=H, rot_z_deg=ROT)
P = np.array([v.co[:] for v in o.data.vertices])
lines = [f'verts {len(P)} height {H} rot {ROT}']
for i, a in enumerate('xyz'):
    lines.append(f'{a}: {P[:, i].min():.3f}..{P[:, i].max():.3f}')
step = 0.02 * H / 0.6 if H < 1 else 0.03
lines.append(f'--- z bands ({step:.3f}): x / y extent')
for z in np.arange(0, H, step):
    b = P[(P[:, 2] >= z) & (P[:, 2] < z + step)]
    if len(b):
        lines.append(f'z{z:.2f} x={b[:, 0].min():.3f}..{b[:, 0].max():.3f} w={b[:, 0].max() - b[:, 0].min():.3f} y={b[:, 1].min():.3f}..{b[:, 1].max():.3f} n={len(b)}')
for ax, other in ((0, 1), (1, 0)):
    a = 'xy'[ax]
    lines.append(f'--- {a} bands ({step:.3f}): z range, {"xy"[other]} range')
    for t in np.arange(P[:, ax].min(), P[:, ax].max(), step):
        b = P[(P[:, ax] >= t) & (P[:, ax] < t + step)]
        if len(b):
            lines.append(f'{a}{t:+.3f} z={b[:, 2].min():.3f}..{b[:, 2].max():.3f} {"xy"[other]}={b[:, other].min():.3f}..{b[:, other].max():.3f} n={len(b)}')
f = P[P[:, 2] < 0.06 * H]
lines.append(f'feet (z<0.06H) n={len(f)} x={f[:, 0].min():.3f}..{f[:, 0].max():.3f} y={f[:, 1].min():.3f}..{f[:, 1].max():.3f}')
open(os.path.join(OUT, 'probe.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print('\n'.join(lines))

sc = common.setup_render(512); sc.render.film_transparent = True
common.add_sun(rot=(55, 0, -35), strength=2.5)
for name, rz, pitch in (('front', 0, 0), ('side', 90, 0), ('back', 180, 0), ('side2', 270, 0), ('top', 0, 89)):
    o.rotation_euler[2] = math.radians(rz)
    for c in [c for c in bpy.data.objects if c.type == 'CAMERA']:
        bpy.data.objects.remove(c)
    common.add_ortho_camera(H / 2, H * 1.5, pitch)
    sc.render.filepath = os.path.join(OUT, f'probe_{name}.png')
    bpy.ops.render.render(write_still=True)
