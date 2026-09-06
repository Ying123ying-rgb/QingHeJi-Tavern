/* Optional real Chromium layout smoke test with a local mock host; no npm dependencies. */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'browser-fixture.html'), 'utf8');
async function main() {
    const executable = process.env.QHJT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
    if(!executable)throw Error('Set QHJT_CHROME to a local Chrome/Chromium executable.');
    const allowed = new Set(['index.js','style.css','ui/floating-panel.js','core/game-state.js','core/actions.js','core/semantic-state.js','core/semantic-scan.js','core/local-semantic.js','core/secondary-api.js','ui/secondary-settings.js','ui/knowledge-views.js','core/world-discovery.js','core/discovery-provider.js','ui/discovery-session.js','core/actor-sources.js','data/world-templates.js']);
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
        await call('Page.reload');
        await new Promise(resolve=>setTimeout(resolve,200));
        const reloaded=await call('Runtime.evaluate',{expression:'new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(window.__result){clearInterval(timer);resolve(window.__result)}},30);setTimeout(()=>{clearInterval(timer);reject(Error("Reload timeout"))},5000)})',awaitPromise:true,returnByValue:true});
        if(!reloaded.result?.value?.passed||!reloaded.result.value.reloaded)throw Error('Refresh failed: '+JSON.stringify(reloaded));
        console.log('PASS: real headless Chromium at 320x740 and 320x400, no horizontal overflow, inventory/NPC forms, full-width actions, sync/dedup, simulated API round scans, refresh persistence, A/B isolation and floating lifecycle. Mock host/API only.');
        await send('Browser.close');
    } finally {
        ws?.close();browser?.kill();server.closeAllConnections();server.close();
        // The isolated browser profile stays in the OS temp directory, never in the repo.
    }
}
main().catch(error=>{console.error(error);process.exitCode=1});
