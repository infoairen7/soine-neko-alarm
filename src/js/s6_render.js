/* ---------------------------------------------------------------------
 * 6. 描画
 *   背景写真（固定）→ 接地の影 → 猫（体の局所変形＋表情の合成）の順に1枚の絵を作ります。
 *   表情は画像を丸ごと切り替えず、まぶた・あご・舌の部分だけを動かします。
 * -------------------------------------------------------------------*/
function placementMatrix(cat, pl) {
  // コマ座標 → 背景写真の座標（回転は画面上で反時計回りが正）
  const t = -pl.rotate * Math.PI / 180, s = pl.scale;
  const a = s * Math.cos(t), b = -s * Math.sin(t), c = s * Math.sin(t), d = s * Math.cos(t);
  const [ax, ay] = cat.mode === 'full' ? [0, 0] : cat.rig.anchor;
  const tx = pl.x - (a * ax + b * ay), ty = pl.y - (c * ax + d * ay);
  const det = a * d - b * c;
  const inv = [d / det, -b / det, (b * ty - d * tx) / det, -c / det, a / det, (c * tx - a * ty) / det];
  return { m: [a, b, tx, c, d, ty], inv };
}
const applyM = (m, x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
function bboxOf(m, r) {
  const pts = [applyM(m, r[0], r[1]), applyM(m, r[0] + r[2], r[1]), applyM(m, r[0], r[1] + r[3]), applyM(m, r[0] + r[2], r[1] + r[3])];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
const nextPOT = (v) => { let p = 1; while (p < v) p *= 2; return p; };

const VS = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uCanvas; uniform vec3 uView;
uniform sampler2D uBg; uniform vec2 uBgSize; uniform float uHasBg; uniform vec3 uEdge; uniform vec4 uFeather4;
uniform sampler2D uS; uniform sampler2D uS2; uniform sampler2D uC; uniform sampler2D uL; uniform sampler2D uM;
uniform mat3 uInv; uniform vec4 uFrame; uniform vec2 uCropWH;
uniform sampler2D uShadow; uniform vec4 uShadowRect; uniform vec2 uShadowOff; uniform vec2 uShadowK;
uniform vec4 uBreathC; uniform float uBreath;
uniform vec3 uHead; uniform vec2 uHeadPivot; uniform vec2 uHeadOff; uniform float uHeadRot;
uniform vec4 uEar0; uniform vec4 uEar1; uniform vec2 uEarRot;
uniform vec3 uNose; uniform vec2 uNoseOff;
uniform vec3 uTail; uniform vec2 uTailOff;
uniform vec3 uPaw; uniform vec2 uPawOff;
uniform float uBase2; uniform float uAwake; uniform float uLegacy;
uniform vec4 uEye0; uniform vec4 uEye0b; uniform vec4 uEye1; uniform vec4 uEye1b; uniform vec2 uLid;
uniform vec4 uMouth; uniform float uMouthA; uniform vec4 uJaw; uniform float uJawS; uniform float uMouthOpen;
uniform vec4 uTongue; uniform float uTongueW; uniform float uTongueOut;
uniform vec4 uGrade; uniform vec3 uGain;
uniform vec4 uLook;     // relight, rim, wrap, lightX(scene)
uniform float uLod;     // mip を使えるか

vec4 fr(sampler2D t, vec2 cell){
  vec2 l = cell - uFrame.xy;
  if (l.x < 0.0 || l.y < 0.0 || l.x > uCropWH.x || l.y > uCropWH.y) return vec4(0.0);
  return texture2D(t, l * uFrame.zw);
}
vec4 frB(sampler2D t, vec2 cell, float b){
  vec2 l = cell - uFrame.xy;
  if (l.x < -8.0 || l.y < -8.0 || l.x > uCropWH.x + 8.0 || l.y > uCropWH.y + 8.0) return vec4(0.0);
  return texture2D(t, clamp(l * uFrame.zw, vec2(0.0), vec2(1.0)), b);
}
float g1(vec2 p, vec3 c){ vec2 d = (p - c.xy) / c.z; return exp(-0.5 * dot(d, d)); }
float fe(float d, float w){ return w > 0.0 ? smoothstep(0.0, w, d) : 1.0; }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec2 earDisp(vec2 p, vec4 e, float a){
  if (a == 0.0) return vec2(0.0);
  vec2 ax = e.zw - e.xy; float len = length(ax); vec2 dir = ax / len;
  vec2 r = p - e.xy; float s = dot(r, dir) / len; float pr = dot(r, vec2(-dir.y, dir.x));
  float w = smoothstep(-0.1, 0.35, s) * (1.0 - smoothstep(1.05, 1.4, s)) * exp(-0.5 * pow(pr / (0.5 * len), 2.0));
  return w * (rot(r, a) - r);
}
vec4 face(vec2 cw){
  vec4 S = mix(fr(uS, cw), fr(uS2, cw), uBase2);
  vec4 C = fr(uC, cw);
  vec4 F = mix(S, C, uAwake);
  return F;
}
// まぶた：閉じた目（眠る顔）と開いた目（起きた顔）を、上下のまぶたが開くように切り替える
vec4 eye(vec4 F, vec2 cw, vec4 e, vec4 eb, float lid){
  vec2 d = cw - e.xy;
  float ca = cos(eb.x), sa = sin(eb.x);
  vec2 u = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / e.zw;
  float r = length(u);
  if (r > 1.32) return F;
  float inside = 1.0 - smoothstep(0.95, 1.18 + 0.12 * uAwake, r);
  vec4 Sx = mix(fr(uS, cw), fr(uS2, cw), uBase2);
  vec4 Cx = fr(uC, cw);
  float hw = sqrt(max(0.0, 1.0 - u.x * u.x));
  float yc = 0.2;
  float top = yc - lid * (yc + hw * 1.12);
  float bot = yc + lid * (hw * 1.12 - yc);
  float sft = 0.085;
  float open = smoothstep(top - sft, top + sft, u.y) * (1.0 - smoothstep(bot - sft, bot + sft, u.y)) * step(0.003, lid);
  vec4 E = mix(Sx, Cx, open);
  // 上まぶたのふちの影（半分開いたときに目がくぼんで見える）
  float rim = exp(-pow((u.y - top - 0.09) / 0.1, 2.0)) * open * (1.0 - smoothstep(0.85, 1.05, r));
  E.rgb *= 1.0 - 0.32 * rim * (1.0 - 0.5 * lid);
  float rimB = exp(-pow((u.y - bot + 0.05) / 0.07, 2.0)) * open * (1.0 - smoothstep(0.8, 1.0, r));
  E.rgb *= 1.0 - 0.15 * rimB;
  return mix(F, E, inside);
}
void main(){
  vec2 px = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 q = (px - uView.yz) / uView.x;
  vec3 col = uEdge;
  vec2 buv = q / uBgSize;
  if (uHasBg > 0.5) {
    if (buv.x >= 0.0 && buv.y >= 0.0 && buv.x <= 1.0 && buv.y <= 1.0) {
      vec3 bg = texture2D(uBg, buv).rgb;
      float e = fe(q.x, uFeather4.x) * fe(q.y, uFeather4.y) * fe(uBgSize.x - q.x, uFeather4.z) * fe(uBgSize.y - q.y, uFeather4.w);
      col = mix(uEdge, bg, e);
    }
  }
  // 影：接地部分（すぐ外側・濃い）＋ 光と反対側に落ちる柔らかい影
  if (uShadowK.x + uShadowK.y > 0.0) {
    vec2 c0 = (uInv * vec3(q, 1.0)).xy;
    vec2 c1 = (uInv * vec3(q - uShadowOff, 1.0)).xy;
    vec2 s0 = (c0 - uShadowRect.xy) / uShadowRect.zw, s1 = (c1 - uShadowRect.xy) / uShadowRect.zw;
    float t0 = (s0.x >= 0.0 && s0.y >= 0.0 && s0.x <= 1.0 && s0.y <= 1.0) ? texture2D(uShadow, s0).r : 0.0;
    float t1 = (s1.x >= 0.0 && s1.y >= 0.0 && s1.x <= 1.0 && s1.y <= 1.0) ? texture2D(uShadow, s1).a : 0.0;
    float sh = clamp(t0 * uShadowK.x + t1 * uShadowK.y, 0.0, 0.7);
    col *= vec3(1.0) - sh * vec3(0.9, 0.95, 1.0);
  }
  vec2 cell = (uInv * vec3(q, 1.0)).xy;
  // 体の局所変形（背景と腕は動かない）
  vec2 bd = (cell - uBreathC.xy) / uBreathC.zw;
  vec2 d = uBreath * exp(-0.5 * dot(bd, bd)) * bd;
  float wh = g1(cell, uHead);
  vec2 rp = cell - uHeadPivot;
  d += wh * (uHeadOff + rot(rp, uHeadRot) - rp);
  d += earDisp(cell, uEar0, uEarRot.x) + earDisp(cell, uEar1, uEarRot.y);
  d += uNoseOff * g1(cell, uNose) + uTailOff * g1(cell, uTail) + uPawOff * g1(cell, uPaw);
  float jw = g1(cell, vec3(uJaw.zw, uJawS));
  d += uJaw.xy * jw * uMouthOpen;            // 鳴くときに下あごが下がる
  vec2 cw = cell - d;
  vec4 c;
  if (uLegacy > 0.5) {
    c = face(cw);
    c = mix(c, fr(uM, cw), uMouthOpen);
    c = mix(c, fr(uL, cw), uTongueOut);
  } else {
    c = face(cw);
    c = eye(c, cw, uEye0, uEye0b, uLid.x);
    c = eye(c, cw, uEye1, uEye1b, uLid.y);
    if (uMouthOpen > 0.002) {
      vec2 md = cw - uMouth.xy; float ca = cos(uMouthA), sa = sin(uMouthA);
      vec2 mu = vec2(ca * md.x + sa * md.y, -sa * md.x + ca * md.y) / uMouth.zw;
      float reg = 1.0 - smoothstep(0.8, 1.3, length(mu));
      vec4 Mm = fr(uM, cw + uJaw.xy * jw);    // 口を開けた素材は、あごが下がりきった位置にある
      c = mix(c, Mm, reg * smoothstep(0.08, 0.7, uMouthOpen));
    }
    if (uTongueOut > 0.002) {
      vec2 ab = uTongue.zw - uTongue.xy; float L = length(ab); vec2 dir = ab / L;
      vec2 rel = cw - uTongue.xy; float s = dot(rel, dir) / L; float pr = abs(dot(rel, vec2(-dir.y, dir.x)));
      float to = uTongueOut;
      float cap = (1.0 - smoothstep(uTongueW * 0.95, uTongueW * 1.4, pr)) * smoothstep(-0.4, -0.05, s);
      float lips = exp(-0.5 * pow(length(rel) / (uTongueW * 1.5), 2.0)) * smoothstep(0.0, 0.35, to) * (1.0 - cap);
      c = mix(c, fr(uL, cw), lips * 0.9);
      float reveal = 1.0 - smoothstep(to * 1.08 - 0.1, to * 1.08 + 0.02, s);
      vec4 T = fr(uL, cw + dir * L * (1.0 - to) * 0.6);   // 舌が口から伸びていくように
      c = mix(c, T, clamp(cap * reveal, 0.0, 1.0));
    }
  }
  if (c.a > 0.002) {
    vec3 rgb = c.rgb / c.a;
    if (uGrade.w > 0.5) {
      float l = dot(rgb, vec3(0.299, 0.587, 0.114));
      rgb = mix(vec3(l), rgb, uGrade.x);
      rgb = (rgb - 0.5) * uGrade.y + 0.5;
      rgb = rgb * uGain + uGrade.z;
      // 写真の光（左から）に合わせたごく弱い陰影
      rgb *= 1.0 + uLook.x * clamp((uLook.w - q.x) / 260.0, -1.0, 1.0);
      if (uLod > 0.5) {
        float ab = frB(uS, cw, 3.2).a;
        float edge = clamp(1.0 - ab, 0.0, 1.0);
        float earW = max(g1(cell, vec3(mix(uEar0.xy, uEar0.zw, 0.5), 30.0)), g1(cell, vec3(mix(uEar1.xy, uEar1.zw, 0.5), 30.0)));
        rgb *= 1.0 - uLook.y * edge * (1.0 - earW);                          // 寝具に接する縁を少し暗く
        if (uHasBg > 0.5) rgb = mix(rgb, texture2D(uBg, buv, 4.0).rgb, uLook.z * edge * edge);  // 周りの光を縁に少しなじませる
      }
    }
    c.rgb = clamp(rgb, 0.0, 1.0) * c.a;
  }
  gl_FragColor = vec4(col * (1.0 - c.a) + c.rgb, 1.0);
}`;

class GLRenderer {
  static create(canvas) {
    const o = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    let gl = null, v2 = false;
    try { gl = canvas.getContext('webgl2', o); v2 = !!gl; if (!gl) gl = canvas.getContext('webgl', o) || canvas.getContext('experimental-webgl', o); } catch (e) { gl = null; }
    if (!gl) return null;
    try { return new GLRenderer(canvas, gl, v2); } catch (e) { console.warn('WebGL init failed', e); return null; }
  }
  constructor(canvas, gl, v2) {
    this.kind = 'webgl'; this.canvas = canvas; this.gl = gl; this.v2 = v2;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.init(); if (this.scene) this.setScene(this.scene); if (this.cat) this.setCat(this.cat); });
    this.init();
  }
  init() {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p; gl.useProgram(p);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); this.u[name] = gl.getUniformLocation(p, name); }
    const units = { uBg: 0, uShadow: 1, uS: 2, uS2: 3, uC: 4, uL: 5, uM: 6 };
    for (const k in units) if (this.u[k]) gl.uniform1i(this.u[k], units[k]);
    this.empty = this.tex(null);
    this.bgTex = this.empty; this.shadowTex = this.empty; this.poseTex = {};
    this.bgMip = false;
  }
  tex(source, { premul = false, mip = false, la = null } = {}) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (la) gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, la.w, la.h, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, la.data);
    else if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return t;
  }
  setScene(scene) {
    this.scene = scene;
    if (this.bgTex && this.bgTex !== this.empty) this.gl.deleteTexture(this.bgTex);
    this.bgTex = this.empty; this.bgMip = false;
    if (scene.img) {
      if (this.v2) { this.bgTex = this.tex(scene.img, { mip: true }); this.bgMip = true; }
      else {
        // WebGL1 はミップマップに2のべき乗サイズが必要
        const s = Math.min(2048, nextPOT(Math.max(srcW(scene.img), srcH(scene.img))));
        const cv = makeCanvas(s, s); cv.getContext('2d').drawImage(scene.img, 0, 0, s, s);
        this.bgTex = this.tex(cv, { mip: true }); this.bgMip = true;
      }
    }
  }
  setCat(cat) {
    const gl = this.gl;
    this.cat = cat;
    const seen = new Set();
    for (const k in this.poseTex) { const t = this.poseTex[k]; if (!seen.has(t)) { gl.deleteTexture(t); seen.add(t); } }
    this.poseTex = {};
    const f0 = cat.frames.sleep;
    const tw = nextPOT(srcW(f0)), th = nextPOT(srcH(f0));
    this.texW = tw; this.texH = th;
    const made = new Map();
    for (const k of FRAME_KEYS) {
      const src = cat.frames[k];
      if (made.has(src)) { this.poseTex[k] = made.get(src); continue; }
      const cv = makeCanvas(tw, th); cv.getContext('2d').drawImage(src, 0, 0);
      const t = this.tex(cv, { premul: true, mip: true });
      made.set(src, t); this.poseTex[k] = t;
    }
    if (this.shadowTex && this.shadowTex !== this.empty) gl.deleteTexture(this.shadowTex);
    this.shadowTex = cat.shadow ? this.tex(null, { la: cat.shadow }) : this.empty;
  }
  resize(w, h) { if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; } }
  draw(st) {
    if (this.lost || !this.cat) return;
    const gl = this.gl, u = this.u, cat = this.cat, sc = this.scene, R = cat.rig;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.uniform2f(u.uCanvas, this.canvas.width, this.canvas.height);
    gl.uniform3f(u.uView, st.view.s, st.view.tx, st.view.ty);
    const bind = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
    bind(0, this.bgTex); bind(1, this.shadowTex);
    bind(2, this.poseTex.sleep); bind(3, this.poseTex.sleep2); bind(4, this.poseTex.cuddle); bind(5, this.poseTex.lick);
    bind(6, st.meowIdx ? this.poseTex.meowB : this.poseTex.meowA);
    gl.uniform2f(u.uBgSize, sc.w, sc.h); gl.uniform1f(u.uHasBg, sc.img ? 1 : 0);
    gl.uniform3f(u.uEdge, sc.edge[0], sc.edge[1], sc.edge[2]);
    { const v = st.view, f = sc.feather || 0, W = this.canvas.width, H = this.canvas.height;
      gl.uniform4f(u.uFeather4, v.tx > 0.5 ? f : 0, v.ty > 0.5 ? f : 0, v.tx + v.s * sc.w < W - 0.5 ? f : 0, v.ty + v.s * sc.h < H - 0.5 ? f : 0); }
    const i = st.M.inv;
    gl.uniformMatrix3fv(u.uInv, false, new Float32Array([i[0], i[3], 0, i[1], i[4], 0, i[2], i[5], 1]));
    gl.uniform4f(u.uFrame, cat.crop.x, cat.crop.y, cat.frameScale / this.texW, cat.frameScale / this.texH);
    gl.uniform2f(u.uCropWH, cat.crop.w, cat.crop.h);
    if (cat.shadow) {
      const r = cat.shadow.rect; gl.uniform4f(u.uShadowRect, r.x, r.y, r.w, r.h);
      gl.uniform2f(u.uShadowK, LOOK.aoTight, LOOK.shadowWide); gl.uniform2f(u.uShadowOff, LOOK.shadowOff[0], LOOK.shadowOff[1]);
    } else gl.uniform2f(u.uShadowK, 0, 0);
    gl.uniform4f(u.uBreathC, R.breath.c[0], R.breath.c[1], R.breath.s[0], R.breath.s[1]);
    gl.uniform1f(u.uBreath, cat.breathOK ? st.breath : 0);
    gl.uniform3f(u.uHead, R.head.c[0], R.head.c[1], R.head.s); gl.uniform2f(u.uHeadPivot, R.head.pivot[0], R.head.pivot[1]);
    gl.uniform2f(u.uHeadOff, st.head[0], st.head[1]); gl.uniform1f(u.uHeadRot, st.headRot * Math.PI / 180);
    const E0 = R.ears[0] || { base: [0, 0], tip: [0, 1] }, E1 = R.ears[1] || E0;
    gl.uniform4f(u.uEar0, E0.base[0], E0.base[1], E0.tip[0], E0.tip[1]); gl.uniform4f(u.uEar1, E1.base[0], E1.base[1], E1.tip[0], E1.tip[1]);
    gl.uniform2f(u.uEarRot, cat.breathOK ? st.ears[0] * Math.PI / 180 : 0, cat.breathOK ? st.ears[1] * Math.PI / 180 : 0);
    gl.uniform3f(u.uNose, R.nose[0], R.nose[1], 13); gl.uniform2f(u.uNoseOff, st.nose[0], st.nose[1]);
    gl.uniform3f(u.uTail, R.tail[0], R.tail[1], 24); gl.uniform2f(u.uTailOff, st.tail[0], st.tail[1]);
    gl.uniform3f(u.uPaw, R.paw[0], R.paw[1], 34); gl.uniform2f(u.uPawOff, st.paw[0], st.paw[1]);
    gl.uniform1f(u.uBase2, st.base2); gl.uniform1f(u.uAwake, st.awake); gl.uniform1f(u.uLegacy, cat.legacy ? 1 : 0);
    if (!cat.legacy) {
      const e0 = R.eyes[0], e1 = R.eyes[1];
      gl.uniform4f(u.uEye0, e0.c[0], e0.c[1], e0.r[0], e0.r[1]); gl.uniform4f(u.uEye0b, e0.a * Math.PI / 180, e0.c[0] - e0.cc[0], e0.c[1] - e0.cc[1], 0);
      gl.uniform4f(u.uEye1, e1.c[0], e1.c[1], e1.r[0], e1.r[1]); gl.uniform4f(u.uEye1b, e1.a * Math.PI / 180, e1.c[0] - e1.cc[0], e1.c[1] - e1.cc[1], 0);
      gl.uniform2f(u.uLid, st.lid[0], st.lid[1]);
      const mo = R.mouth;
      gl.uniform4f(u.uMouth, mo.c[0], mo.c[1], mo.r[0], mo.r[1]); gl.uniform1f(u.uMouthA, mo.a * Math.PI / 180);
      gl.uniform4f(u.uJaw, mo.jaw[0], mo.jaw[1], mo.chin[0], mo.chin[1]); gl.uniform1f(u.uJawS, mo.chinS);
      const tg = R.tongue;
      gl.uniform4f(u.uTongue, tg.root[0], tg.root[1], tg.tip[0], tg.tip[1]); gl.uniform1f(u.uTongueW, tg.w);
    } else {
      gl.uniform4f(u.uJaw, 0, 0, 0, 0); gl.uniform1f(u.uJawS, 10);
    }
    gl.uniform1f(u.uMouthOpen, st.mouth); gl.uniform1f(u.uTongueOut, st.tongue);
    const g = cat.grade;
    if (g) { gl.uniform4f(u.uGrade, g.sat, g.contrast, g.lift, 1); gl.uniform3f(u.uGain, g.gain[0], g.gain[1], g.gain[2]); }
    else gl.uniform4f(u.uGrade, 1, 1, 0, 0);
    const lx = applyM(st.M.m, R.breath.c[0], R.breath.c[1])[0];
    gl.uniform4f(u.uLook, LOOK.relight, cat.mode === 'overlay' ? LOOK.rim : 0, LOOK.wrap, lx - 120);
    gl.uniform1f(u.uLod, this.bgMip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// WebGL が使えない環境用（表情はコマの切り替え、呼吸は胴体の小さな拡大で代用）
class Canvas2DRenderer {
  constructor(canvas) { this.kind = '2d'; this.canvas = canvas; this.g = canvas.getContext('2d'); }
  setScene(scene) { this.scene = scene; }
  setCat(cat) { this.cat = cat; }
  resize(w, h) { if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; } }
  draw(st) {
    const g = this.g, sc = this.scene, cat = this.cat; if (!cat) return;
    const e = sc.edge.map((v) => Math.round(v * 255));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.fillStyle = `rgb(${e[0]},${e[1]},${e[2]})`;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(st.view.s, 0, 0, st.view.s, st.view.tx, st.view.ty);
    if (sc.img) g.drawImage(sc.img, 0, 0, sc.w, sc.h);
    const m = st.M.m;
    g.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
    if (cat.shadow) { const r = cat.shadow.rect; g.drawImage(cat.shadow.canvas, r.x, r.y, r.w, r.h); }
    const b = cat.breathOK ? 1 + 0.003 * st.breath : 1, c = cat.rig.breath.c;
    g.translate(c[0], c[1]); g.scale(b, b); g.translate(-c[0], -c[1]);
    const cr = cat.crop, F = cat.frames;
    const base = st.base2 > 0.5 ? F.sleep2 : F.sleep;
    const eyes = Math.max(st.awake, (st.lid[0] + st.lid[1]) / 2);
    let bottom = base;
    if (st.mouth > 0.3 || eyes > 0.5) bottom = F.cuddle;
    if (st.tongue > 0.3) bottom = F.lick;
    g.drawImage(bottom, cr.x, cr.y, cr.w, cr.h);
    if (st.mouth > 0.3) {
      const mv = st.meowIdx ? F.meowB : F.meowA;
      if (cat.legacy) g.drawImage(mv, cr.x, cr.y, cr.w, cr.h);
      else {   // 口の部分だけを重ねる
        const mo = cat.rig.mouth; g.save(); g.beginPath(); g.ellipse(mo.c[0], mo.c[1], mo.r[0], mo.r[1], 0, 0, Math.PI * 2); g.clip();
        g.drawImage(mv, cr.x, cr.y, cr.w, cr.h); g.restore();
      }
    }
  }
}

