// 화면 그리기, 내 학생 조작, 카메라, 접속(방장/친구), HUD·쪽지·로비.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { STAGES, MONSTERS, CHARACTERS, EDGE_COLORS, PLAYER_SPEED, diffForGrade, monsterSpots, SEARCHABLE, SEARCH_CODES, CHEST_N, roomName } from './config.js';
import { loadBank, defaultBank, validateBank, pickQuestions, BANK_KEY } from './questions.js';
import { loadModels, spawnModel, modelSize, glowTexture } from './assets.js';
import { loadKids, makeKid, playKid, hasKid } from './chars.js';
import { playComic, closeComic, comicOpen } from './comic.js';
import { say, fragLines, lumiLine, clearDialog, dialogOpen, STAGE_INTRO, AFTER_COMIC } from './dialog.js';
import { buildWorld, fadeUniform, labelSprite } from './world.js';
import { Sim, ITEM_CODES, THROW_RANGE, LURE_R } from './sim.js';
import { hostRoom, joinRoom } from './net.js';
import { parseMap, slideMove, tileOf } from './grid.js';
import { Sound } from './audio.js';
import { josa, store, esc, fmtTime, T, LANG, setLang } from './util.js';

// 영어판: index.html의 data-en(내용)·data-en-label(aria-label)·data-en-ph(placeholder)·data-en-title(title)로 바꾼다
if (LANG === 'en') {
  document.documentElement.lang = 'en'; document.title = 'Pumpkin Manor Escape';
  document.querySelectorAll('[data-en]').forEach(el => { el.innerHTML = el.dataset.en; });
  document.querySelectorAll('[data-en-label]').forEach(el => el.setAttribute('aria-label', el.dataset.enLabel));
  document.querySelectorAll('[data-en-ph]').forEach(el => { el.placeholder = el.dataset.enPh; });
  document.querySelectorAll('[data-en-title]').forEach(el => { el.title = el.dataset.enTitle; });
  document.querySelectorAll('h1.logo span[data-t]').forEach((el, i) => { el.dataset.t = ['Pumpkin Manor', 'Escape'][i]; el.firstChild.nodeValue = el.dataset.t; });
  document.getElementById('nameIn').maxLength = 10;
}
const tr = T;   // 지역 변수 T(합계)가 있는 곳에서 쓴다

const $ = (id) => document.getElementById(id);

/* ---------- 렌더러 ---------- */
const coarse = matchMedia('(pointer: coarse)').matches;
let quality = store.get('pumpkin2-q') || (coarse ? 'low' : 'high');
const HIGH = quality === 'high';
// 후처리(블룸)를 거치면 기본 안티에일리어싱은 효과가 없어서 끈다
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
// 가볍게(태블릿 기본): 화면 해상도 0.85배에서 시작하고 느리면 0.5배까지 내린다
const MAX_PR = Math.min(devicePixelRatio || 1, HIGH ? 1.25 : 0.9);
const MIN_PR = 0.6;
let pixelRatio = MAX_PR;
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = HIGH; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x040208);
// 안개 너머는 어차피 안 보이므로 멀리 있는 것은 그리지 않는다(태블릿용)
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 24);
// 얼굴이 보이도록 너무 위에서 내려다보지 않는다(약 50도)
const CAM_OFF = new THREE.Vector3(0, 7.6, 6.3);
const hemi = new THREE.HemisphereLight(0x8a7ab0, 0x140a18, 0.3); scene.add(hemi);
let composer = null, bloom = null;
if (HIGH) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.45, 0.82); composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
// 손전등: 학생마다 하나. 내 손전등만 그림자를 만든다. 좁고 밝게 멀리 뻗고, 둘레는 어둡게 둔다(으스스하게)
const torches = (HIGH ? [0, 1, 2, 3] : [0]).map(() => { const s = new THREE.SpotLight(0xfff0d2, 0, 20, 0.5, 0.25, 1.0); scene.add(s, s.target); return s; });
const aura = new THREE.PointLight(0xffd8a8, 0, 4, 1.4); scene.add(aura);
// 바닥에 비치는 빛줄기(곧게 뻗어 보이게). 가까운 쪽은 좁고 먼 쪽으로 넓어지며 흐려진다. 벽에서 끊는다
const beamTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  for (let y = 0; y < 256; y++) {
    const t = 1 - y / 255;                                   // 0 = 손전등 쪽, 1 = 먼 끝(캔버스 위가 먼 끝)
    const a = Math.min(1, t / 0.03) * (1 - t) ** 1.1, w = 32 * (0.3 + 0.7 * t);
    const gr = g.createLinearGradient(32 - w, 0, 32 + w, 0);
    gr.addColorStop(0, 'rgba(255,214,160,0)'); gr.addColorStop(0.5, `rgba(255,214,160,${a.toFixed(3)})`); gr.addColorStop(1, 'rgba(255,214,160,0)');
    g.fillStyle = gr; g.fillRect(32 - w, y, w * 2, 1);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
})();
const BEAM_LEN = 9;
const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(Math.PI / 2);   // 원점에서 +z(앞)로 뻗는 바닥 판
function makeBeam() {
  const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.renderOrder = 4; scene.add(m); return m;
}
// 앞쪽 벽까지 거리(빛줄기를 벽에서 끊는다)
function beamReach(p) {
  const g = S.world?.g; if (!g) return BEAM_LEN;
  const dx = Math.sin(p.face), dz = Math.cos(p.face);
  for (let k = 0.5; k <= BEAM_LEN; k += 0.25) { const t = tileOf(p.x + dx * k, p.z + dz * k); if (g.solid(t.c, t.r)) return k; }
  return BEAM_LEN;
}
// 등불·샹들리에 불빛: 학생과 가까운 4곳에만 옮겨 단다(불빛 수가 늘면 모든 표면 계산이 무거워진다)
const lampPool = (HIGH ? [0, 1, 2, 3] : [0, 1]).map(() => { const l = new THREE.PointLight(0xffa040, 0, 7, 1.6); scene.add(l); return l; });
let lampPick = [], lampT = 0;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false); composer?.setPixelRatio(pixelRatio); composer?.setSize(w, h);
  if (bloom) bloom.resolution.set(w / 3, h / 3);
  camera.aspect = w / h; camera.fov = w / h < 0.8 ? 58 : 42; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ---------- 상태 ---------- */
const S = {
  mode: 'none',          // 'solo' | 'host' | 'client'
  link: null, mySlot: 0, myName: store.get('pumpkin2-name') || '',
  roster: [],            // [{slot, name, char}]
  diffSetting: store.get('pumpkin3-diff') || 'auto', diff: 'easy', startStage: 0,
  grade: +(store.get('pumpkin3-grade') || 3), bank: loadBank(), run: null,   // run: 이번 판의 문제(층 3개 + 상자)
  inGame: false, paused: false,
  stageIdx: 0, puzzle: null, world: null, sim: null,
  snapT: 0, sendT: 0, pendingEv: [], phase: 'play', time: 0, shownPhase: 'play',
  pz: { have: [], asm: false, open: false, wrong: 0 },
  players: new Map(),    // slot → 표시용
  monsters: [], fragments: [], items: [], cageProg: [],
  me: { x: 0, z: 0, face: Math.PI, moving: false, flags: 0, item: -1, tpSeq: 0, hiddenIdx: -1, candy: 0 },
  heartT: 0, shake: 0, totals: { time: 0, caught: 0, stolen: 0, wrong: 0, items: 0, candy: 0, stars: 0 },
  chestQuiz: [], chestOpen: [], candies: [], candyN: 0,
  flights: [], lureFx: new Map(),   // 날아가는 사탕, 바닥에 떨어진 사탕
  searchFx: [], searchList: null, fragList: null, searching: null, leadSeen: 0, chestSeen: 0, seen: new Set(), lastStart: null, resume: null,   // 뒤질 가구, 쪽지 위치(감지기·힌트용)
};

/* ---------- 입력 ---------- */
const keys = new Set();
const stick = { x: 0, y: 0, id: null };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') { if (e.code === 'Escape' && !$('modal').hidden) closeModal(); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (!$('modal').hidden) { modalKey(e); return; }
  if (!S.inGame) return;
  keys.add(e.code);
  if (e.code === 'Tab' || e.code === 'KeyJ') toggleNote();
  else if (e.code === 'KeyE' || e.code === 'Space') act();
  else if (e.code === 'KeyQ') useItem();
  else if (e.code === 'KeyF') throwCandy(autoAimPoint());
  else if (e.code === 'Escape') { if (!$('quiz').hidden) closeQuiz(); else if (!$('note').hidden) toggleNote(false); else if (S.mode === 'solo') openPause(); }
  else if (!$('note').hidden || !$('quiz').hidden) noteKey(e);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (S.mode === 'solo' && S.inGame && S.phase === 'play') openPause(); });

// 떠다니는 조이스틱: 화면 왼쪽 아무 곳이나 누르면 그 자리에 생기고, 끌면 움직인다(태블릿용)
{
  const el = $('stick'), knob = $('knob'), canvas = $('c');
  const R = 64;
  const place = (x, y) => { el.style.left = (x - R) + 'px'; el.style.top = (y - R) + 'px'; el.style.bottom = 'auto'; };
  const end = (e) => { if (e && e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; el.classList.remove('on'); };
  const move = (e) => {
    if (e.pointerId !== stick.id) return;
    let dx = (e.clientX - stick.cx) / R, dy = (e.clientY - stick.cy) / R; const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    stick.x = dx; stick.y = dy; knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!S.inGame || e.pointerType === 'mouse' || stick.id !== null || e.clientX > innerWidth * 0.6) return;
    stick.id = e.pointerId; stick.cx = e.clientX; stick.cy = e.clientY; place(e.clientX, e.clientY);
    el.hidden = false; el.classList.add('on'); canvas.setPointerCapture(e.pointerId); move(e);
  });
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
}

/* ---------- 사탕 던지기 ----------
   미니 유물레이더스 공격 단추와 같은 방식: 오른쪽 아래 사탕 단추를 끌어 겨누고 떼면 던진다.
   짧게 누르고 떼면 가장 가까운 괴물 바로 뒤로 던진다. PC는 마우스로 겨누고 왼쪽 단추, F는 자동. */
const AIM_DEAD = 0.28;
const aim = { id: null, cx: 0, cy: 0, dx: 0, dy: 0, mag: 0 };
const mouse = { x: 0, y: 0, on: false };
const canThrow = () => S.inGame && S.phase === 'play' && !S.paused && !(S.me.flags & 7) && S.me.candy > 0 && $('note').hidden && $('quiz').hidden;
// 벽·가구를 넘어 날아가고, 떨어질 자리가 막혀 있으면 내 쪽으로 가장 가까운 바닥(방장 판정과 같은 계산)
function landingPoint(tx, tz) {
  const me = S.me, g = S.world.g; let dx = tx - me.x, dz = tz - me.z; const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d; const far = Math.min(d, THROW_RANGE); let ex = me.x, ez = me.z;
  for (let k = far; k > 0; k -= 0.25) { const x = me.x + dx * k, z = me.z + dz * k, t = tileOf(x, z); if (!g.solid(t.c, t.r)) { const q = k < far ? Math.min(0.3, k) : 0; ex = x - dx * q; ez = z - dz * q; break; } }
  return { x: ex, z: ez };
}
// 짧게 누름: 가까운 괴물(쫓아오는 괴물 먼저)을 고르고, 그 괴물이 냄새 맡는 범위 안에서 나와 가장 먼 곳에 던진다
// (벽에 막혀 발밑에 떨어지면 괴물을 내 쪽으로 부르게 되므로 여러 방향을 재 본다). 괴물이 없으면 보는 쪽 4칸
function autoAimPoint() {
  const me = S.me; let best = null, bd = THROW_RANGE + LURE_R;
  for (const m of S.monsters) {
    if (m.state === 9) continue;
    const d = Math.hypot(m.x - me.x, m.z - me.z) - (m.state === 2 || m.state === 1 || m.state === 6 ? 3 : 0);
    if (d < bd) { bd = d; best = m; }
  }
  if (!best) return { x: me.x + Math.sin(me.face) * 4, z: me.z + Math.cos(me.face) * 4 };
  let pick = null, ps = -1e9;
  for (let k = 0; k < 24; k++) for (const r of [3, 5, THROW_RANGE]) {
    const a = k / 24 * Math.PI * 2, L = landingPoint(me.x + Math.sin(a) * r, me.z + Math.cos(a) * r);
    const toMon = Math.hypot(L.x - best.x, L.z - best.z), toMe = Math.hypot(L.x - me.x, L.z - me.z);
    if (toMon > LURE_R - 0.8) continue;
    const sc = toMe - toMon * 0.4; if (sc > ps) { ps = sc; pick = L; }
  }
  if (pick) return pick;
  const dx = best.x - me.x, dz = best.z - me.z, l = Math.hypot(dx, dz) || 1;
  return { x: best.x + dx / l * 1.5, z: best.z + dz / l * 1.5 };
}
let noCandyTipT = 0;
function throwCandy(pt) {
  if (!canThrow()) {
    if (S.inGame && S.phase === 'play' && S.me.candy <= 0 && performance.now() > noCandyTipT) { noCandyTipT = performance.now() + 4000; toast(T('🍬 던질 사탕이 없어요. 바닥에 떠 있는 사탕을 주워요', '🍬 No candy to throw. Pick up the candy floating on the floor')); }
    return;
  }
  const dx = pt.x - S.me.x, dz = pt.z - S.me.z; if (Math.hypot(dx, dz) > 0.3) S.me.face = Math.atan2(dx, dz);
  sendInput({ t: 'throw', x: +pt.x.toFixed(2), z: +pt.z.toFixed(2) });
}
{
  const btn = $('throwBtn'), knob = $('throwKnob');
  const reset = () => { aim.id = null; aim.mag = 0; knob.style.transform = ''; btn.classList.remove('held'); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); if (aim.id !== null) return;
    const r = btn.getBoundingClientRect();
    Object.assign(aim, { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, dx: 0, dy: 0, mag: 0 });
    try { btn.setPointerCapture(e.pointerId); } catch { } btn.classList.add('held');
  });
  btn.addEventListener('pointermove', (e) => {
    if (e.pointerId !== aim.id) return;
    let dx = (e.clientX - aim.cx) / 64, dy = (e.clientY - aim.cy) / 64; const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    aim.dx = dx; aim.dy = dy; aim.mag = Math.min(1, l); knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
  });
  btn.addEventListener('pointerup', (e) => {
    if (e.pointerId !== aim.id) return;
    const { dx, dy, mag } = aim; reset();
    // 카메라가 남쪽에서 내려다보므로 화면 오른쪽 = +x, 화면 위 = −z
    if (mag <= AIM_DEAD) throwCandy(autoAimPoint());
    else { const l = Math.hypot(dx, dy) || 1; throwCandy({ x: S.me.x + dx / l * mag * THROW_RANGE, z: S.me.z + dy / l * mag * THROW_RANGE }); }
  });
  btn.addEventListener('pointercancel', (e) => { if (e.pointerId === aim.id) reset(); });
  // PC: 마우스가 가리키는 바닥에 던진다
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; } });
  $('c').addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0 && S.inGame) { const p = mouseGround(); if (p) throwCandy(p); } });
}
const _rc = new THREE.Raycaster(), _nd = new THREE.Vector2(), _ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _hit = new THREE.Vector3();
function mouseGround() {
  _nd.set(mouse.x / innerWidth * 2 - 1, -(mouse.y / innerHeight) * 2 + 1); _rc.setFromCamera(_nd, camera);
  return _rc.ray.intersectPlane(_ground, _hit) ? { x: _hit.x, z: _hit.z } : null;
}
// 겨누는 자리 미리 보기: 선 + 떨어질 자리 고리 + 괴물이 냄새 맡는 범위(옅은 원)
const aimFx = (() => {
  const mk = (geo, color, op) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, fog: false })); m.rotation.x = -Math.PI / 2; m.renderOrder = 5; return m; };
  const grp = new THREE.Group();
  const line = mk(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), 0xffd27a, 0.5);
  const ring = mk(new THREE.RingGeometry(0.34, 0.48, 28), 0xffb35a, 0.95);
  const area = mk(new THREE.CircleGeometry(LURE_R, 40), 0xff8ad8, 0.04);
  const edge = mk(new THREE.RingGeometry(LURE_R - 0.08, LURE_R, 56), 0xff8ad8, 0.35);
  grp.add(area, edge, line, ring); grp.visible = false; scene.add(grp);
  return { grp, line, ring, area, edge };
})();
function updateAimPreview() {
  const dragging = aim.id !== null && aim.mag > AIM_DEAD;
  const pc = !dragging && aim.id === null && mouse.on && !coarse;
  let pt = null;
  if (canThrow() && dragging) { const l = Math.hypot(aim.dx, aim.dy) || 1; pt = { x: S.me.x + aim.dx / l * aim.mag * THROW_RANGE, z: S.me.z + aim.dy / l * aim.mag * THROW_RANGE }; }
  else if (canThrow() && pc) pt = mouseGround();
  aimFx.grp.visible = !!pt; if (!pt) return;
  const L = landingPoint(pt.x, pt.z), dx = L.x - S.me.x, dz = L.z - S.me.z, d = Math.max(0.01, Math.hypot(dx, dz));
  // 선: 바닥에 눕힌 판(눕히면 판의 +y가 −z로 간다)을 내 자리에서 떨어질 자리 쪽으로 돌린다
  aimFx.line.position.set(S.me.x, 0.06, S.me.z); aimFx.line.rotation.z = Math.atan2(-dx, -dz); aimFx.line.scale.set(0.12, d, 1);
  aimFx.ring.position.set(L.x, 0.07, L.z); aimFx.area.position.set(L.x, 0.05, L.z); aimFx.edge.position.set(L.x, 0.055, L.z);
  const op = dragging ? 1 : 0.55;
  aimFx.line.material.opacity = 0.5 * op; aimFx.ring.material.opacity = 0.95 * op; aimFx.area.material.opacity = 0.04 * op; aimFx.edge.material.opacity = 0.35 * op;
}
// 날아가는 사탕과 바닥에 떨어진 사탕(괴물이 먹으러 온다)
const candyTex = new THREE.TextureLoader().load('assets/sprites/candy.png', t => { t.colorSpace = THREE.SRGBColorSpace; });
const candyFlyMat = new THREE.SpriteMaterial({ map: candyTex, depthWrite: false, toneMapped: false });
const lureGlowTex = glowTexture('255,140,220');
function startFlight(e) {
  const sp = new THREE.Sprite(candyFlyMat.clone()); sp.scale.set(0.6, 0.3, 1); S.world.group.add(sp);
  S.flights.push({ ...e, sp, t: 0 }); Sound.playAt('paper', e.x0, e.z0, S.me.x, S.me.z, 0.7, 14);
}
function syncLures(lu) {
  const alive = new Set(lu.map(a => a[0]));
  for (const [id, fx] of S.lureFx) if (!alive.has(id)) { S.world.group.remove(fx.grp); S.lureFx.delete(id); }
  for (const [id, x, z] of lu) {
    if (S.lureFx.has(id) || S.flights.some(f => f.id === id)) continue;
    const grp = new THREE.Group();
    const sp = new THREE.Sprite(candyFlyMat); sp.scale.set(0.6, 0.3, 1); sp.position.y = 0.22;
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: lureGlowTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); gl.scale.setScalar(1.1); gl.position.y = 0.2;
    // 퍼져 나가는 냄새 고리
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: 0xff8ad8, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    grp.add(gl, sp, ring); grp.position.set(x, 0, z); S.world.group.add(grp);
    S.lureFx.set(id, { grp, sp, ring });
  }
}
function animateThrows(dt, t) {
  for (const f of S.flights) {
    f.t += dt; const u = Math.min(1, f.t / f.dur);
    // 포물선: 손 높이(0.7)에서 던져 바닥 근처(0.25)로 떨어진다
    f.sp.position.set(f.x0 + (f.x1 - f.x0) * u, 0.7 - 0.45 * u + 3.6 * u * (1 - u), f.z0 + (f.z1 - f.z0) * u);
    f.sp.material.rotation = f.t * 14;
  }
  for (const f of S.flights) if (f.t >= f.dur) { S.world.group.remove(f.sp); f.sp.material.dispose(); }
  S.flights = S.flights.filter(f => f.t < f.dur);
  for (const fx of S.lureFx.values()) {
    const k = (t * 0.9) % 1; fx.ring.scale.setScalar(0.3 + k * 2.2); fx.ring.material.opacity = 0.55 * (1 - k);
    fx.sp.position.y = 0.22 + Math.abs(Math.sin(t * 5)) * 0.06;
  }
}

/* ---------- 으스스한 소리: 25~50초마다 마녀 웃음·늑대·부엉이 중 하나가 왼쪽이나 오른쪽 멀리서 ---------- */
function stepStingers(dt) {
  if (S.phase !== 'play' || S.paused || S.cine) return;
  S.stingT = (S.stingT ?? 20) - dt; if (S.stingT > 0) return;
  S.stingT = 25 + Math.random() * 25;
  const garden = STAGES[S.stageIdx]?.style === 'garden';
  const pool = garden ? ['wolf_howl', 'wolf_howl', 'owl_hoot', 'witch_laugh'] : ['witch_laugh', 'witch_laugh', 'wolf_howl', 'owl_hoot'];
  const n = pool[Math.floor(Math.random() * pool.length)];
  Sound.playPan(n, n === 'owl_hoot' ? 0.4 : 0.32, (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.4), 0.94 + Math.random() * 0.1);
}

/* ---------- 접속 ---------- */
function sendInput(m) {
  if (S.mode === 'client') S.link?.send(m);
  else S.sim?.input(S.mySlot, m);
}

async function startHost() {
  setTitleErr('');
  S.mode = 'host'; S.mySlot = 0; S.roster = [{ slot: 0, name: myName(), char: S.char ?? 0 }];
  // 지난번에 하던 곳이 있으면 시작 층을 거기로(시작 층을 바꾸면 그 층 처음부터)
  const sv = loadProgress(); S.resume = sv; S.startStage = sv ? sv.st : 0;
  showScreen('lobby'); renderLobby(); $('lobbyStatus').textContent = T('방을 여는 중…', 'Opening the room…');
  $('lobbyHint').textContent = sv ? T(`친구에게 이 코드를 알려 주세요. 최대 4명. 지난번에 이어서 ${saveLabel(sv)} 시작해요.`, `Tell your friends this code. Up to 4 players. Continuing from last time: ${saveLabel(sv)}.`) : HOST_HINT();
  try {
    S.link = await hostRoom({
      status: (s, d) => {
        if (s === 'ready') { $('lobbyCode').textContent = S.link.code; $('lobbyStatus').textContent = T('친구를 기다리는 중', 'Waiting for friends'); showCodeBadge(S.link.code); }
        else if (s === 'error') $('lobbyStatus').textContent = T(`연결 문제: ${d}. 인터넷을 확인하고 다시 만들어 주세요.`, `Connection problem: ${d}. Check the internet and create the room again.`);
      },
      // 친구에게는 아직 아무도 고르지 않은 분장을 준다
      join: (slot) => { const used = new Set(S.roster.map(r => r.char)); const char = [0, 1, 2, 3].find(c => !used.has(c)) ?? slot; S.roster.push({ slot, name: T(`친구${slot}`, `Friend ${slot}`), char, pending: true }); broadcastLobby(); },
      leave: (slot) => {
        const p = S.roster.find(r => r.slot === slot);
        S.roster = S.roster.filter(r => r.slot !== slot);
        if (S.inGame) { S.sim?.removePlayer(slot); removePlayerActor(slot); toast(T(`${josa(p?.name || '친구', '이가')} 나갔어요`, `${p?.name || 'A friend'} left`)); }
        broadcastLobby();
      },
      data: (m, slot) => {
        if (m.t === 'hello') {
          const r = S.roster.find(q => q.slot === slot); if (r) { r.name = String(m.name || '').slice(0, 10) || T(`친구${slot}`, `Friend ${slot}`); r.pending = false; }
          broadcastLobby();
          if (S.inGame && S.sim && S.lastStart && S.sim.phase === 'play' && r) {
            // 층이 진행 중이면 지금 쪽지부터 바로 함께한다(시작 자리에서)
            S.sim.addPlayer(r);
            const roster = [...S.sim.players.values()].map(({ slot, name, char }) => ({ slot, name, char }));
            S.link.send(slot, { ...S.lastStart, round: S.sim.round, roster, late: true });
          } else if (S.inGame) S.link.send(slot, { t: 'wait', msg: T('층이 끝나는 중이에요. 다음 층부터 함께해요!', 'This floor is ending. You will join from the next floor!') });
        } else if (m.t === 'seen') { S.seen.add(slot); updateSeen(); }
        else if (m.t === 'pos') S.sim?.setPlayer(slot, +m.x, +m.z, +m.f, !!m.mv);
        else S.sim?.input(slot, m);
      },
    });
  } catch (e) { $('lobbyStatus').textContent = e.message; }
}
// 방장이 도입 만화를 보는 동안에도 방 코드를 화면 위에 띄워 둔다(친구들이 먼저 들어올 수 있게)
function showCodeBadge(code) {
  let b = $('codeBadge');
  if (!b) { b = document.createElement('div'); b.id = 'codeBadge'; $('app').appendChild(b); }
  b.innerHTML = T(`방 코드 <b>${esc(code)}</b><small>친구들에게 알려 주세요</small>`, `Room code <b>${esc(code)}</b><small>Tell your friends</small>`);
  b.hidden = !comicOpen();
}
function broadcastLobby() {
  renderLobby();
  // 친구마다 자기 자리 번호(you)를 알려 준다
  if (S.link) for (const slot of S.link.conns.keys()) S.link.send(slot, { t: 'lobby', roster: S.roster, stage: S.startStage, you: slot });
}

async function startJoin() {
  const code = $('codeIn').value.trim().toUpperCase();
  if (code.length !== 5) { setTitleErr(T('방 코드 5글자를 넣어 주세요.', 'Enter the 5-letter room code.')); return; }
  setTitleErr('');
  S.mode = 'client'; S.roster = []; S.mySlot = -1;
  showScreen('lobby'); $('lobbyCode').textContent = code; $('lobbyRole').textContent = T('들어간 방', 'Joined room');
  $('lobbyHint').textContent = T('방장이 시작하면 함께 들어가요.', 'You will start together when the host starts.'); $('hostCtl').hidden = true; $('lobbyStatus').textContent = T('연결하는 중…', 'Connecting…'); $('members').innerHTML = '';
  try {
    S.link = await joinRoom(code, {
      status: (s, d) => {
        if (s === 'connected') { $('lobbyStatus').textContent = T('연결됐어요. 방장을 기다리는 중', 'Connected. Waiting for the host'); S.link.send({ t: 'hello', name: myName() }); }
        else if (s === 'closed') { leaveToTitle(T('방장과 연결이 끊겼어요.', 'Lost the connection to the host.')); }
        else if (s === 'error') { leaveToTitle(d === 'timeout' || d === 'peer-unavailable' ? T('그 코드의 방을 찾지 못했어요. 코드를 다시 확인해 주세요.', 'No room found with that code. Please check the code.') : T(`연결 문제: ${d}`, `Connection problem: ${d}`)); }
      },
      data: (m) => {
        if (m.t === 'lobby') { S.roster = m.roster; if (m.you) S.mySlot = m.you; renderLobby(); }
        else if (m.t === 'start') beginStage(m);
        else if (m.t === 's') applySnap(m);
        else if (m.t === 'full') leaveToTitle(T('방이 꽉 찼어요(최대 4명).', 'The room is full (max 4 players).'));
        else if (m.t === 'wait') $('lobbyStatus').textContent = m.msg;
        else if (m.t === 'title') leaveToTitle(T('방장이 게임을 끝냈어요.', 'The host ended the game.'));
      },
    });
  } catch (e) { leaveToTitle(e.message); }
}

// 이어 하기: 혼자 하기·방장 기기에 학년별로 어디까지 했는지 저장한다(사흘 동안)
const SAVE_KEY = 'pumpkin3-save', SAVE_DAYS = 3;
function saveProgress(st, rd) {
  if (!S.totals) return;
  store.set(SAVE_KEY, JSON.stringify({ grade: S.grade, st, rd: rd | 0, totals: S.totals, at: Date.now() }));
}
function clearProgress() { store.set(SAVE_KEY, ''); }
function loadProgress() {
  try {
    const s = JSON.parse(store.get(SAVE_KEY) || 'null');
    if (!s || s.grade !== S.grade || Date.now() - s.at > SAVE_DAYS * 864e5 || !(s.st >= 0 && s.st < STAGES.length)) return null;
    s.rd = Math.min(s.rd | 0, (STAGES[s.st].notes || 1) - 1);   // 쪽지 수가 줄었으면(예전 저장) 그 층 처음부터
    if (s.st === 0 && !s.rd) return null;   // 1층 처음이면 이어 할 것이 없다
    return s;
  } catch (e) { return null; }
}
const saveLabel = (s) => T(`${s.st + 1}층 ${STAGES[s.st].name}${s.rd ? ` · 쪽지 ${s.rd + 1}장째` : ''}부터`, `from floor ${s.st + 1}, ${STAGES[s.st].name}${s.rd ? ` · note ${s.rd + 1}` : ''}`);
const HOST_HINT = () => T('친구에게 이 코드를 알려 주세요. 최대 4명.', 'Tell your friends this code. Up to 4 players.');
function newRun() {
  // 이번 판의 문제: 학년 교과 + 할로윈 상식을 섞어 층마다 쪽지 수만큼, 상자·가구 문제는 층마다 묶음으로.
  // 기본 문제 은행이면 학년 산수 문제(그때그때 만듦)를 섞어 한 시간 동안 덜 겹치게 한다
  S.run = pickQuestions(S.bank, S.grade, { notes: STAGES.map(s => s.notes || 1), chest: CHEST_N });
  S.diff = diffForGrade(S.grade, S.diffSetting);
  S.totals = { time: 0, caught: 0, stolen: 0, wrong: 0, items: 0, candy: 0, stars: 0 };
}
function startSolo(resume = null) {
  S.mode = 'solo'; S.mySlot = 0; S.roster = [{ slot: 0, name: myName(), char: S.char ?? 0 }];
  newRun();
  if (resume) { S.totals = { ...S.totals, ...resume.totals }; launchStage(resume.st, resume.rd); }
  else launchStage(0);
}

// 방장(또는 혼자): 판을 만들고 모두에게 알린다
// round: 몇 번째 쪽지부터(다시 도전하면 실패한 쪽지부터 이어서)
function launchStage(idx, round = 0) {
  if (!S.run) newRun();
  const set = S.run.sets[idx];
  const msg = { t: 'start', st: idx, puzzles: S.run.floors[idx], round, chestQuiz: set.slice(0, CHEST_N), searchQuiz: set.slice(CHEST_N), grade: S.grade,
    roster: S.roster.filter(r => !r.pending).map(({ slot, name, char }) => ({ slot, name, char })), diff: S.diff, seed: (Math.random() * 1e9) | 0 };
  S.lastStart = msg; S.seen = new Set();
  S.link?.broadcast(msg);
  beginStage(msg);
  S.sim = new Sim({ stageIdx: idx, puzzles: msg.puzzles, round, chestQuiz: msg.chestQuiz, roster: msg.roster, diff: msg.diff, seed: msg.seed });
  S.snapT = 0;
}

function leaveToTitle(err = '') {
  if (S.mode === 'host') S.link?.broadcast({ t: 'title' });
  S.link?.close(); S.link = null; S.mode = 'none'; S.sim = null; S.inGame = false; S.run = null; S.lastStart = null; S.resume = null; closeQuiz(); closeComic();
  closeModal(); toggleNote(false);
  ['hud', 'bottom', 'compass', 'banner', 'hideview', 'stick', 'throwBtn'].forEach(id => $(id).hidden = true);
  $('lobbyRole').textContent = T('방 코드', 'Room code'); $('lobbyHint').textContent = HOST_HINT(); $('hostCtl').hidden = false;
  showScreen('title'); setTitleErr(err); Sound.music(true);
  buildStageScene(0, null); S.monsters.forEach(m => m.grp.visible = true);
}

/* ---------- 판 시작 ---------- */
function beginStage(msg) {
  closeComic(); if ($('codeBadge')) $('codeBadge').hidden = true;
  S.stageIdx = msg.st; S.puzzles = msg.puzzles || [msg.puzzle]; S.round = msg.round | 0; S.puzzle = S.puzzles[S.round]; S.roster = msg.roster; S.diff = msg.diff; S.playGrade = msg.grade ?? S.grade;
  S.chestQuiz = msg.chestQuiz || []; S.searchQuiz = msg.searchQuiz || []; S.searchQi = 0; S.chestOpen = []; S.candyN = 0; S.me.candy = 0; S.flights = []; S.lureFx = new Map(); closeQuiz();
  S.phase = 'play'; S.shownPhase = 'play'; S.paused = false;
  S.pz = { have: [], asm: false, open: false, wrong: 0 };
  S.note = { tray: shuffle([0, 1, 2, 3]), slots: [null, null, null, null], picked: null };
  S.cine = null; S.itemList = null; S.searchFx = []; S.searchList = null; S.fragList = null; $('app').classList.remove('cine'); $('cineText').hidden = true; S.stingT = 18 + Math.random() * 12;
  clearDialog();
  buildStageScene(msg.st, msg.roster);
  const me = msg.roster.find(r => r.slot === S.mySlot);
  if (!me && S.mode === 'client') { $('lobbyStatus').textContent = T('게임이 진행 중이에요. 다음 층부터 함께해요!', 'A game is in progress. You will join from the next floor!'); return; }
  S.inGame = true;
  showScreen(null); closeModal();
  if (S.mode !== 'client') saveProgress(msg.st, S.round);
  ['hud', 'bottom'].forEach(id => $(id).hidden = false);
  $('stick').hidden = true;
  const st = STAGES[msg.st];
  $('stageName').textContent = st.name; updateStageSub();
  renderNote(); updateItemBtn();
  toast(T(msg.late ? `${st.name} — 친구들과 함께 쪽지를 찾아요!` : S.round ? `${st.name} — ${S.round + 1}번째 쪽지부터 다시 찾아요!` : S.puzzles.length > 1 ? `${st.name} — 쪽지 ${S.puzzles.length}장을 차례로 찾아요. 한 장은 4조각이에요!` : `${st.name} — 쪽지 4조각을 모아 문제를 풀면 탈출문이 열려요!`,
    msg.late ? `${st.name} — Find the notes with your friends!` : S.round ? `${st.name} — Starting again from note ${S.round + 1}!` : S.puzzles.length > 1 ? `${st.name} — Find ${S.puzzles.length} notes one by one. Each note has 4 pieces!` : `${st.name} — Collect 4 note pieces and solve the question to open the exit!`), 4200);
  // 루미가 찾는 법과 첫 방 힌트를 알려 준다
  setTimeout(() => {
    if (S.stageIdx !== msg.st || !S.inGame) return;
    say([...(S.round || msg.late ? [] : (STAGE_INTRO[msg.st] || []).map(lumiLine)), lumiLine(roomHint())]);
  }, 2200);
  Sound.init();
}

function buildStageScene(idx, roster) {
  if (S.world) { scene.remove(S.world.group); disposeGroup(S.world.group); }
  for (const p of S.players.values()) { scene.remove(p.grp); if (p.beam) scene.remove(p.beam); }
  S.players.clear();
  const st = STAGES[idx];
  S.world = buildWorld(st, {});
  lampPick = []; lampT = 0;
  scene.add(S.world.group);
  scene.fog = new THREE.FogExp2(st.fog, HIGH ? 0.062 : 0.07);
  scene.background = new THREE.Color(st.fog).multiplyScalar(0.4);
  hemi.intensity = st.style === 'garden' ? 0.32 : 0.24;
  hemi.color.set(st.style === 'garden' ? 0x7a90c0 : 0x8a7ab0);
  // 괴물 모습
  S.monsters = (roster ? monsterSpots(S.world.g.spots, S.diff) : S.world.g.spots.mon).map(s => makeMonsterActor(MONSTERS[s.ch], s));
  // 학생 모습
  if (roster) roster.forEach(r => addPlayerActor(r));
  const spawn = S.world.g.spots.P[0];
  S.me.x = spawn.c; S.me.z = spawn.r; S.me.tpSeq = 0; S.me.flags = 0; S.me.item = -1;
  camTarget.set(spawn.c, 0, spawn.r);
  // 셰이더를 미리 만들어 둔다(처음 보이는 순간 멈칫하는 것 방지)
  updateLights(0); renderer.compile(scene, camera);
}

// 여러 층에서 같이 쓰는 텍스처(층을 바꿀 때 버리지 않는다)
const SHARED_TEX = new Set();
function disposeGroup(grp) {
  grp.traverse(o => {
    // 모델 원본과 공유하는 형상·재질은 남겨 둔다
    if (o.userData.shared || !(o.isMesh || o.isSprite)) return;
    if (!o.isSprite) o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) { if (m.map && !SHARED_TEX.has(m.map)) m.map.dispose(); m.dispose(); }
  });
}

function addPlayerActor(r) {
  const ch = CHARACTERS[r.char % CHARACTERS.length];
  const grp = new THREE.Group();
  // 뼈대·동작이 있는 분장 아이 모델(없으면 예전 정지 모델)
  const kid = hasKid(ch.kid) ? makeKid(ch.kid) : null;
  const model = kid ? kid.holder : spawnModel(ch.model, 1.3); grp.add(model);
  const label = labelSprite(r.slot === S.mySlot ? T(`${r.name} (나)`, `${r.name} (me)`) : r.name, ch.color, 0.34); label.position.y = 1.75; grp.add(label);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(ch.color), transparent: true, opacity: 0.6, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; grp.add(ring);
  // 손에 든 등불 빛(가볍게에서는 친구 손전등이 실제 불빛이 아니어서 이것으로 보인다)
  const hand = new THREE.Sprite(new THREE.SpriteMaterial({ map: handGlow, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  hand.scale.setScalar(0.9); hand.position.set(0.28, 0.65, 0.2); grp.add(hand);
  scene.add(grp);
  const spawn = S.world.g.spots.P[0];
  S.players.set(r.slot, { slot: r.slot, name: r.name, char: r.char, grp, model, kid, hitT: 0, x: spawn.c, z: spawn.r, tx: spawn.c, tz: spawn.r, face: Math.PI, tface: Math.PI, flags: 0, bob: 0, item: -1 });
}
function removePlayerActor(slot) { const p = S.players.get(slot); if (p) { scene.remove(p.grp); if (p.beam) scene.remove(p.beam); S.players.delete(slot); } }

const eyeTex = glowTexture('255,40,30'), eyeTexG = glowTexture('120,255,170'), handGlow = glowTexture('255,210,140');
// 괴물이 어둠 속에서도 생김새가 보이게: 모델 색을 스스로 조금 빛나게 한다(원본 재질마다 한 번만 복제해 같이 쓴다)
const litMats = new Map();
function litMaterial(m) {
  if (!m || !('emissive' in m)) return m;
  let c = litMats.get(m);
  if (!c) {
    c = m.clone();
    if (m.map) { c.emissive = new THREE.Color(0xffffff); c.emissiveMap = m.map; } else c.emissive = m.color.clone();
    c.emissiveIntensity = 0.42;
    litMats.set(m, c);
  }
  return c;
}
const haloTex = glowTexture('190,150,255');
SHARED_TEX.add(haloTex);
function makeMonsterActor(spec, s) {
  const grp = new THREE.Group();
  const model = spawnModel(spec.model, spec.h); grp.add(model);
  model.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(litMaterial) : litMaterial(o.material); });
  // 등 뒤 은은한 빛무리: 어두운 바닥·벽 앞에서 윤곽이 드러난다(쫓을 때는 붉게)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.32 }));
  halo.scale.set(spec.h * 1.25, spec.h * 1.25, 1); halo.position.y = spec.h * 0.55; halo.renderOrder = -1; grp.add(halo);
  const size = modelSize(spec.model); const k = size ? spec.h / size.y : 1; const depth = size ? size.z * k : 0.5;
  const eyes = [-1, 1].map(sx => {
    const e = new THREE.Sprite(new THREE.SpriteMaterial({ map: spec.kind === 'bat' ? eyeTexG : eyeTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffffff }));
    e.scale.setScalar(spec.kind === 'spider' ? 0.16 : 0.2); e.position.set(sx * (spec.kind === 'spider' ? 0.14 : 0.09), spec.h * (spec.kind === 'spider' ? 0.55 : 0.86), Math.min(depth * 0.45, 0.35));
    grp.add(e); return e;
  });
  const bang = labelSprite('!', '#ff5a4a', 0.55); bang.position.y = spec.h + 0.5; bang.visible = false; grp.add(bang);
  const huh = labelSprite('?', '#b9a8ff', 0.5); huh.position.y = spec.h + 0.5; huh.visible = false; grp.add(huh);
  // 사탕으로 가는 중 '사탕!', 먹는 중 '냠냠'
  const want = labelSprite(T('사탕!', 'Candy!'), '#ff9ee0', 0.5); want.position.y = spec.h + 0.5; want.visible = false; grp.add(want);
  const yum = labelSprite(T('냠냠', 'Yum'), '#ffd27a', 0.55); yum.position.y = spec.h + 0.5; yum.visible = false; grp.add(yum);
  grp.position.set(s.c, spec.float || 0, s.r);
  S.world.group.add(grp);
  return { spec, grp, model, eyes, halo, bang, huh, want, yum, x: s.c, z: s.r, tx: s.c, tz: s.r, face: 0, tface: 0, state: 0, anim: Math.random() * 10 };
}

function updateStageSub() {
  const st = STAGES[S.stageIdx], n = S.puzzles?.length || 1;
  $('stageSub').textContent = T(`${S.stageIdx + 1} / ${STAGES.length}층${n > 1 ? ` · 쪽지 ${S.round + 1} / ${n}장` : ''} · ${st.sub}`, `Floor ${S.stageIdx + 1} / ${STAGES.length}${n > 1 ? ` · Note ${S.round + 1} / ${n}` : ''} · ${st.sub}`);
}
// 다음 쪽지로: 조각·쪽지 창·뒤질 가구 표시를 새로 시작한다
function startNote(rd) {
  S.round = rd; S.puzzle = S.puzzles[rd];
  S.pz = { have: [], asm: false, open: false, wrong: 0 };
  S.note = { tray: shuffle([0, 1, 2, 3]), slots: [null, null, null, null], picked: null };
  closeQuiz(); toggleNote(false);
  for (const fx of S.searchFx) { S.world.group.remove(fx.grp); fx.grp.traverse(o => { if (o.isSprite) { if (o.material.map !== searchGlowTex) o.material.map?.dispose(); o.material.dispose(); } }); }
  S.searchFx = []; S.searchList = null; S.fragList = null;
  updateStageSub(); renderNote();
}

/* ---------- 스냅숏 적용 ---------- */
function applySnap(s) {
  if (!S.inGame || s.st !== S.stageIdx) return;
  if (s.rd != null && s.rd !== S.round && S.puzzles?.[s.rd]) startNote(s.rd);
  S.time = s.tm; S.phase = s.ph;
  const seen = new Set();
  for (const a of s.p) {
    const [slot, x, z, face, flags, item, name, char, tpSeq, tpX, tpZ, hid, candy] = a;
    seen.add(slot);
    if (!S.players.has(slot)) addPlayerActor({ slot, name, char });
    const p = S.players.get(slot); p.flags = flags; p.item = item; p.hid = hid;
    if (slot === S.mySlot) {
      S.me.flags = flags; S.me.item = item; S.me.hiddenIdx = hid; S.me.candy = candy || 0;
      if (tpSeq > S.me.tpSeq) { S.me.tpSeq = tpSeq; S.me.x = tpX; S.me.z = tpZ; p.x = tpX; p.z = tpZ; }
    } else {
      if (Math.hypot(x - p.tx, z - p.tz) > 3) { p.x = x; p.z = z; }
      p.tx = x; p.tz = z; p.tface = face;
    }
  }
  for (const slot of [...S.players.keys()]) if (!seen.has(slot)) removePlayerActor(slot);
  s.m.forEach((a, i) => { const m = S.monsters[i]; if (!m) return; m.tx = a[0]; m.tz = a[1]; m.tface = a[2]; m.state = a[3]; });
  s.f.forEach((a, i) => {
    const f = S.world.frags[i]; if (!f) return;
    f.grp.visible = false; f.grp.position.set(a[0], 0, a[1]);
  });
  S.fragList = s.f;
  if (s.sr) syncSearch(s.sr);
  S.itemList = s.it;
  s.it.forEach((a, i) => {
    let it = S.world.itemMeshes.get(i);
    if (it && it.type !== a[0]) { S.world.group.remove(it.grp); it = null; }
    if (!it) { it = S.world.itemMesh(ITEM_CODES[a[0]]); it.type = a[0]; S.world.itemMeshes.set(i, it); }
    it.grp.position.set(a[1], 0, a[2]); it.grp.visible = !a[3];
  });
  const [have, asm, open, wrong] = s.pz;
  const changed = have.length !== S.pz.have.length || !!asm !== S.pz.asm || !!open !== S.pz.open || wrong !== S.pz.wrong;
  S.pz = { have, asm: !!asm, open: !!open, wrong };
  if (changed) { renderNote(); }
  S.cageProg = s.cg;
  // 사탕과 호박 상자
  if (s.cd) { s.cd.forEach((a, i) => S.world.setCandy(i, a[0], a[1], !a[2])); S.candyN = s.cc; }
  if (s.ch) { S.chestOpen = s.ch; s.ch.forEach((o, i) => S.world.setChest(i, !!o)); }
  for (const e of s.ev) handleEvent(e);
  if (s.lu) syncLures(s.lu);
  if (s.ph !== S.shownPhase) { S.shownPhase = s.ph; if (s.ph === 'clear') showClear(s.res); else if (s.ph === 'over') showOver(s.why); }
  updateHUD();
}

function handleEvent(e) {
  const me = S.me;
  if (e.k === 'toast') { if (e.slot < 0 || e.slot === S.mySlot) toast(e.msg); }
  else if (e.k === 'snd') {
    if (e.slot >= 0 && e.slot !== S.mySlot) return;
    if (['bell', 'gate'].includes(e.n)) Sound.play(e.n, 1);
    else Sound.playAt(e.n, e.x, e.z, me.x, me.z, e.n === 'growl' ? 0.8 : 1, e.n === 'screech' ? 20 : 14);
  }
  else if (e.k === 'caught') { if (e.slot === S.mySlot) { flashScreen('#a01020', 0.6); S.shake = 0.5; } }
  else if (e.k === 'open') { Sound.fanfare(); showCorrectThenOpen(e.name); }
  else if (e.k === 'note') {
    Sound.fanfare(); flashScreen('#fff2c0', 0.3);
    if (S.mode !== 'client') saveProgress(S.stageIdx, e.rd);
    const left = S.puzzles.length - e.rd;
    say([lumiLine(left > 1 ? T(`정답! 그런데 문은 아직 안 열려. 쪽지가 ${left}장 더 있대!`, `Correct! But the door is still closed. There are ${left} more notes!`) : T('정답! 이제 마지막 쪽지야. 이것만 풀면 탈출문이 열려!', "Correct! This is the last note. Solve it and the exit opens!")), lumiLine(roomHint())]);
  }
  else if (e.k === 'arrangeWrong' && e.slot === S.mySlot) { Sound.bad(); renderNote(); $('noteSlots')?.classList.add('shake'); toast(lowGrade() ? T('순서가 맞지 않아요. 번호 순서대로 놓아요', 'Wrong order. Place them in number order') : T('순서가 맞지 않아요. 이웃한 가장자리 색이 같게 조각을 끌어서 바꿔 봐요', 'Wrong order. Drag the pieces so touching edges have the same color')); }
  else if (e.k === 'frag') {
    const p = S.players.get(e.slot), ch = CHARACTERS[(p?.char ?? 0) % CHARACTERS.length];
    if (S.puzzle) say(fragLines(S.stageIdx, e.n, S.puzzle.parts[e.id], { face: ch.face, name: p?.name || ch.costume, color: ch.color }, e.n < 4 ? roomHint() : null, S.round, S.round === S.puzzles.length - 1));
    if (e.slot === S.mySlot) flashScreen('#fff2c0', 0.25);
  }
  else if (e.k === 'answerWrong') {
    // 틀리면 붙인 쪽지가 다시 흩어진다: 쪽지 창을 닫고 순서 맞추기도 처음부터(고른 오답은 기억해서 다시 못 고르게)
    if (e.slot === S.mySlot) Sound.bad();
    (S.note.wrongPicks ??= new Set()).add(e.v);
    Object.assign(S.note, { tray: shuffle([0, 1, 2, 3]), slots: [null, null, null, null], picked: null });
    toggleNote(false); renderNote(); flashScreen('#c9a8ff', 0.35);
    say([lumiLine(T('앗, 쪽지가 다시 흩어졌어! 감지기를 보고 ? 가구를 다시 뒤져 봐. 다시 붙이면 힌트도 보여 줄게.', "Oh no, the note scattered again! Use the detector and search the ? spots again. I'll show you a hint when you put it back together."))]);
  }
  else if (e.k === 'fragMoved' && e.slot === S.mySlot) { Sound.bad(); flashScreen('#fff2c0', 0.2); }
  else if (e.k === 'throw') startFlight(e);
  else if (e.k === 'eat') Sound.playAt('pickup', e.x, e.z, me.x, me.z, 0.6, 12);
  else if (e.k === 'flash') { if (Math.hypot(e.x - me.x, e.z - me.z) < 10) flashScreen('#c9a8ff', 0.45); }
}

// 정답: 쪽지에 '정답!' 도장을 1.4초 보여 준 뒤 닫고, 카메라가 탈출문으로 가서 문이 열리는 장면(약 3.4초)
function showCorrectThenOpen(name) {
  const stage = S.stageIdx;
  toggleNote(true); renderNote();
  setTimeout(() => {
    if (S.stageIdx !== stage || !S.inGame) return;
    toggleNote(false);
    S.cine = { t: 0, dur: 3.4, opened: false, name };
    $('app').classList.add('cine');
    const tx = $('cineText'); tx.textContent = T('탈출문이 열린다!', 'The exit is opening!'); tx.hidden = false;
  }, 1400);
}
function openExitVisual() {
  const ex = S.world.exit; if (ex.open) return; ex.open = true;
  ex.lock.visible = false;
  ex.light.color.set(0xfff0c0); ex.light.intensity = 0; ex.light.distance = 10;
  // 문을 왼쪽 가장자리를 축으로 돌려 연다(학생 쪽으로)
  const door = ex.door, box = new THREE.Box3().setFromObject(door);
  const pivot = new THREE.Group(); pivot.position.set(box.min.x, 0, door.position.z);
  const grp = door.parent; grp.add(pivot); door.position.x -= box.min.x; door.position.z = 0; pivot.add(door); ex.pivot = pivot; ex.swing = 0;
  // 문틈으로 쏟아지는 빛
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,240,190'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
  glow.scale.set(3.2, 3.6, 1); glow.position.set((box.min.x + box.max.x) / 2, 1.1, box.max.z + 0.3); grp.add(glow); ex.glow = glow;
  Sound.play('creak', 1); setTimeout(() => Sound.play('gate', 0.9), 600);
}
// 문 열리는 장면 진행: 0.4초에 문이 열리기 시작, 끝나면 카메라가 학생에게 돌아온다
function stepCine(dt) {
  const c = S.cine; if (!c) return;
  c.t += dt;
  if (!c.opened && c.t > 0.5) { c.opened = true; openExitVisual(); S.shake = 0.25; }
  if (c.t >= c.dur) { S.cine = null; $('app').classList.remove('cine'); $('cineText').hidden = true; toast(T('🚪 탈출문이 열렸어요! 초록 화살표를 따라 문으로 달려요', '🚪 The exit is open! Follow the green arrow to the door')); }
}

/* ---------- 내 조작 ---------- */
const camTarget = new THREE.Vector3();
function readMove() {
  let x = 0, z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  x += stick.x; z += stick.y;
  const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
  return { x, z, l: Math.min(1, l) };
}
function updateMe(dt) {
  const me = S.me, g = S.world.g;
  const locked = (me.flags & 7) || S.phase !== 'play' || S.paused || !!S.cine;
  me.moving = false;
  if (!locked) {
    const v = readMove();
    if (v.l > 0.12) {
      const spd = PLAYER_SPEED * (me.flags & 32 ? 1.5 : 1) * v.l; me.speedK = v.l;
      slideMove(g, me, v.x * spd * dt, v.z * spd * dt, 0.24);
      const want = Math.atan2(v.x, v.z); me.face += angDiff(me.face, want) * Math.min(1, dt * 12);
      me.moving = true;
    }
  }
  const p = S.players.get(S.mySlot);
  if (p) { p.x = me.x; p.z = me.z; p.face = me.face; p.moving = me.moving; }
  if (S.mode === 'client') {
    S.sendT -= dt;
    if (S.sendT <= 0) { S.sendT = 1 / 15; S.link?.send({ t: 'pos', x: +me.x.toFixed(2), z: +me.z.toFixed(2), f: +me.face.toFixed(2), mv: me.moving ? 1 : 0 }); }
  } else S.sim?.setPlayer(S.mySlot, me.x, me.z, me.face, me.moving);
}
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

function nearWardrobe() {
  if (!S.world) return -1;
  let best = -1, bd = 1.45;
  S.world.wardrobes.forEach((w, i) => { const d = Math.hypot(w.c - S.me.x, w.r - S.me.z); if (d < bd) { bd = d; best = i; } });
  return best;
}
function nearChest() {
  if (!S.world || S.me.flags & 7) return -1;
  let best = -1, bd = 1.6;
  S.world.chests.forEach((c, i) => { if (S.chestOpen[i]) return; const d = Math.hypot(c.c - S.me.x, c.r - S.me.z); if (d < bd) { bd = d; best = i; } });
  return best;
}
// 가까운 아이템(모래시계·수정구·물약). 사탕은 지나가면 저절로 줍는다
const ITEM_INFO = T([['⏳', '모래시계', '모래시계로'], ['🔮', '수정구', '수정구로'], ['🧪', '날쌘 물약', '날쌘 물약으로']],
  [['⏳', 'hourglass', 'hourglass'], ['🔮', 'crystal ball', 'crystal ball'], ['🧪', 'speed potion', 'speed potion']]);
function nearItem() {
  if (!S.itemList || S.me.flags & 7) return -1;
  let best = -1, bd = 1.3;
  S.itemList.forEach((a, i) => { if (a[3]) return; const d = Math.hypot(a[1] - S.me.x, a[2] - S.me.z); if (d < bd) { bd = d; best = i; } });
  return best;
}
function act() {
  if (S.phase !== 'play' || S.cine) return;
  if (S.me.flags & 1) { sendInput({ t: 'hide' }); return; }
  if (S.me.flags & 6) return;
  const ch = nearChest();
  if (ch >= 0) { openQuiz(ch); return; }
  const it = nearItem();
  if (it >= 0) { sendInput({ t: 'take', id: it }); return; }
  const sp = nearSearch();
  if (sp >= 0) { if (!S.searchList[sp][4]) openSearchQuiz(sp); return; }
  if (nearWardrobe() >= 0) sendInput({ t: 'hide' });
}
/* ---------- 쪽지 찾기: 반짝이는 가구 옆에서 상호작용 → 문제를 맞히면 뒤진다(틀리면 잠깐 잠김) ---------- */
function nearSearch() {
  if (!S.searchList || S.me.flags & 7 || S.pz.have.length >= 4) return -1;
  let best = -1, bd = 1.6;
  S.searchList.forEach((a, i) => { if (a[2]) return; const d = Math.hypot(a[0] - S.me.x, a[1] - S.me.z); if (d < bd) { bd = d; best = i; } });
  return best;
}
// 문제 창이 열린 채 멀리 가거나, 다른 친구가 먼저 열면 창을 닫는다
function stepQuizRange() {
  const t = quizAt; if (!t || $('quiz').hidden) return;
  const gone = t.kind === 'search' ? S.searchList?.[t.id]?.[2] : S.chestOpen[t.id];
  if (gone && !t.answered) { closeQuiz(); toast(T('다른 친구가 먼저 열었어요', 'A friend opened it first')); return; }
  if (!t.answered && Math.hypot(S.me.x - t.x, S.me.z - t.z) > 2.2) { closeQuiz(); toast(T('너무 멀어져서 문제를 닫았어요. 다시 가까이 가서 눌러요', 'You moved too far away, so the question closed. Go back and press again')); }
}
// 뒤질 곳 표시: 가구 위에 반짝임과 물음표(잠기면 자물쇠). 뒤진 곳은 사라진다
const searchGlowTex = glowTexture('255,226,150');
SHARED_TEX.add(searchGlowTex);
function syncSearch(sr) {
  S.searchList = sr;
  const left = (S.fragList || []).some(f => !f[2]);   // 쪽지를 다 찾으면 표시를 모두 감춘다
  sr.forEach((a, i) => {
    let fx = S.searchFx[i];
    if (!fx) {
      const grp = new THREE.Group();
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: searchGlowTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); gl.scale.setScalar(0.7);
      const q = labelSprite('?', '#ffe08a', 0.56); q.position.y = 0.05;
      const lock = labelSprite('🔒', '#c9d3e6', 0.5); lock.position.y = 0.05; lock.visible = false;
      grp.add(gl, q, lock); S.world.group.add(grp); fx = S.searchFx[i] = { grp, gl, q, lock, seed: Math.random() * 6 };
    }
    fx.grp.position.set(a[0], 1.35, a[1]); fx.grp.visible = !a[2] && left;
    fx.q.visible = !a[4]; fx.lock.visible = !!a[4]; fx.gl.material.opacity = a[4] ? 0.35 : 1;
  });
}
// 루미의 방 힌트: 나와 가장 가까운 (아직 못 찾은) 쪽지가 있는 방
function roomHint() {
  const left = (S.fragList || []).filter(f => !f[2]);
  if (!left.length) return T('쪽지를 다 찾았어! 쪽지 단추를 눌러 이어 붙여 봐.', 'You found every piece! Press the note button to put them together.');
  const f = left.sort((a, b) => Math.hypot(a[0] - S.me.x, a[1] - S.me.z) - Math.hypot(b[0] - S.me.x, b[1] - S.me.z))[0];
  const room = roomName(S.stageIdx, f[0], f[1]);
  const lines = T([`${room} 쪽에서 종이 냄새가 나!`, `쪽지 하나는 ${room} 어딘가에 있을 거야.`, `${room}에 가 봐. 가구를 하나씩 뒤져 보자!`],
    [`I smell paper near ${room}!`, `One piece must be somewhere in ${room}.`, `Go to ${room}. Let's search the furniture one by one!`]);
  return lines[Math.floor(Math.random() * lines.length)];
}
let hintT = 0;
$('detector').onclick = () => { if (performance.now() < hintT || !S.inGame) return; hintT = performance.now() + 5000; say([lumiLine(roomHint())]); };
function useItem() { if (S.me.item >= 0 && S.phase === 'play') sendInput({ t: 'use' }); }

/* ---------- 방장 판정: 화면 그리기와 따로 30Hz로 돈다(방장 탭이 가려져도 멈추지 않게) ---------- */
let simLast = performance.now();
setInterval(() => {
  const now = performance.now(), dt = Math.min((now - simLast) / 1000, 0.25); simLast = now;
  if (!S.inGame || !S.sim || S.paused) return;
  for (let left = dt; left > 0; left -= 0.05) S.sim.step(Math.min(left, 0.05));
  // 내 화면에는 매번(30Hz) 적용하고, 친구들에게는 15Hz로 보낸다. 그 사이 사건은 모아서 함께 보낸다
  const snap = S.sim.snapshot(); applySnap(snap);
  if (!S.link) return;
  S.pendingEv.push(...snap.ev);
  S.snapT -= dt;
  if (S.snapT <= 0) { S.snapT = 1 / 15; S.link.broadcast({ ...snap, ev: S.pendingEv }); S.pendingEv = []; }
}, 1000 / 30);

/* ---------- 매 프레임 ---------- */
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  if (S.world) {
    if (S.inGame) {
      updateMe(dt);
      if (S.time > 0 && S.phase === 'play' && !S.paused) S.time -= dt;
      dangerAndHeart(dt);
      updateActionUI();
      updateAimPreview();
      stepCine(dt);
      stepQuizRange();
      stepStingers(dt);
    }
    animateActors(dt, t);
    updateCamera(dt, t);
    updateLights(t);
  }
  if (composer) composer.render(); else renderer.render(scene, camera);
  watchFps(clock.elapsedTime);
}

// 프레임이 느리면 해상도를 조금씩 낮추고, 여유가 생기면 다시 올린다. ` 키로 FPS 표시
const fpsBox = Object.assign(document.createElement('div'), { id: 'fps' });
fpsBox.hidden = !/[?&]fps/.test(location.search);
document.getElementById('app').appendChild(fpsBox);
let fpsFrames = 0, fpsFrom = 0, fpsSlow = 0, fpsFast = 0;
addEventListener('keydown', e => { if (e.code === 'Backquote') fpsBox.hidden = !fpsBox.hidden; });
function watchFps(now) {
  fpsFrames++;
  if (now - fpsFrom < 1) return;
  const fps = fpsFrames / (now - fpsFrom); fpsFrames = 0; fpsFrom = now;
  if (document.hidden) return;
  fpsSlow = fps < 40 ? fpsSlow + 1 : 0; fpsFast = fps > 58 ? fpsFast + 1 : 0;
  if (fpsSlow >= 2 && pixelRatio > MIN_PR) { pixelRatio = Math.max(MIN_PR, +(pixelRatio - 0.15).toFixed(2)); fpsSlow = 0; resize(); }
  else if (fpsFast >= 4 && pixelRatio < MAX_PR) { pixelRatio = Math.min(MAX_PR, +(pixelRatio + 0.1).toFixed(2)); fpsFast = 0; resize(); }
  if (!fpsBox.hidden) fpsBox.textContent = `${fps.toFixed(0)} fps · ${T('해상도', 'res')} ×${pixelRatio}`;
}

function animateActors(dt, t) {
  const k = Math.min(1, dt * 12);
  for (const p of S.players.values()) {
    const mine = p.slot === S.mySlot;
    if (!mine) { p.x += (p.tx - p.x) * k; p.z += (p.tz - p.z) * k; p.face += angDiff(p.face, p.tface) * k; p.moving = !!(p.flags & 8); }
    const hidden = p.flags & 1, caged = p.flags & 2, escaped = p.flags & 4;
    p.grp.visible = !hidden && !escaped;
    let x = p.x, z = p.z;
    if (caged && S.world.cages[0]) { const cg = S.world.cages[0]; const o = (p.slot % 4) - 1.5; x = cg.c + o * 0.22; z = cg.r + (p.slot % 2) * 0.2; }
    p.grp.rotation.y = p.face;
    if (p.kid) {
      // 뼈대 동작: 달리기·서기, 잡히면 움찔(새장 안에서는 서기)
      p.grp.position.set(x, 0, z);
      if (caged && !p.wasCaged) p.hitT = 0.6;
      p.wasCaged = !!caged;
      if (p.hitT > 0) { p.hitT -= dt; playKid(p.kid, 'hit', dt); }
      else if (p.moving && !caged) playKid(p.kid, mine && S.me.speedK < 0.6 ? 'walk' : 'run', dt, p.flags & 32 ? 1.4 : 1);
      else playKid(p.kid, 'idle', dt);
    } else {
      if (p.moving && !caged) p.bob += dt * 13;
      p.grp.position.set(x, p.moving ? Math.abs(Math.sin(p.bob)) * 0.08 : 0, z);
      p.model.rotation.z = p.moving ? Math.sin(p.bob) * 0.08 : 0;
      p.model.scale.y = p.model.scale.x * (1 + Math.sin(t * 2.4 + p.slot) * 0.012);
    }
    // 무적(깜빡임)
    p.model.visible = !(p.flags & 16) || Math.floor(t * 10) % 2 === 0;
  }
  for (const m of S.monsters) {
    m.anim += dt;
    if (S.inGame) { m.x += (m.tx - m.x) * k; m.z += (m.tz - m.z) * k; m.face += angDiff(m.face, m.tface) * Math.min(1, dt * 8); }
    const s = m.spec, chasing = m.state === 2 || m.state === 1 || m.state === 5 || m.state === 6;
    const fly = s.float ? s.float + Math.sin(m.anim * (s.kind === 'bat' ? 5 : 1.8)) * (s.kind === 'bat' ? 0.15 : 0.08) : 0;
    m.grp.position.set(m.x, fly, m.z); m.grp.rotation.y = m.face;
    if (s.kind === 'bat') m.model.scale.x = m.model.scale.y * (1 + Math.sin(m.anim * 14) * 0.18);
    else if (s.kind === 'spider') m.model.position.y = Math.abs(Math.sin(m.anim * 20)) * (chasing ? 0.05 : 0.01);
    else m.model.rotation.z = Math.sin(m.anim * (chasing ? 9 : 4)) * (s.float ? 0.04 : 0.07);
    m.bang.visible = chasing; m.huh.visible = m.state === 7; m.want.visible = m.state === 8;
    m.yum.visible = m.state === 9; if (m.state === 9) m.yum.position.y = s.h + 0.5 + Math.abs(Math.sin(t * 6)) * 0.12;
    const glow = m.state === 7 ? 0.25 : chasing ? 1.5 + Math.sin(t * 20) * 0.3 : 0.9;
    m.eyes.forEach(e => e.scale.setScalar((s.kind === 'spider' ? 0.16 : 0.2) * glow));
    m.halo.material.color.setHex(chasing ? 0xff6a5a : 0xffffff); m.halo.material.opacity = chasing ? 0.5 + Math.sin(t * 8) * 0.08 : 0.32;
  }
  animateThrows(dt, t);
  for (const fx of S.searchFx || []) if (fx.grp.visible) { const k = 0.75 + Math.sin(t * 3 + fx.seed) * 0.25; fx.gl.scale.setScalar(0.55 + k * 0.3); fx.gl.material.opacity = k; fx.q.position.y = 0.05 + Math.sin(t * 2 + fx.seed) * 0.06; }
  for (const cd of S.world.candies) if (cd?.grp.visible) cd.sp.position.y = 0.45 + Math.sin(t * 3 + cd.grp.position.x) * 0.07;
  for (const f of S.world.frags) if (f.grp.visible) { f.paper.position.y = 0.75 + Math.sin(t * 2 + f.grp.position.x) * 0.08; f.paper.rotation.y = t * 1.3; }
  for (const it of S.world.itemMeshes.values()) if (it.grp.visible) { it.o.rotation.y = t * 1.6; it.o.position.y = 0.35 + Math.sin(t * 2.4 + it.grp.position.x) * 0.06; }
  S.world.cages.forEach((cg, i) => { const pr = S.cageProg[i] || 0; cg.ring.material.opacity = pr > 0 ? 0.9 : 0; cg.ring.scale.setScalar(0.4 + pr * 0.6); });
  const ex = S.world.exit;
  if (ex.open && ex.pivot) {
    ex.swing = Math.min(1, ex.swing + dt * 0.7); const k = 1 - (1 - ex.swing) ** 3;   // 처음엔 빠르게, 끝에서 천천히
    ex.pivot.rotation.y = -1.75 * k;
    ex.light.intensity = 9 * k; ex.glow.material.opacity = 0.7 * k * (0.9 + Math.sin(t * 3) * 0.1);
  }
}

function updateCamera(dt, t) {
  let fx = S.me.x, fz = S.me.z;
  if (!S.inGame) { fx = S.world.W / 2 + Math.sin(t * 0.08) * 6; fz = S.world.H / 2 + Math.cos(t * 0.06) * 4; }
  else if (S.me.flags & 4) {
    // 탈출한 뒤엔 남은 친구를 따라간다
    const o = [...S.players.values()].find(p => !(p.flags & 6)); if (o) { fx = o.x; fz = o.z; }
  } else if (S.me.flags & 2 && S.world.cages[0]) { fx = S.world.cages[0].c; fz = S.world.cages[0].r; }
  if (S.cine && S.inGame) { fx = S.world.exit.x; fz = S.world.exit.z + 1.2; }
  const ck = Math.min(1, dt * (S.cine ? 2.6 : 6));
  camTarget.x += (fx - camTarget.x) * ck; camTarget.z += (fz - camTarget.z) * ck;
  const off = S.inGame ? CAM_OFF : new THREE.Vector3(0, 11, 8);
  camera.position.set(camTarget.x + off.x, off.y, camTarget.z + off.z);
  if (S.shake > 0) { S.shake -= dt; camera.position.x += (Math.random() - 0.5) * S.shake; camera.position.y += (Math.random() - 0.5) * S.shake; }
  camera.lookAt(camTarget.x, 0.4, camTarget.z - 0.6);
  fadeUniform.value.set(S.inGame ? S.me.x : -99, 0, S.inGame ? S.me.z : -99);
}

function updateLights(t) {
  // 0.3초마다 카메라 중심에서 가까운 불빛 4곳을 고른다
  if (t - lampT > 0.3 || !lampPick.length) {
    lampT = t;
    lampPick = S.world.lights.map(L => ({ L, d: (L.c - camTarget.x) ** 2 + (L.r - camTarget.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, lampPool.length).map(o => o.L);
  }
  lampPool.forEach((l, k) => {
    const L = lampPick[k];
    if (!L) { l.intensity = 0; return; }
    l.position.set(L.c, L.y, L.r); l.color.setHex(L.color); l.distance = L.dist;
    l.intensity = L.int * 0.7 * (0.82 + Math.sin(t * 11 + L.seed) * 0.06 + Math.sin(t * 6.3 + L.seed * 2) * 0.1);
  });
  // 내 손전등이 언제나 0번(가볍게에서는 손전등 불빛이 하나뿐이다)
  let i = 0;
  const order = [...S.players.values()].sort((a, b) => (b.slot === S.mySlot) - (a.slot === S.mySlot));
  for (const p of order) {
    if (i >= torches.length) break;
    const s = torches[i++], mine = p.slot === S.mySlot, off = p.flags & 7 || !S.inGame;
    s.intensity = off ? 0 : mine ? 120 : 70;
    s.castShadow = HIGH && mine;
    if (s.castShadow && s.shadow.mapSize.x !== 512) { s.shadow.mapSize.set(512, 512); s.shadow.bias = -0.003; s.shadow.camera.near = 0.3; s.shadow.camera.far = 12; }
    // 손 높이에서 발 앞 바닥을 향해(빛 웅덩이가 발밑에서 바로 시작하게)
    s.position.set(p.x + Math.sin(p.face) * 0.2, 1.0, p.z + Math.cos(p.face) * 0.2);
    s.target.position.set(p.x + Math.sin(p.face) * 5.5, 0, p.z + Math.cos(p.face) * 5.5);
  }
  for (; i < torches.length; i++) torches[i].intensity = 0;
  // 바닥 빛줄기: 학생마다(가볍게에서도 보이는 값싼 판 하나)
  for (const p of S.players.values()) {
    const b = p.beam || (p.beam = makeBeam()), off = p.flags & 7 || !S.inGame;
    b.visible = !off; if (off) continue;
    const reach = beamReach(p), mine = p.slot === S.mySlot;
    b.position.set(p.x + Math.sin(p.face) * 0.12, 0.03, p.z + Math.cos(p.face) * 0.12); b.rotation.y = p.face;
    b.scale.set(3.4 * Math.min(1, reach / BEAM_LEN + 0.25), 1, reach); b.material.opacity = mine ? 0.55 : 0.35;
  }
  const lit = S.inGame && !(S.me.flags & 5);
  // 카메라 쪽(남쪽) 앞에서 얼굴을 비춘다
  aura.intensity = lit ? 2.2 : 0; aura.position.set(S.me.x, 1.5, S.me.z + 0.9);
}

/* ---------- 긴장감: 붉은 테두리와 심장 소리 ---------- */
function dangerAndHeart(dt) {
  let near = 99, chase = 99;
  for (const m of S.monsters) {
    const d = Math.hypot(m.x - S.me.x, m.z - S.me.z);
    near = Math.min(near, d);
    if (m.state === 2 || m.state === 5 || m.state === 6) chase = Math.min(chase, d);
  }
  const active = S.phase === 'play' && !(S.me.flags & 6);
  const danger = active ? Math.max(0, 1 - chase / 7) : 0;
  const dread = active ? Math.max(0, 1 - near / 8) : 0;
  $('danger').style.opacity = (danger * 0.75 + dread * 0.15).toFixed(2);
  S.heartT -= dt;
  const v = Math.max(danger, dread * 0.6);
  if (v > 0.05 && S.heartT <= 0) { Sound.heart(v); S.heartT = 1.25 - v * 0.8; }
}

/* ---------- HUD ---------- */
function updateHUD() {
  const tm = $('timer'); tm.textContent = fmtTime(S.time); tm.classList.toggle('low', S.time < 45);
  $('fragN').textContent = S.pz.asm ? T('완성', 'done') : `${S.pz.have.length}/4`;
  $('noteBtn').classList.toggle('ready', (S.pz.have.length === 4 || S.pz.asm) && !S.pz.open);
  const tb = $('throwBtn'); tb.hidden = !S.inGame || $('bottom').hidden || !!(S.me.flags & 4);
  $('throwN').textContent = S.me.candy; tb.classList.toggle('empty', S.me.candy <= 0 || !!(S.me.flags & 3));
  const teamHTML = [...S.players.values()].map(p => {
    const ch = CHARACTERS[p.char % CHARACTERS.length];
    const st = p.flags & 4 ? '✨' : p.flags & 2 ? '🔒' : p.flags & 1 ? '🫥' : '🏃';
    return `<div class="mate ${p.slot === S.mySlot ? 'me' : ''} ${p.flags & 2 ? 'caged' : ''}"><i style="background:${ch.color}"></i>${esc(p.name)}<span class="st">${st}</span></div>`;
  }).join('');
  if (teamHTML !== S.teamHTML) { S.teamHTML = teamHTML; $('team').innerHTML = teamHTML; }
  updateItemBtn();
  // 배너
  const b = $('banner'); let msg = '';
  if (S.me.flags & 4) msg = T('✨ 탈출 성공! 남은 친구들을 기다려요', '✨ You escaped! Wait for your friends');
  else if (S.me.flags & 2) msg = T('🔒 새장에 갇혔어요. 친구가 옆에 서 있으면 풀려나요 · 그동안 쪽지를 풀 수 있어요', "🔒 You're in the cage. A friend standing next to it frees you · You can still work on the note");
  else if (S.pz.have.length === 4 && !S.pz.asm && $('note').hidden) msg = T('📜 쪽지를 다 모았어요! 쪽지 버튼을 눌러 이어 붙여요', '📜 You have all the pieces! Press the note button to put them together');
  else if (S.pz.asm && !S.pz.open && $('note').hidden) msg = T('📜 쪽지 버튼을 눌러 문제를 풀면 탈출문이 열려요', '📜 Press the note button and solve the question to open the exit');
  if (b.textContent !== msg) b.textContent = msg;
  b.hidden = !msg || dialogOpen();
  $('hideview').hidden = !(S.me.flags & 1);
  updateCompass();
}
// 길잡이 화살표: 쪽지를 다 모으기 전에는 가장 가까운 쪽지, 문이 열리면 탈출문. 초등학생이 헤매지 않게
function updateCompass() {
  const cmp = $('compass');
  if (!S.world || !S.inGame || S.me.flags & 6 || S.phase !== 'play') { cmp.hidden = true; $('detector').hidden = true; return; }
  updateDetector();
  let tx = null, tz = null, label = '';
  if (S.pz.open) { tx = S.world.exit.x; tz = S.world.exit.z; label = EXIT_LABEL; }
  if (tx === null) { cmp.hidden = true; return; }
  const dx = tx - S.me.x, dz = tz - S.me.z;
  $('compassArrow').style.transform = `rotate(${Math.atan2(dx, -dz)}rad)`;
  $('compassLabel').textContent = label; $('compassDist').textContent = `${Math.round(Math.hypot(dx, dz))}${T('칸', ' m')}`;
  cmp.classList.toggle('exit', label === EXIT_LABEL);
  cmp.hidden = false;
}
// 쪽지 감지기: 가장 가까운 (못 찾은) 쪽지까지 거리로 5단계. 가까울수록 막대가 차고 빨리 깜빡인다
const DET_WORDS = T(['차가워', '미지근해', '따뜻해', '뜨거워!', '바로 여기!'], ['Cold', 'Cool', 'Warm', 'Hot!', 'Right here!']);
const EXIT_LABEL = T('탈출문', 'Exit');
function updateDetector() {
  const det = $('detector'), left = (S.fragList || []).filter(f => !f[2]);
  if (S.pz.open || S.pz.have.length >= 4 || !left.length) { det.hidden = true; return; }
  const d = Math.min(...left.map(f => Math.hypot(f[0] - S.me.x, f[1] - S.me.z)));
  const s = Math.max(0, Math.min(1, 1 - (d - 1.5) / 12));
  const lv = s < 0.2 ? 0 : s < 0.45 ? 1 : s < 0.7 ? 2 : s < 0.88 ? 3 : 4;
  if (det.dataset.lv !== String(lv)) { det.dataset.lv = lv; $('detWord').textContent = DET_WORDS[lv]; }
  det.style.setProperty('--beat', (1.5 - s * 1.15).toFixed(2) + 's');
  det.hidden = false;
}
function updateItemBtn() {
  const it = S.me.item, btn = $('itemBtn');
  const info = it === 1 ? ['🔮', T('수정구', 'Crystal')] : it === 2 ? ['🧪', T('날쌘 물약', 'Potion')] : ['✋', T('빈손', 'Empty')];
  $('itemIcon').textContent = info[0]; $('itemName').textContent = info[1]; btn.disabled = it < 0;
  btn.classList.toggle('ready', it >= 0);
}
function updateActionUI() {
  const btn = $('actBtn'); let label = '';
  if (S.phase === 'play' && !S.cine) {
    const it = nearItem();
    if (S.me.flags & 1) label = T('옷장에서 나오기', 'Leave wardrobe');
    else if (nearChest() >= 0) label = T('🎃 호박 상자 열기', '🎃 Open pumpkin box');
    else if (it >= 0) {
      const code = S.itemList[it][0], [ic, nm, nmRo] = ITEM_INFO[code] || ['✨', T('아이템', 'item'), T('아이템으로', 'item')];
      label = code > 0 && S.me.item > 0 ? T(`${ic} ${nmRo} 바꾸기`, `${ic} Swap for ${nmRo}`) : T(`${ic} ${nm} 줍기`, `${ic} Pick up ${nm}`);
    }
    else if (nearSearch() >= 0) {
      const a = S.searchList[nearSearch()], [ic, nm] = SEARCHABLE[SEARCH_CODES[a[3]]] || ['🔍', T('가구', 'furniture')];
      label = a[4] ? T(`🔒 ${a[4]}초 뒤에 다시`, `🔒 Try again in ${a[4]} s`) : T(`${ic} ${nm} 뒤지기`, `${ic} Search ${nm}`);
    }
    else if (!(S.me.flags & 6) && nearWardrobe() >= 0) label = T('옷장에 숨기', 'Hide in wardrobe');
  }
  const html = label ? `${label} <span class="how">${coarse ? T('터치', 'tap') : 'E'}</span>` : '';
  if (btn.dataset.html !== html) { btn.dataset.html = html; btn.innerHTML = html; }
  btn.hidden = !label;
}
function toast(msg, ms = 3400) {
  const box = $('toasts'), el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
}
function flashScreen(color, op) {
  const f = $('flash'); f.style.transition = 'none'; f.style.background = color; f.style.opacity = op;
  setTimeout(() => { f.style.transition = 'opacity .9s'; f.style.opacity = 0; }, 40);
}

/* ---------- 쪽지(조각 모으기 → 순서 맞추기 → 보기 고르기) ---------- */
function toggleNote(force) {
  const el = $('note'); const show = force ?? el.hidden;
  el.hidden = !show; $('app').classList.toggle('note-on', show); if (show) { closeQuiz(); renderNote(); }
}
// 1~2학년은 조각에 번호를 붙여 순서 맞추기를 쉽게 한다
const lowGrade = () => (S.playGrade ?? S.grade) <= 2;
function pieceStyle(i) { return `border-left-color:${i > 0 ? EDGE_COLORS[i] : 'transparent'};border-right-color:${i < 3 ? EDGE_COLORS[i + 1] : 'transparent'}`; }
function pieceInner(i) { return (lowGrade() ? `<span class="num">${i + 1}</span>` : '') + esc(S.puzzle.parts[i]); }
function choicesHTML(quiz, wrongSet) {
  return `<div class="choices">${quiz.choices.map((c, k) => `<button class="choice ${wrongSet?.has(c) ? 'wrong' : ''}" data-k="${k}" ${wrongSet?.has(c) ? 'disabled' : ''}>${esc(c)}</button>`).join('')}</div>`;
}
// 문제 읽어 주기(브라우저 음성). 1~2학년은 문제 창이 열리면 저절로 읽는다
const canSpeak = 'speechSynthesis' in window;
const readBtn = () => canSpeak ? T('<button class="read" type="button" aria-label="문제 읽어 주기">🔊 읽어 주기</button>', '<button class="read" type="button" aria-label="Read the question aloud">🔊 Read aloud</button>') : '';
function speak(text) {
  if (!canSpeak || Sound.muted) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = T('ko-KR', 'en-US'); u.rate = 0.92;
  const v = speechSynthesis.getVoices().find(v => v.lang?.startsWith(T('ko', 'en'))); if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function bindRead(body, quiz, auto) {
  const text = T(`${quiz.q} 보기. ${quiz.choices.map((c, i) => `${i + 1}번, ${c}`).join('. ')}.`, `${quiz.q} Choices. ${quiz.choices.map((c, i) => `${i + 1}, ${c}`).join('. ')}.`);
  const b = body.querySelector('.read'); if (b) b.onclick = () => speak(text);
  if (auto) speak(text);
}
function renderNote() {
  if (!S.puzzle) return;
  const body = $('noteBody'), N = S.puzzle.parts.length, have = S.pz.have;
  $('noteCount').textContent = S.pz.asm ? T('문제 완성', 'Question complete') : T(`${have.length} / ${N} 조각`, `${have.length} / ${N} pieces`);
  if (S.pz.open) { body.innerHTML = `<div class="correct"><b>${T('정답!', 'Correct!')}</b><span>${esc(S.puzzle.answer)}</span></div><p class="problem">${esc(S.puzzle.q)}</p>`; return; }
  if (S.pz.asm) {
    const hint = S.pz.wrong >= 1 ? `<div class="hint">${T('힌트', 'Hint')}: ${esc(S.puzzle.hint || T('문제를 천천히 다시 읽어 보세요.', 'Read the question again slowly.'))}</div>` : '';
    body.innerHTML = `<p class="note-lead">${T('완성된 문제예요. 알맞은 답을 눌러요. 틀리면 쪽지가 다시 흩어져요(다시 모아 붙이면 힌트가 보여요).', 'Here is the full question. Tap the right answer. If you are wrong, the note scatters again (put it back together to see a hint).')}</p>
      ${readBtn()}<p class="problem">${esc(S.puzzle.q)}</p>${choicesHTML(S.puzzle, S.note.wrongPicks)}${hint}`;
    bindRead(body, S.puzzle, false);
    body.querySelectorAll('.choice').forEach(b => b.onclick = () => {
      if (S.note.picked) return;
      S.note.picked = S.puzzle.choices[+b.dataset.k]; b.classList.add('right');
      sendInput({ t: 'answer', v: S.note.picked });
      setTimeout(() => { S.note.picked = null; }, 1500);
    });
    return;
  }
  if (have.length < N) {
    body.innerHTML = `<p class="note-lead">${T(`문제가 ${N}조각으로 찢겨 가구 속에 숨겨져 있어요. 물음표가 반짝이는 책장·탁자 옆에서 상호작용 단추를 눌러 뒤져 봐요. 위의 감지기가 뜨거워지면 가까워요.`, `The question was torn into ${N} pieces and hidden in furniture. Stand next to furniture with a glowing ? and press the action button to search. When the detector at the top gets hot, you are close.`)}</p>
      <div class="pieces">${[0, 1, 2, 3].map(i => have.includes(i) ? `<div class="piece" style="${pieceStyle(i)}">${pieceInner(i)}</div>` : `<div class="piece missing">?</div>`).join('')}</div>`;
    return;
  }
  // 조합: 조각을 끌어다 칸에 놓는다. 놓은 조각도 끌어서 다른 칸과 바꾸거나 아래로 빼낼 수 있다.
  // 짧게 누르면 빈 칸 맨 앞으로 들어가고, 놓인 조각을 짧게 누르면 빠진다. 네 칸이 다 차면 "이대로 붙이기"
  const slots = S.note.slots, tray = S.note.tray.filter(i => !slots.includes(i)), full = slots.every(v => v != null);
  body.innerHTML = `<p class="note-lead">${T(`조각을 모두 모았어요! ${lowGrade() ? '번호 순서대로' : '이웃한 가장자리 색이 같도록'} 조각을 끌어다 칸에 놓아요. 놓은 조각도 끌어서 자리를 바꿀 수 있어요.`, `You have all the pieces! Drag them into the slots ${lowGrade() ? 'in number order' : 'so touching edges have the same color'}. You can drag placed pieces to swap them.`)}</p>
    <div class="slots" id="noteSlots">${slots.map((v, k) => `<div class="slot ${v != null ? 'full' : ''}" data-k="${k}">${v != null ? `<div class="piece drag" data-i="${v}" data-from="${k}" style="${pieceStyle(v)}">${pieceInner(v)}</div>` : k + 1}</div>`).join('')}</div>
    <div class="pieces tray" id="noteTray">${tray.map(i => `<div class="piece drag pick" data-i="${i}" data-from="tray" style="${pieceStyle(i)}">${pieceInner(i)}</div>`).join('')}</div>
    ${full ? `<button class="big glue" id="glueBtn">${T('이대로 붙이기', 'Stick them together')}</button>` : ''}`;
  body.querySelectorAll('.piece.drag').forEach(dragPiece);
  const glue = $('glueBtn');
  if (glue) glue.onclick = () => sendInput({ t: 'arrange', order: S.note.slots.slice() });
}
// 조각 옮기기: to는 칸 번호 또는 'tray'. 칸끼리는 서로 바꾸고, 차 있는 칸에 놓으면 있던 조각은 아래로 돌아간다
function placePiece(i, from, to) {
  const s = S.note.slots;
  if (to === 'tray') { if (from !== 'tray') s[from] = null; }
  else if (from === 'tray') s[to] = i;
  else { const t = s[to]; s[to] = i; s[from] = t ?? null; }
  renderNote();
}
function dragPiece(el) {
  const i = +el.dataset.i, from = el.dataset.from === 'tray' ? 'tray' : +el.dataset.from;
  let sx = 0, sy = 0, id = null, ghost = null, over = null;
  const target = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    return hit?.closest('#noteSlots .slot') || hit?.closest('#noteTray') || null;
  };
  const mark = (t) => { if (over === t) return; over?.classList.remove('over'); over = t; over?.classList.add('over'); };
  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId; sx = e.clientX; sy = e.clientY;
    try { el.setPointerCapture(id); } catch { }
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) {
      const r = el.getBoundingClientRect();
      ghost = el.cloneNode(true); ghost.classList.add('drag-ghost'); ghost.style.width = r.width + 'px';
      document.body.appendChild(ghost); el.classList.add('lifted');
    }
    if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; mark(target(e.clientX, e.clientY)); }
  });
  const end = (e, cancel) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!ghost) {   // 짧게 누름
      if (cancel) return;
      if (from === 'tray') { const k = S.note.slots.indexOf(null); if (k >= 0) placePiece(i, from, k); }
      else placePiece(i, from, 'tray');
      return;
    }
    ghost.remove(); ghost = null; el.classList.remove('lifted');
    const t = cancel ? null : over; mark(null);
    if (!t) return;
    if (t.id === 'noteTray') placePiece(i, from, 'tray');
    else if (+t.dataset.k !== from) placePiece(i, from, +t.dataset.k);
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
}
function noteKey(e) {
  // 숫자 1~4로 보기 고르기
  const k = /^(Digit|Numpad)([1-4])$/.exec(e.code);
  if (!k) return;
  const panel = !$('quiz').hidden ? $('quizBody') : !$('note').hidden ? $('noteBody') : null;
  panel?.querySelector(`.choice[data-k="${+k[2] - 1}"]:not([disabled])`)?.click();
}

/* ---------- 호박 상자·가구 문제 ---------- */
let quizAt = null;   // { kind: 'chest'|'search', id, x, z, answered }
function openQuiz(id) {
  const quiz = S.chestQuiz[id % Math.max(1, S.chestQuiz.length)]; if (!quiz) return;
  const c = S.world.chests[id];
  showQuiz({ kind: 'chest', id, x: c.c, z: c.r }, quiz, T('🎃 호박 상자', '🎃 Pumpkin Box'), T('맞히면 아이템!', 'Get it right for an item!'), S.chestSeen++ < 2 ? T('문제를 맞히면 상자가 열려요. 기회는 한 번! (괴물은 계속 움직여요)', 'Answer correctly to open the box. One try only! (Monsters keep moving)') : T('기회는 한 번!', 'One try only!'),
    ok => sendInput({ t: 'chest', id, ok }));
}
// 가구 문제: 이 층의 가구 문제 묶음에서 차례로 꺼낸다(틀린 뒤 다시 오면 다음 문제)
function openSearchQuiz(id) {
  const a = S.searchList[id], quiz = S.searchQuiz[S.searchQi++ % Math.max(1, S.searchQuiz.length)]; if (!quiz) return;
  const [ic, nm] = SEARCHABLE[SEARCH_CODES[a[3]]] || ['🔍', T('가구', 'furniture')];
  Sound.play('paper', 0.6); sendInput({ t: 'peek', id, rd: S.round });
  showQuiz({ kind: 'search', id, x: a[0], z: a[1] }, quiz, T(`${ic} ${nm} 뒤지기`, `${ic} Search the ${nm}`), T('맞히면 뒤질 수 있어요', 'Answer to search it'),
    S.leadSeen++ < 2 ? T(`문제를 맞히면 ${josa(nm, '을를')} 뒤져요. 틀리면 잠깐 잠기고, 다시 오면 다른 문제가 나와요. 푸는 동안 몸을 숙여서 괴물 눈에 덜 띄지만, 움직이면 들켜요!`, `Answer correctly to search the ${nm}. If you are wrong it locks for a moment, and you get a different question next time. You crouch while answering so monsters see you less, but moving gives you away!`) : T('맞히면 뒤져요 · 움직이면 들켜요!', 'Answer to search · Moving gives you away!'),
    ok => sendInput({ t: 'search', id, ok, rd: S.round }));
}
function showQuiz(at, quiz, title, sub, lead, send) {
  quizAt = at; toggleNote(false);
  $('quizTitle').textContent = title; $('quizSub').textContent = sub;
  const body = $('quizBody');
  body.innerHTML = `<p class="note-lead">${esc(lead)}</p>${readBtn()}<p class="problem">${esc(quiz.q)}</p>${choicesHTML(quiz)}`;
  bindRead(body, quiz, lowGrade());
  body.querySelectorAll('.choice').forEach(b => b.onclick = () => {
    const pick = quiz.choices[+b.dataset.k], ok = pick === quiz.answer;
    body.querySelectorAll('.choice').forEach(x => { x.disabled = true; if (quiz.choices[+x.dataset.k] === quiz.answer) x.classList.add('right'); });
    if (!ok) { b.classList.add('wrong'); if (quiz.hint) body.insertAdjacentHTML('beforeend', `<div class="hint">${T('힌트', 'Hint')}: ${esc(quiz.hint)}</div>`); }
    if (ok) Sound.ok(); else Sound.bad();
    at.answered = true; send(ok);
    setTimeout(() => { if (quizAt === at) closeQuiz(); }, ok ? 900 : 2600);
  });
  $('quiz').hidden = false;
}
function closeQuiz() {
  if (canSpeak) speechSynthesis.cancel();
  if (quizAt?.kind === 'search' && !quizAt.answered) sendInput({ t: 'peek', id: -1 });
  quizAt = null; $('quiz').hidden = true;
}
$('quizClose').onclick = closeQuiz;
$('noteBtn').onclick = () => toggleNote();
$('noteClose').onclick = () => toggleNote(false);
$('itemBtn').onclick = useItem;
$('actBtn').onclick = act;

/* ---------- 대화창 ---------- */
let modalKey = () => { };
function openModal(html, onKey = () => { }) { $('sheet').innerHTML = html; $('modal').hidden = false; modalKey = onKey; keys.clear(); $('sheet').querySelector('[autofocus]')?.focus(); }
function closeModal() { $('modal').hidden = true; modalKey = () => { }; }

function openPause() {
  if (S.paused) return; S.paused = true;
  openModal(T(`<h2>잠깐 멈춤</h2><p class="lead">혼자 할 때만 멈출 수 있어요. 괴물도 시간도 멈췄어요.</p>
    <div class="row"><button class="btn-ink ghost" id="pQuit">처음 화면</button><button class="btn-ink" id="pGo" autofocus>계속하기</button></div>`, `<h2>Paused</h2><p class="lead">You can only pause when playing alone. The monsters and the clock are frozen.</p>
    <div class="row"><button class="btn-ink ghost" id="pQuit">Title screen</button><button class="btn-ink" id="pGo" autofocus>Continue</button></div>`), e => { if (e.code === 'Escape') resume(); });
  $('pGo').onclick = resume; $('pQuit').onclick = () => leaveToTitle();
}
function resume() { closeModal(); S.paused = false; clock.getDelta(); }

function statHTML(items) { return `<div class="stats">${items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`; }
const starHTML = (n) => `<div class="stars stars-lg">${[0, 1, 2].map(i => `<span class="${i < n ? 'on' : ''}">★</span>`).join('')}</div>`;
async function showClear(res) {
  toggleNote(false); closeQuiz();
  const st = STAGES[S.stageIdx], last = S.stageIdx === STAGES.length - 1;
  if (res) { for (const k of ['time', 'caught', 'stolen', 'wrong', 'items', 'candy', 'stars']) S.totals[k] += res[k] || 0; }
  const isHost = S.mode !== 'client';
  Sound.fanfare();
  // 층 사이 만화(마지막 층은 엔딩 만화 뒤 최종 결과)
  if (isHost) { if (last) clearProgress(); else saveProgress(S.stageIdx + 1, 0); }
  if (last) { await playComic('ending'); showEnding(); return; }
  if (AFTER_COMIC[S.stageIdx]) await playComic(AFTER_COMIC[S.stageIdx]);
  if (S.stageIdx !== STAGES.indexOf(st)) return;   // 그사이 방장이 다음 층을 시작했다
  if (S.mode === 'client') S.link?.send({ t: 'seen', st: S.stageIdx });
  openModal(`<div class="result-head"><h2>${T(`${esc(st.name)} 탈출!`, `Escaped the ${esc(st.name)}!`)}</h2>${res ? starHTML(res.stars) : ''}</div>
    ${res ? statHTML([[fmtTime(res.time), T('걸린 시간', 'Time')], [`${res.candy}/${res.candyTotal}`, T('모은 사탕', 'Candy')], [res.chestOk, T('연 호박 상자', 'Boxes opened')], [res.caught, T('잡힌 횟수', 'Times caught')], [res.wrong, T('틀린 답', 'Wrong answers')]]) : ''}
    <p class="lead center">${T('★ 탈출 · ★ 시간을 1/3 넘게 남김 · ★ 사탕 60% 넘게 주움', '★ Escape · ★ More than 1/3 of the time left · ★ More than 60% of the candy')}</p>
    ${S.mode === 'host' ? '<p class="lead center" id="cWait"></p>' : ''}
    <div class="row">${isHost ? `<button class="btn-ink" id="cNext" autofocus>${T('다음 층으로', 'Next floor')}</button>` : `<p class="lead">${T('방장이 다음 층을 시작하기를 기다려요…', 'Waiting for the host to start the next floor…')}</p>`}</div>`);
  if (isHost) $('cNext').onclick = () => { closeModal(); launchStage(S.stageIdx + 1); };
  updateSeen();
}
// 방장 화면: 층 사이 만화를 다 본 친구 수(다 보기 전에 시작하면 그 친구의 만화는 닫힌다)
function updateSeen() {
  const el = $('cWait'); if (!el || S.mode !== 'host') return;
  const friends = S.roster.filter(r => r.slot !== S.mySlot && !r.pending), n = friends.filter(r => S.seen?.has(r.slot)).length;
  if (!friends.length) { el.textContent = ''; return; }
  el.textContent = n >= friends.length ? T('✅ 친구들이 모두 만화를 다 봤어요!', '✅ All your friends finished the comic!') : T(`📖 친구 ${friends.length}명 중 ${n}명이 만화를 다 봤어요. 지금 시작하면 아직 보는 친구의 만화는 닫혀요.`, `📖 ${n} of ${friends.length} friends finished the comic. If you start now, the comic closes for friends still reading.`);
}
function showOver(why) {
  toggleNote(false); closeQuiz();
  const isHost = S.mode !== 'client';
  const title = why === 'time' ? T('자정의 종이 울렸어요', 'The midnight bell rang') : T('모두 새장에 갇혔어요', 'Everyone is caged');
  if (isHost) saveProgress(S.stageIdx, S.round);
  const again = S.round ? T(` 푼 쪽지는 그대로 두고 ${S.round + 1}번째 쪽지부터 이어서 해요.`, ` Solved notes stay solved; you continue from note ${S.round + 1}.`) : T(' 다시 하면 쪽지가 새로 숨겨져요.', ' If you try again, the notes are hidden in new places.');
  const lead = (why === 'time' ? T('시간 안에 탈출문을 열지 못했어요.', "You didn't open the exit in time.") : T('괴물에게 모두 잡혔어요. 서로 떨어져서 다니고, 잡힌 친구는 바로 구해 주세요.', 'The monsters caught everyone. Spread out, and rescue caught friends right away.')) + again;
  openModal(`<h2>${title}</h2><p class="story">${lead}</p>
    <p class="lead">${T('도움말: 위의 쪽지 감지기를 누르면 루미가 쪽지가 있는 방을 알려 줘요. 괴물이 쫓아오면 사탕을 던지거나 옷장에 숨어요.', 'Tip: press the note detector at the top and Lumi tells you which room a piece is in. If a monster chases you, throw candy or hide in a wardrobe.')}</p>
    <div class="row">${isHost ? `<button class="btn-ink ghost" id="oTitle">${T('처음 화면', 'Title screen')}</button><button class="btn-ink" id="oRetry" autofocus>${T('다시 도전', 'Try again')}</button>` : `<p class="lead">${T('방장이 다시 시작하기를 기다려요…', 'Waiting for the host to restart…')}</p>`}</div>`);
  if (isHost) { $('oRetry').onclick = () => { closeModal(); launchStage(S.stageIdx, S.round); }; $('oTitle').onclick = () => leaveToTitle(); }
}
function showEnding() {
  const T = S.totals;
  openModal(`<div class="result-head"><h2>${tr('호박 저택 탈출 성공!', 'You escaped Pumpkin Manor!')}</h2>${starHTML(Math.round(T.stars / STAGES.length))}</div>
    <p class="story">${tr('루미와의 술래잡기가 끝났어요. 내년 할로윈에도 초대장이 올까요?', 'The game of tag with Lumi is over. Will an invitation come again next Halloween?')}</p>
    ${statHTML([[fmtTime(T.time), tr('모두 걸린 시간', 'Total time')], [`★ ${T.stars}/${STAGES.length * 3}`, tr('모은 별', 'Stars')], [T.candy, tr('모은 사탕', 'Candy')], [T.caught, tr('잡힌 횟수', 'Times caught')], [T.wrong, tr('틀린 답', 'Wrong answers')]])}
    <p class="lead">${tr(`${S.grade}학년 문제로 놀았어요. 선생님께 이 화면을 보여 주세요.`, `You played with grade ${S.grade} questions. Show this screen to your teacher.`)}</p>
    <div class="row"><button class="btn-ink" id="eTitle" autofocus>${tr('처음 화면', 'Title screen')}</button></div>`);
  $('eTitle').onclick = () => leaveToTitle();
}

function openEditor() {
  openModal(`<h2>${T('문제 바꾸기', 'Edit questions')}</h2>
    <p class="lead">${T('학년 묶음 "1"~"6"과 "halloween"(할로윈 상식). 문제마다 <b>q</b>는 문제 글, <b>c</b>는 보기 4개(첫 번째가 정답, 화면에서는 섞여요), <b>hint</b>는 틀렸을 때 나오는 힌트예요. 할로윈 문제의 <b>lv</b>는 1(1~2학년부터)·2(3~4학년부터)·3(5~6학년). 이 기기에만 저장되고, 함께 할 때는 방장의 문제로 풀어요.', 'Grade sets "1" to "6" and "halloween" (Halloween trivia). In each question, <b>q</b> is the question text, <b>c</b> is the 4 choices (the first is correct; they are shuffled on screen), and <b>hint</b> shows after a wrong answer. For Halloween questions, <b>lv</b> is 1 (grade 1+), 2 (grade 3+) or 3 (grades 5–6). Saved on this device only; in co-op everyone uses the host\'s questions. Any subject works.')}</p>
    <textarea id="pj" spellcheck="false"></textarea><p class="err" id="pjErr"></p>
    <div class="row"><button class="btn-ink ghost" id="pjDef">${T('기본 문제로', 'Default questions')}</button><button class="btn-ink ghost" id="pjClose">${T('닫기', 'Close')}</button><button class="btn-ink" id="pjSave">${T('저장', 'Save')}</button></div>`, e => { if (e.code === 'Escape') closeModal(); });
  $('pj').value = JSON.stringify(S.bank, null, 1);
  $('pjClose').onclick = openSettings;
  $('pjDef').onclick = () => { $('pj').value = JSON.stringify(defaultBank(), null, 1); $('pjErr').textContent = T('기본 문제를 불러왔어요. 저장을 눌러야 적용돼요.', 'Default questions loaded. Press Save to apply.'); };
  $('pjSave').onclick = () => {
    let p; try { p = JSON.parse($('pj').value); } catch (e) { $('pjErr').textContent = T('JSON 형식이 맞지 않아요: ', 'Invalid JSON: ') + e.message; return; }
    const err = validateBank(p); if (err) { $('pjErr').textContent = err; return; }
    S.bank = p; store.set(BANK_KEY, JSON.stringify(p)); $('pjErr').textContent = T('저장했어요.', 'Saved.'); setTimeout(openSettings, 600);
  };
}
function openCredits() {
  openModal(T(`<h2>만든 재료</h2>
    <p><b>삼대 710 제작.</b> Built for Vibe Forge. © 2026 삼대710. 교실 내 비영리 사용 외 복제·수정·상업적 이용 금지.</p>
    <p>분장한 아이들: 지피티(ChatGPT)로 원화를 그리고 TRELLIS로 3D로 바꾼 뒤 Blender로 뼈대와 동작을 넣었어요. 만화도 지피티로 그렸어요.</p>
    <p>괴물·가구 3D 모델: <b>Scenario 3D Collection</b> (Scenario, CC BY 4.0, AI 생성) 중 골라 줄여 썼어요.</p>
    <p>효과음·음악: Stable Audio 3 Medium으로 만들었어요. 심장·정답 소리는 Web Audio로 합성했어요.</p>
    <p>3D 엔진: three.js r160 (MIT). 접속: PeerJS (MIT).</p>
    <div class="row"><button class="btn-ink" id="crClose" autofocus>닫기</button></div>`, `<h2>Credits</h2>
    <p><b>Made by Samdae710 (삼대710).</b> Built for Vibe Forge. © 2026 Samdae710. Non-commercial classroom use only; no copying, modifying or commercial use.</p>
    <p>Costumed kids: concept art drawn with ChatGPT, turned into 3D with TRELLIS, then rigged and animated in Blender. The comic was also drawn with ChatGPT.</p>
    <p>Monster and furniture 3D models: <b>Scenario 3D Collection</b> (Scenario, CC BY 4.0, AI-generated), selected and optimized.</p>
    <p>Sound effects and music: made with Stable Audio 3 Medium. Heartbeat and answer sounds are synthesized with Web Audio.</p>
    <p>3D engine: three.js r160 (MIT). Networking: PeerJS (MIT).</p>
    <div class="row"><button class="btn-ink" id="crClose" autofocus>Close</button></div>`));
  $('crClose').onclick = openSettings;
}

/* ---------- 설정 ---------- */
function openSettings() {
  const seg = (id, label, opts, cur) => `<div class="seg set" id="${id}"><span>${label}</span>${opts.map(([v, t]) => `<button data-v="${v}" aria-pressed="${v === cur}">${t}</button>`).join('')}</div>`;
  openModal(`<h2>${T('설정', 'Settings')}</h2>
    ${seg('setLang', T('언어', 'Language'), [['ko', '한국어'], ['en', 'English']], LANG)}
    ${seg('setDiff', T('괴물 세기', 'Monster speed'), T([['auto', '학년에 맞게'], ['easy', '느림'], ['normal', '보통'], ['hard', '빠름']], [['auto', 'By grade'], ['easy', 'Slow'], ['normal', 'Normal'], ['hard', 'Fast']]), S.diffSetting)}
    ${seg('setQ', T('그래픽', 'Graphics'), T([['high', '고급'], ['low', '가볍게(태블릿)']], [['high', 'High'], ['low', 'Light (tablet)']]), quality)}
    ${seg('setSnd', T('소리', 'Sound'), T([['on', '켜기'], ['off', '끄기']], [['on', 'On'], ['off', 'Off']]), Sound.muted ? 'off' : 'on')}
    ${T(`<ul class="howto"><li><b>움직이기</b>화면 왼쪽을 누르고 끌기</li><li><b>숨기·상자</b>오른쪽 아래 노란 단추 누르기</li><li><b>쪽지·아이템</b>사탕 단추 왼쪽의 쪽지·아이템 단추 누르기</li><li><b>사탕 던지기</b>오른쪽 아래 사탕 단추를 끌었다 놓기</li></ul>
    <p class="howto-pc">PC: WASD 움직이기 · E 숨기·상자 · Q 아이템 · 마우스 클릭 사탕 · Tab 쪽지</p>`, `<ul class="howto"><li><b>Move</b>Press and drag on the left side of the screen</li><li><b>Hide · Box</b>Press the yellow button at the bottom right</li><li><b>Note · Item</b>Press the note or item button left of the candy button</li><li><b>Throw candy</b>Drag and release the candy button at the bottom right</li></ul>
    <p class="howto-pc">PC: WASD move · E hide/box/search · Q item · Mouse click candy · Tab note</p>`)}
    <div class="row"><button class="btn-ink ghost" id="setEdit">${T('선생님: 문제 바꾸기', 'Teacher: edit questions')}</button><button class="btn-ink ghost" id="setCredit">${T('만든 재료', 'Credits')}</button><button class="btn-ink" id="setClose" autofocus>${T('닫기', 'Close')}</button></div>`,
    e => { if (e.code === 'Escape') closeModal(); });
  const bind = (id, fn) => $(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; fn(b.dataset.v); $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
  bind('setLang', v => { if (v !== LANG) setLang(v); });
  bind('setDiff', v => { S.diffSetting = v; store.set('pumpkin3-diff', v); });
  bind('setQ', v => { if (v !== quality) { store.set('pumpkin2-q', v); location.reload(); } });
  bind('setSnd', v => { Sound.setMuted(v === 'off'); $('muteIcon').textContent = Sound.muted ? '🔇' : '🔊'; });
  $('setEdit').onclick = openEditor; $('setCredit').onclick = openCredits; $('setClose').onclick = closeModal;
}

/* ---------- 전체 화면 ---------- */
function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else { const el = d.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => toast(T('이 기기에서는 전체 화면을 쓸 수 없어요', 'Full screen is not available on this device'))); }
}
const syncFull = () => { $('fullLabel').textContent = document.fullscreenElement || document.webkitFullscreenElement ? T('창 화면', 'Window') : T('전체 화면', 'Full screen'); };
document.addEventListener('fullscreenchange', syncFull); document.addEventListener('webkitfullscreenchange', syncFull);

/* ---------- 화면 전환·로비 ---------- */
function showScreen(id) { ['loading', 'title', 'grade', 'mode', 'lobby'].forEach(s => $(s).hidden = s !== id); }
function setTitleErr(t) { $('titleErr').textContent = t; if (t) showScreen('title'); }
function myName() { const n = $('nameIn').value.trim().slice(0, T(6, 10)) || T('학생', 'Player'); S.myName = n; store.set('pumpkin2-name', n); return n; }
function renderLobby() {
  $('members').innerHTML = S.roster.map(r => { const ch = CHARACTERS[r.char % CHARACTERS.length]; return `<li><i style="background:${ch.color}"></i>${esc(r.name)} · ${ch.costume}${r.slot === 0 ? ' 👑' : ''}<small>${r.pending ? T('들어오는 중', 'joining') : r.slot === S.mySlot ? T('나', 'me') : ''}</small></li>`; }).join('');
  setSeg('segStage', String(S.startStage));
}
function setSeg(id, v) { $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); }
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 타이틀 → 학년 → 놀이 방법 → (도입 만화) → 게임
$('gradeGrid').innerHTML = [1, 2, 3, 4, 5, 6].map(g => `<button data-g="${g}">${T(`${g}학년`, `Grade ${g}`)}<small>${g <= 2 ? T('번호 쪽지 · 느린 괴물', 'Numbered notes · Slow monsters') : g <= 4 ? T('느린 괴물', 'Slow monsters') : T('보통 괴물', 'Normal monsters')}</small></button>`).join('');
$('startBtn0').onclick = () => { Sound.init(); Sound.music(true); showScreen('grade'); $('gradeGrid').querySelector(`[data-g="${S.grade}"]`)?.focus(); };
$('gradeGrid').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.grade = +b.dataset.g; store.set('pumpkin3-grade', S.grade);
  $('modeTitle').textContent = T(`${S.grade}학년 · 어떻게 놀까요?`, `Grade ${S.grade} · How do you want to play?`);
  const sv = loadProgress(); $('contBtn').hidden = !sv; if (sv) $('contBtn').textContent = T(`▶ 이어 하기: ${saveLabel(sv)}`, `▶ Continue ${saveLabel(sv)}`);
  showScreen('mode');
};
$('gradeBack').onclick = () => showScreen('title');
$('modeBack').onclick = () => showScreen('grade');
$('settingsBtn').onclick = openSettings;
$('fullBtn').onclick = toggleFullscreen;
$('langBtn').onclick = () => setLang(T('en', 'ko'));
// 혼자 할 때 분장 고르기
S.char = +(store.get('pumpkin3-char') || 0);
const costumeRow = document.createElement('div'); costumeRow.className = 'costumes'; costumeRow.id = 'costumes';
costumeRow.innerHTML = CHARACTERS.map((c, i) => `<button data-c="${i}" aria-pressed="${i === S.char}" style="--c:${c.color}">${c.costume}</button>`).join('');
$('nameIn').closest('label').after(costumeRow);
costumeRow.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.char = +b.dataset.c; store.set('pumpkin3-char', S.char); costumeRow.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };

// 처음 들어갈 때 도입 만화를 본다(건너뛰기 가능). 방에 들어가는 친구는 방장을 기다리는 동안 본다
const withIntro = (fn) => async () => { Sound.init(); showScreen(null); Sound.music(false); await playComic('intro'); if (S.mode === 'none') fn(); };
$('soloBtn').onclick = withIntro(() => startSolo());
// 이어 하기는 도입 만화 없이 바로
$('contBtn').onclick = () => { const sv = loadProgress(); if (!sv) return; Sound.init(); Sound.music(false); showScreen(null); startSolo(sv); };
$('hostBtn').onclick = () => { Sound.init(); Sound.music(false); startHost(); playComic('intro').then(() => { if ($('codeBadge')) $('codeBadge').hidden = true; }); };
$('joinBtn').onclick = () => { Sound.init(); Sound.music(false); startJoin(); playComic('intro'); };
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('startBtn').onclick = () => {
  if (S.roster.some(r => r.pending)) { $('lobbyStatus').textContent = T('들어오는 중인 친구가 있어요. 잠깐만 기다려 주세요.', 'A friend is still joining. Please wait a moment.'); return; }
  const sv = S.resume && S.resume.st === S.startStage ? S.resume : null;
  if (!S.run) newRun();
  if (sv) S.totals = { ...S.totals, ...sv.totals };
  launchStage(S.startStage, sv ? sv.rd : 0);
};
$('leaveBtn').onclick = () => leaveToTitle();
$('segStage').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.startStage = +b.dataset.v; if (S.resume && S.resume.st !== S.startStage) { S.resume = null; $('lobbyHint').textContent = HOST_HINT(); } broadcastLobby(); };
$('muteBtn').onclick = () => { Sound.setMuted(!Sound.muted); $('muteIcon').textContent = Sound.muted ? '🔇' : '🔊'; };
$('muteIcon').textContent = Sound.muted ? '🔇' : '🔊';
$('nameIn').value = S.myName;

/* ---------- 시작 ---------- */
(async function boot() {
  await loadModels(p => { $('loadMsg').textContent = T(`저택 문을 여는 중… ${Math.round(p * 90)}%`, `Opening the manor door… ${Math.round(p * 90)}%`); });
  await loadKids(CHARACTERS.map(c => c.kid), p => { $('loadMsg').textContent = T(`친구들이 분장하는 중… ${90 + Math.round(p * 10)}%`, `Friends are putting on costumes… ${90 + Math.round(p * 10)}%`); });
  buildStageScene(0, null);
  showScreen('title');
  frame();
})();

// 테스트용 손잡이
window.__game = { S, sendInput, launchStage, renderer, scene, camera, get composer() { return composer; } };
