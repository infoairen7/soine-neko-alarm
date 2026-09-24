/* ---------------------------------------------------------------------
 * 4. 音声管理
 * -------------------------------------------------------------------*/
class AudioEngine {
  constructor(onChange) {
    this.onChange = onChange;
    this.ctx = null;
    this.error = '';
    this.vol = { purr: 0.45, alarm: 0.8 };
    this.purr = null;         // 再生中のゴロゴロ { src, g, t0, synced, dur }
    this.meowCur = null;      // 再生中の鳴き声（常に最大1つ）
    this.synth = null;        // { purr, meows[], chirp }
    this.voicePitch = 1;
    this.custom = { purr: null, purrName: '', meows: [], meowNames: [] };
    this.pending = { purr: null, meows: null };
    this.everRan = false;
  }
  get state() {
    if (this.error && !this.ctx) return 'error';
    if (!this.ctx) return 'none';
    return this.ctx.state; // running / suspended / interrupted / closed
  }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  _emit() { try { this.onChange(); } catch (e) { /* ignore */ } }
  static curve(v) { return v <= 0 ? 0 : Math.pow(clamp(v, 0, 1), 1.6); }

  // ユーザー操作の中で同期的に呼ぶこと（自動再生制限への対応）
  ensureContext() {
    if (this.ctx) return this.ctx;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.error = 'このブラウザは Web Audio に対応していません。'; this._emit(); return null; }
    try { this.ctx = new AC({ latencyHint: 'playback' }); } catch (e) {
      try { this.ctx = new AC(); } catch (e2) { this.error = '音声を初期化できませんでした。'; this._emit(); return null; }
    }
    const c = this.ctx;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -8; this.limiter.knee.value = 6; this.limiter.ratio.value = 10;
    this.limiter.attack.value = 0.004; this.limiter.release.value = 0.2;
    this.limiter.connect(c.destination);
    this.purrSwell = c.createGain(); this.purrSwell.connect(this.limiter);
    this.purrDuck = c.createGain(); this.purrDuck.connect(this.purrSwell);
    this.purrVol = c.createGain(); this.purrVol.gain.value = AudioEngine.curve(this.vol.purr) * 0.9; this.purrVol.connect(this.purrDuck);
    this.alarmVol = c.createGain(); this.alarmVol.gain.value = AudioEngine.curve(this.vol.alarm); this.alarmVol.connect(this.limiter);
    c.onstatechange = () => { if (c.state === 'running') this.everRan = true; this._emit(); };
    return c;
  }
  async unlock() {
    const c = this.ensureContext();
    if (!c) return false;
    try { const b = c.createBuffer(1, 1, c.sampleRate); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) { /* ignore */ }
    if (c.state !== 'running') {
      try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { this.error = String(e && e.message || e); }
    }
    if (c.state !== 'running') await new Promise((r) => setTimeout(r, 150));
    if (c.state === 'running') { this.everRan = true; this.error = ''; }
    if (!this.synth) this.buildSynth();
    await this.decodePending();
    this._emit();
    return c.state === 'running';
  }
  buildSynth() {
    const c = this.ctx, sr = c.sampleRate;
    const toBuf = (arr) => { const b = c.createBuffer(1, arr.length, sr); b.getChannelData(0).set(arr); return b; };
    this.synth = { purr: toBuf(Synth.purr(sr)), meows: [], chirp: null };
    this.setVoice(this.voicePitch, true);
  }
  setVoice(pitch, force) {
    if (!force && Math.abs(pitch - this.voicePitch) < 1e-3 && this.synth && this.synth.meows.length) return;
    this.voicePitch = pitch;
    if (!this.ctx || !this.synth) return;
    const sr = this.ctx.sampleRate;
    const toBuf = (arr) => { const b = this.ctx.createBuffer(1, arr.length, sr); b.getChannelData(0).set(arr); return b; };
    this.synth.meows = Synth.meowSet(pitch).map((p) => toBuf(Synth.meow(sr, p)));
    this.synth.chirp = toBuf(Synth.meow(sr, Synth.chirp(pitch)));
  }
  setVolumes(purr, alarm) {
    this.vol.purr = purr; this.vol.alarm = alarm;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.purrVol.gain.setTargetAtTime(AudioEngine.curve(purr) * 0.9, t, 0.06);
    this.alarmVol.gain.setTargetAtTime(AudioEngine.curve(alarm), t, 0.06);
  }

  // --- ゴロゴロ音 ---
  get purrPlaying() { return !!this.purr; }
  startPurr() {
    if (!this.running || this.purr) return !!this.purr;
    const c = this.ctx;
    const buf = this.custom.purr || this.synth.purr;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(this.purrVol);
    const t = c.currentTime + 0.05;
    src.start(t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 1.8);
    this.purr = { src, g, t0: t, synced: buf === this.synth.purr, dur: buf.duration };
    this._emit();
    return true;
  }
  stopPurr(fade = 0.7) {
    const p = this.purr; if (!p) return;
    this.purr = null;
    const t = this.ctx.currentTime;
    try { p.g.gain.cancelScheduledValues(t); p.g.gain.setValueAtTime(p.g.gain.value, t); p.g.gain.linearRampToValueAtTime(0, t + fade); p.src.stop(t + fade + 0.05); } catch (e) { /* ignore */ }
    this._emit();
  }
  restartPurrIfPlaying() { if (this.purr) { this.stopPurr(0.25); setTimeout(() => this.startPurr(), 300); } }
  // 呼吸の見た目を音に合わせるための時刻（合成音のときだけ）
  purrClock() {
    const p = this.purr;
    if (!p || !p.synced || !this.running) return null;
    const t = this.ctx.currentTime - p.t0;
    return t < 0 ? null : t % p.dur;
  }
  duck(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.purrDuck.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? 0.22 : 1, t + (on ? 0.5 : 2.0));
  }
  swell() {
    if (!this.running) return;
    const t = this.ctx.currentTime, g = this.purrSwell.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1.35, t + 0.35); g.setValueAtTime(1.35, t + 2.2); g.linearRampToValueAtTime(1, t + 3.8);
  }

  // --- 鳴き声（同時には1つだけ） ---
  meowList() { return this.custom.meows.length ? this.custom.meows : (this.synth ? this.synth.meows : []); }
  playMeow({ variant = 0, gain = 1 } = {}) {
    if (!this.running) return null;
    const list = this.meowList(); if (!list.length) return null;
    this.stopMeow(0.02);
    const c = this.ctx;
    const buf = list[variant % list.length];
    const dur = Math.min(buf.duration, 4);
    const src = c.createBufferSource(); src.buffer = buf;
    const env = c.createGain();
    const t = c.currentTime + 0.05;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.012);
    env.gain.setValueAtTime(gain, Math.max(t + 0.013, t + dur - 0.025));
    env.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(env); env.connect(this.alarmVol);
    src.start(t); src.stop(t + dur + 0.02);
    const cur = { src, env };
    this.meowCur = cur;
    src.onended = () => { if (this.meowCur === cur) this.meowCur = null; };
    return { delay: t - c.currentTime, duration: dur, env: this.envOf(buf) };
  }
  stopMeow(fade = 0.04) {
    const m = this.meowCur; if (!m || !this.ctx) return;
    this.meowCur = null;
    const t = this.ctx.currentTime;
    try { m.env.gain.cancelScheduledValues(t); m.env.gain.setValueAtTime(m.env.gain.value, t); m.env.gain.linearRampToValueAtTime(0, t + fade); m.src.stop(t + fade + 0.01); } catch (e) { /* ignore */ }
  }
  chirp() {
    if (!this.running || !this.synth || !this.synth.chirp || this.custom.meows.length) return;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.synth.chirp;
    const g = c.createGain(); g.gain.value = 0.55;
    src.connect(g); g.connect(this.purrVol);
    src.start(c.currentTime + 0.03);
  }

  envOf(buf) {
    if (!this._envs) this._envs = new WeakMap();
    let e = this._envs.get(buf);
    if (!e) { e = envelopeOf(buf); this._envs.set(buf, e); }
    return e;
  }
  // --- 差し替え音声 ---
  async decode(ab) {
    return await new Promise((res, rej) => {
      try { const p = this.ctx.decodeAudioData(ab.slice(0), res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); }
    });
  }
  _process(buf, { loop }) {
    const c = this.ctx, sr = buf.sampleRate, ch = buf.numberOfChannels;
    let peak = 0;
    for (let k = 0; k < ch; k++) { const d = buf.getChannelData(k); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
    const gain = peak > 0 ? 0.9 / peak : 1;
    if (loop && buf.duration > 1) {
      const n = Math.floor(Math.min(0.3, buf.duration / 4) * sr), L = buf.length - n;
      const out = c.createBuffer(ch, L, sr);
      for (let k = 0; k < ch; k++) {
        const d = buf.getChannelData(k), o = out.getChannelData(k);
        for (let i = 0; i < L; i++) o[i] = d[i] * gain;
        for (let i = 0; i < n; i++) { const u = i / n; o[i] = (d[i] * Math.sqrt(u) + d[L + i] * Math.sqrt(1 - u)) * gain; }
      }
      return out;
    }
    const out = c.createBuffer(ch, buf.length, sr), f = Math.max(1, Math.floor(0.008 * sr));
    for (let k = 0; k < ch; k++) {
      const d = buf.getChannelData(k), o = out.getChannelData(k);
      for (let i = 0; i < d.length; i++) o[i] = d[i] * gain;
      for (let i = 0; i < f && i < o.length; i++) { o[i] *= i / f; o[o.length - 1 - i] *= i / f; }
    }
    return out;
  }
  async setCustomPurr(ab, name) {
    if (!ab) { this.custom.purr = null; this.custom.purrName = ''; this.pending.purr = null; this.restartPurrIfPlaying(); this._emit(); return true; }
    if (!this.ctx) { this.pending.purr = { ab, name }; this.custom.purrName = name; this._emit(); return true; }
    const buf = this._process(await this.decode(ab), { loop: true });
    this.custom.purr = buf; this.custom.purrName = name; this.pending.purr = null;
    this.restartPurrIfPlaying(); this._emit();
    return true;
  }
  async setCustomMeows(list) { // [{ab, name}]
    if (!list || !list.length) { this.custom.meows = []; this.custom.meowNames = []; this.pending.meows = null; this._emit(); return true; }
    if (!this.ctx) { this.pending.meows = list; this.custom.meowNames = list.map((x) => x.name); this._emit(); return true; }
    const bufs = [];
    for (const x of list) bufs.push(this._process(await this.decode(x.ab), { loop: false }));
    this.custom.meows = bufs; this.custom.meowNames = list.map((x) => x.name); this.pending.meows = null;
    this._emit();
    return true;
  }
  async decodePending() {
    try { if (this.pending.purr) await this.setCustomPurr(this.pending.purr.ab, this.pending.purr.name); } catch (e) { this.pending.purr = null; this.custom.purrName = ''; this.lastDecodeError = 'ゴロゴロ音のファイルを読み込めませんでした。'; }
    try { if (this.pending.meows) await this.setCustomMeows(this.pending.meows); } catch (e) { this.pending.meows = null; this.custom.meowNames = []; this.lastDecodeError = '鳴き声のファイルを読み込めませんでした。'; }
  }
  get purrIsCustom() { return !!(this.custom.purr || this.pending.purr); }
  get meowIsCustom() { return !!(this.custom.meows.length || this.pending.meows); }
}

