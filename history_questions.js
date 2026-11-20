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

    function createSession(items, count = 10, random = Math.random, order = 'random') {
        const unique = [...new Map(items.map(item => [item.id, item])).values()];
        const limit = count === "unlimited" ? unique.length : Math.max(1, Number(count) || 10);
        const ordered = order === 'registered' ? unique : shuffled(unique, random);
        return ordered.slice(0, limit).map(question => {
            const extra = root.HISTORY_QUIZ_DETAILS?.details;
            const candidate = extra && Object.hasOwn(extra, question.id) ? extra[question.id] : null;
            const optionTexts = [question.choice1, question.choice2, question.choice3, question.choice4];
            const details = candidate && candidate.question === question.question && candidate.answer === question.answer &&
                optionTexts.every((text, index) => text === candidate.choices[index]) ? candidate : null;
            const choices = shuffled(optionTexts.map((text, index) => ({
                text, correct: isCorrect(question, index + 1),
                ...(details && { explanation: details.explanations[index], location: details.locations[index] }),
            })), random);
            return { ...question, choices, ...(details?.kind && { mapKind: details.kind }) };
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
    let detailsRequest;

    function element(id) { return document.getElementById(id); }

    function textElement(tag, text) {
        const node = document.createElement(tag);
        node.textContent = text;
        return node;
    }

    function svgElement(tag, attributes) {
        const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
        return node;
    }

    function longitudeNear(longitude, reference) {
        return longitude + 360 * Math.round((reference - longitude) / 360);
    }

    function mapProjection(locations) {
        const longitudes = locations.map(({ point }) => point[0]).sort((a, b) => a - b);
        let gap = -1;
        let reference = longitudes[0];
        longitudes.forEach((longitude, index) => {
            const next = longitudes[index + 1] ?? longitudes[0] + 360;
            if (next - longitude > gap) {
                gap = next - longitude;
                reference = next + (360 - gap) / 2;
            }
        });
        const bounds = locations.map(({ point: [lon, lat], box }) => {
            const shifted = longitudeNear(lon, reference);
            const offset = shifted - lon;
            return box ? [box[0] + offset, box[1], box[2] + offset, box[3]] : [shifted, lat, shifted, lat];
        });
        const west = Math.min(...bounds.map(box => box[0]));
        const south = Math.min(...bounds.map(box => box[1]));
        const east = Math.max(...bounds.map(box => box[2]));
        const north = Math.max(...bounds.map(box => box[3]));
        const centerLon = (west + east) / 2;
        const centerLat = (south + north) / 2;
        const factor = Math.max(0.35, Math.cos(centerLat * Math.PI / 180));
        const scale = Math.min(550 / Math.max((east - west) * factor, 5), 248 / Math.max(north - south, 3));
        return {
            centerLon,
            project: ([lon, lat], offset = 0) => [320 + (lon + offset - centerLon) * scale * factor, 150 - (lat - centerLat) * scale],
        };
    }

    function visibleMapPath(rings, projection) {
        const paths = [];
        for (const ring of rings) {
            const middleOffset = longitudeNear(ring[0][0], projection.centerLon) - ring[0][0];
            for (const offset of [middleOffset - 360, middleOffset, middleOffset + 360]) {
                const points = ring.map(point => projection.project(point, offset));
                if (points.every(([x]) => x < 0) || points.every(([x]) => x > 640) ||
                    points.every(([, y]) => y < 0) || points.every(([, y]) => y > 300)) continue;
                paths.push("M" + points.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join("L") + "Z");
            }
        }
        return paths.join("");
    }

    function renderMap(question, selectedIndex = null) {
        const target = element("historyMap");
        if (!target) return;
        target.hidden = true;
        target.replaceChildren();
        if (!question.mapKind) return;
        const atlas = root.HISTORY_QUIZ_DETAILS.atlas;
        const byCode = new Map(atlas.filter(([code]) => /^[A-Z]{3}$/.test(code)).map(entry => [entry[0], entry]));
        const locations = question.choices.map(choice => {
            if (question.mapKind === "point") return { point: choice.location };
            const [, point, box] = byCode.get(choice.location);
            return { point, box };
        });
        const projection = mapProjection(locations);
        const caption = textElement("figcaption", selectedIndex === null ? "白地図（現在の地図）" : "位置の確認（現在の地図）");
        const svg = svgElement("svg", { viewBox: "0 0 640 300", "aria-hidden": "true" });
        const legend = document.createElement("ul");
        const revealed = new Map();
        if (selectedIndex !== null) {
            question.choices.forEach((choice, index) => {
                if (choice.correct || index === selectedIndex) {
                    const result = choice.correct ? "correct" : "incorrect";
                    revealed.set(index, result);
                    const item = textElement("li", (index + 1) + ". " + choice.text + (choice.correct ? "（正解）" : "（選んだ答え）"));
                    item.className = "history-map-" + result;
                    legend.appendChild(item);
                }
            });
        }
        const highlighted = new Map();
        if (question.mapKind === "country") {
            for (const [index, result] of revealed) highlighted.set(question.choices[index].location, result);
        }
        const highlights = [];
        for (const [code, , , rings] of atlas) {
            const path = visibleMapPath(rings, projection);
            if (!path) continue;
            const result = highlighted.get(code);
            const shape = svgElement("path", { d: path, "fill-rule": "evenodd", class: result ? "history-map-" + result : "history-map-land" });
            if (result) highlights.push(shape);
            else svg.appendChild(shape);
        }
        highlights.forEach(shape => svg.appendChild(shape));
        for (const [index, result] of revealed) {
            const [lon, lat] = locations[index].point;
            const [x, y] = projection.project([longitudeNear(lon, projection.centerLon), lat]);
            const pin = svgElement("g", { class: "history-map-" + result });
            pin.appendChild(svgElement("circle", { cx: x, cy: y, r: 15 }));
            const number = svgElement("text", { x, y, "text-anchor": "middle", "dominant-baseline": "central" });
            number.textContent = index + 1;
            pin.appendChild(number);
            svg.appendChild(pin);
        }
        const source = textElement("small", "地図データ Natural Earth / QGIS");
        target.appendChild(caption);
        target.appendChild(svg);
        if (revealed.size) target.appendChild(legend);
        target.appendChild(source);
        target.hidden = false;
    }

    function clearReview() {
        for (const id of ["historyWrongExplanation", "historyMap"]) {
            const target = element(id);
            if (target) {
                target.hidden = true;
                target.replaceChildren();
            }
        }
    }

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

    async function ensureHistoryQuizDetails() {
        if (!root.HISTORY_QUIZ_DETAILS_ASSET || root.HISTORY_QUIZ_DETAILS) return;
        detailsRequest ??= (async () => {
            try {
                const response = await fetch('./history-quiz-details.json', { signal: AbortSignal.timeout?.(5000) });
                if (!response.ok) return;
                const payload = await response.json();
                if (payload?.details && typeof payload.details === "object" && Array.isArray(payload.atlas)) {
                    root.HISTORY_QUIZ_DETAILS = payload;
                }
            } catch {
                // Preserve access to the base questions if the optional asset is unavailable.
            }
        })();
        await detailsRequest;
        detailsRequest = undefined;
    }

    async function loadHistoryQuestions() {
        await Promise.all([ensureHistoryRegions(), ensureHistoryQuizDetails()]);
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
        clearReview();
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
                questions = createSession(options.questions, count, Math.random, options.order);
                if (!questions.length) { setStatus('条件に合う問題がありません。学習設定を変更してください。', false); return; }
                element('historyStatus').textContent = root.historySavingNotice?.() || '';
                element('historyQuiz').style.display = '';
                renderQuestion();
                return;
            }
            if (root.HistoryClassification) await ensureHistoryRegions();
            if (root.HISTORY_QUIZ_DETAILS_ASSET) await ensureHistoryQuizDetails();
            if (thisRequest !== requestId) return;
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
            questions = createSession(validQuestions, count, Math.random, options.order);
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
        clearReview();
        renderMap(question);
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
        const rightExplanation = question.choices.find(choice => choice.correct).explanation;
        const explanations = [...new Set([rightExplanation, question.explanation].filter(Boolean))];
        element("historyExplanationText").textContent = explanations.join("\n\n");
        element("historyExplanation").hidden = !explanations.length;
        const wrong = question.choices[selectedIndex];
        if (!correct && wrong.explanation) {
            const feedback = element("historyWrongExplanation");
            feedback.appendChild(textElement("h3", "選んだ答え · " + wrong.text));
            feedback.appendChild(textElement("p", wrong.explanation));
            feedback.hidden = false;
        }
        if (question.mapKind) renderMap(question, selectedIndex);
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
