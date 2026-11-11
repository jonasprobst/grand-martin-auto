const C=require('../js/core.js');
// tiny MVT encoder
const vi=n=>{const o=[];while(n>127){o.push((n%128)|128);n=Math.floor(n/128);}o.push(n);return o;};
const zz=n=>n<0?-2*n-1:2*n;
const fld=(f,w)=>vi(f*8+w), bytes=(f,b)=>[...fld(f,2),...vi(b.length),...b], str=(f,s)=>bytes(f,[...Buffer.from(s)]);
const geom=(rings,close)=>{const g=[];let x=0,y=0;for(const r of rings){g.push(1*8+1,zz(r[0][0]-x),zz(r[0][1]-y));x=r[0][0];y=r[0][1];g.push((r.length-1)*8+2);for(let i=1;i<r.length;i++){g.push(zz(r[i][0]-x),zz(r[i][1]-y));x=r[i][0];y=r[i][1];}if(close)g.push(1*8+7);}return g.flatMap(vi);};
function layer(name,feats){const keys=[],vals=[],vk=[];let b=[...fld(15,0),...vi(2),...str(1,name)];
 for(const f of feats){const tags=[];for(const [k,v] of Object.entries(f.p)){let ki=keys.indexOf(k);if(ki<0){ki=keys.length;keys.push(k);}const s=JSON.stringify(v);let v2=vk.indexOf(s);if(v2<0){v2=vk.length;vk.push(s);vals.push(v);}tags.push(ki,v2);}
  b.push(...bytes(2,[...bytes(2,tags.flatMap(vi)),...fld(3,0),...vi(f.t),...bytes(4,geom(f.g,f.t===3))]));}
 for(const k of keys)b.push(...str(3,k));
 for(const v of vals){let vb;if(typeof v==='string')vb=str(1,v);else if(typeof v==='boolean')vb=[...fld(7,0),v?1:0];else if(Number.isInteger(v))vb=[...fld(4,0),...vi(v)];else{const d=Buffer.alloc(8);d.writeDoubleLE(v);vb=[...fld(3,1),...d];}b.push(...bytes(4,vb));}
 b.push(...fld(5,0),...vi(4096));return bytes(3,b);}
const lat=47.3697,lon=8.5392,list=C.tileList(lat,lon,550,14);console.log('tiles',list);
const t=list[0];
// put features around the centre: find tile px of centre
const n=2**14, cx=((lon+180)/360*n-t.x)*4096, r=lat*Math.PI/180, cy=((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n-t.y)*4096;
const X=Math.round(cx),Y=Math.round(cy);console.log('centre px',X,Y);
const buf=Uint8Array.from([
 ...layer('transportation',[{t:2,p:{class:'primary'},g:[[[X-300,Y],[X,Y],[X+300,Y+40]]]},{t:2,p:{class:'minor',brunnel:'tunnel'},g:[[[X,Y],[X,Y+90]]]},{t:2,p:{class:'path',subclass:'footway'},g:[[[X,Y],[X+9,Y+90]]]},
   {t:2,p:{class:'minor'},g:[[[X,Y-200],[X,Y+200]],[[X+100,Y-200],[X+100,Y+200]]]}]),
 ...layer('transportation_name',[{t:2,p:{name:'Bahnhofstrasse','name:latin':'Bahnhofstrasse'},g:[[[X-300,Y],[X+300,Y+40]]]}]),
 ...layer('building',[{t:3,p:{render_height:21.5},g:[[[X+20,Y+20],[X+60,Y+20],[X+60,Y+60],[X+20,Y+60]],[[X+30,Y+30],[X+30,Y+50],[X+50,Y+50],[X+50,Y+30]]]},{t:3,p:{},g:[[[X-80,Y+20],[X-40,Y+20],[X-40,Y+60],[X-80,Y+60]]]}]),
 ...layer('water',[{t:3,p:{class:'river'},g:[[[X-400,Y-300],[X+400,Y-300],[X+400,Y-200],[X-400,Y-200]],[[X-50,Y-270],[X-50,Y-230],[X+50,Y-230],[X+50,Y-270]]]}]),
 ...layer('landcover',[{t:3,p:{class:'grass',subclass:'park'},g:[[[X-300,Y+100],[X-100,Y+100],[X-100,Y+300],[X-300,Y+300]]]}]),
 ...layer('poi',[{t:1,p:{name:'x',rank:3,ok:true},g:[[[X,Y]]]}]),
]);
const layers=C.decodeMVT(buf);console.log(Object.keys(layers),layers.building.feats.length,layers.building.values,layers.poi.values);
const w=C.indexWorld(C.worldFromTiles([Object.assign({layers},t),...list.slice(1).map(q=>Object.assign({layers:{}},q))],lat,lon,550));
console.log('roads',w.roads.map(r=>[r.name,r.w,r.pts.length,r.pts[0].map(v=>+v.toFixed(1))]),'bld',w.buildings.map(b=>[b.h,b.pts.length,+C.polyArea(b.pts).toFixed(0)]),'areas',w.areas.map(a=>a.type),'riv',w.rivers.length);
const f=C.buildFlat(w),b=C.buildBuildings(w);console.log(f.pos.length/3,b.pos.length/3,f.pos.some(v=>!isFinite(v)));
const sp=C.pickSpawn(w);console.log(sp,C.placeStars(w,5,sp.x,sp.z,C.mulberry32(2)).length,C.placeTrees(w,C.mulberry32(3)).length);
// metres per tile px at this lat: expect ~ 40075016*cos(lat)/2^14/4096
console.log('m/px',(40075016*Math.cos(r)/n/4096).toFixed(3),'road len m',Math.hypot(w.roads[0].pts[1][0]-w.roads[0].pts[0][0],w.roads[0].pts[1][1]-w.roads[0].pts[0][1]).toFixed(1));
