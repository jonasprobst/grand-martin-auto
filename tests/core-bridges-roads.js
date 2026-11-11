const C=require('../js/core.js');
const mk=(f)=>{const m=121,h=new Float32Array(m*m);for(let j=0;j<m;j++)for(let i=0;i<m;i++)h[j*m+i]=f(-600+i*10,-600+j*10);return C.makeTerrain(h,m,600,10);};
// 1. valley with sloping rims; bridge split in two pieces overlapping by 50 m, end points not on each other's vertices; approach roads start a bit down the slope
const V=mk((x,z)=>Math.min(40,Math.abs(x)*0.5)+ (Math.abs(x)>80?0:0));
const w={half:550,roads:[
 {pts:[[-300,0],[-70,0]],w:8,kind:1,name:'West'},              // ends 5 m down the slope (terrain 35)
 {pts:[[-70,0],[27.3,0]],w:8,kind:1,name:'B',bridge:true},
 {pts:[[-23.1,0.4],[70,0]],w:8,kind:1,name:'B',bridge:true},
 {pts:[[70,0],[300,0]],w:8,kind:1,name:'East'},
 {pts:[[0,-200],[0,200]],w:8,kind:1,name:'Under'}],buildings:[],areas:[],rivers:[]};
C.applyTerrain(w,V);C.indexWorld(w);
for(const r of w.roads.filter(r=>r.ys))console.log('deck',r.ys[0].toFixed(1),'min',Math.min(...r.ys).toFixed(1),'end',r.ys[r.ys.length-1].toFixed(1));
let prof=[];for(let x=-120;x<=120;x+=10)prof.push(w.groundAt(x,0,x<-70||x>70?V.heightAt(x,0):38).toFixed(1));console.log('drive profile',prof.join(' '));
console.log('valley floor under bridge still low:',V.heightAt(0,60).toFixed(1),V.heightAt(0,0).toFixed(1));
// 2. hillside: slope across the road 20%, plus bumps
const S=mk((x,z)=>0.2*z+1.5*Math.sin(x/7)+100);
const w2={half:550,roads:[{pts:[[-300,0],[300,0]],w:8,kind:1,name:'Hang'}],buildings:[],areas:[],rivers:[]};
const before=[S.heightAt(50,4)-S.heightAt(50,-4)];let bump0=0;for(let x=-200;x<200;x+=2)bump0=Math.max(bump0,Math.abs(S.heightAt(x+2,0)-S.heightAt(x,0)));
C.applyTerrain(w2,S);let cross=0,bump=0;for(let x=-200;x<200;x+=2){cross=Math.max(cross,Math.abs(S.heightAt(x,4)-S.heightAt(x,-4)));bump=Math.max(bump,Math.abs(S.heightAt(x+2,0)-S.heightAt(x,0)));}
console.log('cross tilt over 8 m before',before[0].toFixed(2),'after',cross.toFixed(2),'| step per 2 m before',bump0.toFixed(2),'after',bump.toFixed(2),'| far away unchanged',(S.heightAt(0,200)-(0.2*200+1.5*Math.sin(0)+100)).toFixed(2));
