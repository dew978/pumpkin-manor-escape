// 협동 연결(WebRTC, PeerJS). 방파제 포격대와 같은 방식.
// 방장이 방 코드를 이름으로 한 문을 열고 친구들은 그 코드로 들어온다. 서로를 찾을 때만 PeerJS 공개 중개 서버를 거치고,
// 게임 데이터는 기기끼리 직접 오간다. 방장 기기가 괴물·시간·쪽지를 계산하고 친구 기기는 받아서 그린다.
// 주의(2026-10-29 점검): PeerJS 기본 TURN 서버(중계)가 응답하지 않아, 기기끼리 직접 이어지지 않는 와이파이에서는 연결이 안 된다.
// 그래서 처음 잇기는 몇 번 다시 해 보고, 중개 서버가 끊겨도 게임 연결은 그대로 두고 조용히 다시 붙는다.
import { T } from './util.js';

const PEER_JS = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'pumpkin-escape-';
export const MAX_PLAYERS = 4;
// 중개 서버(방 찾기)와의 연결 문제: 이미 이어진 게임 연결과는 상관없다
const SIGNAL_ERR = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);
const TRIES = 3, TRY_MS = 9000;
// 연결 판: 주고받는 메시지 모양이 바뀌면 올린다. 판이 다른 기기(새로고침 안 한 기기)는 방장이 안내하고 게임에 넣지 않는다
export const NET_V = 3;   // 3: 친구 기기가 2초마다 ping을 보낸다(소리 없이 끊긴 기기 찾기)

// PeerJS JSON 채널은 16,300바이트가 넘는 메시지를 보내지 않고 버린다(오류만 남김). 층 시작 메시지에 문제 묶음이 들어가면서
// 3학년 이상은 이 한도를 넘어 친구들이 시작을 못 받았다(2026-10-30). 긴 메시지는 글자 3000개씩(한글이어도 9KB쯤) 나눠 보내고 받는 쪽에서 붙인다
const PIECE = 3000;
let pieceId = 0;
function pieces(m) {
  const s = JSON.stringify(m);
  if (s.length <= PIECE) return [m];
  const id = ++pieceId, out = [];
  for (let at = 0; at < s.length;) {
    let end = Math.min(s.length, at + PIECE);
    // 이모지(서로게이트 쌍)를 가운데서 자르지 않는다
    if (end < s.length && /[\uDC00-\uDFFF]/.test(s[end])) end--;
    out.push(s.slice(at, end)); at = end;
  }
  return out.map((part, i) => ({ t: 'pc', id, i, n: out.length, s: part }));
}
function sendTo(conn, list) { for (const m of list) conn.send(m); }
// 받은 조각을 모아 다 모이면 원래 메시지로 넘긴다(연결마다 하나)
function joiner(deliver) {
  const got = new Map();
  return (m) => {
    if (!m || m.t !== 'pc') { deliver(m); return; }
    let p = got.get(m.id); if (!p) got.set(m.id, p = { n: m.n, have: 0, parts: [] });
    if (p.parts[m.i] == null) { p.parts[m.i] = m.s; p.have++; }
    if (p.have === p.n) { got.delete(m.id); try { deliver(JSON.parse(p.parts.join(''))); } catch (e) { console.warn('조각 메시지를 붙이지 못했어요', e); } }
  };
}

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  return (loading ??= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PEER_JS;
    s.onload = res; s.onerror = () => { loading = null; rej(new Error(T('PeerJS를 불러오지 못했어요(인터넷 연결 확인)', 'Could not load PeerJS (check the internet connection)'))); };
    document.head.appendChild(s);
  }));
}
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () => Array.from({ length: 5 }, () => ABC[(Math.random() * ABC.length) | 0]).join('');

// 중개 서버가 끊기면 조금씩 간격을 늘려 가며 다시 붙는다(방 코드는 그대로)
function keepSignal(peer, isDead) {
  let wait = 1500, t = 0;
  const relink = () => {
    if (t || isDead()) return;
    t = setTimeout(() => { t = 0; if (isDead() || !peer.disconnected || peer.destroyed) return; try { peer.reconnect(); } catch (e) { /* 다음에 다시 */ } }, wait);
    wait = Math.min(wait * 2, 15000);
  };
  peer.on('disconnected', relink);
  peer.on('open', () => { wait = 1500; });
  return relink;
}

// 방 만들기. cb: { status(s, detail), join(slot), leave(slot), data(msg, slot), held(slot) }  held: 끊긴 친구에게 남겨 둔 자리인지
// 들어온 연결은 빈 자리 번호를 받는다(1~7: 다시 들어온 친구는 인사(hello) 뒤에 move로 원래 자리로 옮긴다).
// 4명이 넘는지는 인사를 받은 뒤 main.js에서 판단한다(끊긴 줄 모르는 옛 연결 때문에 꽉 찼다고 거절하지 않게)
export async function hostRoom(cb) {
  await loadPeer();
  const code = makeCode();
  const conns = new Map(); // slot → 연결
  let dead = false, ready = false;
  const peer = new window.Peer(PREFIX + code);
  const link = {
    host: true, code, conns,
    send(slot, m) { const c = conns.get(slot); if (c && c.open && !c.muted) sendTo(c, pieces(m)); },
    broadcast(m, except = -1) { let list = null; for (const [s, c] of conns) if (s !== except && c.open && !c.muted) sendTo(c, list ??= pieces(m)); },
    // 판이 다른 친구: 연결은 두고(안내 글이 남게) 더는 아무것도 보내지 않는다
    mute(slot) { const c = conns.get(slot); if (c) c.muted = true; },
    kick(slot) { const c = conns.get(slot); if (c) c.close(); },
    // 알리고 끊기(꽉 참 등)
    drop(slot, m) { const c = conns.get(slot); if (!c) return; conns.delete(slot); c.slot = -1; if (c.open) c.send(m); setTimeout(() => c.close(), 400); },
    // 다시 들어온 친구의 새 연결을 원래 자리로. 그 자리에 남은 옛 연결은 조용히 닫는다
    move(from, to) {
      const c = conns.get(from); if (!c || from === to) return;
      const old = conns.get(to);
      conns.delete(from); c.slot = to; conns.set(to, c);
      if (old && old !== c) { old.slot = -1; try { old.close(); } catch (e) { /* 이미 닫힘 */ } }
    },
    close() { dead = true; try { peer.destroy(); } catch (e) { /* 이미 닫힘 */ } },
  };
  const relink = keepSignal(peer, () => dead);
  peer.on('open', () => { if (!dead && !ready) { ready = true; cb.status('ready'); } });
  peer.on('error', (e) => {
    if (dead) return;
    if (ready && SIGNAL_ERR.has(e.type)) { relink(); return; }
    cb.status('error', e.type || String(e));
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      if (dead) return;
      const slot = [1, 2, 3, 4, 5, 6, 7].find((s) => !conns.has(s) && !cb.held?.(s));
      if (!slot) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 400); return; }
      conn.slot = slot; conns.set(slot, conn);
      conn.on('data', joiner((m) => { if (!dead && conns.get(conn.slot) === conn) cb.data(m, conn.slot); }));
      conn.on('error', (e) => console.warn('연결 오류', conn.slot, e?.type || e));
      conn.on('close', () => { const s = conn.slot; if (conns.get(s) === conn) { conns.delete(s); if (!dead) cb.leave(s); } });
      cb.join(slot);
    });
  });
  return link;
}

// 방 들어가기. status: 'connected' | 'closed' | 'error'(detail: 'peer-unavailable' 코드 틀림, 'unreachable' 기기끼리 못 이음, 'timeout' 등)
export async function joinRoom(code, cb) {
  await loadPeer();
  let dead = false, opened = false, tries = 0, timer = 0, openTimer = 0;
  const peer = new window.Peer();
  const link = {
    host: false, code, conn: null,
    send(m) { if (this.conn && this.conn.open) sendTo(this.conn, pieces(m)); },
    close() { dead = true; clearTimeout(timer); clearTimeout(openTimer); try { peer.destroy(); } catch (e) { /* 이미 닫힘 */ } },
  };
  const fail = (why) => { if (dead) return; link.close(); cb.status('error', why); };
  // 기기끼리 잇기는 와이파이 사정에 따라 처음에 실패할 때가 있어서 몇 번 더 해 본다
  const attempt = () => {
    if (dead) return;
    tries++;
    const prev = link.conn; if (prev) { link.conn = null; try { prev.close(); } catch (e) { /* 이미 닫힘 */ } }
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    link.conn = conn;
    const retry = () => { if (dead || opened || link.conn !== conn) return; clearTimeout(timer); if (tries < TRIES) attempt(); else fail('unreachable'); };
    clearTimeout(timer); timer = setTimeout(retry, TRY_MS);
    conn.on('open', () => { if (dead || link.conn !== conn) return; opened = true; clearTimeout(timer); cb.status('connected'); });
    conn.on('data', joiner((m) => { if (!dead && link.conn === conn) cb.data(m, 0); }));
    conn.on('close', () => { if (dead || link.conn !== conn) return; if (opened) cb.status('closed'); else retry(); });
    conn.on('error', () => { if (!opened) retry(); });
  };
  openTimer = setTimeout(() => { if (!link.conn) fail('timeout'); }, 12000);
  const relink = keepSignal(peer, () => dead);
  peer.on('open', () => { if (!dead && !link.conn) { clearTimeout(openTimer); attempt(); } });
  peer.on('error', (e) => {
    if (dead) return;
    if (e.type === 'peer-unavailable') { if (!opened) fail('peer-unavailable'); return; }
    // 이미 이어졌으면 중개 서버 문제는 게임과 상관없다: 조용히 다시 붙는다
    if (SIGNAL_ERR.has(e.type) && (opened || link.conn)) { relink(); return; }
    if (!opened) fail(e.type || String(e));
  });
  return link;
}
