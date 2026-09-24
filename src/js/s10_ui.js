/* ---------------------------------------------------------------------
 * 10. 画面（UI）
 * -------------------------------------------------------------------*/
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const pad2 = (n) => String(n).padStart(2, '0');
function fmtHM(d) { return `${d.getHours()}:${pad2(d.getMinutes())}`; }
function hhmmOf(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtDate(d) { return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`; }
function relDay(ms, now = Date.now()) {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(ms); b.setHours(0, 0, 0, 0);
  const diff = Math.round((b - a) / 86400000);
  return diff === 0 ? '今日' : diff === 1 ? '明日' : diff === 2 ? 'あさって' : '';
}
function fmtRemain(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `あと${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `あと${m}分`;
  return `あと${Math.floor(m / 60)}時間${m % 60}分`;
}
function edgeColorOf(img) {
  try {
    const c = makeCanvas(24, 24), g = ctx2d(c);
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      if (x > 1 && x < 22 && y > 1 && y < 22) continue;
      const i = (y * 24 + x) * 4; if (d[i + 3] < 128) continue;
      r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return [0.8, 0.78, 0.75];
    return [r / n / 255, gg / n / 255, b / n / 255];
  } catch (e) { return [0.8, 0.78, 0.75]; }
}

class App {
  async init() {
    Settings.load();
    this.s = Settings.data;
    try { document.documentElement.lang = 'ja'; } catch (e) { /* ignore */ }
    this.baseTitle = document.title || '添い寝ねこアラーム';
    this.canvas = $('stage'); this.sceneEl = $('scene'); this.panel = $('panel');
    this.audio = new AudioEngine(() => this.renderStatus());
    this.audio.setVolumes(this.s.volPurr / 100, this.s.volAlarm / 100);
    this.wake = new WakeLockManager(() => this.renderStatus());
    this.alarm = new AlarmManager(this);
    this.ringer = new Ringer(this);
    this.renderer = GLRenderer.create(this.canvas) || new Canvas2DRenderer(this.canvas);
    this.session = false;
    this.resumeNeeded = !!this.s.session;          // 再読込前に添い寝中だった
    this.savedCatId = this.s.catId;                // 追加した猫は、ファイルを読み込んでから選び直す
    this.builtinCache = new Map();
    this.customCats = new Map();
    this.soundTest = { token: 0, timers: [], startedPurr: false, active: false };
    this.catToken = 0;
    this.viewDirty = true; this.lastDraw = 0; this.lastSig = ''; this.lastCheck = 0;
    this.virtualNow = null;
    this.behavior = new Animator(this);
    const missed = this.alarm.restoreCheck();
    this.bindUI();
    this.applySettingsToInputs();
    this.applyNight();
    await this.loadDefaultScene();
    const first = CAT_PROFILES.find((p) => p.id === this.s.catId) || CAT_PROFILES[0];
    await this.selectCat(first.id, { initial: true });
    this.renderCatList();
    this.startLoop();
    this.tick();
    if (missed) this.toast(missed, 'bad', 10000);
    this.renderStatus();
    this.restoreFiles();
  }

  /* ----- 設定値 ----- */
  now() { return this.virtualNow != null ? this.virtualNow : performance.now(); }
  motionFactor() { return this.s.motionStop ? 0 : clamp(this.s.motion / 100, 0, 1.5); }
  reducedMotion() { return this.motionFactor() < 0.5; }
  idleAllowed() { return this.motionFactor() > 0 && !this.alarm.ringing; }

  /* ----- シーンと猫 ----- */
  async loadDefaultScene() {
    const src = ASSETS.images[DEFAULT_SCENE_KEY];
    let img = null;
    try { if (src) img = await loadImage(src); } catch (e) { img = null; }
    this.defaultScene = img ? { img, w: srcW(img), h: srcH(img), edge: edgeColorOf(img), feather: 60, name: '付属の腕の写真', custom: false }
                            : { img: null, w: 1254, h: 1254, edge: [0.8, 0.78, 0.75], feather: 0, name: '（読み込めませんでした）', custom: false };
    this.bgScene = this.defaultScene;
  }
  effectiveScene() {
    const c = this.cat;
    if (c && c.mode === 'full') {
      if (!c._scene) c._scene = { img: null, w: c.cellW, h: c.cellH, edge: edgeColorOf(c.frames.sleep), feather: 0 };
      return c._scene;
    }
    return this.bgScene;
  }
  updateScene() {
    const sc = this.effectiveScene();
    if (this.renderer.scene !== sc) this.renderer.setScene(sc);
    this.updateMatrix();
    this.syncPlacementInputs();
  }
  placementOf(cat) { return this.s.placement[cat.id] || cat.profile.placement; }
  updateMatrix() { this.M = placementMatrix(this.cat, this.placementOf(this.cat)); this.viewDirty = true; }
  async selectCat(id, { initial = false } = {}) {
    if (this.alarm.ringing && !initial) return;
    const token = ++this.catToken;
    let cat = null;
    const prof = CAT_PROFILES.find((p) => p.id === id);
    try {
      if (prof) { cat = this.builtinCache.get(id); if (!cat) { cat = await prepareBuiltinCat(prof); this.builtinCache.set(id, cat); } }
      else if (this.customCats.has(id)) cat = this.customCats.get(id).cat;
    } catch (e) { this.toast('猫の画像を読み込めませんでした。「猫の画像を追加・調整」から画像を選び直してください。', 'bad', 8000); return; }
    if (!cat || token !== this.catToken) return;
    this.cat = cat; this.catId = id;
    if (!initial || id === this.savedCatId) Settings.set({ catId: id });
    this.renderer.setCat(cat);
    this.behavior.reset();
    this.updateScene();
    this.audio.setVoice((cat.profile.voice && cat.profile.voice.pitch) || 1);
    const P = PERSONALITIES[cat.profile.personality] || PERSONALITIES.odayaka;
    $('catTrait').textContent = `${cat.profile.look}。個性：${P.label}（${P.note}）※演出上の設定です。`;
    if (!initial) this.renderCatList();
  }
  renderCatList() {
    const list = $('catList');
    list.textContent = '';
    const all = [
      ...CAT_PROFILES.map((p) => ({ id: p.id, name: p.name, thumb: ASSETS.images[p.thumb] || '' })),
      ...[...this.customCats.values()].map((c) => ({ id: c.cat.id, name: c.cat.profile.name, thumb: c.cat.thumb || '' })),
    ];
    list.classList.toggle('many', all.length > 3);
    for (const c of all) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cat-chip'; b.setAttribute('role', 'radio');
      const on = c.id === this.catId;
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.dataset.id = c.id;
      b.disabled = !!this.alarm.ringing;
      const im = document.createElement('img'); im.alt = ''; if (c.thumb) im.src = c.thumb;
      const sp = document.createElement('span'); sp.textContent = c.name;
      b.append(im, sp);
      b.addEventListener('click', () => this.selectCat(c.id));
      list.append(b);
    }
  }

  /* ----- 描画ループ ----- */
  startLoop() {
    const step = () => { requestAnimationFrame(step); if (this.virtualNow == null) this.frame(this.now()); };
    requestAnimationFrame(step);
    setInterval(() => this.alarm.check(), 1000);
    const ro = window.ResizeObserver ? new ResizeObserver(() => { this.viewDirty = true; }) : null;
    if (ro) { ro.observe(this.sceneEl); ro.observe(this.panel); }
    window.addEventListener('resize', () => { this.viewDirty = true; });
  }
  frame(now) {
    if (now - this.lastCheck > 250) { this.lastCheck = now; this.alarm.check(); }
    if (!this.cat) return;
    this.behavior.update(now);
    const st = this.behavior.renderState(now);
    if (!this.viewDirty && !st.animating && now - this.lastDraw < 50) return; // 静かなときは約20fps
    const sig = st.animating ? String(now) : `${st.breath.toFixed(3)}|${st.head.map((v) => v.toFixed(2))}|${st.headRot.toFixed(2)}|${st.lid}|${st.awake}|${st.base2}`;
    if (!this.viewDirty && sig === this.lastSig) return;
    if (this.viewDirty) this.computeView();
    this.renderer.draw({ ...st, view: this.viewDev, M: this.M });
    this.lastDraw = now; this.lastSig = sig; this.viewDirty = false;
  }
  computeView() {
    const r = this.sceneEl.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr)));
    const sc = this.effectiveScene();
    const avail = { x: 8, y: 8, w: r.width - 16, h: r.height - 16 };
    const pr = this.panel.getBoundingClientRect();
    if (getComputedStyle(this.panel).position === 'absolute' && pr.left > r.left + 160 && pr.left < r.right) avail.w = Math.min(avail.w, pr.left - r.left - 20);
    const clock = this.sceneEl.querySelector('.clock').getBoundingClientRect();
    const top = clock.bottom - r.top + 6;
    if (top > avail.y && top < r.height * 0.4) { avail.h -= top - avail.y; avail.y = top; }
    const sheet = $('alarmSheet');
    if (!sheet.hidden) {
      const srect = sheet.getBoundingClientRect();
      if (srect.top < r.bottom && srect.left < r.left + avail.x + avail.w) avail.h = Math.max(120, Math.min(avail.h, srect.top - r.top - avail.y - 6));
    }
    // 優先順位：①顔と前足は必ず見せる ②背景写真で画面を埋める ③時計と重ねない ④猫全体を中央に
    const hard = { x0: 8, y0: 8, x1: avail.x + avail.w, y1: avail.y + avail.h };
    const soft = { ...hard, y0: avail.y };
    hard.y0 = 8;
    const whole = bboxOf(this.M.m, [this.cat.crop.x, this.cat.crop.y, this.cat.crop.w, this.cat.crop.h]);
    const face = bboxOf(this.M.m, this.cat.rig.focus);
    const fit = (b, R, m) => Math.min((R.x1 - R.x0) * m / (b.x1 - b.x0), (R.y1 - R.y0) * m / (b.y1 - b.y0));
    const sCover = Math.max(r.width / sc.w, r.height / sc.h);
    const s = Math.min(sCover, fit(face, hard, 0.96), 1.6);
    const place = (size, sceneSize, b0, b1, w0, w1, f0, f1, s0, s1) => {
      let t = (s0 + s1) / 2 - s * (w0 + w1) / 2;                 // 猫全体を中央へ
      const cl = (lo, hi) => { if (lo <= hi) t = clamp(t, lo, hi); };
      cl(s0 - s * f0, s1 - s * f1);                               // 時計と重ねない（できれば）
      if (sceneSize * s >= size - 0.5) cl(size - sceneSize * s, 0); // 背景で埋める
      const lo = b0 - s * f0, hi = b1 - s * f1;                   // 顔と前足は必ず見せる
      t = lo <= hi ? clamp(t, lo, hi) : (lo + hi) / 2;
      return t;
    };
    const tx = place(r.width, sc.w, hard.x0, hard.x1, whole.x0, whole.x1, face.x0, face.x1, soft.x0, soft.x1);
    const ty = place(r.height, sc.h, hard.y0, hard.y1, whole.y0, whole.y1, face.y0, face.y1, soft.y0, soft.y1);
    this.viewCss = { s, tx, ty, left: r.left, top: r.top };
    this.viewDev = { s: s * dpr, tx: tx * dpr, ty: ty * dpr };
  }
  cellAt(clientX, clientY) {
    const v = this.viewCss; if (!v) return [0, 0];
    return applyM(this.M.inv, (clientX - v.left - v.tx) / v.s, (clientY - v.top - v.ty) / v.s);
  }
  nearEar(clientX, clientY) {
    const [x, y] = this.cellAt(clientX, clientY), E = this.cat.rig.ears;
    if (!E || E.length < 2) return 0;
    return Math.hypot(x - E[0].tip[0], y - E[0].tip[1]) <= Math.hypot(x - E[1].tip[0], y - E[1].tip[1]) ? 0 : 1;
  }
  // 動作確認用：仮想時計を進めて1コマ描き、画像を返す
  debugStep(ms) {
    if (this.virtualNow == null) this.virtualNow = performance.now();
    const n = Math.max(1, Math.round(ms / 16));
    for (let i = 0; i < n; i++) { this.virtualNow += ms / n; this.behavior.update(this.virtualNow); }
    this.viewDirty = true; this.lastDraw = 0; this.lastSig = '';
    this.frame(this.virtualNow);
    return this.canvas.toDataURL('image/jpeg', 0.9);
  }
  hitCat(clientX, clientY) {
    const v = this.viewCss, cat = this.cat; if (!v || !cat) return false;
    const qx = (clientX - v.left - v.tx) / v.s, qy = (clientY - v.top - v.ty) / v.s;
    const [cx, cy] = applyM(this.M.inv, qx, qy);
    const a = cat.alpha;
    const x = Math.floor((cx - cat.crop.x) / a.cellPerPx), y = Math.floor((cy - cat.crop.y) / a.cellPerPx);
    if (x < 0 || y < 0 || x >= a.w || y >= a.h) return false;
    return a.data[y * a.w + x] > 60;
  }

  /* ----- 添い寝セッション ----- */
  async startSession({ quiet = false } = {}) {
    this.wake.request();                       // 操作の直後に要求する（ブラウザによっては必要）
    const ok = await this.audio.unlock();
    this.session = true; this.resumeNeeded = false;
    Settings.set({ session: true });
    if (ok) this.audio.startPurr();
    else this.toast('音声を再生できませんでした。端末の音量やマナーモード、ブラウザの設定を確認してから、もう一度押してください。', 'bad', 9000);
    if (!quiet) this.hint('この画面を開いたまま、端末がスリープしない状態でお使いください。', 9000);
    this.reportDecodeError();
    this.renderStatus();
    return ok;
  }
  endSession() {
    this.session = false; this.resumeNeeded = false;
    Settings.set({ session: false });
    this.audio.stopPurr();
    this.wake.release();
    this.renderStatus();
  }
  reportDecodeError() { if (this.audio.lastDecodeError) { this.toast(this.audio.lastDecodeError, 'bad', 7000); this.audio.lastDecodeError = ''; this.renderSoundInfo(); } }

  /* ----- 音を試す ----- */
  stopSoundTest() {
    const t = this.soundTest;
    t.token++; t.timers.forEach(clearTimeout); t.timers = [];
    if (t.active) { this.audio.stopMeow(); if (t.startedPurr && !this.session) this.audio.stopPurr(0.4); }
    t.active = false; t.startedPurr = false;
    $('testSoundBtn').textContent = '音を試す';
  }
  async testSound() {
    if (this.alarm.ringing) return;
    const ok = await this.audio.unlock();
    this.reportDecodeError();
    if (!ok) { this.toast('音声を再生できませんでした。端末の音量やマナーモードを確認してください。', 'bad', 7000); return; }
    this.stopSoundTest();
    const t = this.soundTest, tk = t.token;
    t.active = true;
    t.startedPurr = !this.audio.purrPlaying && this.audio.startPurr();
    $('testSoundBtn').textContent = '再生中…';
    t.timers.push(setTimeout(() => {
      if (tk !== t.token || this.alarm.ringing) return;
      const r = this.audio.playMeow({ variant: 0, gain: 1 });
      if (r) this.behavior.meowOnce(r.delay, r.duration, r.env);
    }, 1300));
    t.timers.push(setTimeout(() => { if (tk === t.token) { if (t.startedPurr && !this.session) this.audio.stopPurr(0.6); t.active = false; t.startedPurr = false; $('testSoundBtn').textContent = '音を試す'; this.renderStatus(); } }, 4300));
    this.renderStatus();
  }
  // しぐさの見本（ふだんは不規則に起きる動きを、順番に見せる）
  demo() {
    if (this.alarm.ringing) return;
    (this.demoTimers || []).forEach(clearTimeout);
    const b = this.behavior; b.reset();
    const hold = () => { const n = this.now(); b.nextIdle = Math.max(b.nextIdle, n + 40000); b.nextLick = Math.max(b.nextLick, n + 40000); };
    hold();
    const seq = [
      [0.4, () => b.earFlick(1, 1, true)], [1.8, () => b.sniff()], [3.0, () => b.tailFlick()], [3.8, () => b.earFlick(0, 0.8)],
      [4.8, () => b.start('peek')], [10.5, () => b.start('wake')], [21.5, () => b.start('lick')],
      [26.5, () => { const r = this.audio.running ? this.audio.playMeow({ variant: 0, gain: 0.6 }) : null; b.meowOnce(r ? r.delay : 0.2, r ? r.duration : 0.72, r ? r.env : null); }],
    ];
    this.demoTimers = seq.map(([t, fn]) => setTimeout(() => { if (!this.alarm.ringing) { fn(); hold(); } }, t * 1000));
    this.toast('しぐさの見本を再生しています（約30秒）。', 'info', 3500);
    try { this.sceneEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* ignore */ }
  }
  async test10() {
    if (this.alarm.ringing) return;
    if (!this.session) await this.startSession({ quiet: true }); else await this.audio.unlock();
    this.alarm.testAt = Date.now() + 10000;
    this.toast('10秒後に猫が起こします（テスト）。本来のアラームの設定は変わりません。', 'info', 4000);
    this.renderStatus(); this.renderClock();
  }

  /* ----- 鳴る・止める ----- */
  onRing(info) {
    this.stopSoundTest();
    if (this.audio.ctx && !this.audio.running) this.audio.unlock();
    this.ringer.start(info);
    const late = info.lateMs > LATE_NOTICE_MS;
    const at = new Date(info.dueAt);
    $('alarmMsg').textContent = info.source === 'test' ? 'ニャー！（10秒後テスト）' : info.source === 'snooze' ? `ニャー！ ${fmtHM(new Date())} です` : `ニャー！ ${fmtHM(at)} です`;
    const lateEl = $('alarmLate');
    lateEl.hidden = !late;
    if (late) {
      const sec = Math.round(info.lateMs / 1000);
      lateEl.textContent = `画面が非表示だった等の理由で、${sec < 90 ? `約${sec}秒` : `約${Math.round(sec / 60)}分`}遅れて鳴らしました（予定 ${fmtHM(at)}）。`;
    }
    this.setAlarmAudioWarning(!this.audio.running);
    $('alarmSheet').hidden = false;
    document.title = 'ニャー！ 起きる時間です';
    if (window.scrollY > 0) { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); } }
    this.applyNight();
    this.viewDirty = true;
    setTimeout(() => { try { $('wakeBtn').focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
    this.renderCatList();
    this.renderStatus(); this.renderClock();
  }
  setAlarmAudioWarning(on) { const el = $('alarmAudio'); if (el.hidden === !on) return; el.hidden = !on; this.viewDirty = true; }
  closeAlarmSheet() {
    $('alarmSheet').hidden = true;
    document.title = this.baseTitle;
    this.applyNight();
    this.viewDirty = true;
    this.renderCatList();
  }
  wakeUp() {
    if (!this.alarm.ringing) return;
    this.ringer.stop(); this.alarm.dismiss(); this.closeAlarmSheet();
    this.toast('おはようございます。猫は添い寝に戻りました。', 'info', 4000);
    this.renderStatus(); this.renderClock();
  }
  snooze() {
    if (!this.alarm.ringing) return;
    this.ringer.stop();
    const at = this.alarm.snooze();
    this.closeAlarmSheet();
    this.toast(`5分後（${fmtHM(new Date(at))}）にもう一度起こします。`, 'info', 4500);
    this.renderStatus(); this.renderClock();
  }
  cancelAlarm() {
    this.ringer.stop();
    this.alarm.clear();
    this.alarm.ringing = null;
    if (!$('alarmSheet').hidden) this.closeAlarmSheet();
    this.toast('アラームを解除しました。', 'info', 3000);
    this.renderStatus(); this.renderClock();
  }

  /* ----- 表示の更新 ----- */
  tick() {
    this.renderClock();
    this.renderStatus();
    setTimeout(() => this.tick(), 1000 - (Date.now() % 1000) + 8);
  }
  renderClock() {
    const now = new Date();
    $('clockTime').textContent = fmtHM(now);
    const a = this.alarm, parts = [];
    if (a.ringing) parts.push('ニャー！ 起きる時間です');
    else {
      if (a.testAt != null) parts.push(`テスト ${fmtRemain(a.testAt - now)}`);
      if (a.snoozeAt != null) parts.push(`スヌーズ ${fmtHM(new Date(a.snoozeAt))}（${fmtRemain(a.snoozeAt - now)}）`);
      if (a.targetAt != null) { const d = new Date(a.targetAt); parts.push(`アラーム ${fmtDate(d)} ${fmtHM(d)}（${fmtRemain(a.targetAt - now)}）`); }
      if (!parts.length) parts.push(this.session ? '添い寝中・アラームなし' : 'アラーム未セット');
    }
    $('clockSub').textContent = parts.join('　');
  }
  renderStatus() {
    if (!this.alarm) return;
    const a = this.alarm, au = this.audio, now = Date.now();
    const st = au.state, running = au.running;
    const armed = a.targetAt != null || a.snoozeAt != null || a.testAt != null;
    // 音声
    let aPill = '未準備', aLvl = '', aText = '「添い寝をはじめる」か「音を試す」を押すと準備します。';
    if (st === 'error') { aPill = '使えません'; aLvl = 'bad'; aText = au.error; }
    else if (running) { aPill = '準備OK'; aLvl = 'ok'; aText = (au.purrPlaying ? 'ゴロゴロ再生中' : '待機中') + '・' + (au.purrIsCustom || au.meowIsCustom ? (au.purrIsCustom && au.meowIsCustom ? 'アップロードした音' : '一部アップロードした音') : '仮の音（合成）'); }
    else if (au.ctx && (au.everRan || this.session)) { aPill = '停止中'; aLvl = 'bad'; aText = '画面をタップするか「再開する」を押してください。'; }
    else if (this.resumeNeeded) { aPill = '停止中'; aLvl = 'bad'; aText = '再読込で止まりました。「再開する」を押してください。'; }
    this.pill('stAudio', aPill, aLvl); $('stAudioText').textContent = aText;
    // アラーム
    let lPill = a.enabled ? '未セット' : '使わない', lLvl = '', lText = a.enabled ? '時刻を入れて「この時刻にセット」または「添い寝をはじめる」を押します。' : '添い寝だけを楽しめます。';
    if (a.ringing) { lPill = '鳴っています'; lLvl = 'warn'; lText = '「起きたよ」で止まります。'; }
    else if (armed) {
      const next = Math.min(...[a.targetAt, a.snoozeAt, a.testAt].filter((v) => v != null));
      const d = new Date(next);
      lPill = a.testAt === next ? 'テスト待ち' : a.snoozeAt === next ? 'スヌーズ中' : '有効';
      lLvl = running ? 'ok' : 'warn';
      lText = `${relDay(next)} ${fmtDate(d)} ${fmtHM(d)}・${fmtRemain(next - now)}` + (running ? '' : '。音声が止まっているため、このままでは鳴りません。');
    }
    this.pill('stAlarm', lPill, lLvl); $('stAlarmText').textContent = lText;
    // スリープ防止
    const w = this.wake;
    const wMap = {
      unsupported: ['非対応', 'warn', 'この環境では使えません。端末の自動ロックをオフにしてください。'],
      off: ['未使用', '', '添い寝中、画面が暗くならないようにします。'],
      on: ['有効', 'ok', '画面が表示されている間だけ効きます。'],
      released: ['解除', 'warn', 'システムにより解除されました。画面に戻ると取り直します。'],
      error: ['失敗', 'warn', `使えませんでした（${w.err}）。端末の自動ロックをオフにしてください。`],
    };
    const [wp, wl, wt] = wMap[w.state] || wMap.off;
    this.pill('stWake', wp, wl); $('stWakeText').textContent = wt;
    // まとめ
    let lvl = 'idle', msg = '猫をえらび、起きる時刻を決めて「添い寝をはじめる」を押してください。';
    const nextTxt = () => { const n = Math.min(...[a.targetAt, a.snoozeAt, a.testAt].filter((v) => v != null)); const d = new Date(n); return `${relDay(n)} ${fmtDate(d)} ${fmtHM(d)}`; };
    if (a.ringing) { lvl = 'warn'; msg = '猫が起こしています。「起きたよ」か「あと5分」を押してください。'; }
    else if (this.resumeNeeded) { lvl = 'bad'; msg = '音声が止まっています。「再開する」を押すまで、アラームの音は鳴りません。'; }
    else if (au.ctx && !running && (this.session || armed) && st !== 'error' && (au.everRan || this.session)) { lvl = 'bad'; msg = '音声が一時停止しています。画面をタップすると再開します。止まっている間はアラームが鳴りません。'; }
    else if (st === 'error') { lvl = 'bad'; msg = au.error; }
    else if (armed && running) { lvl = 'ok'; msg = `準備OK。${nextTxt()} に猫が起こします。この画面を開いたままにしてください。`; }
    else if (armed && !running) { lvl = 'warn'; msg = 'アラームはセット済みですが、音声が未準備です。「添い寝をはじめる」を押すと鳴らせる状態になります。'; }
    else if (this.session) { lvl = 'ok'; msg = '添い寝中です（アラームなし）。'; }
    const rd = $('readiness'); rd.dataset.level = lvl; $('readinessText').textContent = msg;
    // ボタン類
    $('startBtn').textContent = this.session ? '添い寝をおわる' : '添い寝をはじめる';
    $('startBtn').classList.toggle('primary', !this.session); $('startBtn').classList.toggle('ghost', this.session);
    $('resumeBox').hidden = !this.resumeNeeded;
    $('cancelBtn').hidden = !(armed || a.ringing);
    $('testSoundBtn').disabled = !!a.ringing; $('test10Btn').disabled = !!a.ringing || a.testAt != null;
    this.renderPreview();
  }
  pill(id, text, lvl) { const el = $(id); if (el.textContent !== text) el.textContent = text; if ((el.dataset.level || '') !== lvl) el.dataset.level = lvl; }
  renderPreview() {
    const a = this.alarm, el = $('timePreview'), arm = $('armBtn');
    $('alarmTime').disabled = !a.enabled;
    if (!a.enabled) { el.textContent = 'アラームなしで添い寝します。'; arm.hidden = true; return; }
    const cand = a.candidate(), d = new Date(cand), armedFor = a.armedFor();
    const label = `${relDay(cand)} ${fmtDate(d)} ${fmtHM(d)}`;
    if (armedFor === a.time) { setText(el, `セット済み：<strong>${label}</strong> に起こします`); arm.hidden = true; }
    else if (armedFor) { setText(el, `変更後：<strong>${label}</strong>（いまは ${fmtHM(new Date(a.targetAt))} にセット中）`); arm.hidden = false; arm.textContent = 'この時刻に変更'; }
    else { setText(el, `<strong>${label}</strong> に起こします`); arm.hidden = false; arm.textContent = 'この時刻にセット'; }
  }
  applyNight() {
    const on = !!this.s.night;
    document.documentElement.dataset.night = on ? 'on' : 'off';
    let op = on ? 1 - this.s.nightBright / 100 : 0;
    if (this.alarm && this.alarm.ringing) op = Math.min(op, 0.2);
    $('dim').style.opacity = String(clamp(op, 0, 0.9));
  }
  toast(msg, level = 'info', ms = 4000) {
    const el = $('toast');
    el.textContent = msg; el.dataset.level = level; el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  hint(msg, ms) {
    const el = $('sceneHint');
    el.textContent = msg; el.hidden = false;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  /* ----- 入力 ----- */
  applySettingsToInputs() {
    const s = this.s;
    $('alarmTime').value = this.alarm.time;
    $('alarmEnabled').checked = this.alarm.enabled;
    $('volPurr').value = s.volPurr; $('volAlarm').value = s.volAlarm;
    $('motion').value = s.motion; $('motionStop').checked = !!s.motionStop;
    $('nightMode').checked = !!s.night; $('nightBright').value = s.nightBright;
    this.renderSliderOutputs();
    $('storeNote').textContent = Settings.ok ? '時刻・音量などの設定は、このブラウザの中に保存されます。' : 'この環境では設定を保存できないため、再読込すると初期値に戻ります。';
  }
  renderSliderOutputs() {
    const s = this.s;
    $('volPurrOut').textContent = s.volPurr; $('volAlarmOut').textContent = s.volAlarm;
    const m = s.motionStop ? 0 : s.motion;
    $('motionOut').textContent = m === 0 ? '止める' : m < 50 ? '控えめ' : m <= 110 ? '標準' : '大きめ';
    $('motion').disabled = !!s.motionStop;
    $('nightBrightOut').textContent = `${s.nightBright}%`;
    $('nightBright').disabled = !s.night;
  }
  syncPlacementInputs() {
    if (!this.cat) return;
    const pl = this.placementOf(this.cat), sc = this.effectiveScene(), full = this.cat.mode === 'full';
    const set = (id, v, max) => { const el = $(id); if (max != null) el.max = max; el.value = v; el.disabled = full; };
    set('plX', pl.x, sc.w); set('plY', pl.y, sc.h); set('plS', pl.scale); set('plR', pl.rotate);
    $('plXOut').textContent = Math.round(pl.x); $('plYOut').textContent = Math.round(pl.y);
    $('plSOut').textContent = `${pl.scale.toFixed(2)}倍`; $('plROut').textContent = `${Math.round(pl.rotate)}°`;
    $('plReset').disabled = full;
  }
  bindUI() {
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
    on('startBtn', 'click', () => {
      if (this.session) { this.endSession(); return; }
      if (this.alarm.enabled && this.alarm.armedFor() !== this.alarm.time) this.alarm.arm();
      this.startSession();
    });
    on('resumeBtn', 'click', () => this.startSession());
    on('resumeEndBtn', 'click', () => { this.resumeNeeded = false; Settings.set({ session: false }); this.renderStatus(); });
    on('testSoundBtn', 'click', () => this.testSound());
    on('demoBtn', 'click', () => this.demo());
    on('test10Btn', 'click', () => this.test10());
    on('armBtn', 'click', () => { this.alarm.arm(); const d = new Date(this.alarm.targetAt); this.toast(`${relDay(this.alarm.targetAt)} ${fmtDate(d)} ${fmtHM(d)} にセットしました。`, 'info', 3500); this.renderStatus(); this.renderClock(); });
    on('cancelBtn', 'click', () => this.cancelAlarm());
    on('sheetCancelBtn', 'click', () => this.cancelAlarm());
    on('alarmTime', 'change', () => { const v = $('alarmTime').value; if (/^\d{2}:\d{2}$/.test(v)) { this.alarm.time = v; this.alarm.persist(); } this.renderStatus(); });
    on('alarmTime', 'input', () => { const v = $('alarmTime').value; if (/^\d{2}:\d{2}$/.test(v)) { this.alarm.time = v; this.alarm.persist(); } this.renderPreview(); });
    on('alarmEnabled', 'change', () => {
      this.alarm.enabled = $('alarmEnabled').checked;
      if (!this.alarm.enabled) { this.alarm.targetAt = null; this.alarm.snoozeAt = null; if (this.alarm.ringing) this.cancelAlarm(); }
      this.alarm.persist(); this.renderStatus(); this.renderClock();
    });
    on('wakeBtn', 'click', () => this.wakeUp());
    on('snoozeBtn', 'click', () => this.snooze());
    on('alarmAudioBtn', 'click', async () => { const ok = await this.audio.unlock(); this.setAlarmAudioWarning(!ok); if (ok && this.session) this.audio.startPurr(); });
    // 音量・表示
    const num = (id) => Number($(id).value);
    on('volPurr', 'input', () => { this.s.volPurr = num('volPurr'); Settings.save(); this.audio.setVolumes(this.s.volPurr / 100, this.s.volAlarm / 100); this.renderSliderOutputs(); });
    on('volAlarm', 'input', () => { this.s.volAlarm = num('volAlarm'); Settings.save(); this.audio.setVolumes(this.s.volPurr / 100, this.s.volAlarm / 100); this.renderSliderOutputs(); });
    on('motion', 'input', () => { this.s.motion = num('motion'); Settings.save(); this.renderSliderOutputs(); this.viewDirty = true; });
    on('motionStop', 'change', () => { this.s.motionStop = $('motionStop').checked; Settings.save(); this.renderSliderOutputs(); if (this.s.motionStop && this.behavior.mode !== 'alarm') this.behavior.reset(); this.viewDirty = true; });
    on('nightMode', 'change', () => { this.s.night = $('nightMode').checked; Settings.save(); this.applyNight(); this.renderSliderOutputs(); });
    on('nightBright', 'input', () => { this.s.nightBright = num('nightBright'); Settings.save(); this.applyNight(); this.renderSliderOutputs(); });
    // 位置の調整
    const plInput = () => {
      if (!this.cat || this.cat.mode === 'full') return;
      this.s.placement[this.cat.id] = { x: num('plX'), y: num('plY'), scale: num('plS'), rotate: num('plR') };
      Settings.save(); this.updateMatrix(); this.syncPlacementInputs();
    };
    ['plX', 'plY', 'plS', 'plR'].forEach((id) => on(id, 'input', plInput));
    on('plReset', 'click', () => { if (!this.cat) return; delete this.s.placement[this.cat.id]; Settings.save(); this.updateMatrix(); this.syncPlacementInputs(); });
    // 猫をタップ（アラームを止める操作とは別）
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.hitCat(e.clientX, e.clientY)) return;
      if (this.alarm.ringing) { this.toast('止めるときは「起きたよ」を押してください。', 'info', 2500); return; }
      if (this.behavior.react(this.nearEar(e.clientX, e.clientY))) { this.audio.chirp(); this.audio.swell(); }
    });
    let lastMove = 0;
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const t = performance.now(); if (t - lastMove < 80) return; lastMove = t;
      this.canvas.style.cursor = this.hitCat(e.clientX, e.clientY) ? 'pointer' : '';
    });
    // 画面の再表示・操作で音声と時刻を確認
    const onReturn = () => {
      this.alarm.check();
      this.wake.onVisible();
      if ((this.session || this.alarm.ringing) && this.audio.ctx && !this.audio.running) this.audio.ctx.resume().catch(() => {});
      this.viewDirty = true;
      this.renderStatus(); this.renderClock();
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onReturn(); });
    window.addEventListener('focus', onReturn);
    window.addEventListener('pageshow', onReturn);
    const kick = () => { if (this.audio.ctx && !this.audio.running && (this.session || this.alarm.ringing)) this.audio.unlock().then((ok) => { if (ok && this.session) this.audio.startPurr(); this.setAlarmAudioWarning(this.alarm.ringing && !ok); }); };
    document.addEventListener('pointerdown', kick, true);
    document.addEventListener('keydown', kick, true);
    // 猫の選択（矢印キー）
    $('catList').addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const chips = [...$('catList').querySelectorAll('.cat-chip')];
      const i = chips.findIndex((c) => c.dataset.id === this.catId);
      const j = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + chips.length) % chips.length;
      e.preventDefault(); this.selectCat(chips[j].dataset.id).then(() => { const c = $('catList').querySelector(`[data-id="${chips[j].dataset.id}"]`); if (c) c.focus(); });
    });
    this.bindFiles();
  }

  /* ----- ファイル（音・画像） ----- */
  async restoreFiles() {
    await FileStore.open();
    this.renderSoundInfo();
    if (!FileStore.ok) return;
    try {
      const bg = await FileStore.get('bg');
      if (bg && bg.data) { const img = await imageFromBuffer(bg.data, bg.type); this.bgScene = { img, w: srcW(img), h: srcH(img), edge: edgeColorOf(img), feather: 60, name: bg.name, custom: true }; this.updateScene(); }
    } catch (e) { /* ignore */ }
    for (const meta of this.s.customCats) {
      try {
        const rec = await FileStore.get('cat:' + meta.id);
        if (!rec) continue;
        const img = await imageFromBuffer(rec.data, rec.type);
        const cat = await buildCustomCat(rec.rec, img);
        this.customCats.set(meta.id, { rec: rec.rec, cat });
      } catch (e) { /* ignore broken entry */ }
    }
    this.renderCatList(); this.renderCustomList();
    if (this.customCats.has(this.savedCatId) && this.catId !== this.savedCatId) await this.selectCat(this.savedCatId);
    try {
      const purr = await FileStore.get('purr');
      if (purr) await this.audio.setCustomPurr(purr.data, purr.name);
      const keys = (await FileStore.keys()).filter((k) => String(k).startsWith('meow:')).sort();
      const meows = [];
      for (const k of keys) { const r = await FileStore.get(k); if (r) meows.push({ ab: r.data, name: r.name }); }
      if (meows.length) await this.audio.setCustomMeows(meows);
    } catch (e) { /* ignore */ }
    this.renderSoundInfo(); this.renderStatus();
  }
  renderSoundInfo() {
    const au = this.audio;
    $('purrNow').textContent = au.purrIsCustom ? `アップロードした音（${au.custom.purrName}）` : '仮の音（合成）';
    $('meowNow').textContent = au.meowIsCustom ? `アップロードした音（${au.custom.meowNames.length}個）` : '仮の音（合成・3種類）';
    const b = $('soundBadge');
    const both = au.purrIsCustom && au.meowIsCustom, none = !au.purrIsCustom && !au.meowIsCustom;
    b.textContent = none ? '仮の音' : both ? 'アップロード音' : '一部 仮の音';
    b.classList.toggle('real', both);
    $('soundStoreNote').textContent = FileStore.ok
      ? '選んだ音声ファイルは、設定とは別に、このブラウザの中（IndexedDB）に保存されます。'
      : 'この環境では音声ファイルを保存できません。再読込したら、もう一度選び直してください。';
    $('bgNow').textContent = this.bgScene && this.bgScene.custom ? `選んだ写真（${this.bgScene.name}）` : '付属の腕の写真';
  }
  bindFiles() {
    const readFile = (f) => (f.arrayBuffer ? f.arrayBuffer() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(f); }));
    $('purrFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        const ab = await readFile(f);
        this.audio.ensureContext();
        await this.audio.setCustomPurr(ab, f.name);
        const saved = await FileStore.put({ key: 'purr', name: f.name, type: f.type, data: ab });
        this.toast(saved ? 'ゴロゴロ音を差し替えました。' : 'ゴロゴロ音を差し替えました（この環境では保存できないため、再読込後は選び直しが必要です）。', 'info', 5000);
      } catch (err) { this.toast('この音声ファイルは読み込めませんでした。mp3・m4a・wav などを選んでください。', 'bad', 6000); }
      e.target.value = ''; this.renderSoundInfo(); this.renderStatus();
    });
    $('meowFile').addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])].slice(0, 5); if (!files.length) return;
      try {
        const list = [];
        for (const f of files) list.push({ ab: await readFile(f), name: f.name, type: f.type });
        this.audio.ensureContext();
        await this.audio.setCustomMeows(list);
        for (const k of (await FileStore.keys()).filter((k) => String(k).startsWith('meow:'))) await FileStore.del(k);
        let saved = true;
        for (let i = 0; i < list.length; i++) saved = (await FileStore.put({ key: `meow:${i}`, name: list[i].name, type: list[i].type, data: list[i].ab })) && saved;
        this.toast(saved ? `鳴き声を${list.length}個に差し替えました。` : '鳴き声を差し替えました（この環境では保存できないため、再読込後は選び直しが必要です）。', 'info', 5000);
      } catch (err) { this.toast('読み込めない音声ファイルがありました。mp3・m4a・wav などを選んでください。', 'bad', 6000); }
      e.target.value = ''; this.renderSoundInfo(); this.renderStatus();
    });
    $('purrReset').addEventListener('click', async () => { await FileStore.del('purr'); await this.audio.setCustomPurr(null); this.renderSoundInfo(); this.renderStatus(); });
    $('meowReset').addEventListener('click', async () => { for (const k of (await FileStore.keys()).filter((k) => String(k).startsWith('meow:'))) await FileStore.del(k); await this.audio.setCustomMeows(null); this.renderSoundInfo(); this.renderStatus(); });
    // 背景写真
    $('bgFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        const ab = await readFile(f);
        const img = await imageFromBuffer(ab, f.type);
        this.bgScene = { img, w: srcW(img), h: srcH(img), edge: edgeColorOf(img), feather: 60, name: f.name, custom: true };
        this.updateScene();
        const saved = await FileStore.put({ key: 'bg', name: f.name, type: f.type, data: ab });
        this.toast(saved ? '背景の写真を変えました。猫の位置は「位置を調整」で合わせられます。' : '背景の写真を変えました（保存できない環境のため、再読込で元に戻ります）。', 'info', 6000);
      } catch (err) { this.toast('この画像は読み込めませんでした。', 'bad', 5000); }
      e.target.value = ''; this.renderSoundInfo();
    });
    $('bgReset').addEventListener('click', async () => { await FileStore.del('bg'); this.bgScene = this.defaultScene; this.updateScene(); this.renderSoundInfo(); });
    // 猫の追加
    const persona = $('sheetPersona');
    for (const [k, p] of Object.entries(PERSONALITIES)) { const o = document.createElement('option'); o.value = k; o.textContent = p.label; persona.append(o); }
    persona.value = 'odayaka';
    $('sheetFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      $('sheetMsg').textContent = '';
      try {
        const ab = await readFile(f);
        const img = await imageFromBuffer(ab, f.type);
        this.sheetDraft = { ab, type: f.type || 'image/png', img, name: f.name };
        const r = srcW(img) / srcH(img);
        if (Math.abs(r - 2 / 3) < 0.08) { $('sheetCols').value = 2; $('sheetRows').value = 3; }
        else if (Math.abs(r - 1) < 0.08) { $('sheetCols').value = 2; $('sheetRows').value = 2; }
        this.renderSheetForm(true);
      } catch (err) { this.sheetDraft = null; $('sheetMsg').textContent = 'この画像は読み込めませんでした。'; this.renderSheetForm(true); }
    });
    ['sheetCols', 'sheetRows'].forEach((id) => $(id).addEventListener('change', () => this.renderSheetForm(true)));
    $('sheetAdd').addEventListener('click', () => this.addCustomCat());
    this.renderSheetForm(true);
  }
  renderSheetForm(resetMap) {
    const d = this.sheetDraft, grid = $('mapGrid'), cv = $('sheetPreview');
    const cols = clamp(Math.round(Number($('sheetCols').value) || 2), 1, 6), rows = clamp(Math.round(Number($('sheetRows').value) || 3), 1, 6);
    const n = cols * rows;
    if (resetMap) {
      grid.textContent = '';
      const def = n >= 6 ? { sleep: 0, sleep2: 1, cuddle: 2, lick: 3, meow: 4, meow2: 5 }
        : n === 4 ? { sleep: 0, cuddle: 1, lick: 2, meow: 3, sleep2: -1, meow2: -1 }
        : { sleep: 0, cuddle: n > 1 ? 1 : -1, meow: n > 2 ? n - 1 : -1, lick: -1, sleep2: -1, meow2: -1 };
      for (const p of POSES) {
        const lab = document.createElement('label');
        const sel = document.createElement('select'); sel.id = `map-${p}`;
        const none = document.createElement('option'); none.value = '-1'; none.textContent = p === 'sleep' ? '（必須）' : 'なし'; sel.append(none);
        for (let i = 0; i < n; i++) { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i + 1}（${Math.floor(i / cols) + 1}行${(i % cols) + 1}列）`; sel.append(o); }
        sel.value = String(def[p] != null && def[p] < n ? def[p] : -1);
        lab.append(document.createTextNode(POSE_LABELS[p]), sel);
        grid.append(lab);
      }
    }
    cv.hidden = !d;
    $('sheetAdd').disabled = !d;
    if (!d) return;
    const W = srcW(d.img), H = srcH(d.img), cw = 360, ch = Math.round(360 * H / W);
    cv.width = cw * 2; cv.height = ch * 2; cv.style.aspectRatio = `${cw} / ${ch}`;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height); g.drawImage(d.img, 0, 0, cv.width, cv.height);
    g.strokeStyle = 'rgba(86,119,139,.9)'; g.lineWidth = 3; g.fillStyle = 'rgba(86,119,139,.92)'; g.font = 'bold 28px sans-serif';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cv.width / cols, y = r * cv.height / rows;
      g.strokeRect(x + 1.5, y + 1.5, cv.width / cols - 3, cv.height / rows - 3);
      g.fillRect(x + 6, y + 6, 40, 36); g.fillStyle = '#fff'; g.fillText(String(r * cols + c + 1), x + 14, y + 34); g.fillStyle = 'rgba(86,119,139,.92)';
    }
    $('sheetMsg').textContent = `画像の実寸 ${W}×${H}px → 1コマ ${Math.floor(W / cols)}×${Math.floor(H / rows)}px` + (Math.floor(W / cols) !== Math.floor(H / rows) ? '（正方形ではありません。列・行の数を確認してください）' : '');
  }
  async addCustomCat() {
    const d = this.sheetDraft; if (!d) return;
    const cols = clamp(Math.round(Number($('sheetCols').value) || 2), 1, 6), rows = clamp(Math.round(Number($('sheetRows').value) || 3), 1, 6);
    const map = {}; for (const p of POSES) map[p] = Number($(`map-${p}`).value);
    if (map.sleep < 0) { $('sheetMsg').textContent = '「眠る」に使うコマを選んでください。'; return; }
    const rec = { id: 'custom-' + Date.now().toString(36), name: ($('sheetName').value || '').trim() || '追加した猫', personality: $('sheetPersona').value, cols, rows, mode: $('sheetMode').value, map };
    $('sheetAdd').disabled = true; $('sheetMsg').textContent = '位置合わせをしています…';
    try {
      const cat = await buildCustomCat(rec, d.img);
      this.customCats.set(rec.id, { rec, cat });
      const saved = await FileStore.put({ key: 'cat:' + rec.id, rec, data: d.ab, type: d.type });
      if (saved) { this.s.customCats.push({ id: rec.id, name: rec.name }); Settings.save(); }
      await this.selectCat(rec.id);
      this.renderCatList(); this.renderCustomList();
      $('sheetMsg').textContent = (cat.modeChanged ? '背景が透過されていない画像だったため「コマをそのまま表示」で追加しました（呼吸の変形は使いません）。' : `「${rec.name}」を追加しました。位置が合わないときは上の「位置を調整」で直せます。`)
        + (saved ? '' : ' ※この環境では保存できないため、再読込すると消えます。');
      this.sheetDraft = null; $('sheetFile').value = ''; $('sheetName').value = ''; this.renderSheetForm(false);
    } catch (err) {
      $('sheetMsg').textContent = `追加できませんでした：${err && err.message ? err.message : err}`;
      $('sheetAdd').disabled = false;
    }
  }
  renderCustomList() {
    const ul = $('customList'); ul.textContent = '';
    for (const { rec, cat } of this.customCats.values()) {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.textContent = `${rec.name}（${cat.mode === 'full' ? '背景入り' : '透過'}・${rec.cols}×${rec.rows}）`;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn ghost small'; del.textContent = '削除';
      del.addEventListener('click', async () => {
        if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = '本当に削除'; del.classList.add('danger'); setTimeout(() => { del.dataset.confirm = ''; del.textContent = '削除'; del.classList.remove('danger'); }, 4000); return; }
        this.customCats.delete(rec.id);
        this.s.customCats = this.s.customCats.filter((c) => c.id !== rec.id);
        delete this.s.placement[rec.id]; Settings.save();
        await FileStore.del('cat:' + rec.id);
        if (this.catId === rec.id) await this.selectCat(CAT_PROFILES[0].id);
        this.renderCatList(); this.renderCustomList();
      });
      li.append(name, del); ul.append(li);
    }
  }
}
function setText(el, html) { if (el.innerHTML !== html) el.innerHTML = html; }

const app = new App();
window.__nekoApp = app;   // 動作確認用
const boot = () => app.init().catch((e) => { console.error(e); const t = $('toast'); if (t) { t.textContent = '起動できませんでした：' + (e && e.message ? e.message : e); t.dataset.level = 'bad'; t.hidden = false; } });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

