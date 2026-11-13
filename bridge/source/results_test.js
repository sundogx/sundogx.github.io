const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const shared=new Map();
const mk=n=>{const p=new Map();return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,15));const oi=w.setInterval.bind(w);w.setInterval=(f,ms)=>oi(f,Math.min(ms,300));
 w.storage={async get(k,s){const m=s?shared:p;if(!m.has(k))throw 0;return{value:m.get(k)}},async set(k,v,s){(s?shared:p).set(k,v);return{}},async list(pr,s){return{keys:[...(s?shared:p).keys()].filter(k=>k.startsWith(pr))}}};w.onerror=m=>console.log(n,'ERR',m)}}).window};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const A=mk('A'),B=mk('B');await sleep(60);const d=A.document;
 d.getElementById('nameInput').value='Ann';d.getElementById('tableName').value='Thursday pairs';d.getElementById('pairsChk').click();d.getElementById('pairsN').value='2';d.getElementById('moveType').value='none';d.getElementById('createBtn').click();await sleep(150);
 for(let k=0;k<3;k++){await sleep(60);d.querySelector('[data-robot]').click();await sleep(120)}
 const keys=A.eval('T.event.keys');const t2=JSON.parse(shared.get(keys[1]));t2.seats={N:{kind:'robot'},E:{kind:'robot'},S:{kind:'robot'},W:{kind:'robot'}};A.eval('startBoard')(t2);t2.version++;shared.set(keys[1],JSON.stringify(t2));
 d.getElementById('eventBtn').click();await sleep(400);console.log('scoreboard:',d.getElementById('sbBox').textContent.replace(/\s+/g,' ').slice(0,220));
 d.querySelector('[data-close]').click();
 for(let i=0;i<8000&&A.eval('T.history.length')<2;i++){await sleep(5);if(!d.getElementById('bidArea').classList.contains('hidden')){d.querySelector('[data-call="P"]').click();continue}const c=d.querySelector('[data-play]');if(c){c.click();continue}const nx=d.querySelector('[data-next]');if(nx&&A.eval('T.history.length')<2)nx.click()}
 for(let i=0;i<40;i++){await sleep(300);if(JSON.parse(shared.get(keys[1])).history.length>=2)break}
 d.getElementById('eventBtn').click();await sleep(400);console.log('scoreboard after:',d.getElementById('sbBox').textContent.replace(/\s+/g,' ').slice(0,200));
 d.getElementById('shareRes').click();await sleep(300);
 const rk=[...shared.keys()].find(k=>k.startsWith('bt:r:'));console.log('saved',rk);
 B.document.getElementById('handCode').value=rk.slice(5);B.document.getElementById('openHandBtn').click();await sleep(80);
 const m=B.document.querySelector('.modal');console.log('B results:',m.querySelector('h3').textContent,'| standings rows',m.querySelectorAll('.reslist tr').length-1,'| board buttons',m.querySelectorAll('[data-trav]').length);
 m.querySelector('[data-trav]').click();await sleep(20);const m2=B.document.querySelector('.modal');console.log('traveller:',m2.querySelector('h3').textContent,'| hands',m2.querySelectorAll('.rows').length,'| table rows',m2.querySelectorAll('.reslist tr').length-1);
 B.document.getElementById('trBack').click();await sleep(10);console.log('back:',B.document.querySelector('.modal h3').textContent);
 process.exit(0)})();
