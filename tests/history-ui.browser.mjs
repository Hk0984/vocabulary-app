// Optional local Chromium check: node --test tests/history-ui.browser.mjs
// Uses an isolated profile, mocked question data, and blocks all HTTP(S) page requests.
// Requires Node >=24.12, Git and an installed Chrome/Chromium/Edge (no npm browser package).
// Set UI_BROWSER to its executable path on other installations. Run Linux Chromium as non-root.
// A shallow clone must include UI_BASE_REF (default: the release before this UI change).
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
let browser, socket, directory, sequence = 0;
const pending = new Map();
function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
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

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const css = await readFile(path.join(root, 'style.css'), 'utf8');
// Keep the baseline stable after committing; HEAD would compare the new CSS with itself.
const baseline = process.env.UI_BASE_REF || '7a24ffe0911b9fc6dd6fccddd6155f08afd87f10';
const oldCss = execFileSync('git', ['show', baseline + ':style.css'], { cwd: root, encoding: 'utf8' });
const historyCode = await readFile(path.join(root, 'history_questions.js'), 'utf8');
const classificationCode = await readFile(path.join(root, 'history-classification.js'), 'utf8');
const regionData = JSON.parse(await readFile(path.join(root,'history-regions.json'),'utf8'));
const appCode = await readFile(path.join(root,'script.js'),'utf8');
const row = ['test', 'source', '世界史の長い問題文。'.repeat(12),
    '長い選択肢'.repeat(15), '正しい選択肢', '選択肢C', 'https://example.invalid/' + 'x'.repeat(150), '2',
    '解説は回答した後に表示します。\n' + '歴史的な背景についての長い説明。'.repeat(35)];
const fixtureCode = `
    window.HISTORY_QUESTIONS_CONFIG={spreadsheetId:'mock',sheetName:'mock',apiKey:'mock'};
    window.fetch=async()=>({ok:true,json:async()=>({values:[${JSON.stringify(['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation'])},${JSON.stringify(row)},${JSON.stringify([...row.slice(0, 8), ''])}.map((v,i)=>i===0?'second':v)]})});
    Math.random=()=>0.999;
`;
async function loadFixture(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const fixture = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<link\b[^>]*>/gi, '')
        .replace('</head>', '<style id="fixtureCss">' + css + '</style></head>')
        .replace('</body>', '<script>const originalAdd=document.addEventListener.bind(document);document.addEventListener=(name,...args)=>{if(name!=="DOMContentLoaded")originalAdd(name,...args);};' +
            classificationCode + 'HistoryClassification.setRegions('+JSON.stringify(regionData)+');' + historyCode + appCode + fixtureCode +
            'document.addEventListener=originalAdd;currentUser={uid:"mock",isAnonymous:true};</script></body>');
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(fixture) });
    for (let i = 0; i < 100; i++) {
        if (await evaluate('typeof startHistoryQuiz === "function"')) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Fixture did not initialize');
}
const metrics = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e),r=e.getBoundingClientRect();return {width:r.width,padding:s.padding,fontSize:s.fontSize,lineHeight:s.lineHeight,gap:s.gap,background:s.backgroundColor,border:s.borderRadius};})()`;

for (const [width, height] of [[375, 812], [402, 874], [1280, 900]]) {
    test(`shared layout, long text and answer states at ${width}px`, async () => {
        await loadFixture(width, height);
        await evaluate(`showPage('studyPage');document.getElementById('question').textContent='Vocabulary';document.getElementById('choices').innerHTML='<button class="choice">one</button><button class="choice">two</button><button class="choice">three</button><button class="choice">four</button>';document.getElementById('nextButton').style.display='';`);
        const english = {};
        for (const selector of ['.current-sheet', '#question', '#choices', '#choices .choice', '#result', '#nextButton']) english[selector] = await evaluate(metrics(selector));
        // English's computed styles must remain identical to the pre-change stylesheet.
        await evaluate('document.getElementById("fixtureCss").textContent=' + JSON.stringify(oldCss));
        for (const selector of Object.keys(english)) assert.deepEqual(await evaluate(metrics(selector)), english[selector], selector);
        await evaluate('document.getElementById("fixtureCss").textContent=' + JSON.stringify(css));
        await evaluate('openHistorySettings()');
        assert.equal(await evaluate('document.getElementById("settingsPage").style.display'),'');
        assert.equal(await evaluate('document.getElementById("vocabularyRange").hidden'),true);
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
        await evaluate(`document.querySelectorAll('#historyFilterOptions details').forEach(d=>d.open=true)`);
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
        await evaluate(`document.querySelector('#historyFilterOptions input[value="geo.france"]').click()`);
        assert.equal(await evaluate(`document.querySelector('#historyFilterOptions input[value="geo.normandy"]').checked`),true);
        await evaluate(`document.querySelector('#historyFilterOptions input[value="geo.normandy"]').click()`);
        assert.equal(await evaluate(`document.querySelector('#historyFilterOptions input[value="geo.france"]').indeterminate`),true);
        await evaluate(`historyFilters.areas.clear();renderHistoryFilters();beginStudy()`);
        for (const [englishSelector, historySelector] of [['.current-sheet', '.history-header'], ['#question', '#historyQuestion'], ['#choices', '#historyChoices'], ['#choices .choice', '#historyChoices .choice'], ['#result', '#historyResult']]) {
            const actual = await evaluate(metrics(historySelector));
            const expected = { ...english[englishSelector] };
            // Multi-line history content changes height; intrinsic text width is not compared.
            if (historySelector === '#historyQuestion') delete actual.width, delete expected.width;
            assert.deepEqual(actual, expected, historySelector);
        }
        const layout = await evaluate(`(()=>{const b=[...document.querySelectorAll('#historyChoices button')].map(e=>e.getBoundingClientRect());return {overflow:document.documentElement.scrollWidth>innerWidth,columns:b[0].top===b[1].top&&b[2].top===b[3].top&&b[2].top>b[0].top,settingsOpen:false,explanationHidden:document.getElementById('historyExplanation').hidden};})()`);
        assert.deepEqual(layout, { overflow: false, columns: true, settingsOpen: false, explanationHidden: true });
        await evaluate(`document.querySelectorAll('#historyChoices button')[0].click()`);
        assert.equal(await evaluate('document.getElementById("historyAccuracy").textContent'), '正答率 0%');
        assert.equal(await evaluate('document.getElementById("historyExplanation").hidden'), false);
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
        assert.deepEqual(await evaluate(metrics('#historyNext')), english['#nextButton']);
        const screenshot = await send('Page.captureScreenshot', { captureBeyondViewport: true });
        await writeFile(path.join(directory, `history-${width}.png`), Buffer.from(screenshot.data, 'base64'));
        await evaluate('nextHistoryQuestion()');
        assert.equal(await evaluate('document.getElementById("historyExplanation").hidden'), true);
        await evaluate(`document.querySelectorAll('#historyChoices button')[1].click()`);
        assert.equal(await evaluate('document.getElementById("historyAccuracy").textContent'), '正答率 50%');
        assert.equal(await evaluate('document.getElementById("historyExplanation").hidden'), true);
        await evaluate('nextHistoryQuestion()');
        assert.equal(await evaluate('document.getElementById("historyQuiz").style.display'), 'none');
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
    });
}
