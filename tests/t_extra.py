import asyncio
from playwright.async_api import async_playwright
import pathlib as _pl
HERE = _pl.Path(__file__).resolve().parent
URL = (HERE.parent / 'index.html').as_uri()
ARGS = ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']
def ok(n, c, x=''): print(('PASS ' if c else 'FAIL ') + n + (f'  [{x}]' if x else ''))
async def newpage(b, **kw):
    ctx = await b.new_context(locale='ja-JP', timezone_id='Asia/Tokyo', **kw)
    page = await ctx.new_page(); await page.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
    return ctx, page, errs
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        # custom uploads
        ctx, page, errs = await newpage(b, viewport={'width':1280,'height':800})
        await page.goto(URL); await page.wait_for_timeout(1200)
        ev = page.evaluate
        await ev("document.getElementById('dCats').open = true; document.getElementById('dSounds').open = true")
        await page.set_input_files('#sheetFile', str(HERE.parent / 'materials/original/cat_sabatora_2x3.png')); await page.wait_for_timeout(600)
        msg = await ev("document.getElementById('sheetMsg').textContent"); ok('sheet size measured from image', '1024×1536' in msg and '512×512' in msg, msg)
        ok('2x3 suggested', await ev("[document.getElementById('sheetCols').value, document.getElementById('sheetRows').value].join('x')") == '2x3')
        await page.fill('#sheetName', 'サバ２'); await page.click('#sheetAdd'); await page.wait_for_timeout(2500)
        ok('custom overlay cat added & selected', (await ev("window.__nekoApp.cat.profile.name")) == 'サバ２' and (await ev("window.__nekoApp.cat.mode")) == 'overlay', await ev("document.getElementById('sheetMsg').textContent"))
        await page.screenshot(path=str(HERE / f'out_custom_overlay.png'))
        await page.set_input_files('#sheetFile', str(HERE / 'sheet_2x2_opaque.jpg')); await page.wait_for_timeout(600)
        ok('2x2 suggested for square sheet', await ev("[document.getElementById('sheetCols').value, document.getElementById('sheetRows').value].join('x')") == '2x2')
        mp = await ev("['sleep','sleep2','cuddle','lick','meow','meow2'].map(p=>document.getElementById('map-'+p).value).join(',')")
        ok('2x2 default mapping sleep/cuddle/lick/meow', mp == '0,-1,1,2,3,-1', mp)
        await page.fill('#sheetName', '背景入り'); await page.click('#sheetAdd'); await page.wait_for_timeout(2500)
        m = await ev("document.getElementById('sheetMsg').textContent")
        ok('opaque sheet falls back to full mode', (await ev("window.__nekoApp.cat.mode")) == 'full' and '背景が透過されていない' in m, m)
        await ev("window.__nekoApp.behavior.cur = 'meow'; window.__nekoApp.viewDirty = true"); await page.wait_for_timeout(300)
        await page.screenshot(path=str(HERE / f'out_custom_full.png'))
        ok('custom cats listed', await ev("document.querySelectorAll('#catList .cat-chip').length") == 5)
        # audio uploads
        await page.set_input_files('#purrFile', str(HERE / 'purr_test.wav')); await page.wait_for_timeout(800)
        await page.set_input_files('#meowFile', [str(HERE / 'meow_test.wav')]*2); await page.wait_for_timeout(800)
        ok('purr replaced', str(HERE / 'purr_test.wav') in await ev("document.getElementById('purrNow').textContent"))
        ok('meows replaced (2)', '2個' in await ev("document.getElementById('meowNow').textContent"))
        ok('badge shows uploaded', await ev("document.getElementById('soundBadge').textContent") == 'アップロード音')
        await page.click('#testSoundBtn'); await page.wait_for_timeout(2000)
        ok('uploaded sounds play', await ev("window.__nekoApp.audio.running && window.__nekoApp.audio.custom.meows.length === 2"))
        # persistence across reload
        await page.reload(); await page.wait_for_timeout(3500)
        ok('custom cats restored after reload', await ev("document.querySelectorAll('#catList .cat-chip').length") == 5)
        ok('selected custom cat restored', await ev("window.__nekoApp.cat.profile.name") == '背景入り')
        ok('uploaded sounds restored (pending until audio unlock)', str(HERE / 'purr_test.wav') in await ev("document.getElementById('purrNow').textContent"))
        await ev("document.getElementById('dSounds').open = true")
        await page.click('#purrReset'); await page.click('#meowReset'); await page.wait_for_timeout(300)
        ok('reset to synthetic sound', await ev("document.getElementById('soundBadge').textContent") == '仮の音')
        ok('no page errors (uploads)', not errs, '; '.join(errs))
        await ctx.close()
        # night mode + placement
        ctx, page, errs = await newpage(b, viewport={'width':1280,'height':800})
        await page.goto(URL); await page.wait_for_timeout(1200); ev = page.evaluate
        await ev("document.getElementById('dSettings').open = true")
        await page.check('#nightMode'); await page.wait_for_timeout(900)
        ok('night mode dims scene', float(await ev("getComputedStyle(document.getElementById('dim')).opacity")) > 0.4)
        await page.screenshot(path=str(HERE / f'out_night.png'))
        await page.check('#motionStop'); await page.wait_for_timeout(200)
        ok('motion stop → breath 0', await ev("window.__nekoApp.behavior.renderState(performance.now()).breath") == 0)
        ok('no page errors (night)', not errs, '; '.join(errs))
        await ctx.close()
        for name, vp, dpr in [('landscape', {'width':844,'height':390}, 2), ('small', {'width':360,'height':640}, 2)]:
            ctx, page, errs = await newpage(b, viewport=vp, device_scale_factor=dpr, is_mobile=True, has_touch=True)
            await page.goto(URL); await page.wait_for_timeout(1200)
            await page.evaluate("window.__nekoApp.alarm.testAt = Date.now() + 300"); await page.wait_for_timeout(1800)
            await page.screenshot(path=str(HERE / f'out_{name}.png'))
            vis = await page.evaluate("""(() => { const a = window.__nekoApp; const r = a.sceneEl.getBoundingClientRect(); const v = a.viewCss; const f = a.cat.rig.focus;
                const pts = [[f[0],f[1]],[f[0]+f[2],f[1]],[f[0],f[1]+f[3]],[f[0]+f[2],f[1]+f[3]]].map(([x,y]) => { const m=a.M.m; const X=m[0]*x+m[1]*y+m[2], Y=m[3]*x+m[4]*y+m[5]; return [v.tx+v.s*X, v.ty+v.s*Y]; });
                const sh = document.getElementById('alarmSheet').getBoundingClientRect(); const over = sh.left < r.right - 10 && sh.top < r.bottom;
                const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]); const bottomLimit = over ? Math.min(r.height, sh.top - r.top) : r.height;
                return {ok: Math.min(...xs) >= -2 && Math.max(...xs) <= r.width+2 && Math.min(...ys) >= -2 && Math.max(...ys) <= bottomLimit + 2, box:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(Math.round), scene:[r.width,r.height], sheetTop: Math.round(sh.top)}; })()""")
            ok(f'[{name}] face+paws within visible scene during alarm', vis['ok'], str(vis))
            btn = await page.evaluate("(() => { const b = document.getElementById('wakeBtn').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; })()")
            ok(f'[{name}] 起きたよ button on screen', btn)
            ok(f'[{name}] no page errors', not errs, '; '.join(errs))
            await ctx.close()
        await b.close()
        # 2D fallback (no WebGL)
        b = await p.chromium.launch(args=['--disable-webgl','--disable-3d-apis','--autoplay-policy=no-user-gesture-required'])
        ctx, page, errs = await newpage(b, viewport={'width':1000,'height':700})
        await page.goto(URL); await page.wait_for_timeout(1500)
        ok('fallback renderer used', await page.evaluate("window.__nekoApp.renderer.kind") == '2d')
        await page.screenshot(path=str(HERE / f'out_fallback2d.png'))
        ok('no page errors (2d)', not errs, '; '.join(errs))
        await b.close()
asyncio.run(main())
