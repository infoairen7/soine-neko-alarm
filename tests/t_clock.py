import asyncio, json
from playwright.async_api import async_playwright
import pathlib as _pl
HERE = _pl.Path(__file__).resolve().parent
URL = (HERE.parent / 'index.html').as_uri()
ARGS = ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']
def ok(n, c, x=''): print(('PASS ' if c else 'FAIL ') + n + (f'  [{x}]' if x else ''))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width':1280,'height':800}, locale='ja-JP', timezone_id='Asia/Tokyo')
        page = await ctx.new_page(); await page.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.clock.install(time='2026-12-31T23:50:00+09:00')
        await page.goto(URL); await page.clock.run_for(1500)
        ev = page.evaluate
        await page.fill('#alarmTime', '00:05'); await page.dispatch_event('#alarmTime', 'change')
        prev = await ev("document.getElementById('timePreview').textContent")
        ok('23:50 → 00:05 is 明日 1月1日(金)', '明日' in prev and '1月1日(金)' in prev and '0:05' in prev, prev)
        await page.click('#armBtn')
        tgt = await ev("new Date(window.__nekoApp.alarm.targetAt).toString()")
        ok('target is 2027-01-01 00:05 local', 'Jan 01 2027 00:05' in tgt, tgt)
        await page.fill('#alarmTime', '23:50'); await page.dispatch_event('#alarmTime', 'change')
        prev = await ev("document.getElementById('timePreview').textContent")
        ok('same minute as now → tomorrow', '明日' in prev and '1月1日' in prev, prev)
        await page.fill('#alarmTime', '00:05'); await page.dispatch_event('#alarmTime', 'change')
        sub = await ev("document.getElementById('clockSub').textContent"); ok('clock sub shows date + remaining', '1月1日(金) 0:05' in sub and 'あと15分' in sub, sub)
        await page.clock.fast_forward('10:00'); await page.clock.run_for(1500)
        ok('not ringing before target', await ev("window.__nekoApp.alarm.ringing") is None)
        await page.clock.fast_forward('06:00'); await page.clock.run_for(1500)
        print(await ev("[new Date().toString(), new Date(window.__nekoApp.alarm.targetAt||0).toString(), window.__nekoApp.alarm.time, window.__nekoApp.alarm.targetAt]"))
        r = await ev("window.__nekoApp.alarm.ringing")
        ok('rings after crossing midnight/new year', r is not None and r['source'] == 'alarm', json.dumps(r))
        ok('no page errors', not errs, '; '.join(errs))
        await b.close()
asyncio.run(main())
