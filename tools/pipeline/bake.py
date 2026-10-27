# 3D 모델 → 8방향 도트 스프라이트 굽기.
# blender -b --factory-startup -P bake.py -- <wolf|wolfgrey|hero> [--test] [--skip-render] [--frames 48,64,96] [--raw-style]
#   기본: 64칸, 셀 셰이딩, 공용 팔레트 (2026-10-17 확정 규격)
#   --test : 남쪽·동쪽 두 방향만 큰 그림으로 렌더해 뼈대와 동작을 눈으로 확인한다 (art/sprites/_test)
#   --raw-style : 셀 셰이딩·공용 팔레트 없이 굽는 예전 방식 (비교용)
# 결과: art/sprites/<model>/<layer>_<anim>.png (가로=프레임, 세로=8방향), <model>.json
import bpy, sys, os, math, time, json, random
import numpy as np
from mathutils import Vector, Matrix, kdtree
sys.path.insert(0, os.path.dirname(__file__))
import common

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FRAME = 64          # 게임에서 쓰는 한 칸 크기 (픽셀)
SUPER = 6           # 내부 렌더 배율 (64칸이면 384로 렌더해 줄인다)
ORTHO = 1.5         # 카메라가 담는 세계 크기. 모든 모델이 같은 값을 써야 크기 비율이 맞는다
PITCH = 40          # 내려다보는 각도
# 방향 이름과 모델 회전각. 모델 정면은 -Y(화면 아래쪽 = 남쪽)
DIRS = [('S', 0), ('SE', 45), ('E', 90), ('NE', 135), ('N', 180), ('NW', 225), ('W', 270), ('SW', 315)]

MODELS = {
    'wolf': dict(glb='art/3d/wolf.glb', rot=0, height=0.6, kind='quad', voxel=0.006, target_z=0.28, colors={'body': 20}, light=(5.0, 2.5, 1.6), toon_gain=2.2,
                 anims={'idle': (4, 6, True), 'walk': (8, 12, True), 'attack': (7, 14, False), 'hit': (3, 12, False), 'death': (6, 10, False)}),
    # 회색 털판. 원화가 오른쪽 옆모습뿐이라 왼쪽 무늬를 거울로 복사한다
    'wolfgrey': dict(glb='art/3d/wolfgrey.glb', rot=0, height=0.6, kind='quad', voxel=0.006, target_z=0.28, colors={'body': 20},
                     light=(3.0, 1.8, 1.2), toon_gain=1.15, mirror=True, pitch=30,
                     anims={'idle': (4, 6, True), 'walk': (8, 12, True), 'attack': (7, 14, False), 'hit': (3, 12, False), 'death': (6, 10, False)}),
    'hero': dict(glb='art/3d/hero.glb', rot=-90, toon_gain=1.15, height=1.0, kind='biped', voxel=0.006, target_z=0.45,
                 colors={'body': 20, 'sword': 8, 'shield': 10, 'helmet': 8}, light=(2.2, 1.4, 1.0),
                 anims={'idle': (4, 6, True), 'walk': (8, 12, True), 'slash1': (5, 18, False), 'slash2': (5, 18, False),
                        'slash3': (7, 16, False), 'bash1': (5, 16, False), 'bash2': (6, 16, False), 'roll': (6, 18, False),
                        'hit': (3, 12, False), 'death': (6, 10, False)}),
    # 2.5등신 주인공 시험판. 투구는 큰 머리카락과 안 맞아서 뺀다
    'herochibi': dict(glb='art/3d/herochibi.glb', rot=0, toon_gain=1.15, pitch=22, desat=-0.3,
                      bands=((0.66, 0.64, 0.74), (0.92, 0.9, 0.9), (1.12, 1.08, 1.0)), height=1.0, kind='biped', body='chibi', voxel=0.006, target_z=0.4,
                      colors={'body': 20, 'sword': 8, 'shield': 10}, light=(2.2, 1.4, 1.0), equip=('sword', 'shield'),
                      anims={'idle': (4, 6, True), 'walk': (8, 12, True), 'slash1': (5, 18, False), 'slash3': (7, 16, False)}),
    # 저주 병사: 주인공 모델을 칙칙하게 물들여 다시 쓴다. 장비는 몸과 한 장으로 굽는다(merge)
    'soldier': dict(glb='art/3d/hero.glb', rot=-90, toon_gain=1.45, height=1.0, kind='biped', voxel=0.006, target_z=0.45,
                    colors={'body': 20}, light=(2.2, 1.4, 1.0), tint=(0.8, 0.88, 0.74), desat=0.5, merge=True,
                    anims={'idle': (4, 6, True), 'walk': (8, 10, True), 'attack': (7, 12, False), 'block': (3, 6, True),
                           'hit': (3, 12, False), 'death': (6, 10, False)}),
}

argv = sys.argv[sys.argv.index('--') + 1:]
NAME = argv[0]
TEST = '--test' in argv
RAW_STYLE = '--raw-style' in argv
TOON = not RAW_STYLE  # 셀 셰이딩: 빛을 3단으로 끊는다
PAL = not RAW_STYLE   # 공용 팔레트(art/palette.json)로 색을 맞추고 외톨이 점을 정리한다
SKIP_RENDER = '--skip-render' in argv  # 이미 렌더해 둔 원본으로 후처리만 다시 한다
# --frames 48,64,96 : 한 번 렌더해서 칸 크기별로 따로 만든다 (결과 폴더 끝에 _48 등이 붙는다)
FRAMES = [int(x) for x in argv[argv.index('--frames') + 1].split(',')] if '--frames' in argv else [FRAME]
OUT = NAME + ('_raw-style' if RAW_STYLE else '') + ('_cmp' if '--frames' in argv else '')
CFG = MODELS[NAME]
T = {}  # 단계별 걸린 시간


def tick(k, t0):
    T[k] = round(time.time() - t0, 1)
    print(f'[time] {k} {T[k]}s', flush=True)


# ---------- 뼈대 ----------
def quad_bones(obj):
    H = CFG['height']
    co = [v.co.copy() for v in obj.data.vertices]
    ys = [c.y for c in co]; ymin, ymax = min(ys), max(ys); L = ymax - ymin
    feet = [c for c in co if c.z < 0.06 * H]
    ymid_feet = sum(c.y for c in feet) / len(feet)
    def cen(sel):
        s = [c for c in feet if sel(c)]
        return Vector((sum(c.x for c in s) / len(s), sum(c.y for c in s) / len(s), 0))
    FL = cen(lambda c: c.y < ymid_feet and c.x > 0); FR = cen(lambda c: c.y < ymid_feet and c.x < 0)
    RL = cen(lambda c: c.y >= ymid_feet and c.x > 0); RR = cen(lambda c: c.y >= ymid_feet and c.x < 0)
    yf, yr = (FL.y + FR.y) / 2, (RL.y + RR.y) / 2
    tip = [c for c in co if c.y < ymin + 0.06 * L]; head_z = sum(c.z for c in tip) / len(tip)
    tail = [c for c in co if c.y > ymax - 0.06 * L]; tail_z = sum(c.z for c in tail) / len(tail)
    sz = 0.6 * H
    tail0 = yr + 0.1 * L
    B = {
        'hips': ((0, yr, sz), (0, (yf + yr) / 2, sz), None),
        'chest': ((0, (yf + yr) / 2, sz), (0, yf, sz + 0.02 * H), 'hips'),
        'neck': ((0, yf, sz + 0.02 * H), (0, yf - 0.4 * (yf - ymin), 0.85 * H), 'chest'),
        'head': ((0, yf - 0.4 * (yf - ymin), 0.85 * H), (0, ymin, head_z), 'neck'),
        'tail1': ((0, tail0, sz), (0, (tail0 + ymax) / 2, (sz + tail_z) / 2), 'hips'),
        'tail2': ((0, (tail0 + ymax) / 2, (sz + tail_z) / 2), (0, ymax, tail_z), 'tail1'),
    }
    for n, f, par in (('FL', FL, 'chest'), ('FR', FR, 'chest'), ('RL', RL, 'hips'), ('RR', RR, 'hips')):
        B[n + '_up'] = ((f.x, f.y, 0.55 * H), (f.x, f.y, 0.3 * H), par)
        B[n + '_lo'] = ((f.x, f.y, 0.3 * H), (f.x, f.y, 0.02 * H), n + '_up')
    return B


# 사람형 관절 높이 (키 = 1). 2.5등신은 머리가 크고 다리가 짧아 관절이 모두 아래로 내려간다
JOINTS = {
    'normal': dict(pelvis=0.48, spine=0.56, chest=0.70, neck=0.78, head=0.83, shoulder=0.74, hip=0.47, knee=0.26, ankle=0.06,
                   hand_band=(0.3, 0.65), shoulder_frac=0.42, helm_z=0.84, helm_c=0.9),
    'chibi': dict(pelvis=0.27, spine=0.33, chest=0.42, neck=0.52, head=0.56, shoulder=0.5, hip=0.27, knee=0.15, ankle=0.04,
                  hand_band=(0.2, 0.45), shoulder_frac=0.55, helm_z=0.7, helm_c=0.8),
}


def biped_bones(obj):
    J = JOINTS[CFG.get('body', 'normal')]
    co = [v.co.copy() for v in obj.data.vertices]
    feet = [c for c in co if c.z < 0.04]
    def cen(s):
        return Vector((sum(c.x for c in s) / len(s), sum(c.y for c in s) / len(s), sum(c.z for c in s) / len(s)))
    fl, fr = cen([c for c in feet if c.x > 0]), cen([c for c in feet if c.x < 0])
    band = [c for c in co if J['hand_band'][0] < c.z < J['hand_band'][1]]
    xmax, xmin = max(c.x for c in band), min(c.x for c in band)
    hl = cen([c for c in band if c.x > xmax - 0.04]); hr = cen([c for c in band if c.x < xmin + 0.04])
    if CFG.get('hands'):   # 칼·방패를 쥔 채 생성된 모델은 띠의 양 끝이 손이 아니라 칼끝·방패 테두리다. 잰 손 위치 (왼, 오른)를 그대로 쓴다
        hl, hr = (Vector(p) for p in CFG['hands'])
    B = {
        'pelvis': ((0, 0, J['pelvis']), (0, 0, J['spine']), None),
        'spine': ((0, 0, J['spine']), (0, 0, J['chest']), 'pelvis'),
        'chest': ((0, 0, J['chest']), (0, 0, J['neck']), 'spine'),
        'neck': ((0, 0, J['neck']), (0, 0, J['head']), 'chest'),
        'head': ((0, 0, J['head']), (0, 0, 1.0), 'neck'),
    }
    for s, h, f in (('L', hl, fl), ('R', hr, fr)):
        sg = 1 if s == 'L' else -1
        sh = Vector((sg * J['shoulder_frac'] * abs(h.x), 0, J['shoulder']))
        wrist = h + (sh - h).normalized() * 0.035
        elbow = sh.lerp(wrist, 0.5) + Vector((0, 0.01, 0))
        hand_tip = wrist + (wrist - elbow).normalized() * 0.06
        B['clav_' + s] = ((sg * 0.02, 0, J['shoulder'] + 0.01), tuple(sh), 'chest')
        B['uarm_' + s] = (tuple(sh), tuple(elbow), 'clav_' + s)
        B['farm_' + s] = (tuple(elbow), tuple(wrist), 'uarm_' + s)
        B['hand_' + s] = (tuple(wrist), tuple(hand_tip), 'farm_' + s)
        hip = Vector((f.x * 0.8, 0, J['hip']))
        B['thigh_' + s] = (tuple(hip), (f.x, f.y * 0.5, J['knee']), 'pelvis')
        B['shin_' + s] = ((f.x, f.y * 0.5, J['knee']), (f.x, f.y, J['ankle']), 'thigh_' + s)
        B['foot_' + s] = ((f.x, f.y, J['ankle']), (f.x, f.y - 0.07, 0.02), 'shin_' + s)
    return B


def build_armature(bones):
    ad = bpy.data.armatures.new('rig')
    arm = bpy.data.objects.new('rig', ad)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for n, (h, t, p) in bones.items():
        eb = ad.edit_bones.new(n); eb.head = h; eb.tail = t; eb.roll = 0
    for n, (h, t, p) in bones.items():
        if p:
            ad.edit_bones[n].parent = ad.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm


def heat_weights(obj, arm, scale):
    """사본을 복셀로 다시 짜고 scale배로 키워 Blender 자동 가중치를 계산한다. (사본 좌표, 가중치 행렬) 또는 실패 시 None."""
    proxy = obj.copy(); proxy.data = obj.data.copy(); bpy.context.collection.objects.link(proxy)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = proxy; proxy.select_set(True)
    # TRELLIS 메시는 구멍이 많아 바로 복셀화하면 깨진다. 얇게 두께를 준 뒤 복셀화하면 닫힌 형태가 된다
    s = proxy.modifiers.new('s', 'SOLIDIFY'); s.thickness = 0.006; s.offset = 0
    bpy.ops.object.modifier_apply(modifier='s')
    m = proxy.modifiers.new('r', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = CFG['voxel']
    bpy.ops.object.modifier_apply(modifier='r')
    arm2 = arm.copy(); arm2.data = arm.data.copy(); bpy.context.collection.objects.link(arm2)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (proxy, arm2):
        o.scale = (scale, scale, scale); o.select_set(True)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True); arm2.select_set(True); bpy.context.view_layer.objects.active = arm2
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    names = [b.name for b in arm.data.bones]
    gi = {g.index: g.name for g in proxy.vertex_groups}
    W = np.zeros((len(proxy.data.vertices), len(names)))
    col = {n: i for i, n in enumerate(names)}
    for v in proxy.data.vertices:
        for g in v.groups:
            n = gi[g.group]
            if n in col:
                W[v.index, col[n]] = g.weight
    co = [v.co / scale for v in proxy.data.vertices]
    bpy.data.objects.remove(proxy, do_unlink=True); bpy.data.objects.remove(arm2, do_unlink=True)
    empty = int((W.sum(1) < 1e-6).sum())
    print(f'heat weights x{scale}: {empty}/{len(W)} proxy verts unweighted')
    return None if empty > 0.2 * len(W) else (co, W)


def skin(obj, arm):
    """자동 가중치를 사본에서 계산해 가장 가까운 점의 가중치를 원본에 옮긴다.
    자동 가중치는 모델 크기에 따라 실패하는 일이 있어(주인공은 10배, 늑대는 1배에서 성공) 배율을 바꿔 가며 시도한다."""
    for scale in (10, 1, 30, 3):
        r = heat_weights(obj, arm, scale)
        if r:
            break
    else:
        raise RuntimeError('automatic weights failed')
    pco, W = r
    names = [b.name for b in arm.data.bones]
    kd = kdtree.KDTree(len(pco))
    for i, c in enumerate(pco):
        kd.insert(c, i)
    kd.balance()
    # 뼈에서 멀리 떨어진 점에 붙은 가중치는 버린다 (손이 허리 장식에 붙어 늘어나는 문제 방지)
    P = np.array([v.co[:] for v in obj.data.vertices])
    D = np.zeros((len(P), len(names)))
    for j, n in enumerate(names):
        b = arm.data.bones[n]; a = np.array(b.head_local[:]); ab = np.array(b.tail_local[:]) - a
        t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
        D[:, j] = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
    far = D > D.min(1, keepdims=True) + 0.06 * CFG['height']
    groups = {n: obj.vertex_groups.new(name=n) for n in names}
    for v in obj.data.vertices:
        near = kd.find_n(v.co, 4)
        w = np.zeros(len(names)); tot = 0
        for co, idx, dist in near:
            k = 1.0 / (dist + 1e-4); w += W[idx] * k; tot += k
        w /= tot
        w[far[v.index]] = 0
        s = w.sum()
        if s < 1e-6:
            w[:] = 0; w[D[v.index].argmin()] = 1; s = 1
        w /= s
        for i in np.nonzero(w > 0.01)[0]:
            groups[names[i]].add([v.index], float(w[i]), 'REPLACE')
    if CFG['kind'] == 'biped':
        cut_hand_webs(obj, names)
    obj.parent = arm
    mod = obj.modifiers.new('arm', 'ARMATURE'); mod.object = arm


def cut_hand_webs(obj, names):
    """A자세 원화에서 손이 허리에 붙어 있으면 TRELLIS가 둘을 얇은 막으로 잇는다. 아래팔·손 쪽 점과 몸통·다리 쪽 점을 함께 가진 면을 지운다."""
    import bmesh
    arm_side = {n for n in names if n.startswith(('farm_', 'hand_'))}
    trunk = {n for n in names if n.startswith(('pelvis', 'spine', 'thigh_', 'shin_', 'foot_'))}
    gname = {g.index: g.name for g in obj.vertex_groups}
    dom = {}
    for v in obj.data.vertices:
        if v.groups:
            dom[v.index] = gname[max(v.groups, key=lambda g: g.weight).group]
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    kill = []
    for f in bm.faces:
        ds = {dom.get(v.index) for v in f.verts}
        if ds & arm_side and ds & trunk:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    print('hand-web faces cut:', len(kill))


# ---------- 자세 ----------
def apply_pose(arm, pose):
    """pose: {뼈: [(축, 각도)...]}, 축은 모델 기준 'X'(좌우)·'Y'(앞뒤)·'Z'(위아래). '_root': (dx,dy,dz)"""
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for bn, rots in pose.items():
        if bn == '_root':
            continue
        pb = arm.pose.bones[bn]
        M = pb.bone.matrix_local.to_3x3()
        q = pb.rotation_quaternion.copy()
        for ax, deg in rots:
            R = Matrix.Rotation(math.radians(deg), 3, ax)
            q = (M.inverted() @ R @ M).to_quaternion() @ q
        pb.rotation_quaternion = q
    root = arm.pose.bones[0]
    dx, dy, dz = pose.get('_root', (0, 0, 0))
    M = root.bone.matrix_local.to_3x3()
    root.location = M.inverted() @ Vector((dx, dy, dz))


def add(p, bone, ax, deg):
    p.setdefault(bone, []).append((ax, deg))


def wolf_pose(anim, i, n):
    H = CFG['height']
    p = {}; t = i / n; s = math.sin(2 * math.pi * t)
    if anim == 'idle':
        add(p, 'chest', 'X', 2 * s); add(p, 'neck', 'X', -2 * s); add(p, 'tail1', 'Z', 8 * s); add(p, 'tail2', 'Z', 8 * s)
        p['_root'] = (0, 0, -0.006 * (1 + s))
    elif anim == 'walk':
        ph = 2 * math.pi * t
        for leg, off in (('FL', 0), ('RR', 0), ('FR', math.pi), ('RL', math.pi)):
            a = ph + off
            add(p, leg + '_up', 'X', -26 * math.sin(a))
            lift = max(0.0, math.cos(a))
            add(p, leg + '_lo', 'X', (45 if leg[0] == 'F' else -35) * lift)
        add(p, 'tail1', 'Z', 10 * math.sin(ph)); add(p, 'neck', 'X', 3 * math.sin(2 * ph))
        p['_root'] = (0, 0, 0.012 * H * math.cos(2 * ph))
    elif anim == 'attack':
        key = [
            dict(cr=0.5),
            dict(cr=1.0),
            dict(dy=-0.04, dz=0.05, fl=-55, rl=45, hd=-15),
            dict(dy=-0.07, dz=0.02, fl=-35, rl=30, hd=22),
            dict(dy=-0.05, fl=-10, rl=10, hd=12),
            dict(dy=-0.03, hd=5),
            dict(dy=-0.01),
        ][i]
        cr = key.get('cr', 0)
        for leg in ('FL', 'FR'):
            add(p, leg + '_up', 'X', key.get('fl', -12 * cr)); add(p, leg + '_lo', 'X', 30 * cr)
        for leg in ('RL', 'RR'):
            add(p, leg + '_up', 'X', key.get('rl', -20 * cr)); add(p, leg + '_lo', 'X', -30 * cr)
        add(p, 'neck', 'X', key.get('hd', 12 * cr)); add(p, 'tail1', 'X', 15 * cr)
        p['_root'] = (0, key.get('dy', 0.02 * cr), key.get('dz', -0.06 * H * cr))
    elif anim == 'hit':
        k = [1.0, 0.6, 0.15][i]
        add(p, 'chest', 'X', -8 * k); add(p, 'neck', 'X', -14 * k); add(p, 'tail1', 'X', 20 * k)
        p['_root'] = (0, 0.03 * k, 0)
    elif anim == 'death':
        k = [0.0, 0.25, 0.6, 0.9, 1.0, 1.0][i]
        add(p, 'hips', 'Y', 88 * k)
        for leg in ('FL', 'FR', 'RL', 'RR'):
            add(p, leg + '_up', 'X', (-15 if leg[0] == 'F' else 15) * k); add(p, leg + '_lo', 'X', 10 * k)
        add(p, 'neck', 'X', 25 * k); add(p, 'tail1', 'X', 20 * k)
        if i == 0:
            add(p, 'neck', 'X', -15)
        p['_root'] = (0.0, 0, -0.42 * H * k)
    return p


def keyed(p, key):
    """key: {'뼈.축': 각도, 'dx'/'dy'/'dz': 이동}. 축은 모델 기준 X(좌우)·Y(앞뒤)·Z(위아래).
    팔: uarm X가 음수면 앞으로 든다, Z가 양수면 몸 왼쪽(+X)으로 휩쓴다. 몸통 spine Z가 음수면 왼어깨가 앞으로 나온다."""
    for k, v in key.items():
        if '.' in k:
            bone, ax = k.split('.'); add(p, bone, ax, v)
    p['_root'] = (key.get('dx', 0), key.get('dy', 0), key.get('dz', 0))
    return p


# 사람형 동작 키. 프레임 수는 MODELS의 anims와 맞아야 한다
GUARD = {'uarm_L.X': -25, 'farm_L.X': -30}            # 방패 든 왼팔 기본 자세
SWORD_LOW = {'uarm_R.X': -20, 'farm_R.X': -30}         # 방패 공격 중 칼 든 팔
STANCE = {'thigh_L.X': -15, 'thigh_R.X': 12, 'shin_R.X': 10}
TUCK = {'spine.X': 40, 'chest.X': 25, 'head.X': 20, 'thigh_L.X': -100, 'thigh_R.X': -100, 'shin_L.X': 120, 'shin_R.X': 120,
        'uarm_L.X': -60, 'uarm_R.X': -60, 'farm_L.X': -60, 'farm_R.X': -60}
BIPED_KEYS = {
    # 주무기 1타: 오른쪽에서 왼쪽으로 가로 베기
    'slash1': [
        {**GUARD, **STANCE, 'uarm_R.X': -70, 'uarm_R.Z': -45, 'farm_R.X': -25, 'spine.Z': -25},
        {**GUARD, **STANCE, 'uarm_R.X': -82, 'uarm_R.Z': -15, 'farm_R.X': -10, 'spine.Z': -8},
        {**GUARD, **STANCE, 'uarm_R.X': -88, 'uarm_R.Z': 35, 'farm_R.X': 0, 'spine.Z': 18, 'dy': -0.02},
        {**GUARD, **STANCE, 'uarm_R.X': -75, 'uarm_R.Z': 60, 'farm_R.X': -5, 'spine.Z': 28, 'dy': -0.02},
        {**GUARD, **STANCE, 'uarm_R.X': -40, 'uarm_R.Z': 25, 'farm_R.X': -15, 'spine.Z': 10},
    ],
    # 주무기 2타: 되돌려 베기 (왼쪽에서 오른쪽)
    'slash2': [
        {**GUARD, **STANCE, 'uarm_R.X': -80, 'uarm_R.Z': 55, 'farm_R.X': -20, 'spine.Z': 25},
        {**GUARD, **STANCE, 'uarm_R.X': -86, 'uarm_R.Z': 25, 'farm_R.X': -5, 'spine.Z': 10},
        {**GUARD, **STANCE, 'uarm_R.X': -88, 'uarm_R.Z': -30, 'farm_R.X': 0, 'spine.Z': -15, 'dy': -0.02},
        {**GUARD, **STANCE, 'uarm_R.X': -72, 'uarm_R.Z': -58, 'farm_R.X': -5, 'spine.Z': -25, 'dy': -0.02},
        {**GUARD, **STANCE, 'uarm_R.X': -35, 'uarm_R.Z': -20, 'farm_R.X': -15, 'spine.Z': -8},
    ],
    # 주무기 3타: 크게 들어 내려찍기
    'slash3': [
        {**GUARD, 'uarm_R.X': -120, 'farm_R.X': -50, 'spine.X': -8},
        {**GUARD, 'uarm_R.X': -165, 'farm_R.X': -70, 'spine.X': -12, 'thigh_L.X': -10},
        {**GUARD, 'uarm_R.X': -170, 'farm_R.X': -75, 'spine.X': -14, 'thigh_L.X': -15, 'dz': 0.01},
        {**GUARD, 'uarm_R.X': -60, 'farm_R.X': 0, 'spine.X': 15, 'thigh_L.X': -30, 'thigh_R.X': 15, 'shin_R.X': 15, 'dy': -0.04, 'dz': -0.02},
        {**GUARD, 'uarm_R.X': -32, 'farm_R.X': 0, 'spine.X': 20, 'thigh_L.X': -30, 'thigh_R.X': 15, 'shin_R.X': 15, 'dy': -0.04, 'dz': -0.03},
        {**GUARD, 'uarm_R.X': -25, 'farm_R.X': -5, 'spine.X': 12, 'thigh_L.X': -20, 'thigh_R.X': 10, 'dy': -0.03, 'dz': -0.02},
        {**GUARD, 'uarm_R.X': -15, 'farm_R.X': -10, 'spine.X': 4, 'thigh_L.X': -10, 'dy': -0.01},
    ],
    # 보조무기 1타: 방패 밀치기
    'bash1': [
        {**SWORD_LOW, 'uarm_L.X': -30, 'farm_L.X': -70, 'spine.Z': 15, 'thigh_R.X': 10},
        {**SWORD_LOW, 'uarm_L.X': -60, 'farm_L.X': -40, 'spine.Z': 0, 'thigh_L.X': -10},
        {**SWORD_LOW, 'uarm_L.X': -85, 'farm_L.X': -5, 'spine.Z': -25, 'thigh_L.X': -28, 'thigh_R.X': 12, 'dy': -0.04},
        {**SWORD_LOW, 'uarm_L.X': -85, 'farm_L.X': -5, 'spine.Z': -25, 'thigh_L.X': -28, 'thigh_R.X': 12, 'dy': -0.05},
        {**SWORD_LOW, 'uarm_L.X': -45, 'farm_L.X': -30, 'spine.Z': -8, 'thigh_L.X': -10, 'dy': -0.02},
    ],
    # 보조무기 2타: 방패로 올려치기 (적을 날린다)
    'bash2': [
        {**SWORD_LOW, 'uarm_L.X': -40, 'farm_L.X': -60, 'spine.Z': 25, 'thigh_L.X': -20, 'shin_L.X': 25, 'thigh_R.X': 10, 'shin_R.X': 25, 'dz': -0.03},
        {**SWORD_LOW, 'uarm_L.X': -65, 'uarm_L.Z': -15, 'farm_L.X': -40, 'spine.Z': 10, 'thigh_L.X': -20, 'shin_L.X': 25, 'dz': -0.03},
        {**SWORD_LOW, 'uarm_L.X': -125, 'farm_L.X': -20, 'spine.Z': -20, 'spine.X': -8, 'thigh_L.X': -25, 'dy': -0.04, 'dz': 0.01},
        {**SWORD_LOW, 'uarm_L.X': -135, 'farm_L.X': -15, 'spine.Z': -22, 'spine.X': -10, 'thigh_L.X': -25, 'dy': -0.05, 'dz': 0.01},
        {**SWORD_LOW, 'uarm_L.X': -70, 'farm_L.X': -35, 'spine.Z': -10, 'thigh_L.X': -12, 'dy': -0.03},
        {**SWORD_LOW, 'uarm_L.X': -35, 'farm_L.X': -30, 'spine.Z': -3, 'dy': -0.01},
    ],
    # 회피: 앞구르기. 몸을 말고 골반을 축으로 한 바퀴
    'roll': [
        {**TUCK, 'pelvis.X': 25, 'dz': -0.10},
        {**TUCK, 'pelvis.X': 110, 'dz': -0.22},
        {**TUCK, 'pelvis.X': 200, 'dz': -0.26},
        {**TUCK, 'pelvis.X': 290, 'dz': -0.22},
        {**TUCK, 'pelvis.X': 345, 'dz': -0.10},
        {**GUARD, 'spine.X': 15, 'thigh_L.X': -30, 'shin_L.X': 40, 'thigh_R.X': -10, 'shin_R.X': 40, 'dz': -0.04},
    ],
    'hit': [
        {**GUARD, 'spine.X': -14, 'head.X': -12, 'uarm_R.X': 15, 'dy': 0.02},
        {**GUARD, 'spine.X': -9, 'head.X': -6, 'uarm_R.X': 8, 'dy': 0.015},
        {**GUARD, 'spine.X': -3, 'head.X': -2, 'dy': 0.005},
    ],
    # 쓰러짐: 뒤로 넘어간다
    'death': [
        {**GUARD, 'spine.X': -15, 'head.X': -12, 'thigh_L.X': -20, 'shin_L.X': 30, 'dy': 0.02},
        {'pelvis.X': -20, 'thigh_L.X': -35, 'shin_L.X': 50, 'thigh_R.X': -25, 'shin_R.X': 40, 'uarm_L.X': -40, 'uarm_R.X': -50, 'dy': 0.04, 'dz': -0.08},
        {'pelvis.X': -50, 'thigh_L.X': -40, 'shin_L.X': 60, 'thigh_R.X': -30, 'shin_R.X': 50, 'uarm_L.X': -70, 'uarm_R.X': -80, 'dy': 0.07, 'dz': -0.22},
        {'pelvis.X': -80, 'thigh_L.X': -30, 'shin_L.X': 40, 'thigh_R.X': -20, 'shin_R.X': 30, 'uarm_L.X': -100, 'uarm_R.X': -110, 'dy': 0.1, 'dz': -0.36},
        {'pelvis.X': -88, 'thigh_L.X': -15, 'shin_L.X': 20, 'thigh_R.X': -10, 'shin_R.X': 15, 'uarm_L.X': -110, 'uarm_R.X': -120, 'dy': 0.11, 'dz': -0.4},
        {'pelvis.X': -90, 'thigh_L.X': -10, 'shin_L.X': 15, 'thigh_R.X': -5, 'shin_R.X': 10, 'uarm_L.X': -115, 'uarm_R.X': -125, 'dy': 0.11, 'dz': -0.41},
    ],
    # 저주 병사: 크게 들었다가 내려치기 (앞 세 프레임이 예고 동작)
    'attack': [
        {'uarm_L.X': -60, 'farm_L.X': -55, 'uarm_R.X': -100, 'farm_R.X': -40, 'spine.X': -4},
        {'uarm_L.X': -60, 'farm_L.X': -55, 'uarm_R.X': -150, 'farm_R.X': -65, 'spine.X': -10},
        {'uarm_L.X': -60, 'farm_L.X': -55, 'uarm_R.X': -165, 'farm_R.X': -75, 'spine.X': -12, 'dz': 0.01},
        {'uarm_L.X': -50, 'farm_L.X': -50, 'uarm_R.X': -60, 'farm_R.X': 0, 'spine.X': 15, 'thigh_L.X': -28, 'dy': -0.04, 'dz': -0.02},
        {'uarm_L.X': -45, 'farm_L.X': -45, 'uarm_R.X': -30, 'farm_R.X': 0, 'spine.X': 18, 'thigh_L.X': -28, 'dy': -0.04, 'dz': -0.03},
        {'uarm_L.X': -45, 'farm_L.X': -45, 'uarm_R.X': -22, 'farm_R.X': -5, 'spine.X': 10, 'thigh_L.X': -15, 'dy': -0.02},
        {'uarm_L.X': -50, 'farm_L.X': -50, 'uarm_R.X': -15, 'farm_R.X': -10, 'spine.X': 3},
    ],
    # 저주 병사: 방패를 들어 정면을 막는다
    'block': [
        {'uarm_L.X': -78, 'uarm_L.Z': -10, 'farm_L.X': -55, 'spine.Z': -12, 'uarm_R.X': -25, 'farm_R.X': -40, **STANCE, 'dz': -0.02},
        {'uarm_L.X': -80, 'uarm_L.Z': -10, 'farm_L.X': -55, 'spine.Z': -12, 'uarm_R.X': -25, 'farm_R.X': -40, **STANCE, 'dz': -0.025},
        {'uarm_L.X': -78, 'uarm_L.Z': -10, 'farm_L.X': -55, 'spine.Z': -12, 'uarm_R.X': -25, 'farm_R.X': -40, **STANCE, 'dz': -0.02},
    ],
}


def hero_pose(anim, i, n):
    p = {}; t = i / n; s = math.sin(2 * math.pi * t)
    base_l = -25  # 방패를 든 왼팔은 앞으로 조금 든다
    if anim == 'idle':
        add(p, 'chest', 'X', 1.5 * s); add(p, 'uarm_L', 'X', base_l); add(p, 'farm_L', 'X', -30)
        add(p, 'uarm_R', 'X', -10); add(p, 'head', 'X', -1.5 * s)
        p['_root'] = (0, 0, -0.004 * (1 + s))
    elif anim == 'walk':
        ph = 2 * math.pi * t
        for side, off in (('L', 0), ('R', math.pi)):
            a = ph + off
            add(p, 'thigh_' + side, 'X', -28 * math.sin(a))
            add(p, 'shin_' + side, 'X', 50 * max(0.0, math.cos(a)))
        add(p, 'uarm_L', 'X', base_l + 8 * math.sin(ph + math.pi)); add(p, 'farm_L', 'X', -30)
        add(p, 'uarm_R', 'X', -10 + 18 * math.sin(ph)); add(p, 'spine', 'Z', 5 * math.sin(ph)); add(p, 'spine', 'X', 4)
        p['_root'] = (0, 0, -0.012 * (1 + math.cos(2 * ph)) / 2)
    elif anim == 'slash':
        k = [
            dict(u=-110, f=-40, tw=-20, ux=0),
            dict(u=-155, f=-65, tw=-28, ux=0),
            dict(u=-95, f=-10, tw=8, ux=20),
            dict(u=-35, f=0, tw=26, ux=35),
            dict(u=-20, f=-5, tw=14, ux=15),
            dict(u=-10, f=0, tw=4, ux=0),
        ][i]
        add(p, 'uarm_R', 'X', k['u']); add(p, 'uarm_R', 'Z', -k['ux']); add(p, 'farm_R', 'X', k['f'])
        add(p, 'spine', 'Z', k['tw']); add(p, 'uarm_L', 'X', base_l - 10); add(p, 'farm_L', 'X', -40)
        add(p, 'thigh_L', 'X', -15); add(p, 'thigh_R', 'X', 12); add(p, 'shin_R', 'X', 10)
        p['_root'] = (0, -0.02 * (1 if i in (2, 3) else 0), -0.015)
    elif anim in BIPED_KEYS:
        keyed(p, BIPED_KEYS[anim][i])
    return p


# ---------- 장비 (주인공) ----------
def mat(name, rgb, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    return m


def box(name, size, loc, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.active_object
    o.scale = size; bpy.ops.object.transform_apply(scale=True); o.data.materials.append(m); o.name = name
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name
    return o


def attach(o, arm, bone):
    mw = o.matrix_world.copy()
    o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = bone
    bpy.context.view_layer.update()
    o.matrix_world = mw


def build_equipment(arm, body):
    # 색은 선형값이라 화면에서는 더 밝게 보인다. 금속성을 켜면 하늘빛을 반사해 하얗게 날아간다
    steel = mat('steel', (0.13, 0.14, 0.17), 0.0, 0.45); gold = mat('gold', (0.3, 0.18, 0.04), 0.0, 0.5)
    leather = mat('leather', (0.06, 0.03, 0.015)); wood = mat('wood', (0.12, 0.06, 0.025)); navy = mat('navy', (0.03, 0.05, 0.16))
    # 칼: 손에서 아래-앞쪽으로 뻗는다. 모델 좌표에서 +Z가 칼끝이 되게 만든 뒤 방향을 맞춘다
    parts = [box('blade', (0.02, 0.006, 0.30), (0, 0, 0.19), steel), box('guard', (0.075, 0.016, 0.014), (0, 0, 0.035), gold),
             box('grip', (0.015, 0.015, 0.06), (0, 0, 0.0), leather)]
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.014, location=(0, 0, -0.035)); parts.append(bpy.context.active_object); parts[-1].data.materials.append(gold)
    sword = join(parts, 'sword')
    hb = arm.data.bones['hand_R']
    d = (hb.tail_local - hb.head_local).normalized()
    blade_dir = (d + Vector((0, -0.9, 0))).normalized()
    sword.matrix_world = Matrix.Translation(hb.head_local.lerp(hb.tail_local, 0.5)) @ blade_dir.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    attach(sword, arm, 'hand_R')
    # 방패: 왼쪽 아래팔 바깥쪽, 원판이 바깥(+X)을 본다
    bpy.ops.mesh.primitive_cylinder_add(radius=0.085, depth=0.014, vertices=24); disc = bpy.context.active_object; disc.data.materials.append(wood)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.085, minor_radius=0.009); rim = bpy.context.active_object; rim.data.materials.append(steel)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.02, location=(0, 0, 0.01)); boss = bpy.context.active_object; boss.data.materials.append(steel)
    box('emblem', (0.11, 0.03, 0.004), (0, 0, 0.009), navy)
    em = bpy.context.active_object
    shield = join([disc, rim, boss, em], 'shield')
    fb = arm.data.bones['farm_L']
    c = fb.head_local.lerp(fb.tail_local, 0.55) + Vector((0.035, -0.01, 0))
    shield.matrix_world = Matrix.Translation(c) @ Vector((1, -0.35, 0)).normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    attach(shield, arm, 'farm_L')
    # 투구: 머리 윗부분을 덮는 반구
    J = JOINTS[CFG.get('body', 'normal')]
    co = [v.co for v in body.data.vertices if v.co.z > J['helm_z']]
    hc = Vector((sum(v.x for v in co) / len(co), sum(v.y for v in co) / len(co), J['helm_c']))
    r = max(math.hypot(v.x - hc.x, v.y - hc.y) for v in co) * 1.2  # 머리카락이 밖으로 나오지 않게 넉넉히
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=hc, segments=24, ring_count=12); helm = bpy.context.active_object
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
    for v in helm.data.vertices:
        v.select = v.co.z < -0.25 * r
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.delete(type='VERT'); bpy.ops.object.mode_set(mode='OBJECT')
    helm.scale[2] = 1.15
    helm.data.materials.append(steel)
    crest = box('crest', (0.012, r * 1.6, 0.03), hc + Vector((0, 0, r * 0.95)), navy)
    helm = join([helm, crest], 'helmet')
    attach(helm, arm, 'head')
    out = {'sword': sword, 'shield': shield, 'helmet': helm}
    for k in [k for k in out if k not in CFG.get('equip', out)]:  # equip에 없는 장비는 지운다
        bpy.data.objects.remove(out.pop(k), do_unlink=True)
    return out


def toonify(objs, gain=1.0, tint=None, desat=0.0, bands=None):
    """도트 느낌용 셀 셰이딩: 빛을 3단(그늘·중간·밝음)으로 끊고 바탕색에 곱해 발광으로 내보낸다.
    부드러운 3D 명암이 줄어들면 색 수를 줄여도 덩어리가 깔끔하게 남는다.
    tint·desat: 같은 모델을 다른 몬스터로 쓸 때 바탕색을 물들이고 채도를 뺀다."""
    done = set()
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or m.name in done:
                continue
            done.add(m.name); m.use_nodes = True
            nt = m.node_tree; N = nt.nodes
            bsdf = next((n for n in N if n.type == 'BSDF_PRINCIPLED'), None)
            out = next(n for n in N if n.type == 'OUTPUT_MATERIAL')
            base = bsdf.inputs['Base Color'] if bsdf else None
            src = base.links[0].from_socket if base and base.links else None
            diff = N.new('ShaderNodeBsdfDiffuse')
            s2r = N.new('ShaderNodeShaderToRGB'); nt.links.new(diff.outputs[0], s2r.inputs[0])
            ramp = N.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'
            els = ramp.color_ramp.elements
            b0, b1, b2 = bands or ((0.42, 0.42, 0.5), (0.75, 0.74, 0.74), (1.05, 1.02, 0.95))  # 그늘은 푸르게, 밝은 면은 따뜻하게
            els[0].position = 0.0; els[0].color = (*b0, 1)
            els[1].position = 0.18; els[1].color = (*b1, 1)
            e = els.new(0.55); e.color = (*b2, 1)
            nt.links.new(s2r.outputs[0], ramp.inputs[0])
            mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
            if not src:
                rgb = N.new('ShaderNodeRGB'); rgb.outputs[0].default_value = base.default_value if base else (0.5, 0.5, 0.5, 1)
                src = rgb.outputs[0]
            if desat:
                hs = N.new('ShaderNodeHueSaturation'); hs.inputs['Saturation'].default_value = 1 - desat
                nt.links.new(src, hs.inputs['Color']); src = hs.outputs[0]
            if tint:
                tm = N.new('ShaderNodeMix'); tm.data_type = 'RGBA'; tm.blend_type = 'MULTIPLY'; tm.inputs[0].default_value = 1.0
                nt.links.new(src, tm.inputs[6]); tm.inputs[7].default_value = (*tint, 1); src = tm.outputs[2]
            nt.links.new(src, mul.inputs[6])
            nt.links.new(ramp.outputs[0], mul.inputs[7])
            em = N.new('ShaderNodeEmission'); em.inputs[1].default_value = gain
            nt.links.new(mul.outputs[2], em.inputs[0])
            nt.links.new(em.outputs[0], out.inputs[0])


# ---------- 렌더와 후처리 ----------
def render_to(path):
    sc = bpy.context.scene; sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def load_rgba(path):
    img = bpy.data.images.load(path); w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]
    bpy.data.images.remove(img)
    return a


def save_rgba(path, a):
    h, w = a.shape[:2]
    img = bpy.data.images.new('out', w, h, alpha=True)
    img.pixels[:] = np.ascontiguousarray(a[::-1]).ravel()
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)


def shrink(a, f=SUPER):
    h, w = a.shape[0] // f, a.shape[1] // f
    b = a.reshape(h, f, w, f, 4)
    al = b[..., 3].mean(axis=(1, 3))
    rgb = (b[..., :3] * b[..., 3:4]).sum(axis=(1, 3)) / np.maximum(b[..., 3].sum(axis=(1, 3)), 1e-6)[..., None]
    out = np.zeros((h, w, 4), np.float32); out[..., :3] = rgb
    out[..., 3] = (al >= 0.45).astype(np.float32)
    return out


def kmeans(px, k, it=15):
    rng = np.random.default_rng(7)
    if len(px) > 30000:
        px = px[rng.choice(len(px), 30000, replace=False)]
    c = px[rng.choice(len(px), 1)]
    for _ in range(1, k):  # k-means++ 초기값
        d = ((px[:, None] - c[None]) ** 2).sum(-1).min(1)
        c = np.vstack([c, px[rng.choice(len(px), 1, p=d / d.sum())]])
    for _ in range(it):
        lab = ((px[:, None] - c[None]) ** 2).sum(-1).argmin(1)
        for j in range(k):
            if (lab == j).any():
                c[j] = px[lab == j].mean(0)
    return c


def quantize(a, pal):
    m = a[..., 3] > 0
    px = a[m][:, :3]
    lab = ((px[:, None] - pal[None]) ** 2).sum(-1).argmin(1)
    a = a.copy(); a[m, :3] = pal[lab]
    return a


def to_lab(rgb):
    """sRGB(0~1) → Lab. 공용 팔레트에서 가장 가까운 색을 사람 눈 기준으로 고르려고 쓴다."""
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    xyz = c @ np.array([[0.4124, 0.2126, 0.0193], [0.3576, 0.7152, 0.1192], [0.1805, 0.0722, 0.9505]])
    xyz /= np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def load_palette(outline_only=False):
    """outline_only: 테두리 후보만 (각 줄의 가장 어두운 색, 땅 색인 초록은 뺀다)"""
    with open(os.path.join(ROOT, 'art/palette.json'), encoding='utf-8') as f:
        p = json.load(f)
    if outline_only:
        hexes = [ramp[0] for name, ramp in p['ramps'].items() if name != 'green']
    else:
        hexes = [h for ramp in p['ramps'].values() for h in ramp]
    return np.array([[int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)] for h in hexes], np.float32)


def nearest(rgb, pal):
    L, P = to_lab(rgb), to_lab(pal)
    return ((L[:, None] - P[None]) ** 2).sum(-1).argmin(1)


def pick_from_palette(px, pal, k):
    """이 스프라이트가 쓸 색 k개를 공용 팔레트에서 고른다 (많이 쓰이는 순)."""
    idx = nearest(px, pal)
    order = np.argsort(-np.bincount(idx, minlength=len(pal)))
    return pal[order[:k]]


def clean_orphans(a):
    """둘레 4칸 어디에도 같은 색이 없는 외톨이 점을 주변에서 가장 많은 색으로 바꾼다. 손도트처럼 덩어리가 깔끔해진다."""
    h, w = a.shape[:2]
    op = a[..., 3] > 0
    key = (np.round(a[..., 0] * 255).astype(np.int32) << 16) | (np.round(a[..., 1] * 255).astype(np.int32) << 8) | np.round(a[..., 2] * 255).astype(np.int32)
    out = a.copy()
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if not op[y, x]:
                continue
            k = key[y, x]
            if any(op[y + dy, x + dx] and key[y + dy, x + dx] == k for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                continue
            cnt = {}
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if (dy or dx) and op[y + dy, x + dx]:
                        cnt[key[y + dy, x + dx]] = cnt.get(key[y + dy, x + dx], 0) + 1
            if cnt:
                best, n = max(cnt.items(), key=lambda t: t[1])
                if n >= 3:
                    yy, xx = next((y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and op[y + dy, x + dx] and key[y + dy, x + dx] == best)
                    out[y, x, :3] = a[yy, xx, :3]
    return out


def outline(a, block=None, pal=None):
    """투명 칸 중 불투명 칸과 맞닿은 곳에 이웃 색을 어둡게 한 테두리를 넣는다. block이 불투명한 칸에는 넣지 않는다.
    pal을 주면 테두리 색도 그 팔레트에서 가장 가까운 색으로 맞춘다."""
    op = a[..., 3] > 0
    acc = np.zeros(a.shape[:2] + (3,), np.float32); cnt = np.zeros(a.shape[:2], np.float32)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(op, dy, 0), dx, 1); col = np.roll(np.roll(a[..., :3], dy, 0), dx, 1)
        acc += col * sh[..., None]; cnt += sh
    edge = (~op) & (cnt > 0)
    if block is not None:
        edge &= ~(block[..., 3] > 0)
    a = a.copy()
    a[edge, :3] = acc[edge] / cnt[edge][:, None] * 0.3 + np.array([0.02, 0.01, 0.05]) * 0.7
    if pal is not None and edge.any():
        a[edge, :3] = pal[nearest(a[edge, :3], pal)]
    a[edge, 3] = 1
    return a


def main():
    t_all = time.time()
    common.reset()
    t0 = time.time()
    body = common.import_glb(os.path.join(ROOT, CFG['glb']), height=CFG['height'], rot_z_deg=CFG['rot'])
    if CFG.get('mirror'):
        common.symmetrize(body)
    bones = quad_bones(body) if CFG['kind'] == 'quad' else biped_bones(body)
    arm = build_armature(bones)
    skin(body, arm)
    tick('rig', t0)
    equip = build_equipment(arm, body) if CFG['kind'] == 'biped' else {}
    if TOON:
        toonify([body, *equip.values()], CFG.get('toon_gain', 1.0), CFG.get('tint'), CFG.get('desat', 0.0), CFG.get('bands'))
    # merge: 장비를 바꿀 일이 없는 몬스터는 몸과 장비를 한 장으로 굽는다 (렌더 수가 1/4)
    layers = {'body': body} if CFG.get('merge') else {'body': body, **equip}
    pose_fn = wolf_pose if CFG['kind'] == 'quad' else hero_pose

    size = 512 if TEST else max(FRAMES) * SUPER
    sc = common.setup_render(size)
    sc.render.film_transparent = True
    key, rim, amb = CFG['light']  # 해·테두리광·하늘빛 세기. 털이 검은 늑대는 밝게, 금속이 있는 주인공은 약하게
    common.add_sun(rot=(55, 0, -35), strength=key)
    common.add_sun(rot=(-60, 0, 150), strength=rim)  # 뒤쪽 테두리광: 어두운 몸이 배경과 갈라지게
    bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[1].default_value = amb
    cam = common.add_ortho_camera(CFG['target_z'], ORTHO, CFG.get('pitch', PITCH))  # 인물은 낮은 각도로 찍어야 얼굴이 보인다
    from bpy_extras.object_utils import world_to_camera_view
    g = world_to_camera_view(sc, cam, Vector((0, 0, 0)))
    raw = os.path.join(ROOT, 'art/sprites/_test' if TEST else 'art/sprites/_raw', f"{NAME}{'_toon' if TOON else ''}_{size}")
    os.makedirs(raw, exist_ok=True)
    dirs = [DIRS[0], DIRS[2]] if TEST else DIRS
    t0 = time.time(); count = 0
    for anim, (nf, fps, loop) in ({} if SKIP_RENDER else CFG['anims']).items():
        for i in range(nf):
            apply_pose(arm, pose_fn(anim, i, nf))
            for dname, deg in dirs:
                arm.rotation_euler[2] = math.radians(deg)
                for ln, lo in layers.items():
                    if TEST and ln != 'body':
                        continue
                    for on, oo in layers.items():
                        oo.hide_render = not (on == ln or (on == 'body' and ln != 'body') or TEST)
                        oo.is_holdout = (on == 'body' and ln != 'body')
                    render_to(os.path.join(raw, f'{ln}_{anim}_{dname}_{i}.png')); count += 1
    tick(f'render ({count})', t0)
    if TEST:
        return

    # 후처리: 축소 → 팔레트 → 외톨이 점 정리 → 테두리 → 시트. 칸 크기마다 따로 만든다
    full = load_palette() if PAL else None
    edge_pal = load_palette(outline_only=True) if PAL else None
    big = {}
    for ln in layers:
        for anim, (nf, _, _) in CFG['anims'].items():
            for dname, _ in DIRS:
                for i in range(nf):
                    big[(ln, anim, dname, i)] = load_rgba(os.path.join(raw, f'{ln}_{anim}_{dname}_{i}.png'))
    for F in FRAMES:
        t0 = time.time()
        out = os.path.join(ROOT, 'art/sprites', OUT + (f'_{F}' if '--frames' in argv else '')); os.makedirs(out, exist_ok=True)
        small = {k: shrink(v, size // F) for k, v in big.items()}
        anchor = [round(g.x * F, 1), round((1 - g.y) * F, 1)]
        meta = {'frame': F, 'anchor': anchor, 'dirs': [d for d, _ in DIRS], 'layers': list(layers), 'anims': {}, 'palette': {}}
        for ln in layers:
            px = np.concatenate([v[v[..., 3] > 0][:, :3] for k, v in small.items() if k[0] == ln])
            k = CFG['colors'][ln] * 2 // 3 if TOON else CFG['colors'][ln]  # 셀 셰이딩은 색이 덜 필요하다
            pal = pick_from_palette(px, full, k) if PAL else kmeans(px, k)
            meta['palette'][ln] = [('#%02x%02x%02x' % tuple(np.round(np.clip(c, 0, 1) * 255).astype(int))) for c in pal]
            for anim, (nf, fps, loop) in CFG['anims'].items():
                sheet = np.zeros((F * len(DIRS), F * nf, 4), np.float32)
                for r, (dname, _) in enumerate(DIRS):
                    for i in range(nf):
                        a = small[(ln, anim, dname, i)]
                        if PAL:
                            m = a[..., 3] > 0
                            a = a.copy(); a[m, :3] = pal[nearest(a[m][:, :3], pal)]
                            a = clean_orphans(a)
                        else:
                            a = quantize(a, pal)
                        a = outline(a, block=None if ln == 'body' else small[('body', anim, dname, i)], pal=edge_pal)
                        sheet[r * F:(r + 1) * F, i * F:(i + 1) * F] = a
                save_rgba(os.path.join(out, f'{ln}_{anim}.png'), sheet)
                meta['anims'][anim] = {'frames': nf, 'fps': fps, 'loop': loop}
        tick(f'post {F}', t0)
        T['total'] = round(time.time() - t_all, 1)
        meta['bake_seconds'] = dict(T)
        with open(os.path.join(out, f'{NAME}.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
    print('[done]', json.dumps(T))


if __name__ == "__main__":
    main()
