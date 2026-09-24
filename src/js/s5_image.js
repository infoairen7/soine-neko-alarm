/* ---------------------------------------------------------------------
 * 5. 画像設定（コマの切り出し・位置合わせ・影・当たり判定）
 * -------------------------------------------------------------------*/
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('画像を読み込めませんでした。'));
    im.src = src;
  });
}
async function imageFromBuffer(ab, type) {
  const blob = new Blob([ab], { type: type || 'image/png' });
  const url = URL.createObjectURL(blob);
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 4000); }
}
const srcW = (s) => s.naturalWidth || s.videoWidth || s.width;
const srcH = (s) => s.naturalHeight || s.videoHeight || s.height;
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

function boxBlur(a, w, h, r, passes) {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) { tmp[row + x] = acc / (2 * r + 1); acc += a[row + clamp(x + r + 1, 0, w - 1)] - a[row + clamp(x - r, 0, w - 1)]; }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { a[y * w + x] = acc / (2 * r + 1); acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x]; }
    }
  }
  return a;
}
// 当たり判定用の低解像度アルファ
function makeAlphaMap(src, k) {
  const w = Math.ceil(srcW(src) / 4), h = Math.ceil(srcH(src) / 4);
  const c = makeCanvas(w, h), g = ctx2d(c);
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return { w, h, data: a, cellPerPx: 4 / k };
}
// 影：接地部分の濃い影（すぐ外側）と、光と反対側に落ちる柔らかい影の2種類
function makeShadow(src, crop, k) {
  const m = 56, q = 4;
  const W = crop.w + 2 * m, H = crop.h + 2 * m;
  const w = Math.ceil(W / q), h = Math.ceil(H / q);
  const c = makeCanvas(w, h), g = ctx2d(c);
  g.drawImage(src, m / q, m / q, crop.w / q, crop.h / q);
  const d = g.getImageData(0, 0, w, h).data;
  const wide = new Float32Array(w * h), tight = new Float32Array(w * h);
  for (let i = 0; i < wide.length; i++) { wide[i] = tight[i] = d[i * 4 + 3] / 255; }
  boxBlur(wide, w, h, 4, 3); boxBlur(tight, w, h, 1, 2);
  const data = new Uint8Array(w * h * 2);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    data[i * 2] = Math.round(clamp(tight[i], 0, 1) * 255);
    data[i * 2 + 1] = Math.round(clamp(wide[i], 0, 1) * 255);
    const v = clamp(0.3 * wide[i] + 0.24 * tight[i], 0, 0.62);
    img.data[i * 4] = 40; img.data[i * 4 + 1] = 32; img.data[i * 4 + 2] = 26; img.data[i * 4 + 3] = Math.round(v * 0.95 * 255);
  }
  const canvas = makeCanvas(w, h); canvas.getContext('2d').putImageData(img, 0, 0);
  return { w, h, data, canvas, rect: { x: crop.x - m, y: crop.y - m, w: w * q, h: h * q } };
}
function scaleRig(rig, s) {
  const p = (v) => (v ? [v[0] * s, v[1] * s] : v);
  return {
    anchor: p(rig.anchor),
    breath: { c: p(rig.breath.c), s: p(rig.breath.s) },
    head: { c: p(rig.head.c), s: rig.head.s * s, pivot: p(rig.head.pivot || rig.head.c) },
    paw: p(rig.paw), tail: p(rig.tail), nose: p(rig.nose),
    ears: (rig.ears || []).map((e) => ({ base: p(e.base), tip: p(e.tip) })),
    eyes: rig.eyes ? rig.eyes.map((e) => ({ c: p(e.c), r: p(e.r), a: e.a, cc: p(e.cc) })) : null,
    mouth: rig.mouth ? { c: p(rig.mouth.c), r: p(rig.mouth.r), a: rig.mouth.a, jaw: p(rig.mouth.jaw), chin: p(rig.mouth.chin), chinS: rig.mouth.chinS * s } : null,
    tongue: rig.tongue ? { root: p(rig.tongue.root), tip: p(rig.tongue.tip), w: rig.tongue.w * s } : null,
    focus: rig.focus.map((v) => v * s),
  };
}
// frames: { sleep, sleep2, cuddle, lick, meowA, meowB } のうち、あるもの
function finalizeCat(profile, d) {
  const f = d.frames;
  if (!f.sleep) throw new Error('「眠る」のコマがありません。');
  const has = { sleep2: !!f.sleep2, cuddle: !!f.cuddle, lick: !!f.lick, meow: !!f.meowA };
  if (!f.sleep2) f.sleep2 = f.sleep;
  if (!f.cuddle) f.cuddle = f.sleep;
  if (!f.meowA) f.meowA = f.cuddle;
  if (!f.meowB) f.meowB = f.meowA;
  if (!f.lick) f.lick = f.sleep;
  const s = d.cellW / 512;
  const rig = scaleRig(profile.rig || DEFAULT_RIG, s);
  if (d.mode === 'full') rig.focus = [0, 0, d.cellW, d.cellH];
  const legacy = !(rig.eyes && rig.mouth && rig.tongue);   // 目・口の位置が分からない猫はコマの切り替えで表現
  return {
    id: profile.id, profile, frames: f, has, crop: d.crop, frameScale: d.frameScale,
    cellW: d.cellW, cellH: d.cellH, mode: d.mode, legacy,
    alpha: makeAlphaMap(f.sleep, d.frameScale),
    shadow: d.mode === 'overlay' ? makeShadow(f.sleep, d.crop, d.frameScale) : null,
    rig, grade: d.mode === 'overlay' ? (profile.grade || DEFAULT_GRADE) : null,
    breathOK: d.mode === 'overlay',
    thumb: profile.thumbURL || null,
  };
}
async function prepareBuiltinCat(profile) {
  const frames = {};
  await Promise.all(FRAME_KEYS.map(async (k) => {
    const key = profile.frames[k];
    if (key && ASSETS.images[key]) frames[k] = await loadImage(ASSETS.images[key]);
  }));
  const [x, y, w, h] = profile.crop;
  return finalizeCat(profile, { frames, crop: { x, y, w, h }, frameScale: 1, cellW: profile.cell, cellH: profile.cell, mode: 'overlay' });
}

// --- 利用者が追加するコマ割り画像 ---
function sheetCells(img, cols, rows) {
  const W = srcW(img), H = srcH(img);                   // 実寸を取得（解像度は決め打ちしない）
  const cw = Math.floor(W / cols), ch = Math.floor(H / rows);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cv = makeCanvas(cw, ch);
    cv.getContext('2d').drawImage(img, c * cw, r * ch, cw, ch, 0, 0, cw, ch);
    cells.push(cv);
  }
  return { cells, cw, ch, W, H };
}
function sample(cv, w, h, useAlpha) {
  const c = makeCanvas(w, h), g = ctx2d(c);
  g.drawImage(cv, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) {
    a[i] = useAlpha ? d[i * 4 + 3] / 255 : (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  }
  return a;
}
function hasTransparency(cv) {
  const a = sample(cv, 64, 64, true);
  let n = 0; for (const v of a) if (v < 0.97) n++;
  return n / a.length > 0.03;
}
function bestShift(A, B, w, h, range, cx0, cy0, useMask) {
  let best = [cx0, cy0], bestV = Infinity;
  for (let dy = cy0 - range; dy <= cy0 + range; dy++) {
    for (let dx = cx0 - range; dx <= cx0 + range; dx++) {
      let s = 0, n = 0;
      for (let y = 0; y < h; y += 1) {
        const sy = y - dy; if (sy < 0 || sy >= h) continue;
        for (let x = 0; x < w; x += 1) {
          if (useMask && x < w * 0.68 && y < h * 0.55) continue; // 頭は動いてよいので、胴体で合わせる
          const sx = x - dx; if (sx < 0 || sx >= w) continue;
          s += Math.abs(A[y * w + x] - B[sy * w + sx]); n++;
        }
      }
      const v = n ? s / n : Infinity;
      if (v < bestV) { bestV = v; best = [dx, dy]; }
    }
  }
  return best;
}
function alignCell(ref, cell, cw, ch, overlay) {
  const w1 = 96, h1 = Math.max(8, Math.round(96 * ch / cw));
  const A1 = sample(ref, w1, h1, overlay), B1 = sample(cell, w1, h1, overlay);
  const s1 = bestShift(A1, B1, w1, h1, 6, 0, 0, overlay);
  const w2 = 192, h2 = Math.max(8, Math.round(192 * ch / cw));
  const A2 = sample(ref, w2, h2, overlay), B2 = sample(cell, w2, h2, overlay);
  const s2 = bestShift(A2, B2, w2, h2, 2, s1[0] * 2, s1[1] * 2, overlay);
  return [s2[0] * cw / w2, s2[1] * ch / h2];
}
async function buildCustomCat(rec, img) {
  const { cells, cw, ch } = sheetCells(img, rec.cols, rec.rows);
  let mode = rec.mode;
  const pick = (p) => (rec.map[p] >= 0 && rec.map[p] < cells.length ? cells[rec.map[p]] : null);
  const ref = pick('sleep');
  if (!ref) throw new Error('「眠る」に使うコマを選んでください。');
  if (mode === 'overlay' && !hasTransparency(ref)) mode = 'full';
  const overlay = mode === 'overlay';
  const shifted = {};
  for (const p of POSES) {
    const cell = pick(p); if (!cell) continue;
    const [dx, dy] = cell === ref ? [0, 0] : alignCell(ref, cell, cw, ch, overlay);
    const cv = makeCanvas(cw, ch);
    cv.getContext('2d').drawImage(cell, dx, dy);
    shifted[p] = cv;
  }
  let crop = { x: 0, y: 0, w: cw, h: ch };
  if (overlay) {
    const q = 4, w = Math.ceil(cw / q), h = Math.ceil(ch / q);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (const p in shifted) {
      const a = sample(shifted[p], w, h, true);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x] > 0.02) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    if (x1 >= 0) {
      const pad = 12;
      const X0 = clamp(x0 * q - pad, 0, cw), Y0 = clamp(y0 * q - pad, 0, ch), X1 = clamp((x1 + 1) * q + pad, 0, cw), Y1 = clamp((y1 + 1) * q + pad, 0, ch);
      crop = { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 };
    }
  }
  const k = Math.min(1, 2048 / Math.max(crop.w, crop.h));
  const cut = (cv) => { const o = makeCanvas(crop.w * k, crop.h * k); o.getContext('2d').drawImage(cv, crop.x, crop.y, crop.w, crop.h, 0, 0, o.width, o.height); return o; };
  const frames = {};
  const keyOf = { sleep: 'sleep', sleep2: 'sleep2', cuddle: 'cuddle', lick: 'lick', meow: 'meowA', meow2: 'meowB' };
  for (const p in shifted) frames[keyOf[p]] = cut(shifted[p]);
  const profile = {
    id: rec.id, name: rec.name, look: overlay ? '追加した猫' : '追加した猫（背景入り）', personality: rec.personality,
    rig: DEFAULT_RIG, grade: overlay ? DEFAULT_GRADE : null, voice: { pitch: 1.0 }, custom: true,
    placement: overlay ? { ...DEFAULT_PLACEMENT, scale: DEFAULT_PLACEMENT.scale * 512 / cw } : { x: 0, y: 0, scale: 1, rotate: 0 },
  };
  const cat = finalizeCat(profile, { frames, crop, frameScale: k, cellW: cw, cellH: ch, mode });
  cat.modeChanged = mode !== rec.mode;
  const t = makeCanvas(96, 96), tg = t.getContext('2d');
  const src = frames.cuddle || frames.sleep;
  if (overlay) {
    const hc = cat.rig.head.c, side = cat.rig.head.s * 3.4;
    tg.drawImage(src, (hc[0] - side / 2 - crop.x) * k, (hc[1] - side / 2 + 10 - crop.y) * k, side * k, side * k, 0, 0, 96, 96);
  } else {
    const side = Math.min(cw, ch);
    tg.drawImage(src, (cw - side) / 2 * k, (ch - side) / 2 * k, side * k, side * k, 0, 0, 96, 96);
  }
  try { cat.thumb = t.toDataURL('image/png'); } catch (e) { cat.thumb = null; }
  return cat;
}

