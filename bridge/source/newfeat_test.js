const {JSDOM}=require('jsdom');const {Worker:NW}=require('worker_threads');const html=require('fs').readFileSync('bridge.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const shim="const {parentPort}=require('worker_threads');const self={postMessage:m=>parentPort.postMessage(m)};parentPort.on('message',d=>self.onmessage({data:d}));\n";
const mk=(withWorker)=>new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,10));w.onerror=m=>console.log('ERR',m);
 if(withWorker){const blobs=new Map();let id=0;w.Blob=class{constructor(p){this.src=p.join('')}};w.URL.createObjectURL=b=>{const u='blob:'+(++id);blobs.set(u,b.src);return u};
  w.Worker=class{constructor(u){this.nw=new NW(shim+blobs.get(u),{eval:true});this.nw.unref();this.nw.on('message',m=>this.onmessage&&this.onmessage({data:m}));this.nw.on('error',e=>{console.log('worker err',e.message);this.onerror&&this.onerror(e)})}postMessage(d){this.nw.postMessage(d)}}}}}).window;
(async()=>{
 // 1) deal types
 const w0=mk(false);await sleep(50);
 for(const ty of ['nt','strong','slam','defend']){const ok=w0.eval(`(()=>{let n=0;for(let i=0;i<20;i++){const h=dealOfType('${ty}');if(DEAL_TYPES['${ty}'](h))n++}return n})()`);console.log('deal type',ty,ok+'/20 match')}
 // 2) bidding-only with real DD workers
 const w=mk(true),d=w.document;await sleep(50);
 d.getElementById('dealType').value='game';d.getElementById('bidOnlyChk').checked=true;d.getElementById('practiceBtn').click();await sleep(20);
 console.log('S+N hcp',w.eval('hcp(T.hands.N)+hcp(T.hands.S)'),'name',w.eval('T.name'));
 // bid via keyboard: 3 then N, else pass
 for(let i=0;i<400&&w.eval('T.phase')==='auction';i++){await sleep(10);if(!d.getElementById('bidArea').classList.contains('hidden')){
   const legal=w.eval('legalCalls(T.dealer,T.auction)');const key=(k)=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true}));
   if(legal.includes('3N')&&!w.eval('T.auction.some(a=>a.by==="S"&&a.call!=="P")')){key('3');key('n')}else key('p');}}
 console.log('auction',w.eval('T.auction.map(a=>a.by+":"+a.call).join(" ")'),'phase',w.eval('T.phase'));
 const t0=Date.now();for(let i=0;i<1200&&w.eval('T.phase')!=='done';i++)await sleep(50);
 console.log('phase',w.eval('T.phase'),'after',Date.now()-t0,'ms; rec',w.eval('JSON.stringify({c:T.history[0].contract&&contractText(T.history[0].contract),t:T.history[0].declTricks,dd:T.history[0].ddScored,sc:T.history[0].scoreNS})'));
 if(w.eval('T.history[0].contract'))console.log('DD check: table says',w.eval('ddEntry(T.hands).table[T.history[0].contract.declarer][T.history[0].contract.strain]'));
 for(let i=0;i<600;i++){await sleep(50);if(!/…/.test(d.getElementById('pane-results').textContent))break}
 console.log('results:',d.getElementById('pane-results').textContent.replace(/\s+/g,' ').slice(0,200));
 // 3) keyboard card play in a normal practice
 const w2=mk(false),d2=w2.document;await sleep(50);d2.getElementById('practiceBtn').click();
 let played=0;for(let i=0;i<3000&&played<5;i++){await sleep(5);if(!d2.getElementById('bidArea').classList.contains('hidden')){d2.dispatchEvent(new w2.KeyboardEvent('keydown',{key:'p',bubbles:true}));continue}
  if(w2.eval('T.phase')==='done'){d2.querySelector('[data-next]').click();continue}
  if(w2.eval('isMyTurn(T)')){const seat=w2.eval('turnSeat(T)');const c=w2.eval(`legalPlays(T.hands,T.play,T.contract,'${seat}')[0]`);const before=w2.eval('playedCards(T.play).size');
   for(const k of [c[1]==='T'?'1':c[1].toLowerCase(),c[0].toLowerCase()])d2.dispatchEvent(new w2.KeyboardEvent('keydown',{key:k,bubbles:true}));await sleep(15);
   if(w2.eval('playedCards(T.play).has("'+c+'")'))played++;else{console.log('key play failed',c,seat);break}}}
 console.log('cards played by keyboard',played);
 process.exit(0)})();
