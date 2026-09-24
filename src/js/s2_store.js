/* ---------------------------------------------------------------------
 * 2. 保存
 * -------------------------------------------------------------------*/
const Settings = {
  KEY: 'soine-neko-alarm/v1',
  ok: true,
  data: null,
  defaults() {
    return {
      catId: 'chatora', alarmTime: '07:00', alarmEnabled: true, targetAt: null, snoozeAt: null,
      session: false, volPurr: 45, volAlarm: 80, motion: prefersReduced ? 40 : 100, motionStop: false,
      night: false, nightBright: 45, placement: {}, customCats: [],
    };
  },
  load() {
    let d = {};
    try {
      const raw = window.localStorage.getItem(this.KEY);
      if (raw) d = JSON.parse(raw) || {};
      window.localStorage.setItem(this.KEY + '/probe', '1');
      window.localStorage.removeItem(this.KEY + '/probe');
    } catch (e) { this.ok = false; }
    this.data = Object.assign(this.defaults(), d);
    if (!this.data.placement || typeof this.data.placement !== 'object') this.data.placement = {};
    if (!Array.isArray(this.data.customCats)) this.data.customCats = [];
    return this.data;
  },
  save() {
    if (!this.ok) return;
    try { window.localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { this.ok = false; }
  },
  set(patch) { Object.assign(this.data, patch); this.save(); },
};

const FileStore = {
  db: null, ok: false,
  async open() {
    try {
      if (!window.indexedDB) return false;
      this.db = await new Promise((res, rej) => {
        const r = window.indexedDB.open('soine-neko-alarm', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('files', { keyPath: 'key' }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
        setTimeout(() => rej(new Error('timeout')), 4000);
      });
      this.ok = true;
    } catch (e) { this.ok = false; }
    return this.ok;
  },
  _req(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('files', mode);
      const r = fn(t.objectStore('files'));
      t.oncomplete = () => res(r ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  async put(rec) { if (!this.ok) return false; try { await this._req('readwrite', (s) => s.put(rec)); return true; } catch (e) { return false; } },
  async get(key) { if (!this.ok) return null; try { return (await this._req('readonly', (s) => s.get(key))) || null; } catch (e) { return null; } },
  async del(key) { if (!this.ok) return false; try { await this._req('readwrite', (s) => s.delete(key)); return true; } catch (e) { return false; } },
  async keys() { if (!this.ok) return []; try { return (await this._req('readonly', (s) => s.getAllKeys())) || []; } catch (e) { return []; } },
};

