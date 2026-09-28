// ========================================
// Googleスプレッドシート設定
// ========================================

const SHEET_ID =
    "1AB15tNzU9n5yjjcHRhsYDfFZ2ftJ0CpXI2df2UetU6Q";


// ========================================
// シート一覧
// ========================================

const SHEETS = [

    {
        name: "英単語",
        gid: "0"
    },

    {
        name: "試験",
        gid: "1012106076"
    }

];


// ========================================
// 単語データ
// ========================================

let words = [];


// ========================================
// 現在選択しているシート
// ========================================

let selectedSheet = null;


// ========================================
// 学習状況を表示しているシート
// ========================================

let progressSheet = null;


// ========================================
// 学習履歴
// ========================================

let progress = {};

let totalQuestions = 0;

let currentStreak = 0;

let bestStreak = 0;


// ========================================
// 現在の問題
// ========================================

let currentWord = null;

let answered = false;


// ========================================
// 学習設定
// ========================================

let studySettings = {

    mode: "normal",

    format: "enToJa",

    count: 10

};


// ========================================
// 現在のセッション
// ========================================

let sessionWords = [];

let sessionQuestionCount = 0;

let sessionCorrect = 0;

let sessionFinished = false;


// ========================================
// セッション中に間違えた単語
// ========================================

let sessionWrongWords = [];


// ========================================
// 直近に出題した単語
// ========================================

let recentWordIds = [];

const RECENT_WORD_LIMIT = 3;


// ========================================
// 復習前の問題数設定
// ========================================

let reviewOriginalCount = undefined;


// ========================================
// 学習状況で表示している単語一覧
// ========================================

let progressSheetWords = [];


// ========================================
// ページ切り替え
// ========================================

function showPage(pageId) {

    document.getElementById("sheetPage").style.display =
        "none";

    document.getElementById("settingsPage").style.display =
        "none";

    document.getElementById("studyPage").style.display =
        "none";

    document.getElementById("progressPage").style.display =
        "none";


    document.getElementById(pageId).style.display =
        "block";


    if (pageId === "progressPage") {

        renderProgressSheetList();


        if (progressSheet) {

            selectProgressSheet(
                progressSheet
            );

        }

        else if (selectedSheet) {

            selectProgressSheet(
                selectedSheet
            );

        }

    }

}


// ========================================
// シート一覧を表示
// ========================================

function renderSheetList() {

    const container =
        document.getElementById("sheetList");


    container.innerHTML = "";


    SHEETS.forEach(sheet => {

        const button =
            document.createElement("button");


        button.className =
            "sheet-option";


        button.textContent =
            sheet.name;


        button.onclick =
            () =>
                selectSheet(
                    sheet,
                    button
                );


        container.appendChild(button);

    });

}


// ========================================
// シートを選択
// ========================================

function selectSheet(sheet, button) {

    selectedSheet =
        sheet;


    document
        .querySelectorAll("#sheetList .sheet-option")
        .forEach(option => {

            option.classList.remove(
                "selected"
            );

        });


    button.classList.add(
        "selected"
    );


    document.getElementById(
        "startButton"
    ).disabled =
        false;

}


// ========================================
// 学習開始
// ========================================

async function startStudy() {

    if (!selectedSheet) {

        return;

    }


    words = [];

    currentWord = null;

    answered = false;

    sessionWords = [];

    sessionWrongWords = [];

    recentWordIds = [];

    sessionQuestionCount = 0;

    sessionCorrect = 0;

    sessionFinished = false;

    reviewOriginalCount = undefined;


    document.getElementById(
        "currentSheetName"
    ).textContent =
        selectedSheet.name;


    loadProgress();


    document.getElementById(
        "question"
    ).textContent =
        "読み込み中...";


    document.getElementById(
        "choices"
    ).innerHTML =
        "";


    document.getElementById(
        "result"
    ).textContent =
        "";


    document.getElementById(
        "beginStudyButton"
    ).disabled =
        true;


    document.getElementById(
        "settingsMessage"
    ).textContent =
        "単語データを読み込んでいます...";


    showPage(
        "settingsPage"
    );


    await loadWords();

}


// ========================================
// Googleスプレッドシートから読み込み
// ========================================

async function loadWords() {

    try {

        const url =
            `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${selectedSheet.gid}`;


        const response =
            await fetch(url);


        if (!response.ok) {

            throw new Error(
                "スプレッドシートを読み込めませんでした。"
            );

        }


        const csvText =
            await response.text();


        words =
            parseCSV(csvText);


        if (words.length < 4) {

            throw new Error(
                "このシートの単語が4個未満です。4択問題には最低4単語必要です。"
            );

        }


        console.log(
            `${selectedSheet.name}: ${words.length}個の単語を読み込みました。`
        );


        document.getElementById(
            "beginStudyButton"
        ).disabled =
            false;


        updateSettingsMessage();


    }

    catch (error) {

        console.error(error);


        document.getElementById(
            "settingsMessage"
        ).textContent =
            error.message;


        document.getElementById(
            "beginStudyButton"
        ).disabled =
            true;

    }

}


// ========================================
// CSVを解析する
// ========================================

function parseCSV(csvText) {

    csvText =
        csvText.replace(
            /^\uFEFF/,
            ""
        );


    const lines =
        csvText
            .trim()
            .split(/\r?\n/);


    if (lines.length < 2) {

        return [];

    }


    const headers =
        parseCSVLine(lines[0])
            .map(
                header =>
                    header.trim()
            );


    const idIndex =
        headers.indexOf("id");


    const wordIndex =
        headers.indexOf("word");


    const meaningIndex =
        headers.indexOf("meaning");


    if (
        idIndex === -1 ||
        wordIndex === -1 ||
        meaningIndex === -1
    ) {

        throw new Error(
            "シートには id, word, meaning の列が必要です。"
        );

    }


    const result = [];


    for (
        let i = 1;
        i < lines.length;
        i++
    ) {

        if (
            lines[i].trim() === ""
        ) {

            continue;

        }


        const columns =
            parseCSVLine(lines[i]);


        const id =
            columns[idIndex]?.trim();


        const word =
            columns[wordIndex]?.trim();


        const meaning =
            columns[meaningIndex]?.trim();


        if (
            !id ||
            !word ||
            !meaning
        ) {

            continue;

        }


        result.push({

            id: id,

            word: word,

            meaning: meaning

        });

    }


    return result;

}


// ========================================
// CSV 1行を解析
// ========================================

function parseCSVLine(line) {

    const result = [];

    let current = "";

    let insideQuotes = false;


    for (
        let i = 0;
        i < line.length;
        i++
    ) {

        const char =
            line[i];


        if (
            char === '"'
        ) {

            if (
                insideQuotes &&
                line[i + 1] === '"'
            ) {

                current += '"';

                i++;

            }

            else {

                insideQuotes =
                    !insideQuotes;

            }

        }

        else if (
            char === "," &&
            !insideQuotes
        ) {

            result.push(
                current
            );

            current = "";

        }

        else {

            current += char;

        }

    }


    result.push(
        current
    );


    return result;

}


// ========================================
// 学習履歴を読み込む
// ========================================

function loadProgress() {

    if (!selectedSheet) {

        return;

    }


    loadProgressForSheet(
        selectedSheet
    );

}


// ========================================
// 指定したシートの履歴を読み込む
// ========================================

function loadProgressForSheet(sheet) {

    if (!sheet) {

        return;

    }


    const progressKey =
        `vocabProgress_${sheet.gid}`;


    const savedProgress =
        localStorage.getItem(
            progressKey
        );


    progress =
        savedProgress
            ? JSON.parse(savedProgress)
            : {};


    totalQuestions =
        Number(
            localStorage.getItem(
                `totalQuestions_${sheet.gid}`
            )
        ) || 0;


    currentStreak =
        Number(
            localStorage.getItem(
                `currentStreak_${sheet.gid}`
            )
        ) || 0;


    bestStreak =
        Number(
            localStorage.getItem(
                `bestStreak_${sheet.gid}`
            )
        ) || 0;

}


// ========================================
// 学習設定
// ========================================

function selectSetting(button) {

    const setting =
        button.dataset.setting;

    const value =
        button.dataset.value;


    document
        .querySelectorAll(
            `.setting-option[data-setting="${setting}"]`
        )
        .forEach(option => {

            option.classList.remove(
                "selected"
            );

        });


    button.classList.add(
        "selected"
    );


    if (setting === "mode") {

        studySettings.mode =
            value;

    }


    if (setting === "format") {

        studySettings.format =
            value;

    }


    if (setting === "count") {

        studySettings.count =
            value === "unlimited"
                ? "unlimited"
                : Number(value);

    }


    updateSettingsMessage();

}


// ========================================
// 設定内容
// ========================================

function updateSettingsMessage() {

    const message =
        document.getElementById(
            "settingsMessage"
        );


    if (!words.length) {

        message.textContent =
            "単語データを読み込んでいます...";

        return;

    }


    const targetWords =
        getTargetWords();


    if (targetWords.length === 0) {

        message.textContent =
            "この条件に該当する単語がありません。";

        return;

    }


    message.textContent =
        `${targetWords.length}個の単語が対象です。`;

}


// ========================================
// 学習開始
// ========================================

function beginStudy() {

    if (!selectedSheet) {

        return;

    }


    sessionWords =
        getTargetWords();


    if (sessionWords.length === 0) {

        document.getElementById(
            "settingsMessage"
        ).textContent =
            "この条件に該当する単語がありません。";

        return;

    }


    sessionQuestionCount = 0;

    sessionCorrect = 0;

    sessionWrongWords = [];

    recentWordIds = [];

    sessionFinished = false;

    reviewOriginalCount = undefined;


    document.getElementById(
        "currentSheetName"
    ).textContent =
        selectedSheet.name;


    document.getElementById(
        "nextButton"
    ).textContent =
        "次の問題";


    document.getElementById(
        "reviewButton"
    ).style.display =
        "none";


    showPage(
        "studyPage"
    );


    updateSessionInfo();

    newQuestion();

}


// ========================================
// 出題対象
// ========================================

function getTargetWords() {

    if (!words.length) {

        return [];

    }


    if (
        studySettings.mode ===
        "normal"
    ) {

        return [...words];

    }


    if (
        studySettings.mode ===
        "unlearned"
    ) {

        return words.filter(word => {

            return !progress[word.id];

        });

    }


    if (
        studySettings.mode ===
        "incorrect"
    ) {

        return words.filter(word => {

            const data =
                progress[word.id];

            return (
                data &&
                data.incorrect > 0
            );

        });

    }


    if (
        studySettings.mode ===
        "weak"
    ) {

        return words.filter(word => {

            const data =
                progress[word.id];

            if (!data) {

                return false;

            }


            const answeredCount =
                data.correct +
                data.incorrect;


            if (answeredCount === 0) {

                return false;

            }


            const incorrectRate =
                data.incorrect /
                answeredCount *
                100;


            return incorrectRate >= 41;

        });

    }


    return [...words];

}


// ========================================
// 単語の出題重み
// ========================================
//
// 誤答率が高いほど出題されやすくする
//
// 未学習       → 2倍
// 誤答率 0-20 → 1倍
// 誤答率 21-40 → 1.5倍
// 誤答率 41-60 → 2倍
// 誤答率 61-80 → 3倍
// 誤答率 81-100 → 4倍
//

function getWordWeight(word) {

    const data =
        progress[word.id];


    if (!data) {

        return 2;

    }


    const answeredCount =
        data.correct +
        data.incorrect;


    if (answeredCount === 0) {

        return 2;

    }


    const incorrectRate =
        data.incorrect /
        answeredCount *
        100;


    if (incorrectRate <= 20) {

        return 1;

    }


    if (incorrectRate <= 40) {

        return 1.5;

    }


    if (incorrectRate <= 60) {

        return 2;

    }


    if (incorrectRate <= 80) {

        return 3;

    }


    return 4;

}


// ========================================
// 次に出す単語を選ぶ
// ========================================

function selectNextWord() {

    if (
        sessionWords.length === 0
    ) {

        return null;

    }


    // 直近3問を除外

    let candidates =
        sessionWords.filter(word => {

            return !recentWordIds.includes(
                word.id
            );

        });


    // 候補がなくなったら
    // 全単語を候補に戻す

    if (
        candidates.length === 0
    ) {

        candidates =
            [...sessionWords];

    }


    // ========================================
    // 重み付きランダム抽選
    // ========================================

    const totalWeight =
        candidates.reduce(
            (sum, word) =>
                sum +
                getWordWeight(word),
            0
        );


    let random =
        Math.random() *
        totalWeight;


    let selected =
        candidates[
            candidates.length - 1
        ];


    for (
        const word of candidates
    ) {

        random -=
            getWordWeight(word);


        if (random <= 0) {

            selected =
                word;

            break;

        }

    }


    // 直近出題履歴に追加

    recentWordIds.push(
        selected.id
    );


    if (
        recentWordIds.length >
        RECENT_WORD_LIMIT
    ) {

        recentWordIds.shift();

    }


    return selected;

}


// ========================================
// 問題作成
// ========================================

function newQuestion() {

    if (
        sessionWords.length === 0
    ) {

        return;

    }


    answered = false;


    document.getElementById(
        "result"
    ).textContent =
        "";


    document.getElementById(
        "nextButton"
    ).style.display =
        "none";


    document.getElementById(
        "reviewButton"
    ).style.display =
        "none";


    currentWord =
        selectNextWord();


    if (!currentWord) {

        return;

    }


    if (
        studySettings.format ===
        "enToJa"
    ) {

        document.getElementById(
            "questionType"
        ).textContent =
            "英語 → 日本語";


        document.getElementById(
            "question"
        ).textContent =
            currentWord.word;

    }

    else {

        document.getElementById(
            "questionType"
        ).textContent =
            "日本語 → 英語";


        document.getElementById(
            "question"
        ).textContent =
            currentWord.meaning;

    }


    createChoices();

}


// ========================================
// 選択肢
// ========================================

function createChoices() {

    let choices =
        [currentWord];


    const otherWords =
        words.filter(
            word =>
                word.id !==
                currentWord.id
        );


    otherWords.sort(
        () =>
            Math.random() - 0.5
    );


    choices.push(
        ...otherWords.slice(0, 3)
    );


    choices.sort(
        () =>
            Math.random() - 0.5
    );


    const container =
        document.getElementById(
            "choices"
        );


    container.innerHTML =
        "";


    choices.forEach(word => {

        const button =
            document.createElement(
                "button"
            );


        button.className =
            "choice";


        if (
            studySettings.format ===
            "enToJa"
        ) {

            button.textContent =
                word.meaning;

        }

        else {

            button.textContent =
                word.word;

        }


        button.onclick =
            () =>
                answer(
                    word,
                    button
                );


        container.appendChild(
            button
        );

    });

}


// ========================================
// 回答
// ========================================

function answer(
    selectedWord,
    selectedButton
) {

    if (
        answered ||
        sessionFinished
    ) {

        return;

    }


    answered = true;


    const isCorrect =
        selectedWord.id ===
        currentWord.id;


    if (
        !progress[currentWord.id]
    ) {

        progress[currentWord.id] = {

            correct: 0,

            incorrect: 0

        };

    }


    if (isCorrect) {

        progress[
            currentWord.id
        ].correct++;


        currentStreak++;

        sessionCorrect++;


        if (
            currentStreak >
            bestStreak
        ) {

            bestStreak =
                currentStreak;

        }


        selectedButton.classList.add(
            "correct"
        );


        document.getElementById(
            "result"
        ).textContent =
            "正解！";

    }

    else {

        progress[
            currentWord.id
        ].incorrect++;


        currentStreak = 0;


        if (
            !sessionWrongWords.some(
                word =>
                    word.id ===
                    currentWord.id
            )
        ) {

            sessionWrongWords.push(
                currentWord
            );

        }


        selectedButton.classList.add(
            "wrong"
        );


        document.getElementById(
            "result"
        ).textContent =
            studySettings.format === "enToJa"
                ? `不正解。正解は「${currentWord.meaning}」です。`
                : `不正解。正解は「${currentWord.word}」です。`;

    }


    totalQuestions++;

    sessionQuestionCount++;


    document
        .querySelectorAll(".choice")
        .forEach(button => {

            const correctText =
                studySettings.format === "enToJa"
                    ? currentWord.meaning
                    : currentWord.word;


            if (
                button.textContent ===
                correctText
            ) {

                button.classList.add(
                    "correct"
                );

            }


            button.disabled = true;

        });


    saveProgress();

    updateSessionInfo();


    if (
        studySettings.count !==
        "unlimited" &&
        sessionQuestionCount >=
        studySettings.count
    ) {

        finishStudy();

    }

    else {

        document.getElementById(
            "nextButton"
        ).style.display =
            "inline-block";

    }

}


// ========================================
// セッション情報
// ========================================

function updateSessionInfo() {

    const progressElement =
        document.getElementById(
            "sessionProgress"
        );


    const accuracyElement =
        document.getElementById(
            "sessionAccuracy"
        );


    if (
        studySettings.count ===
        "unlimited"
    ) {

        progressElement.textContent =
            `${sessionQuestionCount}問`;

    }

    else {

        progressElement.textContent =
            `${sessionQuestionCount} / ${studySettings.count}問`;

    }


    const accuracy =
        sessionQuestionCount > 0
            ? Math.round(
                sessionCorrect /
                sessionQuestionCount *
                100
            )
            : 0;


    accuracyElement.textContent =
        `正答率 ${accuracy}%`;

}


// ========================================
// 学習終了
// ========================================

function finishStudy() {

    sessionFinished = true;


    const accuracy =
        sessionQuestionCount > 0
            ? Math.round(
                sessionCorrect /
                sessionQuestionCount *
                100
            )
            : 0;


    let resultText =
        `学習終了！ ${sessionQuestionCount}問中 ${sessionCorrect}問正解（正答率 ${accuracy}%）`;


    if (
        sessionWrongWords.length > 0
    ) {

        resultText +=
            `\n${sessionWrongWords.length}単語を間違えました。`;

    }

    else {

        resultText +=
            "\n全問正解です！";

    }


    document.getElementById(
        "result"
    ).textContent =
        resultText;


    const nextButton =
        document.getElementById(
            "nextButton"
        );


    nextButton.textContent =
        "もう一度学習";


    nextButton.style.display =
        "inline-block";


    const reviewButton =
        document.getElementById(
            "reviewButton"
        );


    if (
        sessionWrongWords.length > 0
    ) {

        reviewButton.textContent =
            `間違えた${sessionWrongWords.length}単語を復習`;


        reviewButton.style.display =
            "inline-block";

    }

    else {

        reviewButton.style.display =
            "none";

    }

}


// ========================================
// 間違えた単語を復習
// ========================================

function startWrongReview() {

    if (
        sessionWrongWords.length === 0
    ) {

        return;

    }


    sessionWords =
        [...sessionWrongWords];


    sessionQuestionCount = 0;

    sessionCorrect = 0;

    sessionFinished = false;

    recentWordIds = [];


    reviewOriginalCount =
        studySettings.count;


    studySettings.count =
        sessionWords.length;


    document.getElementById(
        "reviewButton"
    ).style.display =
        "none";


    document.getElementById(
        "nextButton"
    ).style.display =
        "none";


    document.getElementById(
        "result"
    ).textContent =
        "間違えた単語の復習を開始します。";


    updateSessionInfo();

    newQuestion();

}


// ========================================
// 次の問題
// ========================================

function nextQuestion() {

    if (sessionFinished) {

        if (
            reviewOriginalCount !==
            undefined
        ) {

            studySettings.count =
                reviewOriginalCount;

            reviewOriginalCount =
                undefined;

        }


        beginStudy();

        return;

    }


    newQuestion();

}


// ========================================
// 学習履歴保存
// ========================================

function saveProgress() {

    if (!selectedSheet) {

        return;

    }


    localStorage.setItem(
        `vocabProgress_${selectedSheet.gid}`,
        JSON.stringify(progress)
    );


    localStorage.setItem(
        `totalQuestions_${selectedSheet.gid}`,
        totalQuestions
    );


    localStorage.setItem(
        `currentStreak_${selectedSheet.gid}`,
        currentStreak
    );


    localStorage.setItem(
        `bestStreak_${selectedSheet.gid}`,
        bestStreak
    );

}


// ========================================
// 学習画面からジャンル変更
// ========================================

function changeStudySheet() {

    sessionWords = [];

    sessionWrongWords = [];

    recentWordIds = [];

    currentWord = null;

    answered = false;

    sessionQuestionCount = 0;

    sessionCorrect = 0;

    sessionFinished = false;

    reviewOriginalCount = undefined;


    document.getElementById(
        "choices"
    ).innerHTML =
        "";


    document.getElementById(
        "result"
    ).textContent =
        "";


    showPage(
        "sheetPage"
    );

}


// ========================================
// 学習状況のジャンル一覧
// ========================================

function renderProgressSheetList() {

    const container =
        document.getElementById(
            "progressSheetList"
        );


    container.innerHTML =
        "";


    SHEETS.forEach(sheet => {

        const button =
            document.createElement(
                "button"
            );


        button.className =
            "sheet-option";


        button.textContent =
            sheet.name;


        if (
            progressSheet &&
            progressSheet.gid ===
            sheet.gid
        ) {

            button.classList.add(
                "selected"
            );

        }


        button.onclick =
            () =>
                selectProgressSheet(
                    sheet,
                    button
                );


        container.appendChild(
            button
        );

    });

}


// ========================================
// 学習状況のジャンル選択
// ========================================

async function selectProgressSheet(
    sheet,
    button = null
) {

    progressSheet =
        sheet;


    if (button) {

        document
            .querySelectorAll(
                "#progressSheetList .sheet-option"
            )
            .forEach(option => {

                option.classList.remove(
                    "selected"
                );

            });


        button.classList.add(
            "selected"
        );

    }


    document.getElementById(
        "progressSheetName"
    ).textContent =
        `${sheet.name}（読み込み中...）`;


    try {

        const url =
            `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${sheet.gid}`;


        const response =
            await fetch(url);


        if (!response.ok) {

            throw new Error(
                "スプレッドシートを読み込めませんでした。"
            );

        }


        const csvText =
            await response.text();


        const sheetWords =
            parseCSV(csvText);


        loadProgressForSheet(
            sheet
        );


        document.getElementById(
            "progressSheetName"
        ).textContent =
            sheet.name;


        renderProgressStats(
            sheetWords
        );


    }

    catch (error) {

        console.error(error);


        document.getElementById(
            "progressSheetName"
        ).textContent =
            `${sheet.name}（読み込み失敗）`;

    }

}


// ========================================
// 学習状況を表示
// ========================================

function renderStats() {

    if (progressSheet) {

        selectProgressSheet(
            progressSheet
        );

        return;

    }


    if (selectedSheet) {

        selectProgressSheet(
            selectedSheet
        );

    }

}


// ========================================
// 学習状況の描画
// ========================================

function renderProgressStats(
    sheetWords
) {

    if (!progressSheet) {

        return;

    }


    // 現在表示している単語一覧を保存

    progressSheetWords =
        sheetWords;


    document.getElementById(
        "totalQuestions"
    ).textContent =
        totalQuestions;


    let totalCorrect = 0;

    let totalAnswered = 0;


    Object.values(progress)
        .forEach(data => {

            totalCorrect +=
                data.correct;

            totalAnswered +=
                data.correct +
                data.incorrect;

        });


    const accuracy =
        totalAnswered > 0
            ? Math.round(
                totalCorrect /
                totalAnswered *
                100
            )
            : 0;


    document.getElementById(
        "overallAccuracy"
    ).textContent =
        accuracy + "%";


    document.getElementById(
        "currentStreak"
    ).textContent =
        currentStreak;


    document.getElementById(
        "bestStreak"
    ).textContent =
        bestStreak;


    const buckets =
        [0, 0, 0, 0, 0, 0];


    sheetWords.forEach(word => {

        const data =
            progress[word.id];


        if (!data) {

            buckets[5]++;

            return;

        }


        const answeredCount =
            data.correct +
            data.incorrect;


        if (
            answeredCount === 0
        ) {

            buckets[5]++;

            return;

        }


        const incorrectRate =
            data.incorrect /
            answeredCount *
            100;


        if (
            incorrectRate <= 20
        ) {

            buckets[0]++;

        }

        else if (
            incorrectRate <= 40
        ) {

            buckets[1]++;

        }

        else if (
            incorrectRate <= 60
        ) {

            buckets[2]++;

        }

        else if (
            incorrectRate <= 80
        ) {

            buckets[3]++;

        }

        else {

            buckets[4]++;

        }

    });


    for (
        let i = 0;
        i < 6;
        i++
    ) {

        document.getElementById(
            `bucket${i}`
        ).textContent =
            buckets[i] + "単語";

    }


    renderWordProgress();

}


// ========================================
// 単語別学習状況
// ========================================

function renderWordProgress() {

    const container =
        document.getElementById(
            "wordProgressList"
        );


    if (
        !container ||
        !progressSheet
    ) {

        return;

    }


    const sortSelect =
        document.getElementById(
            "wordSortSelect"
        );


    const sortType =
        sortSelect
            ? sortSelect.value
            : "weak";


    const items =
        [...progressSheetWords];


    items.sort(
        (a, b) =>
            compareProgressWords(
                a,
                b,
                sortType
            )
    );


    container.innerHTML =
        "";


    if (items.length === 0) {

        container.textContent =
            "単語がありません。";

        return;

    }


    items.forEach(item => {

        const data =
            progress[item.id];


        const answeredCount =
            data
                ? data.correct +
                  data.incorrect
                : 0;


        const correct =
            data
                ? data.correct
                : 0;


        const incorrect =
            data
                ? data.incorrect
                : 0;


        const accuracy =
            answeredCount > 0
                ? Math.round(
                    correct /
                    answeredCount *
                    100
                )
                : null;


        const div =
            document.createElement(
                "div"
            );


        div.className =
            "word-progress-item";


        const main =
            document.createElement(
                "div"
            );


        main.className =
            "word-progress-main";


        const word =
            document.createElement(
                "div"
            );


        word.className =
            "word-progress-word";


        word.textContent =
            item.word;


        const rate =
            document.createElement(
                "div"
            );


        rate.className =
            "word-progress-rate";


        rate.textContent =
            accuracy === null
                ? "未学習"
                : `正答率 ${accuracy}%`;


        main.appendChild(
            word
        );

        main.appendChild(
            rate
        );


        const detail =
            document.createElement(
                "div"
            );


        detail.className =
            "word-progress-detail";


        detail.textContent =
            `正解 ${correct}回　不正解 ${incorrect}回　出題 ${answeredCount}回`;


        div.appendChild(
            main
        );

        div.appendChild(
            detail
        );


        container.appendChild(
            div
        );

    });

}


// ========================================
// 単語一覧の比較
// ========================================

function compareProgressWords(
    a,
    b,
    sortType
) {

    const dataA =
        progress[a.id];

    const dataB =
        progress[b.id];


    const answeredA =
        dataA
            ? dataA.correct +
              dataA.incorrect
            : 0;


    const answeredB =
        dataB
            ? dataB.correct +
              dataB.incorrect
            : 0;


    const accuracyA =
        answeredA > 0
            ? dataA.correct /
              answeredA
            : null;


    const accuracyB =
        answeredB > 0
            ? dataB.correct /
              answeredB
            : null;


    // ========================================
    // 苦手順
    // ========================================

    if (
        sortType ===
        "weak"
    ) {

        // 未学習は最初

        if (
            accuracyA === null &&
            accuracyB !== null
        ) {

            return -1;

        }


        if (
            accuracyA !== null &&
            accuracyB === null
        ) {

            return 1;

        }


        if (
            accuracyA === null &&
            accuracyB === null
        ) {

            return a.word.localeCompare(
                b.word
            );

        }


        // 正答率が低い順

        return accuracyA -
            accuracyB;

    }


    // ========================================
    // 正答率順
    // ========================================

    if (
        sortType ===
        "accuracy"
    ) {

        // 未学習は最後

        if (
            accuracyA === null &&
            accuracyB !== null
        ) {

            return 1;

        }


        if (
            accuracyA !== null &&
            accuracyB === null
        ) {

            return -1;

        }


        if (
            accuracyA === null &&
            accuracyB === null
        ) {

            return a.word.localeCompare(
                b.word
            );

        }


        return accuracyB -
            accuracyA;

    }


    // ========================================
    // 出題回数順
    // ========================================

    if (
        sortType ===
        "questions"
    ) {

        return answeredB -
            answeredA;

    }


    // ========================================
    // 未学習を上に
    // ========================================

    if (
        sortType ===
        "unlearned"
    ) {

        if (
            answeredA === 0 &&
            answeredB !== 0
        ) {

            return -1;

        }


        if (
            answeredA !== 0 &&
            answeredB === 0
        ) {

            return 1;

        }


        return a.word.localeCompare(
            b.word
        );

    }


    // ========================================
    // 英単語順
    // ========================================

    return a.word.localeCompare(
        b.word
    );

}


// ========================================
// 学習履歴リセット
// ========================================

function resetProgress() {

    if (!progressSheet) {

        return;

    }


    const confirmed =
        confirm(
            `「${progressSheet.name}」の学習履歴をすべて削除しますか？`
        );


    if (!confirmed) {

        return;

    }


    progress = {};

    totalQuestions = 0;

    currentStreak = 0;

    bestStreak = 0;


    localStorage.setItem(
        `vocabProgress_${progressSheet.gid}`,
        JSON.stringify({})
    );


    localStorage.setItem(
        `totalQuestions_${progressSheet.gid}`,
        0
    );


    localStorage.setItem(
        `currentStreak_${progressSheet.gid}`,
        0
    );


    localStorage.setItem(
        `bestStreak_${progressSheet.gid}`,
        0
    );


    renderProgressStats(
        progressSheetWords
    );


    alert(
        "学習履歴をリセットしました。"
    );

}


// ========================================
// ジャンル選択へ戻る
// ========================================

function backToSheetSelection() {

    showPage(
        "sheetPage"
    );

}


// ========================================
// 起動
// ========================================

renderSheetList();

showPage(
    "sheetPage"
);

// ========================================
// PWA / Service Worker
// ========================================

if ("serviceWorker" in navigator) {

    window.addEventListener("load", () => {

        navigator.serviceWorker
            .register("sw.js")
            .then(() => {

                console.log("Service Workerを登録しました。");

            })
            .catch(error => {

                console.error(
                    "Service Workerの登録に失敗しました。",
                    error
                );

            });

    });

}
