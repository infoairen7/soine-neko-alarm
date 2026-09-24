/* =====================================================================
 * 添い寝ねこアラーム  — single-file browser app
 *
 * 構成（上から順に）
 *   1. 設定データ …… 猫・個性・シーンの設定。猫を増やすときはここだけ触ります
 *   2. 保存        …… 軽い設定は localStorage、音声/画像ファイルは IndexedDB
 *   3. 仮の音      …… Web Audio で合成するゴロゴロ音と鳴き声（本物の録音ではありません）
 *   4. 音声管理    …… 再生・音量・フェード・差し替え
 *   5. 画像設定    …… コマ切り出し・位置合わせ・影・当たり判定
 *   6. 描画        …… WebGL（呼吸の局所変形）と Canvas2D の予備描画
 *   7. 猫の状態管理 …… 眠る／目を開ける／抱き直す／舐める／鳴く
 *   8. アラーム管理 …… 目標日時との比較・スヌーズ・テスト・鳴らし方
 *   9. 画面スリープ防止（Screen Wake Lock）
 *  10. 画面（UI）
 * ===================================================================*/
(() => {
'use strict';

const ASSETS = window.NEKO_ASSETS || { images: {}, meta: {} };
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randIn = (r) => rand(r[0], r[1]);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const prefersReduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

