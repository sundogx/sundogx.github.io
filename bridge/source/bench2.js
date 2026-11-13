Object.assign(globalThis, require('./engine.js'));const {DDS,parScore}=require('./dds.js');
let seed=777;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
for(let k=0;k<4;k++){const h=deal(rnd);const t=Date.now();const tab=DDS.table(h);console.log(k,Date.now()-t,'ms',SEATS.map(s=>s+':'+['N','S','H','D','C'].map(x=>tab[s][x]).join('')).join(' '),'par',parScore(tab,'None').text)}
