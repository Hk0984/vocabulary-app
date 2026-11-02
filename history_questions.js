/* History quiz: reads only the dedicated public spreadsheet. */
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
            if (sourceRow.some(value => value != null && !["string", "number"].includes(typeof value))) continue;
            const row = Object.fromEntries(HEADERS.map((header, index) => [header, String(sourceRow[index] ?? "").trim()]));
            if (sourceRow.length > HEADERS.length || HEADERS.some(header => header !== "explanation" && !row[header])) continue;
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

    root.HistoryQuestionCore = { HEADERS, hasExpectedHeaders, parseHistoryQuestionValues, isCorrect, createSession };
    if (typeof module !== "undefined" && module.exports) module.exports = root.HistoryQuestionCore;

    if (typeof document === "undefined") return;

    let questions = [];
    let currentIndex = 0;
    let answered = false;
    let correctCount = 0;
    let requestId = 0;

    function element(id) { return document.getElementById(id); }

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

    async function startHistoryQuiz() {
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
        const count = element("historyCount").value || 10;
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
            if (thisRequest !== requestId) return;
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
            const validQuestions = parseHistoryQuestionValues(values);
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
        element("historyQuestion").textContent = question.question;
        element("historyResult").textContent = "";
        element("historyNext").style.display = "none";
        const choices = element("historyChoices");
        choices.replaceChildren();
        question.choices.forEach((choice, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "choice history-choice";
            button.textContent = (index + 1) + ". " + choice.text;
            button.addEventListener("click", () => answerQuestion(index));
            choices.appendChild(button);
        });
    }

    function answerQuestion(selectedIndex) {
        if (answered) return;
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
            " 正解: " + question["choice" + question.answer] + "\n" + question.explanation;
        const next = element("historyNext");
        next.textContent = currentIndex + 1 < questions.length ? "次の問題" : "結果を見る";
        next.style.display = "";
        const answeredCount = currentIndex + 1;
        element("historySummary").textContent = "回答済み " + answeredCount + " / " + questions.length +
            "問・正答率 " + Math.round(correctCount / answeredCount * 100) + "%";
        if (typeof root.recordHistoryAnswer === "function") {
            const sessionId = requestId;
            Promise.resolve().then(() => root.recordHistoryAnswer(question, correct)).then(saved => {
                if (sessionId === requestId && !saved) element("historySaveStatus").textContent = "履歴保存にはログインが必要です。";
            }).catch(() => {
                if (sessionId === requestId) element("historySaveStatus").textContent = "履歴を保存できませんでした。今回の成績は画面で確認できます。";
            });
        }
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
})(typeof window !== "undefined" ? window : globalThis);
