/* Independent history quiz. It never reads the private Bot spreadsheet or writes progress. */
(function (root) {
    "use strict";

    const HEADERS = [
        "id", "source_id", "question", "choice1", "choice2", "choice3", "choice4",
        "answer", "explanation"
    ];

    function hasExpectedHeaders(values) {
        return Array.isArray(values) && values.length > 0 && Array.isArray(values[0]) &&
            values[0].length === HEADERS.length &&
            HEADERS.every((header, index) => String(values[0][index] || "").trim() === header);
    }

    function parseHistoryQuestionValues(values) {
        if (!hasExpectedHeaders(values) || values.length < 2) return [];

        const questions = [];
        const seen = new Set();
        for (const sourceRow of values.slice(1)) {
            if (!Array.isArray(sourceRow)) continue;
            const row = Object.fromEntries(HEADERS.map((header, index) => [header, String(sourceRow[index] ?? "").trim()]));
            if (sourceRow.length > HEADERS.length || HEADERS.some(header => !row[header])) continue;
            if (!/^[1-4]$/.test(row.answer)) continue;
            if (new Set([row.choice1, row.choice2, row.choice3, row.choice4]).size !== 4) continue;
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            questions.push(row);
        }
        return questions;
    }

    function isCorrect(question, selectedNumber) {
        return Boolean(question) && String(selectedNumber) === question.answer;
    }

    root.HistoryQuestionCore = { HEADERS, hasExpectedHeaders, parseHistoryQuestionValues, isCorrect };
    if (typeof module !== "undefined" && module.exports) module.exports = root.HistoryQuestionCore;

    if (typeof document === "undefined") return;

    let questions = [];
    let currentIndex = 0;
    let answered = false;

    function element(id) { return document.getElementById(id); }

    function setStatus(message, retry) {
        const status = element("historyStatus");
        status.replaceChildren();
        status.textContent = message;
        if (retry) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "history-next";
            button.textContent = "再読み込み";
            button.addEventListener("click", startHistoryQuiz);
            status.appendChild(document.createElement("br"));
            status.appendChild(button);
        }
    }

    async function startHistoryQuiz() {
        if (typeof root.showPage === "function") root.showPage("historyPage");
        element("historyQuiz").style.display = "none";
        questions = [];
        currentIndex = 0;
        const config = root.HISTORY_QUESTIONS_CONFIG || {};
        if (!config.spreadsheetId || !config.sheetName || !config.apiKey) {
            setStatus("問題データの接続設定が必要です", false);
            return;
        }

        setStatus("問題を読み込み中です…", false);
        try {
            const range = encodeURIComponent("'" + config.sheetName + "'");
            const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(config.spreadsheetId) +
                "/values/" + range + "?key=" + encodeURIComponent(config.apiKey);
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) throw new Error("sheet request failed");
            const data = await response.json();
            if (!data || (data.values !== undefined && !Array.isArray(data.values))) {
                setStatus("問題データの形式が不正です。シートの列構成を確認してください。", false);
                return;
            }
            const values = data.values || [];
            if (values.length === 0) {
                setStatus("公開用の問題データはまだありません。", false);
                return;
            }
            if (!hasExpectedHeaders(values)) {
                setStatus("問題データの形式が不正です。シートの列構成を確認してください。", false);
                return;
            }
            const sourceRowCount = values.length - 1;
            questions = parseHistoryQuestionValues(values);
            if (sourceRowCount === 0) {
                setStatus("公開用の問題データはまだありません。", false);
                return;
            }
            if (!questions.length) {
                setStatus("有効な問題データがありません。シートの問題行を確認してください。", false);
                return;
            }
            element("historyStatus").replaceChildren();
            if (questions.length < sourceRowCount) {
                element("historyStatus").textContent =
                    "不正な問題データ " + (sourceRowCount - questions.length) + " 件を除外しました。";
            }
            element("historyQuiz").style.display = "";
            renderQuestion();
        } catch (_) {
            setStatus("問題を取得できませんでした。接続設定と公開データを確認してください。", true);
        }
    }

    function renderQuestion() {
        const question = questions[currentIndex];
        answered = false;
        element("historyProgress").textContent = (currentIndex + 1) + " / " + questions.length + " 問";
        element("historyQuestion").textContent = question.question;
        element("historyResult").textContent = "";
        element("historyNext").style.display = "none";
        const choices = element("historyChoices");
        choices.replaceChildren();
        for (let number = 1; number <= 4; number += 1) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "history-choice";
            button.textContent = number + ". " + question["choice" + number];
            button.addEventListener("click", () => answerQuestion(number));
            choices.appendChild(button);
        }
    }

    function answerQuestion(selectedNumber) {
        if (answered) return;
        answered = true;
        const question = questions[currentIndex];
        const correct = isCorrect(question, selectedNumber);
        const choiceButtons = element("historyChoices").querySelectorAll("button");
        choiceButtons.forEach((button, index) => {
            const number = index + 1;
            button.disabled = true;
            if (number === Number(question.answer)) button.classList.add("correct");
            else if (number === selectedNumber) button.classList.add("incorrect");
        });
        element("historyResult").textContent = (correct ? "正解です。" : "不正解です。") +
            " 正解: " + question["choice" + question.answer] + "\n" + question.explanation;
        const next = element("historyNext");
        next.textContent = currentIndex + 1 < questions.length ? "次の問題" : "結果を見る";
        next.style.display = "";
    }

    function nextHistoryQuestion() {
        if (!answered) return;
        currentIndex += 1;
        if (currentIndex >= questions.length) {
            element("historyQuiz").style.display = "none";
            setStatus("すべての問題を解きました", false);
            return;
        }
        renderQuestion();
    }

    root.startHistoryQuiz = startHistoryQuiz;
    root.nextHistoryQuestion = nextHistoryQuestion;
})(typeof window !== "undefined" ? window : globalThis);
