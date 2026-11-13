const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){const o=w.setTimeout.bind(w);w.setTimeout=(f,ms)=>o(f,Math.min(ms||0,10));w.onerror=m=>console.log('ERR',m)}}).window,d=w.document;
 await sleep(50);d.getElementById('practiceBtn').click();
 for(let i=0;i<4000&&w.eval('T.phase')!=='done';i++){await sleep(5);if(!d.getElementById('bidArea').classList.contains('hidden')){const lv=[...d.querySelectorAll('[data-level]')].find(b=>!b.disabled);lv.click();[...d.querySelectorAll('[data-strain]')].find(b=>!b.disabled).click();continue}const c=d.querySelector('[data-play]');if(c)c.click()}
 d.querySelector('.banner [data-record]').click();await sleep(10);d.getElementById('reviewBtn').click();await sleep(10);
 const title=()=>d.querySelector('.modal h3').textContent,cards=()=>[...d.querySelectorAll('.modal .rows .rk')].length;
 console.log(title(),'cards shown',cards());d.getElementById('rvNext').click();await sleep(5);console.log(title(),'cards shown',cards());
 for(let k=0;k<20;k++){const n=d.getElementById('rvNext');if(n.disabled)break;n.click();await sleep(2)}console.log(title(),'cards shown',cards(),'|',d.querySelector('.modal .note').textContent);
 d.getElementById('rvBack').click();await sleep(5);console.log('back to record',/Double-dummy/.test(d.querySelector('.modal').textContent));process.exit(0)})();
