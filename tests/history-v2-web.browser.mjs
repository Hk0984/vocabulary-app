// Isolated artifact test. Production Firebase/other Sheets are blocked by CDP.
// Builds its own artifact. Normal mode uses synthetic data; UI_REQUIRE_LIVE=1 permits only real Sheets GETs.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import path from 'node:path';
import {buildWeb} from '../scripts/build-web.mjs';

const root=process.cwd();let artifact;
const listenPort=Number(process.env.UI_PORT||8765),requireLive=process.env.UI_REQUIRE_LIVE==='1';
assert.ok(Number.isInteger(listenPort)&&listenPort>=1024&&listenPort<=65535,'UI_PORT must be a fixed unprivileged port');
let target,expectedRow,unavailable;
const headers=['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation','period_codes','century_codes','area_codes','time_ranges'];
const synthetic=['hv1_test_smoke_001','synthetic','合成テスト専用：正解を選んでください。','合成の正解','合成の誤答B','合成の誤答C','合成の誤答D','1','これは合成データの解説です。','contemporary','ce_20','geo.france','1919..1919'];
const values=[headers,synthetic];
let browser,socket,server,directory,origin,seq=0,live;
const pending=new Map();
const network={allowedSheetGets:0,syntheticResponses:0,blockedExternal:0,unexpectedWrites:0,requests:[],responses:[]};
const sheetRequests=new Set(),extraReferrers=new Map();
function header(headers,name){return Object.entries(headers||{}).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1]||null;}
function send(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},30000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails){const detail=(r.exceptionDetails.exception?.description||r.exceptionDetails.text).split('\n').slice(0,4).join('\n').replace(/AIza[A-Za-z0-9_-]+/g,'[key withheld]').replace(/https:\/\/sheets\.googleapis\.com\/[^\s]+/g,'[Sheets URL withheld]');throw Error(detail);}return r.result.value;}
before(async()=>{
    const configPath=process.env.UI_LIVE_PUBLIC_CONFIG||'config/history-public-rebuild.json';
    if(requireLive&&!existsSync(configPath)){unavailable='Live public configuration is missing; real connection NOT RUN';return;}
    assert.ok(!/\.env|service.account|credentials|\.pem|\.key/i.test(configPath),'Use public-only configuration');
    const publicConfig=requireLive?JSON.parse(await readFile(configPath,'utf8')):
        {spreadsheetId:'synthetic-public-history',sheetName:'history_questions',expectedIdPrefix:'hv1_test_',requireCurrentSchema:true};
    target=publicConfig.spreadsheetId;
    await mkdir(path.join(root,'dist'),{recursive:true});
    directory=await mkdtemp(path.join(root,'dist/history-v2-browser-'));
    artifact=path.join(directory,'web');await buildWeb({outputDir:artifact,publicConfig});
    const release=JSON.parse(await readFile(path.join(artifact,'release.json'),'utf8'));
    const allowed=new Set([...release.files.map(f=>f.name),'release.json']);
    assert.equal(allowed.size,19);
    server=createServer(async(req,res)=>{
        const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';
        if(req.method!=='GET'||!allowed.has(name)){res.writeHead(404).end();return;}
        try{const data=await readFile(path.join(artifact,name));
            const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'application/json';
            res.writeHead(200,{'Content-Type':type+';charset=utf-8','Cache-Control':'no-store'}).end(data);
        }catch{res.writeHead(404).end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(listenPort,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
    console.log('Local verification URL: '+origin+'/');
    const binary=process.env.UI_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(existsSync(binary));
    browser=spawn(binary,['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update',
        '--disable-sync','--no-first-run','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+directory+'/profile','about:blank'],
        {windowsHide:true,stdio:'ignore'});
    let port;for(let i=0;i<150;i++){try{port=(await readFile(directory+'/profile/DevToolsActivePort','utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.ok(port,'isolated browser starts');
    const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{const message=JSON.parse(event.data);
        if(message.method==='Network.requestWillBeSent'){
            const p=message.params,u=new URL(p.request.url);
            if(u.origin==='https://sheets.googleapis.com'&&u.pathname.startsWith('/v4/spreadsheets/'+target+'/values/')){
                sheetRequests.add(p.requestId);
                network.requests.push({requestId:p.requestId,pageUrl:p.documentURL,method:p.request.method,
                    apiEndpoint:u.origin+u.pathname,referer:header(p.request.headers,'referer'),referrerPolicy:p.request.referrerPolicy});
            }
            return;
        }
        if(message.method==='Network.requestWillBeSentExtraInfo'){
            const p=message.params;extraReferrers.set(p.requestId,header(p.headers,'referer'));return;
        }
        if(message.method==='Network.responseReceived'){
            const p=message.params;if(sheetRequests.has(p.requestId))network.responses.push({requestId:p.requestId,status:p.response.status});return;
        }
        if(message.method==='Fetch.requestPaused'){
            const p=message.params,u=new URL(p.request.url),local=u.origin===origin;
            const sheet=u.origin==='https://sheets.googleapis.com'&&u.pathname.startsWith('/v4/spreadsheets/'+target+'/values/');
            const permitted=p.request.method==='GET'&&(local||sheet);
            if(sheet&&permitted&&!requireLive){
                network.syntheticResponses++;
                void send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,
                    responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],
                    body:Buffer.from(JSON.stringify({values})).toString('base64')}).catch(()=>{});return;
            }
            if(sheet&&permitted)network.allowedSheetGets++;
            if(!permitted){network.blockedExternal++;if(p.request.method!=='GET')network.unexpectedWrites++;}
            void send(permitted?'Fetch.continueRequest':'Fetch.failRequest',permitted?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
            return;
        }
        const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
        message.error?item.reject(Error(message.error.message)):item.resolve(message.result);
    };
    await send('Page.enable');await send('Network.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    // Suppress production boot/auth and PWA listeners; load the unchanged artifact scripts/UI.
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`
        const add=document.addEventListener.bind(document);
        document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')add(name,...args);};
        window.__sheetHttp=[];const nativeFetch=window.fetch.bind(window);
        window.fetch=async(...args)=>{const r=await nativeFetch(...args);if(String(args[0]).includes('sheets.googleapis.com')){
            if(r.ok)window.__sheetValues=(await r.clone().json()).values;
            let reason; if(!r.ok){try{const b=await r.clone().json();reason=b.error?.details?.find(d=>d.reason)?.reason||b.error?.status;}catch{}}
            window.__sheetHttp.push({status:r.status,reason});}return r;};`});
    await send('Page.navigate',{url:origin+'/'});
    for(let i=0;i<150;i++){if(await evaluate('typeof loadHistoryQuestions==="function"&&typeof renderSheetList==="function"'))break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(await evaluate('typeof loadHistoryQuestions'),'function');
});
after(async()=>{
    for(const request of network.requests)request.sentReferer=extraReferrers.get(request.requestId)||request.referer;
    if(directory)await writeFile(directory+'/verification.json',JSON.stringify({localUrl:origin+'/',requireLive,dataMode:requireLive?'live_without_replay':'synthetic_no_external_sheets',live,network},null,2));
    console.log('Sanitized request evidence: '+JSON.stringify(network.requests));
    if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}
    if(browser&&browser.exitCode===null)browser.kill();if(server)await new Promise(r=>server.close(r));
    if(directory)console.log('Verification artifacts: '+directory);
});

test('actual local-origin public Sheets connection',async t=>{
    if(unavailable){t.skip(unavailable);return;}
    if(!requireLive){t.skip('Live mode NOT REQUESTED; subsequent UI tests use synthetic data, not a live success');return;}
    live=await evaluate(`(async()=>{try{const rows=await loadHistoryQuestions();return {ok:true,questions:rows.length,id:rows[0]?.id,http:window.__sheetHttp};}
        catch{return {ok:false,http:window.__sheetHttp};}})()`);
    console.log('Live public connection (no keys): '+JSON.stringify(live));
    if(!live.ok){
        await evaluate(`selectSheet('history_questions')`);
        assert.match(await evaluate(`document.getElementById('settingsMessage').textContent`),/問題を取得できません/);
        assert.equal(await evaluate(`document.getElementById('beginStudyButton').disabled`),true);
        if(requireLive)assert.fail('Live Sheets connection required; HTTP referrer blocked. No snapshot fallback is permitted.');
        t.skip('Local-origin Sheets access blocked; error UI checked; following UI checks replay the fresh public GET saved with production-URL Referer');return;
    }
    assert.equal(live.questions,1);assert.equal(live.id,'hv1_rebuild1_smoke_001');
    assert.ok(live.http.length&&live.http.every(r=>r.status===200));
    const received=await evaluate('window.__sheetValues');assert.deepEqual(received[0],headers);assert.equal(received.length,2);
    expectedRow=Object.fromEntries(headers.map((k,i)=>[k,received[1][i]||'']));
    assert.equal(network.syntheticResponses,0);
});

test('13-column data: genre, filters, quiz, explanation and anonymous no-save',async t=>{
    if(unavailable){t.skip(unavailable);return;}
    if(requireLive&&!live?.ok){t.skip('Needs successful direct browser Sheets access');return;}
    if(!requireLive)expectedRow=Object.fromEntries(headers.map((k,i)=>[k,synthetic[i]]));
    await evaluate(`currentUser=null;db={runTransaction(){throw Error('PRODUCTION WRITE FORBIDDEN');}};
        SHEETS=[{title:'English'},{title:'古文'}];renderSheetList();`);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('#sheetList button')].map(e=>e.textContent)`),['English','古文','世界史一問一答']);
    await evaluate(`document.querySelectorAll('#sheetList button')[2].click()`);
    for(let i=0;i<50;i++){if(await evaluate(`document.getElementById('settingsPage').style.display===''&&historyQuestions.length===1`))break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(await evaluate('historyQuestions.length'),1);
    assert.equal(await evaluate('historyQuestions[0].question'),expectedRow.question);
    assert.equal(await evaluate(`document.getElementById('vocabularyRange').hidden`),true);
    for(const [axis,yes,no]of [['periods','contemporary','modern'],['centuries','ce_20','ce_19'],['areas','geo.france','geo.japan']]){
        assert.equal(await evaluate(`for(const s of Object.values(historyFilters))s.clear();renderHistoryFilters();document.querySelector('#historyFilterOptions input[value="${yes}"]').click();historyCandidates().length`),1);
        assert.equal(await evaluate(`for(const s of Object.values(historyFilters))s.clear();renderHistoryFilters();{
            const input=document.querySelector('#historyFilterOptions input[value="${no}"]');
            if(input)input.click();else {if('${axis}'!=='centuries')throw Error('missing filter');historyFilters.centuries.add('${no}');renderHistoryFilters();}
        }historyCandidates().length`),0);
        assert.equal(await evaluate(`document.getElementById('beginStudyButton').disabled`),true);
    }
    assert.equal(await evaluate(`for(const s of Object.values(historyFilters))s.clear();historyFilters.periods.add('contemporary');historyFilters.centuries.add('ce_20');historyFilters.areas.add('geo.france');historyCandidates().length`),1);
    for(const width of [375,402,1280]){
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await evaluate(`studySettings.count=30;beginStudy()`);
        assert.equal(await evaluate(`document.querySelectorAll('#historyChoices button').length`),4);
        assert.equal(await evaluate(`document.getElementById('historyExplanation').hidden`),true);
        assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false);
        assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('#historyChoices button')].map(e=>e.getBoundingClientRect());return b[0].top===b[1].top&&b[2].top===b[3].top&&b[2].top>b[0].top;})()`),true);
        await evaluate(`Array.from(document.querySelectorAll('#historyChoices button')).find(b=>b.textContent.endsWith(${JSON.stringify(expectedRow['choice'+expectedRow.answer])})).click()`);
        assert.equal(await evaluate(`document.getElementById('historyAccuracy').textContent`),'正答率 100%');
        assert.equal(await evaluate(`document.getElementById('historyExplanationText').textContent`),expectedRow.explanation);
        assert.equal(await evaluate(`document.getElementById('historyExplanation').hidden`),false);
        const shot=await send('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile(`${directory}/history-${width}.png`,Buffer.from(shot.data,'base64'));
        await evaluate('nextHistoryQuestion()');assert.match(await evaluate(`document.getElementById('historySummary').textContent`),/出題 1問・正解 1問/);
    }
    assert.equal(network.unexpectedWrites,0);
    if(requireLive){assert.equal(network.syntheticResponses,0);assert.ok(network.responses.every(r=>r.status===200));}
});

test('switching to English and classical Japanese retains vocabulary study',async t=>{
    if(unavailable){t.skip(unavailable);return;}
    if(requireLive&&!live?.ok){t.skip('Needs successful direct browser Sheets access');return;}
    await evaluate(`currentUser={uid:'browser-mock-anonymous',isAnonymous:true};fetchSheetData=async()=>[['id','front','back'],['1','one','一'],['2','two','二'],['3','three','三'],['4','four','四']];`);
    for(const genre of ['English','古文']){
        await evaluate(`selectSheet(${JSON.stringify(genre)})`);
        assert.equal(await evaluate('selectedSheet'),genre);
        assert.equal(await evaluate(`document.getElementById('vocabularyRange').hidden`),false);
        assert.equal(await evaluate('studyWords.length'),4);
        await evaluate(`studySettings.mode='normal';studySettings.format='frontToBack';studySettings.count=10;beginStudy()`);
        assert.equal(await evaluate(`document.querySelectorAll('#choices button').length`),4);
    }
    assert.equal(network.unexpectedWrites,0);
});
