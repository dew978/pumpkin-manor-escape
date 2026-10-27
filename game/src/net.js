// 협동 연결(WebRTC, PeerJS). 방파제 포격대와 같은 방식.
// 방장이 방 코드를 이름으로 한 문을 열고 친구들은 그 코드로 들어온다. 서로를 찾을 때만 PeerJS 공개 중개 서버를 거치고,
// 게임 데이터는 기기끼리 직접 오간다. 방장 기기가 괴물·시간·쪽지를 계산하고 친구 기기는 받아서 그린다.
const PEER_JS = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'pumpkin-escape-';
export const MAX_PLAYERS = 4;

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  return (loading ??= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PEER_JS;
    s.onload = res; s.onerror = () => { loading = null; rej(new Error('PeerJS를 불러오지 못했어요(인터넷 연결 확인)')); };
    document.head.appendChild(s);
  }));
}
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () => Array.from({ length: 5 }, () => ABC[(Math.random() * ABC.length) | 0]).join('');

// 방 만들기. cb: { status(s, detail), join(slot), leave(slot), data(msg, slot) }
export async function hostRoom(cb) {
  await loadPeer();
  const code = makeCode();
  const conns = new Map(); // slot(1~3) → 연결
  let dead = false;
  const peer = new window.Peer(PREFIX + code);
  const link = {
    host: true, code, conns,
    send(slot, m) { const c = conns.get(slot); if (c && c.open) c.send(m); },
    broadcast(m, except = -1) { for (const [s, c] of conns) if (s !== except && c.open) c.send(m); },
    kick(slot) { const c = conns.get(slot); if (c) c.close(); },
    close() { dead = true; try { peer.destroy(); } catch (e) { /* 이미 닫힘 */ } },
  };
  peer.on('open', () => { if (!dead) cb.status('ready'); });
  peer.on('error', (e) => { if (!dead) cb.status('error', e.type || String(e)); });
  peer.on('disconnected', () => { if (!dead) { try { peer.reconnect(); } catch (e) { /* 이미 닫힘 */ } } });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      if (dead) return;
      const slot = [1, 2, 3].find((s) => !conns.has(s));
      if (!slot) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 400); return; }
      conns.set(slot, conn);
      conn.on('data', (m) => { if (!dead && conns.get(slot) === conn) cb.data(m, slot); });
      conn.on('close', () => { if (conns.get(slot) === conn) { conns.delete(slot); if (!dead) cb.leave(slot); } });
      cb.join(slot);
    });
  });
  return link;
}

// 방 들어가기. status: 'connected' | 'closed' | 'error'
export async function joinRoom(code, cb) {
  await loadPeer();
  let dead = false, opened = false;
  const peer = new window.Peer();
  const link = {
    host: false, code, conn: null,
    send(m) { if (this.conn && this.conn.open) this.conn.send(m); },
    close() { dead = true; try { peer.destroy(); } catch (e) { /* 이미 닫힘 */ } },
  };
  const timer = setTimeout(() => { if (!opened && !dead) { cb.status('error', 'timeout'); link.close(); } }, 12000);
  peer.on('open', () => {
    if (dead) return;
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    link.conn = conn;
    conn.on('open', () => { opened = true; clearTimeout(timer); if (!dead) cb.status('connected'); });
    conn.on('data', (m) => { if (!dead) cb.data(m, 0); });
    conn.on('close', () => { if (!dead) cb.status('closed'); });
    conn.on('error', (e) => { if (!dead) cb.status('error', e.type || String(e)); });
  });
  peer.on('error', (e) => { if (!dead) { clearTimeout(timer); cb.status('error', e.type || String(e)); } });
  return link;
}
