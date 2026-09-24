/* ---------------------------------------------------------------------
 * 9. 画面スリープ防止
 * -------------------------------------------------------------------*/
class WakeLockManager {
  constructor(onChange) {
    this.supported = !!(navigator.wakeLock && navigator.wakeLock.request);
    this.state = this.supported ? 'off' : 'unsupported';
    this.lock = null; this.wanted = false; this.err = ''; this.onChange = onChange;
  }
  async request() {
    this.wanted = true;
    if (!this.supported) { this.onChange(); return; }
    if (this.lock && !this.lock.released) return;
    if (document.visibilityState !== 'visible') return;
    try {
      const l = await navigator.wakeLock.request('screen');
      this.lock = l; this.state = 'on'; this.err = '';
      l.addEventListener('release', () => { if (this.lock === l) { this.lock = null; this.state = this.wanted ? 'released' : 'off'; this.onChange(); } });
    } catch (e) { this.state = 'error'; this.err = (e && e.name) || 'Error'; }
    this.onChange();
  }
  async release() {
    this.wanted = false;
    const l = this.lock; this.lock = null;
    this.state = this.supported ? 'off' : 'unsupported';
    if (l) { try { await l.release(); } catch (e) { /* ignore */ } }
    this.onChange();
  }
  onVisible() { if (this.wanted && this.supported && (!this.lock || this.lock.released)) this.request(); }
}

