// Paired comparison of a bidding feature: one side bids with the feature on, the other with it off.
// Every deal is played twice (feature for N-S, then for E-W) and compared to both sides off. Result: IMPs per board for the side using the feature.
Object.assign(globalThis, require('./engine.js'));const B=require('./bots.js');
const N=+process.argv[2]||2000, feat=process.argv[3].split(',');const base=['fin','hold','second','trlead','balance'];const allNew=['pendbl'];
const offAll=base.concat(allNew), offVar=base.concat(allNew.filter(x=>!feat.includes(x)));
let seed=+(process.argv[4]||99);const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
function board(hands,dealer,vul,varSide){const auction=[];
 while(!auctionOver(auction)){const s=auctionTurn(dealer,auction);globalThis.BOT_OFF=(varSide&&sideOf(s)===varSide)?offVar:offAll;
  const r=B.botCall(hands[s],s,dealer,auction);auction.push(r.alert?{call:r.call,by:s,alert:r.alert}:{call:r.call,by:s});if(auction.length>60)break}
 globalThis.BOT_OFF=offAll;const ct=finalContract(auction);if(!ct)return{sc:0,key:'P'};
 const t={hands,auction,contract:ct,play:{tricks:[]}};for(let i=0;i<52;i++){const s=playTurn(t.play,ct);applyPlay(t.play,ct,s,B.botPlay(t,s))}
 const d=tricksWon(t.play,ct).decl;return{sc:scoreNS(ct,d,vul),key:auction.map(a=>a.call).join(' ')}}
let imps=0,sq=0,n=0,changed=0;
for(let g=0;g<N;g++){const hands=deal(rnd),bn=g+1,dealer=boardDealer(bn),vul=boardVul(bn);
 const b0=board(hands,dealer,vul,null);
 for(const side of ['NS','EW']){const b1=board(hands,dealer,vul,side);let im=toImps(b1.sc-b0.sc);if(side==='EW')im=-im;if(b1.key!==b0.key)changed++;imps+=im;sq+=im*im;n++}}
const mean=imps/n,se=Math.sqrt((sq/n-mean*mean)/n);
console.log(`${feat.join('+')}: ${n} trials, auctions changed ${changed}, ${mean.toFixed(3)} ± ${se.toFixed(3)} IMPs per board for the side using it`);
