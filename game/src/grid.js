// 지도 격자: 칸 (c, r)의 중심이 월드 좌표 (x = c, z = r).
import { SOLID } from './config.js';

export function parseMap(rows) {
  const H = rows.length, W = rows[0].length;
  const cells = [], spots = { f: [], i: [], H: [], X: [], P: [], E: [], c: [], mon: [], deco: [] };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = rows[r][c] || '#';
    cells.push(ch);
    if (ch === 'f' || ch === 'i' || ch === 'H' || ch === 'X' || ch === 'P' || ch === 'E' || ch === 'c') spots[ch].push({ c, r });
    if ('rkvxd'.includes(ch)) spots.mon.push({ c, r, ch });
  }
  return {
    W, H, cells, spots,
    at(c, r) { return c < 0 || r < 0 || c >= W || r >= H ? '#' : cells[r * W + c]; },
    solid(c, r) { return SOLID.has(this.at(c, r)); },
  };
}

export const tileOf = (x, z) => ({ c: Math.round(x), r: Math.round(z) });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function bfs(g, from, to, pass, maxNodes = 2500) {
  if (from.c === to.c && from.r === to.r) return [];
  if (!pass(to.c, to.r)) return null;
  const W = g.W, key = (c, r) => r * W + c;
  const prev = new Map([[key(from.c, from.r), -1]]);
  const q = [from]; let head = 0;
  while (head < q.length && head < maxNodes) {
    const cur = q[head++];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = cur.c + dc, r = cur.r + dr, k = key(c, r);
      if (prev.has(k) || !pass(c, r)) continue;
      prev.set(k, key(cur.c, cur.r));
      if (c === to.c && r === to.r) {
        const path = []; let kk = k;
        while (kk !== key(from.c, from.r)) { path.push({ c: kk % W, r: Math.floor(kk / W) }); kk = prev.get(kk); }
        return path.reverse();
      }
      q.push({ c, r });
    }
  }
  return null;
}

export function lineOfSight(g, a, b) {
  const d = dist(a, b), n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) {
    const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
    if (g.solid(Math.round(x), Math.round(z))) return false;
  }
  return true;
}

export function collides(g, x, z, rad) {
  const c0 = Math.floor(x - rad + 0.5), c1 = Math.floor(x + rad + 0.5), r0 = Math.floor(z - rad + 0.5), r1 = Math.floor(z + rad + 0.5);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (!g.solid(c, r)) continue;
    const nx = Math.max(c - 0.5, Math.min(x, c + 0.5)), nz = Math.max(r - 0.5, Math.min(z, r + 0.5));
    if ((x - nx) ** 2 + (z - nz) ** 2 < rad * rad) return true;
  }
  return false;
}
export function slideMove(g, ent, dx, dz, rad) {
  if (!collides(g, ent.x + dx, ent.z, rad)) ent.x += dx;
  if (!collides(g, ent.x, ent.z + dz, rad)) ent.z += dz;
}
export function followPath(ent, speed, dt) {
  if (!ent.path || !ent.path.length) return false;
  const n = ent.path[0], dx = n.c - ent.x, dz = n.r - ent.z, d = Math.hypot(dx, dz), step = speed * dt;
  if (d <= step) { ent.x = n.c; ent.z = n.r; ent.path.shift(); } else { ent.x += dx / d * step; ent.z += dz / d * step; }
  if (d > 0.001) ent.face = Math.atan2(dx, dz);
  return true;
}
export const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// 시드 난수(방장이 정한 배치를 모두가 같게 볼 필요는 없지만, 다시 하기에서 배치를 바꾸려고 씀)
export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
