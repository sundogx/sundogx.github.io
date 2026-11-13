const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const shared=new Map();
const mk=n=>{const p=new Map();return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,10));
 w.storage={async get(k,s){const m=s?shared:p;if(!m.has(k))throw 0;return{value:m.get(k)}},async set(k,v,s){(s?shared:p).set(k,v);return{}},async list(pr,s){return{keys:[...(s?shared:p).keys()].filter(k=>k.startsWith(pr))}}};w.onerror=m=>console.log(n,'ERR',m)}}).window};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const A=mk('A'),B=mk('B'),d=A.document;await sleep(60);d.getElementById('practiceBtn').click();
 for(let i=0;i<4000&&A.eval('T.phase')!=='done';i++){await sleep(5);if(!d.getElementById('bidArea').classList.contains('hidden')){const lv=[...d.querySelectorAll('[data-level]')].find(b=>!b.disabled);lv.click();[...d.querySelectorAll('[data-strain]')].find(b=>!b.disabled).click();continue}const c=d.querySelector('[data-play]');if(c)c.click()}
 d.querySelector('.banner [data-record]').click();await sleep(10);d.getElementById('shareOne').click();await sleep(60);
 const key=[...shared.keys()].find(k=>k.startsWith('bt:h:'));const code=key.slice(5);console.log('saved',key);
 B.document.getElementById('handCode').value=code.toLowerCase();B.document.getElementById('openHandBtn').click();await sleep(60);
 const m=B.document.querySelector('.modal');console.log('B modal:',m&&m.querySelector('h3').textContent,'| hands',m.querySelectorAll('.rows').length,'| auction cells',m.querySelectorAll('.agrid .c').length,'| DD note:',m.querySelector('#ddBox').textContent.slice(0,50));
 B.document.getElementById('reviewBtn').click();await sleep(5);console.log('review:',B.document.querySelector('.modal h3').textContent);B.document.getElementById('rvBack').click();await sleep(5);console.log('back:',B.document.querySelector('.modal h3').textContent);
 B.document.querySelector('[data-close]').click();B.document.getElementById('handCode').value='ZZZZZ';B.document.getElementById('openHandBtn').click();await sleep(2);console.log('bad code toast:',[...B.document.querySelectorAll('.toast')].map(t=>t.textContent).pop());
 process.exit(0)})();
