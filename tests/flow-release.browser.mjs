// Optional local Chromium check: node --test tests/flow-release.browser.mjs
// Production public GET verification. Blocks authentication and all remote writes.
// Requires Node >=24.12, Git and an installed Chrome/Chromium/Edge (no npm browser package).
// Set UI_BROWSER to its executable path on other installations. Run Linux Chromium as non-root.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
let browser, socket, directory, sequence = 0;
const pending = new Map();
function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
}

before(async () => {
    await mkdir(path.join(root, 'dist'), { recursive: true });
    directory = await mkdtemp(path.join(root, 'dist/history-ui-'));
    const candidates = process.platform === 'win32' ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ] : process.platform === 'darwin' ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    const binary = process.env.UI_BROWSER || candidates.find(candidate => existsSync(candidate));
    assert.ok(binary, 'Install Chrome/Chromium/Edge, or set UI_BROWSER to its executable path');
    browser = spawn(binary, ['--headless=new', '--hide-scrollbars', '--disable-gpu', '--disable-background-networking',
        '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
        '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-extensions',
        '--remote-debugging-port=0', '--user-data-dir=' + directory + '/profile', 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
    let spawnError;
    browser.on('error', error => { spawnError = error; });
    let port;
    for (let attempt = 0; attempt < 150; attempt++) {
        if (spawnError) throw spawnError;
        try { port = (await readFile(directory + '/profile/DevToolsActivePort', 'utf8')).split('\n')[0]; break; }
        catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(port, 'Isolated browser must start');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data); if(message.method==='Fetch.requestPaused'){void route(message.params);return;} const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    };
    await send('Page.enable');
    await send('Network.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:boot});
    console.log('Local screenshots: ' + directory);
});

after(async () => {
    if(directory)await writeFile(path.join(directory,'release-verification.json'),JSON.stringify(evidence,null,2));
    if (socket?.readyState === WebSocket.OPEN) {
        await send('Browser.close').catch(() => {});
        socket.close();
    }
    if (browser && browser.exitCode === null) browser.kill();
});

const base='https://hk0984.github.io/vocabulary-app/';
const artifact=process.env.FLOW_VERIFY_ARTIFACT;
const flowId='1CUqOaYi0PcPrWOmrPvf_C5NYAjZ1krB24FYdG_lImak';
const legacy=JSON.parse(await readFile(path.join(root,'config/history-public-rebuild.json'),'utf8'));
const publicContext={window:{},document:{addEventListener(){}}};
vm.runInNewContext(await readFile(path.join(root,'script.js'),'utf8'),publicContext);
const vocabId=vm.runInNewContext('SHEET_ID',publicContext);
const ids=new Set([flowId,legacy.spreadsheetId,vocabId]);
const assets=new Set(['','index.html','style.css','script.js','history-config.js','history_questions.js','history-classification.js','history-regions.json','history-flow-config.js','history-flow-source.js','history-flow.js','history-flow-ui.js','history-flow-data.json','attribute-tags.js','pwa.js','sw.js','manifest.json','release.json','icons/icon-192.png','icons/icon-512.png']);
const evidence={mode:artifact?'local_artifact_at_production_origin':'deployed_production',sheetsGets:0,blockedWrites:0,checks:{}};
const boot=`window.__ready=[];const add=document.addEventListener.bind(document);document.addEventListener=(n,f,...a)=>{if(n==='DOMContentLoaded')__ready.push(f);else add(n,f,...a);};const wa=window.addEventListener.bind(window);window.addEventListener=(n,...a)=>{if(n!=='load')wa(n,...a);};window.__rows={};const nf=fetch.bind(window);window.fetch=async(...args)=>{const r=await nf(...args);const u=new URL(String(args[0]),location.href);if(r.ok&&u.origin==='https://sheets.googleapis.com'&&u.pathname.includes('/values/')){__rows[u.pathname.split('/')[3]]=(await r.clone().json()).values;}return r;};`;
async function route(p){
    try{
        const u=new URL(p.request.url),isPage=u.href.startsWith(base),name=isPage?decodeURIComponent(u.pathname.slice(new URL(base).pathname.length)):'';
        const sheet=u.origin==='https://sheets.googleapis.com'&&ids.has(u.pathname.split('/')[3]);
        if(!['GET','HEAD'].includes(p.request.method)){evidence.blockedWrites++;await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});return;}
        if(isPage&&assets.has(name)&&artifact){
            const data=await readFile(path.join(root,artifact,name||'index.html'));
            const mime=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':!name||name.endsWith('.html')?'text/html':'application/json';
            await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:mime},{name:'Cache-Control',value:'no-store'}],body:data.toString('base64')});
        }else if((isPage&&assets.has(name))||sheet){if(sheet)evidence.sheetsGets++;await send('Fetch.continueRequest',{requestId:p.requestId});}
        else await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});
    }catch{await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'Failed'}).catch(()=>{});}
}
async function waitFor(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Browser condition timed out');}
test('public Sheets live access, 61 questions and restrictions',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:base});
    await waitFor('typeof openHistoryFlow === "function"&&window.__ready.length>1');
    await evaluate('__ready.at(-1)();currentUser={uid:"readonly-browser",isAnonymous:true};openHistoryFlow()');
    await waitFor('!document.getElementById("flowStart").disabled||document.getElementById("flowStatus").textContent.includes("許可")');
    const status=await evaluate('document.getElementById("flowStatus").textContent');assert.match(status,/61問/,'Real browser Sheets access must succeed; no replay fallback');
    const counts=await evaluate(`(async()=>{const master=HistoryClassification.validateMaster(await(await fetch('history-regions.json')).json());window.__qs=HistoryFlowSource.parseValues(__rows['${flowId}'],master).questions;return {total:__qs.length,contemporary:__qs.filter(q=>q.type==='contemporary').length,ordering:__qs.filter(q=>q.type==='ordering').length};})()`);
    assert.deepEqual(counts,{total:61,contemporary:31,ordering:30});evidence.checks.questions=counts;
    const conf=await evaluate('({mode:HISTORY_FLOW_CONFIG.mode,sheetName:HISTORY_FLOW_CONFIG.sheetName,legacyId:HISTORY_QUESTIONS_CONFIG.spreadsheetId})');
    assert.equal(conf.mode,'sheets');assert.equal(conf.sheetName,'history_flow_public');assert.equal(conf.legacyId,legacy.spreadsheetId);
    // Keep the browser key within this process; print only HTTP statuses/reasons.
    const key=await evaluate('HISTORY_FLOW_CONFIG.apiKey');
    const endpoint='https://sheets.googleapis.com/v4/spreadsheets/'+flowId+'/values/history_flow_public?key='+encodeURIComponent(key);
    const bad=await fetch(endpoint,{headers:{Referer:'https://example.invalid/'}});const badBody=await bad.json();
    const other=await fetch('https://www.googleapis.com/drive/v3/files?key='+encodeURIComponent(key),{headers:{Referer:base}});const otherBody=await other.json();
    evidence.checks.keyRestrictions={foreignRefererStatus:bad.status,foreignRefererReasons:(badBody.error?.details||[]).map(v=>v.reason).filter(Boolean),otherApiStatus:other.status,otherApiReasons:(otherBody.error?.details||[]).map(v=>v.reason).filter(Boolean)};
    assert.equal(bad.status,403);assert.ok(evidence.checks.keyRestrictions.foreignRefererReasons.includes('API_KEY_HTTP_REFERRER_BLOCKED'));
    assert.equal(other.status,403);assert.ok(evidence.checks.keyRestrictions.otherApiReasons.some(r=>['API_KEY_SERVICE_BLOCKED','SERVICE_DISABLED'].includes(r)));
    evidence.checks.keyRestrictions.apiAllowlistVerifiedByProbe=evidence.checks.keyRestrictions.otherApiReasons.includes('API_KEY_SERVICE_BLOCKED');
    console.log(JSON.stringify({questions:counts,keyRestrictions:evidence.checks.keyRestrictions}));
});
test('live quiz, shuffle, grading, explanation and filters at iPhone width',async()=>{
    for(const [axis,key]of [['periods','period_codes'],['centuries','century_codes'],['areas','area_codes']]){
        const ok=await evaluate(`(()=>{const s=document.getElementById('flow_${axis}'),v=__qs[0].${key}.split(';')[0];[...s.options].forEach(o=>o.selected=o.value===v);s.dispatchEvent(new Event('change',{bubbles:true}));const yes=!document.getElementById('flowStart').disabled;[...s.options].forEach(o=>o.selected=false);s.dispatchEvent(new Event('change',{bubbles:true}));return yes;})()`);assert.equal(ok,true);
    }
    for(const type of ['contemporary','ordering']){
        await evaluate(`document.getElementById('flow_type').value='${type}';document.getElementById('flow_count').value='all';document.getElementById('flowStart').click()`);
        const n=type==='contemporary'?31:30;
        for(let i=0;i<n;i++){
            const grading=await evaluate(`(()=>{const q=__qs.find(q=>q.question===document.getElementById('flowQuestion').textContent);const buttons=[...document.querySelectorAll('#flowChoices button')];const display=buttons.slice(0,(q.choices||q.events).length).map(b=>b.textContent);let answer=${i===0?'false':'true'};if(q.type==='contemporary'){const item=q.choices.find(c=>answer?c.id===q.answer:c.id!==q.answer);buttons.find(b=>b.textContent===item.text).click();}else{const ids=answer?q.answer:[...q.answer].reverse();for(const id of ids)buttons.find(b=>b.textContent===q.events.find(e=>e.id===id).text).click();buttons.find(b=>b.textContent==='回答確定').click();}return {shuffled:JSON.stringify(display)!==JSON.stringify((q.choices||q.events).map(v=>v.text)),explanation:document.getElementById('flowExplanation').textContent.includes(q.explanation),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
            assert.equal(grading.explanation,true);assert.equal(grading.overflow,false);if(grading.shuffled)evidence.checks.shuffled=true;
            if(i===0){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(directory,type+'-390.png'),Buffer.from(shot.data,'base64'));}
            await evaluate('document.getElementById("flowNext").click()');
        }
        const summary=await evaluate('document.getElementById("flowStatus").textContent');assert.match(summary,new RegExp('出題数 '+n+'問'));assert.match(summary,/不正解 1問/);
        evidence.checks[type]=summary;
        await evaluate('document.getElementById("flowChange").click()');
    }
    assert.equal(evidence.checks.shuffled,true);
});
test('rebuild history and actual vocabulary coexist without Firestore writes',async()=>{
    const old=await evaluate('(async()=>{const q=await loadHistoryQuestions();return {count:q.length,namespace:q.every(x=>x.id.startsWith("hv1_rebuild1_"))};})()');
    assert.ok(old.count>0);assert.equal(old.namespace,true);evidence.checks.legacy=old;
    await evaluate('openHistorySettings()');await waitFor('historyQuestions.length>0');await evaluate('studySettings.mode="normal";beginStudy()');
    assert.ok(await evaluate('document.querySelectorAll("#historyChoices button").length')>0);
    await evaluate('loadSheets()');await waitFor('SHEETS.length>0');
    const name=await evaluate('(SHEETS.find(s=>/英単語|English|英語|ターゲット/i.test(s.title))||SHEETS.find(s=>s.title!=="history_questions")).title');
    await evaluate('selectSheet('+JSON.stringify(name)+')');await waitFor('studyWords.length>0');await evaluate('studySettings.mode="normal";beginStudy()');
    assert.ok(await evaluate('document.querySelectorAll("#choices button").length')>1);evidence.checks.vocabularyGenre=name;
    assert.equal(evidence.blockedWrites,0);
});
test('deployed artifact and Service Worker cache',async t=>{
    if(artifact){t.skip('Worker activation is verified after actual deployment');return;}
    const result=await evaluate(`(async()=>{const release=await(await fetch('release.json',{cache:'no-store'})).json();await caches.open('vocab-app:'+location.href+':previous-release');await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});await navigator.serviceWorker.ready;return {buildId:release.buildId,files:release.files.map(v=>v.name),caches:await caches.keys()};})()`);
    assert.equal(result.files.length,18);assert.ok(result.files.includes('history-flow-config.js'));assert.ok(result.caches.some(k=>k.endsWith(result.buildId)));assert.ok(!result.caches.some(k=>k.endsWith(':previous-release')));
    evidence.checks.worker=result;
});
