// Paired comparison: same deals and auctions, defence variant vs baseline. Lower declarer tricks = better defence.
Object.assign(globalThis, require('./engine.js'));const B=require('./bots.js');
const N=+process.argv[2]||600, feat=process.argv[3];const base=['fin','hold','second'];
let seed=4242;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
let diff=0,sq=0,n=0,changed=0;
function playOut(hands,auction,ct,offs){globalThis.BOT_OFF=offs;const t={hands,auction,contract:ct,play:{tricks:[]}};
 for(let i=0;i<52;i++){const s=playTurn(t.play,ct);applyPlay(t.play,ct,s,B.botPlay(t,s))}return tricksWon(t.play,ct).decl}
for(let g=0;g<N;g++){const hands=deal(rnd),dealer=boardDealer(g+1),auction=[];globalThis.BOT_OFF=base;
 while(!auctionOver(auction)){const s=auctionTurn(dealer,auction);const r=B.botCall(hands[s],s,dealer,auction);auction.push(r.alert?{call:r.call,by:s,alert:r.alert}:{call:r.call,by:s})}
 const ct=finalContract(auction);if(!ct)continue;
 // variant: feature on only for defenders is equivalent here since features only affect defender leads
 const a=playOut(hands,auction,ct,base.concat(['setcash','sluff','trlead'])), b=playOut(hands,auction,ct,base.concat(['setcash','sluff','trlead'].filter(x=>!feat.split(',').includes(x))));
 const d=b-a;diff+=d;sq+=d*d;n++;if(d)changed++;}
const mean=diff/n,se=Math.sqrt((sq/n-mean*mean)/n);
console.log(`features ${feat}: boards ${n}, changed ${changed}, declarer tricks change ${mean.toFixed(4)} ± ${se.toFixed(4)} (negative = better defence)`);
