const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const shared=new Map();
const mk=n=>{const p=new Map();return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,20));
 w.storage={async get(k,s){const m=s?shared:p;if(!m.has(k))throw 0;return{value:m.get(k)}},async set(k,v,s){(s?shared:p).set(k,v);return{}},async list(pr,s){return{keys:[...(s?shared:p).keys()].filter(k=>k.startsWith(pr))}}};w.onerror=m=>console.log(n,'ERR',m)}}).window};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function drive(ws,until,max=6000){for(let i=0;i<max;i++){if(until())return true;await sleep(15);for(const w of ws){const d=w.document;
 if(!d.getElementById('bidArea').classList.contains('hidden')){d.querySelector('[data-call="P"]').click();continue}
 const c=d.querySelector('[data-play]');if(c)c.click();}}return false}
(async()=>{
 // practice
 const p=mk('P');await sleep(60);p.document.getElementById('practiceBtn').click();
 await drive([p],()=>p.eval('T.history.length')>=2);
 console.log('practice results:',p.document.getElementById('pane-results').textContent.replace(/\s+/g,' ').slice(0,200));
 console.log('clock text:',p.document.querySelector('.bclk')?.textContent);
 // match
 const a=mk('A'),b=mk('B');await sleep(60);
 a.document.getElementById('nameInput').value='Ann';a.document.getElementById('matchChk').checked=true;a.document.getElementById('createBtn').click();await sleep(100);
 const closed=a.eval('T.match.otherCode');console.log('room btn:',a.document.getElementById('roomBtn').textContent);
 for(const s of ['N','E','W']){a.document.querySelector(`[data-robot="${s}"]`).click();await sleep(60)}
 b.document.getElementById('nameInput').value='Bob';b.document.getElementById('codeInput').value=closed;b.document.getElementById('joinCodeBtn').click();await sleep(100);
 b.document.querySelector('[data-sit="E"]').click();await sleep(100);
 for(const s of ['N','S','W']){b.document.querySelector(`[data-robot="${s}"]`)?.click();await sleep(60)}
 const ok=await drive([a,b],()=>a.eval('T.history.length')>=1&&b.eval('T.history.length')>=1);
 await sleep(5200);a.eval('refreshOtherRoom(true)');await sleep(200);
 const ha=a.eval('T.history[0].hands'),hb=b.eval('T.history[0].hands');
 console.log('both done',ok,'same deal',JSON.stringify(ha)===JSON.stringify(hb));
 console.log('match results:',a.document.getElementById('pane-results').textContent.replace(/\s+/g,' ').slice(0,220));
 a.document.querySelector('[data-record="0"]').click();await sleep(30);console.log('record other line:',a.document.querySelector('.modal')?.textContent.match(/Closed room:[^.]*\.[^.]*\./)?.[0]);
 process.exit(0)})();
