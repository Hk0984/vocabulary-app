import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function app() {
    const writes = [];
    const ref = { collection() { return this; }, doc(id) { this.path = [...(this.path || []), id]; return this; },
        async set(value, options) { writes.push({ path: this.path, value, options }); this.path = []; } };
    const context = vm.createContext({ document: { addEventListener() {} },
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'timestamp' } } }, testDb: ref });
    vm.runInContext(readFileSync(new URL('../script.js', import.meta.url), 'utf8'), context);
    vm.runInContext('db = testDb; currentUser = { uid: "test-user", isAnonymous: false }; selectedSheet = "English";', context);
    return { context, writes };
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
    const { context, writes } = app();
    vm.runInContext('currentUser.isAnonymous = true', context);
    assert.equal(await vm.runInContext('recordHistoryAnswer({}, true)', context), false);
    vm.runInContext('currentUser = null', context);
    assert.equal(await vm.runInContext('recordHistoryAnswer({}, true)', context), false);
    assert.equal(writes.length, 0);
    vm.runInContext('currentUser = { uid: "test-user" }; db.set = async () => { throw new Error("write failure"); }', context);
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
