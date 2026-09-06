/* Optional real Chromium layout smoke test with a local mock host; no npm dependencies. */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font:16px sans-serif;background:#222;color:#eee}#top-settings-holder{position:fixed;top:0;height:48px;width:100%;background:#444}#sheld{position:fixed;top:48px;bottom:0;width:100%;display:flex;flex-direction:column}#chat{flex:1;overflow:auto;min-height:0}#form_sheld{height:90px;flex-shrink:0;background:#333}#extensions_settings2{position:absolute;left:0;top:50px;width:250px;background:#222;z-index:5}#extensions_settings2[hidden]{display:none}
</style></head><body><nav id="top-settings-holder">Mock host navigation</nav><section id="sheld"><div id="chat"><div style="height:2000px">Mock chat</div></div><div id="form_sheld">Mock input / send</div></section><div id="extensions_settings2"></div>
<script type="module">
const events={}, metadataA={}, metadataB={}; let metadata=metadataA, chatId='A';
window.SillyTavern={getContext:()=>({characterId:0,characters:[{name:'砚绒',avatar:'yanrong.png'}],name1:'我',chatId,chatMetadata:metadata,extensionSettings:settings,saveMetadata:async()=>{},saveSettingsDebounced:()=>{},eventTypes:{APP_INITIALIZED:'init',CHAT_CHANGED:'chat'},eventSource:{on:(id,fn)=>{events[id]=fn}}})};
const settings={}; window.confirm=()=>true;
const check=(value,message)=>{if(!value)throw Error(message)};
const get=id=>document.getElementById(id);
const delay=()=>new Promise(resolve=>setTimeout(resolve,30));
const click=async id=>{get(id).click();await delay()};
const change=async(id,value)=>{get(id).value=value;get(id).dispatchEvent(new Event('change'));await delay()};
const on=async()=>{get('qhjt-game').checked=true;get('qhjt-game').dispatchEvent(new Event('change'));await delay()};
try {
 await import('/index.js'); await events.init(); await events.init();
 check(innerWidth===320,'Must test an actual 320px viewport');
 check(get('qhjt-host').hidden,'OFF hides entry');
 check(get('qhjt-settings').querySelectorAll('select,button').length===0,'Settings must contain no management controls');
 await on(); get('extensions_settings2').hidden=true;
 const entry=get('qhjt-entry').getBoundingClientRect(), input=get('form_sheld').getBoundingClientRect();
 check(entry.width>=44&&entry.height>=44,'Entry touch target');
 check(input.top-entry.bottom>=79,'Entry must clear input by 80px');
 check(entry.top>=48,'Entry must clear navigation');
 get('sheld').style.transform='translateX(0)';window.dispatchEvent(new Event('resize'));await delay();
 check(input.top-get('qhjt-entry').getBoundingClientRect().bottom>=79,'Translated chat container entry clearance');
 get('sheld').style.transform='';window.dispatchEvent(new Event('resize'));await delay();
 await click('qhjt-entry');
 check(get('qhjt-overlay').open,'Open modal');
 check(document.documentElement.scrollWidth<=320,'No page horizontal overflow');
 check(get('qhjt-panel').getBoundingClientRect().width<=320,'Sheet fits viewport');
 check(get('qhjt-scroll').scrollWidth<=get('qhjt-scroll').clientWidth,'No sheet horizontal overflow');
 check(get('chat').style.overflow==='hidden','Lock background chat scroll');
 await click('qhjt-close'); check(!get('qhjt-overlay').open,'Close button');
 check(get('chat').style.overflow==='','Restore chat scroll styles');
 await click('qhjt-entry'); get('qhjt-overlay').dispatchEvent(new MouseEvent('click',{bubbles:true}));await delay();
 check(!get('qhjt-overlay').open,'Backdrop close');
 await click('qhjt-entry');
 const system=document.createElement('dialog');system.textContent='Mock system popup';document.body.append(system);system.showModal();
 check(document.elementFromPoint(160,370)===system||system.contains(document.elementFromPoint(160,370)),'Later system modal stays on top');system.close();system.remove();
 await click('qhjt-tab-world');await change('qhjt-world','modern_city');
 await click('qhjt-tab-state');await click('qhjt-control');
 check(metadata.qingheji_tavern.controlMode==='user','Switch to User');
 check(!get('qhjt-active'),'No ordinary protagonist selector');
 await click('qhjt-tab-actors');await click('qhjt-add-character');
 await click('qhjt-add-custom');get('qhjt-name').value='超长自定义人物名称'.repeat(15);await click('qhjt-name-ok');
 check(Object.keys(metadata.qingheji_tavern.actors).length===3,'Add three sources');
 await click('qhjt-inspect-actor_1');check(metadata.qingheji_tavern.controlMode==='user','Viewing card does not transfer control');
 await click('qhjt-inspect-actor_3');await click('qhjt-tab-state');await click('qhjt-plus');
 check(metadata.qingheji_tavern.actors.actor_2.currency.amount===1100,'User currency');
 check(metadata.qingheji_tavern.actors.actor_1.currency.amount===1000&&metadata.qingheji_tavern.actors.actor_3.currency.amount===1000,'NPCs untouched');
 check(get('qhjt-summary').textContent.includes('我'),'Summary uses controlled actor');
 check(get('qhjt-overlay').open,'Edits keep sheet open');
 await click('qhjt-tab-actors');
 await click('qhjt-detail-close');await click('qhjt-inspect-actor_1');
 check(metadata.qingheji_tavern.controlMode==='user','Reopening detail preserves control');
 check(get('qhjt-scroll').scrollWidth<=get('qhjt-scroll').clientWidth,'Long name cannot widen sheet');
 await click('qhjt-add-custom');
 const focus=get('qhjt-name').getBoundingClientRect(), scroll=get('qhjt-scroll').getBoundingClientRect();
 check(focus.top>=scroll.top-1&&focus.bottom<=scroll.bottom+1,'Name input scrolled into view');
 await click('qhjt-name-cancel');
 metadata=metadataB;chatId='B';await events.chat();check(get('qhjt-host').hidden&&!get('qhjt-overlay').open,'B OFF clears A UI');
 metadata=metadataA;chatId='A';await events.chat();check(!get('qhjt-host').hidden,'A ON restored');
 for(let i=0;i<3;i++)await events.chat();
 for(const id of ['qhjt-entry','qhjt-overlay','qhjt-panel'])check(document.querySelectorAll('#'+id).length===1,'No duplicate '+id);
 await click('qhjt-entry');
 get('qhjt-master').checked=false;get('qhjt-master').dispatchEvent(new Event('change'));await delay();
 check(!get('qhjt-entry')&&!get('qhjt-overlay'),'Master OFF unmounts');
 check(get('chat').style.overflow==='','Unmount unlocks background');
 get('qhjt-master').checked=true;get('qhjt-master').dispatchEvent(new Event('change'));await delay();
 await click('qhjt-entry');await click('qhjt-tab-actors');await click('qhjt-add-custom');
 window.__result={passed:true,width:innerWidth,sheetWidth:get('qhjt-panel').getBoundingClientRect().width};
} catch(error){window.__result={passed:false,error:error.stack}}
</script></body></html>`;
async function main() {
    const executable = process.env.QHJT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
    if(!executable)throw Error('Set QHJT_CHROME to a local Chrome/Chromium executable.');
    const allowed = new Set(['index.js','style.css','ui/floating-panel.js','core/game-state.js','core/actor-sources.js','data/world-templates.js']);
    const server=http.createServer((req,res)=>{
        const name=(req.url||'/').slice(1);
        if(!name){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return}
        if(!allowed.has(name)){res.writeHead(404);res.end();return}
        res.setHeader('Content-Type',name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
        res.end(fs.readFileSync(path.join(root,name)));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qhjt-browser-'));
    let browser,ws;
    try {
        browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
        const endpoint=await new Promise((resolve,reject)=>{
            let output='';const timeout=setTimeout(()=>reject(Error('Browser startup timeout')),15000);
            browser.once('error',error=>{clearTimeout(timeout);reject(error)});
            browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1])}});
        });
        ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{
            const timeout=setTimeout(()=>reject(Error('DevTools socket timeout')),10000);
            ws.onopen=()=>{clearTimeout(timeout);resolve()};ws.onerror=error=>{clearTimeout(timeout);reject(error)};
        });
        let serial=0;const pending=new Map();
        ws.onmessage=event=>{const message=JSON.parse(event.data);const request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result)}};
        const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
            const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(Error('DevTools timeout: '+method))},20000);
            pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject:error=>{clearTimeout(timeout);reject(error)}});
            ws.send(JSON.stringify({id,method,params,sessionId}));
        });
        const target=await send('Target.createTarget',{url:'about:blank'});
        const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
        const call=(method,params)=>send(method,params,sessionId);
        await call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
        await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
        const result=await call('Runtime.evaluate',{expression:'new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(window.__result){clearInterval(timer);resolve(window.__result)}else if(Date.now()-started>12000){clearInterval(timer);reject(Error("Fixture timeout"))}},50)})',awaitPromise:true,returnByValue:true});
        if(result.exceptionDetails||!result.result?.value?.passed)throw Error(JSON.stringify(result));
        const scrollBefore=await call('Runtime.evaluate',{expression:'document.getElementById("chat").scrollTop',returnByValue:true});
        await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:5,y:5,deltaX:0,deltaY:300});
        const scrollAfter=await call('Runtime.evaluate',{expression:'document.getElementById("chat").scrollTop',returnByValue:true});
        if(scrollBefore.result.value!==scrollAfter.result.value)throw Error('Background chat scrolled through the backdrop');
        // Resize the actual viewport to approximate a keyboard occupying the lower half.
        await call('Emulation.setDeviceMetricsOverride',{width:320,height:400,deviceScaleFactor:1,mobile:true});
        await new Promise(resolve=>setTimeout(resolve,100));
        const small=await call('Runtime.evaluate',{expression:'(()=>{const input=document.getElementById("qhjt-name").getBoundingClientRect(),scroll=document.getElementById("qhjt-scroll").getBoundingClientRect(),close=document.getElementById("qhjt-close").getBoundingClientRect();return {ok:input.top>=scroll.top-1&&input.bottom<=scroll.bottom+1&&close.top>=0&&close.bottom<=400&&document.documentElement.scrollWidth<=320,input:{top:input.top,bottom:input.bottom},scroll:{top:scroll.top,bottom:scroll.bottom}}})()',returnByValue:true});
        if(!small.result.value.ok)throw Error('Reduced viewport layout: '+JSON.stringify(small.result.value));
        await call('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
        await new Promise(resolve=>setTimeout(resolve,100));
        const desktop=await call('Runtime.evaluate',{expression:'(()=>{const box=document.getElementById("qhjt-panel").getBoundingClientRect();return box.width<=640&&Math.abs((box.left+box.right)/2-512)<2&&document.documentElement.scrollWidth<=1024})()',returnByValue:true});
        if(!desktop.result.value)throw Error('Desktop centered layout failed');
        console.log('PASS: real headless Chromium at 320x740 and 320x400, no horizontal overflow, visible name input/close, entry clearance, modal close/backdrop, system modal stacking, actor/world edits, A/B isolation, unmount/remount. Mock host only.');
        await send('Browser.close');
    } finally {
        ws?.close();browser?.kill();server.closeAllConnections();server.close();
        // The isolated browser profile stays in the OS temp directory, never in the repo.
    }
}
main().catch(error=>{console.error(error);process.exitCode=1});
