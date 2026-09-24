"""src/ と assets/ から、1ファイルで動く index.html を作る。

    python3 tools/build.py

画像はすべて index.html の中に埋め込まれるので、index.html だけをブラウザで開けば動きます。
"""
import base64, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
A = ROOT / 'assets'
PARTS = ['s0_head', 's1_config', 's2_store', 's3_synth', 's4_audio', 's5_image', 's6_render', 's7_anim', 's8_alarm', 's9_wake', 's10_ui']

def uri(p, mime):
    return f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode()

def build():
    images = {'arm_bg': uri(A / 'arm_bg.webp', 'image/webp')}
    for cat in ['chatora', 'sabatora', 'ragdoll']:
        for key in ['sleep', 'sleep2', 'cuddle', 'lick', 'meowA', 'meowB', 'thumb']:
            images[f'v2_{cat}_{key}'] = uri(A / f'v2_{cat}_{key}.webp', 'image/webp')
    meta = {'v2': json.loads((A / 'meta_v2.json').read_text(encoding='utf-8'))}
    assets_js = 'window.NEKO_ASSETS=' + json.dumps({'images': images, 'meta': meta}, separators=(',', ':')) + ';'
    css = (ROOT / 'src/app.css').read_text(encoding='utf-8')
    body = (ROOT / 'src/body.html').read_text(encoding='utf-8')
    js = ''.join((ROOT / f'src/js/{p}.js').read_text(encoding='utf-8') for p in PARTS)
    fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
             '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
             '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap">')
    html = ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<title>添い寝ねこアラーム</title>\n'
            '<meta name="description" content="猫が腕に抱きついて眠り、時間になると鳴いて起こしてくれるブラウザのアラーム">\n'
            f'{fonts}\n<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n'
            f'<script>{assets_js}</script>\n<script>\n{js}\n</script>\n</body>\n</html>\n')
    out = ROOT / 'index.html'
    out.write_text(html, encoding='utf-8')
    print(f'{out.name}: {out.stat().st_size // 1024} KB')

if __name__ == '__main__':
    build()
