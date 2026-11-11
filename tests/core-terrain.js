const C=require('../js/core.js');
// QM encoder
function encQM(grid /*k x k*/, hf){ const k=grid, n=k*k; const us=[],vs=[],hs=[];let mn=Infinity,mx=-Infinity;
 for(let j=0;j<k;j++)for(let i=0;i<k;i++){const u=i/(k-1),v=j/(k-1),h=hf(u,v);us.push(Math.round(u*32767));vs.push(Math.round(v*32767));hs.push(h);mn=Math.min(mn,h);mx=Math.max(mx,h);}
 const hq=hs.map(h=>Math.round((h-mn)/(mx-mn||1)*32767));
 const idx=[];for(let j=0;j<k-1;j++)for(let i=0;i<k-1;i++){const a=j*k+i;idx.push(a,a+1,a+k,a+1,a+k+1,a+k);}
 // high-water-mark needs indices introduced in order: remap vertices by first use
 const map=new Map(),order=[];for(const i of idx)if(!map.has(i)){map.set(i,order.length);order.push(i);}
 const ru=order.map(i=>us[i]),rv=order.map(i=>vs[i]),rh=order.map(i=>hq[i]),ridx=idx.map(i=>map.get(i));
 const buf=Buffer.alloc(92+6*n+4+ridx.length*2+16);buf.writeFloatLE(mn,24);buf.writeFloatLE(mx,28);buf.writeUInt32LE(n,88);
 const zz=d=>d<0?(-2*d-1):2*d;let o=92;for(const arr of [ru,rv,rh]){let p=0;for(const x of arr){buf.writeUInt16LE(zz(x-p),o);o+=2;p=x;}}
 buf.writeUInt32LE(ridx.length/3,o);o+=4;let hi=0;for(const i of ridx){buf.writeUInt16LE(hi-i,o);o+=2;if(i===hi)hi++;}
 return buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length);}
const lat=46.948,lon=7.4474,R=860,G=10;
const list=C.qmTileList(lat,lon,R,15);console.log('qm tiles',list.length,list[0]);
// world-wide plane: h = 500 + 2000*(lon-lon0) deg... use function of absolute lon/lat
const size=180/2**15,tris=[];
for(const t of list){const west=-180+t.x*size,south=-90+t.y*size;const d=C.decodeQM(encQM(9,(u,v)=>540+ (west+u*size-lon)*111320*Math.cos(lat*Math.PI/180)*0.05 + (south+v*size-lat)*110540*0.02));C.qmAddTriangles(tris,d,t,lat,lon);}
const ras=C.rasterTIN(tris,R,G);let nan=0;for(const v of ras.h)if(v!==v)nan++;console.log('grid',ras.n,'nan',nan);
const T=C.finishTerrain(ras.h,ras.n,R,G,1);
// expected: h = 540 + 0.05*x - 0.02*z (north = -z) → relative slope
const e=(x,z)=>0.05*x-0.02*z;const d0=T.heightAt(0,0)-e(0,0);let maxerr=0;for(let i=0;i<500;i++){const x=(Math.random()-.5)*1500,z=(Math.random()-.5)*1500;maxerr=Math.max(maxerr,Math.abs(T.heightAt(x,z)-e(x,z)-d0));}
console.log('plane err',maxerr.toFixed(3),'base',T.base.toFixed(1),'relief',T.relief.toFixed(1));
// bumpy terrain for drape test
const n=41,h=new Float32Array(n*n);for(let j=0;j<n;j++)for(let i=0;i<n;i++)h[j*n+i]=10*Math.sin(i*0.7)*Math.cos(j*0.5)+0.3*i;
const B=C.makeTerrain(h,n,200,10);
const pos=[-33,0.13,-71, 88,0.13,-20, 5,0.13,97, 150,0.09,150, 190,0.09,150, 150,0.09,190],col=[1,0,0,1,0,0,1,0,0,0,1,0,0,1,0,0,1,0];
const dr=C.drapeFlat(pos,col,B);let area=0,bad=0,red=0;
for(let k=0;k<dr.pos.length;k+=9){const p=dr.pos;const a=Math.abs((p[k+3]-p[k])*(p[k+8]-p[k+2])-(p[k+6]-p[k])*(p[k+5]-p[k+2]))/2;area+=a;
 for(let m=0;m<3;m++){const x=p[k+3*m],y=p[k+3*m+1],z=p[k+3*m+2];const off=dr.col[k+3*m]===1?0.13:0.09;if(Math.abs(y-B.heightAt(x,z)-off)>1e-4)bad++;}
 // centroid must also sit on the surface → piece is within one facet
 const cx=(p[k]+p[k+3]+p[k+6])/3,cy=(p[k+1]+p[k+4]+p[k+7])/3,cz=(p[k+2]+p[k+5]+p[k+8])/3;const off=dr.col[k]===1?0.13:0.09;if(Math.abs(cy-B.heightAt(cx,cz)-off)>1e-3)bad++;}
const A0=Math.abs((88+33)*(97+71)-(5+33)*(-20+71))/2+800;console.log('drape tris',dr.pos.length/9,'area',area.toFixed(1),'expected',A0.toFixed(1),'bad',bad);
// bridge: valley terrain, three pieces incl. overlapping tile-split piece, and a road under it
const m=81,hv=new Float32Array(m*m);for(let j=0;j<m;j++)for(let i=0;i<m;i++){const x=-400+i*10;hv[j*m+i]=Math.min(40,Math.abs(x)*0.5);} // V valley, floor at x=0, rims 40 at |x|>=80
const V=C.makeTerrain(hv,m,400,10);
const w={half:550,roads:[
 {pts:[[-200,0],[-100,0]],w:8,kind:1,name:'West'},
 {pts:[[-100,0],[-20,0]],w:8,kind:1,name:'Bridge',bridge:true},
 {pts:[[-22,0.3],[40,0]],w:8,kind:1,name:'Bridge',bridge:true},   // overlaps the first piece by 2 m
 {pts:[[40,0],[100,0]],w:8,kind:1,name:'Bridge',bridge:true},
 {pts:[[100,0],[200,0]],w:8,kind:1,name:'East'},
 {pts:[[0,-150],[0,150]],w:8,kind:1,name:'Under'}],buildings:[],areas:[],rivers:[]};
C.applyTerrain(w,V);C.indexWorld(w);
const ys=w.roads.filter(r=>r.ys).map(r=>[r.ys[0].toFixed(1),Math.min(...r.ys).toFixed(1),r.ys[r.ys.length-1].toFixed(1)]);console.log('deck ys',JSON.stringify(ys),'terrain at 0',V.heightAt(0,0));
console.log('ground on deck (prev 40):',w.groundAt(0,0,40).toFixed(2),'under (prev 0):',w.groundAt(0,0,0).toFixed(2),'no prev:',w.groundAt(0,0),'off side (prev 40):',w.groundAt(0,30,40).toFixed(2));
const f=C.buildFlat(w);console.log('flat',f.pos.length/9,'deck tris',f.dpos.length/9,f.dpos.some(v=>!isFinite(v)),'spawn',C.pickSpawn(w));
const dd=C.drapeFlat(f.pos,f.col,V);console.log('draped',dd.pos.length/9);
w.buildings.push({pts:[[-150,20],[-130,20],[-130,40],[-150,40]],h:10,id:3});const bb=C.buildBuildings(w);let mn=1e9,mx=-1e9;for(let i=1;i<bb.pos.length;i+=3){mn=Math.min(mn,bb.pos[i]);mx=Math.max(mx,bb.pos[i]);}console.log('building y',mn.toFixed(1),mx.toFixed(1),'ground',V.heightAt(-140,30));
