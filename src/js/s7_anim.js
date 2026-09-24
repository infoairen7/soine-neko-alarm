/* ---------------------------------------------------------------------
 * 7. 猫の状態管理（アニメーション）
 *   表情や体の動きを「値」として持ち、ばね（spring）となめらかな補間で動かします。
 *   眠る → 薄目 → 目を開ける → まばたき／ゆっくりまばたき → 舐める → 鳴く を
 *   画像の切り替えではなく、まぶた・あご・舌・耳・頭の動きとして表現します。
 * -------------------------------------------------------------------*/
class Spring {
  constructor(k, z) { this.k = k; this.z = z; this.x = 0; this.v = 0; this.t = 0; }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, c = 2 * Math.sqrt(this.k) * this.z;
    for (let i = 0; i < n; i++) { const a = this.k * (this.t - this.x) - c * this.v; this.v += a * h; this.x += this.v * h; }
  }
  get busy() { return Math.abs(this.v) > 0.02 || Math.abs(this.t - this.x) > 0.02; }
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
function tw(v) { return { from: v, to: v, t0: 0, dur: 0, ease: easeInOut }; }
function twSet(o, to, sec, now, ease) { o.from = twGet(o, now); o.to = to; o.t0 = now; o.dur = Math.max(1, sec * 1000); o.ease = ease || easeInOut; }
function twGet(o, now) { if (!o.dur) return o.to; const t = clamp((now - o.t0) / o.dur, 0, 1); return o.from + (o.to - o.from) * o.ease(t); }
function twBusy(o, now) { return !!o.dur && now - o.t0 < o.dur; }

class Animator {
  constructor(app) { this.app = app; this.reset(); }
  get cat() { return this.app.cat; }
  get pers() { return PERSONALITIES[this.cat && this.cat.profile.personality] || PERSONALITIES.odayaka; }
  now() { return this.app.now(); }
  m() { return this.app.motionFactor(); }
  reset() {
    const now = this.now();
    this.mode = 'idle'; this.action = ''; this.steps = [];
    this.base2 = tw(0); this.awake = tw(0); this.lidBase = tw(0); this.tongue = tw(0);
    this.blinks = []; this.bumps = [];
    this.head = [new Spring(38, 0.9), new Spring(38, 0.9)]; this.headRot = new Spring(30, 0.95);
    this.ears = [new Spring(420, 0.3), new Spring(420, 0.3)];
    this.nose = [new Spring(900, 0.45), new Spring(900, 0.45)];
    this.tail = [new Spring(140, 0.4), new Spring(140, 0.4)];
    this.paw = [new Spring(70, 0.8), new Spring(70, 0.8)];
    this.speech = null; this.meowIdx = 0;
    this.nextIdle = now + rand(7, 15) * 1000;
    this.nextLick = now + rand(30, 70) * 1000;
    this.nextEar = now + rand(3, 9) * 1000;
    this.nextNose = now + rand(15, 40) * 1000;
    this.nextTail = now + rand(12, 35) * 1000;
    this.nextFlutter = now + rand(25, 60) * 1000;
    this.nextDream = now + rand(50, 120) * 1000;
    this.lastReact = 0; this.lastT = now;
  }
  // --- 部品 ---
  headTo(x, y, rotDeg = 0) { const k = this.m(); this.head[0].t = x * k; this.head[1].t = y * k; this.headRot.t = rotDeg * k; }
  pawTo(x, y) { const k = this.m(); this.paw[0].t = x * k; this.paw[1].t = y * k; }
  earFlick(i, strength = 1, dbl = false) {
    if (this.m() < 0.5 || !this.cat || !this.cat.rig.ears.length) return;
    const dir = i === 0 ? -1 : 1, v = dir * rand(240, 340) * strength * Math.min(1, this.m());
    this.ears[i].v += v;
    if (dbl) this.later(0.12, () => { this.ears[i].v += v * 0.8; });
  }
  sniff() {
    if (this.m() < 0.5) return;
    for (let j = 0; j < 3; j++) this.later(j * 0.13, () => { this.nose[1].v -= 55 * this.m(); this.nose[0].v += 12 * this.m(); });
  }
  tailFlick() { if (this.m() < 0.5) return; this.tail[0].v += (Math.random() < 0.5 ? -1 : 1) * rand(40, 70) * this.m(); this.tail[1].v += rand(-25, 25) * this.m(); }
  blink(kind = 'quick', depth = 1) {
    const now = this.now();
    const sp = kind === 'slow' ? { c: 420, h: 380, o: 560 } : { c: 75, h: 35, o: 150 };
    this.blinks.push({ t0: now, ...sp, depth });
  }
  flutter() { const now = this.now(); this.bumps.push({ t0: now, dur: 260, amp: 0.13 }, { t0: now + 380, dur: 220, amp: 0.09 }); }
  later(sec, fn) { this.steps.push({ at: this.now() + sec * 1000, run: fn }); this.steps.sort((a, b) => a.at - b.at); }
  // 声に合わせて口を動かす（env は 10ms ごとの音量）
  speak(delaySec, dur, env) {
    const t0 = this.now() + delaySec * 1000;
    this.speech = { t0, dur: dur * 1000, env };
    this.meowIdx = (this.meowIdx + 1) % 2;
    const k = this.m();
    this.later(delaySec, () => { this.head[1].v -= 14 * k; this.headRot.v -= 6 * k; });
  }
  mouthAt(now) {
    const s = this.speech; if (!s) return 0;
    const t = now - s.t0;
    if (t < 0) return 0;
    if (t > s.dur + 120) { this.speech = null; return 0; }
    let e;
    if (s.env && s.env.length) { const i = Math.min(s.env.length - 1, Math.floor(t / 10)); e = s.env[i]; }
    else { const x = t / s.dur; e = x > 1 ? 0 : Math.sin(Math.PI * Math.min(1, x)) ** 0.7; }
    const x = t / s.dur;
    const closeIn = x < 0.06 ? x / 0.06 : 1;                    // 「ン」から開く
    return clamp((e - 0.06) / 0.5, 0, 1) * closeIn;
  }
  lidAt(i, now) {
    let base = twGet(this.lidBase, now);
    for (const b of this.bumps) { const t = (now - b.t0) / b.dur; if (t > 0 && t < 1) base += b.amp * Math.sin(Math.PI * t); }
    let close = 0;
    const lag = i === 1 ? 25 : 0;
    for (const b of this.blinks) {
      const t = now - b.t0 - lag;
      let c = 0;
      if (t < 0) c = 0;
      else if (t < b.c) c = easeIn(t / b.c);
      else if (t < b.c + b.h) c = 1;
      else if (t < b.c + b.h + b.o) c = 1 - easeOut((t - b.c - b.h) / b.o);
      close = Math.max(close, c * b.depth);
    }
    return clamp(base * (1 - close), 0, 1);
  }
  // --- 行動 ---
  scheduleIdle(now, afterAction) {
    let gap = randIn(this.pers.idleGap) * 1000;
    if (this.app.reducedMotion()) gap *= 1.8;
    if (afterAction) gap += randIn(this.pers.restAfter) * 1000;
    this.nextIdle = now + gap;
  }
  pickIdle() {
    const w = this.pers.weights;
    const items = [['wake', w.wake], ['peek', w.peek], ['rehug', w.rehug]];
    if (this.cat.has.sleep2) items.push(['turn', w.turn]);
    const total = items.reduce((a, b) => a + b[1], 0);
    let r = Math.random() * total;
    for (const [n, v] of items) { if ((r -= v) <= 0) return n; }
    return 'peek';
  }
  start(name, list) {
    const now = this.now();
    this.mode = 'action'; this.action = name;
    this.steps = (list || this.build(name)).map((s) => ({ at: now + s.t * 1000, run: s.run })).sort((a, b) => a.at - b.at);
  }
  build(name) {
    const P = this.pers, T = P.tempo, s = (t, run) => ({ t: t * T, run });
    const now = () => this.now();
    if (name === 'wake') {           // 目を開けて、腕に甘える
      const hold = randIn(P.awakeHold);
      const list = [
        s(0, () => { twSet(this.awake, 1, 1.0 * T, now()); this.headTo(-1.0, -1.6, -1.2); this.earFlick(Math.random() < 0.5 ? 0 : 1, 0.6); }),
        s(0.3, () => twSet(this.lidBase, 0.45, 0.5 * T, now(), easeOut)),
        s(1.0, () => twSet(this.lidBase, 1, 0.45 * T, now(), easeOut)),
        s(1.0 + hold * 0.45, () => this.headTo(-2.0, 0.8, 1.0)),          // 腕に顔をすり寄せる
        s(1.0 + hold * 0.75, () => this.headTo(-0.6, -0.4, 0)),
        s(1.0 + hold, () => twSet(this.lidBase, 0.35, 0.6 * T, now())),
        s(1.9 + hold, () => { twSet(this.lidBase, 0, 1.0 * T, now()); twSet(this.awake, 0, 1.5 * T, now()); this.headTo(0, 0, 0); }),
        s(3.6 + hold, () => {}),
      ];
      const nb = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < nb; i++) list.push(s(1.6 + rand(0.1, 0.8) * hold, () => this.blink('quick')));
      if (Math.random() < 0.45) list.push(s(1.4 + hold * 0.55, () => this.blink('slow', 0.85)));
      return list;
    }
    if (name === 'peek') {           // 薄目をあけて、また眠る
      const hold = rand(1.4, 3.4), amt = rand(0.26, 0.42);
      return [
        s(0, () => { twSet(this.lidBase, amt, 1.0 * T, now(), easeOut); this.earFlick(Math.random() < 0.5 ? 0 : 1, 0.5); }),
        s(1.0 + hold * 0.5, () => { if (Math.random() < 0.5) this.blink('slow', 0.9); }),
        s(1.0 + hold, () => twSet(this.lidBase, 0, 1.3 * T, now())),
        s(2.5 + hold, () => {}),
      ];
    }
    if (name === 'rehug') {          // 前足で腕を抱き直す
      return [
        s(0, () => { this.pawTo(1.8, -1.2); this.headTo(-0.8, 0.6, 0.6); }),
        s(0.6, () => { if (Math.random() < 0.5 && this.cat.has.sleep2) twSet(this.base2, this.base2.to > 0.5 ? 0 : 1, 0.9 * T, now()); }),
        s(1.2, () => { this.pawTo(0, 0); }),
        s(1.8, () => { this.headTo(0, 0, 0); }),
        s(3.0, () => {}),
      ];
    }
    if (name === 'turn') {           // 寝顔が少し変わる
      return [
        s(0, () => { twSet(this.base2, this.base2.to > 0.5 ? 0 : 1, 1.0 * T, now()); this.headTo(0.8, -0.5, 0.8); }),
        s(1.2, () => this.headTo(0, 0, 0)),
        s(2.6, () => {}),
      ];
    }
    if (name === 'lick') {           // 腕をぺろっと舐める
      const n = 1 + Math.floor(Math.random() * 3), list = [s(0, () => this.headTo(-2.4, 1.8, -1.0))];
      let t = 0.45;
      for (let i = 0; i < n; i++) {
        list.push(s(t, () => { twSet(this.tongue, 1, 0.13, now(), easeOut); this.head[1].v += 10 * this.m(); }));
        list.push(s(t + 0.24, () => twSet(this.tongue, 0, 0.16, now(), easeIn)));
        t += 0.55;
      }
      list.push(s(t + 0.1, () => this.headTo(0, 0, 0)));
      if (Math.random() < 0.4) {
        list.push(s(t + 0.4, () => twSet(this.lidBase, 0.3, 0.6, now(), easeOut)));
        list.push(s(t + 2.0, () => twSet(this.lidBase, 0, 1.0, now())));
        t += 2.0;
      }
      list.push(s(t + 1.2, () => {}));
      return list;
    }
    return [s(0, () => {})];
  }
  // 猫を軽くタップしたとき（アラームとは別）
  react(side) {
    if (this.mode === 'alarm') return false;
    const now = this.now();
    if (now - this.lastReact < 1500) return false;
    this.lastReact = now;
    const hold = rand(2.6, 4.2);
    this.start('react', [
      { t: 0, run: () => { this.earFlick(side, 0.9); twSet(this.awake, 0.85, 0.5, this.now()); this.headTo(-1.2, -0.8, -1.0); } },
      { t: 0.12, run: () => twSet(this.lidBase, 1, 0.35, this.now(), easeOut) },
      { t: 1.1, run: () => this.blink('slow', 0.85) },
      { t: 1.8, run: () => this.headTo(-1.8, 0.8, 0.8) },
      { t: hold, run: () => twSet(this.lidBase, 0.35, 0.6, this.now()) },
      { t: hold + 0.9, run: () => { twSet(this.lidBase, 0, 1.0, this.now()); twSet(this.awake, 0, 1.4, this.now()); this.headTo(0, 0, 0); } },
      { t: hold + 2.4, run: () => {} },
    ]);
    return true;
  }
  // 「音を試す」のとき、声に合わせて口を開ける
  meowOnce(delay, dur, env) {
    if (this.mode === 'alarm') return;
    const k = Math.max(0.16, delay);
    this.start('test', [
      { t: 0, run: () => { twSet(this.awake, 1, 0.35, this.now()); twSet(this.lidBase, 1, 0.3, this.now(), easeOut); this.headTo(0.3, -2.2, -1.5); } },
      { t: 0, run: () => this.speak(k, dur, env) },
      { t: k + dur + 1.2, run: () => twSet(this.lidBase, 0.35, 0.5, this.now()) },
      { t: k + dur + 1.9, run: () => { twSet(this.lidBase, 0, 0.9, this.now()); twSet(this.awake, 0, 1.2, this.now()); this.headTo(0, 0, 0); } },
      { t: k + dur + 3.2, run: () => {} },
    ]);
  }
  // アラームはすべての通常行動より優先
  enterAlarm() {
    const now = this.now();
    this.steps = []; this.mode = 'alarm'; this.action = 'alarm';
    twSet(this.awake, 1, 0.35, now); twSet(this.lidBase, 1, 0.28, now + 80, easeOut); twSet(this.tongue, 0, 0.1, now);
    this.headTo(0.4, -3.0, -2.0); this.pawTo(0, 0);
    this.earFlick(0, 0.8); this.earFlick(1, 0.8);
    this.nextAlarmBlink = now + rand(1.5, 3) * 1000;
  }
  pat() {   // 前足で腕をトントン
    if (this.mode !== 'alarm') return;
    this.pawTo(-2.4, 1.3); this.later(0.18, () => this.pawTo(0.4, -0.3));
    this.later(0.42, () => this.pawTo(-2.2, 1.2)); this.later(0.62, () => this.pawTo(0, 0));
  }
  exitAlarm() {
    if (this.mode !== 'alarm') return;
    this.speech = null;
    this.start('calm', [
      { t: 0, run: () => { this.headTo(-1.0, 0.4, 0.6); this.pawTo(0, 0); } },
      { t: 2.4, run: () => twSet(this.lidBase, 0.35, 0.7, this.now()) },
      { t: 3.4, run: () => { twSet(this.lidBase, 0, 1.1, this.now()); twSet(this.awake, 0, 1.5, this.now()); this.headTo(0, 0, 0); } },
      { t: 5.0, run: () => {} },
    ]);
  }
  update(now) {
    let dt = (now - this.lastT) / 1000;
    if (dt > 3 && this.mode === 'action') {
      // タブに戻ったとき、途中の動作をまとめて再生しない
      this.steps = []; this.mode = 'idle'; this.action = '';
      for (const o of [this.awake, this.lidBase, this.tongue]) { o.from = o.to = 0; o.dur = 0; }
      this.headTo(0, 0, 0); this.pawTo(0, 0);
      this.scheduleIdle(now, true);
    }
    this.lastT = now;
    dt = clamp(dt, 0, 0.05);
    while (this.steps.length && this.steps[0].at <= now) this.steps.shift().run();
    if (this.mode === 'action' && !this.steps.some((s) => s.at > now)) { this.mode = 'idle'; this.action = ''; this.scheduleIdle(now, true); }
    this.blinks = this.blinks.filter((b) => now - b.t0 < b.c + b.h + b.o + 60);
    this.bumps = this.bumps.filter((b) => now - b.t0 < b.dur + 10);
    for (const s of [...this.head, this.headRot, ...this.ears, ...this.nose, ...this.tail, ...this.paw]) s.step(dt);
    if (this.mode === 'alarm') {
      if (now > this.nextAlarmBlink) { this.blink('quick'); this.nextAlarmBlink = now + rand(2.2, 5) * 1000; }
      return;
    }
    if (this.mode !== 'idle' || !this.cat) return;
    if (!this.app.idleAllowed()) { this.nextIdle = Math.max(this.nextIdle, now + 3000); this.nextLick = Math.max(this.nextLick, now + 3000); return; }
    // ごく小さな動き（耳・鼻・しっぽ・夢を見るまぶた）
    const sleeping = twGet(this.awake, now) < 0.05 && twGet(this.lidBase, now) < 0.05;
    if (now > this.nextEar) { this.earFlick(Math.random() < 0.5 ? 0 : 1, rand(0.5, 1), Math.random() < 0.3); this.nextEar = now + rand(5, 22) * 1000; }
    if (now > this.nextNose) { this.sniff(); this.nextNose = now + rand(25, 70) * 1000; }
    if (now > this.nextTail) { this.tailFlick(); this.nextTail = now + rand(18, 55) * 1000; }
    if (now > this.nextFlutter) { if (sleeping && this.m() >= 0.5) this.flutter(); this.nextFlutter = now + rand(35, 90) * 1000; }
    if (now > this.nextDream) { if (sleeping && this.m() >= 0.5) { this.paw[0].v += rand(8, 14) * this.m(); this.paw[1].v -= rand(4, 8) * this.m(); } this.nextDream = now + rand(60, 150) * 1000; }
    if (now >= this.nextLick) {
      if (this.cat.has.lick) this.start('lick');
      this.nextLick = now + randIn(this.pers.lickGap) * 1000;
      this.nextIdle = Math.max(this.nextIdle, now + (4 + randIn(this.pers.restAfter)) * 1000);
    } else if (now >= this.nextIdle) {
      this.start(this.pickIdle());
    }
  }
  renderState(now) {
    const k = this.m();
    const t = now / 1000;
    let breath01 = 0;
    if (k > 0) { const pc = this.app.audio.purrClock(); breath01 = breathAt(pc != null ? pc : t); }
    // 呼吸に合わせて頭もわずかに上下し、ゆっくり揺れる
    const sway = [0.45 * Math.sin(0.21 * t) + 0.25 * Math.sin(0.57 * t + 1.3), 0.35 * Math.sin(0.17 * t + 0.4) + 0.2 * Math.sin(0.49 * t + 2.1)];
    const head = [this.head[0].x + (sway[0] + 0.25 * breath01) * k, this.head[1].x + (sway[1] - 0.6 * breath01) * k];
    const headRot = this.headRot.x + 0.35 * Math.sin(0.13 * t + 0.7) * k;
    const lid = [this.lidAt(0, now), this.lidAt(1, now)];
    const mouth = this.mouthAt(now);
    const st = {
      base2: twGet(this.base2, now), awake: twGet(this.awake, now), lid, mouth, meowIdx: this.meowIdx,
      tongue: twGet(this.tongue, now), breath: BREATH_AMP * k * breath01,
      head, headRot, ears: [this.ears[0].x, this.ears[1].x],
      nose: [this.nose[0].x, this.nose[1].x], tail: [this.tail[0].x, this.tail[1].x], paw: [this.paw[0].x, this.paw[1].x],
    };
    st.animating = !!this.speech || this.blinks.length > 0 || this.bumps.length > 0
      || [this.base2, this.awake, this.lidBase, this.tongue].some((o) => twBusy(o, now))
      || [...this.head, this.headRot, ...this.ears, ...this.nose, ...this.tail, ...this.paw].some((s) => s.busy);
    return st;
  }
}

