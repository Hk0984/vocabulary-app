// Optional local Chromium check: node --test tests/history-flow.browser.mjs
// Uses an isolated profile, mocked question data, and blocks all HTTP(S) page requests.
// Requires Node >=24.12, Git and an installed Chrome/Chromium/Edge (no npm browser package).
// Set UI_BROWSER to its executable path on other installations. Run Linux Chromium as non-root.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import {csv} from '../scripts/validate-study-data.mjs';

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
        const message = JSON.parse(event.data), item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    };
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    console.log('Local screenshots: ' + directory);
});

after(async () => {
    if (socket?.readyState === WebSocket.OPEN) {
        await send('Browser.close').catch(() => {});
        socket.close();
    }
    if (browser && browser.exitCode === null) browser.kill();
});

const html=await readFile(path.join(root,'index.html'),'utf8');
const css=await readFile(path.join(root,'style.css'),'utf8');
const code=await Promise.all(['history-classification.js','attribute-tags.js','history-flow.js','history-flow-config.js','history-flow-source.js','script.js','history-flow-ui.js'].map(f=>readFile(path.join(root,f),'utf8')));
const regions=JSON.parse(await readFile(path.join(root,'history-regions.json'),'utf8'));
const sample=JSON.parse(await readFile(path.join(root,'templates/history-flow.sample.json'),'utf8'));
async function fixture(width,data) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    const setup=`const appReady=[];const originalAdd=document.addEventListener.bind(document);document.addEventListener=(name,fn)=>{if(name==='DOMContentLoaded')appReady.push(fn);else originalAdd(name,fn);};`;
    const scripts=setup+code.join('\n')+`\nwindow.HISTORY_FLOW_CONFIG={mode:'static'};window.fetch=async url=>({ok:true,json:async()=>String(url).includes('regions')?${JSON.stringify(regions)}:${JSON.stringify(data)}});appReady.at(-1)();`;
    const page=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'').replace('</head>','<style>'+css+'</style></head>').replace('</body>','<script>'+scripts+'</script></body>');
    await send('Page.navigate',{url:'data:text/html;charset=utf-8,'+encodeURIComponent(page)});
    for(let i=0;i<100;i++) {
        if(await evaluate('typeof openHistoryFlow === "function"'))break;
        await new Promise(resolve=>setTimeout(resolve,20));
    }
    await evaluate('openHistoryFlow()');
}
for(const width of [375,1280])test(`flow settings and ordering at ${width}px`,async()=>{
    await fixture(width,{schema_version:'1.0',questions:[sample.questions[1]]});
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
    await evaluate('document.getElementById("flowStart").click()');
    assert.equal(await evaluate('document.querySelector("#flowChoices button").getBoundingClientRect().height>=44'),true);
    await evaluate('document.querySelector("#flowChoices button").click()');
    assert.match(await evaluate('document.querySelector("#flowChoices p").textContent'),/1\./);
    await evaluate('document.querySelectorAll("#flowChoices button")[3].click()');
    assert.equal(await evaluate('document.querySelector("#flowChoices button").disabled'),false);
    await evaluate(`document.querySelectorAll('#flowChoices button').forEach((b,i)=>{if(i<3)b.click();});document.querySelectorAll('#flowChoices button')[5].click();`);
    assert.match(await evaluate('document.getElementById("flowExplanation").textContent'),/正解：/);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
    await send('Page.captureScreenshot',{format:'png'}).then(result=>writeFile(path.join(directory,`flow-${width}.png`),Buffer.from(result.data,'base64')));
    await evaluate('document.getElementById("flowNext").click();document.getElementById("flowNext").click()');
    assert.match(await evaluate('document.getElementById("flowStatus").textContent'),/出題数 1問/);
    await evaluate('document.getElementById("flowRetry").click()');
    assert.equal(await evaluate('document.getElementById("flowQuiz").hidden'),false);
});
test('contemporary scoring and empty production data in browser',async()=>{
    await fixture(375,{schema_version:'1.0',questions:[sample.questions[0]]});
    await evaluate('document.getElementById("flowStart").click();[...document.querySelectorAll("#flowChoices button")].find(b=>b.textContent==="C国の出来事乙").click()');
    assert.match(await evaluate('document.getElementById("flowExplanation").textContent'),/^正解です/);
    await evaluate('document.getElementById("flowNext").click()');
    assert.match(await evaluate('document.getElementById("flowStatus").textContent'),/正答率 100%/);
    await fixture(375,{schema_version:'1.0',questions:[]});
    assert.match(await evaluate('document.getElementById("flowStatus").textContent'),/まだ問題が登録されていません/);
});
test('dedicated Sheets adapter loads all 61 questions and orders synthetic items on mobile',async()=>{
    const rows=csv((await readFile(path.join(root,'tests/fixtures/flow-admin.synthetic.csv'),'utf8')).replace(/^\uFEFF/,''));
    const headers=Object.keys(rows[0]).slice(0,-2), values=[headers,...rows.map(r=>headers.map(k=>r[k]))];
    await fixture(375,{schema_version:'1.0',questions:[]});
    await evaluate(`window.HISTORY_FLOW_CONFIG={mode:'sheets',spreadsheetId:'mock-flow-public',sheetName:'history_flow_public',apiKey:'mock'};window.flowRequests=[];window.fetch=async url=>(flowRequests.push(url),{ok:true,json:async()=>String(url).includes('regions')?${JSON.stringify(regions)}:{values:${JSON.stringify(values)}}});openHistoryFlow();`);
    // Wait for the asynchronous source adapter before inspecting the settings.
    for(let i=0;i<100;i++){if(await evaluate('document.getElementById("flowStatus").textContent.includes("61問")'))break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.match(await evaluate('document.getElementById("flowStatus").textContent'),/61問/);
    assert.equal(await evaluate('flowRequests.filter(u=>u.includes("sheets.googleapis.com")).length'),1);
    assert.equal(await evaluate('flowRequests.some(u=>u.includes("history-flow-data.json"))'),false);
    await evaluate(`Math.random=()=>0;document.getElementById('flow_type').value='ordering';document.getElementById('flowStart').click();`);
    await evaluate(`(()=>{const rows=${JSON.stringify(rows)};const r=rows.find(r=>r.question===document.getElementById('flowQuestion').textContent);for(const id of r.answer.split(';')){const i=[1,2,3,4].find(i=>r['item'+i+'_id']===id);[...document.querySelectorAll('#flowChoices button')].find(b=>b.textContent===r['item'+i+'_text']).click();}[...document.querySelectorAll('#flowChoices button')].find(b=>b.textContent==='回答確定').click();})()`);
    assert.match(await evaluate('document.getElementById("flowExplanation").textContent'),/^正解です/);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
});
