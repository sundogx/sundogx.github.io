const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const shared=new Map();
const mk=n=>{const p=new Map();return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,15));
 w.storage={async get(k,s){const m=s?shared:p;if(!m.has(k))throw 0;return{value:m.get(k)}},async set(k,v,s){(s?shared:p).set(k,v);return{}},async list(pr,s){return{keys:[...(s?shared:p).keys()].filter(k=>k.startsWith(pr))}}};w.onerror=m=>console.log(n,'ERR',m)}}).window};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const A=mk('A'),B=mk('B'),C=mk('C');await sleep(80);
 A.document.getElementById('nameInput').value='Ann';A.document.getElementById('tableName').value='Club night';A.document.getElementById('pairsChk').click();A.document.getElementById('createBtn').click();await sleep(150);
 const codes=A.eval('T.event.codes');console.log('codes',codes,'event btn',!A.document.getElementById('eventBtn').classList.contains('hidden'));
 B.document.getElementById('nameInput').value='Bob';B.document.getElementById('refreshBtn').click();await sleep(100);
 console.log('lobby rows:',[...B.document.querySelectorAll('.trow .tmeta')].map(x=>x.textContent).join(' | '));
 for(const [w,i,nm] of [[B,1,'Bob'],[C,2,'Cy']]){w.document.getElementById('nameInput').value=nm;w.document.getElementById('codeInput').value=codes[i];w.document.getElementById('joinCodeBtn').click();await sleep(100);w.document.querySelector('[data-sit="S"]').click();await sleep(150)}
 for(const w of [A,B,C]){for(let k=0;k<3;k++){await sleep(60);const r=w.document.querySelector('[data-robot]');if(r)r.click();await sleep(120)}}
 console.log('same deal on all tables',new Set([A,B,C].map(w=>w.eval('JSON.stringify(T.hands)'))).size===1);
 const done=w=>w.eval('T.history.length');
 for(let step=0;step<6000&&[A,B,C].some(w=>done(w)<2);step++){await sleep(5);
  for(const w of [A,B,C]){const d=w.document;if(done(w)>=2)continue;
   if(!d.getElementById('bidArea').classList.contains('hidden')){d.querySelector('[data-call="P"]').click();continue}
   const c=d.querySelector('[data-play]');if(c){c.click();continue}
   const nx=d.querySelector('[data-next]');if(nx&&w.eval('T.phase')==='done'&&done(w)<2)nx.click()}}
 console.log('boards done',[A,B,C].map(done));
 await sleep(5200);A.eval('refreshEvent(true)');await sleep(300);
 const rows=A.eval('eventBoards()');rows.forEach(b=>console.log('board',b.board,b.rows.map(r=>`T${r.idx}:${r.rec.scoreNS}/${r.mpNS===null?'-':Math.round(r.mpNS*100)}`).join(' ')));
 const sum=rows.map(b=>b.rows.reduce((t,r)=>t+r.mpNS,0));console.log('NS mp sums per board (should be m/2 = 1.5):',sum);
 console.log('standings:',A.eval('eventStandings().map(x=>x.name+" T"+x.idx+x.side+" "+(x.pct===null?"-":x.pct.toFixed(1))).join(" | ")'));
 A.document.querySelector('[data-tab="results"]').click();await sleep(20);console.log('results pane:',A.document.getElementById('pane-results').textContent.slice(0,200));
 A.document.querySelector('tr[data-record]').click();await sleep(20);console.log('record has all tables:',/All tables/.test(A.document.querySelector('.modal').textContent));
 A.document.querySelector('[data-close]').click();A.document.getElementById('eventBtn').click();await sleep(10);console.log('event modal goto buttons',A.document.querySelectorAll('[data-goto]').length);
 process.exit(0)})();
