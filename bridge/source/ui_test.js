const {JSDOM}=require('jsdom');const fs=require('fs');const html=fs.readFileSync('bridge.html','utf8');
const shared=new Map();
function makeClient(name){
 const personal=new Map();
 const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  const ost=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>ost(f,Math.min(ms||0,20));
  w.storage={async get(k,s){const m=s?shared:personal;if(!m.has(k))throw new Error('nf');return {key:k,value:m.get(k),shared:s}},
   async set(k,v,s){(s?shared:personal).set(k,v);return {key:k,value:v,shared:s}},
   async list(p,s){return {keys:[...(s?shared:personal).keys()].filter(k=>k.startsWith(p||''))}},async delete(){}};
  w.onerror=(m)=>console.log(name,'ERR',m);
 }});
 dom.window.console.error=(...a)=>console.log(name,'console.error',...a);
 return dom.window;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const w=makeClient('A');await sleep(100);const d=w.document;
 d.getElementById('nameInput').value='Alec';d.getElementById('practiceBtn').click();await sleep(50);
 let boards=0,steps=0;
 while(boards<4&&steps<3000){steps++;await sleep(15);
  const bb=d.getElementById('bidArea');
  if(!bb.classList.contains('hidden')){const lv=[...d.querySelectorAll('[data-level]')].find(b=>!b.disabled);
    if(Math.random()<0.3&&lv){lv.click();await sleep(5);const st=[...d.querySelectorAll('[data-strain]')].find(b=>!b.disabled);if(st)st.click();}
    else d.querySelector('[data-call="P"]').click();continue}
  const c=d.querySelector('[data-play]');if(c){c.click();continue}
  const nx=d.querySelector('[data-next]');if(nx){boards++;
    if(boards===2){d.querySelector('[data-record]').click();await sleep(5);if(!d.querySelector('.modal .diagram'))console.log('no record');d.querySelector('[data-close]').click();}
    nx.click();}
 }
 const res=d.getElementById('pane-results').textContent;console.log('practice boards',boards,'steps',steps,'|',res.slice(0,160));
 // claim + undo test on a new board
 // ---- multiplayer: client A opens table, B joins
 const a=makeClient('A2'),b=makeClient('B');await sleep(100);
 a.document.getElementById('nameInput').value='Ann';a.document.getElementById('tableName').value='Test four';a.document.getElementById('createBtn').click();await sleep(100);
 b.document.getElementById('nameInput').value='Bob';b.document.getElementById('refreshBtn').click();await sleep(100);
 const go=b.document.querySelector('[data-open]');console.log('lobby shows table',!!go);go.click();await sleep(100);
 b.document.querySelector('[data-sit="N"]').click();await sleep(200);
 // A adds robots E,W
 await sleep(1700);a.document.querySelector('[data-robot]').click();await sleep(300);a.document.querySelector('[data-robot]').click();await sleep(1800);
 let mb=0,ms=0;
 while(mb<2&&ms<4000){ms++;await sleep(20);
  for(const cw of [a,b]){const cd=cw.document;
   if(!cd.getElementById('bidArea').classList.contains('hidden')){cd.querySelector('[data-call="P"]')?.click();
     if(Math.random()<.5){const lv=[...cd.querySelectorAll('[data-level]')].find(x=>!x.disabled);if(lv){lv.click();const st=[...cd.querySelectorAll('[data-strain]')].find(x=>!x.disabled);st&&st.click()}}continue}
   const c=cd.querySelector('[data-play]');if(c){c.click();continue}
   const nx=cd.querySelector('[data-next]');if(nx&&cw===a){mb++;nx.click();await sleep(200)}
  }}
 const st=JSON.parse(shared.get([...shared.keys()].find(k=>k.startsWith('bt:t:'))));
 console.log('multi boards',mb,'history',st.history.length,'version',st.version,'chat',st.chat.length, st.history.map(h=>h.scoreNS));
 // consistency check: B sees same version
 await sleep(1700);console.log('B synced board', b.document.querySelector('.corner.tl')?.textContent);
 process.exit(0);
})();
