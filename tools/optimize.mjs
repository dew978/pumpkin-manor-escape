// Scenario 3D Collection 원본 GLB를 게임용으로 줄인다: 삼각형 목표치까지 단순화, 텍스처 축소(JPEG), 정리.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, flatten, join, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';

const SRC = 'D:/assets/scenario-3d-collection/';
const OUT = process.argv[2];
const index = JSON.parse(fs.readFileSync('assets_index.json', 'utf8'));

// [이름, 인덱스, 목표 삼각형 수, 텍스처 크기]
const PICKS = [
  ['boy', 821, 7000, 512], ['girl', 874, 7000, 512], ['redhood', 867, 7000, 512], ['tealgirl', 97, 7000, 512],
  ['reaper', 483, 9000, 512], ['knight', 618, 6000, 512], ['bat', 511, 8000, 512], ['spider', 1146, 8000, 512], ['plague', 504, 8000, 512],
  ['hourglass', 1123, 1500, 256], ['crystal', 858, 1500, 256], ['potion', 958, 1500, 256], ['lantern', 832, 2500, 256],
  ['chandelier', 782, 3000, 256], ['door', 761, 5000, 512], ['throne', 407, 3500, 512], ['barrel', 77, 1500, 256],
  ['chest', 1293, 2500, 256], ['chair', 1143, 2500, 256], ['book', 1177, 1500, 256], ['owl', 1160, 2500, 256],
  ['well', 440, 4000, 512], ['tree', 1302, 3000, 256], ['bench', 291, 2500, 512], ['scarecrow', 335, 4000, 512],
  ['cage', 218, 3000, 256], ['witchhat', 347, 2000, 256], ['skull', 350, 2000, 256],
];

// 정점 군집화: 격자 칸마다 정점 하나만 남기고 찌그러진 삼각형을 버린다. 격자를 점점 거칠게 해서 목표치에 맞춘다
function clusterSimplify(idx, posArr, wantTris) {
  const n = posArr.length / 3, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = posArr[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  let best = idx;
  for (const grid of [160, 128, 96, 72, 56, 44, 34, 26]) {
    const cell = span / grid, rep = new Map(), map = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const key = Math.floor((posArr[i * 3] - min[0]) / cell) + ',' + Math.floor((posArr[i * 3 + 1] - min[1]) / cell) + ',' + Math.floor((posArr[i * 3 + 2] - min[2]) / cell);
      let r = rep.get(key); if (r === undefined) { r = i; rep.set(key, i); } map[i] = r;
    }
    const out = [], seen = new Set();
    for (let t = 0; t < idx.length; t += 3) {
      const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]];
      if (a === b || b === c || a === c) continue;
      const k = [a, b, c].sort((x, y) => x - y).join(',');
      if (seen.has(k)) continue; seen.add(k); out.push(a, b, c);
    }
    best = new Uint32Array(out);
    if (out.length / 3 <= wantTris * 1.5) break;
  }
  return best;
}

const only = process.argv.slice(3);
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const [name, idx, target, tex] of PICKS) {
  if (only.length && !only.includes(name)) continue;
  const rel = index[idx].glbs[0].path;
  const doc = await io.read(path.join(SRC, rel));
  const count = () => {
    let t = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const ix = p.getIndices(), pos = p.getAttribute('POSITION');
      t += (ix ? ix.getCount() : pos.getCount()) / 3;
    }
    return Math.round(t);
  };
  const before = count();
  await doc.transform(dedup(), flatten(), join(), weld());
  const ratio = Math.min(1, target / Math.max(1, count()));
  // 오차 한도를 조금씩 늘려 가며 목표치 근처까지 줄인다
  for (const err of [0.01, 0.03, 0.08, 0.2, 0.5]) {
    if (count() <= target * 1.3) break;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, target / count()), error: err }));
  }
  // 작은 조각이 수없이 붙은 모델은 위 방식이 멈추므로 위상을 무시하는 sloppy 단순화로 마무리
  if (count() > target * 2) {
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const ix = p.getIndices(), pos = p.getAttribute('POSITION'); if (!ix) continue;
      const share = ix.getCount() / 3 / count();
      const want = Math.max(300, Math.floor(target * share));
      ix.setArray(clusterSimplify(ix.getArray(), pos.getArray(), want));
      compactPrimitive(p);
    }
  }
  // gltf-transform의 textureCompress가 일부 텍스처(16비트·흑백)에서 sharp 색공간 오류를 내서 직접 줄인다
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage(); if (!img) continue;
    let out;
    try {
      out = await sharp(Buffer.from(img)).resize(tex, tex, { fit: 'inside', withoutEnlargement: true })
        .removeAlpha().jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    } catch (e) {
      // sharp가 못 여는 16비트 텍스처는 ffmpeg로 변환
      const tin = path.join('tmp_tex', 'in.bin'), tout = path.join('tmp_tex', 'out.jpg');
      fs.mkdirSync('tmp_tex', { recursive: true }); fs.writeFileSync(tin, img); fs.rmSync(tout, { force: true });
      try { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tin, '-vf', `scale=${tex}:${tex}:force_original_aspect_ratio=decrease`, '-pix_fmt', 'yuvj444p', '-q:v', '4', tout], { stdio: 'ignore' }); } catch (e2) { /* 아래에서 대체 */ }
      out = fs.existsSync(tout) ? fs.readFileSync(tout)
        : await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
      if (!fs.existsSync(tout)) console.log('  (텍스처 하나를 읽지 못해 회색으로 대체)');
    }
    t.setImage(new Uint8Array(out)).setMimeType('image/jpeg');
    if (t.getURI()) t.setURI(t.getURI().replace(/\.\w+$/, '.jpg'));
  }
  await doc.transform(prune());
  // 투명 PNG가 jpeg로 바뀌면 알파가 사라지므로 BLEND 재질은 OPAQUE로 고정(생성 모델은 대부분 불투명)
  for (const m of doc.getRoot().listMaterials()) if (m.getAlphaMode() === 'BLEND') m.setAlphaMode('OPAQUE');
  const file = path.join(OUT, name + '.glb');
  await io.write(file, doc);
  const after = count();
  report.push(`${name.padEnd(11)} #${String(idx).padEnd(5)} tris ${String(before).padStart(7)} -> ${String(after).padStart(6)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  console.log(report.at(-1));
}
