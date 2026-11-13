Object.assign(globalThis, require('./engine.js'));const {DDS}=require(process.argv[2]||'./dds.js');
let seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
const out=[];for(let k=0;k<+(process.argv[3]||2);k++){const h=deal(rnd);
 for(const st of [4,0]){const sv=DDS.solver(DDS.toMasks(h),st);const t=Date.now();const r=sv.maxNS(1,13,7);out.push(`deal${k} st${st} ns=${r} nodes=${sv.nodes} ${Date.now()-t}ms`)}}
console.log(out.join('\n'));
