# Blender 공용 함수: GLB 불러오기·정규화·카메라·렌더 설정. bake.py와 inspect.py가 함께 쓴다.
import bpy, math, mathutils


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path, height=1.0, rot_z_deg=0.0, weld=False):
    """GLB를 불러와 메시 하나로 합치고, 발이 z=0, 중심이 원점, 높이가 height가 되게 맞춘다.
    weld: 같은 자리의 꼭짓점을 먼저 합친다. 삼각형마다 꼭짓점이 따로인 GLB(Tripo 두건 망령)는 그대로 두면
    drop_ground_shadow가 작은 조각(40개 미만)으로 보고 대부분 지운다 (5864개 중 4895개가 지워졌다)"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for o in new:
        if o.name in bpy.data.objects and o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if weld:
        import bmesh
        bm = bmesh.new(); bm.from_mesh(obj.data); n0 = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        print(f'[weld] verts {n0} -> {len(bm.verts)}')
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
    drop_ground_shadow(obj)
    obj.rotation_mode = 'XYZ'  # glTF는 쿼터니언으로 들어와 rotation_euler가 무시된다
    obj.rotation_euler = (0, 0, math.radians(rot_z_deg))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    xs = [v.co.x for v in obj.data.vertices]; ys = [v.co.y for v in obj.data.vertices]; zs = [v.co.z for v in obj.data.vertices]
    s = height / (max(zs) - min(zs))
    cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
    for v in obj.data.vertices:
        v.co = mathutils.Vector(((v.co.x - cx) * s, (v.co.y - cy) * s, (v.co.z - z0) * s))
    obj.data.update()
    obj.name = 'model'
    return obj


def drop_ground_shadow(obj):
    """원화의 바닥 그림자가 납작한 판으로 같이 만들어진다. 떨어진 조각 중 바닥에 붙은 얇은 판을 지운다."""
    import bmesh
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.index_update()
    zs = [v.co.z for v in bm.verts]; z0, H = min(zs), max(zs) - min(zs)
    seen, kill = set(), []
    for v in list(bm.verts):
        if v.index in seen:
            continue
        part, stack = [], [v]
        seen.add(v.index)
        while stack:
            a = stack.pop(); part.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index); stack.append(b)
        pz = [p.co.z for p in part]
        if (max(pz) - min(pz) < 0.04 * H and max(pz) < z0 + 0.06 * H) or len(part) < 40:
            kill += part
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    print('ground shadow verts removed:', len(kill))


def symmetrize(obj, direction='NEGATIVE_X'):
    """원화에 한쪽 옆모습만 있으면 TRELLIS가 반대쪽 무늬를 망친다. 잘 나온 쪽(-X: 정면을 보는 모델의 오른쪽)을 반대쪽에 복사한다."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.symmetrize(direction=direction, threshold=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')


def bbox(obj):
    xs = [v.co.x for v in obj.data.vertices]; ys = [v.co.y for v in obj.data.vertices]; zs = [v.co.z for v in obj.data.vertices]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def setup_render(size, engine='EEVEE'):
    sc = bpy.context.scene
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    want = {'EEVEE': [e for e in engines if 'EEVEE' in e], 'WORKBENCH': ['BLENDER_WORKBENCH']}[engine]
    sc.render.engine = want[0]
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (0.55, 0.58, 0.65, 1)
    bg.inputs[1].default_value = 0.9
    return sc


def add_sun(rot=(50, 0, -40), strength=3.0):
    d = bpy.data.lights.new('sun', 'SUN'); d.energy = strength
    o = bpy.data.objects.new('sun', d); bpy.context.collection.objects.link(o)
    o.rotation_euler = [math.radians(a) for a in rot]
    return o


def add_ortho_camera(target_z, ortho_scale, pitch_deg=40.0, dist=10.0):
    """쿼터뷰 카메라. 모델 정면(-Y)을 기준으로 앞쪽 위에서 내려다본다. 방향 전환은 모델 쪽을 돌린다."""
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = ortho_scale
    o = bpy.data.objects.new('cam', cam); bpy.context.collection.objects.link(o)
    p = math.radians(pitch_deg)
    o.location = (0, -dist * math.cos(p), target_z + dist * math.sin(p))
    o.rotation_euler = (math.radians(90) - p, 0, 0)
    bpy.context.scene.camera = o
    return o
