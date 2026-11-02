import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function app(shared = new Map()) {
    const writes = [];
    const elements = new Map();
    const controls = { failLoad: false, failWrite: false, attempts: 0 };
    const snapshot = path => ({ exists: shared.has(path), data: () => structuredClone(shared.get(path)?.data) });
    const ref = (path = '') => ({ path,
        collection(name) { return ref(path + '/' + name); },
        doc(id) { return ref(path + '/' + id); },
        async get(options) {
            assert.equal(options.source, 'server');
            if (controls.failLoad) throw new Error('load failure');
            return { forEach(callback) {
                for (const [key, value] of shared) if (key.startsWith(path + '/')) {
                    callback({ id: key.split('/').at(-1), data: () => structuredClone(value.data) });
                }
            } };
        }
    });
    const db = ref();
    db.runTransaction = async callback => {
        for (let attempt = 0; attempt < 40; attempt++) {
            controls.attempts++;
            const reads = new Map();
            const pending = [];
            const result = await callback({
                async get(target) { reads.set(target.path, shared.get(target.path)?.version || 0); return snapshot(target.path); },
                set(target, value, options) { pending.push({ target, value, options }); }
            });
            if ([...reads].some(([path, version]) => (shared.get(path)?.version || 0) !== version)) continue;
            if (controls.failWrite) throw new Error('write failure');
            for (const {target, value, options} of pending) {
                const previous = shared.get(target.path);
                const data = structuredClone(previous?.data || {});
                for (const [key, update] of Object.entries(value)) data[key] = { ...data[key], ...update };
                shared.set(target.path, { data, version: (previous?.version || 0) + 1 });
                writes.push({ path: [target.path.split('/')[2], target.path.split('/')[4]], value, options });
            }
            return result;
        }
        throw new Error('transaction retries exhausted');
    };
    function element(id = '', tagName = 'div') {
        return { id, tagName, children: [], hidden: false, style: {}, listeners: {}, classList: {add() {}, remove() {}, toggle() {}}, _text: '',
            set textContent(value) { this._text = String(value); this.children = []; },
            get textContent() { return this._text; },
            set innerHTML(value) { this._text = value; this.children = []; },
            appendChild(child) { this.children.push(child); return child; },
            replaceChildren(...children) { this.children = children; this._text = ''; },
            addEventListener(name, callback) { this.listeners[name] = callback; },
            querySelectorAll(selector) { return selector === 'button' ? this.children.filter(child => child.tagName === 'button') : []; }
        };
    }
    const alerts = [];
    const context = vm.createContext({ alert(message) { alerts.push(message); }, document: { addEventListener() {}, createElement(tagName) { return element('', tagName); },
        querySelectorAll() { return ['homePage','sheetPage','progressPage','studyPage','historyPage'].map(id => this.getElementById(id)); },
        getElementById(id) {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
    } },
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'timestamp' } } }, testDb: db });
    context.window = context;
    context.scrollTo = () => {};
    vm.runInContext(readFileSync(new URL('../script.js', import.meta.url), 'utf8'), context);
    vm.runInContext('db = testDb; currentUser = { uid: "test-user", isAnonymous: false }; selectedSheet = "English"; progressLoad = {status: "ready", uid: "test-user", request: 1};', context);
    return { context, writes, shared, controls, elements, alerts };
}

test('history uses existing progress fields in a separate genre and preserves English state', async () => {
    const { context, writes } = app();
    await vm.runInContext('recordAnswer({ id: 7, front: "apple", back: "りんご" }, true)', context);
    await vm.runInContext('recordHistoryAnswer({ id: "7", question: "問題", answer: "2", choice2: "正解" }, false)', context);
    await vm.runInContext('recordHistoryAnswer({ id: "7", question: "問題", answer: "2", choice2: "正解" }, true)', context);
    assert.deepEqual(Array.from(writes[0].path), ['test-user', 'English']);
    assert.deepEqual(Array.from(writes[1].path), ['test-user', 'history_questions']);
    assert.equal(writes[0].value.id_7.correct, 1);
    const saved = writes[2].value.history_7;
    assert.equal(saved.total, 2);
    assert.equal(saved.correct, 1);
    assert.equal(saved.wrong, 1);
    assert.equal(saved.front, '問題');
    assert.equal(saved.back, '正解');
    assert.equal(saved.id, null);
    assert.deepEqual(Object.keys(saved).sort(), Object.keys(writes[0].value.id_7).sort());
    assert.equal(vm.runInContext('selectedSheet', context), 'English');
    assert.equal(vm.runInContext('getWordProgress({ id: 7 }).total', context), 1);
});

test('anonymous and signed out users do not write history; write rejection reaches the UI caller', async () => {
    const { context, writes, controls } = app();
    vm.runInContext('currentUser.isAnonymous = true', context);
    assert.equal(await vm.runInContext('recordHistoryAnswer({}, true)', context), false);
    vm.runInContext('currentUser = null', context);
    assert.equal(await vm.runInContext('recordHistoryAnswer({}, true)', context), false);
    assert.equal(writes.length, 0);
    controls.failWrite = true;
    vm.runInContext('currentUser = { uid: "test-user" };', context);
    await assert.rejects(vm.runInContext('recordHistoryAnswer({id:"a", question:"Q", answer:"1", choice1:"A"}, true)', context), /write failure/);
});

test('English ID range and count settings still select only available matching words', () => {
    const { context } = app();
    context.document.getElementById = id => ({ value: id === 'startIdInput' ? '2' : '4' });
    vm.runInContext(`
        showPage = () => {};
        updateSelectedSheetName = () => {};
        updateStudyQuestionType = () => {};
        updateSessionInfo = () => {};
        showQuestion = () => {};
        studyWords = Array.from({length: 6}, (_, i) => ({id: i + 1, front: 'w' + i, back: 'meaning' + i}));
        studySettings.rangeMode = 'id';
        studySettings.count = 2;
        beginStudy();
    `, context);
    const selected = vm.runInContext('studyWords', context);
    assert.equal(selected.length, 2);
    assert.ok(selected.every(word => word.id >= 2 && word.id <= 4));
    vm.runInContext("studySettings.count = 30; beginStudy();", context);
    assert.equal(vm.runInContext('studyWords.length', context), 2);
});

test('existing navigation keeps English pages protected and history available without login', () => {
    const { context } = app();
    const pages = Object.fromEntries(['homePage', 'studyPage', 'historyPage'].map(id => [id, { style: {} }]));
    context.document.querySelectorAll = () => Object.values(pages);
    context.document.getElementById = id => pages[id];
    context.window = { scrollTo() {} };
    vm.runInContext('currentUser = null; showPage("studyPage")', context);
    assert.equal(pages.studyPage.style.display, 'none');
    assert.equal(pages.homePage.style.display, '');
    vm.runInContext('showPage("historyPage")', context);
    assert.equal(pages.historyPage.style.display, '');
    vm.runInContext('currentUser = {uid: "test-user"}; showPage("studyPage")', context);
    assert.equal(pages.studyPage.style.display, '');
});

const word = { id: 7, front: 'apple', back: 'りんご' };
const history = { id: '7', question: '問題', answer: '2', choice2: '正解' };
const englishPath = '/users/test-user/progress/English';

test('uninitialized and failed loads block writes; reload recovers without overwriting existing counts', async () => {
    const { context, controls, shared, writes, elements } = app();
    shared.set(englishPath, { version: 1, data: { id_7: { correct: 8, wrong: 2, total: 10 } } });
    vm.runInContext('resetProgressLoad(currentUser)', context);
    await assert.rejects(context.recordAnswer(word, true), /not ready/);
    assert.equal(await context.loadProgress(), true);
    assert.equal(vm.runInContext('getWordProgress({id:7}).total', context), 10);
    controls.failLoad = true;
    assert.equal(await context.loadProgress(), false);
    assert.equal(vm.runInContext('progressLoad.status', context), 'error');
    assert.equal(vm.runInContext('getWordProgress({id:7}).total', context), 10);
    await assert.rejects(context.recordAnswer(word, true), /not ready/);
    await assert.rejects(context.recordHistoryAnswer(history, true), /not ready/);
    assert.equal(writes.length, 0);
    assert.equal(shared.get(englishPath).data.id_7.total, 10);
    assert.match(elements.get('progressLoadStatus').textContent, /保存を停止/);
    assert.equal(elements.get('retryProgressLoad').hidden, false);
    controls.failLoad = false;
    assert.equal(await context.loadProgress(), true);
    await context.recordAnswer(word, true);
    assert.equal(shared.get(englishPath).data.id_7.total, 11);
    assert.equal(elements.get('retryProgressLoad').hidden, true);
});

test('successful empty server load distinguishes first use from failure and creates history', async () => {
    const { context, controls, shared } = app();
    vm.runInContext('resetProgressLoad(currentUser)', context);
    controls.failLoad = true;
    assert.equal(await context.loadProgress(), false);
    await assert.rejects(context.recordAnswer(word, true));
    assert.equal(shared.size, 0);
    controls.failLoad = false;
    assert.equal(await context.loadProgress(), true);
    assert.equal(vm.runInContext('progressLoad.status', context), 'ready');
    await context.recordAnswer(word, true);
    await context.recordHistoryAnswer(history, false);
    assert.equal(shared.get(englishPath).data.id_7.total, 1);
    assert.equal(shared.get('/users/test-user/progress/history_questions').data.history_7.wrong, 1);
});

test('two clients retry conflicting transactions without losing totals or legacy data', async () => {
    const shared = new Map([[englishPath, { version: 1, data: {
        id_7: { correct: '4', wrong: '6', total: '10', note: 'preserve' },
        id_99: { correct: 3, wrong: 0, total: 3 }
    } }]]);
    const first = app(shared), second = app(shared);
    await Promise.all([first.context.loadProgress(), second.context.loadProgress()]);
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? first : second).context.recordAnswer(word, i % 2 === 0)));
    const saved = shared.get(englishPath).data;
    assert.equal(saved.id_7.total, 18);
    assert.equal(saved.id_7.correct, 8);
    assert.equal(saved.id_7.wrong, 10);
    assert.equal(saved.id_7.note, 'preserve');
    assert.equal(saved.id_99.total, 3);
    assert.ok(first.controls.attempts + second.controls.attempts > 8);
});

test('failed saves leave memory and persisted totals unchanged and show an English error', async () => {
    const { context, controls, shared, elements } = app();
    shared.set(englishPath, {version: 1, data: {id_7: {correct: 3, wrong: 0, total: 3}}});
    await context.loadProgress();
    controls.failWrite = true;
    const buttons = ['りんご', '本'].map(textContent => ({ textContent, disabled: false, classList: { add() {} } }));
    context.document.querySelectorAll = () => buttons;
    vm.runInContext('currentWord = {id:7, front:"apple", back:"りんご"}', context);
    await context.answerQuestion('りんご', buttons[0]);
    assert.equal(shared.get(englishPath).data.id_7.total, 3);
    assert.equal(vm.runInContext('getWordProgress({id:7}).total', context), 3);
    assert.equal(vm.runInContext('sessionCorrect', context), 1);
    assert.match(elements.get('studySaveStatus').textContent, /保存できませんでした/);
    assert.doesNotMatch(elements.get('studySaveStatus').textContent, /write failure/);
});

test('corrupt stored counters are rejected without replacing existing data', async () => {
    const { context, shared, writes } = app();
    shared.set(englishPath, {version: 1, data: {id_7: {correct: 'invalid', total: 10}}});
    await context.loadProgress();
    await assert.rejects(context.recordAnswer(word, true), /Invalid progress count/);
    assert.equal(writes.length, 0);
    assert.equal(shared.get(englishPath).data.id_7.correct, 'invalid');
});

test('a late read from a previous account cannot populate the new account', async () => {
    const { context } = app();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    context.testDb.collection = () => ({doc: () => ({collection: () => ({get: () => pending})})});
    const load = context.loadProgress();
    vm.runInContext('currentUser = {uid:"second-user"}; resetProgressLoad(currentUser)', context);
    release({forEach(callback) { callback({id:'English', data: () => ({id_7:{total:100}})}); }});
    assert.equal(await load, false);
    assert.equal(vm.runInContext('progressLoad.uid', context), 'second-user');
    assert.equal(vm.runInContext('progressLoad.status', context), 'idle');
    assert.equal(vm.runInContext('Object.keys(progress).length', context), 0);
});

test('account change during a transaction read aborts before writing', async () => {
    const { context } = app();
    let release;
    let writes = 0;
    const pending = new Promise(resolve => { release = resolve; });
    context.testDb.runTransaction = callback => callback({get: () => pending, set() { writes++; }});
    const save = context.recordAnswer(word, true);
    vm.runInContext('currentUser = null; resetProgressLoad(null)', context);
    release({exists: false});
    await assert.rejects(save, /not ready/);
    assert.equal(writes, 0);
    assert.equal(vm.runInContext('Object.keys(progress).length', context), 0);
});

test('legacy sanitized genre IDs are used consistently after reload', async () => {
    const { context, shared } = app();
    shared.set('/users/test-user/progress/English_words', {version: 1, data: {id_7:{total:7, correct:7, wrong:0}}});
    await context.loadProgress();
    assert.equal(context.getWordProgress(word, 'English words').total, 7);
    await context.recordAnswer(word, true, 'English words');
    assert.equal(context.getWordProgress(word, 'English words').total, 8);
});

test('loading blocks saving and progress-based modes without treating unknown progress as unlearned', async () => {
    const { context, writes, elements } = app();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    context.testDb.collection = () => ({doc: () => ({collection: () => ({get: () => pending})})});
    const load = context.loadProgress();
    await assert.rejects(context.recordAnswer(word, true), /not ready/);
    vm.runInContext('studySettings.mode = "unlearned"; studyWords = [{id:7,front:"Q",back:"A"}]; beginStudy(); loadProgressSheetList()', context);
    assert.match(elements.get('progressSheetList').textContent, /履歴が読み込まれていません/);
    await context.renderProgress('English');
    assert.equal(writes.length, 0);
    assert.equal(vm.runInContext('currentWord', context), null);
    release({forEach() {}});
    assert.equal(await load, true);
});

test('anonymous use does not access Firestore and can load after linking the same UID', async () => {
    const { context, controls, writes, shared } = app();
    vm.runInContext('currentUser.isAnonymous = true; resetProgressLoad(currentUser)', context);
    const account = context.captureAccountContext();
    controls.failLoad = true;
    assert.equal(await context.loadProgress(), false);
    assert.equal(context.isCurrentAccount(account), true);
    assert.equal(await context.recordAnswer(word, true), false);
    assert.equal(vm.runInContext('progressLoad.status', context), 'disabled');
    assert.equal(writes.length, 0);
    assert.equal(controls.attempts, 0);
    controls.failLoad = false;
    vm.runInContext('currentUser.isAnonymous = false', context);
    assert.equal(await context.loadProgress(), true);
    await context.recordAnswer(word, true);
    assert.equal(shared.get(englishPath).data.id_7.total, 1);
});

function progressUI(context) {
    vm.runInContext('SHEETS = [{title:"English"}]', context);
    context.loadSheets = async () => { vm.runInContext('SHEETS = [{title:"English"}]', context); };
    context.fetchSheetData = async () => [word];
    context.parseSheetData = values => values;
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('A to logout to B clears statistics and session caches immediately and shows only B records', async () => {
    const { context, shared, elements } = app();
    progressUI(context);
    shared.set(englishPath, {version:1, data:{id_7:{correct:8,wrong:1,total:9}}});
    shared.set('/users/B/progress/English', {version:1, data:{id_7:{correct:1,wrong:1,total:2}}});
    await context.loadProgress();
    await context.renderProgress('English');
    assert.equal(elements.get('totalQuestions').textContent, '9');
    vm.runInContext('sessionCorrect=8; sessionAnswered=9; sessionResults=[{correct:true}]; currentWord={id:7};', context);
    context.document.getElementById('result').textContent = 'A result';
    await context.handleAuthStateChanged(null);
    assert.equal(context.currentProgressWords.length, 0);
    assert.equal(elements.get('totalQuestions').textContent, '');
    assert.equal(elements.get('wordProgressList').children.length, 0);
    assert.equal(elements.get('result').textContent, '');
    assert.equal(elements.get('progressPage').style.display, 'none');
    assert.equal(vm.runInContext('sessionResults.length + sessionCorrect + sessionAnswered', context), 0);
    const login = context.handleAuthStateChanged({uid:'B', isAnonymous:false});
    assert.equal(elements.get('progressPage').style.display, 'none');
    assert.equal(context.currentProgressWords.length, 0);
    await login;
    await context.renderProgress('English');
    assert.equal(elements.get('totalQuestions').textContent, '2');
    assert.equal(elements.get('overallAccuracy').textContent, '50%');
    assert.equal(context.currentProgressWords[0].total, 2);
});

test('A to signed out stays empty even when cached sorting and an old draw are requested', async () => {
    const { context, shared, elements } = app();
    progressUI(context);
    shared.set(englishPath, {version:1, data:{id_7:{correct:8,wrong:1,total:9}}});
    await context.loadProgress();
    await context.renderProgress('English');
    await context.handleAuthStateChanged(null);
    context.renderWordProgress();
    await context.renderProgress('English');
    assert.equal(context.currentProgressWords.length, 0);
    for (const id of ['totalQuestions','overallAccuracy','bucket0','bucket5','progressSheetName']) {
        assert.equal(elements.get(id).textContent, '');
    }
    assert.equal(elements.get('homePage').style.display, '');
    assert.equal(elements.get('wordProgressList').children.length, 0);
});

test('an A history load completing after B load cannot repopulate B progress or views', async () => {
    const { context, shared, elements } = app();
    progressUI(context);
    shared.set('/users/B/progress/English', {version:1, data:{id_7:{correct:2,wrong:0,total:2}}});
    const originalCollection = context.testDb.collection;
    const old = deferred();
    context.testDb.collection = () => ({doc: () => ({collection: () => ({get: () => old.promise})})});
    const loadingA = context.loadProgress();
    context.testDb.collection = originalCollection;
    await context.handleAuthStateChanged({uid:'B',isAnonymous:false});
    await context.renderProgress('English');
    old.resolve({forEach(callback) {callback({id:'English',data:()=>({id_7:{total:999}})});}});
    assert.equal(await loadingA, false);
    assert.equal(context.getWordProgress(word).total, 2);
    assert.equal(elements.get('totalQuestions').textContent, '2');
});

test('late A drawing and drawing errors cannot overwrite newer B views or show alerts', async () => {
    for (const fail of [false, true]) {
        const {context, shared, elements, alerts} = app();
        progressUI(context);
        shared.set('/users/B/progress/English',{version:1,data:{id_7:{correct:4,total:4}}});
        const old = deferred();
        context.fetchSheetData = () => old.promise;
        const renderingA = context.renderProgress('English');
        await context.handleAuthStateChanged({uid:'B',isAnonymous:false});
        context.fetchSheetData = async () => [word];
        await context.renderProgress('English');
        if (fail) old.reject(new Error('old request error')); else old.resolve([word]);
        await renderingA;
        assert.equal(elements.get('totalQuestions').textContent,'4');
        assert.equal(context.currentProgressWords[0].total,4);
        assert.equal(alerts.length,0);
    }
});

test('same account reload clears derived views, refreshes them, and invalidates older same-UID results', async () => {
    const {context,shared,elements} = app();
    progressUI(context);
    shared.set(englishPath,{version:1,data:{id_7:{correct:2,total:2}}});
    await context.loadProgress();
    context.showPage('progressPage');
    await context.renderProgress('English');
    const account = context.captureAccountContext();
    shared.set(englishPath,{version:2,data:{id_7:{correct:3,total:3}}});
    const reload = context.loadProgress();
    assert.equal(elements.get('totalQuestions').textContent,'');
    await reload;
    assert.equal(context.isCurrentAccount(account),true);
    assert.equal(elements.get('totalQuestions').textContent,'3');
    assert.equal(elements.get('progressSheetList').children.length,1);
    const old = deferred();
    context.fetchSheetData = () => old.promise;
    const draw = context.renderProgress('English');
    shared.set(englishPath,{version:3,data:{id_7:{correct:5,total:5}}});
    context.fetchSheetData = async () => [word];
    await context.loadProgress();
    await context.renderProgress('English');
    old.resolve([word]);
    await draw;
    assert.equal(elements.get('totalQuestions').textContent,'5');
});

test('overlapping same-account loads keep only the newest server snapshot', async () => {
    const {context} = app();
    const old=deferred(),fresh=deferred();let calls=0;
    context.testDb.collection=()=>({doc:()=>({collection:()=>({get:()=> (++calls===1 ? old : fresh).promise})})});
    const first=context.loadProgress(),second=context.loadProgress();
    fresh.resolve({forEach(cb){cb({id:'English',data:()=>({id_7:{total:4}})});}});
    assert.equal(await second,true);
    old.resolve({forEach(cb){cb({id:'English',data:()=>({id_7:{total:1}})});}});
    assert.equal(await first,false);
    assert.equal(context.getWordProgress(word).total,4);
});

test('after switching accounts answers use B UID and preserve all A records', async () => {
    const {context,shared,writes} = app();progressUI(context);
    shared.set(englishPath,{version:1,data:{id_7:{correct:8,total:8}}});
    await context.loadProgress();
    await context.handleAuthStateChanged(null);
    await context.handleAuthStateChanged({uid:'B',isAnonymous:false});
    await context.recordAnswer(word,true);
    await context.recordHistoryAnswer(history,false);
    assert.equal(shared.get(englishPath).data.id_7.total,8);
    assert.equal(shared.get('/users/B/progress/English').data.id_7.total,1);
    assert.equal(shared.get('/users/B/progress/history_questions').data.history_7.wrong,1);
    assert.ok(writes.every(write=>write.path[0]==='B'));
});

test('late save errors from A do not appear on B screens', async () => {
    const {context,elements} = app();progressUI(context);
    const old=deferred();context.recordAnswer=()=>old.promise;
    const buttons=['りんご','本'].map(textContent=>({textContent,disabled:false,classList:{add(){}}}));
    context.document.querySelectorAll=selector=>selector==='#choices .choice' ? buttons : [];
    vm.runInContext('currentWord={id:7,front:"apple",back:"りんご"}',context);
    const save=context.answerQuestion('りんご',buttons[0]);
    await context.handleAuthStateChanged({uid:'B',isAnonymous:false});
    old.reject(new Error('old save error'));await save;
    assert.equal(elements.get('studySaveStatus').textContent,'');
    assert.equal(elements.get('sessionAccuracy').textContent,'');
});

test('auth callback also clears the real history quiz session before a deferred save can run', async () => {
    const {context, writes, elements}=app();progressUI(context);
    vm.runInContext(readFileSync(new URL('../history_questions.js', import.meta.url),'utf8'),context);
    context.HISTORY_QUESTIONS_CONFIG={spreadsheetId:'test',sheetName:'history_questions',apiKey:'test'};
    context.fetch=async()=>({ok:true,json:async()=>({values:[
        ['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation'],
        ['7','source','A question','A','B','C','D','1','A explanation']
    ]})});
    await context.startHistoryQuiz();
    elements.get('historyChoices').children[0].listeners.click();
    await context.handleAuthStateChanged({uid:'B',isAnonymous:false});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(elements.get('historySummary').textContent,'');
    assert.equal(elements.get('historyResult').textContent,'');
    assert.equal(elements.get('historyChoices').children.length,0);
    assert.equal(elements.get('historyQuiz').style.display,'none');
    assert.equal(writes.length,0);
    context.nextHistoryQuestion();
    assert.equal(elements.get('historySummary').textContent,'');
});

test('late completion of a mocked reset cannot remove B cache or change B display', async () => {
    const {context,shared,elements,alerts}=app();progressUI(context);
    shared.set('/users/B/progress/English',{version:1,data:{id_7:{total:6,correct:6}}});
    const old=deferred();
    const originalCollection=context.testDb.collection;
    context.confirm=()=>true;
    context.testDb.collection=()=>({doc:()=>({collection:()=>({doc:()=>({delete:()=>old.promise})})})});
    const reset=context.resetProgress(); // Only a mock callback; no document is deleted.
    context.testDb.collection=originalCollection;
    await context.handleAuthStateChanged({uid:'B',isAnonymous:false});
    await context.renderProgress('English');
    old.resolve();await reset;
    assert.equal(context.getWordProgress(word).total,6);
    assert.equal(elements.get('totalQuestions').textContent,'6');
    assert.equal(alerts.length,0);
});

test('detached English choices from A cannot submit an answer for B', async () => {
    const {context,writes,elements}=app();progressUI(context);
    const start = () => vm.runInContext(`
        studyWords=[{id:7,front:'apple',back:'りんご'},{id:8,front:'book',back:'本'},
            {id:9,front:'water',back:'水'},{id:10,front:'bird',back:'鳥'}];
        currentIndex=0; currentWord=null; showQuestion();
    `,context);
    start();
    const old=elements.get('choices').children[0];
    await context.handleAuthStateChanged({uid:'B',isAnonymous:false});
    start();old.onclick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(writes.length,0);
    assert.equal(vm.runInContext('sessionAnswered',context),0);
    assert.equal(elements.get('result').textContent,'');
});
