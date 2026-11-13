Object.assign(globalThis, require('./engine.js'));const B=require('./bots.js');
let stats={games:0,passout:0,levels:{},errors:0,made:0,long:0};const samples=[];
for(let g=0;g<3000;g++){
 const n=g+1,dealer=boardDealer(n),vul=boardVul(n),hands=deal();const auction=[];
 while(!auctionOver(auction)){const s=auctionTurn(dealer,auction);const r=B.botCall(hands[s],s,dealer,auction);const c=r.call;
  if(!isLegalCall(dealer,auction,c)){stats.errors++;console.log('illegal',c);break}auction.push({call:c,by:s,alert:r.alert});if(auction.length>40){stats.long++;break}}
 const ct=finalContract(auction);stats.games++;if(!ct){stats.passout++;continue}
 stats.levels[ct.level+ct.strain]=(stats.levels[ct.level+ct.strain]||0)+1;
 const t={hands,auction,contract:ct,play:{tricks:[]}};
 for(let i=0;i<52;i++){let s=playTurn(t.play,ct);const ctrl=s;const card=B.botPlay(t,s);
  if(!legalPlays(hands,t.play,ct,s).includes(card)){stats.errors++;console.log('illegal play');break}applyPlay(t.play,ct,s,card);}
 const tw=tricksWon(t.play,ct);if(tw.decl+tw.def!==13)stats.errors++;if(tw.decl>=ct.level+6)stats.made++;
 if(samples.length<6)samples.push(auction.map(a=>a.call).join(' ')+' => '+contractText(ct)+' '+resultText(ct,tw.decl)+' NS '+(hcp(hands.N)+hcp(hands.S)));
}
console.log(JSON.stringify(stats));console.log(samples.join('\n'));
