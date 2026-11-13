const {JSDOM}=require('jsdom');const html=require('fs').readFileSync('bridge.html','utf8');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.onerror=m=>console.log('ERR',m)}}).window;await sleep(50);
 const a=[{call:'1S',by:'N'},{call:'P',by:'E'},{call:'2S',by:'S'},{call:'X',by:'W'},{call:'P',by:'N'},{call:'P',by:'E'},{call:'3C',by:'S'},{call:'P',by:'W'},{call:'1N',by:'N'}].slice(0,7);
 w.eval('globalThis.__a='+JSON.stringify(a));console.log(a.map((x,i)=>x.call+' => '+w.eval('explainCall(__a,'+i+')')).join('\n'));
 const b=[{call:'1N',by:'N'},{call:'P',by:'E'},{call:'3N',by:'S'}];w.eval('globalThis.__b='+JSON.stringify(b));console.log(w.eval('explainCall(__b,0)'),'|',w.eval('explainCall(__b,2)'));
 process.exit(0)})();
