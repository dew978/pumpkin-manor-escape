// 소리: 생성 효과음(assets/audio)과 Web Audio 합성음. 괴물 소리는 거리에 따라 작아진다.
import { store } from './util.js';

const NAMES = ['title_music', 'pickup', 'door_open', 'bell', 'spotted', 'caught', 'ambience', 'paper', 'screech', 'growl', 'cage', 'skitter', 'gate', 'creak', 'witch_laugh', 'wolf_howl', 'owl_hoot'];

export const Sound = {
  ctx: null, master: null, buffers: {}, muted: store.get('pumpkin2-mute') === '1', ambTimer: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(this.ctx.destination);
    for (const n of NAMES) fetch(`assets/audio/${n}.mp3`).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b))
      .then(buf => { this.buffers[n] = buf; if (n === 'ambience') this.startAmb(); if (n === 'title_music' && this.musicOn) this.music(true); }).catch(() => { /* 소리 없이 진행 */ });
  },
  play(n, vol = 1, rate = 1) {
    const buf = this.buffers[n]; if (!this.ctx || !buf || vol <= 0.01) return;
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol; s.connect(g).connect(this.master); s.start();
  },
  // 왼쪽·오른쪽 어느 한쪽 멀리서 들리게(pan −1~1)
  playPan(n, vol = 1, pan = 0, rate = 1) {
    const buf = this.buffers[n]; if (!this.ctx || !buf || vol <= 0.01) return;
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; s.connect(g).connect(p).connect(this.master); } else s.connect(g).connect(this.master);
    s.start();
  },
  // 듣는 사람(내 학생)과의 거리로 크기를 정한다
  playAt(n, x, z, lx, lz, vol = 1, range = 15) {
    const d = Math.hypot(x - lx, z - lz);
    this.play(n, vol * Math.max(0, 1 - d / range) ** 1.4);
  },
  startAmb() {
    const buf = this.buffers.ambience; if (!this.ctx || !buf || this.ambTimer) return;
    let next = this.ctx.currentTime + 0.05; const step = buf.duration - 0.6;
    const tick = () => {
      while (next < this.ctx.currentTime + 1.5) {
        const s = this.ctx.createBufferSource(); s.buffer = buf; const g = this.ctx.createGain(); g.gain.value = 0.5;
        s.connect(g).connect(this.master); s.start(next); next += step;
      }
      this.ambTimer = setTimeout(tick, 500);
    };
    tick();
  },
  tone(freqs, { type = 'sine', dur = 0.14, gap = 0.1, vol = 0.18 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type; o.frequency.value = f;
      const t = t0 + i * gap; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    });
  },
  // 타이틀 음악: 파일 끝의 페이드가 다음 회차 시작과 2초 겹치게 이어 튼다
  music(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (!this.musicGain) { this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(this.master); }
    const g = this.musicGain.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(on ? 0.55 : 0, now + (on ? 1.5 : 0.8));
    const buf = this.buffers.title_music;
    if (!on || !buf || this.musicTimer) return;
    let next = now + 0.05; const step = buf.duration - 2;
    const tick = () => {
      if (!this.musicOn) { this.musicTimer = 0; return; }
      while (next < this.ctx.currentTime + 2) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.musicGain); s.start(next); next += step; }
      this.musicTimer = setTimeout(tick, 600);
    };
    tick();
  },
  heart(v) { this.tone([58, 50], { gap: 0.15, dur: 0.17, vol: 0.2 + 0.35 * v }); },
  ok() { this.tone([660, 880, 1175], { gap: 0.09, dur: 0.22 }); },
  bad() { this.tone([190, 150], { type: 'square', gap: 0.12, dur: 0.16, vol: 0.07 }); },
  fanfare() { this.tone([523, 659, 784, 1047, 784, 1047], { type: 'triangle', gap: 0.11, dur: 0.3, vol: 0.16 }); },
  setMuted(m) { this.muted = m; store.set('pumpkin2-mute', m ? '1' : '0'); if (this.master) this.master.gain.value = m ? 0 : 1; },
};
