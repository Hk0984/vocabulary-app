import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientCode = fs.readFileSync(path.join(root, 'history_questions.js'), 'utf8');

function makeElement(tagName = 'div') {
    return {
        tagName,
        style: {},
        children: [],
        listeners: {},
        classList: { values: new Set(), add(value) { this.values.add(value); } },
        _text: '',
        replaceChildren(...children) { this.children = children; this._text = ''; },
        appendChild(child) { this.children.push(child); return child; },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        querySelectorAll(selector) {
            return selector === 'button' ? this.children.filter(child => child.tagName === 'button') : [];
        },
        set textContent(value) { this._text = String(value); this.children = []; },
        get textContent() { return this._text; },
    };
}

function makeApp(config = {}) {
    const elements = new Map();
    const document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement(id === 'historyChoices' ? 'div' : 'div'));
            return elements.get(id);
        },
        createElement(tagName) { return makeElement(tagName); },
    };
    const context = { document, console, HISTORY_QUESTIONS_CONFIG: config, showPage() {} };
    context.window = context;
    context.globalThis = context;
    vm.runInNewContext(clientCode, context, { filename: 'history_questions.js' });
    return { context, elements };
}

const headers = ['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation'];
const question = (id, answer = '2') => [id,'source','問題文','選択肢A','選択肢B','選択肢C','選択肢D',answer,'解説文'];

test('parser keeps valid Japanese rows and excludes malformed, invalid-answer, and duplicate rows', () => {
    const { context } = makeApp();
    const parsed = context.HistoryQuestionCore.parseHistoryQuestionValues([
        headers,
        question('q1'),
        question('bad-answer', '5'),
        ['missing','source','問題','','B','C','D','1','解説'],
        ['duplicate-choice','source','問題','同じ','同じ','C','D','1','解説'],
        question('q1'),
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'q1');
    assert.equal(context.HistoryQuestionCore.isCorrect(parsed[0], 2), true);
    assert.equal(context.HistoryQuestionCore.isCorrect(parsed[0], 1), false);
    assert.deepEqual(Array.from(context.HistoryQuestionCore.parseHistoryQuestionValues([['wrong','header']])), []);
});

test('missing connection settings show a setup message without fetching', async () => {
    const { context, elements } = makeApp({});
    let calls = 0;
    context.fetch = async () => { calls += 1; throw new Error('should not fetch'); };
    await context.startHistoryQuiz();
    assert.equal(calls, 0);
    assert.match(elements.get('historyStatus').textContent, /接続設定が必要/);
});

test('empty sheet and malformed sheet data have distinct messages', async () => {
    const config = { spreadsheetId: 'test', sheetName: 'history_questions', apiKey: 'test' };
    const empty = makeApp(config);
    empty.context.fetch = async () => ({ ok: true, json: async () => ({ values: [headers] }) });
    await empty.context.startHistoryQuiz();
    assert.match(empty.elements.get('historyStatus').textContent, /まだありません/);

    const malformed = makeApp(config);
    malformed.context.fetch = async () => ({ ok: true, json: async () => ({ values: [['wrong'], question('q1', '9')] }) });
    await malformed.context.startHistoryQuiz();
    assert.match(malformed.elements.get('historyStatus').textContent, /形式が不正/);
    assert.equal(malformed.elements.get('historyQuiz').style.display, 'none');

    const invalidRows = makeApp(config);
    invalidRows.context.fetch = async () => ({ ok: true, json: async () => ({ values: [headers, question('q1', '9')] }) });
    await invalidRows.context.startHistoryQuiz();
    assert.match(invalidRows.elements.get('historyStatus').textContent, /有効な問題データがありません/);

    const mixed = makeApp(config);
    mixed.context.fetch = async () => ({ ok: true, json: async () => ({ values: [headers, question('q1'), question('bad', '8')] }) });
    await mixed.context.startHistoryQuiz();
    assert.match(mixed.elements.get('historyStatus').textContent, /不正な問題データ 1 件を除外しました/);
    assert.equal(mixed.elements.get('historyChoices').children.length, 4);
});

test('network errors show a retry option and keep details out of the UI', async () => {
    const { context, elements } = makeApp({ spreadsheetId: 'test', sheetName: 'history_questions', apiKey: 'test' });
    context.fetch = async () => { throw new Error('private transport detail'); };
    await context.startHistoryQuiz();
    const status = elements.get('historyStatus');
    assert.match(status.textContent, /取得できませんでした/);
    assert.doesNotMatch(status.textContent, /private transport detail/);
    assert.equal(status.children.at(-1).textContent, '再読み込み');

    const httpError = makeApp({ spreadsheetId: 'test', sheetName: 'history_questions', apiKey: 'test' });
    httpError.context.fetch = async () => ({ ok: false, status: 403 });
    await httpError.context.startHistoryQuiz();
    assert.match(httpError.elements.get('historyStatus').textContent, /取得できませんでした/);
    assert.doesNotMatch(httpError.elements.get('historyStatus').textContent, /403/);
});

test('renders four choices, reveals correctness and explanation after selection, then finishes', async () => {
    const { context, elements } = makeApp({ spreadsheetId: 'test', sheetName: 'history_questions', apiKey: 'test' });
    context.fetch = async () => ({
        ok: true,
        json: async () => ({ values: [headers, question('q1'), question('q2', '1')] }),
    });
    await context.startHistoryQuiz();
    assert.equal(elements.get('historyQuestion').textContent, '問題文');
    assert.equal(elements.get('historyChoices').children.length, 4);
    assert.equal(elements.get('historyResult').textContent, '');
    assert.equal(elements.get('historyChoices').children[1].disabled, undefined);

    elements.get('historyChoices').children[1].listeners.click();
    assert.match(elements.get('historyResult').textContent, /正解です/);
    assert.match(elements.get('historyResult').textContent, /選択肢B/);
    assert.match(elements.get('historyResult').textContent, /解説文/);
    assert.equal(elements.get('historyChoices').children[1].disabled, true);
    assert.equal(elements.get('historyNext').style.display, '');

    context.nextHistoryQuestion();
    assert.equal(elements.get('historyQuestion').textContent, '問題文');
    elements.get('historyChoices').children[0].listeners.click();
    context.nextHistoryQuestion();
    assert.match(elements.get('historyStatus').textContent, /すべての問題を解きました/);
    assert.equal(elements.get('historyQuiz').style.display, 'none');
});
