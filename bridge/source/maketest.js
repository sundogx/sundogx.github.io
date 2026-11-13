Object.assign(globalThis, require('./engine.js'));const B=require('./bots.js');
const off=process.argv[2]?process.argv[2].split(','):null;let seed=5;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
let made=0,n=0,dbl=0;for(let g=0;g<2000;g++){const hands=deal(rnd),dealer=boardDealer(g+1),auction=[];if(off)globalThis.BOT_OFF=off;
 while(!auctionOver(auction)){const s=auctionTurn(dealer,auction);const r=B.botCall(hands[s],s,dealer,auction);auction.push({call:r.call,by:s,alert:r.alert})}
 const ct=finalContract(auction);if(!ct)continue;n++;if(ct.doubled)dbl++;const t={hands,auction,contract:ct,play:{tricks:[]}};
 for(let i=0;i<52;i++){const s=playTurn(t.play,ct);applyPlay(t.play,ct,s,B.botPlay(t,s))}if(tricksWon(t.play,ct).decl>=ct.level+6)made++}
console.log(off?off.join(','):'defaults','made',(100*made/n).toFixed(1)+'%','doubled',dbl);
