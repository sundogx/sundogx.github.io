// Paired comparison of a bidding feature: one side bids with the feature on, the other with it off.
// A feature is a BID_OFF key of js/bidding.js (e.g. r3g): the other seats bid with it switched off. (pendbl, the old
// BOT_OFF key, is read by nothing now.)
// Every deal is played twice (feature for N-S, then for E-W) and compared to both sides off. Result: IMPs per board for the side using the feature.
// Usage: node tests/bidsim.js [boards=2000] feature[,feature] [seed=99] [workers=cores-2]
// The boards are shared out between worker threads; the totals are added up in board order, so the output is the
// same for any number of workers (workers=1: everything in one thread, as before).
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
Object.assign(globalThis, require('../js/engine.js'));const B=require('../js/bots.js');
const N=+process.argv[2]||2000, feat=process.argv[3].split(',');const base=['fin','hold','second','trlead','balance'];const allNew=['pendbl'];
const offAll=base.concat(allNew), offVar=base.concat(allNew.filter(x=>!feat.includes(x)));
const W=Math.max(1,Math.min(N,+process.argv[5]||Math.max(1,os.cpus().length-2)));
function board(hands,dealer,vul,varSide){const auction=[];
 while(!auctionOver(auction)){const s=auctionTurn(dealer,auction);const v=varSide&&sideOf(s)===varSide;globalThis.BOT_OFF=v?offVar:offAll;globalThis.BID_OFF=v?[]:feat;
  const r=B.botCall(hands[s],s,dealer,auction,vul);auction.push(r.alert?{call:r.call,by:s,alert:r.alert}:{call:r.call,by:s});if(auction.length>60)break}
 globalThis.BOT_OFF=offAll;globalThis.BID_OFF=undefined;const ct=finalContract(auction);if(!ct)return{sc:0,key:'P'};
 const t={hands,auction,contract:ct,play:{tricks:[]}};for(let i=0;i<52;i++){const s=playTurn(t.play,ct);applyPlay(t.play,ct,s,B.botPlay(t,s))}
 const d=tricksWon(t.play,ct).decl;return{sc:scoreNS(ct,d,vul),key:auction.map(a=>a.call).join(' ')}}
// the boards of share w of W (every deal is dealt in every share, to keep the random sequence): [[im, changed] x2] per board
function rows(w){let seed=+(process.argv[4]||99);const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
 const out=[];
 for(let g=0;g<N;g++){const hands=deal(rnd);if(g%W!==w)continue;const bn=g+1,dealer=boardDealer(bn),vul=boardVul(bn);
  const b0=board(hands,dealer,vul,null),r=[];
  for(const side of ['NS','EW']){const b1=board(hands,dealer,vul,side);let im=toImps(b1.sc-b0.sc);if(side==='EW')im=-im;r.push([im,b1.key!==b0.key])}
  out.push([g,r])}
 return out}
function report(all){let imps=0,sq=0,n=0,changed=0;
 all.sort((a,b)=>a[0]-b[0]);for(const[,r]of all)for(const[im,ch]of r){if(ch)changed++;imps+=im;sq+=im*im;n++}
 const mean=imps/n,se=Math.sqrt((sq/n-mean*mean)/n);
 console.log(`${feat.join('+')}: ${n} trials, auctions changed ${changed}, ${mean.toFixed(3)} ± ${se.toFixed(3)} IMPs per board for the side using it`)}
if(!isMainThread)parentPort.postMessage(rows(workerData.w));
else if(W===1)report(rows(0));
else{const all=[];let live=W;
 for(let w=0;w<W;w++){const wk=new Worker(__filename,{argv:process.argv.slice(2),workerData:{w}});
  wk.on('message',m=>all.push(...m));wk.on('error',e=>{console.error(e);process.exitCode=1});
  wk.on('exit',()=>{if(--live===0&&!process.exitCode)report(all)})}}
