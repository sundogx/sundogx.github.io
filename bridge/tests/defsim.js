// Paired comparison: same deals and auctions, defence variant vs baseline. Lower declarer tricks = better defence.
// Usage: node tests/defsim.js [boards=600] feature[,feature] [workers=cores-2]
// The boards are shared out between worker threads and added up in board order: the same output for any number of
// workers (workers=1: one thread, as before).
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
Object.assign(globalThis, require('../js/engine.js'));const B=require('../js/bots.js');
const N=+process.argv[2]||600, feat=process.argv[3];const base=['fin','hold','second'];
const W=Math.max(1,Math.min(N,+process.argv[4]||Math.max(1,os.cpus().length-2)));
function playOut(hands,auction,ct,offs){globalThis.BOT_OFF=offs;const t={hands,auction,contract:ct,play:{tricks:[]}};
 for(let i=0;i<52;i++){const s=playTurn(t.play,ct);applyPlay(t.play,ct,s,B.botPlay(t,s))}return tricksWon(t.play,ct).decl}
function rows(w){let seed=4242;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
 const out=[];
 for(let g=0;g<N;g++){const hands=deal(rnd);if(g%W!==w)continue;const dealer=boardDealer(g+1),auction=[];globalThis.BOT_OFF=base;
  while(!auctionOver(auction)){const s=auctionTurn(dealer,auction);const r=B.botCall(hands[s],s,dealer,auction,boardVul(g+1));auction.push(r.alert?{call:r.call,by:s,alert:r.alert}:{call:r.call,by:s})}
  const ct=finalContract(auction);if(!ct)continue;
  // variant: feature on only for defenders is equivalent here since features only affect defender leads
  const a=playOut(hands,auction,ct,base.concat(['setcash','sluff','trlead'])), b=playOut(hands,auction,ct,base.concat(['setcash','sluff','trlead'].filter(x=>!feat.split(',').includes(x))));
  out.push([g,b-a])}
 return out}
function report(all){let diff=0,sq=0,n=0,changed=0;
 all.sort((x,y)=>x[0]-y[0]);for(const[,d]of all){diff+=d;sq+=d*d;n++;if(d)changed++}
 const mean=diff/n,se=Math.sqrt((sq/n-mean*mean)/n);
 console.log(`features ${feat}: boards ${n}, changed ${changed}, declarer tricks change ${mean.toFixed(4)} ± ${se.toFixed(4)} (negative = better defence)`)}
if(!isMainThread)parentPort.postMessage(rows(workerData.w));
else if(W===1)report(rows(0));
else{const all=[];let live=W;
 for(let w=0;w<W;w++){const wk=new Worker(__filename,{argv:process.argv.slice(2),workerData:{w}});
  wk.on('message',m=>all.push(...m));wk.on('error',e=>{console.error(e);process.exitCode=1});
  wk.on('exit',()=>{if(--live===0&&!process.exitCode)report(all)})}}
