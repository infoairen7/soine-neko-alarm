"""付属の猫素材を作り直すスクリプト（materials/original → assets/）

使い方（Python 3 と numpy / opencv-python / pillow / scipy が必要）:
    cd tools/asset_pipeline
    python3 run_all.py

手順:
  1. step1_body_align.py … 各ポーズの胴体を「眠る」コマに合わせる
  2. build_v2b.py        … 頭の位置もそろえ、胴体は「眠る」コマのまま固定
  3. muzzle.py           … 鳴く顔を鼻の位置でそろえる（口のまわりだけ使う）
  4. export_v2.py        … 前足の位置直し・毛先・粒状感を加えて assets/ に書き出す
目・口・舌などの位置（RIG）は export_v2.py に手で測った値として入っています。
"""
import runpy, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
for step in ['step1_body_align.py', 'build_v2b.py', 'muzzle.py', 'export_v2.py']:
    print('==>', step)
    runpy.run_path(step, run_name='__main__')
print('done: assets/ を更新しました。続けて python3 tools/build.py を実行してください。')
