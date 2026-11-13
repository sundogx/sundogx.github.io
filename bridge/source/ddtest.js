Object.assign(globalThis, require('./engine.js'));const {DDS,parScore}=require('./dds.js');
// brute force minimax for small hands
function brute(hands,strain,leader){const seats=['N','E','S','W'];
 function rec(h,leader,trick){ // returns max NS tricks
  if(trick.length===4){const t={cards:trick};const w=trickWinner(t,strain);const r=sideOf(w)==='NS'?1:0;
    if(h[w].length===0)return r;return r+rec(h,w,[]);}
  const p=trick.length?nextSeat(trick[trick.length-1].seat):leader;
  let cards=h[p];if(trick.length){const led=trick[0].card[0];const f=cards.filter(c=>c[0]===led);if(f.length)cards=f}
  let best=sideOf(p)==='NS'?-1:99;
  for(const c of cards){const nh={...h,[p]:h[p].filter(x=>x!==c)};const v=rec(nh,leader,[...trick,{seat:p,card:c}]);
   best=sideOf(p)==='NS'?Math.max(best,v):Math.min(best,v)}return best}
 return rec(hands,leader,[])}
let bad=0;
for(let g=0;g<+process.argv[2];g++){const full=deal();const n=2+(g%3);
 // take random n cards per hand from a deal: pick n-card endings
 const all=SEATS.flatMap(s=>full[s]).sort(()=>Math.random()-.5);const hands={};SEATS.forEach((s,i)=>hands[s]=all.slice(i*n,i*n+n));
 const strain=['N','S','H','D','C'][g%5];const leader=SEATS[g%4];
 let t1=Date.now();const b=brute(hands,strain,leader);let t2=Date.now();
 const sv=DDS.solver(DDS.toMasks(hands),{S:0,H:1,D:2,C:3,N:4}[strain]);const d=sv.maxNS(SEATS.indexOf(leader),n,Math.floor(n/2));
 if(0)console.log(g,n,t2-t1,Date.now()-t2);if(b!==d){bad++;if(bad<4)console.log('mismatch',JSON.stringify(hands),strain,leader,b,d)}}
console.log('endings mismatches',bad);
let t0=Date.now();
for(let k=0;k<+process.argv[3];k++){const h=deal();const s=Date.now();const tab=DDS.table(h);console.log('deal',k,Date.now()-s,'ms',JSON.stringify(tab),parScore(tab,'None').text)}
console.log('avg',(Date.now()-t0)/5);
