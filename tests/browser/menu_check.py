"""Loads the game in headless Chrome with a stand-in for three.js (no WebGL, no network) and checks the menu, HUD and error dialog run without JS errors."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)
import asyncio
from playwright.async_api import async_playwright
STUB = """
(function(){
  function mk(){ const f=function(){}; return new Proxy(f,{
    get(t,k){ if(k===Symbol.toPrimitive) return ()=>0; if(k==='then') return undefined; if(!(k in t)) t[k]=mk(); return t[k]; },
    set(t,k,v){ t[k]=v; return true; }, construct(){ return mk(); }, apply(){ return mk(); } }); }
  window.THREE = mk();
})();
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for name, vp, touch in [('phone', {'width':780,'height':360}, True), ('desk', {'width':1200,'height':720}, False), ('portrait', {'width':390,'height':780}, True)]:
            ctx = await b.new_context(viewport=vp, has_touch=touch, is_mobile=touch)
            page = await ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'ERR_' not in m.text else None)
            async def route(r):
                u = r.request.url
                if 'three' in u: await r.fulfill(body=STUB, content_type='application/javascript')
                elif u.startswith('file:'): await r.continue_()
                else: await r.abort()
            await page.route('**/*', route)
            await page.goto('file://' + ROOT + '/index.html')
            await page.wait_for_timeout(300)
            await page.screenshot(path=os.path.join(OUT, f'{name}-menu.png'))
            await page.click('text=Practice Town')
            await page.wait_for_timeout(1500)
            await page.screenshot(path=os.path.join(OUT, f'{name}-hud.png'))
            if name=='desk':
                await page.click('text=PAUSE'); await page.wait_for_timeout(200)
                await page.click('text=NEW CITY'); await page.wait_for_timeout(200)
                await page.click('text=Altstadt'); await page.wait_for_timeout(1500)
                await page.screenshot(path=os.path.join(OUT, 'desk-error.png'))
            print(name, 'errors:', errs[:5])
            await ctx.close()
        await b.close()
asyncio.run(main())
