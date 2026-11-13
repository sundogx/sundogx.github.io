const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const shared=new Map();
const mk=n=>{const p=new Map();return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,20));
 w.storage={async get(k,s){const m=s?shared:p;if(!m.has(k))throw 0;return{value:m.get(k)}},async set(k,v,s){(s?shared:p).set(k,v);return{}},async list(pr,s){return{keys:[...(s?shared:p).keys()].filter(k=>k.startsWith(pr))}}};w.onerror=m=>console.log(n,'ERR',m)}}).window};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const a=mk('A'),b=mk('B');await sleep(80);
 a.document.getElementById('nameInput').value='Ann';a.document.getElementById('createBtn').click();await sleep(80);
 const code=a.eval('T.id');console.log('settings visible to host',!a.document.getElementById('settingsBtn').classList.contains('hidden'));
 // lock
 a.document.getElementById('settingsBtn').click();await sleep(10);const lk=a.document.getElementById('setLock');lk.checked=true;lk.dispatchEvent(new a.Event('change'));await sleep(80);
 a.document.querySelector('[data-close]').click();
 b.document.getElementById('nameInput').value='Bob';b.document.getElementById('codeInput').value=code;b.document.getElementById('joinCodeBtn').click();await sleep(80);
 b.document.querySelector('[data-sit="N"]').click();await sleep(80);
 console.log('locked: B seated?',!!b.eval('mySeat()'),'B sees settings',!b.document.getElementById('settingsBtn').classList.contains('hidden'));
 // unlock, B sits, host kicks
 a.document.getElementById('settingsBtn').click();await sleep(10);const lk2=a.document.getElementById('setLock');lk2.checked=false;lk2.dispatchEvent(new a.Event('change'));await sleep(80);a.document.querySelector('[data-close]').click();
 await sleep(1700);b.document.querySelector('[data-sit="N"]').click();await sleep(100);console.log('unlocked: B seat',b.eval('mySeat()'));
 await sleep(1700);a.document.getElementById('settingsBtn').click();await sleep(10);a.document.querySelector('[data-kick="N"]').click();await sleep(100);
 await sleep(1700);console.log('after kick B seat',b.eval('mySeat()'));
 // host leaves -> B (re-seated) becomes host
 b.document.querySelector('[data-sit="E"]').click();await sleep(100);await sleep(1700);
 a.document.getElementById('leaveBtn').click();await sleep(200);await sleep(1700);
 console.log('new host is B',b.eval('isHost()'),b.eval('T.chat.slice(-2).map(m=>m.text).join(" | ")'));
 process.exit(0)})();
