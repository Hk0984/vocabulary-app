import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientCode = fs.readFileSync(path.join(root, 'history_questions.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

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
    context.Math = Object.create(Math);
    context.Math.random = () => 0.999;
    vm.runInNewContext(clientCode, context, { filename: 'history_questions.js' });
    return { context, elements };
}

const headers = ['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation'];
const question = (id, answer = '2') => [id,'source','問題文','選択肢A','選択肢B','選択肢C','選択肢D',answer,'解説文'];

test('history entry and quiz reuse the shared question and choice styles', () => {
    assert.match(html, /aria-label="歴史問題を始める">歴史<\/button>/);
    assert.match(html, /class="question-box history-question"/);
    assert.match(html, /id="historyEndActions"/);
    assert.match(clientCode, /button\.className = "choice history-choice"/);
    assert.match(styles, /#choices,\s*\.history-choices/);
    assert.match(styles, /\.choice\.correct/);
    assert.match(styles, /\.choice\.incorrect/);
});

test('seeded shuffling changes question and choice orders while preserving answers and unique IDs', () => {
    const { context } = makeApp();
    const core = context.HistoryQuestionCore;
    const rows = core.parseHistoryQuestionValues([headers, ...Array.from({ length: 12 }, (_, i) => question('q' + i))]);
    const original = JSON.stringify(rows);
    const session = core.createSession(rows, 10, () => 0);
    assert.equal(session.length, 10);
    assert.equal(new Set(session.map(row => row.id)).size, 10);
    assert.notEqual(session[0].id, rows[0].id);
    assert.notEqual(session[0].choices[0].text, rows[0].choice1);
    for (const row of session) {
        assert.equal(row.choices.filter(choice => choice.correct).length, 1);
        assert.equal(row.choices.find(choice => choice.correct).text, row['choice' + row.answer]);
    }
    assert.equal(JSON.stringify(rows), original);
    assert.equal(core.createSession(rows, 30).length, 12);
    assert.equal(core.createSession(rows, 'unlimited').length, 12);
    assert.equal(core.createSession([...rows, rows[0]], 20).length, 12);
});

test('accepts optional explanation, rejects private status columns and non-array records', () => {
    const { context } = makeApp();
    const parse = context.HistoryQuestionCore.parseHistoryQuestionValues;
    const emptyExplanation = question('empty');
    emptyExplanation.pop(); // Sheets omits trailing empty cells.
    assert.equal(parse([headers, emptyExplanation]).length, 1);
    assert.equal(parse([headers, null, {}, [...question('draft'), 'draft']]).length, 0);
    assert.equal(parse([[...headers, 'status'], [...question('private'), 'published']]).length, 0);
});

test('shuffled UI grades once, shows explanation and final counts, and saves history once per answer', async () => {
    const { context, elements } = makeApp({ spreadsheetId: 'test', sheetName: 'history_questions', apiKey: 'test' });
    context.Math.random = () => 0;
    context.document.getElementById('historyCount').value = '20';
    const saved = [];
    context.recordHistoryAnswer = async (row, correct) => { saved.push({ id: row.id, correct }); return true; };
    context.fetch = async () => ({ ok: true, json: async () => ({ values: [headers, question('a'), question('b')] }) });
    await context.startHistoryQuiz();
    context.nextHistoryQuestion(); // Must not advance before answering.
    assert.match(elements.get('historyProgress').textContent, /1 \/ 2/);
    let buttons = elements.get('historyChoices').children;
    const correctButton = buttons.find(button => button.textContent.endsWith('選択肢B'));
    correctButton.listeners.click();
    correctButton.listeners.click();
    assert.match(elements.get('historyResult').textContent, /正解です.*選択肢B\n解説文/);
    assert.ok(correctButton.classList.values.has('correct'));
    context.nextHistoryQuestion();
    buttons = elements.get('historyChoices').children;
    const wrong = buttons.find(button => button.textContent.endsWith('選択肢A'));
    wrong.listeners.click();
    assert.match(elements.get('historyResult').textContent, /不正解です/);
    assert.ok(wrong.classList.values.has('incorrect'));
    context.nextHistoryQuestion();
    context.nextHistoryQuestion(); // Completion also cannot run twice.
    assert.match(elements.get('historySummary').textContent, /出題 2問・正解 1問・不正解 1問（正答率 50%）/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saved.length, 2);
    assert.equal(new Set(saved.map(row => row.id)).size, 2);
});

test('save failures preserve results and a stale fetch cannot overwrite a restarted session', async () => {
    const { context, elements } = makeApp({ spreadsheetId: 'test', sheetName: 'history_questions', apiKey: 'test' });
    let resolveOld;
    context.fetch = () => new Promise(resolve => { resolveOld = resolve; });
    const old = context.startHistoryQuiz();
    context.fetch = async () => ({ ok: true, json: async () => ({ values: [headers, question('new')] }) });
    await context.startHistoryQuiz();
    resolveOld({ ok: true, json: async () => ({ values: [] }) });
    await old;
    assert.equal(elements.get('historyQuiz').style.display, '');
    context.recordHistoryAnswer = async () => { throw new Error('private failure'); };
    elements.get('historyChoices').children[1].listeners.click();
    context.nextHistoryQuestion();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(elements.get('historySaveStatus').textContent, /保存できませんでした/);
    assert.match(elements.get('historySummary').textContent, /正答率 100%/);
});

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
    assert.equal(elements.get('historyEndActions').style.display, 'grid');
});
