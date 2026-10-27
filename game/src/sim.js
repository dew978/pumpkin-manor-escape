// 방장 기기에서만 도는 판정: 괴물 AI, 잡기·새장·구출, 숨기, 쪽지 조각, 퍼즐, 시간.
// 학생 위치는 각 기기가 보내 준 값을 그대로 믿는다(교실용이라 부정행위 방지는 하지 않음).
import { STAGES, MONSTERS, PLAYER_SPEED, DIFF_SPEED, CANDY_PER_FLOOR, monsterSpots, SEARCHABLE, SEARCH_CODES, SEARCH_SPOTS, SEARCH_LOCK } from './config.js';
import { josa } from './util.js';
import { parseMap, tileOf, dist, bfs, lineOfSight, slideMove, followPath, angleDiff, rng } from './grid.js';

const ITEM_CODES = ['time', 'crystal', 'potion'];
export const STATE_CODES = { patrol: 0, alert: 1, chase: 2, search: 3, rest: 4, lunge: 5, windup: 6, blind: 7, lured: 8, eat: 9 };
// 사탕 던지기: 이만큼 멀리 던지고, 떨어진 곳에서 이 거리 안의 괴물이 사탕을 먹으러 간다
export const THROW_RANGE = 7, LURE_R = 6, EAT_T = 4.5, THROW_FLY = 0.55;

export class Sim {
  constructor({ stageIdx, puzzle, chestQuiz = [], roster, diff = 'easy', seed = Date.now() }) {
    this.stageIdx = stageIdx;
    this.stage = STAGES[stageIdx];
    this.g = parseMap(this.stage.map);
    this.puzzle = puzzle;
    this.rand = rng(seed);
    this.diff = DIFF_SPEED[diff] ?? 1; this.diffKey = diff;
    this.solo = roster.length === 1;
    this.phase = 'play';
    this.overReason = '';
    this.time = this.stage.time;
    this.elapsed = 0;
    this.events = [];
    this.stats = { caught: 0, stolen: 0, wrong: 0, items: 0, candy: 0, chestOk: 0 };
    const sp = this.g.spots;
    this.spawn = sp.P[0];
    this.exitTiles = sp.E.map(e => ({ c: e.c, r: e.r + 1 }));
    this.cages = sp.X.map(x => ({ c: x.c, r: x.r, rescueT: 0 }));
    this.wardrobes = sp.H.map(h => ({ c: h.c, r: h.r }));

    const offs = [[0, 0], [1, 0], [-1, 0], [0, 1]];
    this.players = new Map();
    roster.forEach((p, i) => {
      const o = offs[i % offs.length];
      this.players.set(p.slot, { slot: p.slot, name: p.name, char: p.char, x: this.spawn.c + o[0], z: this.spawn.r + o[1], face: Math.PI, moving: false,
        hidden: -1, hideT: 0, caged: -1, escaped: false, invuln: 2, item: null, fastT: 0, candy: 0, throwT: 0, peekT: 0, tp: { seq: 1, x: this.spawn.c + o[0], z: this.spawn.r + o[1] } });
    });

    // 쪽지 찾기: 뒤질 수 있는 가구(옆에 설 바닥이 있는 칸) 중 서로 떨어진 10곳을 고르고,
    // 그중 서로·시작 위치와 가장 멀리 흩어진 4곳에 진짜 쪽지를 넣는다. 나머지 6곳은 꽝(작은 보상)
    // 시작 위치에서 걸어갈 수 있는 바닥만 '옆에 설 곳'으로 친다(가구에 갇힌 작은 빈칸은 빼고)
    const g = this.g, reach = new Set([this.spawn.r * g.W + this.spawn.c]), q = [this.spawn];
    while (q.length) {
      const t = q.shift();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = t.c + dc, r = t.r + dr, k = r * g.W + c;
        if (!reach.has(k) && !g.solid(c, r) && c > 0 && r > 0 && c < g.W - 1 && r < g.H - 1) { reach.add(k); q.push({ c, r }); }
      }
    }
    this.reach = reach;
    const open = (c, r) => reach.has(r * g.W + c);
    const cand = [];
    for (let r = 1; r < g.H - 1; r++) for (let c = 1; c < g.W - 1; c++) {
      if (!SEARCHABLE[g.at(c, r)] || Math.hypot(c - this.spawn.c, r - this.spawn.r) < 4) continue;
      if (open(c + 1, r) || open(c - 1, r) || open(c, r + 1) || open(c, r - 1)) cand.push({ c, r, ch: g.at(c, r) });
    }
    this.shuffle(cand);
    const picked = [];
    for (const gap of [5, 4, 3, 2]) {
      for (const t of cand) if (picked.length < SEARCH_SPOTS && !picked.includes(t) && picked.every(o => Math.hypot(o.c - t.c, o.r - t.r) >= gap)) picked.push(t);
      if (picked.length >= SEARCH_SPOTS) break;
    }
    this.spots = picked.map((t, id) => ({ id, c: t.c, r: t.r, ch: t.ch, searched: false, frag: -1, lockT: 0 }));
    const real = [];
    const score = s => Math.min(Math.hypot(s.c - this.spawn.c, s.r - this.spawn.r) * 0.6, ...real.map(o => Math.hypot(o.c - s.c, o.r - s.r))) + this.rand() * 3;
    while (real.length < puzzle.parts.length && real.length < this.spots.length) {
      const best = this.spots.filter(s => !real.includes(s)).sort((a, b) => score(b) - score(a))[0]; real.push(best);
    }
    this.fragments = puzzle.parts.map((_, i) => { const s = real[i]; s.frag = i; return { id: i, x: s.c, z: s.r, taken: false, spot: s.id }; });
    // 아이템: 후보 칸마다 하나, 모래시계가 가장 많다
    this.items = this.shuffle(sp.i.slice()).map((s, i) => ({ id: i, type: ['time', 'crystal', 'potion', 'time', 'crystal', 'time'][i % 6], x: s.c, z: s.r, taken: false }));
    this.pz = { have: new Set(), assembled: false, open: false, wrong: 0 };
    // 호박 상자: 다가가 문제를 맞히면 아이템. 상자마다 한 번만 열린다
    this.chests = sp.c.map((s, i) => ({ id: i, c: s.c, r: s.r, opened: false }));
    // 사탕: 시작 위치에서 떨어진 빈 바닥에 서로 떨어뜨려 흩어 둔다(점수·별)
    const used = new Set([...sp.f, ...sp.i, ...sp.P].map(t => t.r * this.g.W + t.c)), free = [];
    for (let r = 1; r < this.g.H - 1; r++) for (let c = 1; c < this.g.W - 1; c++) {
      if (this.g.at(c, r) !== '.' || used.has(r * this.g.W + c) || Math.hypot(c - this.spawn.c, r - this.spawn.r) < 4) continue;
      free.push({ c, r });
    }
    this.candies = [];
    this.lures = []; this.lureSeq = 0; this.candyTip = new Set();   // 던진 사탕(괴물 꾀기)
    for (const t of this.shuffle(free)) {
      if (this.candies.length >= CANDY_PER_FLOOR) break;
      if (this.candies.some(o => Math.hypot(o.x - t.c, o.z - t.r) < 5)) continue;
      this.candies.push({ x: t.c, z: t.r, taken: false });
    }

    this.monsters = monsterSpots(sp, diff).map((s, id) => {
      const spec = MONSTERS[s.ch];
      return { id, ch: s.ch, spec, x: s.c, z: s.r, face: this.rand() * 6.28, state: 'patrol', path: [], target: -1, lastSeen: null,
        // 층이 시작하면 괴물은 6초쯤 기다린다(아이들이 주변을 살필 시간)
        alertT: 0, lostT: 0, chaseT: 0, repathT: 0, restT: 6 + id * 1.5, searchT: 0, lungeT: 0, lungeDir: null, blindT: 0, shoutT: 0, sawHide: -1, growlT: 3 + this.rand() * 5 };
    });
  }

  d2(a, b) { return (a.c - b.c) ** 2 + (a.r - b.r) ** 2; }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  ev(e) { this.events.push(e); }
  toast(msg, slot = -1) { this.ev({ k: 'toast', msg, slot }); }
  snd(n, x, z, slot = -1) { this.ev({ k: 'snd', n, x, z, slot }); }
  teleport(p, x, z) { p.x = x; p.z = z; p.tp = { seq: p.tp.seq + 1, x, z }; }
  active(p) { return p.hidden < 0 && p.caged < 0 && !p.escaped && p.invuln <= 0; }
  pass = (c, r) => !this.g.solid(c, r);

  // 각 기기가 보내는 내 위치
  setPlayer(slot, x, z, face, moving) {
    const p = this.players.get(slot); if (!p || p.caged >= 0 || p.escaped || p.hidden >= 0) return;
    p.x = x; p.z = z; p.face = face; p.moving = moving;
  }
  removePlayer(slot) { this.players.delete(slot); }

  input(slot, m) {
    const p = this.players.get(slot); if (!p || this.phase !== 'play') return;
    if (m.t === 'hide') this.toggleHide(p);
    else if (m.t === 'use') this.useItem(p);
    else if (m.t === 'arrange') this.arrange(p, m.order);
    else if (m.t === 'answer') this.answer(p, String(m.v ?? ''));
    else if (m.t === 'chest') this.openChest(p, m.id | 0, !!m.ok);
    else if (m.t === 'throw') this.throwCandy(p, +m.x, +m.z);
    else if (m.t === 'take') this.takeItem(p, m.id | 0);
    else if (m.t === 'search') this.search(p, m.id | 0, !!m.ok);
    else if (m.t === 'peek') this.peek(p, m.id | 0);
  }

  toggleHide(p) {
    if (p.hidden >= 0) { p.hidden = -1; p.invuln = 0.6; this.snd('door_open', p.x, p.z); return; }
    if (p.caged >= 0 || p.escaped) return;
    let best = -1, bd = 1.45;
    this.wardrobes.forEach((w, i) => { const d = Math.hypot(w.c - p.x, w.r - p.z); if (d < bd && ![...this.players.values()].some(o => o.hidden === i)) { bd = d; best = i; } });
    if (best < 0) return;
    p.hidden = best; p.hideT = 0; p.moving = false;
    this.snd('door_open', p.x, p.z);
    // 쫓기던 중 괴물이 숨는 걸 봤으면 그 괴물은 옷장을 연다
    for (const m of this.monsters) if (m.state === 'chase' && m.target === p.slot && m.lostT < 0.4 && dist(m, p) < m.spec.sight) m.sawHide = p.slot;
  }

  useItem(p) {
    if (!p.item || !this.active(p) && p.hidden < 0) return;
    const it = p.item; p.item = null; this.stats.items++;
    if (it === 'crystal') {
      let n = 0;
      for (const m of this.monsters) if (dist(m, p) < 8) { m.blindT = 6; m.state = 'patrol'; m.path = []; m.target = -1; n++; }
      this.snd('pickup', p.x, p.z); this.toast(n ? `🔮 수정구가 번쩍! 괴물 ${n}마리가 6초 동안 앞을 못 봐요` : '🔮 수정구가 번쩍! 근처엔 괴물이 없었어요', p.slot);
      this.ev({ k: 'flash', x: p.x, z: p.z });
    } else if (it === 'potion') {
      p.fastT = 5; this.toast('🧪 날쌘 물약! 5초 동안 빨라져요', p.slot); this.snd('pickup', p.x, p.z);
    }
  }

  // 가구 뒤지기: 각 기기에서 문제를 풀고 결과를 보낸다. 맞히면 뒤지고(진짜면 쪽지, 꽝이면 사탕·시간·웃긴 말),
  // 틀리면 그 가구가 잠깐 잠긴다(모두에게 똑같이). 문제를 푸는 동안 조금 움직여도 되게 거리는 넉넉히 본다
  // 가구 문제를 푸는 동안은 가구 뒤에 몸을 숙인다: 괴물 눈에 덜 띈다(보이는 거리 절반). 움직이면 풀린다
  peek(p, id) {
    const s = this.spots[id];
    p.peekT = s && !s.searched && !(s.lockT > 0) && p.caged < 0 && !p.escaped && Math.hypot(s.c - p.x, s.r - p.z) <= 2.4 ? 15 : 0;
  }
  search(p, id, ok) {
    const s = this.spots[id];
    if (!s || s.searched || s.lockT > 0 || p.caged >= 0 || p.escaped || p.hidden >= 0 || Math.hypot(s.c - p.x, s.r - p.z) > 2.4) return;
    p.peekT = 0;
    const [icon, name] = SEARCHABLE[s.ch] || ['🔍', '가구'];
    if (!ok) {
      s.lockT = SEARCH_LOCK; this.snd('cage', s.c, s.r, p.slot);
      this.toast(`🔒 ${josa(name, '이가')} ${SEARCH_LOCK}초 동안 잠겼어요. 다시 오면 다른 문제가 나와요`, p.slot);
      return;
    }
    s.searched = true;
    const f = s.frag >= 0 ? this.fragments[s.frag] : null;
    if (f && !f.taken) {
      f.taken = true; s.frag = -1; this.pz.have.add(f.id); this.snd('paper', p.x, p.z);
      // 화면 아래 대사창: 주운 아이가 쪽지 글을 읽고 루미가 이야기를 잇는다
      this.ev({ k: 'frag', slot: p.slot, id: f.id, n: this.pz.have.size, spot: id });
      return;
    }
    const roll = this.rand();
    if (roll < 0.5) { p.candy++; this.snd('pickup', p.x, p.z, p.slot); this.toast(`${icon} ${name}에서 사탕 1개를 찾았어요! 쪽지는 없었어요`, p.slot); }
    else if (roll < 0.75) { this.time += 10; this.snd('pickup', p.x, p.z, p.slot); this.toast(`${icon} ${name} 속에 반짝이는 모래가… 시간 +10초! 쪽지는 없었어요`, p.slot); }
    else {
      const jokes = [`${name}에는 거미줄뿐이에요`, `${name}에는 먼지만 가득해요`, `${name}에는 낡은 양말 한 짝뿐이에요`, `${name} 뒤에서 박쥐가 푸드덕 날아갔어요`];
      this.snd('paper', p.x, p.z, p.slot); this.toast(`${icon} ${jokes[Math.floor(this.rand() * jokes.length)]}. 다른 곳을 찾아봐요`, p.slot);
    }
    this.ev({ k: 'searched', slot: p.slot, spot: id });
  }

  // 아이템 줍기: 가까이 가서 상호작용(E·터치). 수정구·물약은 한 칸이라, 손에 든 것이 있으면 그 자리에 내려놓고 바꾼다
  takeItem(p, id) {
    const it = this.items[id];
    if (!it || it.taken || p.caged >= 0 || p.escaped || p.hidden >= 0 || Math.hypot(it.x - p.x, it.z - p.z) > 1.4) return;
    if (it.type === 'time') { it.taken = true; this.time += 30; this.snd('pickup', p.x, p.z); this.toast(`⏳ ${josa(p.name, '이가')} 모래시계를 주웠어요! 시간 +30초`); return; }
    const old = p.item; p.item = it.type; this.snd('pickup', p.x, p.z, p.slot);
    if (old) it.type = old; else it.taken = true;
    this.toast(p.item === 'crystal' ? `🔮 수정구를 주웠어요${old ? ` (${old === 'potion' ? '날쌘 물약' : '수정구'}은 내려놓았어요)` : ''}. 쓰면 가까운 괴물이 6초 동안 앞을 못 봐요`
      : `🧪 날쌘 물약을 주웠어요${old ? ` (${old === 'crystal' ? '수정구' : '날쌘 물약'}는 내려놓았어요)` : ''}. 쓰면 5초 동안 빨라져요`, p.slot);
  }

  // 사탕 던지기: 겨눈 곳(최대 THROW_RANGE칸)으로 날아간다
  throwCandy(p, tx, tz) {
    if (p.candy <= 0 || p.throwT > 0 || p.caged >= 0 || p.escaped || p.hidden >= 0 || !Number.isFinite(tx) || !Number.isFinite(tz)) return;
    let dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.3) { dx = Math.sin(p.face); dz = Math.cos(p.face); d = 1; tx = p.x + dx * 3; tz = p.z + dz * 3; }
    const ux = dx / d, uz = dz / d, far = Math.min(Math.hypot(tx - p.x, tz - p.z), THROW_RANGE);
    // 포물선으로 날아가 벽·가구도 넘어간다. 떨어질 자리가 벽이나 가구면 내 쪽으로 가장 가까운 바닥에 떨어진다
    let ex = p.x, ez = p.z;
    for (let k = far; k > 0; k -= 0.25) {
      const x = p.x + ux * k, z = p.z + uz * k, t = tileOf(x, z);
      if (!this.g.solid(t.c, t.r)) { const b = k < far ? Math.min(0.3, k) : 0; ex = x - ux * b; ez = z - uz * b; break; }
    }
    p.candy--; p.throwT = 0.6;
    const L = { id: ++this.lureSeq, x: +ex.toFixed(2), z: +ez.toFixed(2), fly: THROW_FLY, life: 12, gone: false, by: p.slot };
    this.lures.push(L);
    this.ev({ k: 'throw', id: L.id, x0: +p.x.toFixed(2), z0: +p.z.toFixed(2), x1: L.x, z1: L.z, dur: THROW_FLY });
  }

  // 사탕이 땅에 닿으면 가까운 괴물(돌진 중인 거미와 눈먼 괴물은 빼고)이 쫓던 것을 멈추고 사탕으로 간다
  landLure(L) {
    let n = 0;
    for (const m of this.monsters) {
      if (m.blindT > 0 || m.state === 'eat' || m.state === 'lunge' || Math.hypot(m.x - L.x, m.z - L.z) > LURE_R) continue;
      if (m.state === 'lured') { const cur = this.lures.find(o => o.id === m.lure && !o.gone); if (cur && dist(m, cur) <= dist(m, L)) continue; }
      m.state = 'lured'; m.lure = L.id; m.path = []; m.repathT = 0; m.target = -1; m.sawHide = -1; m.restT = 0; n++;
    }
    this.snd('pickup', L.x, L.z);
    this.toast(n ? `🍬 괴물 ${n}마리가 사탕 냄새를 맡았어요! 지금 피해요` : '🍬 사탕을 던졌어요. 근처에는 괴물이 없었어요', L.by);
  }

  // 사탕으로 가는 괴물·먹는 괴물. 이동 중에는 학생을 잡지 않는다
  stepLured(m, dt) {
    const s = m.spec;
    if (m.state === 'eat') { m.eatT -= dt; if (m.eatT <= 0) { m.state = 'patrol'; m.path = []; m.ignoreT = 2.5; } return; }
    const L = this.lures.find(o => o.id === m.lure && !o.gone && o.fly <= 0);
    if (!L) { m.state = 'search'; m.searchT = 1.5; m.path = []; return; }   // 다른 괴물이 먼저 먹었다
    const dx = L.x - m.x, dz = L.z - m.z, d = Math.hypot(dx, dz);
    if (d < 0.7) {
      L.gone = true; m.state = 'eat'; m.eatT = EAT_T; m.face = Math.atan2(dx, dz);
      this.ev({ k: 'eat', id: L.id, x: L.x, z: L.z });
      return;
    }
    const spd = (s.flies ? s.walk * 1.4 : Math.min(s.run, 2.8)) * this.diff;
    if (s.flies) { m.x += dx / d * spd * dt; m.z += dz / d * spd * dt; m.face = Math.atan2(dx, dz); return; }
    if (d < 1.5) { slideMove(this.g, m, dx / d * spd * dt, dz / d * spd * dt, 0.3); m.face = Math.atan2(dx, dz); return; }
    m.repathT -= dt;
    if (m.repathT <= 0 || !m.path.length) {
      m.repathT = 0.5; m.path = bfs(this.g, tileOf(m.x, m.z), tileOf(L.x, L.z), this.pass) || [];
      if (!m.path.length) { m.state = 'patrol'; return; }   // 갈 수 없는 곳이면 포기
    }
    followPath(m, spd, dt);
  }

  arrange(p, order) {
    if (this.pz.assembled || this.pz.have.size < this.puzzle.parts.length) return;
    if (Array.isArray(order) && order.length === this.puzzle.parts.length && order.every((v, i) => v === i)) {
      this.pz.assembled = true; this.snd('paper', p.x, p.z);
      this.toast(`📜 ${josa(p.name, '이가')} 쪽지를 맞췄어요! 이제 문제를 풀어요`);
    } else this.ev({ k: 'arrangeWrong', slot: p.slot });
  }

  answer(p, v) {
    if (!this.pz.assembled || this.pz.open) return;
    // 보기 고르기: 고른 보기 글이 정답 글과 같은지
    const norm = s => String(s).replace(/\s/g, '');
    const ok = norm(v) === norm(this.puzzle.answer);
    if (ok) {
      this.pz.open = true;
      // 문이 열리는 장면(약 3초) 동안은 아무도 잡히지 않는다
      for (const o of this.players.values()) o.invuln = Math.max(o.invuln, 4);
      this.ev({ k: 'open', name: p.name }); this.snd('gate', this.exitTiles[0].c, this.exitTiles[0].r);
      this.toast(`🚪 ${josa(p.name, '이가')} 정답! 탈출문이 열렸어요. 북쪽 문으로 달려요!`);
    } else {
      const pen = this.diffKey === 'easy' ? 5 : 10;
      this.pz.wrong++; this.stats.wrong++; this.time -= pen;
      this.ev({ k: 'answerWrong', slot: p.slot, v });
      this.toast(`❌ "${v}"은(는) 정답이 아니에요. 시간 −${pen}초 · 힌트를 보세요`);
    }
  }

  catchPlayer(p, m) {
    this.stats.caught++;
    this.snd('caught', p.x, p.z);
    // 잡은 괴물은 그 자리를 떠난다(같은 곳에서 계속 잡히지 않게)
    m.state = 'rest'; m.restT = 2; m.path = []; m.target = -1; m.sawHide = -1; m.ignoreT = 8;
    let msg = `💀 ${josa(p.name, '이가')} ${m.spec.name}에게 잡혔어요!`;
    // 확실한 불이익 1: 모은 쪽지 하나를 빼앗겨 다시 숨겨진다
    // (느림에서는 빼앗지 않는다: 저학년이 다시 찾느라 지치지 않게)
    if (this.diffKey !== 'easy' && !this.pz.assembled && this.pz.have.size > 0) {
      const ids = [...this.pz.have]; const id = ids[Math.floor(this.rand() * ids.length)];
      this.pz.have.delete(id);
      let pool = this.spots.filter(s => !s.searched && s.frag < 0);
      if (!pool.length) pool = this.spots.filter(s => s.frag < 0);
      // 가구마다 문제를 풀어야 하니 너무 먼 곳만 고르지 않는다(남은 꽝 가구 중 아무 곳)
      const far = pool[Math.floor(this.rand() * pool.length)];
      far.searched = false; far.frag = id; far.lockT = 0;
      const f = this.fragments[id]; f.taken = false; f.x = far.c; f.z = far.r; f.spot = far.id; this.stats.stolen++;
      msg += ` 쪽지 조각 하나를 빼앗겼어요`;
    }
    if (p.hidden >= 0) p.hidden = -1;
    if (this.solo) {
      // 혼자일 때 불이익 2: 시작 위치로, 시간 −10초
      this.time -= 10; p.invuln = 3; this.teleport(p, this.spawn.c, this.spawn.r);
      msg += ' 처음 자리로 돌아가요 · 시간 −10초';
    } else {
      // 협동일 때 불이익 2: 새장에 갇힌다. 친구가 새장 옆에 1.5초 서 있으면 풀려난다
      const cg = this.cages[0];
      p.caged = 0; this.teleport(p, cg.c, cg.r); this.snd('cage', cg.c, cg.r);
      msg += ' 새장에 갇혔어요. 친구가 구해 줘야 해요!';
      const free = [...this.players.values()].filter(o => o.caged < 0 && !o.escaped);
      if (!free.length) this.gameOver('caught');
    }
    this.toast(msg);
    this.ev({ k: 'caught', slot: p.slot, x: p.x, z: p.z });
  }

  openChest(p, id, ok) {
    const ch = this.chests[id]; if (!ch || ch.opened || p.caged >= 0 || p.escaped) return;
    if (Math.hypot(ch.c - p.x, ch.r - p.z) > 1.9) return;
    ch.opened = true;
    if (!ok) { this.toast('🎃 상자가 "땡!" 하고 잠겼어요. 다른 상자를 찾아봐요', p.slot); this.snd('cage', ch.c, ch.r, p.slot); return; }
    this.stats.chestOk++; this.snd('pickup', ch.c, ch.r);
    if (!p.item) {
      p.item = this.rand() < 0.5 ? 'crystal' : 'potion';
      this.toast(p.item === 'crystal' ? '🎃 정답! 상자에서 🔮 수정구가 나왔어요 (Q로 쓰기)' : '🎃 정답! 상자에서 🧪 날쌘 물약이 나왔어요 (Q로 쓰기)', p.slot);
    } else { this.time += 20; this.toast(`🎃 ${josa(p.name, '이가')} 상자 문제를 맞혔어요! 시간 +20초`); }
  }

  gameOver(reason) { if (this.phase !== 'play') return; this.phase = 'over'; this.overReason = reason; this.snd('bell', 0, 0); }

  perceive(m, p) {
    const d = dist(m, p), s = m.spec;
    if (d < s.hear * (p.moving ? 1 : 0.55)) return true;
    if (d > s.sight * this.diff * (p.peekT > 0 ? 0.5 : 1)) return false;
    if (s.fov < 6 && Math.abs(angleDiff(m.face, Math.atan2(p.x - m.x, p.z - m.z))) > s.fov / 2) return false;
    return s.flies || lineOfSight(this.g, m, p);
  }

  wander(m, radius = 9) {
    const t0 = tileOf(m.x, m.z);
    for (let k = 0; k < 12; k++) {
      const c = t0.c + Math.floor(this.rand() * (radius * 2 + 1)) - radius, r = t0.r + Math.floor(this.rand() * (radius * 2 + 1)) - radius;
      if (this.g.solid(c, r)) continue;
      const path = bfs(this.g, t0, { c, r }, this.pass);
      if (path && path.length > 2) { m.path = path; return; }
    }
    m.path = [];
  }

  alertOthers(src, x, z) {
    for (const o of this.monsters) {
      if (o === src || o.blindT > 0 || o.state === 'chase' || o.state === 'rest' || Math.hypot(o.x - x, o.z - z) > 13) continue;
      o.state = 'search'; o.lastSeen = { x, z }; o.searchT = 0;
      o.path = o.spec.flies ? [] : (bfs(this.g, tileOf(o.x, o.z), tileOf(x, z), this.pass) || []);
    }
  }

  stepMonster(m, dt) {
    const s = m.spec;
    if (m.restT > 0) { m.restT -= dt; if (m.restT <= 0 && m.state === 'rest') { m.state = 'patrol'; m.path = []; } return; }
    if (m.state === 'rest') { m.state = 'patrol'; m.path = []; }   // 쉬기가 끝나면 다시 돌아다닌다(예전에는 굳은 채 길을 막았다)
    if (m.blindT > 0) {
      m.blindT -= dt;
      if (!followPath(m, s.walk * 0.6, dt)) this.wander(m, 3);
      return;
    }
    if (m.state === 'lured' || m.state === 'eat') { this.stepLured(m, dt); return; }
    m.growlT -= dt;
    if (m.growlT <= 0) { m.growlT = 6 + this.rand() * 8; this.snd(m.ch === 'x' ? 'skitter' : m.ch === 'v' ? 'screech' : 'growl', m.x, m.z); }

    // 옷장으로 숨는 걸 본 괴물: 옷장까지 가서 연다
    if (m.sawHide >= 0) {
      const p = this.players.get(m.sawHide);
      if (!p || p.hidden < 0) m.sawHide = -1;
      else {
        const w = this.wardrobes[p.hidden];
        if (Math.hypot(w.c - m.x, w.r - m.z) < 1.4) { this.catchPlayer(p, m); return; }
        m.repathT -= dt;
        if (m.repathT <= 0) {
          m.repathT = 0.4;
          const near = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dc, dr]) => ({ c: w.c + dc, r: w.r + dr })).find(t => !this.g.solid(t.c, t.r));
          m.path = near ? bfs(this.g, tileOf(m.x, m.z), near, this.pass) || [] : [];
        }
        followPath(m, s.run * this.diff, dt); m.state = 'chase';
        return;
      }
    }

    // 감지
    let seen = null, bd = 1e9;
    if (m.ignoreT > 0) m.ignoreT -= dt;   // 지쳐서 포기한 뒤 잠깐은 학생을 못 본 척 지나간다
    else for (const p of this.players.values()) {
      if (!this.active(p) || !this.perceive(m, p)) continue;
      const d = dist(m, p); if (d < bd) { bd = d; seen = p; }
    }

    if (s.flies) { this.stepBat(m, dt, seen); return; }
    if (s.lunge && this.stepSpider(m, dt, seen)) return;

    if (seen && (m.state === 'patrol' || m.state === 'search')) {
      m.state = 'alert'; m.alertT = 0.45; m.target = seen.slot; m.path = [];
      this.snd('spotted', m.x, m.z, seen.slot);
      if (s.shout) { this.alertOthers(m, seen.x, seen.z); this.snd('growl', m.x, m.z); }
    }
    if (m.state === 'chase' || m.state === 'alert') {
      const p = this.players.get(m.target);
      if (!p || p.caged >= 0 || p.escaped) { m.state = 'patrol'; m.path = []; return; }
      if (seen === p || (p.hidden < 0 && this.perceive(m, p))) { m.lastSeen = { x: p.x, z: p.z }; m.lostT = 0; }
      else m.lostT += dt;
    }
    switch (m.state) {
      case 'patrol':
        if (!followPath(m, s.walk * this.diff, dt)) this.wander(m);
        break;
      case 'alert':
        m.alertT -= dt; if (m.lastSeen) m.face = Math.atan2(m.lastSeen.x - m.x, m.lastSeen.z - m.z);
        if (m.alertT <= 0) { m.state = 'chase'; m.chaseT = 0; m.repathT = 0; }
        break;
      case 'chase': {
        const p = this.players.get(m.target);
        m.chaseT += dt;
        const spd = s.run * this.diff * (1 + Math.min(0.15, m.chaseT * s.accel));
        // 지치기: 너무 오래 쫓으면 포기하고 쉬었다가 다른 곳으로 간다(아이들이 끝없이 쫓기지 않게)
        if (m.chaseT > (this.diffKey === 'easy' ? 7 : 10)) {
          m.state = 'rest'; m.restT = 2.5; m.target = -1; m.path = []; m.ignoreT = 6;
          this.ev({ k: 'tired', x: m.x, z: m.z });
          break;
        }
        if (m.lostT > 1.3 || !p || p.hidden >= 0 || p.invuln > 0.5) {
          m.state = 'search'; m.searchT = 0;
          m.path = m.lastSeen ? (bfs(this.g, tileOf(m.x, m.z), tileOf(m.lastSeen.x, m.lastSeen.z), this.pass) || []) : [];
          break;
        }
        const d = dist(m, p);
        if (d < 1.8 && lineOfSight(this.g, m, p)) {
          const dx = p.x - m.x, dz = p.z - m.z, l = Math.hypot(dx, dz) || 1;
          slideMove(this.g, m, dx / l * spd * dt, dz / l * spd * dt, 0.3); m.face = Math.atan2(dx, dz);
        } else {
          m.repathT -= dt;
          if (m.repathT <= 0 || !m.path.length) { m.repathT = 0.3; m.path = bfs(this.g, tileOf(m.x, m.z), tileOf(m.lastSeen.x, m.lastSeen.z), this.pass) || []; }
          followPath(m, spd, dt);
        }
        break;
      }
      case 'search':
        if (!followPath(m, s.walk * 1.3 * this.diff, dt)) {
          m.searchT += dt; m.face += dt * 1.6;
          if (m.searchT > 3) { m.state = 'patrol'; m.target = -1; }
        }
        break;
    }
    this.tryCatch(m);
  }

  stepBat(m, dt, seen) {
    // 박쥐 악마: 벽 위로 날아다니며 학생을 보면 비명으로 다른 괴물을 부른다. 직접 잡지는 않는다
    const s = m.spec;
    m.shoutT -= dt;
    if (seen) {
      m.chaseT = (m.state === 'chase' ? m.chaseT : 0) + dt;
      if (m.chaseT > 8) { m.state = 'patrol'; m.ignoreT = 8; m.wp = null; return; }   // 박쥐도 지친다
      m.target = seen.slot; m.state = 'chase'; m.lastSeen = { x: seen.x, z: seen.z };
      if (m.shoutT <= 0) { m.shoutT = 4.5; this.snd('screech', m.x, m.z); this.alertOthers(m, seen.x, seen.z); this.toast(`🦇 ${s.name}가 소리쳐 괴물들을 부르고 있어요!`, seen.slot); }
      const dx = seen.x - m.x, dz = seen.z - m.z, l = Math.hypot(dx, dz) || 1;
      if (l > 1.6) { m.x += dx / l * s.run * dt; m.z += dz / l * s.run * dt; }
      m.face = Math.atan2(dx, dz);
    } else {
      if (m.state === 'chase') { m.state = 'patrol'; m.path = null; }
      if (!m.wp || Math.hypot(m.wp.x - m.x, m.wp.z - m.z) < 0.3) m.wp = { x: 1 + this.rand() * (this.g.W - 3), z: 1 + this.rand() * (this.g.H - 3) };
      const dx = m.wp.x - m.x, dz = m.wp.z - m.z, l = Math.hypot(dx, dz) || 1;
      m.x += dx / l * s.walk * dt; m.z += dz / l * s.walk * dt; m.face = Math.atan2(dx, dz);
    }
  }

  stepSpider(m, dt, seen) {
    // 거미: 숨어 있다가 가까이 오면 잠깐 멈칫한 뒤 직선으로 돌진, 그 뒤 쉰다
    const s = m.spec;
    if (m.state === 'windup') {
      m.alertT -= dt;
      if (m.alertT <= 0) { m.state = 'lunge'; m.lungeT = 0.8; this.snd('skitter', m.x, m.z); }
      this.tryCatch(m); return true;
    }
    if (m.state === 'lunge') {
      m.lungeT -= dt;
      const p = this.players.get(m.target);
      if (p && this.active(p)) { const a = Math.atan2(p.x - m.x, p.z - m.z); m.face += angleDiff(m.face, a) * Math.min(1, dt * 3); }
      const bx = m.x, bz = m.z;
      slideMove(this.g, m, Math.sin(m.face) * s.run * this.diff * dt, Math.cos(m.face) * s.run * this.diff * dt, 0.35);
      this.tryCatch(m);
      if (m.lungeT <= 0 || (Math.abs(m.x - bx) + Math.abs(m.z - bz) < 0.001)) { m.state = 'rest'; m.restT = 2.6; m.target = -1; m.ignoreT = 3; }
      return true;
    }
    if (seen && dist(m, seen) < s.sight) {
      m.state = 'windup'; m.alertT = 0.9; m.target = seen.slot; m.face = Math.atan2(seen.x - m.x, seen.z - m.z);
      this.snd('spotted', m.x, m.z, seen.slot);
      return true;
    }
    if (!followPath(m, s.walk, dt)) this.wander(m, 5);
    return true;
  }

  tryCatch(m) {
    if (!m.spec.catches || m.restT > 0) return;
    for (const p of this.players.values()) if (this.active(p) && dist(m, p) < (m.spec.kind === 'spider' ? 0.85 : 0.68)) { this.catchPlayer(p, m); return; }
  }

  step(dt) {
    if (this.phase !== 'play') return;
    this.time -= dt; this.elapsed += dt;
    if (this.time <= 0) { this.time = 0; this.gameOver('time'); return; }
    for (const s of this.spots) if (s.lockT > 0) s.lockT = Math.max(0, s.lockT - dt);

    for (const p of this.players.values()) {
      if (p.invuln > 0) p.invuln -= dt;
      if (p.fastT > 0) p.fastT -= dt;
      if (p.throwT > 0) p.throwT -= dt;
      if (p.peekT > 0) p.peekT = p.moving || p.caged >= 0 ? 0 : p.peekT - dt;
      if (p.hidden >= 0) {
        p.hideT += dt;
        if (p.hideT > 12) { p.hidden = -1; p.invuln = 0.8; this.toast('옷장 안이 너무 답답해요! 밖으로 나왔어요', p.slot); this.snd('door_open', p.x, p.z); }
        else if (p.hideT > 9 && p.hideT - dt <= 9) this.toast('옷장에 오래 있을 수 없어요. 3초 뒤에 나가요', p.slot);
      }
      if (p.caged >= 0 || p.escaped || p.hidden >= 0) continue;
      // 줍기
      for (const cd of this.candies) if (!cd.taken && Math.hypot(cd.x - p.x, cd.z - p.z) < 0.8) {
        cd.taken = true; this.stats.candy++; p.candy++; this.snd('pickup', p.x, p.z, p.slot);
        if (!this.candyTip.has(p.slot)) { this.candyTip.add(p.slot); this.toast('🍬 사탕을 주웠어요! 오른쪽 아래 사탕 단추로 던지면 괴물이 사탕을 먹으러 가요', p.slot); }
      }
      // 탈출
      if (this.pz.open && this.exitTiles.some(t => Math.hypot(t.c - p.x, t.r - p.z) < 1.0)) {
        p.escaped = true; this.snd('pickup', p.x, p.z); this.toast(`✨ ${p.name} 탈출!`);
      }
    }
    // 구출: 갇히지 않은 친구가 새장 옆에 1.5초
    this.cages.forEach((cg, i) => {
      const caged = [...this.players.values()].filter(p => p.caged === i);
      const helper = [...this.players.values()].find(p => p.caged < 0 && !p.escaped && p.hidden < 0 && Math.hypot(cg.c - p.x, cg.r - p.z) < 1.6);
      if (caged.length && helper) {
        cg.rescueT += dt;
        if (cg.rescueT >= 1.5) {
          cg.rescueT = 0; this.snd('cage', cg.c, cg.r);
          for (const p of caged) {
            p.caged = -1; p.invuln = 3;
            const out = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]].map(([dc, dr]) => ({ c: cg.c + dc, r: cg.r + dr })).filter(t => !this.g.solid(t.c, t.r));
            const t = out[p.slot % out.length] || out[0]; this.teleport(p, t.c, t.r);
          }
          this.toast(`🔓 ${josa(helper.name, '이가')} ${josa(caged.map(p => p.name).join(', '), '을를')} 구했어요!`);
        }
      } else cg.rescueT = Math.max(0, cg.rescueT - dt * 2);
    });

    for (const L of this.lures) {
      if (L.fly > 0) { L.fly -= dt; if (L.fly <= 0) this.landLure(L); }
      else if ((L.life -= dt) <= 0) L.gone = true;
    }
    for (const m of this.monsters) this.stepMonster(m, dt);
    this.lures = this.lures.filter(L => !L.gone);

    const ps = [...this.players.values()];
    if (this.pz.open && ps.some(p => p.escaped) && ps.every(p => p.escaped || p.caged >= 0)) {
      this.phase = 'clear';
      // 별: 탈출 1 + 시간 1/3 이상 남김 1 + 사탕 60% 이상 1
      const stars = 1 + (this.time >= this.stage.time / 3 ? 1 : 0) + (this.stats.candy >= Math.ceil(this.candies.length * 0.6) ? 1 : 0);
      this.result = { time: this.elapsed, left: this.time, escaped: ps.filter(p => p.escaped).length, total: ps.length, candyTotal: this.candies.length, stars, ...this.stats };
    }
  }

  snapshot() {
    const ev = this.events; this.events = [];
    return {
      t: 's', st: this.stageIdx, ph: this.phase, why: this.overReason, tm: Math.round(this.time * 10) / 10,
      p: [...this.players.values()].map(p => [p.slot, +p.x.toFixed(2), +p.z.toFixed(2), +p.face.toFixed(2),
        (p.hidden >= 0 ? 1 : 0) | (p.caged >= 0 ? 2 : 0) | (p.escaped ? 4 : 0) | (p.moving ? 8 : 0) | (p.invuln > 0 ? 16 : 0) | (p.fastT > 0 ? 32 : 0),
        p.item ? ITEM_CODES.indexOf(p.item) : -1, p.name, p.char, p.tp.seq, p.tp.x, p.tp.z, p.hidden, p.candy]),
      m: this.monsters.map(m => [+m.x.toFixed(2), +m.z.toFixed(2), +m.face.toFixed(2), STATE_CODES[m.blindT > 0 ? 'blind' : m.state] ?? 0]),
      f: this.fragments.map(f => [f.x, f.z, f.taken ? 1 : 0]),
      sr: this.spots.map(s => [s.c, s.r, s.searched ? 1 : 0, SEARCH_CODES.indexOf(s.ch), Math.ceil(s.lockT)]),
      it: this.items.map(i => [ITEM_CODES.indexOf(i.type), i.x, i.z, i.taken ? 1 : 0]),
      pz: [[...this.pz.have], this.pz.assembled ? 1 : 0, this.pz.open ? 1 : 0, this.pz.wrong],
      cg: this.cages.map(c => +(c.rescueT / 1.5).toFixed(2)),
      cd: this.candies.map(c => [c.x, c.z, c.taken ? 1 : 0]), cc: this.stats.candy,
      lu: this.lures.filter(L => L.fly <= 0).map(L => [L.id, L.x, L.z]),
      ch: this.chests.map(c => (c.opened ? 1 : 0)),
      res: this.phase === 'clear' ? this.result : null,
      ev,
    };
  }
}
export { ITEM_CODES, PLAYER_SPEED };
