const C=require('../js/core.js');
const lat0=46.948,lon0=7.4474,sc=C.scale(lat0);console.log('scale',sc.map(v=>v.toFixed(1)));
// geodetic round trip
const e=C.ecef(46.95,7.45,560);console.log('roundtrip',C.geodetic(...e).map(v=>v.toFixed(6)));
// a 10 m box building 300 m east, 200 m north, base at 555 m: build ECEF corners, express as y-up glTF relative to RTC
const f=C.localFrame(lat0,lon0);
const corners=[];for(const de of [0,10])for(const dn of [0,10])for(const h of [555,565])corners.push(C.ecef(lat0+(200+dn)/sc[1],lon0+(300+de)/sc[0],h));
const rtc=corners[0].map(v=>Math.round(v/100)*100);
const mk=(yUp)=>{const pos=[];for(const c of corners){const x=c[0]-rtc[0],y=c[1]-rtc[1],z=c[2]-rtc[2]; if(yUp)pos.push(x,z,-y); else pos.push(x,y,z);}return pos;};
for(const yUp of [true,false]){const pos=mk(true);const r=C.modelToLocal(pos,yUp,rtc,null,f);console.log('yUp',yUp,'up-range',(r[1]-r[0]).toFixed(1),'first',pos.slice(0,3).map(v=>v.toFixed(2)),'last',pos.slice(21).map(v=>v.toFixed(2)));}
// seat on ground: terrain = 3 + 0.01x
const pos=mk(true);C.modelToLocal(pos,true,rtc,null,f);const st=C.seatBuildings([{pos,batch:new Uint16Array(8).fill(4)}],(x,z)=>3+0.01*x,500);
console.log('seat',st,'ys',[pos[1],pos[4]].map(v=>v.toFixed(2)),'expected base',(3+0.01*300-0.3).toFixed(2));
// b3dm parse
const ft=Buffer.from(JSON.stringify({BATCH_LENGTH:1,RTC_CENTER:[1,2,3]})+'  ');const glb=Buffer.concat([Buffer.from('glTF'),Buffer.from([2,0,0,0]),Buffer.alloc(8)]);
const head=Buffer.alloc(28);head.write('b3dm');head.writeUInt32LE(1,4);head.writeUInt32LE(28+ft.length+glb.length,8);head.writeUInt32LE(ft.length,12);
const b=Buffer.concat([head,ft,glb]);const pr=C.parseB3dm(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));console.log('b3dm',pr.rtc,pr.version,pr.glb.byteLength);
// bounding volumes
const d=Math.PI/180,box={lat:lat0,lon:lon0,R:700};
console.log('region in',C.volumeNear({region:[7.44*d,46.94*d,7.45*d,46.95*d,0,1]},null,box),'region out',C.volumeNear({region:[7.6*d,46.94*d,7.7*d,46.95*d,0,1]},null,box),
 'box in',C.volumeNear({box:[...C.ecef(46.95,7.45,550),100,0,0,0,100,0,0,0,50]},null,box),'box out',C.volumeNear({box:[...C.ecef(47.05,7.45,550),100,0,0,0,100,0,0,0,50]},null,box),'sphere',C.volumeNear({sphere:[...C.ecef(46.95,7.45,550),50]},null,box));
