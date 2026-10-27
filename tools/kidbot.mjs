// 초등학생 플레이 흉내(난이도 점검용): 태블릿 조이스틱이라 최고 속도의 75%로 움직이고,
// 루미의 방 힌트(가장 가까운 쪽지가 있는 방)로 가서 그 방 가구를 가까운 것부터 뒤진다.
// 가구마다 문제를 4~8초 동안 읽고 75%로 맞힌다(틀려서 잠긴 가구는 건너뜀).
// 감지기가 '뜨거워'(쪽지 4칸 안)면 그 근처 가구부터. 괴물이 쫓아오면 문제를 버리고 반대쪽으로 도망친다(0.6초 늦게 알아챔).
// 쪽지를 다 모으면 그 자리에서 8초 동안 이어 붙이고, 문제를 12초 읽고 한 번 틀린 뒤 6초 뒤에 맞힌다. 쪽지가 더 남았으면 다시 찾는다.
// node tools/kidbot.mjs   (game/src를 그대로 쓴다)
import { Sim } from '../game/src/sim.js';
import { PLAYER_SPEED, STAGES, roomName } from '../game/src/config.js';
import { pickQuestions, defaultBank } from '../game/src/questions.js';
import { bfs, tileOf, slideMove } from '../game/src/grid.js';

const TRACE = process.env.TRACE ? [] : null;   // TRACE=1이면 처음 실패한 판의 10초마다 상태를 찍고 끝낸다
function play(stageIdx, diff, seed, grade) {
  if (TRACE) TRACE.length = 0;
  const q = pickQuestions(defaultBank(), grade, { notes: STAGES.map(s => s.notes || 1), math: true });
  const sim = new Sim({ stageIdx, puzzles: q.floors[stageIdx], chestQuiz: q.sets[stageIdx], roster: [{ slot: 0, name: '학생', char: 0 }], diff, seed });
  const me = { x: sim.spawn.c, z: sim.spawn.r, path: [], repath: 0, notice: 0, wait: 0, stage: 'collect', fled: 0 };
  const dt = 1 / 30, g = sim.g, pass = (c, r) => !g.solid(c, r);
  let t = 0;
  while (sim.phase === 'play' && t < 1800) {
    t += dt;
    const p = sim.players.get(0);
    if (p.tp.seq !== me.seq) { me.seq = p.tp.seq; me.x = p.tp.x; me.z = p.tp.z; me.path = []; }
    // 괴물이 쫓아오는지(0.6초 늦게 알아챈다)
    const chaser = sim.monsters.find(m => (m.state === 'chase' || m.state === 'windup' || m.state === 'lunge') && m.target === 0 && Math.hypot(m.x - me.x, m.z - me.z) < 4);
    me.notice = chaser ? me.notice + dt : 0;
    let goal = null;
    // 잡혀서 쪽지를 떨어뜨렸으면 길잡이 화살표를 따라 다시 주우러 간다
    if (me.stage !== 'collect' && me.wait <= 0 && sim.fragments.some(f => !f.taken)) me.stage = 'collect';
    // 사탕이 있으면 쫓아오는 괴물 쪽으로 짧게 눌러 던진다(NOTHROW=1이면 안 던진다)
    if (chaser && me.notice > 0.9 && p.candy > 0 && p.throwT <= 0 && !process.env.NOTHROW) { sim.input(0, { t: 'throw', x: chaser.x, z: chaser.z }); me.thrown = (me.thrown || 0) + 1; }
    if (me.searchId != null && chaser && me.notice > 0.6) { me.wait = 0; me.searchId = null; me.quit = (me.quit || 0) + 1; }   // 문제를 버리고 도망
    if (me.wait > 0) {
      me.wait -= dt;
      if (me.wait <= 0 && me.searchId != null) {
        const ok = Math.random() < 0.75; sim.input(0, { t: 'search', id: me.searchId, ok }); me.searchId = null;
        if (ok) me.searched = (me.searched || 0) + 1; else me.wrong = (me.wrong || 0) + 1;
      }
    }
    else if (chaser && me.notice > 0.6) {
      // 도망: 괴물 반대쪽 먼 칸으로
      me.fled += dt;
      if (me.repath <= 0) {
        const t0 = tileOf(me.x, me.z); let best = null, bd = -1;
        for (let k = 0; k < 30; k++) {
          const c = t0.c + Math.round((Math.random() - 0.5) * 12), r = t0.r + Math.round((Math.random() - 0.5) * 12);
          if (!pass(c, r)) continue;
          const d = Math.hypot(c - chaser.x, r - chaser.z) - Math.hypot(c - me.x, r - me.z) * 0.3;
          if (d > bd) { bd = d; best = { c, r }; }
        }
        me.path = best ? bfs(g, t0, best, pass) || [] : []; me.repath = 0.8;
      }
    } else if (me.stage === 'collect') {
      const left = sim.fragments.filter(f => !f.taken).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
      if (!left.length) { me.stage = 'arrange'; me.wait = 8; }
      else {
        const near = left[0], room = roomName(stageIdx, near.x, near.z), hot = Math.hypot(near.x - me.x, near.z - me.z) < 4;
        const open = sim.spots.filter(s => !s.searched && !(s.lockT > 0));
        const inRoom = open.filter(s => roomName(stageIdx, s.c, s.r) === room);
        const pool = inRoom.length ? inRoom : open;
        const d = s => Math.hypot(s.c - me.x, s.r - me.z) - (hot && Math.hypot(s.c - near.x, s.r - near.z) < 1.5 ? 6 : 0);
        const tgt = pool.sort((a, b) => d(a) - d(b))[0];
        if (tgt && Math.hypot(tgt.c - me.x, tgt.r - me.z) < 1.5) { me.wait = 4 + Math.random() * 4; me.searchId = tgt.id; me.path = []; sim.input(0, { t: 'peek', id: tgt.id }); }
        else if (tgt) {
          // 가구 옆 빈 바닥으로
          const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => ({ c: tgt.c + dc, r: tgt.r + dr })).filter(t => sim.reach.has(t.r * g.W + t.c))
            .sort((a, b) => Math.hypot(a.c - me.x, a.r - me.z) - Math.hypot(b.c - me.x, b.r - me.z))[0];
          if (side) { if (me.goalKey !== tgt.id) { me.goalKey = tgt.id; me.path = []; } goal = side; }
          me.dbgGoal = `${tgt.id}:${side?.c},${side?.r}`;
        }
      }
    } else if (me.stage === 'arrange') { sim.input(0, { t: 'arrange', order: [0, 1, 2, 3] }); me.stage = 'read'; me.wait = 12; }
    else if (me.stage === 'read') { sim.input(0, { t: 'answer', v: '틀린답' }); me.stage = 'answer'; me.wait = 6; }
    else if (me.stage === 'answer') { sim.input(0, { t: 'answer', v: sim.puzzle.answer }); me.stage = sim.pz.open ? 'exit' : 'collect'; }
    else if (me.stage === 'exit') goal = sim.exitTiles[0];
    me.repath -= dt;
    if (goal && (me.repath <= 0 || !me.path.length)) { me.path = bfs(g, tileOf(me.x, me.z), goal, pass) || []; me.repath = 0.5; }
    if (me.wait <= 0 && me.path.length) {
      const n = me.path[0], dx = n.c - me.x, dz = n.r - me.z, d = Math.hypot(dx, dz), step = PLAYER_SPEED * 0.75 * dt;
      if (d <= step) { me.x = n.c; me.z = n.r; me.path.shift(); } else slideMove(g, me, dx / d * step, dz / d * step, 0.24);
    }
    // 봇이 모서리에 걸리면(2초 동안 거의 안 움직임) 칸 가운데로 옮기고 길을 다시 찾는다(실제 아이는 조이스틱을 돌려 빠져나온다)
    if (me.wait <= 0 && me.path.length) { me.stuckT = Math.hypot(me.x - (me.lx ?? 0), me.z - (me.lz ?? 0)) < 0.02 ? (me.stuckT || 0) + dt : 0; if (me.stuckT > 2) { const t0 = tileOf(me.x, me.z); me.x = t0.c; me.z = t0.r; me.path = []; me.repath = 0; me.stuckT = 0; } }
    me.lx = me.x; me.lz = me.z;
    sim.setPlayer(0, me.x, me.z, 0, me.wait <= 0 && me.path.length > 0);
    sim.step(dt); sim.snapshot();
    if (TRACE && Math.round(t * 30) % 300 === 0) TRACE.push(`t${Math.round(t)} me ${me.x.toFixed(1)},${me.z.toFixed(1)} ${me.stage} have ${sim.pz.have.size} caught ${sim.stats.caught} path ${me.path.length} goal ${me.dbgGoal} wait ${me.wait.toFixed(1)} frags ${sim.fragments.filter(f => !f.taken).map(f => f.x + ',' + f.z).join(' ')}`);
  }
  return { phase: sim.phase, t: Math.round(t), left: Math.round(sim.time), caught: sim.stats.caught, fled: Math.round(me.fled), why: sim.overReason, thrown: me.thrown || 0, searched: me.searched || 0, wrong: me.wrong || 0, quit: me.quit || 0, notes: sim.round + (sim.pz.open ? 1 : 0) };
}

const total = {};
for (const diff of ['easy', 'normal']) for (let st = 0; st < STAGES.length; st++) {
  if (process.env.STAGE && +process.env.STAGE !== st) continue;
  const runs = Array.from({ length: 12 }, (_, i) => {
    const r = play(st, diff, 1000 + i * 7, diff === 'easy' ? 2 : 5);
    if (TRACE && r.phase !== 'clear') { console.log('seed', 1000 + i * 7, r); console.log(TRACE.join('\n')); process.exit(0); }
    return r;
  });
  const ok = runs.filter(r => r.phase === 'clear');
  const avg = (k, a = runs) => (a.reduce((s, r) => s + r[k], 0) / Math.max(1, a.length)).toFixed(1);
  total[diff] = (total[diff] || 0) + +avg('t', ok);
  console.log(`${diff.padEnd(6)} ${STAGES[st].name.padEnd(6)} 성공 ${ok.length}/12 · 평균 시간 ${avg('t', ok)}s · 남은 시간 ${avg('left', ok)}s · 잡힘 ${avg('caught')}회 · 도망 ${avg('fled')}s · 던짐 ${avg('thrown')}회 · 뒤짐 ${avg('searched')}곳 · 틀림 ${avg('wrong')} · 포기 ${avg('quit')} · 실패 ${runs.filter(r => r.phase !== 'clear').map(r => r.why || r.phase).join(',') || '-'}`);
}
console.log('층 6개 평균 시간 합(초):', JSON.stringify(total), '→ 분:', Object.fromEntries(Object.entries(total).map(([k, v]) => [k, (v / 60).toFixed(1)])));
