"""Runs the #terrain-test path with mocked swisstopo terrain tiles and a mocked building tileset. Prints the pause-screen info line."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)
import asyncio, struct, math, re, json
from playwright.async_api import async_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'menu_check.py')).read().split('STUB = """')[1].split('"""')[0]
def qm(z,x,y,k=9):
    size=180/2**z; west=-180+x*size; south=-90+y*size
    us=[];vs=[];hs=[]
    for j in range(k):
        for i in range(k):
            u=i/(k-1); v=j/(k-1); lon=west+u*size; lat=south+v*size
            hs.append(540+40*math.sin(lon*900)+30*math.cos(lat*1300)); us.append(round(u*32767)); vs.append(round(v*32767))
    mn=min(hs); mx=max(hs); hq=[round((h-mn)/(mx-mn)*32767) for h in hs]
    idx=[]
    for j in range(k-1):
        for i in range(k-1):
            a=j*k+i; idx+= [a,a+1,a+k,a+1,a+k+1,a+k]
    mp={}; order=[]
    for i in idx:
        if i not in mp: mp[i]=len(order); order.append(i)
    zz=lambda d: -2*d-1 if d<0 else 2*d
    b=bytearray(88); struct.pack_into('<ff',b,24,mn,mx); b+=struct.pack('<I',k*k)
    for arr in (us,vs,hq):
        p=0
        for i in order: b+=struct.pack('<H',zz(arr[i]-p)); p=arr[i]
    b+=struct.pack('<I',len(idx)//3); hi=0
    for i in idx:
        r=mp[i]; b+=struct.pack('<H',hi-r)
        if r==hi: hi+=1
    return bytes(b)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':780,'height':360}, has_touch=True, is_mobile=True)
        page = await ctx.new_page(); errs=[]; reqs=[]
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.type+': '+m.text) if m.type in('error','warning') and 'ERR_' not in m.text else None)
        async def route(r):
            u=r.request.url
            if 'three.min' in u: await r.fulfill(body=STUB, content_type='application/javascript')
            elif u.startswith('file:'): await r.continue_()
            elif 'tileset.json' in u:
                d=math.pi/180
                ts={'asset':{'version':'1.0'},'geometricError':500,'root':{'boundingVolume':{'region':[5*d,45*d,11*d,48*d,0,4000]},'geometricError':500,'refine':'ADD','children':[
                  {'boundingVolume':{'region':[7.44*d,46.94*d,7.45*d,46.95*d,400,700]},'geometricError':0,'content':{'uri':'11/799/503.b3dm'},'children':[{'boundingVolume':{'region':[7.445*d,46.945*d,7.45*d,46.95*d,400,700]},'geometricError':0,'content':{'uri':'12/1/2.b3dm'}}]},
                  {'boundingVolume':{'region':[8.44*d,46.94*d,8.45*d,46.95*d,400,700]},'geometricError':0,'content':{'uri':'11/1/1.b3dm'}}]}}
                await r.fulfill(body=json.dumps(ts), content_type='application/json', headers={'Access-Control-Allow-Origin':'*'})
            elif '.b3dm' in u:
                reqs.append(u); await r.fulfill(body=b'xxxxyyyyzzzzwwww', content_type='application/octet-stream', headers={'Access-Control-Allow-Origin':'*'})
            elif 'layer.json' in u: await r.fulfill(body=json.dumps({'tiles':['{z}/{x}/{y}.terrain?v={version}'],'version':'1.2.3'}), content_type='application/json', headers={'Access-Control-Allow-Origin':'*'})
            elif '.terrain' in u:
                reqs.append(u); m=re.search(r'/(\d+)/(\d+)/(\d+)\.terrain',u)
                await r.fulfill(body=qm(*map(int,m.groups())), content_type='application/octet-stream', headers={'Access-Control-Allow-Origin':'*'})
            else: await r.abort()
        await page.route('**/*', route)
        await page.goto('file://' + ROOT + '/index.html#terrain-test')
        await page.wait_for_timeout(300)
        await page.click('text=Practice Town'); await page.wait_for_timeout(2500)
        await page.keyboard.down('ArrowUp'); await page.wait_for_timeout(1500)
        st = await page.evaluate("document.querySelector('#kmh').textContent")
        await page.click('text=PAUSE'); await page.wait_for_timeout(200)
        print('dbg:', await page.inner_text('#dbg')); print('kmh', st, 'tile reqs', len(reqs), reqs[0]); print('errors', errs[:6])
        await page.screenshot(path=os.path.join(OUT, 'terrain-pause.png'))
        await b.close()
asyncio.run(main())
