const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');
const w=new JSDOM(html,{runScripts:'dangerously'}).window;
setTimeout(()=>{for(let n=2;n<=6;n++){const ev={keys:Array(n).fill(0),movement:'howell'};const R=2*n-1;const met={},ns={};let ok=true;
 for(let r=0;r<R;r++){const sc=w.eval('schedule')(ev,r);const seen=new Set();sc.forEach(p=>{[p.NS,p.EW].forEach(x=>{if(seen.has(x))ok=false;seen.add(x)});const k=[p.NS,p.EW].sort().join('-');met[k]=(met[k]||0)+1;ns[p.NS]=(ns[p.NS]||0)+1});if(seen.size!==2*n)ok=false}
 const pairs=2*n*(2*n-1)/2;const allOnce=Object.keys(met).length===pairs&&Object.values(met).every(v=>v===1);
 console.log(`n=${n}: each round valid ${ok}, every pair meets every other once ${allOnce}, N-S counts per pair ${JSON.stringify(Object.values(ns).sort())}`)}
 const m=w.eval('schedule')({keys:[0,0,0],movement:'mitchell'},1);console.log('mitchell r1',JSON.stringify(m));process.exit(0)},50);
