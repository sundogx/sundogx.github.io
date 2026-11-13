const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const shared=new Map();
const mk=n=>{const p=new Map();return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,15));
 const oi=w.setInterval.bind(w);w.setInterval=(f,ms)=>oi(f,Math.min(ms,300));
 w.storage={async get(k,s){const m=s?shared:p;if(!m.has(k))throw 0;return{value:m.get(k)}},async set(k,v,s){(s?shared:p).set(k,v);return{}},async list(pr,s){return{keys:[...(s?shared:p).keys()].filter(k=>k.startsWith(pr))}}};w.onerror=m=>console.log(n,'ERR',m)}}).window};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const A=mk('A'),B=mk('B'),C=mk('C');await sleep(80);
 A.document.getElementById('nameInput').value='Ann';A.document.getElementById('pairsChk').click();A.document.getElementById('roundLen').value='2';A.document.getElementById('moveType').value=process.argv[2]||'mitchell';A.document.getElementById('createBtn').click();await sleep(150);
 const codes=A.eval('T.event.codes');
 for(const [w,i,nm,seat] of [[B,1,'Bob','E'],[C,2,'Cy','S']]){w.document.getElementById('nameInput').value=nm;w.document.getElementById('codeInput').value=codes[i];w.document.getElementById('joinCodeBtn').click();await sleep(120);w.document.querySelector(`[data-sit="${seat}"]`).click();await sleep(150)}
 for(const w of [A,B,C]){for(let k=0;k<3;k++){await sleep(60);const r=w.document.querySelector('[data-robot]');if(r)r.click();await sleep(120)}}
 const info=w=>`T${w.eval('T.event.idx')} seat ${w.eval('mySeat()')} board ${w.eval('T.board')} round ${w.eval('T.event.round')}`;
 console.log('start:',[A,B,C].map(info).join(' | '));
 const target=4;let movedSeen=false;
 for(let step=0;step<20000;step++){await sleep(5);
  if([A,B,C].every(w=>w.eval('T.history.length')>=target-0 || (w.eval('T.board')>=target&&w.eval('T.phase')==='done')))break;
  for(const w of [A,B,C]){const d=w.document;
   if(!d.getElementById('bidArea').classList.contains('hidden')){d.querySelector('[data-call="P"]').click();continue}
   const c=d.querySelector('[data-play]');if(c){c.click();continue}
   const nx=d.querySelector('[data-next]');if(nx&&w.eval('T.board')<target)nx.click()}
  if(!movedSeen&&B.eval('T.event.round')===1&&B.eval('mySeat()')){movedSeen=true;console.log('after round 1:',[A,B,C].map(info).join(' | '))}}
 console.log('end:',[A,B,C].map(info).join(' | '));await sleep(1500);console.log('histories per table:',A.eval('T.event.keys').map(k=>JSON.parse(shared.get(k)).history.length));
 await sleep(400);A.eval('refreshEvent(true)');await sleep(300);
 console.log('board 3 rows pairs:',JSON.stringify(A.eval('eventBoards().find(b=>b.board===3).rows.map(r=>[r.idx,r.rec.pNS,r.rec.pEW,r.rec.players.E])')));
 console.log('standings:',A.eval('eventStandings().map(x=>x.label+" "+x.name+" "+(x.pct===null?"-":x.pct.toFixed(0))+"% ("+x.boards+")").join(" | ")'));
 console.log('chat T3:',C.eval('T.chat.filter(m=>m.sys&&/Round/.test(m.text)).map(m=>m.text).join(" / ")'));
 process.exit(0)})();
