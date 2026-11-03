/* History quiz: reads only the dedicated public spreadsheet. */
(function (root) {
    "use strict";

    const HEADERS = [
        "id", "source_id", "question", "choice1", "choice2", "choice3", "choice4",
        "answer", "explanation"
    ];

    function hasExpectedHeaders(values) {
        const current = [...HEADERS, 'period_codes', 'century_codes', 'area_codes', 'time_ranges'];
        return Array.isArray(values) && values.length > 0 && Array.isArray(values[0]) &&
            [HEADERS, current].some(headers => values[0].length === headers.length &&
            headers.every((header, index) => values[0][index] === header));
    }

    function parseHistoryQuestionValues(values) {
        if (!hasExpectedHeaders(values) || values.length < 2) return [];

        const questions = [];
        const headers = values[0];
        const seen = new Set();
        for (const sourceRow of values.slice(1)) {
            if (!Array.isArray(sourceRow)) continue;
            if (sourceRow.some(value => value != null && !["string", "number"].includes(typeof value))) continue;
            let row = Object.fromEntries(headers.map((header, index) => [header, String(sourceRow[index] ?? "")]));
            if (sourceRow.length > headers.length || HEADERS.some(header => header !== "explanation" && !row[header].trim())) continue;
            if (!/^[1-4]$/.test(row.answer)) continue;
            if (new Set([row.choice1, row.choice2, row.choice3, row.choice4].map(c=>c.trim())).size !== 4) continue;
            if (seen.has(row.id)) continue;
            if (headers.length === 9) row = {...row,period_codes:'unclassified',century_codes:'',area_codes:'unclassified',time_ranges:''};
            else {
                try { root.HistoryClassification.validate(row, root.HistoryClassification.master); }
                catch { continue; }
            }
            seen.add(row.id);
            questions.push(row);
        }
        return questions;
    }

    function isCorrect(question, selectedNumber) {
        return Boolean(question) && String(selectedNumber) === question.answer;
    }

    function parseDataset(values, config = {}) {
        if (!hasExpectedHeaders(values)) throw new Error('公開問題のヘッダが不正です。');
        if (config.requireCurrentSchema && values[0].length !== 13) throw new Error('新環境には13列の公開シートが必要です。');
        if (config.expectedIdPrefix) {
            if (!/^hv1_[a-z][a-z0-9_]{1,40}_$/.test(config.expectedIdPrefix)) throw new Error('新環境のID設定が不正です。');
            for (const row of values.slice(1)) {
                if (!Array.isArray(row) || !row.some(v=>v!==''&&v!=null)) continue;
                const id=String(row[0]??'');
                if (!id.startsWith(config.expectedIdPrefix) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('別環境の問題IDが混在しています。');
            }
        }
        return parseHistoryQuestionValues(values);
    }

    function shuffled(items, random = Math.random) {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i -= 1) {
            const j = Math.floor(random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    function createSession(items, count = 10, random = Math.random) {
        const unique = [...new Map(items.map(item => [item.id, item])).values()];
        const limit = count === "unlimited" ? unique.length : Math.max(1, Number(count) || 10);
        return shuffled(unique, random).slice(0, limit).map(question => {
            const choices = shuffled([1, 2, 3, 4].map(number => ({
                text: question["choice" + number], correct: isCorrect(question, number)
            })), random);
            return { ...question, choices };
        });
    }

    root.HistoryQuestionCore = { HEADERS, hasExpectedHeaders, parseHistoryQuestionValues, parseDataset, isCorrect, createSession };
    if (typeof module !== "undefined" && module.exports) module.exports = root.HistoryQuestionCore;

    if (typeof document === "undefined") return;

    let questions = [];
    let currentIndex = 0;
    let answered = false;
    let correctCount = 0;
    let requestId = 0;

    function element(id) { return document.getElementById(id); }

    async function ensureHistoryRegions() {
        const core = root.HistoryClassification;
        if (!core) throw new Error('分類機能を読み込めません。画面を更新してください。');
        if (!core.master) {
            const response = await fetch('./history-regions.json', {cache:'no-store'});
            if (!response.ok) throw new Error('地域マスターを読み込めません。');
            core.setRegions(await response.json());
        }
        return core.master;
    }

    async function loadHistoryQuestions() {
        await ensureHistoryRegions();
        const config = root.HISTORY_QUESTIONS_CONFIG || {};
        if (!config.spreadsheetId || !config.sheetName || !config.apiKey) throw new Error('問題データの接続設定が必要です');
        const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(config.spreadsheetId) +
            '/values/' + encodeURIComponent("'" + config.sheetName + "'") + '?key=' + encodeURIComponent(config.apiKey), {cache:'no-store'});
        if (!response.ok) throw new Error('問題を取得できませんでした。');
        const data = await response.json();
        if (!data || (data.values !== undefined && !Array.isArray(data.values))) throw new Error('公開問題の形式が不正です。');
        if (!data.values?.length) {
            if (config.requireCurrentSchema) throw new Error('新環境の公開シートに13列ヘッダを設定してください。');
            return [];
        }
        if (!hasExpectedHeaders(data?.values)) throw new Error('公開問題の形式が不正です（9列または13列が必要）。');
        return parseDataset(data.values,config);
    }

    function resetHistoryQuiz() {
        requestId += 1;
        questions = [];
        currentIndex = 0;
        answered = false;
        correctCount = 0;
        for (const id of ["historyStatus", "historyProgress", "historyAccuracy", "historyQuestion", "historyChoices", "historyResult", "historyExplanationText", "historySummary", "historySaveStatus"]) {
            const target = element(id);
            if (target) target.textContent = "";
        }
        element("historyExplanation").hidden = true;
        for (const id of ["historyQuiz", "historyNext", "historyEndActions"]) {
            const target = element(id);
            if (target) target.style.display = "none";
        }
    }

    function setStatus(message, retry) {
        const status = element("historyStatus");
        status.replaceChildren();
        status.textContent = message;
        const endActions = element("historyEndActions");
        if (endActions) endActions.style.display = "none";
        if (retry) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "secondary-button history-action";
            button.textContent = "再読み込み";
            button.addEventListener("click", startHistoryQuiz);
            status.appendChild(document.createElement("br"));
            status.appendChild(button);
        }
    }

    async function startHistoryQuiz(options = {}) {
        const thisRequest = ++requestId;
        if (typeof root.showPage === "function") root.showPage("historyPage");
        element("historyQuiz").style.display = "none";
        element("historyEndActions").style.display = "none";
        questions = [];
        currentIndex = 0;
        answered = false;
        correctCount = 0;
        element("historySummary").textContent = "";
        element("historySaveStatus").textContent = "";
        const count = options.count || element("historyCount")?.value || 10;
        const config = root.HISTORY_QUESTIONS_CONFIG || {};
        if (!config.spreadsheetId || !config.sheetName || !config.apiKey) {
            setStatus("問題データの接続設定が必要です", false);
            return;
        }

        setStatus("問題を読み込み中です…", false);
        try {
            if (options.questions) {
                questions = createSession(options.questions, count);
                if (!questions.length) { setStatus('条件に合う問題がありません。学習設定を変更してください。', false); return; }
                element('historyStatus').textContent = root.historySavingNotice?.() || '';
                element('historyQuiz').style.display = '';
                renderQuestion();
                return;
            }
            if (root.HistoryClassification) await ensureHistoryRegions();
            const range = encodeURIComponent("'" + config.sheetName + "'");
            const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(config.spreadsheetId) +
                "/values/" + range + "?key=" + encodeURIComponent(config.apiKey);
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) throw new Error("sheet request failed");
            const data = await response.json();
            if (thisRequest !== requestId) return;
            if (!data || (data.values !== undefined && !Array.isArray(data.values))) {
                setStatus("問題データの形式が不正です。シートの列構成を確認してください。", false);
                return;
            }
            const values = data.values || [];
            if (values.length === 0) {
                if (config.requireCurrentSchema) throw new Error('新環境のヘッダがありません。');
                setStatus("公開用の問題データはまだありません。", false);
                return;
            }
            if (!hasExpectedHeaders(values)) {
                setStatus("問題データの形式が不正です。シートの列構成を確認してください。", false);
                return;
            }
            const sourceRowCount = values.length - 1;
            const validQuestions = parseDataset(values,config);
            questions = createSession(validQuestions, count);
            if (sourceRowCount === 0) {
                setStatus("公開用の問題データはまだありません。", false);
                return;
            }
            if (!questions.length) {
                setStatus("有効な問題データがありません。シートの問題行を確認してください。", false);
                return;
            }
            element("historyStatus").replaceChildren();
            if (validQuestions.length < sourceRowCount) {
                element("historyStatus").textContent =
                    "不正な問題データ " + (sourceRowCount - validQuestions.length) + " 件を除外しました。";
            }
            element("historyQuiz").style.display = "";
            renderQuestion();
        } catch (_) {
            if (thisRequest !== requestId) return;
            setStatus("問題を取得できませんでした。接続設定と公開データを確認してください。", true);
        }
    }

    function renderQuestion() {
        const question = questions[currentIndex];
        answered = false;
        element("historyProgress").textContent = (currentIndex + 1) + " / " + questions.length + " 問";
        updateAccuracy(currentIndex);
        element("historyQuestion").textContent = question.question;
        element("historyResult").textContent = "";
        element("historyExplanation").hidden = true;
        element("historyExplanationText").textContent = "";
        element("historyNext").style.display = "none";
        const choices = element("historyChoices");
        choices.replaceChildren();
        question.choices.forEach((choice, index) => {
            const sessionId = requestId;
            const questionIndex = currentIndex;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "choice history-choice";
            button.textContent = (index + 1) + ". " + choice.text;
            button.addEventListener("click", () => {
                if (sessionId === requestId && questionIndex === currentIndex) answerQuestion(index);
            });
            choices.appendChild(button);
        });
    }

    function answerQuestion(selectedIndex) {
        if (answered || !questions[currentIndex]) return;
        answered = true;
        const question = questions[currentIndex];
        const correct = question.choices[selectedIndex].correct;
        if (correct) correctCount += 1;
        const choiceButtons = element("historyChoices").querySelectorAll("button");
        choiceButtons.forEach((button, index) => {
            button.disabled = true;
            if (question.choices[index].correct) button.classList.add("correct");
            else if (index === selectedIndex) button.classList.add("incorrect");
        });
        element("historyResult").textContent = (correct ? "正解です。" : "不正解です。") +
            " 正解: " + question["choice" + question.answer];
        element("historyExplanationText").textContent = question.explanation;
        element("historyExplanation").hidden = !question.explanation;
        const next = element("historyNext");
        next.textContent = currentIndex + 1 < questions.length ? "次の問題" : "結果を見る";
        next.style.display = "";
        const answeredCount = currentIndex + 1;
        updateAccuracy(answeredCount);
        if (typeof root.recordHistoryAnswer === "function") {
            const sessionId = requestId;
            Promise.resolve().then(() => {
                if (sessionId !== requestId) return;
                return root.recordHistoryAnswer(question, correct);
            }).then(saved => {
                if (sessionId === requestId && !saved) element("historySaveStatus").textContent = "履歴保存にはログインが必要です。";
            }).catch(() => {
                if (sessionId === requestId) element("historySaveStatus").textContent = "履歴を保存できませんでした。今回の成績は画面で確認できます。";
            });
        }
    }

    function updateAccuracy(answeredCount) {
        element("historyAccuracy").textContent = "正答率 " +
            (answeredCount ? Math.round(correctCount / answeredCount * 100) : 0) + "%";
    }

    function nextHistoryQuestion() {
        if (!answered) return;
        answered = false;
        currentIndex += 1;
        if (currentIndex >= questions.length) {
            element("historyQuiz").style.display = "none";
            setStatus("すべての問題を解きました", false);
            element("historySummary").textContent = "学習終了：出題 " + questions.length + "問・正解 " + correctCount +
                "問・不正解 " + (questions.length - correctCount) + "問（正答率 " + Math.round(correctCount / questions.length * 100) + "%）";
            element("historyEndActions").style.display = "grid";
            return;
        }
        renderQuestion();
    }

    root.startHistoryQuiz = startHistoryQuiz;
    root.nextHistoryQuestion = nextHistoryQuestion;
    root.resetHistoryQuiz = resetHistoryQuiz;
    root.loadHistoryQuestions = loadHistoryQuestions;
    root.ensureHistoryRegions = ensureHistoryRegions;
})(typeof window !== "undefined" ? window : globalThis);
