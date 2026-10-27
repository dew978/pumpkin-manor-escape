// GLB 모델 불러오기와 정규화. 모든 모델은 정면 +Z, 바닥 y=0, 가운데 정렬로 맞춘 뒤 높이를 지정해 복제해 쓴다.
// 모델: Scenario 3D Collection (CC BY 4.0, AI 생성) — assets/models/CREDITS.md
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_NAMES = ['boy', 'girl', 'redhood', 'tealgirl', 'reaper', 'knight', 'bat', 'spider', 'plague',
  'hourglass', 'potion', 'lantern', 'chandelier', 'door', 'throne', 'barrel', 'chest', 'chair', 'book',
  'owl', 'well', 'tree', 'bench', 'scarecrow', 'cage', 'witchhat', 'skull'];

const protos = {};

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(MODEL_NAMES.map(name => new Promise(res => {
    loader.load(`assets/models/${name}.glb`, gltf => {
      const root = gltf.scene;
      root.traverse(o => {
        if (!o.isMesh) return;
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        // 불빛이 여러 개인 어두운 장면에서는 PBR(Standard)이 무거워서 Lambert로 바꾼다
        const conv = (m) => {
          if (m.map) m.map.anisotropy = 4;
          return new THREE.MeshLambertMaterial({
            map: m.map || null, color: m.color ? m.color.clone() : new THREE.Color(1, 1, 1),
            emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0), emissiveMap: m.emissiveMap || null,
            transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, vertexColors: m.vertexColors, side: THREE.FrontSide,
          });
        };
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
        o.castShadow = true; o.receiveShadow = true;
      });
      const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      root.position.set(-c.x, -box.min.y, -c.z);
      holder.add(root);
      protos[name] = { holder, size };
      onProgress?.(++done / MODEL_NAMES.length);
      res();
    }, undefined, () => { console.warn('모델을 못 불러옴:', name); onProgress?.(++done / MODEL_NAMES.length); res(); });
  })));
}

// height: 목표 높이(월드 단위). fit: 'h' 높이 기준, 'w' 가로 기준
export function spawnModel(name, height, fit = 'h') {
  const p = protos[name];
  if (!p) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, height, 0.6), new THREE.MeshStandardMaterial({ color: 0x664477 })); m.position.y = height / 2; const g = new THREE.Group(); g.add(m); return g; }
  const g = p.holder.clone(true);
  g.traverse(o => { o.userData.shared = true; });
  const k = fit === 'w' ? height / Math.max(p.size.x, 0.001) : height / Math.max(p.size.y, 0.001);
  g.scale.setScalar(k);
  return g;
}
export const modelSize = name => protos[name]?.size;

/* ---------- 캔버스 텍스처 ---------- */
export function canvasTex(w, h, draw, repeat = null) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export function floorTexture(style, W, H) {
  const T = 64;
  return canvasTex(T * 4, T * 4, (c) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const n = hash(x, y), px = x * T, py = y * T;
      if (style === 'manor') {
        // 짙은 마루
        c.fillStyle = `rgb(${62 + n * 18},${40 + n * 10},${30 + n * 8})`; c.fillRect(px, py, T, T);
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(px, py + (x % 2 ? 0 : T / 2), T, 2); c.fillRect(px, py, 2, T);
        for (let k = 0; k < 6; k++) { c.fillStyle = `rgba(255,220,180,${0.03 + hash(x + k, y) * 0.04})`; c.fillRect(px, py + k * 10 + 3, T, 1); }
      } else if (style === 'cellar') {
        // 돌바닥
        c.fillStyle = `rgb(${46 + n * 14},${48 + n * 14},${54 + n * 14})`; c.fillRect(px, py, T, T);
        c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 3; c.strokeRect(px + 1, py + 1, T - 2, T - 2);
        for (let k = 0; k < 12; k++) { c.fillStyle = `rgba(255,255,255,${hash(k, x + y) * 0.05})`; c.fillRect(px + hash(k, x) * T, py + hash(y, k) * T, 3, 2); }
      } else {
        // 젖은 풀밭
        c.fillStyle = `rgb(${26 + n * 10},${44 + n * 14},${30 + n * 8})`; c.fillRect(px, py, T, T);
        for (let k = 0; k < 30; k++) { c.fillStyle = `rgba(${120 + hash(k, x) * 60},${170 + hash(y, k) * 50},100,${0.08 + hash(k, y) * 0.1})`; c.fillRect(px + hash(k, x + 3) * T, py + hash(k + 7, y) * T, 2, 5); }
      }
    }
  }, [W / 4, H / 4]);
}

export function wallTextures(style) {
  if (style === 'garden') {
    const side = canvasTex(128, 192, (c, w, h) => {
      c.fillStyle = '#1d3322'; c.fillRect(0, 0, w, h);
      for (let k = 0; k < 900; k++) { const g = 40 + hash(k, 1) * 60; c.fillStyle = `rgba(${g * 0.5},${g + 30},${g * 0.55},${0.5 + hash(k, 2) * 0.5})`; c.beginPath(); c.arc(hash(k, 3) * w, hash(k, 4) * h, 2 + hash(k, 5) * 4, 0, 7); c.fill(); }
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, h - 18, w, 18);
    });
    const top = canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#284a2e'; c.fillRect(0, 0, w, h); for (let k = 0; k < 200; k++) { c.fillStyle = `rgba(110,170,100,${hash(k, 9) * 0.4})`; c.fillRect(hash(k, 1) * w, hash(k, 2) * h, 3, 3); } });
    return { side, top, height: 1.9 };
  }
  if (style === 'cellar') {
    const side = canvasTex(128, 256, (c, w, h) => {
      c.fillStyle = '#2b2b33'; c.fillRect(0, 0, w, h);
      for (let row = 0; row < 12; row++) for (let col = 0; col < 3; col++) {
        const x = col * 48 - (row % 2) * 24, y = row * 22, n = hash(row, col);
        c.fillStyle = `rgb(${52 + n * 22},${50 + n * 20},${58 + n * 20})`; c.fillRect(x + 2, y + 2, 44, 18);
      }
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,30,20,.45)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    const top = canvasTex(32, 32, (c, w, h) => { c.fillStyle = '#18181d'; c.fillRect(0, 0, w, h); });
    return { side, top, height: 2.6 };
  }
  // 저택: 다마스크 벽지 + 아래쪽 나무 판벽
  const side = canvasTex(128, 256, (c, w, h) => {
    c.fillStyle = '#3a1f35'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(190,140,90,.13)';
    for (let y = 0; y < 170; y += 32) for (let x = (y / 32) % 2 * 16; x < w; x += 32) {
      c.beginPath(); c.moveTo(x, y + 4); c.quadraticCurveTo(x + 9, y + 14, x, y + 26); c.quadraticCurveTo(x - 9, y + 14, x, y + 4); c.fill();
    }
    c.fillStyle = '#3b2418'; c.fillRect(0, 170, w, h - 170);
    c.fillStyle = '#5a3a24'; c.fillRect(0, 166, w, 8);
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 3; c.strokeRect(8, 184, w / 2 - 14, 58); c.strokeRect(w / 2 + 6, 184, w / 2 - 14, 58);
  });
  const top = canvasTex(32, 32, (c, w, h) => { c.fillStyle = '#1a0f16'; c.fillRect(0, 0, w, h); });
  return { side, top, height: 2.6 };
}

export const bookTexture = () => canvasTex(128, 256, (c, w, h) => {
  c.fillStyle = '#2a170e'; c.fillRect(0, 0, w, h);
  const cols = ['#6a2430', '#24406a', '#4a6a24', '#6a4a24', '#40245e', '#7a5a30', '#2e5a52'];
  for (let s = 0; s < 5; s++) {
    let x = 6; const y0 = 8 + s * 49;
    while (x < w - 8) {
      const bw = 6 + Math.floor(hash(x, s) * 8), bh = 30 + hash(s, x) * 12;
      c.fillStyle = cols[Math.floor(hash(x * 3, s) * cols.length)]; c.fillRect(x, y0 + 40 - bh, bw - 1, bh);
      c.fillStyle = 'rgba(230,190,110,.35)'; c.fillRect(x + 1, y0 + 40 - bh + 6, bw - 3, 2);
      x += bw;
    }
    c.fillStyle = '#1a0e08'; c.fillRect(0, y0 + 40, w, 9);
  }
});

export const wardrobeTexture = () => canvasTex(128, 256, (c, w, h) => {
  c.fillStyle = '#3a2416'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#1f120a'; c.lineWidth = 5; c.strokeRect(6, 10, w / 2 - 9, h - 26); c.strokeRect(w / 2 + 3, 10, w / 2 - 9, h - 26);
  for (let k = 0; k < 40; k++) { c.fillStyle = `rgba(0,0,0,${hash(k, 2) * 0.15})`; c.fillRect(hash(k, 1) * w, 0, 1, h); }
  c.fillStyle = 'rgba(0,0,0,.8)'; for (let k = 0; k < 5; k++) { c.fillRect(18, 40 + k * 12, 34, 4); c.fillRect(w - 52, 40 + k * 12, 34, 4); }
  c.fillStyle = '#c99a4a'; c.beginPath(); c.arc(w / 2 - 10, h / 2, 4, 0, 7); c.arc(w / 2 + 10, h / 2, 4, 0, 7); c.fill();
});

// 찢어진 쪽지: 왼쪽·오른쪽 가장자리 색이 이웃 조각과 맞물린다
export function fragmentTexture(i, n, colors) {
  return canvasTex(160, 112, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.beginPath(); c.moveTo(14, 8);
    for (let x = 14; x <= w - 14; x += 10) c.lineTo(x, 8 + hash(x, i) * 6);
    for (let y = 8; y <= h - 8; y += 9) c.lineTo(w - 14 + (i < n - 1 ? hash(y, i + 1) * 10 - 5 : 0), y);
    for (let x = w - 14; x >= 14; x -= 10) c.lineTo(x, h - 8 - hash(x + 3, i) * 6);
    for (let y = h - 8; y >= 8; y -= 9) c.lineTo(14 + (i > 0 ? hash(y, i) * 10 - 5 : 0), y);
    c.closePath();
    c.fillStyle = '#f3e3bd'; c.fill();
    c.save(); c.clip();
    c.fillStyle = 'rgba(120,80,30,.18)'; for (let k = 0; k < 5; k++) c.fillRect(20, 26 + k * 14, w - 40, 3);
    if (i > 0) { c.fillStyle = colors[i]; c.fillRect(0, 0, 22, h); }
    if (i < n - 1) { c.fillStyle = colors[i + 1]; c.fillRect(w - 22, 0, 22, h); }
    c.restore();
    c.fillStyle = '#5a2c0a'; c.font = 'bold 40px "Do Hyeon", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', w / 2, h / 2 + 2);
  });
}

export function glowTexture(color = '255,200,120') {
  return canvasTex(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, `rgba(${color},1)`); g.addColorStop(0.35, `rgba(${color},.45)`); g.addColorStop(1, `rgba(${color},0)`);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}
