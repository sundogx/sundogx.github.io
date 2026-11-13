const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const shared=new Map();
const mk=n=>{const p=new Map();return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,15));const oi=w.setInterval.bind(w);w.setInterval=(f,ms)=>oi(f,Math.min(ms,300));
 w.storage={async get(k,s){const m=s?shared:p;if(!m.has(k))throw 0;return{value:m.get(k)}},async set(k,v,s){(s?shared:p).set(k,v);return{}},async list(pr,s){return{keys:[...(s?shared:p).keys()].filter(k=>k.startsWith(pr))}}};w.onerror=m=>console.log(n,'ERR',m)}}).window};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 // arithmetic with a fake event
 const U=mk('U');await sleep(50);
 U.eval(`T={event:{idx:1,keys:['k1','k2','k3','k4'],codes:['A','B','C','D'],name:'x'},seats:{N:null,E:null,S:null,W:null},history:[{board:1,scoreNS:420}]};tKey='k1';
 const mkT=(sc,adj)=>({seats:{N:null,E:null,S:null,W:null},history:[{board:1,scoreNS:sc,adjust:adj}],version:1});
 eventRooms=new Map([['k2',mkT(450)],['k3',mkT(-50,{kind:'avg',ns:0.6})],['k4',mkT(-50)]]);`);
 console.log('with avg+ at T3:',JSON.stringify(U.eval('eventBoards()[0].rows.map(r=>[r.idx,r.mpNS])')),'expect T1 .5 T2 1 T3 .6 T4 0');
 // live: 3 tables, director Ann adjusts table 2 and corrects table 3
 const A=mk('A');await sleep(60);A.document.getElementById('nameInput').value='Ann';A.document.getElementById('pairsChk').click();A.document.getElementById('moveType').value='none';A.document.getElementById('createBtn').click();await sleep(150);
 for(let k=0;k<3;k++){await sleep(60);A.document.querySelector('[data-robot]').click();await sleep(120)}
 const d=A.document;
 for(let i=0;i<6000&&A.eval('T.phase')!=='done';i++){await sleep(5);if(!d.getElementById('bidArea').classList.contains('hidden')){d.querySelector('[data-call="P"]').click();continue}const c=d.querySelector('[data-play]');if(c)c.click()}
 // other tables: robots only, but they need 4 seats filled: fill them directly in storage
 const keys=A.eval('T.event.keys');for(const k of keys.slice(1)){const t=JSON.parse(shared.get(k));t.seats={N:{kind:'robot'},E:{kind:'robot'},S:{kind:'robot'},W:{kind:'robot'}};A.eval('startBoard')(t);t.version++;shared.set(k,JSON.stringify(t))}
 for(let i=0;i<40;i++){await sleep(300);if(keys.every(k=>JSON.parse(shared.get(k)).history.length>=1))break}
 console.log('histories',keys.map(k=>JSON.parse(shared.get(k)).history.length));
 await A.eval('refreshEvent(true)');await sleep(100);
 d.querySelector('[data-tab="results"]').click();d.querySelector('tr[data-record]').click();await sleep(20);
 const adjBtns=d.querySelectorAll('[data-adj]');console.log('director buttons',adjBtns.length);
 adjBtns[1].click();await sleep(10);d.querySelector('[data-av="0.6"]').click();await sleep(150);
 const t2=JSON.parse(shared.get(keys[1])).history[0];console.log('T2 adjust',JSON.stringify(t2.adjust),'chat:',JSON.parse(shared.get(keys[1])).chat.pop().text);
 d.querySelector('tr[data-record]').click();await sleep(20);const rec3=JSON.parse(shared.get(keys[2])).history[0];
 if(rec3.contract){d.querySelectorAll('[data-adj]')[2].click();await sleep(10);d.querySelector('[data-tr="13"]').click();await sleep(150);const r3=JSON.parse(shared.get(keys[2])).history[0];console.log('T3 corrected tricks',r3.declTricks,'score',r3.scoreNS,'orig',JSON.stringify(r3.orig))}
 else console.log('T3 passed out, skip tricks test');
 console.log('rows now',JSON.stringify(A.eval('eventBoards()[0].rows.map(r=>[r.idx,r.rec.scoreNS,r.mpNS])')));
 d.querySelector('tr[data-record]').click();await sleep(20);d.querySelectorAll('[data-adj]')[1].click();await sleep(10);d.getElementById('adjClear').click();await sleep(150);
 console.log('T2 after clear',JSON.stringify(JSON.parse(shared.get(keys[1])).history[0].adjust));
 process.exit(0)})();
