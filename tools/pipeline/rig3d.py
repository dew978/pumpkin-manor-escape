# TRELLIS 모델에 뼈대·가중치·칼을 붙이고 동작을 키로 넣어 게임용 GLB로 내보낸다 (3D 캐릭터, 2026-10-18).
# blender -b --factory-startup -P rig3d.py -- <이름>
#   뼈대·가중치·동작 키는 bake.py(도트 시절)의 것을 그대로 쓴다. 렌더·도트화는 하지 않는다.
# 결과: game/models/<이름>.glb (메시 + 뼈대 + 칼 + 동작 클립), 확인용 art/3d/<이름>/rig_check.png
import bpy, sys, os, math
from mathutils import Vector, Matrix
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
NAME = sys.argv[sys.argv.index('--') + 1]
ATTACH_CHECK = '--attach-check' in sys.argv   # 카일 몸에 장비 부품을 붙여 렌더만 한다 (art/3d/equip/_attach)
ATTACH_SET = sys.argv[sys.argv.index('--attach-set') + 1].split(',') if '--attach-set' in sys.argv else []   # 주면 이 부품들을 한 몸에 함께 붙여 art/3d/equip/_bodies/<이름>_<k>.png로 렌더한다
JSON_ONLY = '--json-only' in sys.argv   # 동작 표 json만 쓴다 (GLB는 다시 만들지 않는다)
sys.argv = [sys.argv[0], '--', 'herochibi']
g = {'__name__': 'lib', '__file__': os.path.join(HERE, 'bake.py')}
exec(compile(open(g['__file__'], encoding='utf-8').read(), g['__file__'], 'exec'), g)
common = g['common']

# SD 체형: 머리가 키의 약 38%. 관절 높이는 모델 단면 폭을 재서 정했다 (목 0.62에서 가장 좁고, 손은 0.24~0.3)
g['JOINTS']['sd'] = dict(pelvis=0.30, spine=0.36, chest=0.44, neck=0.58, head=0.62, shoulder=0.52, hip=0.29, knee=0.17,
                         ankle=0.05, hand_band=(0.22, 0.42), shoulder_frac=0.55, helm_z=0.8, helm_c=0.85)
# 몬스터 체형. 높이는 probe.txt의 높이 띠 폭(목이 가장 좁은 곳, 손 높이, 다리 사이가 벌어지는 높이)으로 정했다 (근거는 MODELS 주석)
g['JOINTS']['ghoul'] = dict(pelvis=0.29, spine=0.36, chest=0.44, neck=0.60, head=0.63, shoulder=0.50, hip=0.28, knee=0.16, ankle=0.05,
                            hand_band=(0.22, 0.44), shoulder_frac=0.55, helm_z=0.8, helm_c=0.85)
g['JOINTS']['jailer'] = dict(pelvis=0.34, spine=0.43, chest=0.55, neck=0.70, head=0.73, shoulder=0.64, hip=0.30, knee=0.17, ankle=0.05,
                             hand_band=(0.18, 0.40), shoulder_frac=0.72, helm_z=0.8, helm_c=0.88)
g['JOINTS']['corpse'] = dict(pelvis=0.30, spine=0.38, chest=0.50, neck=0.65, head=0.68, shoulder=0.60, hip=0.23, knee=0.13, ankle=0.04,
                             hand_band=(0.2, 0.45), shoulder_frac=0.65, helm_z=0.8, helm_c=0.85)
g['JOINTS']['hargen2'] = dict(pelvis=0.34, spine=0.42, chest=0.53, neck=0.70, head=0.74, shoulder=0.68, hip=0.32, knee=0.18, ankle=0.05,
                              hand_band=(0.22, 0.42), shoulder_frac=0.65, helm_z=0.8, helm_c=0.88)
# SD 기사 (Scenario 데이터셋 후보, 2026-10-25): 투구가 커서 키의 절반이 머리다. probe 그림에서 턱 z 0.47, 어깨 0.40, 허리띠 0.24, 다리는 0.2 아래
g['JOINTS']['knight'] = dict(pelvis=0.20, spine=0.26, chest=0.33, neck=0.44, head=0.47, shoulder=0.40, hip=0.19, knee=0.10, ankle=0.03,
                             hand_band=(0.22, 0.38), shoulder_frac=0.6, helm_z=0.8, helm_c=0.85)
# 두건 망령 (Scenario 후보, 2026-10-26): SD가 아니라 보통 사람 비율. 목이 z 0.72(폭 0.26)에서 가장 좁고 두건이 0.75~0.9, 팔은 0.42~0.6에서 옆으로 벌렸다. 로브가 바닥까지 닿는다
g['JOINTS']['wraith'] = dict(pelvis=0.40, spine=0.48, chest=0.58, neck=0.72, head=0.75, shoulder=0.67, hip=0.38, knee=0.20, ankle=0.04,
                             hand_band=(0.42, 0.62), shoulder_frac=0.5, helm_z=0.8, helm_c=0.88)
# 동작 → (키 수, 초당 키, 반복). bake.py 동작 함수가 i/n으로 키를 만든다. 반복 동작은 처음 키를 끝에 한 번 더 넣어 이음매를 없앤다
HERO_ANIMS = {'idle': (8, 6, True), 'walk': (16, 16, True), 'slash1': (5, 18, False), 'slash2': (5, 18, False), 'slash3': (7, 16, False),
              'bash1': (5, 16, False), 'bash2': (6, 16, False), 'roll': (6, 18, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
SOLDIER_ANIMS = {'idle': (8, 6, True), 'walk': (16, 16, True), 'attack': (7, 12, False), 'block': (3, 6, True), 'guardwalk': (16, 16, True),
                 'hit': (3, 12, False), 'death': (6, 10, False)}
# 늑대: 2D 시트와 같은 동작. 반복 동작은 키를 두 배로 늘리고 초당 키도 두 배로 해 한 바퀴 길이를 2D와 같게 둔다.
# attack·hit·death는 wolf_pose가 키 번호로 표를 읽어서 키 수를 바꿀 수 없다
WOLF_ANIMS = {'idle': (8, 12, True), 'walk': (16, 24, True), 'attack': (7, 14, False), 'hit': (3, 12, False), 'death': (6, 10, False)}

# ---------------------------------------------------------------------------------------------------------------
# 몬스터 12종 (2026-10-18). 동작 표는 docs/3D-캐릭터.md "몬스터 모델"의 이름·키 수·초당 키·반복을 따른다.
# 큰 몸(감옥지기·망자·변신한 하르겐)은 같은 각도라도 무겁게 보이게 초당 키를 낮춰(10 이하) 템포를 늦춘다.
# ---------------------------------------------------------------------------------------------------------------
GUARD_ANIMS = {'idle': (8, 6, True), 'walk': (16, 16, True), 'attack': (7, 12, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
GHOUL_ANIMS = {'idle': (8, 6, True), 'walk': (16, 12, True), 'throw': (5, 12, False), 'smash': (7, 12, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
JAILER_ANIMS = {'idle': (8, 5, True), 'walk': (16, 10, True), 'throw': (5, 10, False), 'slam': (7, 10, False), 'sweep': (6, 12, False),
                'hit': (3, 10, False), 'death': (6, 8, False)}
HUNTER_ANIMS = {'idle': (8, 6, True), 'walk': (16, 16, True), 'stab': (4, 14, False), 'vanish': (3, 10, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
PRIEST_ANIMS = {'idle': (8, 6, True), 'walk': (16, 14, True), 'cast': (4, 6, True), 'lash': (5, 12, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
CORPSE_ANIMS = {'idle': (8, 6, True), 'walk': (16, 12, True), 'swell': (4, 12, True), 'hit': (3, 12, False), 'death': (6, 10, False)}
HARGEN_ANIMS = {'idle': (8, 6, True), 'walk': (16, 16, True), 'slash1': (5, 18, False), 'slash2': (5, 18, False), 'slash3': (7, 16, False),
                'thrust': (5, 14, False), 'block': (3, 6, True), 'kneel': (4, 6, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
HARGEN2_ANIMS = {'idle': (8, 5, True), 'walk': (16, 10, True), 'cleave': (7, 10, False), 'raise': (4, 8, False), 'roar': (5, 10, False),
                 'hit': (3, 10, False), 'death': (6, 8, False)}
RAT_ANIMS = {'idle': (8, 12, True), 'walk': (16, 24, True), 'attack': (7, 14, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
TOAD_ANIMS = {'idle': (8, 8, True), 'walk': (12, 16, True), 'attack': (7, 12, False), 'hop': (6, 12, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
BAT_ANIMS = {'fly': (8, 16, True), 'dive': (3, 10, False), 'hit': (3, 12, False), 'death': (6, 10, False)}
VINE_ANIMS = {'idle': (8, 6, True), 'whip': (5, 14, False), 'hit': (3, 12, False), 'death': (6, 10, False)}

add = g['add']; keyed = g['keyed']; BK = g['BIPED_KEYS']

# ---- 호박 저택 탈출: 분장한 아이들 (2026-10-26) ----
# probe.txt 높이 띠 폭으로 정했다. 모자를 쓴 마녀·호박은 머리가 낮다: 목이 z 0.51에서 가장 좁고, 손 z 0.24~0.33, 치마·옷 밑단 0.21~0.24
g['JOINTS']['kid_hat'] = dict(pelvis=0.26, spine=0.32, chest=0.39, neck=0.50, head=0.53, shoulder=0.45, hip=0.25, knee=0.13, ankle=0.04,
                                hand_band=(0.2, 0.38), shoulder_frac=0.55, helm_z=0.8, helm_c=0.85)
# 흡혈귀·미라: 카일 sd와 거의 같다(목 z 0.60, 손 0.27~0.36)
g['JOINTS']['kid'] = dict(pelvis=0.30, spine=0.37, chest=0.45, neck=0.59, head=0.62, shoulder=0.53, hip=0.29, knee=0.16, ankle=0.05,
                            hand_band=(0.22, 0.42), shoulder_frac=0.55, helm_z=0.8, helm_c=0.85)
# 동작: 서기·걷기·달리기(게임 기본 이동)·잡힘. 태블릿용이라 키 수를 줄였다
KID_ANIMS = {'idle': (8, 6, True), 'walk': (12, 14, True), 'run': (10, 18, True), 'hit': (3, 12, False)}
KID_IDLE = dict(stoop=1, breath=2.0, sway=1.5, armx=-4, armf=-12, armamp=3, bob=0.006)
KID_WALK = dict(leg=30, knee=55, arm=26, armx=-4, armf=-20, stoop=3, twist=6, bob=0.02)
KID_RUN = dict(leg=44, knee=88, arm=48, armx=-2, armf=-65, stoop=11, headk=0.9, twist=9, bob=0.035)


def kid_pose(anim, i, n):
    if anim == 'idle':
        return gen_idle(i, n, KID_IDLE)
    if anim == 'walk':
        return gen_walk(i, n, KID_WALK)
    if anim == 'run':
        return gen_walk(i, n, KID_RUN)
    return g['hero_pose'](anim, i, n)   # 맞음(잡힘)은 주인공 키
KID_CHECK = [('idle', 0, 8), ('walk', 3, 12), ('walk', 9, 12), ('run', 2, 10), ('run', 7, 10), ('hit', 1, 3)]
SOFT = lambda x: 0.0 if x <= 0 else 1.0 if x >= 1 else x * x * (3 - 2 * x)   # 0~1 부드러운 계단 (가중치 이음매용)


# ----- 사람형 서기·걷기 (스타일 값으로 몬스터마다 다르게) -----
def gen_idle(i, n, st):
    """stoop 구부정함(도), breath 숨, sway 몸 좌우 비틀기, roll 좌우 기울기, armx/armf 팔 기본 각도, armamp 팔 흔들림, spread 팔 벌림, bob 오르내림"""
    p = {}; ph = 2 * math.pi * i / n; s = math.sin(ph)
    stoop, breath = st.get('stoop', 2), st.get('breath', 1.5)
    add(p, 'spine', 'X', stoop); add(p, 'chest', 'X', stoop * 0.5 + breath * s); add(p, 'head', 'X', -stoop * st.get('headk', 0.8) - breath * s)
    add(p, 'spine', 'Z', st.get('sway', 0) * s); add(p, 'head', 'Z', -st.get('sway', 0) * 0.7 * s); add(p, 'spine', 'Y', st.get('roll', 0) * s)
    for side, off in (('L', math.pi), ('R', 0)):
        add(p, 'uarm_' + side, 'X', st.get('armx', -8) + st.get('armamp', 3) * math.sin(ph + off)); add(p, 'farm_' + side, 'X', st.get('armf', -15))
        if st.get('spread'):
            add(p, 'uarm_' + side, 'Y', -st['spread'] if side == 'L' else st['spread'])
    p['_root'] = (0, 0, -st.get('bob', 0.004) * (1 + s))
    return p


def gen_walk(i, n, st):
    """leg 다리 흔들기, knee 무릎 굽힘, drag 오른다리가 끌리는 정도(1이면 정상, 작을수록 끌림), arm 팔 흔들기, twist 어깨 비틀기, roll 뒤뚱,
    stoop 구부정함, bob 몸 오르내림"""
    p = {}; ph = 2 * math.pi * i / n
    amp, knee, dr = st.get('leg', 28), st.get('knee', 50), st.get('drag', 1.0)
    for side, off in (('L', 0), ('R', math.pi)):
        a = ph + off; k = dr if side == 'R' else 1.0
        add(p, 'thigh_' + side, 'X', -amp * k * math.sin(a) + (st.get('dragbias', 0) if side == 'R' else 0))
        add(p, 'shin_' + side, 'X', knee * k * max(0.0, math.cos(a)))
        # 같은 쪽 다리가 앞이면 팔은 뒤로 (반대편 팔다리가 함께 나간다)
        add(p, 'uarm_' + side, 'X', st.get('armx', -8) + st.get('arm', 18) * math.sin(a)); add(p, 'farm_' + side, 'X', st.get('armf', -15))
        if st.get('spread'):
            add(p, 'uarm_' + side, 'Y', -st['spread'] if side == 'L' else st['spread'])
    stoop = st.get('stoop', 4)
    add(p, 'spine', 'X', stoop); add(p, 'chest', 'X', stoop * 0.5); add(p, 'head', 'X', -stoop * st.get('headk', 0.8))
    add(p, 'spine', 'Z', st.get('twist', 5) * math.sin(ph)); add(p, 'head', 'Z', -st.get('twist', 5) * 0.6 * math.sin(ph))
    if st.get('roll'):
        add(p, 'pelvis', 'Y', st['roll'] * math.cos(ph)); add(p, 'spine', 'Y', -st['roll'] * 0.9 * math.cos(ph))
    p['_root'] = (0, 0, -st.get('bob', 0.012) * (1 - math.cos(2 * ph)) / 2)
    return p


def crouch_b(a):
    """웅크리기: 허벅지를 앞으로 a도, 정강이를 뒤로 2a도 꺾으면 발이 제자리에 남고 엉덩이만 내려간다 (내려가는 높이는 다리 두 마디 0.12씩)"""
    return {'thigh_L.X': -a, 'thigh_R.X': -a, 'shin_L.X': 2 * a, 'shin_R.X': 2 * a, 'dz': -0.24 * (1 - math.cos(math.radians(a)))}


def make_poser(idle=None, walk=None, keys=None, alias=None):
    keys = keys or {}; alias = alias or {}
    def f(anim, i, n):
        if anim in keys:
            return keyed({}, keys[anim][i])
        if anim == 'idle' and idle:
            return gen_idle(i, n, idle)
        if anim == 'walk' and walk:
            return gen_walk(i, n, walk)
        return g['hero_pose'](alias.get(anim, anim), i, n)   # 병사 내려치기(attack)·맞음·쓰러짐·주인공 slash 등 bake.py 키
    return f


# ----- 새 사람형 동작 키 (축은 bake.py keyed와 같다: X 음수 = 팔이 앞으로, spine.Z 음수 = 왼어깨가 앞으로) -----
def throw_keys(s=1.0, stoop=0, dz=0.0):
    """오른팔을 뒤로 젖혔다 앞으로 뻗어 던진다. s는 크기, stoop은 기본 구부정함"""
    S = lambda d: {'spine.X': d['spine.X'] * s + stoop, **{k: v for k, v in d.items() if k != 'spine.X'}}
    return [
        S({'uarm_R.X': 70 * s, 'farm_R.X': -50, 'spine.Z': -25 * s, 'spine.X': -8, 'uarm_L.X': -20, 'dy': 0.01, 'dz': dz}),
        S({'uarm_R.X': 105 * s, 'farm_R.X': -25, 'spine.Z': -38 * s, 'spine.X': -14, 'uarm_L.X': -35, 'dy': 0.02, 'dz': dz}),
        S({'uarm_R.X': -95 * s, 'farm_R.X': -15, 'spine.Z': 18 * s, 'spine.X': 14, 'uarm_L.X': -10, 'dy': -0.03, 'dz': dz}),
        S({'uarm_R.X': -150 * s, 'farm_R.X': 0, 'spine.Z': 28 * s, 'spine.X': 22, 'dy': -0.05, 'dz': dz - 0.01}),
        S({'uarm_R.X': -80, 'farm_R.X': -20, 'spine.Z': 10, 'spine.X': 10, 'dy': -0.02, 'dz': dz}),
    ]


def both_arms(x, f, spine, **kw):
    return {'uarm_L.X': x, 'uarm_R.X': x, 'farm_L.X': f, 'farm_R.X': f, 'spine.X': spine, **kw}


# 감옥지기: 두 팔을 머리 위로 들었다 내리찍기 (무겁게: 들고 버티는 키가 두 개)
SLAM_KEYS = [
    both_arms(-100, -40, -5, **{'thigh_L.X': -10}),
    both_arms(-160, -70, -14, **{'thigh_L.X': -15, 'dz': 0.01}),
    both_arms(-172, -75, -18, **{'thigh_L.X': -18, 'dz': 0.02}),
    both_arms(-55, 0, 26, **{'thigh_L.X': -32, 'thigh_R.X': 16, 'shin_R.X': 16, 'dy': -0.05, 'dz': -0.045}),
    both_arms(-38, 0, 32, **{'thigh_L.X': -32, 'thigh_R.X': 16, 'shin_R.X': 16, 'dy': -0.05, 'dz': -0.055}),
    both_arms(-30, -5, 20, **{'thigh_L.X': -20, 'thigh_R.X': 10, 'dy': -0.03, 'dz': -0.03}),
    both_arms(-20, -10, 6, **{'thigh_L.X': -8, 'dy': -0.01}),
]
# 감옥지기: 두 팔을 양옆으로 벌리고 몸을 비튼다 (게임이 몸도 돌린다). Y: 왼팔 음수·오른팔 양수가 옆으로 벌림
def sweep_key(spread, twist, **kw):
    return {'uarm_L.Y': -spread, 'uarm_R.Y': spread, 'uarm_L.X': -25, 'uarm_R.X': -25, 'farm_L.X': -15, 'farm_R.X': -15, 'spine.Z': twist, **kw}
SWEEP_KEYS = [
    sweep_key(50, -35, **{'spine.X': 6}), sweep_key(80, -48, **{'spine.X': 8, 'thigh_L.X': -10}),
    sweep_key(88, 28, **{'spine.X': 8, 'thigh_L.X': -14, 'dy': -0.02}), sweep_key(85, 48, **{'spine.X': 8, 'thigh_L.X': -14, 'dy': -0.03}),
    sweep_key(70, 32, **{'spine.X': 6, 'dy': -0.02}), sweep_key(40, 10, **{'spine.X': 4}),
]
# 사냥꾼: 웅크렸다 짧게 찌르기 / 웅크려 사라지기
STAB_KEYS = [
    {**crouch_b(40), 'spine.X': 25, 'chest.X': 10, 'head.X': -15, 'uarm_R.X': -20, 'farm_R.X': -100, 'uarm_L.X': -30},
    {**crouch_b(55), 'spine.X': 30, 'chest.X': 12, 'head.X': -18, 'uarm_R.X': -10, 'farm_R.X': -112, 'uarm_L.X': -35, 'dy': 0.01},
    {**crouch_b(32), 'thigh_L.X': -48, 'spine.X': 32, 'head.X': -20, 'uarm_R.X': -85, 'farm_R.X': -5, 'uarm_L.X': -20, 'dy': -0.08},
    {**crouch_b(24), 'spine.X': 18, 'head.X': -10, 'uarm_R.X': -45, 'farm_R.X': -40, 'uarm_L.X': -25, 'dy': -0.05},
]
VANISH_KEYS = [
    {**crouch_b(32), 'spine.X': 22, 'head.X': -10, 'uarm_L.X': -45, 'uarm_R.X': -45, 'farm_L.X': -55, 'farm_R.X': -55},
    {**crouch_b(52), 'spine.X': 36, 'head.X': -14, 'uarm_L.X': -65, 'uarm_R.X': -65, 'farm_L.X': -80, 'farm_R.X': -80},
    {**crouch_b(70), 'spine.X': 46, 'chest.X': 15, 'head.X': -10, 'uarm_L.X': -80, 'uarm_R.X': -80, 'farm_L.X': -100, 'farm_R.X': -100, 'dz': -0.2},
]
# 사제: 두 팔을 들어 올림(반복) / 한 팔을 옆으로 휘두르기
def cast_key(x, spread, spine, dz=0.0, flutter=0):
    return {'uarm_L.X': x, 'uarm_R.X': x + flutter, 'farm_L.X': -25, 'farm_R.X': -25, 'uarm_L.Y': -spread, 'uarm_R.Y': spread, 'spine.X': spine,
            'head.X': spine * 1.5, 'dz': dz}
CAST_KEYS = [cast_key(-115, 15, -3), cast_key(-145, 28, -8, 0.008, 6), cast_key(-162, 34, -11, 0.016), cast_key(-145, 28, -8, 0.008, -6)]
LASH_KEYS = [
    {'uarm_R.X': -80, 'uarm_R.Z': -60, 'farm_R.X': -10, 'spine.Z': -25, 'uarm_L.X': -20},
    {'uarm_R.X': -85, 'uarm_R.Z': -40, 'farm_R.X': -5, 'spine.Z': -30, 'uarm_L.X': -25},
    {'uarm_R.X': -88, 'uarm_R.Z': 20, 'farm_R.X': 0, 'spine.Z': 10, 'uarm_L.X': -25, 'dy': -0.02},
    {'uarm_R.X': -80, 'uarm_R.Z': 68, 'farm_R.X': 0, 'spine.Z': 28, 'uarm_L.X': -20, 'dy': -0.02},
    {'uarm_R.X': -45, 'uarm_R.Z': 35, 'farm_R.X': -10, 'spine.Z': 12},
]
# 부푼 시체: 두 팔을 벌리고 떤다 (반복). 키마다 벌림과 몸 비틀림이 조금씩 달라 떨림으로 보인다
def swell_key(spread, shake, x=-20):
    return {'uarm_L.Y': -spread, 'uarm_R.Y': spread, 'uarm_L.X': x, 'uarm_R.X': x, 'farm_L.X': -20, 'farm_R.X': -20, 'spine.X': -6, 'head.X': -8,
            'spine.Z': shake, 'head.Z': -shake * 1.5, 'chest.Y': shake * 0.6}
SWELL_KEYS = [swell_key(52, 5), swell_key(60, -4, -26), swell_key(54, 5, -18), swell_key(62, -5, -28)]
# 하르겐: 칼을 앞으로 뻗으며 내딛기 / 칼을 세워 막기(반복) / 무릎 꿇기(변신 장면, 한 번)
THRUST_KEYS = [
    {'uarm_R.X': -10, 'farm_R.X': -85, 'spine.Z': -22, 'thigh_L.X': -12, 'thigh_R.X': 10, 'uarm_L.X': -25, 'farm_L.X': -30},
    {'uarm_R.X': 5, 'farm_R.X': -98, 'spine.Z': -30, 'thigh_L.X': -18, 'thigh_R.X': 14, 'shin_R.X': 10, 'uarm_L.X': -30, 'farm_L.X': -35, 'dy': 0.02},
    {'uarm_R.X': -92, 'farm_R.X': -2, 'spine.Z': 16, 'spine.X': 6, 'thigh_L.X': -38, 'thigh_R.X': 16, 'shin_R.X': 14, 'uarm_L.X': -15, 'dy': -0.07},
    {'uarm_R.X': -96, 'farm_R.X': 0, 'spine.Z': 20, 'spine.X': 8, 'thigh_L.X': -38, 'thigh_R.X': 16, 'shin_R.X': 14, 'uarm_L.X': -10, 'dy': -0.08},
    {'uarm_R.X': -55, 'farm_R.X': -30, 'spine.Z': 6, 'thigh_L.X': -15, 'thigh_R.X': 8, 'dy': -0.04},
]
BLOCK_KEYS = [   # 오른팔이 칼을 세운다 (팔 -68 + 아래팔 -82 = 칼날이 거의 수직). 가운데 키에서 조금 더 버틴다
    {'uarm_R.X': -68 - d, 'farm_R.X': -82, 'uarm_R.Z': 12, 'uarm_L.X': -30, 'farm_L.X': -40, 'spine.Z': -10, 'thigh_L.X': -15, 'thigh_R.X': 12,
     'shin_R.X': 10, 'dz': -0.02 - d * 0.002} for d in (0, 3, 0)
]
KNEEL_KEYS = [
    {'dz': -0.05, 'thigh_L.X': -35, 'shin_L.X': 45, 'thigh_R.X': 0, 'shin_R.X': 25, 'spine.X': 6},
    {'dz': -0.14, 'thigh_L.X': -60, 'shin_L.X': 75, 'thigh_R.X': 15, 'shin_R.X': 70, 'foot_R.X': 40, 'spine.X': 12, 'head.X': 5},
    {'dz': -0.19, 'thigh_L.X': -78, 'shin_L.X': 95, 'thigh_R.X': 25, 'shin_R.X': 100, 'foot_R.X': 55, 'spine.X': 15, 'head.X': 10, 'uarm_R.X': -25, 'farm_R.X': -15},
    {'dz': -0.21, 'thigh_L.X': -80, 'shin_L.X': 98, 'thigh_R.X': 27, 'shin_R.X': 104, 'foot_R.X': 50, 'spine.X': 24, 'head.X': 22, 'uarm_R.X': -35, 'farm_R.X': -20},
]
# 변신한 하르겐: 주인공 slash3(크게 들어 내려찍기)를 두 손으로, 더 크게 / 두 팔을 들어 올림 / 가슴을 펴고 팔을 벌려 포효
CLEAVE_KEYS = [
    {'uarm_L.X': -100, 'uarm_R.X': -130, 'farm_R.X': -60, 'spine.X': -10},
    {'uarm_L.X': -140, 'uarm_R.X': -172, 'farm_R.X': -72, 'farm_L.X': -50, 'spine.X': -18, 'thigh_L.X': -10, 'dz': 0.02},
    {'uarm_L.X': -150, 'uarm_R.X': -178, 'farm_R.X': -75, 'farm_L.X': -55, 'spine.X': -24, 'thigh_L.X': -16, 'dz': 0.035},
    {'uarm_L.X': -55, 'uarm_R.X': -62, 'farm_R.X': 0, 'spine.X': 24, 'thigh_L.X': -34, 'thigh_R.X': 18, 'shin_R.X': 18, 'dy': -0.06, 'dz': -0.045},
    {'uarm_L.X': -38, 'uarm_R.X': -34, 'farm_R.X': 0, 'spine.X': 30, 'thigh_L.X': -34, 'thigh_R.X': 18, 'shin_R.X': 18, 'dy': -0.06, 'dz': -0.06},
    {'uarm_L.X': -30, 'uarm_R.X': -26, 'farm_R.X': -5, 'spine.X': 20, 'thigh_L.X': -22, 'thigh_R.X': 12, 'dy': -0.04, 'dz': -0.035},
    {'uarm_L.X': -18, 'uarm_R.X': -16, 'farm_R.X': -10, 'spine.X': 6, 'thigh_L.X': -10, 'dy': -0.015},
]
RAISE_KEYS = [both_arms(-50, -20, -4), both_arms(-110, -25, -8, **{'dz': 0.01}), both_arms(-158, -20, -12, **{'dz': 0.02}),
              both_arms(-172, -18, -14, **{'dz': 0.03, 'head.X': -6})]
def roar_key(sp, spine, shake=0, dz=0.0):
    return {'spine.X': spine, 'chest.X': spine * 0.4, 'head.X': spine * 1.2, 'uarm_L.Y': -sp, 'uarm_R.Y': sp, 'uarm_L.X': -20, 'uarm_R.X': -20,
            'farm_L.X': -40, 'farm_R.X': -40, 'spine.Z': shake, 'dz': dz}
ROAR_KEYS = [roar_key(30, -8), roar_key(45, -14, 0, 0.006), roar_key(58, -19, 4, 0.012), roar_key(60, -19, -4, 0.012), roar_key(40, -11, 0, 0.004)]

STYLE_NEUTRAL_IDLE = dict(stoop=2, breath=1.5, armx=-8, armf=-15, armamp=3, bob=0.004)
STYLE_NEUTRAL_WALK = dict(leg=28, knee=50, arm=14, armx=-8, armf=-15, twist=5, stoop=4, bob=0.012)

# 몸마다 다른 서기·걷기 스타일 (idle, walk)
GHOUL_IDLE = dict(headk=0.35, stoop=20, breath=2, sway=4, roll=3, armx=-28, armf=-26, armamp=7, bob=0.006)         # 구부정하게 흔들림, 팔이 앞에 늘어짐
GHOUL_WALK = dict(headk=0.35, leg=22, knee=40, drag=0.35, dragbias=10, arm=12, armx=-26, armf=-24, twist=9, stoop=18, roll=5, bob=0.02)   # 오른다리를 끈다
JAILER_IDLE = dict(stoop=4, breath=2.5, armx=-6, armf=-12, armamp=2, bob=0.007)
JAILER_WALK = dict(leg=22, knee=36, arm=9, armx=-6, armf=-12, twist=6, stoop=6, roll=7, bob=0.022)      # 무겁게: 좌우로 크게 쏠리고 느리다
HUNTER_IDLE = dict(stoop=9, breath=1.5, armx=-22, armf=-45, armamp=3, bob=0.006)
HUNTER_WALK = dict(leg=26, knee=48, arm=10, armx=-20, armf=-45, twist=6, stoop=10, bob=0.01)
PRIEST_IDLE = dict(stoop=1, breath=1.2, armx=-30, armf=-40, armamp=2, bob=0.008)
PRIEST_WALK = dict(leg=18, knee=26, arm=6, armx=-25, armf=-40, twist=3, stoop=2, bob=0.008)
WRAITH_IDLE = dict(PRIEST_IDLE, armf=-6)                # 사제 자세(아래팔 -40)는 지팡이를 창처럼 앞으로 눕힌다. 지팡이가 서 있게 거의 펴 둔다
WRAITH_WALK = dict(PRIEST_WALK, armf=-6, arm=4)
CORPSE_IDLE = dict(stoop=3, breath=2, roll=5, sway=3, armx=-6, armf=-14, armamp=5, spread=8, bob=0.008)   # 흔들흔들
CORPSE_WALK = dict(leg=22, knee=30, arm=14, armx=-6, armf=-14, spread=8, twist=4, stoop=3, roll=11, bob=0.016)   # 뒤뚱뒤뚱
HARGEN2_IDLE = dict(stoop=6, breath=3, armx=-6, armf=-18, armamp=3, spread=6, bob=0.008)
HARGEN2_WALK = dict(leg=24, knee=40, arm=14, armx=-6, armf=-18, spread=6, twist=6, stoop=8, roll=6, bob=0.018)


# ----- 네발: 쥐·두꺼비 -----
def rat_pose(anim, i, n):
    H = CFG['height']; p = {}; ph = 2 * math.pi * i / n; s = math.sin(ph)
    if anim == 'idle':   # 코를 킁킁거리고 꼬리를 흔든다
        add(p, 'chest', 'X', 2 * s); add(p, 'neck', 'X', 6 * math.sin(2 * ph)); add(p, 'head', 'X', 4 * math.sin(2 * ph + 1))
        add(p, 'tail1', 'Z', 18 * s); add(p, 'tail2', 'Z', 22 * math.sin(ph - 1))
        p['_root'] = (0, 0, -0.004 * H * (1 + s))
    elif anim == 'walk':   # 다리가 짧아서 몸을 좌우로 꿈틀거리며 걷는다
        for leg, off in (('FL', 0), ('RR', 0), ('FR', math.pi), ('RL', math.pi)):
            a = ph + off
            add(p, leg + '_up', 'X', -48 * math.sin(a)); add(p, leg + '_lo', 'X', (60 if leg[0] == 'F' else -50) * max(0.0, math.cos(a)))
        add(p, 'hips', 'Z', 7 * s); add(p, 'chest', 'Z', -9 * s); add(p, 'neck', 'Z', 6 * s)
        add(p, 'tail1', 'Z', 14 * s); add(p, 'tail2', 'Z', 16 * math.sin(ph - 1)); add(p, 'neck', 'X', 4 * math.sin(2 * ph))
        p['_root'] = (0, 0, 0.03 * H * math.cos(2 * ph))
    elif anim == 'attack':   # 몸을 낮추고 → 튀어나가 → 물고 흔들기 → 물러선다. 앞으로 나가는 dy는 0.09H 이하
        keys = [
            {'chest.X': -6, 'neck.X': -12, 'tail1.X': 10, 'dy': 0.04, 'dz': -0.01},
            {'chest.X': -10, 'neck.X': -20, 'tail1.X': 15, 'dy': 0.06, 'dz': -0.02, **crouch(10, 12)},
            {'chest.X': 6, 'neck.X': 10, 'dy': -0.05, 'dz': 0.07, 'FL_up.X': -42, 'FR_up.X': -42, 'RL_up.X': 35, 'RR_up.X': 35},
            {'chest.X': 6, 'neck.X': 22, 'dy': -0.09, 'dz': 0.05, 'FL_up.X': -30, 'FR_up.X': -30, 'RL_up.X': 25, 'RR_up.X': 25},
            {'chest.X': 6, 'neck.X': 20, 'neck.Z': 18, 'dy': -0.09, 'dz': 0.05, **crouch(14, 8)},
            {'chest.X': 6, 'neck.X': 16, 'neck.Z': -18, 'dy': -0.07, 'dz': 0.04, **crouch(10, 6)},
            {'neck.X': 8, 'dy': -0.03},
        ]
        key = dict(keys[i])
        for k in ('dx', 'dy', 'dz'):
            key[k] = key.get(k, 0) * H
        return keyed({}, key)
    elif anim == 'hit':
        k = [1.0, 0.6, 0.15][i]
        add(p, 'chest', 'X', -16 * k); add(p, 'neck', 'X', -28 * k); add(p, 'neck', 'Z', 8 * k); add(p, 'tail1', 'X', 34 * k)
        for leg in ('FL', 'FR'):
            add(p, leg + '_up', 'X', 22 * k)
        p['_root'] = (0, 0.05 * H * k, 0)
    elif anim == 'death':   # 옆으로 쓰러진다. 몸 두께 약 0.38이라 축(높이 0.3)을 중심으로 누우면 0.11 떠서 그만큼 내린다
        k = [0.0, 0.25, 0.6, 0.9, 1.0, 1.0][i]
        add(p, 'hips', 'Y', 88 * k)
        for leg in ('FL', 'FR', 'RL', 'RR'):
            add(p, leg + '_up', 'X', (-18 if leg[0] == 'F' else 18) * k); add(p, leg + '_lo', 'X', 12 * k)
        add(p, 'neck', 'X', 20 * k); add(p, 'tail1', 'X', 20 * k)
        if i == 0:
            add(p, 'neck', 'X', -15)
        p['_root'] = (0, 0, -CFG['death_dz'] * k)
    return p


def toad_pose(anim, i, n):
    H = CFG['height']; p = {}; u = i / n; ph = 2 * math.pi * u; s = math.sin(ph)
    if anim == 'idle':   # 숨 쉬며 천천히 두리번
        add(p, 'chest', 'X', 1.5 * s); add(p, 'neck', 'X', -3 * s); add(p, 'head', 'Z', 8 * math.sin(ph + 1)); add(p, 'neck', 'Z', 6 * math.sin(ph))
        p['_root'] = (0, 0, 0.008 * H * (1 + s))
    elif anim == 'walk':   # 짧게 뛰기: 웅크림 → 박차고 → 공중 → 착지 → 일어섬
        c = (SOFT(u / 0.2) if u < 0.25 else 1 - SOFT((u - 0.2) / 0.1) if u < 0.3 else 0.0 if u < 0.7 else SOFT((u - 0.7) / 0.1) if u < 0.8 else 1 - SOFT((u - 0.8) / 0.2))
        a = math.sin(math.pi * (u - 0.3) / 0.4) if 0.3 <= u <= 0.7 else 0.0
        for k, v in crouch(14 * c, 40 * c).items():
            add(p, k.split('.')[0], 'X', v)
        add(p, 'RL_up', 'X', 40 * a); add(p, 'RR_up', 'X', 40 * a); add(p, 'RL_lo', 'X', -30 * a); add(p, 'RR_lo', 'X', -30 * a)
        add(p, 'FL_up', 'X', -32 * a); add(p, 'FR_up', 'X', -32 * a)
        add(p, 'chest', 'X', 6 * c - 10 * a); add(p, 'neck', 'X', -6 * a)
        p['_root'] = (0, -0.02 * H * a, -0.05 * H * c + 0.17 * H * a)
    elif anim == 'attack':   # 부풀었다(몸을 일으켜 뒤로 젖힘, 떤다) → 앞으로 뱉기 → 돌아옴
        keys = [
            {'chest.X': -8, 'neck.X': -14, 'FL_up.X': 14, 'FR_up.X': 14, 'dz': 0.015},
            {'chest.X': -14, 'neck.X': -24, 'neck.Z': 4, 'FL_up.X': 22, 'FR_up.X': 22, 'dz': 0.03, 'dy': 0.01},
            {'chest.X': -18, 'neck.X': -30, 'neck.Z': -4, 'FL_up.X': 26, 'FR_up.X': 26, 'dz': 0.04, 'dy': 0.015},
            {'chest.X': 12, 'neck.X': 36, 'FL_up.X': -12, 'FR_up.X': -12, 'dz': -0.01, 'dy': -0.05, **crouch(8, 10)},
            {'chest.X': 10, 'neck.X': 30, 'dy': -0.05, 'dz': -0.01},
            {'chest.X': 4, 'neck.X': 12, 'dy': -0.025},
            {'neck.X': 3, 'dy': -0.008},
        ]
        key = dict(keys[i])
        for k in ('dx', 'dy', 'dz'):
            key[k] = key.get(k, 0) * H
        return keyed({}, key)
    elif anim == 'hop':   # 뒤로 뛰기: 웅크림 → 앞다리로 밀어 뒤로 뜸 → 공중 → 착지. 뒤로(+y) 가는 dy는 게임이 실제로 옮기는 몫과 겹치지 않게 작게
        keys = [
            {**crouch(16, 40), 'chest.X': 6, 'dz': -0.05},
            {'FL_up.X': 38, 'FR_up.X': 38, 'FL_lo.X': -20, 'FR_lo.X': -20, 'RL_up.X': -20, 'RR_up.X': -20, 'chest.X': -14, 'neck.X': -12, 'dy': 0.03, 'dz': 0.1},
            {'FL_up.X': 25, 'FR_up.X': 25, 'RL_up.X': -35, 'RR_up.X': -35, 'RL_lo.X': 25, 'RR_lo.X': 25, 'chest.X': -10, 'dy': 0.05, 'dz': 0.17},
            {'FL_up.X': 10, 'FR_up.X': 10, 'RL_up.X': -30, 'RR_up.X': -30, 'RL_lo.X': 20, 'RR_lo.X': 20, 'chest.X': -4, 'dy': 0.06, 'dz': 0.1},
            {**crouch(18, 42), 'chest.X': 6, 'dy': 0.06, 'dz': -0.05},
            {**crouch(6, 14), 'dy': 0.04, 'dz': -0.015},
        ]
        key = dict(keys[i])
        for k in ('dx', 'dy', 'dz'):
            key[k] = key.get(k, 0) * H
        return keyed({}, key)
    elif anim == 'hit':
        k = [1.0, 0.6, 0.15][i]
        add(p, 'chest', 'X', -10 * k); add(p, 'neck', 'X', -24 * k); add(p, 'neck', 'Z', 8 * k)
        for k2, v in crouch(10 * k, 12 * k).items():
            add(p, k2.split('.')[0], 'X', v)
        p['_root'] = (0, 0.05 * H * k, -0.02 * H * k)
    elif anim == 'death':   # 배를 드러내고 뒤집힌다. 몸 두께가 높이 0.3 축 둘레 대칭(0.02~0.55)이라 내리지 않아도 땅에 안 묻힌다
        k = [0.0, 0.25, 0.6, 0.9, 1.0, 1.0][i]
        add(p, 'hips', 'Y', 180 * k)
        for leg in ('FL', 'FR', 'RL', 'RR'):
            add(p, leg + '_up', 'X', (-35 if leg[0] == 'F' else -25) * k); add(p, leg + '_lo', 'X', 35 * k)
        add(p, 'neck', 'X', 18 * k)
        if i == 0:
            add(p, 'neck', 'X', -12)
        p['_root'] = (0, 0, CFG['death_dz'] * H * k)
    return p


# ----- 날개형(박쥐): 몸통(뿌리) → 머리, 몸통 양옆에 날개 두 마디. 다리는 작아서 몸통에 붙인다 -----
# 박쥐 단면(키 1.0): 날개 끝 x ±0.70(z 0.24~0.45), 날개는 z 0.03~0.58·|x| 0.15~0.7, 귀는 z 0.62~1.0·x ±0.46, 머리는 z 0.55~0.8, 몸통 털은 z 0.3~0.55·|x| 0.15
WING = dict(body=((0, -0.05, 0.30), (0, -0.08, 0.55)), head=((0, -0.08, 0.55), (0, -0.10, 1.0)),
            sh=(0.14, -0.05, 0.50), el=(0.40, 0.0, 0.50), tip=(0.72, 0.10, 0.45),
            x_body=0.13, x_ramp=0.10, x_el=0.38, x_el_ramp=0.12, z_wing_top=0.58, z_head=0.56, z_head_ramp=0.12)


def wing_bones(obj):
    W = WING; B = {'body': (W['body'][0], W['body'][1], None), 'head': (W['head'][0], W['head'][1], 'body')}
    for s, sg in (('L', 1), ('R', -1)):
        a, b, c = (tuple(sg * v if i == 0 else v for i, v in enumerate(W[k])) for k in ('sh', 'el', 'tip'))
        B['wing_%s1' % s] = (a, b, 'body'); B['wing_%s2' % s] = (b, c, 'wing_%s1' % s)
    return B


def wing_weights(co):
    """자동 가중치는 얇은 날개 막에서 실패하기 쉬워 위치로 직접 나눈다. 날개 영역(|x|>0.13, z<0.58)은 |x|로 wing1→wing2를,
    그 밖은 z로 몸통→머리(귀 포함)를 나눈다"""
    W = WING; ax = abs(co.x); sg = 'L' if co.x >= 0 else 'R'
    ww = SOFT((ax - W['x_body']) / W['x_ramp']) * (1 - SOFT((co.z - W['z_wing_top']) / 0.06))
    w2 = SOFT((ax - W['x_el']) / W['x_el_ramp'])
    hw = SOFT((co.z - W['z_head']) / W['z_head_ramp'])
    return {'wing_%s1' % sg: ww * (1 - w2), 'wing_%s2' % sg: ww * w2, 'head': (1 - ww) * hw, 'body': (1 - ww) * (1 - hw)}


def wings(u1, u2, fold=0.0, fold2=0.0):
    """u1·u2: 날개 두 마디를 위로 든 각도(도). fold: 날개를 뒤로 접는 각도. 왼쪽(+X)은 Y 음수가 위, 오른쪽은 반대"""
    p = {}
    add(p, 'wing_L1', 'Y', -u1); add(p, 'wing_R1', 'Y', u1); add(p, 'wing_L2', 'Y', -u2); add(p, 'wing_R2', 'Y', u2)
    if fold or fold2:
        add(p, 'wing_L1', 'Z', fold); add(p, 'wing_R1', 'Z', -fold); add(p, 'wing_L2', 'Z', fold2); add(p, 'wing_R2', 'Z', -fold2)
    return p


def bat_pose(anim, i, n):
    p = {}; ph = 2 * math.pi * i / n
    if anim == 'fly':   # 날갯짓: wing1 ±40도, wing2는 늦게 따라가며(위상 차) 위로 올릴 때 더 꺾인다
        p = wings(40 * math.sin(ph), 34 * math.sin(ph - 1.1) - 6 * max(0.0, math.sin(ph)))
        add(p, 'body', 'X', 4 * math.sin(ph - 0.3)); add(p, 'head', 'X', -4 * math.sin(ph - 0.3)); add(p, 'head', 'Z', 3 * math.sin(2 * ph))
        p['_root'] = (0, 0, -0.03 * math.sin(ph - 0.4))
    elif anim == 'dive':   # 날개를 뒤로 접고 머리를 숙여 내리꽂는다
        k = [0.4, 0.75, 1.0][i]
        p = wings(18 * k, 10 * k, 38 * k, 60 * k)
        add(p, 'body', 'X', 55 * k); add(p, 'head', 'X', 10 * k)
        p['_root'] = (0, -0.03 * k, -0.02 * k)
    elif anim == 'hit':   # 몸이 뒤로 젖혀지고 날개가 퍼덕인다
        k = [1.0, 0.55, 0.15][i]
        p = wings(55 * k, 25 * k, 0, 0)
        add(p, 'body', 'X', -26 * k); add(p, 'head', 'X', -10 * k)
        p['_root'] = (0, 0.05 * k, 0)
    elif anim == 'death':   # 날개가 축 늘어지고 몸이 앞으로 숙여지며 한쪽으로 기울어 떨어진다 (날개 막이 가로로 펼쳐진 몸이라 뒤집으면 막이 땅에 묻힌다). 높이는 posed()가 땅에 맞춘다
        k = [0.15, 0.35, 0.6, 0.85, 1.0, 1.0][i]
        p = wings(-50 * k, -85 * k, 15 * k, 25 * k)
        add(p, 'body', 'X', 40 * k); add(p, 'body', 'Y', 35 * k); add(p, 'head', 'X', 35 * k)
        p['_root'] = (0, 0, -0.12 * k)
    return p


# ----- 덩굴형(가시덩굴): 흙더미(뿌리, 움직이지 않음) → 줄기 세 마디 → 머리(입) -----
# 가시덩굴 단면(키 1.0): 흙더미 z 0~0.17(폭 0.64~0.5), 줄기 z 0.18~0.52(가장 가는 곳 z 0.51, 폭 0.2), 옆 덩굴손 z 0.27~0.48(x ±0.36), 머리 z 0.52~1.0(꽃잎 z 0.63~0.72 폭 0.56)
VINE = dict(mound=0.17, joints=(0.17, 0.2833, 0.3967, 0.51), head_top=1.0, blend=0.035)


def vine_bones(obj):
    V = VINE; j = V['joints']
    return {'mound': ((0, 0, 0), (0, 0, j[0]), None),
            'stem1': ((0, 0, j[0]), (0, 0, j[1]), 'mound'), 'stem2': ((0, 0, j[1]), (0, 0, j[2]), 'stem1'), 'stem3': ((0, 0, j[2]), (0, 0, j[3]), 'stem2'),
            'head': ((0, 0, j[3]), (0, 0, V['head_top']), 'stem3')}


def vine_weights(co):
    """높이만으로 이웃한 두 뼈에 나눈다 (경계마다 부드럽게). 흙더미는 z<0.14라 줄기가 휘어도 따라 휘지 않는다"""
    V = VINE; names = ('mound', 'stem1', 'stem2', 'stem3', 'head')
    s = sum(SOFT((co.z - b) / (2 * V['blend']) + 0.5) for b in V['joints'])
    i0 = min(int(s), 3); f = s - i0
    return {names[i0]: 1 - f, names[i0 + 1]: f}


def vine_pose(anim, i, n):
    p = {}; ph = 2 * math.pi * i / n
    if anim == 'idle':   # 살랑임: 마디마다 조금씩 늦게 좌우로 흔들린다
        for k, b in enumerate(('stem1', 'stem2', 'stem3', 'head')):
            add(p, b, 'Y', (4 + k) * math.sin(ph - 0.7 * k)); add(p, b, 'X', 2.5 * math.sin(ph - 0.7 * k + 1.2))
    elif anim == 'whip':   # 뒤로 젖혔다가 앞으로 채찍처럼 꺾는다
        a = [(-8, -10, -10, -8), (-14, -18, -16, -12), (14, 20, 20, 16), (20, 22, 16, 18), (6, 6, 4, 3)][i]
        for b, v in zip(('stem1', 'stem2', 'stem3', 'head'), a):
            add(p, b, 'X', v)
    elif anim == 'hit':   # 뒤로 젖혀졌다 돌아온다
        k = [1.0, 0.55, 0.15][i]
        for b, v in zip(('stem1', 'stem2', 'stem3', 'head'), (-9, -12, -14, -18)):
            add(p, b, 'X', v * k)
        add(p, 'head', 'Y', 10 * k)
    elif anim == 'death':   # 시든다: 줄기가 앞으로 휘고 머리가 늘어진다
        k = [0.15, 0.35, 0.6, 0.85, 1.0, 1.0][i]
        for b, v in zip(('stem1', 'stem2', 'stem3', 'head'), (8, 20, 32, 40)):
            add(p, b, 'X', v * k)
        add(p, 'head', 'Y', 12 * k)
    return p


KAIL_CHECK = [('idle', 0, 8), ('walk', 4, 16), ('walk', 12, 16), ('slash1', 0, 5), ('slash1', 2, 5), ('slash1', 3, 5), ('slash3', 1, 7), ('slash3', 4, 7)]
MODELS = {
    # 호박 저택 탈출 아이들: 저사양 태블릿용으로 삼각형 약 6천, 텍스처 512 WebP. 마녀·미라는 정면 -Y(rot 0), 흡혈귀·호박은 정면 +X(rot -90)
    'witch_sd': dict(glb='art/3d/witch_sd/witch.glb', rot=0, height=1.0, tex=512, decimate=0.16, kind='biped', body='kid_hat', voxel=0.006, equip=(),
                     head_lock=0.55, anims=KID_ANIMS, poser=kid_pose, check=KID_CHECK),
    'vampire_sd': dict(glb='art/3d/vampire_sd/vampire.glb', rot=-90, height=1.0, tex=512, decimate=0.18, kind='biped', body='kid', voxel=0.006, equip=(),
                       anims=KID_ANIMS, poser=kid_pose, check=KID_CHECK),
    'pumpkin_sd': dict(glb='art/3d/pumpkin_sd/pumpkin.glb', rot=-90, height=1.0, tex=512, decimate=0.19, kind='biped', body='kid_hat', voxel=0.006, equip=(),
                       head_lock=0.53, anims=KID_ANIMS, poser=kid_pose, check=KID_CHECK),
    'mummy_sd': dict(glb='art/3d/mummy_sd/mummy.glb', rot=0, height=1.0, tex=512, decimate=0.24, kind='biped', body='kid', voxel=0.006, equip=(),
                     anims=KID_ANIMS, poser=kid_pose, check=KID_CHECK),
    # 장비 외형 구현: 카일 몸은 칼을 굽지 않는다(equip=()). 장비는 부품 GLB를 소켓(game/models/kail_sd.json의 sockets)에 붙인다.
    # sword_scale(SD 몸에 맞게 칼날을 넓고 두껍게, 길이는 조금만)은 prep_equip.py가 대검 크기를 맞추는 기준이다(칼끝 0.446, 손잡이 가운데 0.038)
    'kail_sd': dict(glb='art/3d/kail_sd/kail.glb', rot=0, height=1.0, kind='biped', body='sd', voxel=0.006, equip=(), sockets=True,
                    sword_scale=(2.4, 2.0, 1.2), anims=HERO_ANIMS,
                    check=[('idle', 0, 8), ('walk', 4, 16), ('walk', 12, 16), ('slash1', 0, 5), ('slash1', 2, 5), ('slash1', 3, 5), ('slash3', 1, 7), ('slash3', 4, 7)]),
    # 갑옷 4벌 (장비 외형 구현): 카일과 같은 sd 뼈대·같은 동작 표. 칼을 굽지 않고 소켓을 이 몸의 뼈로 다시 계산한다.
    # probe(art/3d/equip/b_body_N/probe.txt): 목이 z0.63(폭 0.20~0.24)에서 가장 좁고 머리카락 포함 머리가 z0.66~1.0, 어깨 z0.5~0.6, x ±0.29~0.30 → 카일 sd(목 0.58, 머리 0.62, 손 0.22~0.42)와 같은 관절을 쓴다. 정면은 -Y(rot 0).
    # decimate는 삼각형 약 1.65만 개가 되게(용량 3MB 안팎), tex는 1024 WebP
    'b_body_1_sd': dict(head_lock=0.68, glb='art/3d/equip/b_body_1/b_body_1.glb', rot=0, height=1.0, tex=1024, decimate=0.79, kind='biped', body='sd', voxel=0.014, equip=(), sockets=True,
                        anims=HERO_ANIMS, check=KAIL_CHECK),
    'b_body_2_sd': dict(head_lock=0.68, glb='art/3d/equip/b_body_2/b_body_2.glb', rot=0, height=1.0, tex=1024, decimate=0.73, kind='biped', body='sd', voxel=0.006, equip=(), sockets=True,
                        anims=HERO_ANIMS, check=KAIL_CHECK),
    'b_body_3_sd': dict(head_lock=0.68, glb='art/3d/equip/b_body_3/b_body_3.glb', rot=0, height=1.0, tex=1024, decimate=0.71, kind='biped', body='sd', voxel=0.006, equip=(), sockets=True,
                        anims=HERO_ANIMS, check=KAIL_CHECK),
    'b_body_4_sd': dict(head_lock=0.68, glb='art/3d/equip/b_body_4/b_body_4.glb', rot=0, height=1.0, tex=1024, decimate=0.44, kind='biped', body='sd', voxel=0.006, equip=(), sockets=True,
                        anims=HERO_ANIMS, check=KAIL_CHECK),
    # 저주 병사: 칼과 방패. 체형이 카일과 거의 같아(목 0.6, 손 0.24~0.33) 같은 관절을 쓴다
    'soldier_sd': dict(glb='art/3d/soldier_sd/soldier.glb', rot=0, height=1.0, kind='biped', body='sd', voxel=0.006, equip=('sword', 'shield'),
                       sword_scale=(2.2, 2.0, 1.1), shield_scale=1.5, anims=SOLDIER_ANIMS,
                       check=[('idle', 0, 8), ('walk', 4, 16), ('walk', 12, 16), ('attack', 1, 7), ('attack', 3, 7), ('attack', 5, 7), ('block', 0, 3), ('guardwalk', 4, 16)]),
    # 저주늑대: 머리가 -Y(콧끝 y=-0.348), 꼬리가 +Y라 돌리지 않는다. TRELLIS가 양옆을 대칭으로 만들어 거울 복사도 필요 없다
    'wolf_sd': dict(glb='art/3d/wolf_sd/wolf.glb', rot=0, height=0.6, kind='quad', quad='sd', voxel=0.006, anims=WOLF_ANIMS,
                    check_cam=(0.3, 1.0),
                    check=[('walk', 4, 16), ('attack', 1, 7), ('attack', 2, 7), ('attack', 3, 7), ('attack', 4, 7), ('attack', 5, 7), ('hit', 0, 3), ('death', 5, 6)]),

    # ---- 몬스터 12종 ----
    # 근위병: 병사와 같은 sd 관절·같은 칼(방패 없음). 동작은 병사 키(내려치기 attack)를 그대로 쓴다
    'guard_sd': dict(glb='art/3d/guard_sd/guard.glb', rot=0, height=1.0, tex=1024, decimate=0.82, kind='biped', body='sd', voxel=0.006, equip=('sword',),
                     sword_scale=(2.2, 2.0, 1.1), anims=GUARD_ANIMS, poser=make_poser(),
                     check=[('idle', 0, 8), ('walk', 4, 16), ('walk', 12, 16), ('attack', 1, 7), ('attack', 3, 7), ('attack', 5, 7), ('hit', 0, 3), ('death', 5, 6)]),
    # SD 기사 (Scenario 후보, NPC·아군 기사용): 정면 -Y(rot 0). 칼(오른손, x<0)과 방패(왼팔, x>0)가 몸과 한 메시라 칼을 따로 달지 않는다.
    # 손은 probe.txt의 x 띠로 쟀다: 칼 손잡이 x -0.20·z 0.28 (x -0.21 띠 y -0.22..-0.04), 방패 뒤 손 x 0.26·z 0.30. 삼각형 7만 → 약 1.7만
    'knight_sd': dict(glb='art/3d/knight_sd/knight.glb', rot=0, height=1.0, tex=1024, decimate=0.24, kind='biped', body='knight', voxel=0.006, equip=(),
                      hands=((0.26, -0.08, 0.30), (-0.20, -0.15, 0.28)), anims=GUARD_ANIMS, poser=make_poser(),
                      cape_lock=(0.15, 0.40),   # 망토: 등 뒤 y 0.15~0.29, 바닥까지 늘어진다 (첫 시도에서 밑단이 shin_L에 묶였다)
                      check=[('idle', 0, 8), ('walk', 4, 16), ('walk', 12, 16), ('attack', 1, 7), ('attack', 3, 7), ('attack', 5, 7), ('hit', 0, 3), ('death', 5, 6)]),
    # 두건 망령 (Scenario 후보, 해골 전사 대신): 정면 -Y(rot 0). 지팡이(오른손, x<0)가 몸과 한 메시다. 삼각형 4천이라 줄이지 않는다.
    # 손은 probe 그림으로 쟀다: 지팡이 쥔 손 x -0.22·z 0.60, 왼 소매 끝 x 0.24·z 0.55. 사제처럼 주문(cast)과 채찍(lash)을 쓴다
    'wraith_sd': dict(glb='art/3d/wraith_sd/wraith.glb', rot=0, height=1.0, tex=1024, weld=True, kind='biped', body='wraith', voxel=0.006, equip=(),
                      hands=((0.24, -0.02, 0.55), (-0.22, -0.10, 0.60)), anims=PRIEST_ANIMS,
                      island_lock=('hand_R', (-0.235, -0.12, 0.30)),   # 지팡이 아래쪽 한 점 (x -0.22 띠 z 0.09~0.99): 첫 시도에서 아래 반이 다리에 묶여 바닥에 남았다
                      poser=make_poser(WRAITH_IDLE, WRAITH_WALK, {'cast': CAST_KEYS, 'lash': LASH_KEYS}),
                      check=[('idle', 0, 8), ('walk', 4, 16), ('cast', 0, 4), ('cast', 2, 4), ('lash', 1, 5), ('lash', 3, 5), ('hit', 0, 3), ('death', 5, 6)]),
    # 사슬 망자: 정면이 -Y(rot 0). 구부정해 목이 0.60(폭 0.217)에서 가장 좁고 머리가 0.63~1.0, 손은 z 0.25~0.4·x ±0.33, 어깨 0.50
    'ghoul_sd': dict(glb='art/3d/ghoul_sd/ghoul.glb', rot=0, height=1.0, tex=1024, decimate=0.62, kind='biped', body='ghoul', voxel=0.006, equip=(), anims=GHOUL_ANIMS,
                     poser=make_poser(GHOUL_IDLE, GHOUL_WALK, {'throw': throw_keys(1.0, 14)}, {'smash': 'attack'}),
                     check=[('idle', 2, 8), ('walk', 4, 16), ('walk', 12, 16), ('throw', 1, 5), ('throw', 3, 5), ('smash', 2, 7), ('smash', 4, 7), ('death', 5, 6)]),
    # 사슬 감옥지기: 원화 정면이 +X를 보아 rot=-90. 머리가 작고 어깨가 넓다: 턱 z 0.70, 투구 z 0.75~1.0, 어깨 z 0.57~0.72(폭 0.69), 손 z 0.15~0.5(x ±0.37), 치마 밑단 0.2
    'jailer_sd': dict(glb='art/3d/jailer_sd/jailer.glb', rot=-90, height=1.0, tex=1024, decimate=0.3, kind='biped', body='jailer', voxel=0.012, equip=(), anims=JAILER_ANIMS,
                      poser=make_poser(JAILER_IDLE, JAILER_WALK, {'throw': throw_keys(0.85, 4, -0.01), 'slam': SLAM_KEYS, 'sweep': SWEEP_KEYS}),
                      check=[('walk', 4, 16), ('walk', 12, 16), ('throw', 1, 5), ('throw', 3, 5), ('slam', 2, 7), ('slam', 3, 7), ('sweep', 1, 6), ('sweep', 3, 6)]),
    # 사슬 사냥꾼: 카일과 같은 sd. 짧은 칼(병사 칼의 0.5배)
    'hunter_sd': dict(glb='art/3d/hunter_sd/hunter.glb', rot=0, height=1.0, tex=1024, decimate=0.63, kind='biped', body='sd', voxel=0.006, equip=('sword',),
                      sword_scale=(1.1, 1.0, 0.55), anims=HUNTER_ANIMS,
                      poser=make_poser(HUNTER_IDLE, HUNTER_WALK, {'stab': STAB_KEYS, 'vanish': VANISH_KEYS}),
                      check=[('idle', 0, 8), ('walk', 4, 16), ('stab', 0, 4), ('stab', 1, 4), ('stab', 2, 4), ('vanish', 1, 3), ('vanish', 2, 3), ('death', 5, 6)]),
    # 사슬 사제: sd. 긴 옷이라 다리 가중치를 확인한다
    'priest_sd': dict(glb='art/3d/priest_sd/priest.glb', rot=0, height=1.0, tex=1024, decimate=0.56, kind='biped', body='sd', voxel=0.006, equip=(), anims=PRIEST_ANIMS,
                      poser=make_poser(PRIEST_IDLE, PRIEST_WALK, {'cast': CAST_KEYS, 'lash': LASH_KEYS}),
                      check=[('idle', 0, 8), ('walk', 4, 16), ('cast', 0, 4), ('cast', 2, 4), ('lash', 1, 5), ('lash', 3, 5), ('hit', 0, 3), ('death', 5, 6)]),
    # 부푼 시체: 원화 정면이 +X를 보아 rot=-90. 배가 크고(y -0.29~0.26) 다리가 짧다(z<0.2). 손 z 0.24~0.45·x ±0.4, 어깨 z 0.60, 목 0.66(폭 0.42), 머리 0.68~1.0
    'corpse_sd': dict(glb='art/3d/corpse_sd/corpse.glb', rot=-90, height=1.0, tex=1024, decimate=0.59, kind='biped', body='corpse', voxel=0.006, equip=(), anims=CORPSE_ANIMS,
                      poser=make_poser(CORPSE_IDLE, CORPSE_WALK, {'swell': SWELL_KEYS}),
                      check=[('idle', 2, 8), ('walk', 4, 16), ('walk', 12, 16), ('swell', 0, 4), ('swell', 1, 4), ('hit', 0, 3), ('death', 3, 6), ('death', 5, 6)]),
    # 하르겐: sd. 칼은 카일과 같은 크기
    'hargen_sd': dict(glb='art/3d/hargen_sd/hargen.glb', rot=0, height=1.0, tex=1024, decimate=0.48, kind='biped', body='sd', voxel=0.01, equip=('sword',),
                      sword_scale=(2.4, 2.0, 1.2), anims=HARGEN_ANIMS,
                      poser=make_poser(STYLE_NEUTRAL_IDLE, STYLE_NEUTRAL_WALK, {'thrust': THRUST_KEYS, 'block': BLOCK_KEYS, 'kneel': KNEEL_KEYS}),
                      check=[('slash1', 2, 5), ('slash3', 3, 7), ('thrust', 1, 5), ('thrust', 2, 5), ('block', 1, 3), ('kneel', 1, 4), ('kneel', 3, 4), ('death', 5, 6)]),
    # 변신한 하르겐: 크고 팔이 길다. 투구(뿔)·어깨 갑옷이 커서 목이 보이지 않는다: 어깨 z 0.63~0.78(폭 0.75), 투구 0.81~1.0, 손(발톱) z 0.25~0.4·x ±0.35
    'hargen2_sd': dict(glb='art/3d/hargen2_sd/hargen2.glb', rot=0, height=1.0, tex=1024, decimate=0.375, kind='biped', body='hargen2', voxel=0.006, equip=(), anims=HARGEN2_ANIMS,
                       poser=make_poser(HARGEN2_IDLE, HARGEN2_WALK, {'cleave': CLEAVE_KEYS, 'raise': RAISE_KEYS, 'roar': ROAR_KEYS}),
                       check=[('walk', 4, 16), ('cleave', 1, 7), ('cleave', 3, 7), ('cleave', 4, 7), ('raise', 2, 4), ('roar', 2, 5), ('hit', 0, 3), ('death', 5, 6)]),
    # 하수 쥐: 머리 -Y, 꼬리 +Y라 rot 0. 몸길이(콧끝~꼬리끝) 1.29로 꼬리가 반이다
    'rat_sd': dict(glb='art/3d/rat_sd/rat.glb', rot=0, height=0.6, tex=1024, kind='quad', quad='rat', voxel=0.012, anims=RAT_ANIMS, poser=rat_pose,
                   check_cam=(0.3, 1.5), death_dz=0.075,
                   check=[('walk', 4, 16), ('attack', 1, 7), ('attack', 2, 7), ('attack', 3, 7), ('attack', 4, 7), ('hit', 0, 3), ('death', 3, 6), ('death', 5, 6)]),
    # 독두꺼비: 머리 -Y(콧끝 y=-0.458), 뒷다리 y +0.1~0.44라 rot 0. 몸이 납작하고 넓다(폭 0.9)
    'toad_sd': dict(glb='art/3d/toad_sd/toad.glb', rot=0, height=0.6, tex=1024, decimate=0.44, kind='quad', quad='toad', voxel=0.006, anims=TOAD_ANIMS, poser=toad_pose,
                    check_cam=(0.3, 1.3), death_dz=0.0,
                    check=[('walk', 2, 12), ('walk', 5, 12), ('attack', 2, 7), ('attack', 3, 7), ('hop', 1, 6), ('hop', 2, 6), ('death', 3, 6), ('death', 5, 6)]),
    # 저주 박쥐: 날개형. 정면 -Y(rot 0). 날개 끝 x ±0.70
    'bat_sd': dict(glb='art/3d/bat_sd/bat.glb', rot=0, height=1.0, tex=1024, fix_white=True, decimate=0.41, kind='wing', voxel=0.006, anims=BAT_ANIMS, poser=bat_pose,
                   check_cam=(0.5, 2.0),
                   check=[('fly', 0, 8), ('fly', 2, 8), ('fly', 4, 8), ('fly', 6, 8), ('dive', 1, 3), ('hit', 0, 3), ('death', 3, 6), ('death', 5, 6)]),
    # 가시덩굴: 덩굴형. 정면 -Y(rot 0)
    'thornvine_sd': dict(glb='art/3d/thornvine_sd/thornvine.glb', rot=0, height=1.0, tex=1024, decimate=0.35, kind='vine', voxel=0.006, anims=VINE_ANIMS, poser=vine_pose,
                         check=[('idle', 2, 8), ('idle', 6, 8), ('whip', 0, 5), ('whip', 1, 5), ('whip', 2, 5), ('whip', 3, 5), ('hit', 0, 3), ('death', 5, 6)]),
}
# 네발짐승 관절. z는 키(H)에 대한 비율, y는 콧끝(0)~꼬리끝(1) 길이에 대한 비율.
# SD 늑대 단면(키 0.6): 등 윗면은 z 0.29~0.32, 다리는 z 0.08에서 가장 가늘고(무릎), 머리는 z 0.27~0.6·y -0.35~0.07,
# 꼬리는 엉덩이(y 0.19, z 0.22)에서 위뒤로 솟아 끝이 y 0.32, z 0.42쯤이다
QUAD = {
    'sd': dict(back=0.33, leg_top=0.30, knee=0.13, head_pivot=(0.36, 0.63), tail_base=(0.78, 0.37), tail_tip=(0.96, 0.70),
               death_dz=0.0),
    # 하수 쥐 (키 0.6, 콧끝 y -0.645 ~ 꼬리끝 +0.645, 길이 1.29): 몸통 z 0.1~0.48(축 0.3), 앞발 y -0.4·뒷발 y 0.0, 다리는 몸 밑 z<0.1의 짧은 토막.
    # 머리는 y -0.64~-0.33·z 0.17~0.55(귀 0.58), 꼬리는 y 0.12(z 0.18)에서 끝 y 0.645(z 0.09)까지 낮게 뻗는다
    'rat': dict(back=0.50, leg_top=0.30, knee=0.10, head_pivot=(0.244, 0.62), tail_base=(0.58, 0.30), tail_tip=(0.995, 0.15), death_dz=0.0),
    # 독두꺼비 (키 0.6, y -0.458~0.458): 몸통 z 0.02~0.55(축 0.28), 앞다리 y -0.3·x ±0.29, 뒷다리 y 0.1~0.44·x ±0.45, 머리는 y -0.46~-0.25·z 0.3~0.6(눈 0.6).
    # 꼬리는 없어 엉덩이 끝에 아주 짧은 뼈만 둔다(움직이지 않는다)
    'toad': dict(back=0.47, leg_top=0.40, knee=0.18, head_pivot=(0.227, 0.75), tail_base=(0.90, 0.33), tail_tip=(0.99, 0.22), death_dz=0.0),
}


def crouch(front, rear):
    """다리를 접어 몸을 낮춘다. 윗뼈를 앞으로 a도, 아랫뼈를 뒤로 2a도 꺾어 발이 제자리 근처에 남는다 (발 고정 장치가 없어서)"""
    return {'FL_up.X': -front, 'FR_up.X': -front, 'FL_lo.X': 2 * front, 'FR_lo.X': 2 * front,
            'RL_up.X': -rear, 'RR_up.X': -rear, 'RL_lo.X': 2 * rear, 'RR_lo.X': 2 * rear}


# SD 늑대 덤비기·맞음 키. bake.py 키는 SD 몸(다리 0.18, 등 0.2)에서 움직임이 작아 서 있는 자세와 구분이 안 됐다 (사용자 지적).
# 축은 모델 기준: chest·neck X가 양수면 앞이 숙여진다, 다리 _up X가 음수면 발이 앞으로, tail1 X가 양수면 꼬리가 선다.
# dy·dz는 키(H)에 대한 비율이고 -dy가 앞이다. 다리 35도 접기가 약 0.05H 낮아지는 만큼과 맞췄다.
# 게임이 덤비는 동안 늑대를 실제로 옮기므로 앞으로 나가는 dy는 작게 두고, 착지 뒤에는 0으로 서서히 돌아온다 (크게 두면 회복 때 뒤로 끌려 보였다)
SD_WOLF_KEYS = {
    'attack': [
        # 0~1 웅크림 (windup): 앞을 숙이고 머리를 낮춰 노려본다. 꼬리는 뻣뻣하게 선다
        {**crouch(25, 20), 'chest.X': 10, 'neck.X': 14, 'tail1.X': 15, 'dz': -0.035},
        {**crouch(38, 32), 'chest.X': 16, 'neck.X': 20, 'tail1.X': 25, 'tail2.X': 10, 'dy': 0.03, 'dz': -0.06},
        # 2 박차기: 몸이 떠오르고 앞발을 뻗고 뒷발은 뒤로 뻗는다. 머리를 든다
        {'FL_up.X': -65, 'FR_up.X': -60, 'FL_lo.X': 25, 'FR_lo.X': 25, 'RL_up.X': 50, 'RR_up.X': 45, 'RL_lo.X': -10, 'RR_lo.X': -10,
         'chest.X': -12, 'neck.X': -18, 'tail1.X': -15, 'dy': -0.05, 'dz': 0.1},
        # 3 물기: 앞으로 쭉 나가며 머리를 내리꽂는다
        {'FL_up.X': -45, 'FR_up.X': -40, 'FL_lo.X': 10, 'FR_lo.X': 10, 'RL_up.X': 40, 'RR_up.X': 35,
         'chest.X': 6, 'neck.X': 30, 'tail1.X': -10, 'dy': -0.09, 'dz': 0.04},
        # 4 착지: 앞다리로 받으며 몸이 눌린다
        {**crouch(24, 18), 'chest.X': 12, 'neck.X': 18, 'tail1.X': 5, 'dy': -0.07, 'dz': -0.04},
        # 5~6 회복: 머리를 털며 일어선다
        {**crouch(18, 12), 'chest.X': -4, 'neck.X': -12, 'neck.Z': 12, 'tail1.X': 12, 'dy': -0.045, 'dz': -0.025},
        {**crouch(6, 4), 'neck.X': -4, 'neck.Z': -6, 'tail1.X': 6, 'dy': -0.02, 'dz': -0.008},
    ],
    # 맞음: 머리와 가슴이 뒤로 젖혀지고 앞발이 들리며 뒤로 밀린다
    'hit': [
        {'chest.X': -20, 'neck.X': -32, 'neck.Z': 10, 'FL_up.X': 22, 'FR_up.X': 18, 'RL_up.X': -12, 'RR_up.X': -12, 'tail1.X': 30,
         'dy': 0.08, 'dz': 0.02},
        {'chest.X': -11, 'neck.X': -18, 'neck.Z': 5, 'FL_up.X': 12, 'FR_up.X': 10, 'RL_up.X': -6, 'RR_up.X': -6, 'tail1.X': 16, 'dy': 0.05},
        {'chest.X': -3, 'neck.X': -5, 'tail1.X': 5, 'dy': 0.015},
    ],
}
SD_WALK_GAIN = (1.7, 2.5)   # 걷기: 다리 흔들기 각도, 몸 오르내림. 다리가 짧아 bake.py 값으로는 걸음이 거의 안 보였다
CFG = MODELS[NAME]; g['CFG'] = CFG
ANIMS = CFG['anims']


LEGS = ('thigh_', 'shin_', 'foot_')


def pose(anim, i, n):
    """bake.py 동작 + 3D에서 새로 만든 동작.
    guardwalk: 방패를 든 채(막기 윗몸) 좁은 걸음으로 다가선다. 막기 자세 그대로 미끄러져 오던 것을 고친다 (사용자 지적)"""
    if 'poser' in CFG:   # 몬스터: 모델마다 동작 함수·키 표
        return CFG['poser'](anim, i, n)
    if anim == 'guardwalk':
        walk = g['hero_pose']('walk', i, n)
        block = g['keyed']({}, g['BIPED_KEYS']['block'][0])
        p = {b: r for b, r in block.items() if b != '_root' and not b.startswith(LEGS)}
        for b, r in walk.items():
            if b.startswith(LEGS):
                p[b] = [(ax, deg * 0.9) for ax, deg in r]   # 보폭은 걷기와 비슷하게 (망토가 다리를 가려 작으면 안 보인다)
        ph = 2 * math.pi * i / n
        p.setdefault('spine', []).append(('Z', 5 * math.sin(ph)))   # 걸음마다 어깨가 좌우로 흔들린다
        p.setdefault('chest', []).append(('Y', 3 * math.sin(ph)))
        dz = walk['_root'][2] * 1.3 + block['_root'][2]               # 걸음마다 몸이 오르내린다
        p['_root'] = (0, 0, dz)
        return p
    if CFG['kind'] == 'quad':
        H = CFG['height']
        if CFG['quad'] == 'sd' and anim in SD_WOLF_KEYS:
            key = dict(SD_WOLF_KEYS[anim][i])
            for k in ('dx', 'dy', 'dz'):
                key[k] = key.get(k, 0) * H
            return g['keyed']({}, key)
        p = g['wolf_pose'](anim, i, n)
        if CFG['quad'] == 'sd' and anim == 'walk':
            ga, gb = SD_WALK_GAIN
            p = {b: [(ax, d * ga) for ax, d in r] if b.endswith(('_up', '_lo')) else r for b, r in p.items()}
            p['_root'] = tuple(v * gb for v in p['_root'])
        if anim == 'death':
            # bake.py 늑대는 등이 높아 옆으로 누우며 0.42H 내려갔다. SD 늑대는 등이 낮아 그만큼 내리면 땅에 묻힌다
            k = [0.0, 0.25, 0.6, 0.9, 1.0, 1.0][i]
            p['_root'] = (0, 0, QUAD[CFG['quad']]['death_dz'] * CFG['height'] * k)
        return p
    return g['hero_pose'](anim, i, n)


def quad_bones_sd(obj):
    """bake.py quad_bones와 같은 뼈 이름·부모. 발 위치는 모델에서 찾고, 나머지 관절은 QUAD 비율로 둔다.
    SD 머리는 앞다리 위에 얹혀 있어서, 목은 가슴 앞에서 위로 세우고 머리뼈는 그 끝에서 콧끝으로 뻗는다"""
    Q = QUAD[CFG['quad']]; H = CFG['height']
    co = [v.co.copy() for v in obj.data.vertices]
    ys = [c.y for c in co]; ymin, ymax = min(ys), max(ys); L = ymax - ymin
    Y = lambda f: ymin + f * L
    feet = [c for c in co if c.z < 0.06 * H]
    ymid = sum(c.y for c in feet) / len(feet)
    def cen(sel):
        s = [c for c in feet if sel(c)]
        return Vector((sum(c.x for c in s) / len(s), sum(c.y for c in s) / len(s), 0))
    FL = cen(lambda c: c.y < ymid and c.x > 0); FR = cen(lambda c: c.y < ymid and c.x < 0)
    RL = cen(lambda c: c.y >= ymid and c.x > 0); RR = cen(lambda c: c.y >= ymid and c.x < 0)
    yf, yr = (FL.y + FR.y) / 2, (RL.y + RR.y) / 2
    tip = [c for c in co if c.y < ymin + 0.06 * L]; snout_z = sum(c.z for c in tip) / len(tip)
    sz = Q['back'] * H
    hp = (0, Y(Q['head_pivot'][0]), Q['head_pivot'][1] * H)
    tb = (0, Y(Q['tail_base'][0]), Q['tail_base'][1] * H)
    tt = (0, Y(Q['tail_tip'][0]), Q['tail_tip'][1] * H)
    tm = tuple((a + b) / 2 for a, b in zip(tb, tt))
    print('[quad] feet', [tuple(round(c, 3) for c in f[:2]) for f in (FL, FR, RL, RR)], 'snout_z', round(snout_z, 3))
    B = {
        'hips': ((0, yr, sz), (0, (yf + yr) / 2, sz), None),
        'chest': ((0, (yf + yr) / 2, sz), (0, yf, sz + 0.02 * H), 'hips'),
        'neck': ((0, yf, sz + 0.02 * H), hp, 'chest'),
        'head': (hp, (0, ymin, snout_z), 'neck'),
        'tail1': (tb, tm, 'hips'),
        'tail2': (tm, tt, 'tail1'),
    }
    for n, f, par in (('FL', FL, 'chest'), ('FR', FR, 'chest'), ('RL', RL, 'hips'), ('RR', RR, 'hips')):
        B[n + '_up'] = ((f.x, f.y, Q['leg_top'] * H), (f.x, f.y, Q['knee'] * H), par)
        B[n + '_lo'] = ((f.x, f.y, Q['knee'] * H), (f.x, f.y, 0.02 * H), n + '_up')
    return B


def skin_custom(obj, arm, wfn):
    """wfn(좌표) → {뼈: 무게}로 가중치를 직접 준다"""
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in arm.data.bones}
    for v in obj.data.vertices:
        w = wfn(v.co); tot = sum(w.values()) or 1.0
        for n, x in w.items():
            if x > 0.01 * tot:
                groups[n].add([v.index], x / tot, 'REPLACE')
    obj.parent = arm; md = obj.modifiers.new('arm', 'ARMATURE'); md.object = arm


def skin_rigid(o, bone, arm):
    """물체를 지금 자리에 굳히고 뼈 하나에 무게 1로 묶는다 (뼈 부모 대신. GLB에서 어긋나지 않게)"""
    bpy.context.view_layer.update(); mw = o.matrix_world.copy()
    o.parent = None; o.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    vg = o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    o.parent = arm; md = o.modifiers.new('arm', 'ARMATURE'); md.object = arm


SOCKETS = {}   # 소켓 이름 → {bone, pos, quat}. main()이 채운다
_C = Matrix.Rotation(math.radians(-90), 4, 'X')   # Blender(Z-up) → glTF(Y-up): (x, y, z) → (x, z, -y)


def to_gltf_local(arm, bone, P):
    """부품의 Blender 세계 행렬 P(쉬는 자세)를 뼈 기준 로컬로 바꿔 glTF 좌표로 쓴다.
    내보낸 뼈 노드의 세계 행렬은 C·B(C = X축 -90도, B = 뼈의 matrix_local)이고(루트 노드에서만 Z-up→Y-up 변환이 걸리고 뼈 로컬 축은 Blender 뼈 축 그대로다:
    머리뼈처럼 세로 뼈는 회전이 항등이고 이동 (0, 길이, 0)), 부품 GLB는 꼭짓점이 C·v로 내보내진다. 그래서 C·P·v = C·B·T·(C·v)에서 T = (B⁻¹·P)·C⁻¹.
    부품 GLB를 bone.add 한 뒤 position·quaternion에 그대로 넣으면 된다 (quaternion은 [x, y, z, w]). 값은 three.js에서 확인했다"""
    B = arm.data.bones[bone].matrix_local
    T = (B.inverted() @ P) @ _C.inverted()
    t = T.to_translation(); q = T.to_quaternion()
    return {'bone': bone, 'pos': [round(t.x, 5), round(t.y, 5), round(t.z, 5)], 'quat': [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)]}


def from_gltf_local(arm, bone, T):
    """to_gltf_local의 반대: glTF 로컬 행렬 T → Blender 세계 행렬 (확인 그림에서 json 값으로 부품을 다시 놓을 때 쓴다)"""
    return arm.data.bones[bone].matrix_local @ T @ _C


def compute_sockets(arm):
    """카일 소켓. 자리·방향은 예전에 칼·방패를 몸에 굽던 계산 그대로다.
    hand_R: 손뼈 가운데(grip_w)에 부품 원점(대검은 손잡이 가운데), 칼날 방향 (-0.12, -0.45, -1) (A자세라 바깥으로 벌어져 칼이 삐죽 나오지 않게 아래·조금 앞).
    shield: farm_L 뼈의 0.55 지점 + (0.035, -0.01, 0) = 아래팔 바깥 면 가운데에 방패 뒷면 가운데, 앞면(+Y)은 바깥 (1, -0.35, 0), 위는 +Z.
    head: 머리 가운데(x -0.005, y 0)의 높이 0.70. 머리카락 포함 머리가 z 0.62(턱)~0.98(정수리)이고 투구 원점이 아래쪽 가운데라 이마·귀 높이에 둔다. 앞 -Y"""
    hb = arm.data.bones['hand_R']
    blade = Vector((-0.12, -0.45, -1.0)).normalized()
    grip_w = hb.head_local.lerp(hb.tail_local, 0.5)
    P_hand = Matrix.Translation(grip_w) @ blade.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    fb = arm.data.bones['farm_L']
    c = fb.head_local.lerp(fb.tail_local, 0.55) + Vector((CFG.get('shield_out', 0.035), -0.01, 0))   # 갑옷 몸은 팔·어깨가 두꺼우면 shield_out을 키운다
    ny = Vector((1, -0.35, 0)).normalized(); nx = ny.cross(Vector((0, 0, 1))).normalized(); nz = nx.cross(ny)
    Rs = Matrix(((nx.x, ny.x, nz.x), (nx.y, ny.y, nz.y), (nx.z, ny.z, nz.z))).to_4x4()
    P_shield = Matrix.Translation(c) @ Rs
    P_head = Matrix.Translation(Vector((-0.005, 0.0, 0.70)))
    print('[sockets] grip_w', tuple(round(v, 3) for v in grip_w), 'shield c', tuple(round(v, 3) for v in c))
    return ({'hand_R': to_gltf_local(arm, 'hand_R', P_hand), 'shield': to_gltf_local(arm, 'farm_L', P_shield), 'head': to_gltf_local(arm, 'head', P_head)},
            {'hand_R': ('hand_R', P_hand), 'shield': ('farm_L', P_shield), 'head': ('head', P_head)})


def lock_head(body, z):
    """머리카락·머리 쪽 꼭짓점(z 이상)에서 팔·손 뼈 가중치를 지운다. 가는 머리카락 올이 팔 뼈를 따라 늘어나는 것을 막는다 (b_body_1에서 생겼다)"""
    arm_groups = {vg.index for vg in body.vertex_groups if vg.name.startswith(('clav_', 'uarm_', 'farm_', 'hand_'))}
    head = body.vertex_groups['head']; n = 0
    for v in body.data.vertices:
        if v.co.z < z:
            continue
        drop = [g_.group for g_ in v.groups if g_.group in arm_groups]
        if not drop:
            continue
        for gi in drop:
            body.vertex_groups[gi].remove([v.index])
        if not any(g_.weight > 1e-6 for g_ in v.groups):
            head.add([v.index], 1.0, 'REPLACE')
        n += 1
    print(f'[head_lock] z>={z}: {n} verts lost arm weights')


def lock_cape(body, y0, z1):
    """등 뒤 망토(y > y0, z < z1)에서 다리 뼈 가중치를 지우고 골반에 묶는다. 망토 밑단이 다리를 따라 차올라 늘어나는 것을 막는다 (SD 기사에서 생겼다)"""
    leg_groups = {vg.index for vg in body.vertex_groups if vg.name.startswith(LEGS)}
    pelvis = body.vertex_groups['pelvis']; n = 0
    for v in body.data.vertices:
        if v.co.y <= y0 or v.co.z >= z1:
            continue
        drop = [g_.group for g_ in v.groups if g_.group in leg_groups]
        if not drop:
            continue
        lost = sum(g_.weight for g_ in v.groups if g_.group in leg_groups)
        for gi in drop:
            body.vertex_groups[gi].remove([v.index])
        pelvis.add([v.index], lost, 'ADD')
        n += 1
    print(f'[cape_lock] y>{y0} z<{z1}: {n} verts moved to pelvis')


def lock_island(body, bone, point):
    """point에서 가장 가까운 꼭짓점과 이어진 조각(따로 떨어진 메시 덩어리)을 bone 하나에 무게 1로 묶는다.
    몸과 한 메시로 생성된 지팡이가 아래는 다리, 위는 손을 따라가 둘로 쪼개지는 것을 막는다 (두건 망령에서 생겼다)"""
    import bmesh
    bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
    p = Vector(point); start = min(bm.verts, key=lambda v: (v.co - p).length)
    seen, stack = {start.index}, [start]
    while stack:
        a = stack.pop()
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen:
                seen.add(b.index); stack.append(b)
    n_all = len(bm.verts); bm.free()
    if len(seen) > 0.3 * n_all:   # 몸과 이어져 있으면 몸 전체를 손에 묶게 되니 하지 않는다
        print(f'[island_lock] {bone}: island {len(seen)}/{n_all} verts is joined to the body, skipped'); return
    for vg in body.vertex_groups:
        vg.remove(list(seen))
    body.vertex_groups[bone].add(list(seen), 1.0, 'REPLACE')
    print(f'[island_lock] {bone}: {len(seen)}/{n_all} verts')


def write_json():
    """game/models/<이름>.json: 동작 표와 모델 키. frames는 반복 동작 끝에 덧붙이는 키를 뺀 원래 키 수"""
    import json
    d = {'anims': {a: {'frames': n, 'fps': fps, 'loop': bool(loop)} for a, (n, fps, loop) in ANIMS.items()}, 'height': CFG['height']}
    out = os.path.join(ROOT, 'game', 'assets', 'chars'); os.makedirs(out, exist_ok=True)
    jp = os.path.join(out, f'{NAME}.json')
    if SOCKETS:
        d['sockets'] = SOCKETS
    elif os.path.exists(jp):   # json만 다시 쓸 때(--json-only) 이미 계산해 둔 소켓은 지킨다
        old = json.load(open(jp, encoding='utf-8'))
        if 'sockets' in old:
            d['sockets'] = old['sockets']
    with open(jp, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2); fh.write('\n')
    print('[json]', os.path.join(out, f'{NAME}.json'))


def shrink_textures(maxdim):
    """텍스처 긴 변을 maxdim으로 줄인다 (용량). TRELLIS 텍스처는 2048"""
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > maxdim:
            k = maxdim / max(w, h); img.scale(max(1, round(w * k)), max(1, round(h * k)))
            print(f'[tex] {img.name} {w}x{h} -> {img.size[0]}x{img.size[1]}')


def fix_white_texture(min_area=120):
    """텍스처의 밝고 채도 낮은 덩어리(흰색·연한 흰청색)를 주변의 흰색이 아닌 색으로 채운다.
    TRELLIS가 원화에서 안 보이던 면(박쥐 날개 막 뒷면)을 흰 배경색으로 채워서 게임에서 큰 흰 조각으로 보인다.
    1) 엄격한 흰색(최소 채널 > 0.62, 채도 < 0.2) 덩어리 중 min_area 픽셀 이상인 것만 씨앗으로 삼는다 (눈·이빨 같은 작고 밝은 부분은 남긴다).
    2) 씨앗에서 느슨한 흰색(최소 채널 > 0.45, 채도 < 0.4) 쪽으로 15칸 번지게 해 덩어리 안의 연한 청색 무늬와 가장자리 번짐까지 잡고, 2칸 더 부풀린다.
    3) 그 자리를 주변 비(非)흰 픽셀 색으로 채운다(해상도를 줄여 가며 평균을 모으고 거친 단계에서 내려오는 push-pull 번짐. 한 칸씩 번지는 반복 팽창은 8방향 줄무늬가 생겨서 이쪽으로 바꿨다). 채운 곳만 흐린다.
    손질 전·후는 art/3d/<이름>/tex_fix.png에 나란히 쓴다"""
    import numpy as np
    from collections import deque
    img = max(bpy.data.images, key=lambda i: i.size[0] * i.size[1])
    w, h = img.size
    a = np.array(img.pixels[:], np.float32).reshape(h, w, 4); before = a.copy()
    rgb = a[..., :3]; mx = rgb.max(2); mn = rgb.min(2); sat = mx - mn
    strict = (mn > 0.62) & (sat < 0.2); loose = (mn > 0.45) & (sat < 0.4)
    lab = np.zeros((h, w), np.int32); seed = np.zeros((h, w), bool); n = 0; kept = []
    for y0, x0 in zip(*np.nonzero(strict)):
        if lab[y0, x0]:
            continue
        n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n; comp = []
        while q:
            y, x = q.popleft(); comp.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and strict[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n; q.append((yy, xx))
        if len(comp) >= min_area:
            kept.append(len(comp)); ys, xs = zip(*comp); seed[list(ys), list(xs)] = True
    def dil(m):
        d = m.copy(); d[1:] |= m[:-1]; d[:-1] |= m[1:]; d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]
        return d
    mask = seed.copy()
    for _ in range(15):
        mask = (dil(mask) & loose) | seed
    for _ in range(2):
        mask = dil(mask)
    def shifted(arr, dy, dx):   # 가장자리는 돌려 붙이지 않고 0으로 채운다
        o = np.zeros_like(arr)
        ys, yd = (slice(dy, None), slice(0, -dy)) if dy > 0 else (slice(0, dy or None), slice(-dy, None)) if dy < 0 else (slice(None), slice(None))
        xs, xd = (slice(dx, None), slice(0, -dx)) if dx > 0 else (slice(0, dx or None), slice(-dx, None)) if dx < 0 else (slice(None), slice(None))
        o[ys, xs] = arr[yd, xd]
        return o
    dirs = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
    out = a[..., :3].copy(); known = ~mask
    # 채우기: 해상도를 반씩 줄여 가며 아는 픽셀의 평균을 모은 뒤(push), 모르는 곳을 거친 단계에서부터 채워 내려온다(pull).
    # 한 칸씩 번지는 방식은 8방향 줄무늬가 생겨서 이쪽이 매끈하다. 아는 픽셀은 그대로 둔다
    levels = [(out * known[..., None], known.astype(np.float32))]
    while min(levels[-1][1].shape) > 1:
        num, wt = levels[-1]; hh, ww = wt.shape; ph, pw = hh % 2, ww % 2
        if ph or pw:
            num = np.pad(num, ((0, ph), (0, pw), (0, 0))); wt = np.pad(wt, ((0, ph), (0, pw)))
        levels.append((num[0::2, 0::2] + num[1::2, 0::2] + num[0::2, 1::2] + num[1::2, 1::2], wt[0::2, 0::2] + wt[1::2, 0::2] + wt[0::2, 1::2] + wt[1::2, 1::2]))
    avg = None
    for num, wt in reversed(levels):
        cur = num / np.maximum(wt, 1e-6)[..., None]; has = wt > 1e-6
        if avg is not None:
            up = np.repeat(np.repeat(avg, 2, 0), 2, 1)[:wt.shape[0], :wt.shape[1]]
            for _ in range(2):   # 거친 단계의 네모 자국을 지운다
                t = np.zeros_like(up)
                for dy, dx in dirs + [(0, 0)]:
                    t += shifted(up, dy, dx)
                up = t / 9
            cur = np.where(has[..., None], cur, up)
        avg = cur
    out[mask] = avg[mask]
    for _ in range(40):   # 채운 곳만 흐려 이음매를 누그러뜨린다
        s = np.zeros_like(out)
        for dy, dx in dirs + [(0, 0)]:
            s += shifted(out, dy, dx)
        out[mask] = (s / 9)[mask]
    a[..., :3] = out
    img.pixels[:] = a.ravel(); img.update()
    # 손질 전·후를 나란히
    side = np.concatenate([before, a], axis=1)
    cmp_img = bpy.data.images.new('tex_fix', side.shape[1], side.shape[0], alpha=True)
    cmp_img.pixels[:] = side.ravel(); cmp_img.filepath_raw = os.path.join(ROOT, 'art', '3d', NAME, 'tex_fix.png'); cmp_img.file_format = 'PNG'; cmp_img.save()
    bpy.data.images.remove(cmp_img)
    print(f'[fix_white] seeds {len(kept)} (sizes {sorted(kept, reverse=True)[:6]}), filled px {int(mask.sum())}')


def attach_set(arm, ej, ed):
    """부품 여러 개(ATTACH_SET)를 한 몸에 함께 붙여 서기·slash1·slash3·bash1을 렌더한다 (몸 4벌 + 카일 비교용)"""
    import json
    from mathutils import Quaternion, Euler
    sc = common.setup_render(320); sc.render.film_transparent = True
    common.add_sun(rot=(55, 0, -35), strength=2.5)
    common.add_ortho_camera(0.58, 1.45, 20)   # 투구·깃털이 잘리지 않게 위까지 담는다
    arm.rotation_mode = 'XYZ'; arm.rotation_euler[2] = math.radians(35)
    poses = [('idle', 0, 8), ('slash1', 2, 5), ('slash3', 3, 7), ('bash1', 2, 5)]
    outd = os.path.join(ROOT, 'art', '3d', 'equip', '_bodies'); os.makedirs(outd, exist_ok=True)
    placed = []
    for pid in ATTACH_SET:
        e = ej[pid]; sock = SOCKETS[e['slot']]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(ed, pid + '.glb'))
        new = [o for o in bpy.data.objects if o not in before]; meshes = [o for o in new if o.type == 'MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        part = bpy.context.view_layer.objects.active
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for o in new:
            if o.name in bpy.data.objects and o is not part:
                bpy.data.objects.remove(o, do_unlink=True)
        qx, qy, qz, qw = sock['quat']
        T = Matrix.Translation(Vector(sock['pos'])) @ Quaternion((qw, qx, qy, qz)).to_matrix().to_4x4()
        T = T @ (Matrix.Translation(Vector(e['pos'])) @ Euler([math.radians(a) for a in e['rot']], 'XYZ').to_matrix().to_4x4() @ Matrix.Scale(e['scale'], 4))
        part.matrix_world = from_gltf_local(arm, sock['bone'], T)
        skin_rigid(part, sock['bone'], arm)
        placed.append(part)
    for k, (a, i, n) in enumerate(poses):
        g['apply_pose'](arm, pose(a, i, n))
        sc.render.filepath = os.path.join(outd, f'{NAME}_{k}.png'); bpy.ops.render.render(write_still=True)
    print('[attach_set]', NAME, ATTACH_SET)


def attach_check(arm, sP):
    """부품을 소켓 json·equip.json 값으로 카일 몸(뼈 자식처럼 피부로 묶어)에 붙여 서기·베기·방패 밀치기를 렌더한다.
    art/3d/equip/_attach/<id>_<k>.png (k는 자세 번호). 합친 그림은 호출한 쪽이 만든다"""
    import json
    from mathutils import Quaternion, Euler
    ed = os.path.join(ROOT, 'game', 'models', 'equip'); ej = json.load(open(os.path.join(ed, 'equip.json'), encoding='utf-8'))
    ids = [k for k in ej if os.path.exists(os.path.join(ed, k + '.glb'))]
    if ATTACH_SET:
        attach_set(arm, ej, ed)
        return
    sc = common.setup_render(320); sc.render.film_transparent = True
    common.add_sun(rot=(55, 0, -35), strength=2.5)
    common.add_ortho_camera(0.5, 1.25, 20)
    arm.rotation_mode = 'XYZ'; arm.rotation_euler[2] = math.radians(35)
    poses = [('idle', 0, 8), ('slash1', 2, 5), ('slash3', 3, 7), ('bash1', 2, 5)]
    outd = os.path.join(ROOT, 'art', '3d', 'equip', '_attach'); os.makedirs(outd, exist_ok=True)
    for pid in ids:
        e = ej[pid]; sock = SOCKETS[e['slot']]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(ed, pid + '.glb'))
        new = [o for o in bpy.data.objects if o not in before]; meshes = [o for o in new if o.type == 'MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        part = bpy.context.view_layer.objects.active
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for o in new:
            if o.name in bpy.data.objects and o is not part:
                bpy.data.objects.remove(o, do_unlink=True)
        # 소켓(glTF 로컬) · 보정값 → Blender 세계 행렬
        qx, qy, qz, qw = sock['quat']
        T = Matrix.Translation(Vector(sock['pos'])) @ Quaternion((qw, qx, qy, qz)).to_matrix().to_4x4()
        T = T @ (Matrix.Translation(Vector(e['pos'])) @ Euler([math.radians(a) for a in e['rot']], 'XYZ').to_matrix().to_4x4() @ Matrix.Scale(e['scale'], 4))
        part.matrix_world = from_gltf_local(arm, sock['bone'], T)
        skin_rigid(part, sock['bone'], arm)
        for k, (a, i, n) in enumerate(poses):
            g['apply_pose'](arm, pose(a, i, n))
            sc.render.filepath = os.path.join(outd, f'{pid}_{k}.png'); bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(part, do_unlink=True)
    print('[attach]', ids)


def main():
    if JSON_ONLY:   # 기존 모델(GLB는 다시 만들지 않는다)의 동작 표만 쓴다
        write_json(); return
    common.reset()
    body = common.import_glb(os.path.join(ROOT, CFG['glb']), height=CFG['height'], rot_z_deg=CFG['rot'], weld=CFG.get('weld', False))
    if CFG.get('decimate'):   # 메시 정점 줄이기 (몬스터만). 뼈대·가중치를 만들기 전에 한다
        n0 = len(body.data.polygons)
        bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
        md = body.modifiers.new('dec', 'DECIMATE'); md.decimate_type = 'COLLAPSE'; md.ratio = CFG['decimate']
        bpy.ops.object.modifier_apply(modifier='dec')
        print(f'[decimate] polys {n0} -> {len(body.data.polygons)} (ratio {CFG["decimate"]})')
    if CFG.get('tex'):
        shrink_textures(CFG['tex'])
    if CFG.get('fix_white'):   # 텍스처에 구워진 흰 덩어리 지우기 (박쥐)
        fix_white_texture()
    if CFG['kind'] == 'quad':
        arm = g['build_armature'](quad_bones_sd(body))
        g['skin'](body, arm)
        equip = {}   # 네발짐승은 장비가 없다
    elif CFG['kind'] in ('wing', 'vine'):
        # 날개형·덩굴형: 자동 가중치가 얇은 날개 막·덩굴에서 실패하기 쉬워 위치(|x|, z)로 직접 나눈다
        bones, wfn = (wing_bones(body), wing_weights) if CFG['kind'] == 'wing' else (vine_bones(body), vine_weights)
        arm = g['build_armature'](bones)
        skin_custom(body, arm, wfn)
        equip = {}
    else:
        arm = g['build_armature'](g['biped_bones'](body))
        g['skin'](body, arm)
        if CFG.get('head_lock'):
            lock_head(body, CFG['head_lock'])
        if CFG.get('cape_lock'):
            lock_cape(body, *CFG['cape_lock'])
        if CFG.get('island_lock'):
            lock_island(body, *CFG['island_lock'])
        equip = g['build_equipment'](arm, body)
    if 'sword' in equip and CFG.get('sword_scale'):  # 큰 칼: 손잡이(칼 원점에서 -0.19)를 축으로 축마다(폭·두께·길이) 키운다
        k = Vector(CFG['sword_scale']); grip = Vector((0, 0, -0.19))
        for v in equip['sword'].data.vertices:
            d = v.co - grip; v.co = grip + Vector((d.x * k.x, d.y * k.y, d.z * k.z))
    if 'sword' in equip:
        # 칼 방향: 손뼈 방향(A자세라 바깥으로 벌어짐)을 따르면 칼이 옆으로 삐죽 나온다. 아래·조금 앞으로 늘어뜨린다
        sw = equip['sword']; hb = arm.data.bones['hand_R']
        blade = Vector((-0.12, -0.45, -1.0)).normalized()
        grip_w = hb.head_local.lerp(hb.tail_local, 0.5)
        R = blade.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        # 칼 원점은 칼날 가운데라서, 손잡이(-0.19)가 손에 오도록 칼날 방향으로 밀어 둔다
        sw.matrix_world = Matrix.Translation(grip_w + blade * 0.19 * CFG['sword_scale'][2]) @ R
        # 뼈에 붙인(BONE 부모) 물체는 GLB로 내보내면 three.js에서 약 0.2 아래로 어긋났다.
        # 그래서 칼도 몸처럼 피부로 만든다: 꼭짓점을 제자리에 굳히고 hand_R에 무게 1로 묶는다
        bpy.context.view_layer.update(); mw = sw.matrix_world.copy()
        sw.parent = None; sw.matrix_world = mw
        bpy.ops.object.select_all(action='DESELECT'); sw.select_set(True); bpy.context.view_layer.objects.active = sw
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        sw.parent = arm  # skin_rigid가 다시 굳힌다
        # 손잡이(가죽 재질) 꼭짓점의 가운데를 찾아 그곳이 손에 오도록 칼 전체를 옮긴다
        li = next(i for i, m in enumerate(sw.data.materials) if m.name.startswith('leather'))
        gv = {v for p in sw.data.polygons if p.material_index == li for v in p.vertices}
        gc = sum((sw.data.vertices[i].co for i in gv), Vector()) / len(gv)
        print('[sword] grip was', tuple(round(c, 3) for c in gc), 'hand', tuple(round(c, 3) for c in grip_w))
        for v in sw.data.vertices:
            v.co += grip_w - gc
        skin_rigid(sw, 'hand_R', arm)
        # 게임 화면에서 칼이 보이게 밝은 강철·금색으로
        for m in sw.data.materials:
            b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            b.inputs['Base Color'].default_value = {'steel': (0.62, 0.66, 0.72, 1), 'gold': (0.85, 0.6, 0.18, 1),
                                                    'leather': (0.25, 0.13, 0.06, 1)}.get(m.name, b.inputs['Base Color'].default_value)
    if 'shield' in equip:  # 방패: 아래팔 바깥에 붙은 자리 그대로 키워서 farm_L에 묶는다
        sh = equip['shield']
        if CFG.get('shield_scale'):
            sh.scale = (CFG['shield_scale'],) * 3
        skin_rigid(sh, 'farm_L', arm)
    if CFG.get('sockets'):   # 장비 소켓 (카일): 뼈 기준 위치·회전을 json에 적는다
        sj, sP = compute_sockets(arm)
        SOCKETS.update(sj)
        if ATTACH_CHECK:
            attach_check(arm, sP)
            return
    def posed(anim, i, n):
        """몬스터의 쓰러짐·무릎 꿇기는 몸이 땅 밑으로 가라앉지 않게 루트를 들어 올린다 (기존 sd 쓰러짐 키는 dz -0.41이라 몸이 0.38쯤 묻힌다). 1% 지점이 z=0이 되게 맞춘다"""
        p = pose(anim, i, n)
        if 'poser' in CFG and anim in ('death', 'kneel'):
            g['apply_pose'](arm, p); bpy.context.view_layer.update()
            ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get()); me = ev.to_mesh()
            zs = sorted(v.co.z for v in me.vertices); ev.to_mesh_clear()
            zmin = zs[int(0.01 * len(zs))]   # 망토·옷자락 끝이 몇 점 아래로 늘어나는 것은 무시하고 아래 1% 지점을 땅에 맞춘다
            if zmin < 0:
                x, y, z = p['_root']; p['_root'] = (x, y, z - zmin)
        return p
    # 동작마다 액션 하나. 키는 프레임 번호 = 키 번호 (게임이 초당 키 수로 시간을 맞춘다)
    arm.animation_data_create()
    for anim, (n, fps, loop) in ANIMS.items():
        act = bpy.data.actions.new(anim); arm.animation_data.action = act
        keys = list(range(n)) + ([0] if loop else [])
        for f, i in enumerate(keys):
            g['apply_pose'](arm, posed(anim, i, n))
            for pb in arm.pose.bones:
                pb.keyframe_insert('rotation_quaternion', frame=f)
                if pb.parent is None:
                    pb.keyframe_insert('location', frame=f)
        act.use_fake_user = True
        tr = arm.animation_data.nla_tracks.new(); tr.name = anim
        tr.strips.new(anim, 0, act); tr.mute = True
    arm.animation_data.action = None
    g['apply_pose'](arm, {})
    out = os.path.join(ROOT, 'game', 'assets', 'chars'); os.makedirs(out, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    # tex가 있는 몬스터는 텍스처를 WebP로 넣는다 (fallback 없이 EXT_texture_webp 필수). 나머지는 이전과 같은 인자
    extra = dict(export_image_format='WEBP', export_image_quality=85, export_jpeg_quality=85) if CFG.get('tex') else {}
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, f'{NAME}.glb'), export_format='GLB', use_selection=True,
                              export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True,
                              export_force_sampling=True, export_frame_range=False, **extra)
    write_json()
    print('[done]', os.path.join(out, f'{NAME}.glb'))

    # 확인 그림: 모델마다 check에 적은 동작 칸, 정면과 옆
    sc = common.setup_render(256); sc.render.film_transparent = True
    common.add_sun(rot=(55, 0, -35), strength=2.5)
    cam = common.add_ortho_camera(*CFG.get('check_cam', (0.5, 1.6)), 20)
    chk = os.path.join(ROOT, 'art', '3d', NAME, '_check')
    os.makedirs(chk, exist_ok=True)
    poses = CFG['check']
    for rz in (0, 90):
        arm.rotation_euler[2] = math.radians(rz)
        for k, (a, i, n) in enumerate(poses):
            g['apply_pose'](arm, posed(a, i, n))
            if rz == 0:   # 땅에 묻히거나 뜨지 않는지: 변형된 몸 메시의 가장 낮은 높이(z)
                bpy.context.view_layer.update()
                ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get()); me = ev.to_mesh()
                zs = [v.co.z for v in me.vertices]; ys = [v.co.y for v in me.vertices]; xs = [v.co.x for v in me.vertices]
                jm = zs.index(min(zs)); gm = max(body.data.vertices[jm].groups, key=lambda q: q.weight)
                print(f'[zrange] {a} {i}/{n}: z {min(zs):.3f} .. {max(zs):.3f}  y {min(ys):.3f} .. {max(ys):.3f}  x {min(xs):.3f} .. {max(xs):.3f}  lowest {body.vertex_groups[gm.group].name} {tuple(round(c, 2) for c in body.data.vertices[jm].co)}'); ev.to_mesh_clear()
            sc.render.filepath = os.path.join(chk, f'{rz}_{k}.png'); bpy.ops.render.render(write_still=True)


main()
