/* ---------------------------------------------------------------------
 * 8. アラーム管理
 * -------------------------------------------------------------------*/
class AlarmManager {
  constructor(app) {
    this.app = app;
    const s = Settings.data;
    this.time = /^\d{2}:\d{2}$/.test(s.alarmTime) ? s.alarmTime : '07:00';
    this.enabled = s.alarmEnabled !== false;
    this.targetAt = Number.isFinite(s.targetAt) ? s.targetAt : null;
    this.snoozeAt = Number.isFinite(s.snoozeAt) ? s.snoozeAt : null;
    this.testAt = null;         // テストは保存しない
    this.ringing = null;
  }
  persist() { Settings.set({ alarmTime: this.time, alarmEnabled: this.enabled, targetAt: this.targetAt, snoozeAt: this.snoozeAt }); }
  // 端末のローカル時刻で「次にその時刻が来る日時」。過ぎていれば翌日。
  static nextOccurrence(hhmm, nowMs) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(nowMs);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= nowMs) { d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0); }
    return d.getTime();
  }
  candidate(now = Date.now()) { return AlarmManager.nextOccurrence(this.time, now); }
  armedFor() { return this.targetAt != null ? hhmmOf(new Date(this.targetAt)) : null; }
  arm() { this.targetAt = this.candidate(); this.persist(); return this.targetAt; }
  clear() { this.targetAt = null; this.snoozeAt = null; this.testAt = null; this.persist(); }
  // 再読込時：閉じていた間に過ぎた予定は鳴らさず、知らせる
  restoreCheck() {
    const now = Date.now(), msgs = [];
    if (this.targetAt != null && now - this.targetAt > MISSED_GRACE_MS) { msgs.push(`${fmtDate(new Date(this.targetAt))} ${fmtHM(new Date(this.targetAt))}`); this.targetAt = null; }
    if (this.snoozeAt != null && now - this.snoozeAt > MISSED_GRACE_MS) { msgs.push(`スヌーズ ${fmtHM(new Date(this.snoozeAt))}`); this.snoozeAt = null; }
    if (!msgs.length) return '';
    this.persist();
    return `設定していた ${msgs.join('・')} は、ページが閉じていた間に過ぎたため鳴らせませんでした。`;
  }
  // 端末の現在日時と保存した目標日時を比べて判定（カウントダウンの減算ではない）
  check() {
    if (this.ringing) return;
    const now = Date.now(), due = [];
    if (this.targetAt != null && now >= this.targetAt) due.push(['alarm', this.targetAt]);
    if (this.snoozeAt != null && now >= this.snoozeAt) due.push(['snooze', this.snoozeAt]);
    if (this.testAt != null && now >= this.testAt) due.push(['test', this.testAt]);
    if (!due.length) return;
    due.sort((a, b) => a[1] - b[1]);
    for (const [s] of due) { if (s === 'alarm') this.targetAt = null; if (s === 'snooze') this.snoozeAt = null; if (s === 'test') this.testAt = null; }
    this.persist();
    const [source, dueAt] = due.find((d) => d[0] !== 'test') || due[0];
    this.ringing = { source, dueAt, startedAt: now, lateMs: now - dueAt };
    this.app.onRing(this.ringing);
  }
  dismiss() { this.ringing = null; this.snoozeAt = null; this.persist(); }
  snooze() { this.ringing = null; this.snoozeAt = Date.now() + SNOOZE_MS; this.persist(); return this.snoozeAt; }
}

// 鳴き声を順番に鳴らす係（1つのアラームにつき再生ループは1つだけ）
class Ringer {
  constructor(app) { this.app = app; this.active = false; this.token = 0; this.timers = []; }
  later(fn, ms) {
    const id = setTimeout(() => { this.timers = this.timers.filter((x) => x !== id); fn(); }, ms);
    this.timers.push(id);
  }
  start() {
    if (this.active) return;
    this.active = true; this.count = 0; this.lastDouble = false;
    const tk = ++this.token;
    this.t0 = performance.now();
    this.app.behavior.enterAlarm();
    this.app.audio.duck(true);
    this.later(() => this.next(tk), 800);
  }
  next(tk) {
    if (!this.active || tk !== this.token) return;
    const el = (performance.now() - this.t0) / 1000;
    const gain = 0.16 + 0.84 * Math.min(1, el / RAMP_SEC);       // 小さい声から設定音量まで
    const res = this.app.audio.playMeow({ variant: this.count, gain });
    this.app.setAlarmAudioWarning(!res);
    const dur = res ? res.duration : 0.7, delay = res ? res.delay : 0;
    this.app.behavior.speak(delay, dur, res ? res.env : null);          // 声に合わせて口を動かす
    if (this.count % 3 === 2) this.later(() => { if (this.active && tk === this.token) this.app.behavior.pat(); }, (delay + dur) * 1000 + 150);
    this.count++;
    try { if (navigator.vibrate) navigator.vibrate(160); } catch (e) { /* ignore */ }
    const dbl = !this.lastDouble && Math.random() < 0.35;          // ときどき「ニャーニャー」
    this.lastDouble = dbl;
    const gap = dbl ? rand(0.22, 0.35) : rand(1.1, 2.3);
    this.later(() => this.next(tk), (delay + dur + gap) * 1000);
  }
  stop() {
    if (!this.active) return;
    this.active = false; this.token++;
    this.timers.forEach(clearTimeout); this.timers = [];
    this.app.audio.stopMeow();
    this.app.audio.duck(false);
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* ignore */ }
    this.app.behavior.exitAlarm();
  }
}

