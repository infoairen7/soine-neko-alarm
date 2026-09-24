/* ---------------------------------------------------------------------
 * 1. 設定データ
 * -------------------------------------------------------------------*/
// 表情の素材。付属の猫は「眠る顔」を基準に、目・口・舌の位置をそろえて書き出してあります。
//   sleep / sleep2 : 眠る顔（2種類）   cuddle : 目を開けた顔
//   lick : 舌を出した顔                meowA / meowB : 口を開けた顔（口のまわりだけ使う）
const FRAME_KEYS = ['sleep', 'sleep2', 'cuddle', 'lick', 'meowA', 'meowB'];
// 利用者が追加するコマ割り画像で指定するポーズ
const POSES = ['sleep', 'sleep2', 'cuddle', 'lick', 'meow', 'meow2'];
const POSE_LABELS = {
  sleep: '眠る', sleep2: '眠る（別の寝顔）', cuddle: '目を開けて抱っこ',
  lick: 'ぺろっと舐める', meow: '鳴く', meow2: '鳴く（別の口）',
};

// 個性（演出上の設定）。数値は秒。
const PERSONALITIES = {
  amaenbo: { label: '甘えん坊', note: '目を開けて甘える回数が少し多め', idleGap: [12, 32], weights: { wake: 2.6, peek: 1.4, rehug: 1.2, turn: 0.5 }, awakeHold: [4, 9], lickGap: [45, 110], restAfter: [3, 8], tempo: 1.0 },
  odayaka: { label: '穏やか', note: '眠っている時間が少し長め', idleGap: [30, 75], weights: { wake: 1.0, peek: 1.6, rehug: 1.0, turn: 0.9 }, awakeHold: [3, 6], lickGap: [55, 120], restAfter: [5, 12], tempo: 1.0 },
  yuttari: { label: 'ゆったり', note: '動作と動作のあいだの休憩が長め', idleGap: [22, 55], weights: { wake: 1.4, peek: 1.4, rehug: 1.0, turn: 0.7 }, awakeHold: [5, 10], lickGap: [60, 120], restAfter: [12, 24], tempo: 1.35 },
};

// 猫の体の「動かす場所」（512px のコマ上の座標）。付属の猫は meta_v2 の値で上書きされます。
const DEFAULT_RIG = {
  anchor: [125, 330],                        // 腕に合わせる基準点
  breath: { c: [372, 255], s: [105, 92] },   // 呼吸でふくらむ胴体
  head: { c: [200, 150], s: 80, pivot: [268, 228] },
  paw: [160, 362],                           // 腕の上の前足
  tail: [290, 385],                          // しっぽの先
  nose: [177, 221],
  ears: [{ base: [162, 68], tip: [170, 7] }, { base: [310, 150], tip: [352, 107] }],
  eyes: null, mouth: null, tongue: null,     // 付属の猫だけが持つ（まぶた・あご・舌の動き）
  focus: [20, 0, 370, 410],                  // 顔と前足。小さい画面でも必ず見せる範囲
};
const DEFAULT_PLACEMENT = { x: 388, y: 640, scale: 1.4, rotate: 12 };
const DEFAULT_GRADE = { sat: 0.9, contrast: 0.94, lift: 0.015, gain: [0.95, 0.94, 0.935] };
// 写真の光（左から）に合わせた影と質感
const LOOK = { aoTight: 0.34, shadowWide: 0.22, shadowOff: [9, -2], relight: 0.05, rim: 0.22, wrap: 0.28 };

const V2 = (ASSETS.meta && ASSETS.meta.v2) || {};
function builtinProfile(id, name, look, personality, pitch) {
  const m = V2[id] || { cell: 512, crop: [0, 0, 512, 512], rig: {} };
  return {
    id, name, look, personality,
    frames: Object.fromEntries(FRAME_KEYS.map((k) => [k, `v2_${id}_${k}`])),
    thumb: `v2_${id}_thumb`, cell: m.cell, crop: m.crop,
    rig: { ...DEFAULT_RIG, ...m.rig },
    placement: DEFAULT_PLACEMENT, grade: DEFAULT_GRADE, voice: { pitch },
  };
}
// ▼ 猫を増やすときは、この配列に1件足して画像を用意します（アプリ内の「猫を追加する」でも追加できます）
const CAT_PROFILES = [
  builtinProfile('chatora', '茶トラ', '茶色の縞、白い口元と前足', 'amaenbo', 1.0),
  builtinProfile('sabatora', 'サバトラ', '銀灰色の縞、緑の目', 'odayaka', 0.93),
  builtinProfile('ragdoll', 'ラグドール風', 'クリーム色の長毛、青い目', 'yuttari', 1.07),
];
const DEFAULT_SCENE_KEY = 'arm_bg';

// アラームの設定値
const SNOOZE_MS = 5 * 60 * 1000;
const RAMP_SEC = 16;             // 何秒かけて設定音量まで上げるか
const LATE_NOTICE_MS = 15000;    // これ以上遅れたら「遅れて鳴らした」と表示
const MISSED_GRACE_MS = 2 * 60 * 1000;
const BREATH_AMP = 3.0;          // 呼吸の変形量（コマ上のpx。画面では約1.5〜3px）

