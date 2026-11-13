const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,20));w.onerror=m=>console.log('ERR',m)}});
 const w=dom.window,d=w.document;await sleep(50);d.getElementById('practiceBtn').click();
 // wait my bid turn
 for(let i=0;i<200&&d.getElementById('bidArea').classList.contains('hidden');i++)await sleep(10);
 const T=()=>w.eval('T');
 const before=T().auction.length;
 d.getElementById('alertChk').click();d.getElementById('alertText').value='Test alert';
 const lv=[...d.querySelectorAll('[data-level]')].find(b=>!b.disabled);lv.click();[...d.querySelectorAll('[data-strain]')].find(b=>!b.disabled).click();
 await sleep(150);
 console.log('my call alert stored:',T().auction.find(a=>a.by==='S').alert);
 console.log('undo enabled',!d.getElementById('undoBtn').disabled);
 d.getElementById('undoBtn').click();await sleep(30);
 console.log('auction back to',T().auction.length,'was',before,'bidbox shown',!d.getElementById('bidArea').classList.contains('hidden'));
 // finish auction by passing
 for(let i=0;i<400&&T().phase==='auction';i++){await sleep(10);const p=d.querySelector('[data-call="P"]');if(!d.getElementById('bidArea').classList.contains('hidden'))p.click()}
 console.log('phase',T().phase, T().contract&&w.eval('contractText(T.contract)'));
 if(T().phase==='play'){
  for(let i=0;i<300&&w.eval('completedTricks(T.play).length')<3;i++){await sleep(10);const c=d.querySelector('[data-play]');if(c)c.click()}
  await sleep(50);const cb=d.getElementById('claimBtn');console.log('claim enabled',!cb.disabled,'by',w.eval('mySeat()'),'dummy',w.eval('dummySeat(T)'));
  if(!cb.disabled){cb.click();await sleep(10);d.querySelector('[data-n="0"]').click();d.getElementById('doClaim').click();await sleep(80);console.log('after concede phase',T().phase, T().history.at(-1)?.declTricks)}
 }
 const lt=d.getElementById('lastTrickBtn');console.log('last trick btn',!lt.disabled);
 process.exit(0)})();
