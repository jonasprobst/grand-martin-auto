const C=require('../js/core.js');
const w=C.indexWorld(C.practiceTown());
const f=C.buildFlat(w), b=C.buildBuildings(w);
const bad=a=>a.some(v=>!isFinite(v));
console.log('roads',w.roads.length,'bld',w.buildings.length,'flat verts',f.pos.length/3,f.col.length/3,'bverts',b.pos.length/3,b.nor.length/3,b.uv.length/2,'nan',bad(f.pos),bad(b.pos));
// wall normals outward: for first building, normal should point away from centroid
{const B=w.buildings[0];let cx=0,cz=0;B.pts.forEach(p=>{cx+=p[0];cz+=p[1]});cx/=B.pts.length;cz/=B.pts.length;
 const x=(b.pos[0]+b.pos[3])/2,z=(b.pos[2]+b.pos[5])/2;console.log('outward',((x-cx)*b.nor[0]+(z-cz)*b.nor[2])>0);
 // winding matches normal
 const A=[b.pos[0],b.pos[1],b.pos[2]],Bq=[b.pos[3],b.pos[4],b.pos[5]],Cq=[b.pos[6],b.pos[7],b.pos[8]];
 const u=Bq.map((v,i)=>v-A[i]),v=Cq.map((q,i)=>q-A[i]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
 console.log('winding agrees',n[0]*b.nor[0]+n[2]*b.nor[2]>0);}
// triangulation area check on L-shape and concave star, both orientations
for(const p of [[[0,0],[10,0],[10,4],[4,4],[4,10],[0,10]], [[0,0],[5,2],[10,0],[8,5],[10,10],[5,8],[0,10],[2,5]]]){
 for(const q of [p,p.slice().reverse()]){const t=C.triangulate(q);let a=0;for(let i=0;i<t.length;i+=3){const A=q[t[i]],B=q[t[i+1]],D=q[t[i+2]];a+=((B[0]-A[0])*(D[1]-A[1])-(B[1]-A[1])*(D[0]-A[0]))/2;}
 console.log('tri',t.length/3,'area',a.toFixed(2),'poly',Math.abs(C.polyArea(q)).toFixed(2));}}
const sp=C.pickSpawn(w);console.log('spawn',sp, 'onroad',w.nearestRoad(sp.x,sp.z).d);
const st=C.placeStars(w,10,sp.x,sp.z,C.mulberry32(5));console.log('stars',st.length, st.every(s=>w.nearestRoad(s.x,s.z).d<0));
console.log('trees',C.placeTrees(w,C.mulberry32(3)).length);
// drive: straight 6s
let s={x:sp.x,z:sp.z,h:sp.h,v:0,steer:0};const inp={up:1,down:0,left:0,right:0,brake:0};
for(let i=0;i<360;i++)C.stepCar(s,inp,1/60,w);console.log('after 6s v',s.v.toFixed(1),'dist',Math.hypot(s.x-sp.x,s.z-sp.z).toFixed(0),'street',s.street);
// turn right for 1s: heading decreases
const h0=s.h;inp.right=1;for(let i=0;i<60;i++)C.stepCar(s,inp,1/60,w);console.log('dh',(s.h-h0).toFixed(2));
// random drive, count bumps, never inside a building
let bumps=0,inside=0,edge=0;const r=C.mulberry32(9);
for(let i=0;i<60000;i++){if(i%90==0){inp.left=r()<.3?1:0;inp.right=r()<.3?1:0;inp.up=r()<.8?1:0;inp.down=inp.up?0:1;}
 const ev=C.stepCar(s,inp,1/60,w);if(ev.bump)bumps++;if(ev.edge)edge++;if(w.hitBuilding(s.x,s.z)&&w.nearestRoad(s.x,s.z).d>1)inside++;}
console.log('bumps',bumps,'edge',edge,'inside',inside,'pos',s.x.toFixed(0),s.z.toFixed(0),isFinite(s.v));
// OSM parse
const lat=47.37,lon=8.54;const g=(a,b)=>({lat:lat+a/110540,lon:lon+b/(111320*Math.cos(lat*Math.PI/180))});
const j={elements:[{type:'way',id:1,tags:{highway:'residential',name:'Bahnhofstrasse'},geometry:[g(0,-100),g(0,0),g(50,100)]},
 {type:'way',id:2,tags:{building:'yes','building:levels':'4'},geometry:[g(20,10),g(20,30),g(40,30),g(40,10),g(20,10)]},
 {type:'way',id:3,tags:{leisure:'park'},geometry:[g(-20,10),g(-20,60),g(-70,60),g(-70,10),g(-20,10)]},
 {type:'way',id:4,tags:{waterway:'river'},geometry:[g(-200,-200),g(-200,200)]},{type:'way',id:5,tags:{highway:'primary',tunnel:'yes'},geometry:[g(0,0),g(9,9)]},{type:'node',id:9}]};
const o=C.indexWorld(C.parseOSM(j,lat,lon,550));console.log('osm',o.roads.length,o.buildings.length,o.buildings[0].h.toFixed(1),o.areas.length,o.rivers.length,o.roads[0].pts.map(p=>p.map(v=>+v.toFixed(1))));
console.log('north is -z:',o.buildings[0].pts[0], 'hit',o.hitBuilding(20,-30), o.nearestRoad(0,0).r.name, C.buildFlat(o).pos.length>0, C.buildBuildings(o).pos.length/3);
console.log(C.overpassQuery(lat,lon,550).slice(0,120));
