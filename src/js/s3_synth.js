/* ---------------------------------------------------------------------
 * 3. 仮の音（Web Audio 用に波形を合成）と呼吸のリズム
 * -------------------------------------------------------------------*/
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 眠っている猫の呼吸：1回およそ2.5〜3.5秒（毎分20回前後）。ときどき深い「ため息」を混ぜる。
// ゴロゴロ音と見た目の呼吸は同じ表を使うので、音と胸の動きがそろいます。
const BREATH = (() => {
  const rng = mulberry32(2026);
  const cycles = [];
  for (let i = 0; i < 16; i++) {
    const sigh = i === 9;
    const g = (rng() + rng() + rng() - 1.5) * 0.45;          // だいたい正規分布
    const dur = sigh ? 5.4 : clamp(2.9 + g, 2.45, 3.55);
    cycles.push({ dur, amp: sigh ? 1.75 : 0.88 + rng() * 0.24, inh: sigh ? 0.4 : 0.37 + rng() * 0.04, exh: sigh ? 0.46 : 0.41 + rng() * 0.04 });
  }
  let t = 0; for (const c of cycles) { c.t0 = t; t += c.dur; }
  return { cycles, total: t };
})();
function breathAt(time) {
  let x = ((time % BREATH.total) + BREATH.total) % BREATH.total;
  for (const c of BREATH.cycles) {
    if (x < c.t0 + c.dur) {
      const u = (x - c.t0) / c.dur;
      if (u < c.inh) return c.amp * (0.5 - 0.5 * Math.cos(Math.PI * u / c.inh));                       // 吸う
      if (u < c.inh + c.exh) return c.amp * (0.5 + 0.5 * Math.cos(Math.PI * (u - c.inh) / c.exh));     // 吐く
      return 0;                                                                                        // 休み
    }
  }
  return 0;
}
function onePoleLP(x, sr, fc) { const a = Math.exp(-2 * Math.PI * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } }
function onePoleHP(x, sr, fc) { const a = Math.exp(-2 * Math.PI * fc / sr); let y = 0, px = 0; for (let i = 0; i < x.length; i++) { y = a * (y + x[i] - px); px = x[i]; x[i] = y; } }
function normalize(x, peak) { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); if (m > 0) { const k = peak / m; for (let i = 0; i < x.length; i++) x[i] *= k; } }

const Synth = {
  purr(sr) {
    const out = new Float32Array(Math.ceil(BREATH.total * sr));
    const rng = mulberry32(11);
    const len = Math.floor(0.032 * sr);
    const seg = (start, dur, f0, amp, shape) => {
      let t = start + 0.03;
      const end = start + dur - 0.03;
      while (t < end) {
        const x = (t - start) / dur;
        const env = shape(x) * amp * (0.85 + rng() * 0.3);
        const fr = 92 + rng() * 45, fr2 = 205 + rng() * 55;
        const i0 = Math.floor(t * sr);
        for (let i = 0; i < len && i0 + i < out.length; i++) {
          const tt = i / sr;
          const e = (1 - Math.exp(-tt / 0.0025)) * Math.exp(-tt / 0.0095);
          out[i0 + i] += env * e * (0.55 * Math.sin(2 * Math.PI * fr * tt) + 0.22 * Math.sin(2 * Math.PI * fr2 * tt) + 0.5 * (rng() * 2 - 1));
        }
        t += (1 / f0) * (1 + (rng() - 0.5) * 0.07);
      }
    };
    const arch = (p) => (x) => Math.pow(Math.sin(Math.PI * x), p);
    for (const c of BREATH.cycles) {
      const inh = c.dur * c.inh, rest = c.dur - inh;
      const a = Math.min(1.25, 0.7 + 0.3 * c.amp);
      seg(c.t0, inh, 26.5, 0.6 * a, arch(0.7));                                  // 吸う：少し小さく高め
      seg(c.t0 + inh, rest * 0.92, 23.5, 1.0 * a, (x) => Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15)), 0.6) * (1 - 0.35 * x)); // 吐く（休みにかけて弱まる）
    }
    onePoleLP(out, sr, 900); onePoleLP(out, sr, 1400); onePoleHP(out, sr, 38);
    normalize(out, 0.85);
    const f = Math.floor(0.02 * sr);
    for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; }
    return out;
  },
  // 鳴き声：倍音の多い声帯音 → 時間変化するフォルマント（口の形）→ 包絡
  meow(sr, p) {
    const N = Math.floor(p.dur * sr);
    const src = new Float32Array(N);
    const rng = mulberry32(p.seed || 3);
    let phase = 0;
    for (let i = 0; i < N; i++) {
      const x = i / N;
      let f = x < p.pk ? p.f[0] + (p.f[1] - p.f[0]) * (0.5 - 0.5 * Math.cos(Math.PI * x / p.pk))
                       : p.f[1] + (p.f[2] - p.f[1]) * (0.5 - 0.5 * Math.cos(Math.PI * (x - p.pk) / (1 - p.pk)));
      f *= 1 + 0.013 * Math.sin(2 * Math.PI * 5.6 * i / sr) + (rng() - 0.5) * 0.004;
      phase += f / sr; if (phase >= 1) phase -= 1;
      const K = Math.max(1, Math.min(14, Math.floor(4800 / f)));
      let s = 0;
      for (let k = 1; k <= K; k++) s += Math.sin(2 * Math.PI * k * phase) / k;
      let v = s * 0.6 + (rng() * 2 - 1) * 0.06;
      if (p.trill) v *= 1 - p.trill * (0.5 + 0.5 * Math.sin(2 * Math.PI * 28 * i / sr));
      src[i] = v;
    }
    const out = new Float32Array(N);
    const bands = p.formants || [
      { F: [380, 900, 700, 450], BW: 90, g: 1.0 },
      { F: [1900, 1650, 1250, 950], BW: 130, g: 0.55 },
      { F: [2900, 2750, 2600, 2500], BW: 200, g: 0.22 },
    ];
    const keys = [0, 0.3, 0.7, 1];
    for (const b of bands) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b2 = 0, a1 = 0, a2 = 0;
      for (let i = 0; i < N; i++) {
        if ((i & 31) === 0) {
          const x = i / N;
          let k = 0; while (k < 2 && x > keys[k + 1]) k++;
          const u = (x - keys[k]) / (keys[k + 1] - keys[k]);
          const F = b.F[k] + (b.F[k + 1] - b.F[k]) * u;
          const w0 = 2 * Math.PI * F / sr, Q = F / b.BW, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
          b0 = al / a0; b2 = -al / a0; a1 = -2 * Math.cos(w0) / a0; a2 = (1 - al) / a0;
        }
        const x0 = src[i];
        const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        out[i] += y0 * b.g;
      }
    }
    for (let i = 0; i < N; i++) {
      const x = i / N;
      const att = Math.min(1, x / 0.07);
      const rel = x > 0.72 ? 0.5 + 0.5 * Math.cos(Math.PI * (x - 0.72) / 0.28) : 1;
      out[i] *= att * att * rel;
    }
    normalize(out, p.gain || 0.9);
    return out;
  },
  meowSet(pitch) {
    const P = (a) => a.map((v) => v * pitch);
    return [
      { dur: 0.72, f: P([520, 760, 440]), pk: 0.32, seed: 5 },
      { dur: 0.5, f: P([600, 820, 560]), pk: 0.35, seed: 9 },
      { dur: 0.9, f: P([480, 720, 380]), pk: 0.3, seed: 13 },
    ];
  },
  chirp(pitch) {
    return { dur: 0.26, f: [640 * pitch, 900 * pitch, 820 * pitch], pk: 0.55, seed: 21, trill: 0.55, gain: 0.5,
      formants: [{ F: [500, 700, 680, 600], BW: 110, g: 1 }, { F: [1700, 1650, 1550, 1450], BW: 160, g: 0.45 }] };
  },
};
// 鳴き声の大きさの変化（10msごと）。口の開き具合を声に合わせるのに使う。
function envelopeOf(buf) {
  const sr = buf.sampleRate, hop = Math.max(1, Math.floor(sr / 100)), ch = buf.numberOfChannels;
  const n = Math.ceil(buf.length / hop), env = new Float32Array(n);
  let peak = 0;
  for (let j = 0; j < n; j++) {
    let s = 0, c = 0;
    for (let k = 0; k < ch; k++) { const d = buf.getChannelData(k); for (let i = j * hop; i < Math.min(d.length, (j + 1) * hop); i++) { s += d[i] * d[i]; c++; } }
    env[j] = Math.sqrt(s / Math.max(1, c)); peak = Math.max(peak, env[j]);
  }
  let prev = 0;
  for (let j = 0; j < n; j++) { const v = peak > 0 ? env[j] / peak : 0; prev = prev * 0.45 + v * 0.55; env[j] = prev; }
  return env;
}

