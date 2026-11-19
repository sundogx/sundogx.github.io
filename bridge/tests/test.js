const E=require('../js/engine.js');const a=(x,y,m)=>{if(x!==y){console.log('FAIL',m,x,'!=',y);process.exitCode=1}};
const C=(level,strain,doubled,declarer='S')=>({level,strain,doubled,declarer});
a(E.scoreContract(C(4,'S',0),10,'None'),420,'4S=');a(E.scoreContract(C(4,'S',0),10,'NS'),620,'4S= v');
a(E.scoreContract(C(3,'N',0),9,'None'),400,'3NT=');a(E.scoreContract(C(3,'N',0),10,'None'),430,'3NT+1');
a(E.scoreContract(C(2,'S',1),8,'None'),470,'2SX=');a(E.scoreContract(C(1,'N',1),7,'NS'),180,'1NTX= v');
a(E.scoreContract(C(1,'C',2),7,'None'),230,'1CXX=');a(E.scoreContract(C(6,'H',0),12,'NS'),1430,'6H= v');
a(E.scoreContract(C(7,'N',0),13,'None'),1520,'7NT=');a(E.scoreContract(C(2,'D',0),8,'None'),90,'2D=');
a(E.scoreContract(C(4,'S',1),6,'None'),-800,'4SX-4 nv');a(E.scoreContract(C(4,'S',1),7,'NS'),-800,'4SX-3 v');
a(E.scoreContract(C(4,'S',2),9,'None'),-200,'4SXX-1');a(E.scoreContract(C(4,'S',0),8,'NS'),-200,'4S-2 v');
a(E.scoreContract(C(2,'H',1),9,'NS'),870,'2HX+1 v');a(E.scoreContract(C(3,'D',1),9,'None'),470,'3DX= nv');
// scoring vs the official duplicate table
{const S=(l,s,d,t,v)=>E.scoreContract(C(l,s,d),t,v);
// doubled / redoubled undertricks, nv and vul (1..5 down)
[[100,300,500,800,1100],[200,500,800,1100,1400]].forEach((row,vi)=>row.forEach((p,i)=>{
 a(S(7,'S',1,12-i,vi?'NS':'None'),-p,`7SX-${i+1} ${vi?'v':'nv'}`);a(S(7,'S',2,12-i,vi?'NS':'None'),-2*p,`7SXX-${i+1} ${vi?'v':'nv'}`);}));
a(S(3,'N',0,6,'None'),-150,'3NT-3 nv');a(S(3,'N',0,6,'EW'),-150,'3NT-3 (opps vul)');a(S(3,'N',0,6,'Both'),-300,'3NT-3 v');
// doubled / redoubled overtricks
a(S(1,'S',1,9,'None'),360,'1SX+2 nv');a(S(1,'S',1,9,'NS'),560,'1SX+2 v');
a(S(1,'S',2,8,'None'),720,'1SXX+1 nv');a(S(1,'S',2,8,'NS'),1120,'1SXX+1 v');
a(S(3,'C',0,11,'None'),150,'3C+2');a(S(4,'H',0,13,'NS'),710,'4H+3 v');
// insult: X +50, XX +100 (making partscores)
a(S(1,'C',1,7,'None'),140,'1CX=');a(S(1,'D',2,7,'NS'),230,'1DXX= v');
// game bonus incl. doubled into game and 1NTXX
a(S(1,'N',2,7,'None'),560,'1NTXX= nv');a(S(1,'N',2,7,'NS'),760,'1NTXX= v');
a(S(2,'C',1,8,'None'),180,'2CX= partscore');a(S(3,'C',1,9,'NS'),670,'3CX= v game');
a(S(5,'D',0,11,'None'),400,'5D=');a(S(3,'N',0,9,'NS'),600,'3NT= v');a(S(2,'N',0,8,'None'),120,'2NT=');
a(S(4,'S',2,10,'None'),880,'4SXX= nv');
// slams
a(S(6,'N',0,12,'None'),990,'6NT= nv');a(S(6,'N',0,12,'NS'),1440,'6NT= v');
a(S(7,'C',0,13,'None'),1440,'7C= nv');a(S(7,'S',0,13,'NS'),2210,'7S= v');a(S(7,'N',2,13,'NS'),2980,'7NTXX= v');
a(S(6,'S',1,13,'None'),1310,'6SX+1 nv');}
// IMPs at the table boundaries
[[0,0],[10,0],[20,1],[40,1],[50,2],[80,2],[90,3],[120,3],[130,4],[160,4],[170,5],[210,5],[220,6],[260,6],[270,7],[310,7],[320,8],[360,8],[370,9],[420,9],[430,10],[490,10],[500,11],[590,11],[600,12],[740,12],[750,13],[890,13],[900,14],[1090,14],[1100,15],[1290,15],[1300,16],[1490,16],[1500,17],[1740,17],[1750,18],[1990,18],[2000,19],[2240,19],[2250,20],[2490,20],[2500,21],[2990,21],[3000,22],[3490,22],[3500,23],[3990,23],[4000,24],[7600,24]]
 .forEach(([d,i])=>{a(E.toImps(d),i,'imps '+d);a(E.toImps(-d),-i||0,'imps -'+d);});
// X/XX legality
{const A=(...cs)=>cs.map((c,i)=>({call:c,by:E.SEATS[i%4]}));
a(E.legalCalls('N',[]).includes('X'),false,'no X opening');
a(E.legalCalls('N',A('1S')).includes('X'),true,'E may X');a(E.legalCalls('N',A('1S','P')).includes('X'),false,'S cant X partner');
a(E.legalCalls('N',A('1S','P','P')).includes('X'),true,'W balancing X');
a(E.legalCalls('N',A('1S','X')).includes('XX'),true,'S may XX');a(E.legalCalls('N',A('1S','X')).includes('X'),false,'S cant X a X');
a(E.legalCalls('N',A('1S','X','P')).includes('XX'),false,'W cant XX own X');a(E.legalCalls('N',A('1S','X','P','P')).includes('XX'),true,'N may XX');
a(E.legalCalls('N',A('1S','X','XX')).some(c=>c==='X'||c==='XX'),false,'no X/XX after XX');
a(E.legalCalls('N',A('1S','P','P','X')).includes('XX'),true,'N XX balancing X');
a(E.legalCalls('N',A('1S','2H')).includes('1N'),false,'insufficient');a(E.legalCalls('N',A('7N')).length,2,'after 7NT: P,X');
// auction end
a(E.auctionOver(A('P','P','P')),false,'3 passes no bid');a(E.auctionOver(A('1C','P','P','P')),true,'bid+3P');
a(E.auctionOver(A('P','1C','P','P')),false,'only 2P after bid');a(E.auctionOver(A('1C','X','P','P','P')),true,'X+3P');
a(E.auctionOver(A('1C','P','P','X')),false,'reopened');a(E.finalContract(A('1C','X','XX','P','P','P')).doubled,2,'XX final');
a(E.finalContract(A('1C','X','P','P','1H','P','P','P')).doubled,0,'X cleared by bid');}
// auction
let auc=[{call:'1S',by:'N'},{call:'X',by:'E'},{call:'P',by:'S'}];
a(E.legalCalls('N',auc).includes('XX'),false,'S cant XX? actually W turn');
a(E.auctionTurn('N',auc),'W','turn');
auc.push({call:'2H',by:'W'},{call:'P',by:'N'},{call:'P',by:'E'},{call:'P',by:'S'});
a(E.auctionOver(auc),true,'over');const fc=E.finalContract(auc);a(fc.declarer,'W','decl');a(fc.level,2,'lvl');
let po=[{call:'P'},{call:'P'},{call:'P'},{call:'P'}];a(E.auctionOver(po),true,'passout');a(E.finalContract(po),null,'po');
a(E.auctionOver([{call:'1C',by:'N'},{call:'P'},{call:'P'}]),false,'not over');
let d=[{call:'1H',by:'N'},{call:'P',by:'E'},{call:'2H',by:'S'},{call:'X',by:'W'}];
a(E.legalCalls('N',d).includes('XX'),true,'N can XX');
let fc2=E.finalContract([{call:'1H',by:'N'},{call:'P',by:'E'},{call:'4H',by:'S'},{call:'X',by:'W'},{call:'P',by:'N'},{call:'P',by:'E'},{call:'P',by:'S'}]);
a(fc2.declarer,'N','first to bid');a(fc2.doubled,1,'dbl');
const h=E.deal();a(Object.values(h).flat().length,52,'deal');a(new Set(Object.values(h).flat()).size,52,'uniq');
a(E.trickWinner({cards:[{seat:'N',card:'SA'},{seat:'E',card:'H2'},{seat:'S',card:'SK'},{seat:'W',card:'D3'}]},'H'),'E','ruff');
a(E.trickWinner({cards:[{seat:'N',card:'S2'},{seat:'E',card:'H2'},{seat:'S',card:'SK'},{seat:'W',card:'SA'}]},'N'),'W','nt');
// opening-lead cards (js/leads.js)
Object.assign(globalThis,E);const L=require('../js/leads.js');
for(const [hold,nt,suit] of [['KQJ4','K','K'],['KQ74','4','K'],['KJT9','J','J'],['AJT4','J','A'],['A742','2','A'],['Q974','4','4'],['974','7','7'],['K7','K','K'],['AK74','A','A']]){
 const cs=[...hold].map(r=>'S'+r);a(L.leadCardOf(cs,'N')[1],nt,'lead vs NT from '+hold);a(L.leadCardOf(cs,'H')[1],suit,'lead vs suit from '+hold);}
console.log('done');
