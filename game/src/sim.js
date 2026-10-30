// 방장 기기에서만 도는 판정: 괴물 AI, 잡기·새장·구출, 숨기, 쪽지 조각, 퍼즐, 시간.
// 학생 위치는 각 기기가 보내 준 값을 그대로 믿는다(교실용이라 부정행위 방지는 하지 않음).
import { STAGES, MONSTERS, PLAYER_SPEED, DIFF_SPEED, CANDY_PER_FLOOR, monsterSpots, SEARCHABLE, SEARCH_CODES, SEARCH_SPOTS, SEARCH_LOCK, stageMap, allItems } from './config.js';
import { josa, T } from './util.js';
import { parseMap, tileOf, dist, bfs, lineOfSight, slideMove, followPath, angleDiff, rng } from './grid.js';

const ITEM_CODES = ['time', 'crystal', 'potion'];
export const STATE_CODES = { patrol: 0, alert: 1, chase: 2, search: 3, rest: 4, lunge: 5, windup: 6, blind: 7, lured: 8, eat: 9 };
// 사탕 던지기: 이만큼 멀리 던지고, 떨어진 곳에서 이 거리 안의 괴물이 사탕을 먹으러 간다
export const THROW_RANGE = 7, LURE_R = 6, EAT_T = 4.5, THROW_FLY = 0.55;
// 같은 괴물은 한 층에서 사탕에 이만큼만 속는다(그 뒤로는 사탕을 본체만체)
export const LURE_MAX = 3;

export class Sim {
  // puzzles: 이 층의 쪽지 문제들(차례로 하나씩). round: 몇 번째 쪽지부터(다시 도전하면 실패한 쪽지부터)
  // rules: 켠 아이템(모래시계·수정구·날쌘 물약·사탕·호박 상자), 함께 할 때는 방장 규칙
  constructor({ stageIdx, puzzles, puzzle, round = 0, chestQuiz = [], roster, diff = 'easy', seed = Date.now(), rules = {} }) {
    this.stageIdx = stageIdx;
    this.stage = STAGES[stageIdx];
    this.rules = { ...allItems(), ...rules };
    this.g = parseMap(stageMap(stageIdx, seed));   // 새장 자리는 판마다 바뀐다
    this.puzzles = puzzles?.length ? puzzles : [puzzle];
    this.notes = this.puzzles.length;
    this.round = Math.max(0, Math.min(this.notes - 1, round | 0));
    this.puzzle = this.puzzles[this.round];
    this.rand = rng(seed);
    this.diff = DIFF_SPEED[diff] ?? 1; this.diffKey = diff;
    this.solo = roster.length === 1;
    this.phase = 'play';
    this.overReason = '';
    // 층 시간은 쪽지 수로 나눠 남은 쪽지만큼 준다(중간부터 다시 하면 그만큼 짧다)
    this.budget = Math.round(this.stage.time * (this.notes - this.round) / this.notes);
    this.time = this.budget;
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

    // 쪽지 찾기: 시작 위치에서 걸어갈 수 있는 바닥만 '옆에 설 곳'으로 친다(가구에 갇힌 작은 빈칸은 빼고)
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
    this.cand = cand; this.usedSpots = new Set();
    this.hideNote();
    // 아이템: 후보 칸마다 하나, 모래시계가 가장 많다(끈 아이템은 빼고 켠 것끼리 나눈다)
    const kinds = ['time', 'crystal', 'potion', 'time', 'crystal', 'time'].filter(k => this.rules[k]);
    this.items = kinds.length ? this.shuffle(sp.i.slice()).map((s, i) => ({ id: i, type: kinds[i % kinds.length], x: s.c, z: s.r, taken: false })) : [];
    // 호박 상자: 다가가 문제를 맞히면 아이템. 상자마다 한 번만 열린다
    this.chests = this.rules.chest ? sp.c.map((s, i) => ({ id: i, c: s.c, r: s.r, opened: false })) : [];
    // 사탕: 시작 위치에서 떨어진 빈 바닥에 서로 떨어뜨려 흩어 둔다(점수·별)
    const used = new Set([...sp.f, ...sp.i, ...sp.P].map(t => t.r * this.g.W + t.c)), free = [];
    for (let r = 1; r < this.g.H - 1; r++) for (let c = 1; c < this.g.W - 1; c++) {
      if (this.g.at(c, r) !== '.' || used.has(r * this.g.W + c) || Math.hypot(c - this.spawn.c, r - this.spawn.r) < 4) continue;
      free.push({ c, r });
    }
    this.candies = [];
    this.lures = []; this.lureSeq = 0; this.candyTip = new Set();   // 던진 사탕(괴물 꾀기)
    for (const t of this.rules.candy ? this.shuffle(free) : []) {
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

  // 쪽지 한 장 숨기기: 뒤질 수 있는 가구 중 서로 떨어진 10곳을 고르고(앞 쪽지에서 쓴 가구는 되도록 빼고),
  // 그중 서로·시작 위치와 가장 멀리 흩어진 4곳에 진짜 조각을 넣는다. 나머지 6곳은 꽝(작은 보상)
  hideNote() {
    const fresh = this.cand.filter(t => !this.usedSpots.has(t.r * this.g.W + t.c));
    const cand = this.shuffle(fresh.length >= SEARCH_SPOTS * 1.5 ? fresh : this.cand.slice());
    const picked = [];
    for (const gap of [5, 4, 3, 2]) {
      for (const t of cand) if (picked.length < SEARCH_SPOTS && !picked.includes(t) && picked.every(o => Math.hypot(o.c - t.c, o.r - t.r) >= gap)) picked.push(t);
      if (picked.length >= SEARCH_SPOTS) break;
    }
    for (const t of picked) this.usedSpots.add(t.r * this.g.W + t.c);
    this.spots = picked.map((t, id) => ({ id, c: t.c, r: t.r, ch: t.ch, searched: false, frag: -1, lockT: 0 }));
    const real = [], puzzle = this.puzzle;
    const score = s => Math.min(Math.hypot(s.c - this.spawn.c, s.r - this.spawn.r) * 0.6, ...real.map(o => Math.hypot(o.c - s.c, o.r - s.r))) + this.rand() * 3;
    while (real.length < puzzle.parts.length && real.length < this.spots.length) {
      const best = this.spots.filter(s => !real.includes(s)).sort((a, b) => score(b) - score(a))[0]; real.push(best);
    }
    this.fragments = puzzle.parts.map((_, i) => { const s = real[i]; s.frag = i; return { id: i, x: s.c, z: s.r, taken: false, spot: s.id }; });
    this.pz = { have: new Set(), assembled: false, open: false, wrong: 0 };
  }
  // 쪽지 하나를 풀었는데 아직 남았으면: 다음 쪽지가 다른 가구들에 숨겨진다
  nextNote(p) {
    this.round++; this.puzzle = this.puzzles[this.round];
    this.hideNote();
    for (const o of this.players.values()) { o.invuln = Math.max(o.invuln, 3); o.peekT = 0; }
    this.snd('paper', p.x, p.z);
    this.ev({ k: 'note', rd: this.round, name: p.name });
    this.toast(T(`📜 ${josa(p.name, '이가')} 정답! 그런데 쪽지가 ${this.notes - this.round}장 더 남았어요. 다른 가구에 새 쪽지가 숨겨졌어요`, `📜 ${p.name} got it right! But ${this.notes - this.round} more note(s) to go. A new note is hidden in other furniture`));
  }

  d2(a, b) { return (a.c - b.c) ** 2 + (a.r - b.r) ** 2; }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  ev(e) { this.events.push(e); }
  toast(msg, slot = -1) { this.ev({ k: 'toast', msg, slot }); }
  snd(n, x, z, slot = -1) { this.ev({ k: 'snd', n, x, z, slot }); }
  teleport(p, x, z) { p.x = x; p.z = z; p.tp = { seq: p.tp.seq + 1, x, z }; }
  active(p) { return p.hidden < 0 && p.caged < 0 && !p.escaped && p.invuln <= 0 && !p.off; }
  pass = (c, r) => !this.g.solid(c, r);

  // 각 기기가 보내는 내 위치
  setPlayer(slot, x, z, face, moving) {
    const p = this.players.get(slot); if (!p || p.caged >= 0 || p.escaped || p.hidden >= 0) return;
    p.x = x; p.z = z; p.face = face; p.moving = moving;
  }
  removePlayer(slot) { this.players.delete(slot); }
  // 연결이 잠깐 끊긴 친구: 자리는 남겨 두고(다시 들어오면 그대로 이어서) 괴물·탈출 판정에서는 뺀다
  setOffline(slot, off) { const p = this.players.get(slot); if (p) { p.off = off; if (!off) p.invuln = Math.max(p.invuln, 3); } }
  // 층이 진행 중일 때 들어온(다시 들어온) 친구: 시작 자리에서 잠깐 무적으로 시작
  addPlayer(r) {
    if (this.players.has(r.slot)) return;
    const x = this.spawn.c, z = this.spawn.r;
    this.players.set(r.slot, { slot: r.slot, name: r.name, char: r.char, x, z, face: Math.PI, moving: false,
      hidden: -1, hideT: 0, caged: -1, escaped: false, invuln: 3, item: null, fastT: 0, candy: 0, throwT: 0, peekT: 0, tp: { seq: 1, x, z } });
    this.solo = false;
    this.toast(T(`👋 ${josa(r.name, '이가')} 들어왔어요!`, `👋 ${r.name} joined!`));
  }

  input(slot, m) {
    const p = this.players.get(slot); if (!p || this.phase !== 'play') return;
    if ((m.t === 'search' || m.t === 'peek') && m.rd != null && m.rd !== this.round) return;   // 앞 쪽지 때 연 가구 문제의 답
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
      this.snd('pickup', p.x, p.z); this.toast(n ? T(`🔮 수정구가 번쩍! 괴물 ${n}마리가 6초 동안 앞을 못 봐요`, `🔮 Flash! ${n} monster(s) can't see for 6 seconds`) : T('🔮 수정구가 번쩍! 근처엔 괴물이 없었어요', '🔮 Flash! But no monsters were nearby'), p.slot);
      this.ev({ k: 'flash', x: p.x, z: p.z });
    } else if (it === 'potion') {
      p.fastT = 5; this.toast(T('🧪 날쌘 물약! 5초 동안 빨라져요', '🧪 Speed potion! You are faster for 5 seconds'), p.slot); this.snd('pickup', p.x, p.z);
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
    const [icon, name] = SEARCHABLE[s.ch] || ['🔍', T('가구', 'furniture')];
    if (!ok && s.frag >= 0) {
      const f = this.fragments[s.frag], to = this.freeSpot([s]);
      if (to) {
        s.frag = -1; this.placeFrag(f, to); this.snd('paper', s.c, s.r, p.slot);
        this.ev({ k: 'fragMoved', slot: p.slot, spot: id });
        this.toast(T(`📜 앗! ${name} 속 쪽지 조각이 휙 날아가 다른 ? 가구로 숨었어요. 감지기를 봐요!`, `📜 Oops! The note piece in the ${name} flew off and hid in another ? spot. Check the detector!`), p.slot);
        return;
      }
    }
    if (!ok) {
      s.lockT = SEARCH_LOCK; this.snd('cage', s.c, s.r, p.slot);
      this.toast(T(`🔒 ${josa(name, '이가')} ${SEARCH_LOCK}초 동안 잠겼어요. 다시 오면 다른 문제가 나와요`, `🔒 The ${name} is locked for ${SEARCH_LOCK} seconds. Come back for a different question`), p.slot);
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
    if (roll < 0.5 && this.rules.candy) { p.candy++; this.snd('pickup', p.x, p.z, p.slot); this.toast(T(`${icon} ${name}에서 사탕 1개를 찾았어요! 쪽지는 없었어요`, `${icon} You found 1 candy in the ${name}! No note here`), p.slot); }
    else if (roll < 0.75 && this.rules.time) { this.time += 10; this.snd('pickup', p.x, p.z, p.slot); this.toast(T(`${icon} ${name} 속에 반짝이는 모래가… 시간 +10초! 쪽지는 없었어요`, `${icon} Sparkling sand in the ${name}… Time +10 s! No note here`), p.slot); }
    else {
      const jokes = T([`${name}에는 거미줄뿐이에요`, `${name}에는 먼지만 가득해요`, `${name}에는 낡은 양말 한 짝뿐이에요`, `${name} 뒤에서 박쥐가 푸드덕 날아갔어요`],
        [`Only cobwebs in the ${name}`, `The ${name} is full of dust`, `Just one old sock in the ${name}`, `A bat flapped out from behind the ${name}`]);
      this.snd('paper', p.x, p.z, p.slot); this.toast(`${icon} ${jokes[Math.floor(this.rand() * jokes.length)]}. ${T('다른 곳을 찾아봐요', 'Try somewhere else')}`, p.slot);
    }
    this.ev({ k: 'searched', slot: p.slot, spot: id });
  }

  // 아이템 줍기: 가까이 가서 상호작용(E·터치). 수정구·물약은 한 칸이라, 손에 든 것이 있으면 그 자리에 내려놓고 바꾼다
  takeItem(p, id) {
    const it = this.items[id];
    if (!it || it.taken || p.caged >= 0 || p.escaped || p.hidden >= 0 || Math.hypot(it.x - p.x, it.z - p.z) > 1.4) return;
    if (it.type === 'time') { it.taken = true; this.time += 30; this.snd('pickup', p.x, p.z); this.toast(T(`⏳ ${josa(p.name, '이가')} 모래시계를 주웠어요! 시간 +30초`, `⏳ ${p.name} picked up an hourglass! Time +30 s`)); return; }
    const old = p.item; p.item = it.type; this.snd('pickup', p.x, p.z, p.slot);
    if (old) it.type = old; else it.taken = true;
    this.toast(T(p.item === 'crystal' ? `🔮 수정구를 주웠어요${old ? ` (${old === 'potion' ? '날쌘 물약' : '수정구'}은 내려놓았어요)` : ''}. 쓰면 가까운 괴물이 6초 동안 앞을 못 봐요`
      : `🧪 날쌘 물약을 주웠어요${old ? ` (${old === 'crystal' ? '수정구' : '날쌘 물약'}는 내려놓았어요)` : ''}. 쓰면 5초 동안 빨라져요`,
    p.item === 'crystal' ? `🔮 You picked up a crystal ball${old ? ` (dropped the ${old === 'potion' ? 'speed potion' : 'crystal ball'})` : ''}. Use it to blind nearby monsters for 6 seconds`
      : `🧪 You picked up a speed potion${old ? ` (dropped the ${old === 'crystal' ? 'crystal ball' : 'speed potion'})` : ''}. Use it to run faster for 5 seconds`), p.slot);
  }

  // 사탕 던지기: 겨눈 곳(최대 THROW_RANGE칸)으로 날아간다
  throwCandy(p, tx, tz) {
    if (!this.rules.candy || p.candy <= 0 || p.throwT > 0 || p.caged >= 0 || p.escaped || p.hidden >= 0 || !Number.isFinite(tx) || !Number.isFinite(tz)) return;
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
    let n = 0; const tired = [], last = [];
    for (const m of this.monsters) {
      if (m.blindT > 0 || m.state === 'eat' || m.state === 'lunge' || Math.hypot(m.x - L.x, m.z - L.z) > LURE_R) continue;
      if (m.state === 'lured') { const cur = this.lures.find(o => o.id === m.lure && !o.gone); if (cur && dist(m, cur) <= dist(m, L)) continue; }
      else {
        if ((m.lureN || 0) >= LURE_MAX) { tired.push(m.spec.name); continue; }
        m.lureN = (m.lureN || 0) + 1; if (m.lureN === LURE_MAX) last.push(m.spec.name);
      }
      m.state = 'lured'; m.lure = L.id; m.path = []; m.repathT = 0; m.target = -1; m.sawHide = -1; m.restT = 0; n++;
    }
    this.snd('pickup', L.x, L.z);
    let msg = n ? T(`🍬 괴물 ${n}마리가 사탕 냄새를 맡았어요! 지금 피해요`, `🍬 ${n} monster(s) smelled the candy! Get away now`) : tired.length ? T('🍬 사탕을 던졌어요', '🍬 You threw candy') : T('🍬 사탕을 던졌어요. 근처에는 괴물이 없었어요', '🍬 You threw candy. No monsters were nearby');
    if (last.length) msg += T(` · ${josa([...new Set(last)].join(', '), '은는')} 이번이 마지막이에요`, ` · Last time for ${[...new Set(last)].join(', ')}`);
    if (tired.length) msg += T(` · ${josa([...new Set(tired)].join(', '), '은는')} 사탕에 질려서 이제 안 속아요!`, ` · ${[...new Set(tired)].join(', ')} got tired of candy and won't fall for it anymore!`);
    this.toast(msg, L.by);
  }

  // 쪽지 조각을 숨길 가구: 아직 안 뒤진 꽝 가구 중 하나(없으면 뒤진 꽝 가구를 다시 닫는다)
  freeSpot(not = []) {
    let pool = this.spots.filter(s => !s.searched && s.frag < 0 && !not.includes(s));
    if (!pool.length) pool = this.spots.filter(s => s.frag < 0 && !not.includes(s));
    if (!pool.length) return null;
    const s = pool[Math.floor(this.rand() * pool.length)];
    if (s.searched) { s.searched = false; s.lockT = 0; }
    return s;
  }
  placeFrag(f, s) { s.frag = f.id; f.taken = false; f.x = s.c; f.z = s.r; f.spot = s.id; }

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
      this.toast(T(`📜 ${josa(p.name, '이가')} 쪽지를 맞췄어요! 이제 문제를 풀어요`, `📜 ${p.name} put the note together! Now solve the question`));
    } else this.ev({ k: 'arrangeWrong', slot: p.slot });
  }

  answer(p, v) {
    if (!this.pz.assembled || this.pz.open) return;
    // 보기 고르기: 고른 보기 글이 정답 글과 같은지
    const norm = s => String(s).replace(/\s/g, '');
    const ok = norm(v) === norm(this.puzzle.answer);
    if (ok && this.round < this.notes - 1) this.nextNote(p);
    else if (ok) {
      this.pz.open = true;
      // 문이 열리는 장면(약 3초) 동안은 아무도 잡히지 않는다
      for (const o of this.players.values()) o.invuln = Math.max(o.invuln, 4);
      this.ev({ k: 'open', name: p.name }); this.snd('gate', this.exitTiles[0].c, this.exitTiles[0].r);
      this.toast(T(`🚪 ${josa(p.name, '이가')} 정답! 탈출문이 열렸어요. 북쪽 문으로 달려요!`, `🚪 ${p.name} got it right! The exit is open. Run to the north door!`));
    } else {
      this.pz.wrong++; this.stats.wrong++;
      this.scatter();
      this.ev({ k: 'answerWrong', slot: p.slot, v });
      this.toast(T(`❌ "${v}"은(는) 정답이 아니에요. 쪽지가 찢어져 ? 가구들로 다시 흩어졌어요! 다시 모아서 붙여요`, `❌ "${v}" is not the answer. The note tore apart and scattered into the ? spots! Collect it and put it together again`));
    }
  }

  // 틀린 답: 붙인 쪽지가 다시 네 조각으로 흩어져 ? 가구들에 숨는다(같은 문제, 다시 붙이면 힌트가 보인다)
  scatter() {
    const used = [];
    for (const f of this.fragments) {
      const s = this.freeSpot(used); if (!s) continue;   // 숨길 곳이 없으면 그 조각은 손에 남는다
      used.push(s); this.placeFrag(f, s); this.pz.have.delete(f.id);
    }
    this.pz.assembled = false;
  }

  catchPlayer(p, m) {
    this.stats.caught++;
    this.snd('caught', p.x, p.z);
    // 잡은 괴물은 그 자리를 떠난다(같은 곳에서 계속 잡히지 않게)
    m.state = 'rest'; m.restT = 2; m.path = []; m.target = -1; m.sawHide = -1; m.ignoreT = 8;
    let msg = T(`💀 ${josa(p.name, '이가')} ${m.spec.name}에게 잡혔어요!`, `💀 ${p.name} was caught by ${m.spec.name}!`);
    // 확실한 불이익 1: 모은 쪽지 하나를 빼앗겨 다시 숨겨진다
    // (느림에서는 빼앗지 않는다: 저학년이 다시 찾느라 지치지 않게)
    // 한 번 빼앗기면 30초 동안은 다시 빼앗기지 않는다(쪽지가 여러 장이라 연달아 잃으면 끝이 안 난다)
    if (this.diffKey !== 'easy' && !this.pz.assembled && this.pz.have.size > 0 && this.elapsed >= (this.stealAt ?? -99) + 30) {
      this.stealAt = this.elapsed;
      const ids = [...this.pz.have]; const id = ids[Math.floor(this.rand() * ids.length)];
      // 가구마다 문제를 풀어야 하니 너무 먼 곳만 고르지 않는다(남은 꽝 가구 중 아무 곳)
      const far = this.freeSpot();
      if (far) {
        this.pz.have.delete(id); far.lockT = 0; this.placeFrag(this.fragments[id], far);
        this.stats.stolen++; msg += T(` 쪽지 조각 하나를 빼앗겼어요`, ` A note piece was stolen.`);
      }
    }
    if (p.hidden >= 0) p.hidden = -1;
    if (this.solo) {
      // 혼자일 때 불이익 2: 시작 위치로, 시간 −10초
      this.time -= 10; p.invuln = 3; this.teleport(p, this.spawn.c, this.spawn.r);
      msg += T(' 처음 자리로 돌아가요 · 시간 −10초', ' Back to the start · Time −10 s');
    } else {
      // 협동일 때 불이익 2: 새장에 갇힌다. 친구가 새장 옆에 1.5초 서 있으면 풀려난다
      const cg = this.cages[0];
      p.caged = 0; this.teleport(p, cg.c, cg.r); this.snd('cage', cg.c, cg.r);
      msg += T(' 새장에 갇혔어요. 친구가 구해 줘야 해요!', ' Locked in the ghost cage. A friend has to rescue you!');
      const free = [...this.players.values()].filter(o => o.caged < 0 && !o.escaped && !o.off);
      if (!free.length) this.gameOver('caught');
    }
    this.toast(msg);
    this.ev({ k: 'caught', slot: p.slot, x: p.x, z: p.z });
  }

  openChest(p, id, ok) {
    const ch = this.chests[id]; if (!ch || ch.opened || p.caged >= 0 || p.escaped) return;
    if (Math.hypot(ch.c - p.x, ch.r - p.z) > 1.9) return;
    ch.opened = true;
    if (!ok) { this.toast(T('🎃 상자가 "땡!" 하고 잠겼어요. 다른 상자를 찾아봐요', '🎃 "Bzzt!" The box locked. Find another box'), p.slot); this.snd('cage', ch.c, ch.r, p.slot); return; }
    this.stats.chestOk++; this.snd('pickup', ch.c, ch.r);
    const gifts = ['crystal', 'potion'].filter(k => this.rules[k]);
    if (!p.item && gifts.length) {
      p.item = gifts[Math.floor(this.rand() * gifts.length)];
      this.toast(p.item === 'crystal' ? T('🎃 정답! 상자에서 🔮 수정구가 나왔어요 (Q로 쓰기)', '🎃 Correct! A 🔮 crystal ball came out of the box (Q to use)') : T('🎃 정답! 상자에서 🧪 날쌘 물약이 나왔어요 (Q로 쓰기)', '🎃 Correct! A 🧪 speed potion came out of the box (Q to use)'), p.slot);
    } else if (this.rules.time) { this.time += 20; this.toast(T(`🎃 ${josa(p.name, '이가')} 상자 문제를 맞혔어요! 시간 +20초`, `🎃 ${p.name} solved a box question! Time +20 s`)); }
    else this.toast(T('🎃 정답! 상자 속에는 호박씨만 가득했어요', '🎃 Correct! The box was full of pumpkin seeds'), p.slot);
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
      if (!p || p.caged >= 0 || p.escaped || p.off) { m.state = 'patrol'; m.path = []; return; }
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
      if (m.shoutT <= 0) { m.shoutT = 4.5; this.snd('screech', m.x, m.z); this.alertOthers(m, seen.x, seen.z); this.toast(T(`🦇 ${s.name}가 소리쳐 괴물들을 부르고 있어요!`, `🦇 ${s.name} is screeching to call the other monsters!`), seen.slot); }
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
        if (p.hideT > 12) { p.hidden = -1; p.invuln = 0.8; this.toast(T('옷장 안이 너무 답답해요! 밖으로 나왔어요', 'It got too stuffy in the wardrobe! You climbed out'), p.slot); this.snd('door_open', p.x, p.z); }
        else if (p.hideT > 9 && p.hideT - dt <= 9) this.toast(T('옷장에 오래 있을 수 없어요. 3초 뒤에 나가요', "You can't stay in the wardrobe long. Out in 3 seconds"), p.slot);
      }
      if (p.caged >= 0 || p.escaped || p.hidden >= 0 || p.off) continue;
      // 줍기
      for (const cd of this.candies) if (!cd.taken && Math.hypot(cd.x - p.x, cd.z - p.z) < 0.8) {
        cd.taken = true; this.stats.candy++; p.candy++; this.snd('pickup', p.x, p.z, p.slot);
        if (!this.candyTip.has(p.slot)) { this.candyTip.add(p.slot); this.toast(T('🍬 사탕을 주웠어요! 오른쪽 아래 사탕 단추로 던지면 괴물이 사탕을 먹으러 가요', '🍬 You picked up candy! Throw it with the candy button (bottom right) and monsters will go eat it'), p.slot); }
      }
      // 탈출
      if (this.pz.open && this.exitTiles.some(t => Math.hypot(t.c - p.x, t.r - p.z) < 1.0)) {
        p.escaped = true; this.snd('pickup', p.x, p.z); this.toast(T(`✨ ${p.name} 탈출!`, `✨ ${p.name} escaped!`));
      }
    }
    // 구출: 갇히지 않은 친구가 새장 옆에 1.5초
    this.cages.forEach((cg, i) => {
      const caged = [...this.players.values()].filter(p => p.caged === i);
      const helper = [...this.players.values()].find(p => p.caged < 0 && !p.escaped && p.hidden < 0 && !p.off && Math.hypot(cg.c - p.x, cg.r - p.z) < 1.6);
      if (caged.length && helper) {
        cg.rescueT += dt;
        if (cg.rescueT >= 1.5) {
          cg.rescueT = 0; this.snd('cage', cg.c, cg.r);
          for (const p of caged) {
            p.caged = -1; p.invuln = 3;
            const out = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]].map(([dc, dr]) => ({ c: cg.c + dc, r: cg.r + dr })).filter(t => !this.g.solid(t.c, t.r));
            const t = out[p.slot % out.length] || out[0]; this.teleport(p, t.c, t.r);
          }
          this.toast(T(`🔓 ${josa(helper.name, '이가')} ${josa(caged.map(p => p.name).join(', '), '을를')} 구했어요!`, `🔓 ${helper.name} rescued ${caged.map(p => p.name).join(', ')}!`));
        }
      } else cg.rescueT = Math.max(0, cg.rescueT - dt * 2);
    });

    for (const L of this.lures) {
      if (L.fly > 0) { L.fly -= dt; if (L.fly <= 0) this.landLure(L); }
      else if ((L.life -= dt) <= 0) L.gone = true;
    }
    for (const m of this.monsters) this.stepMonster(m, dt);
    this.lures = this.lures.filter(L => !L.gone);

    // 연결이 끊긴 친구는 기다리지 않는다(남은 친구가 모두 나가면 층을 깬다)
    const ps = [...this.players.values()].filter(p => !p.off || p.escaped);
    if (this.pz.open && ps.some(p => p.escaped) && ps.every(p => p.escaped || p.caged >= 0)) {
      this.phase = 'clear';
      // 별: 탈출 1 + 시간 1/3 이상 남김 1 + 사탕 60% 이상 1
      const stars = 1 + (this.time >= this.budget / 3 ? 1 : 0) + (this.stats.candy >= Math.ceil(this.candies.length * 0.6) ? 1 : 0);
      this.result = { time: this.elapsed, left: this.time, escaped: ps.filter(p => p.escaped).length, total: ps.length, candyTotal: this.candies.length, stars, ...this.stats };
    }
  }

  snapshot() {
    const ev = this.events; this.events = [];
    return {
      t: 's', st: this.stageIdx, rd: this.round, ph: this.phase, why: this.overReason, tm: Math.round(this.time * 10) / 10,
      p: [...this.players.values()].map(p => [p.slot, +p.x.toFixed(2), +p.z.toFixed(2), +p.face.toFixed(2),
        (p.hidden >= 0 ? 1 : 0) | (p.caged >= 0 ? 2 : 0) | (p.escaped ? 4 : 0) | (p.moving ? 8 : 0) | (p.invuln > 0 ? 16 : 0) | (p.fastT > 0 ? 32 : 0) | (p.off ? 64 : 0),
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
