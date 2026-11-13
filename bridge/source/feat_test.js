const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const shared=new Map();
const mk=n=>{const p=new Map();return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,20));
 w.storage={async get(k,s){const m=s?shared:p;if(!m.has(k))throw 0;return{value:m.get(k)}},async set(k,v,s){(s?shared:p).set(k,v);return{}},async list(pr,s){return{keys:[...(s?shared:p).keys()].filter(k=>k.startsWith(pr))}}};w.onerror=m=>console.log(n,'ERR',m)}}).window};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const toasts=w=>[...w.document.querySelectorAll('.toast')].map(x=>x.textContent);
(async()=>{
 const w=mk('P'),d=w.document;await sleep(60);d.getElementById('practiceBtn').click();
 for(let i=0;i<300&&d.getElementById('bidArea').classList.contains('hidden');i++)await sleep(10);
 console.log('hint visible',!d.getElementById('hintBtn').classList.contains('hidden'),'enabled',!d.getElementById('hintBtn').disabled);
 d.getElementById('hintBtn').click();await sleep(10);console.log('bid hint:',toasts(w).pop());
 // play until my card turn, ask hint, check highlight
 let got=false;
 for(let i=0;i<2000&&!got;i++){await sleep(10);
  if(!d.getElementById('bidArea').classList.contains('hidden')){d.querySelector('[data-call="P"]').click();continue}
  if(d.querySelector('[data-play]')){d.getElementById('hintBtn').click();await sleep(10);const h=d.querySelector('.hint');console.log('play hint:',toasts(w).pop(),'| highlighted',!!h,'and legal',!!(h&&h.dataset.play));got=true}
  const nx=d.querySelector('[data-next]');if(nx)nx.click()}
 // claim with line
 for(let i=0;i<300&&d.getElementById('claimBtn').disabled;i++){await sleep(10);const c=d.querySelector('[data-play]');if(c)c.click()}
 if(!d.getElementById('claimBtn').disabled){d.getElementById('claimBtn').click();await sleep(5);d.querySelector('[data-n="0"]').click();d.getElementById('claimLine').value='Conceding the rest';d.getElementById('doClaim').click();await sleep(80);
  console.log('claim chat:',w.eval('T.chat.filter(m=>m.sys).map(m=>m.text).filter(t=>/claims/.test(t)).pop()'),'phase',w.eval('T.phase'));}
 // replay
 for(let i=0;i<2000&&w.eval('T.phase')!=='done';i++){await sleep(10);if(!d.getElementById('bidArea').classList.contains('hidden'))d.querySelector('[data-call="P"]').click();const c=d.querySelector('[data-play]');if(c)c.click()}
 const hb=w.eval('T.history.length'),hands=w.eval('JSON.stringify(T.hands)'),bd=w.eval('T.board');
 d.querySelector('[data-replay]').click();await sleep(60);
 console.log('replay: history',hb,'->',w.eval('T.history.length'),'same hands',w.eval('JSON.stringify(T.hands)')===hands,'board',bd,'->',w.eval('T.board'),'phase',w.eval('T.phase'));
 // convention cards
 d.getElementById('ccBtn').click();await sleep(5);console.log('practice cc editable',!!d.getElementById('ccText'),'robot card shown for EW',/Robot system/.test(d.querySelector('.modal').textContent));d.querySelector('[data-close]').click();
 const a=mk('A'),b=mk('B');await sleep(60);a.document.getElementById('nameInput').value='Ann';a.document.getElementById('createBtn').click();await sleep(80);
 const code=a.eval('T.id');b.document.getElementById('nameInput').value='Bob';b.document.getElementById('codeInput').value=code;b.document.getElementById('joinCodeBtn').click();await sleep(80);
 b.document.querySelector('[data-sit="E"]').click();await sleep(100);
 a.document.getElementById('ccBtn').click();await sleep(5);a.document.getElementById('ccText').value='Strong club, 10-12 NT';a.document.getElementById('ccSave').click();await sleep(100);
 await sleep(1700);b.document.getElementById('ccBtn').click();await sleep(5);const txt=b.document.querySelector('.modal').textContent;
 console.log('B sees NS card',/Strong club/.test(txt),'B can edit EW',!!b.document.getElementById('ccText'));
 process.exit(0)})();
