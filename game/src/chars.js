// 학생 캐릭터(뼈대·동작이 있는 GLB): 액션 RPG(char3d.js)와 같은 셀 셰이딩 + 뒤집은 껍데기 외곽선.
// 모델과 동작 표(json)는 tools/pipeline/rig3d.py가 만든다 (assets/chars/<이름>.glb, .json).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const OUTLINE = 0.012;   // 모델 키 1 기준 외곽선 두께
const KID_HEIGHT = 1.45;  // 게임 속 키(칸)

function toonGradient() {
  const d = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
const grad = toonGradient();

// 외곽선: 뒤집은 껍데기를 법선 방향으로 부풀려 검게 그린다(뼈대를 같이 따른다)
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x140c12, side: THREE.BackSide });
outlineMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <skinning_vertex>',
    `#include <skinning_vertex>\n  transformed += normalize(objectNormal) * ${OUTLINE.toFixed(4)};`);
};

const models = {};   // 이름 → { scene, clips, meta }

export async function loadKids(names, onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(names.map(async name => {
    try {
      const [gltf, meta] = await Promise.all([
        loader.loadAsync(`assets/chars/${name}.glb`),
        fetch(`assets/chars/${name}.json`).then(r => r.json()),
      ]);
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        const src = o.material;
        // 어두운 저택에서도 얼굴이 보이게 바탕색을 조금 스스로 빛나게 둔다
        o.material = new THREE.MeshToonMaterial({ map: src.map || null, color: src.color.clone(), gradientMap: grad,
          emissive: 0xffffff, emissiveMap: src.map || null, emissiveIntensity: 0.32 });
        o.frustumCulled = false; o.castShadow = true;
      });
      models[name] = { scene: gltf.scene, clips: Object.fromEntries(gltf.animations.map(c => [c.name, c])), meta };
    } catch (e) { console.warn('학생 모델을 못 불러옴:', name, e); }
    onProgress?.(++done / names.length);
  }));
}
export const hasKid = name => !!models[name];

// 학생 하나 = 모델 사본 하나(뼈대를 따로 움직인다)
export function makeKid(name, outline = true) {
  const M = models[name]; if (!M) return null;
  const root = cloneSkinned(M.scene);
  if (outline) {
    const skinned = []; root.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
    for (const m of skinned) {
      const hull = new THREE.SkinnedMesh(m.geometry, outlineMat);
      hull.bind(m.skeleton, m.bindMatrix); hull.frustumCulled = false;
      hull.position.copy(m.position); hull.quaternion.copy(m.quaternion); hull.scale.copy(m.scale);
      m.parent.add(hull);
    }
  }
  const holder = new THREE.Group(); holder.add(root);
  holder.scale.setScalar(KID_HEIGHT / (M.meta.height || 1));
  return { M, holder, mixer: new THREE.AnimationMixer(root), cur: null, act: null, t: 0 };
}

// 동작 고르기와 시간 진행. 반복 동작은 한 바퀴를 클립 길이에 맞춘다
export function playKid(K, anim, dt, speed = 1) {
  const clip = K.M.clips[anim] || K.M.clips.idle;
  if (!clip) return;
  if (K.cur !== clip) {
    const next = K.mixer.clipAction(clip);
    next.reset().play();
    if (K.act) next.crossFadeFrom(K.act, 0.15, false);
    K.act = next; K.cur = clip; K.t = 0;
    const meta = K.M.meta.anims[clip.name] || { loop: true };
    next.setLoop(meta.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); next.clampWhenFinished = !meta.loop;
    const cycle = meta.frames && meta.fps ? meta.frames / meta.fps : clip.duration;
    next.timeScale = clip.duration / cycle;
  }
  K.mixer.update(dt * speed);
}
