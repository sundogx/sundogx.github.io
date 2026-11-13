const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');
const w=new JSDOM(html,{runScripts:'dangerously'}).window;
setTimeout(()=>{
 w.eval(`T={event:{idx:1,keys:['k1','k2','k3','k4'],codes:['A','B','C','D'],name:'x'},seats:{N:null,E:null,S:null,W:null},history:[{board:1,scoreNS:420}]};tKey='k1';
 const mkT=sc=>({seats:{N:null,E:null,S:null,W:null},history:[{board:1,scoreNS:sc}],version:1});
 eventRooms=new Map([['k2',mkT(450)],['k3',mkT(420)],['k4',mkT(-50)]]);`);
 console.log(JSON.stringify(w.eval('eventBoards()[0].rows.map(r=>[r.idx,r.rec.scoreNS,r.mpNS])')));
 console.log('expected: 420 -> (0+1+2)/6=0.5, 450 -> 6/6=1, 420 -> 0.5, -50 -> 0');process.exit(0)},50);
