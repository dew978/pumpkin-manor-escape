// 스테이지 장면 만들기: 바닥·벽·가구·조명·탈출문·새장·옷장·쪽지·아이템.
import * as THREE from 'three';
import { spawnModel, floorTexture, wallTextures, bookTexture, wardrobeTexture, fragmentTexture, glowTexture, canvasTex } from './assets.js';
import { EDGE_COLORS, ITEMS } from './config.js';
import { parseMap } from './grid.js';

// 카메라와 학생 사이를 가리는 벽은 그물눈처럼 비워서 안이 보이게 한다
export const fadeUniform = { value: new THREE.Vector3(0, 0, -99) };
function addFade(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFadeP = fadeUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFadeWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fadeWP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fadeWP = instanceMatrix * fadeWP;
      #endif
      vFadeWP = (modelMatrix * fadeWP).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFadeWP;\nuniform vec3 uFadeP;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (vFadeWP.y > 0.3 && vFadeWP.z > uFadeP.z + 0.55 && vFadeWP.z < uFadeP.z + 4.2 && abs(vFadeWP.x - uFadeP.x) < 2.4) {
        vec2 q = mod(floor(gl_FragCoord.xy), 3.0);
        if (q.x + q.y * 3.0 < 7.0) discard;
      }`);
  };
  mat.customProgramCacheKey = () => 'fade';
  return mat;
}

// 벽·바닥도 Lambert(불빛이 많을 때 Standard보다 훨씬 가볍다)
const std = ({ roughness, metalness, ...o }) => new THREE.MeshLambertMaterial(o);

export function buildWorld(stage, opts) {
  const g = parseMap(opts.map || stage.map);   // opts.map: 새장 자리를 옮긴 이번 판 지도
  const group = new THREE.Group();
  const W = g.W, H = g.H;
  const props = [], lights = [], animated = [], chests = [];

  // 바닥
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), std({ map: floorTexture(stage.style, W, H), roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set((W - 1) / 2, 0, (H - 1) / 2); floor.receiveShadow = true;
  group.add(floor);

  // 벽
  const wt = wallTextures(stage.style);
  const walls = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g.at(c, r) === '#') walls.push({ c, r });
  const wallGeo = new THREE.BoxGeometry(1, wt.height, 1); wallGeo.translate(0, wt.height / 2, 0);
  const sideMat = addFade(std({ map: wt.side })), topMat = addFade(std({ map: wt.top, color: 0x777777 }));
  const wallMesh = new THREE.InstancedMesh(wallGeo, [sideMat, sideMat, topMat, topMat, sideMat, sideMat], walls.length);
  const m4 = new THREE.Matrix4();
  walls.forEach((w, i) => { m4.makeTranslation(w.c, 0, w.r); wallMesh.setMatrixAt(i, m4); });
  wallMesh.castShadow = true; wallMesh.receiveShadow = true;
  group.add(wallMesh);

  // 책장
  const shelves = []; for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g.at(c, r) === 'B') shelves.push({ c, r });
  if (shelves.length) {
    const sg = new THREE.BoxGeometry(0.98, 2.2, 0.9); sg.translate(0, 1.1, 0);
    const bm = addFade(std({ map: bookTexture() })), wood = addFade(std({ color: 0x2a170e }));
    const sm = new THREE.InstancedMesh(sg, [bm, bm, wood, wood, bm, bm], shelves.length);
    shelves.forEach((s, i) => { m4.makeTranslation(s.c, 0, s.r); sm.setMatrixAt(i, m4); });
    sm.castShadow = true; sm.receiveShadow = true; group.add(sm);
  }
  // 식탁
  const tables = []; for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g.at(c, r) === 'Q') tables.push({ c, r });
  if (tables.length) {
    const tg = new THREE.BoxGeometry(1.01, 0.12, 1.0); tg.translate(0, 0.78, 0);
    const tm = new THREE.InstancedMesh(tg, std({ color: 0x3b2214, roughness: 0.6 }), tables.length);
    const cloth = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 0.02, 0.5).translate(0, 0.85, 0), std({ color: 0x5a1020 }), tables.length);
    tables.forEach((s, i) => { m4.makeTranslation(s.c, 0, s.r); tm.setMatrixAt(i, m4); cloth.setMatrixAt(i, m4); });
    tm.castShadow = true; group.add(tm, cloth);
    tables.filter((_, i) => i % 3 === 1).forEach(s => {
      const cdl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 6), std({ color: 0xeee2c8 })); cdl.position.set(s.c, 0.97, s.r);
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,190,90'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffffff }));
      fl.scale.setScalar(0.35); fl.position.set(s.c, 1.13, s.r); group.add(cdl, fl);
    });
  }
  // 묘비
  const graves = []; for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g.at(c, r) === 'g') graves.push({ c, r });
  if (graves.length) {
    const stone = std({ color: 0x777482, roughness: 1 });
    const gb = new THREE.BoxGeometry(0.62, 0.8, 0.18); gb.translate(0, 0.4, 0);
    const gt = new THREE.CylinderGeometry(0.31, 0.31, 0.18, 14, 1, false, 0, Math.PI); gt.rotateX(Math.PI / 2); gt.rotateZ(Math.PI / 2); gt.translate(0, 0.8, 0);
    const im1 = new THREE.InstancedMesh(gb, stone, graves.length), im2 = new THREE.InstancedMesh(gt, stone, graves.length);
    graves.forEach((s, i) => { m4.makeRotationY(((s.c * 7 + s.r * 3) % 5 - 2) * 0.12).setPosition(s.c, 0, s.r); im1.setMatrixAt(i, m4); im2.setMatrixAt(i, m4); });
    im1.castShadow = im2.castShadow = true; group.add(im1, im2);
  }

  // 옷장(숨는 곳): 열린 쪽을 바라보게
  const wardrobes = [];
  const wtex = wardrobeTexture();
  for (const h of g.spots.H) {
    const dir = [[0, 1], [0, -1], [1, 0], [-1, 0]].find(([dc, dr]) => !g.solid(h.c + dc, h.r + dr)) || [0, 1];
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.96, 2.15, 0.72).translate(0, 1.075, 0), [addFade(std({ color: 0x2c1a10 })), addFade(std({ color: 0x2c1a10 })), addFade(std({ color: 0x1c0f08 })), std({ color: 0x1c0f08 }), addFade(std({ map: wtex })), addFade(std({ color: 0x2c1a10 }))]);
    body.castShadow = true; body.receiveShadow = true;
    const crown = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.12, 0.8).translate(0, 2.2, 0), addFade(std({ color: 0x1c0f08 })));
    grp.add(body, crown);
    grp.position.set(h.c, 0, h.r); grp.rotation.y = Math.atan2(dir[0], dir[1]);
    group.add(grp); wardrobes.push({ c: h.c, r: h.r, grp, body });
  }

  // GLB 소품
  const TALL = new Set(['tree', 'well', 'throne', 'scarecrow', 'chandelier']);
  const place = (name, c, r, height, rot = null, fit = 'h') => {
    const o = spawnModel(name, height, fit);
    // 키 큰 소품도 학생을 가리면 그물눈처럼 비운다(재질은 같은 모델끼리 공유하므로 한 번만)
    if (TALL.has(name)) o.traverse(m => { if (m.isMesh) for (const mat of [].concat(m.material)) if (!mat.userData.fade) { mat.userData.fade = true; addFade(mat); mat.needsUpdate = true; } });
    o.position.set(c, 0, r);
    o.rotation.y = rot ?? ((c * 13 + r * 7) % 8) * Math.PI / 4;
    group.add(o); props.push(o); return o;
  };
  const lightSpots = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = g.at(c, r);
    if (ch === 'L') { place('lantern', c, r, 0.95, 0); lightSpots.push({ c, r, y: 0.75, color: 0xffa040, int: 7, dist: 7 }); }
    else if (ch === 'C') { const o = place('chandelier', c, r, 1.0); o.position.y = 1.6; lightSpots.push({ c, r, y: 2.1, color: 0xffc070, int: 9, dist: 8 }); }
    else if (ch === 'T') place('bench', c, r, 1.05, 0, 'h');
    else if (ch === 'h') place('chair', c, r, 1.1);
    else if (ch === 'R') place('throne', c, r, 1.7, 0);
    else if (ch === 'b') place('barrel', c, r, 0.95);
    else if (ch === 'c') {
      // 호박 상자: 문제를 맞히면 아이템. 열리기 전에는 주황빛과 물음표가 보인다
      const o = place('chest', c, r, 0.62, 0);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,150,40'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      glow.scale.setScalar(1.5); glow.position.set(c, 0.4, r);
      const mark = labelSprite('?', '#ffb347', 0.5); mark.position.set(c, 1.25, r);
      group.add(glow, mark); chests.push({ c, r, o, glow, mark, opened: false });
    }
    else if (ch === 'o') { const ped = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.6).translate(0, 0.35, 0), std({ color: 0x4a4650 })); ped.position.set(c, 0, r); group.add(ped); const o = place('owl', c, r, 0.9, 0); o.position.y = 0.7; }
    else if (ch === 'w') place('well', c, r, 1.6);
    else if (ch === 't') place('tree', c, r, 3.4);
    else if (ch === 's') place('scarecrow', c, r, 1.8, 0);
  }
  // 책상 위 소품 몇 개
  props.filter((_, i) => i % 4 === 0).slice(0, 4).forEach((p, i) => {
    if (Math.abs(p.position.y) > 0.01) return;
    const b = spawnModel(i % 2 ? 'skull' : 'book', 0.22); b.position.set(p.position.x + 0.3, 0, p.position.z + 0.35); group.add(b);
  });

  // 소품 불빛 자리. 실제 PointLight는 main이 학생 가까운 4곳에만 옮겨 단다(불빛 수를 고정해 가볍게)
  for (const s of lightSpots) lights.push({ ...s, seed: Math.random() * 10 });
  for (const s of lightSpots) {
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,170,80'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffd0a0 }));
    gl.scale.setScalar(s.y > 1.5 ? 1.4 : 0.8); gl.position.set(s.c, s.y, s.r); group.add(gl);
  }

  // 탈출문
  const E = g.spots.E, ex = (E[0].c + E[E.length - 1].c) / 2, ez = E[0].r;
  const door = spawnModel('door', 2.0, 'w'); door.position.set(ex, 0, ez + 0.1); door.rotation.y = 0; group.add(door);
  const lockMat = new THREE.SpriteMaterial({ map: glowTexture('255,60,60'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const lock = new THREE.Sprite(lockMat); lock.scale.setScalar(1.2); lock.position.set(ex, 1.2, ez + 0.75); group.add(lock);
  const exitLight = new THREE.PointLight(0xff4040, 3, 5, 1.6); exitLight.position.set(ex, 1.4, ez + 1.2); group.add(exitLight);
  const exit = { x: ex, z: ez + 1, door, lock, light: exitLight, open: false };

  // 새장
  const cages = g.spots.X.map(x => {
    const o = spawnModel('cage', 2.1); o.position.set(x.c, 0, x.r); o.rotation.y = 0.3; group.add(o);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 40, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0x8fe0c9, transparent: true, opacity: 0.0, toneMapped: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x.c, 0.03, x.r); group.add(ring);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('130,210,255'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.scale.setScalar(2.2); glow.position.set(x.c, 1.2, x.r); group.add(glow);
    return { c: x.c, r: x.r, o, ring };
  });

  // 쪽지 조각(최대 4개), 아이템 자리
  const frags = [0, 1, 2, 3].map(i => {
    const grp = new THREE.Group();
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.43), new THREE.MeshBasicMaterial({ map: fragmentTexture(i, 4, EDGE_COLORS), transparent: true, side: THREE.DoubleSide, toneMapped: false, color: 0xd8c8a8 }));
    paper.position.y = 0.75;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,230,150'), blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffe9a0 }));
    halo.scale.setScalar(1.3); halo.position.y = 0.75;
    grp.add(halo, paper); grp.visible = false; group.add(grp);
    return { grp, paper };
  });
  const itemMeshes = new Map();
  const itemMesh = (type) => {
    const grp = new THREE.Group();
    const o = type === 'crystal' ? crystalModel() : spawnModel(ITEMS[type].model, 0.5); o.position.y = 0.35; grp.add(o);
    const col = type === 'time' ? '255,210,120' : type === 'crystal' ? '190,140,255' : '120,220,255';
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(col), blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(1.1); halo.position.y = 0.55; grp.add(halo);
    group.add(grp); return { grp, o };
  };
  // 아이템 재질을 미리 그려 둬서 처음 나타날 때 셰이더 컴파일로 멈칫하지 않게 한다
  for (const type of Object.keys(ITEMS)) { const w = itemMesh(type); w.grp.position.set(0, -50, 0); }

  // 사탕(위치는 방장이 정해 스냅숏으로 온다)
  const candyMat = new THREE.SpriteMaterial({ map: candyTexture(), depthWrite: false, toneMapped: false });
  candyLoader.load('assets/sprites/candy.png', t => { t.colorSpace = THREE.SRGBColorSpace; candyMat.map = t; candyMat.needsUpdate = true; });
  const candyGlowMat = new THREE.SpriteMaterial({ map: glowTexture('255,170,90'), opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const candies = [];
  const setCandy = (i, x, z, show) => {
    let cd = candies[i];
    if (!cd) {
      const grp = new THREE.Group(), sp = new THREE.Sprite(candyMat), gl = new THREE.Sprite(candyGlowMat);
      sp.scale.set(0.76, 0.38, 1); sp.position.y = 0.48; gl.scale.setScalar(0.8); gl.position.y = 0.45;
      grp.add(gl, sp); group.add(grp); cd = candies[i] = { grp, sp };
    }
    cd.grp.position.set(x, 0, z); cd.grp.visible = show;
  };
  const setChest = (i, opened) => {
    const ch = chests[i]; if (!ch || ch.opened === opened) return;
    ch.opened = opened; ch.glow.visible = !opened; ch.mark.visible = !opened;
    ch.o.rotation.z = opened ? 0.12 : 0;
  };

  // 할로윈 분위기: 벽 옆 바닥에 호박등을 군데군데 둔다(불빛 대신 빛 스프라이트라 태블릿에서도 가볍다)
  const jackMat = new THREE.MeshLambertMaterial({ color: 0xe8701a, emissive: 0xffffff, emissiveMap: jackFaceTexture(), emissiveIntensity: 0.9 });
  const jackGeo = new THREE.SphereGeometry(0.26, 14, 10); jackGeo.scale(1, 0.78, 1);
  const stemGeo = new THREE.CylinderGeometry(0.03, 0.05, 0.12, 6);
  const stemMat = new THREE.MeshLambertMaterial({ color: 0x3f5a22 });
  const jackGlow = new THREE.SpriteMaterial({ map: glowTexture('255,140,40'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  let jacks = 0;
  for (let r = 2; r < H - 2 && jacks < 14; r++) for (let c = 2; c < W - 2 && jacks < 14; c++) {
    if (g.at(c, r) !== '.' || hash01(c, r) > 0.075) continue;
    const wall = [[0, -1], [-1, 0], [1, 0]].find(([dc, dr]) => g.at(c + dc, r + dr) === '#');
    if (!wall) continue;
    const j = new THREE.Mesh(jackGeo, jackMat); j.position.set(c + wall[0] * 0.3, 0.2, r + wall[1] * 0.3); j.rotation.y = Math.atan2(-wall[0], -wall[1]);
    const st = new THREE.Mesh(stemGeo, stemMat); st.position.set(0, 0.24, 0); j.add(st);
    const gl = new THREE.Sprite(jackGlow); gl.scale.setScalar(1.1); gl.position.copy(j.position); gl.position.y = 0.3;
    group.add(j, gl); jacks++;
  }

  return { g, group, lights, exit, cages, wardrobes, frags, itemMeshes, itemMesh, animated, W, H, chests, candies, setCandy, setChest };
}

// 이름표·상태 표시용 스프라이트
const hash01 = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
// 포장 사탕 그림(assets/sprites/candy.png를 불러오기 전까지 쓰는 대신 그림)
const candyLoader = new THREE.TextureLoader();
function candyTexture() {
  return canvasTex(96, 56, (c, w, h) => {
    c.fillStyle = '#ff8a3a'; c.beginPath(); c.moveTo(8, 10); c.lineTo(26, 28); c.lineTo(8, 46); c.fill(); c.beginPath(); c.moveTo(88, 10); c.lineTo(70, 28); c.lineTo(88, 46); c.fill();
    c.fillStyle = '#b06bff'; c.beginPath(); c.ellipse(48, 28, 24, 18, 0, 0, 7); c.fill();
    c.strokeStyle = '#ffe0f4'; c.lineWidth = 5; for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(40 + k * 9, 10); c.lineTo(52 + k * 9, 46); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.ellipse(40, 20, 7, 4, -0.5, 0, 7); c.fill();
  });
}
// 수정구: 매끈한 유리 공 안에 보랏빛 소용돌이, 금빛 받침. 모델 파일 없이 만든다(가볍고 매끈하다)
let crystalParts = null;
function crystalModel() {
  if (!crystalParts) {
    const swirl = canvasTex(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,235,255,1)'); g.addColorStop(0.35, 'rgba(210,140,255,.75)'); g.addColorStop(1, 'rgba(90,30,180,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,225,255,.85)'; c.lineWidth = 5; c.lineCap = 'round';
      for (let k = 0; k < 3; k++) { c.beginPath(); for (let a = 0; a < 5.5; a += 0.1) { const r = 6 + a * 8.5, x = w / 2 + Math.cos(a + k * 2.09) * r, y = h / 2 + Math.sin(a + k * 2.09) * r; a ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
    });
    crystalParts = {
      ball: new THREE.SphereGeometry(0.19, 40, 28),
      ballMat: new THREE.MeshPhongMaterial({ color: 0xa57bff, emissive: 0x3c1488, specular: 0xffffff, shininess: 160, transparent: true, opacity: 0.82, depthWrite: false }),
      core: new THREE.SpriteMaterial({ map: swirl, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      gold: new THREE.MeshPhongMaterial({ color: 0xc89a3c, emissive: 0x2a1a04, specular: 0xffe6a0, shininess: 90 }),
      base: new THREE.CylinderGeometry(0.1, 0.15, 0.07, 24),
      ring: new THREE.TorusGeometry(0.115, 0.024, 10, 32),
    };
  }
  const P = crystalParts, o = new THREE.Group();
  const base = new THREE.Mesh(P.base, P.gold); base.position.y = 0.035;
  const ring = new THREE.Mesh(P.ring, P.gold); ring.rotation.x = Math.PI / 2; ring.position.y = 0.085;
  const core = new THREE.Sprite(P.core); core.scale.setScalar(0.3); core.position.y = 0.27;
  const ball = new THREE.Mesh(P.ball, P.ballMat); ball.position.y = 0.27; ball.renderOrder = 2;
  o.add(base, ring, core, ball);
  return o;
}
// 호박등 얼굴(빛나는 부분만 밝게)
function jackFaceTexture() {
  return canvasTex(128, 64, (c, w, h) => {
    c.fillStyle = '#2a1004'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffcf5a';
    c.beginPath(); c.moveTo(44, 18); c.lineTo(56, 32); c.lineTo(36, 32); c.fill();
    c.beginPath(); c.moveTo(84, 18); c.lineTo(92, 32); c.lineTo(72, 32); c.fill();
    c.beginPath(); c.moveTo(36, 40); c.quadraticCurveTo(64, 58, 92, 40); c.lineTo(80, 46); c.lineTo(72, 40); c.lineTo(64, 48); c.lineTo(56, 40); c.lineTo(48, 46); c.closePath(); c.fill();
  });
}

export function labelSprite(text, color = '#fff', scale = 0.5) {
  const tex = canvasTex(256, 64, (c, w, h) => {
    c.font = '38px "Do Hyeon", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(text, w / 2, h / 2 + 2);
    c.fillStyle = color; c.fillText(text, w / 2, h / 2 + 2);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }));
  sp.scale.set(scale * 4, scale, 1); sp.renderOrder = 20;
  return sp;
}
