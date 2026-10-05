// ============================================================
// 単語学習アプリ script.js
// ============================================================


// ============================================================
// Firebase 設定
// ============================================================

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAXflojJlDfwkAXcTcHMRSXCzeNiWICs4Y",
    authDomain: "vocab-app-f6f57.firebaseapp.com",
    projectId: "vocab-app-f6f57",
    storageBucket: "vocab-app-f6f57.firebasestorage.app",
    messagingSenderId: "167837450502",
    appId: "1:167837450502:web:afbae5b8e8dd8381c91e87"
};


// ============================================================
// Google Sheets 設定
// ============================================================

const GOOGLE_SHEETS_API_KEY = "AIzaSyAVnvuKTzKDq8hUcoEpIhEMveldEIdhWGQ";

const SHEET_ID =
    "1AB15tNzU9n5yjjcHRhsYDfFZ2ftJ0CpXI2df2UetU6Q";


// ============================================================
// Firebase
// ============================================================

let app;
let auth;
let db;
let currentUser = null;


// ============================================================
// アプリ状態
// ============================================================

let SHEETS = [];
let selectedSheet = null;
let studyWords = [];

let currentIndex = 0;
let currentWord = null;

let progress = {};

let studySettings = {
    mode: "normal",
    format: "frontToBack",
    count: 10,
    rangeMode: "all"
};

let sessionResults = [];
let sessionCorrect = 0;
let sessionAnswered = 0;

let authMode = "login";
let creatingAnonymousUser = false;


// ============================================================
// 初期化
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {

    try {

        app = firebase.initializeApp(FIREBASE_CONFIG);

        auth = firebase.auth();
        db = firebase.firestore();

        await auth.setPersistence(
            firebase.auth.Auth.Persistence.LOCAL
        );

        auth.onAuthStateChanged(
            async user => {

                currentUser = user;

                updateHeader();

                if (user) {

                    showNavigation();

                    await loadSheets();
                    await loadProgress();

                    showPage("sheetPage");

                } else {

                    hideNavigation();

                    showPage("homePage");
                }
            }
        );

    } catch (error) {

        console.error(
            "Firebase initialization error:",
            error
        );

        const message =
            document.getElementById("homeMessage");

        if (message) {
            message.textContent =
                "アプリの初期化に失敗しました。";
        }
    }

    updateRangeUI();
    updateBeginStudyButton();
});


// ============================================================
// ページ切り替え
// ============================================================

function showPage(pageId) {

    const pages =
        document.querySelectorAll("main > section");

    pages.forEach(page => {
        page.style.display = "none";
    });

    const target =
        document.getElementById(pageId);

    if (!target) {
        console.warn(
            `Page not found: ${pageId}`
        );
        return;
    }

    const protectedPages = [
        "sheetPage",
        "settingsPage",
        "studyPage",
        "progressPage",
        "accountPage"
    ];

    if (
        protectedPages.includes(pageId) &&
        !currentUser
    ) {

        const home =
            document.getElementById("homePage");

        if (home) {
            home.style.display = "";
        }

        return;
    }

    target.style.display = "";

    if (pageId === "settingsPage") {
        updateRangeUI();
        updateBeginStudyButton();
        updateFormatLabels();
    }

    if (pageId === "progressPage") {
        loadProgressSheetList();
    }

    if (pageId === "accountPage") {
        updateAccountPage();
    }

    window.scrollTo(0, 0);
}


// ============================================================
// ナビゲーション
// ============================================================

function showNavigation() {

    const nav =
        document.getElementById("mainNav");

    if (nav) {
        nav.style.display = "flex";
    }
}


function hideNavigation() {

    const nav =
        document.getElementById("mainNav");

    if (nav) {
        nav.style.display = "none";
    }
}


// ============================================================
// ヘッダー認証ボタン
// ============================================================

function handleHeaderAuthButton() {

    if (!currentUser) {

        openLoginPage();

        return;
    }

    if (currentUser.isAnonymous) {

        openRegisterPage();

        return;
    }

    logout();
}


function updateHeader() {

    const button =
        document.getElementById(
            "headerAuthButton"
        );

    if (!button) {
        return;
    }

    if (!currentUser) {

        button.textContent =
            "ログインする";

        button.onclick =
            handleHeaderAuthButton;

        return;
    }

    if (currentUser.isAnonymous) {

        button.textContent =
            "アカウント登録";

        button.onclick =
            handleHeaderAuthButton;

        return;
    }

    button.textContent =
        "ログアウト";

    button.onclick =
        handleHeaderAuthButton;
}


// ============================================================
// ログインページ
// ============================================================

function openLoginPage() {

    authMode = "login";

    updateAuthPage();

    showPage("authPage");
}


function openRegisterPage() {

    authMode = "register";

    updateAuthPage();

    showPage("authPage");
}


function updateAuthPage() {

    const title =
        document.getElementById("authTitle");

    const button =
        document.getElementById("authButton");

    const toggle =
        document.getElementById(
            "toggleAuthButton"
        );

    const passwordInput =
        document.getElementById(
            "passwordInput"
        );

    if (authMode === "login") {

        if (title) {
            title.textContent = "ログイン";
        }

        if (button) {
            button.textContent = "ログイン";
        }

        if (toggle) {
            toggle.textContent =
                "新規登録はこちら";
        }

        if (passwordInput) {
            passwordInput.autocomplete =
                "current-password";
        }

    } else {

        if (title) {
            title.textContent =
                "アカウント作成";
        }

        if (button) {
            button.textContent =
                "アカウントを作成";
        }

        if (toggle) {
            toggle.textContent =
                "ログインはこちら";
        }

        if (passwordInput) {
            passwordInput.autocomplete =
                "new-password";
        }
    }

    clearAuthMessage();
}


// ============================================================
// ログイン／登録モード切替
// ============================================================

function toggleAuthMode() {

    if (authMode === "login") {

        authMode = "register";

    } else {

        authMode = "login";
    }

    updateAuthPage();
}


// ============================================================
// ログイン／登録処理
// ============================================================

async function handleAuth() {

    const emailInput =
        document.getElementById(
            "emailInput"
        );

    const passwordInput =
        document.getElementById(
            "passwordInput"
        );

    if (!emailInput || !passwordInput) {
        return;
    }

    const email =
        emailInput.value.trim();

    const password =
        passwordInput.value;

    if (!email || !password) {

        showAuthMessage(
            "メールアドレスとパスワードを入力してください。",
            true
        );

        return;
    }

    if (password.length < 6) {

        showAuthMessage(
            "パスワードは6文字以上にしてください。",
            true
        );

        return;
    }

    try {

        clearAuthMessage();

        // ----------------------------------------------------
        // ログイン
        // ----------------------------------------------------

        if (authMode === "login") {

            await auth.signInWithEmailAndPassword(
                email,
                password
            );

            showAuthMessage(
                "ログインしました。"
            );

            return;
        }


        // ----------------------------------------------------
        // 匿名ユーザーからアカウントへ移行
        // ----------------------------------------------------

        if (
            currentUser &&
            currentUser.isAnonymous
        ) {

            const credential =
                firebase.auth.EmailAuthProvider
                    .credential(
                        email,
                        password
                    );

            await currentUser.linkWithCredential(
                credential
            );

            showAuthMessage(
                "アカウント登録が完了しました。"
            );

            updateHeader();
            updateAccountPage();

            return;
        }


        // ----------------------------------------------------
        // 新規アカウント作成
        // ----------------------------------------------------

        await auth.createUserWithEmailAndPassword(
            email,
            password
        );

        showAuthMessage(
            "アカウントを作成しました。"
        );

    } catch (error) {

        console.error(
            "Authentication error:",
            error
        );

        showAuthMessage(
            translateAuthError(error),
            true
        );
    }
}


// ============================================================
// 認証エラー翻訳
// ============================================================

function translateAuthError(error) {

    const code =
        error?.code || "";

    const messages = {

        "auth/invalid-email":
            "メールアドレスの形式が正しくありません。",

        "auth/user-not-found":
            "このメールアドレスのアカウントが見つかりません。",

        "auth/wrong-password":
            "パスワードが正しくありません。",

        "auth/invalid-credential":
            "メールアドレスまたはパスワードが正しくありません。",

        "auth/email-already-in-use":
            "このメールアドレスはすでに使用されています。",

        "auth/weak-password":
            "パスワードは6文字以上にしてください。",

        "auth/user-disabled":
            "このアカウントは無効になっています。",

        "auth/network-request-failed":
            "ネットワークエラーが発生しました。",

        "auth/too-many-requests":
            "試行回数が多すぎます。しばらく待ってから再度お試しください。",

        "auth/credential-already-in-use":
            "このメールアドレスはすでに別のアカウントで使用されています。"
    };

    return (
        messages[code] ||
        "認証中にエラーが発生しました。"
    );
}


// ============================================================
// 認証メッセージ
// ============================================================

function showAuthMessage(
    message,
    isError = false
) {

    const element =
        document.getElementById(
            "authMessage"
        );

    if (!element) {
        return;
    }

    element.textContent =
        message;

    element.classList.toggle(
        "error",
        isError
    );
}


function clearAuthMessage() {

    const element =
        document.getElementById(
            "authMessage"
        );

    if (!element) {
        return;
    }

    element.textContent = "";

    element.classList.remove(
        "error"
    );
}


// ============================================================
// 匿名利用
// ============================================================

async function startAsAnonymous() {

    if (!auth) {
        return;
    }

    try {

        creatingAnonymousUser = true;

        if (
            currentUser &&
            currentUser.isAnonymous
        ) {

            showPage("sheetPage");

            return;
        }

        if (currentUser) {

            showPage("sheetPage");

            return;
        }

        await auth.signInAnonymously();

    } catch (error) {

        console.error(
            "Anonymous login error:",
            error
        );

        const message =
            document.getElementById(
                "homeMessage"
            );

        if (message) {
            message.textContent =
                "匿名での開始に失敗しました。";
        }

    } finally {

        creatingAnonymousUser = false;
    }
}


// ============================================================
// ログアウト
// ============================================================

async function logout() {

    if (!auth) {
        return;
    }

    try {

        await auth.signOut();

        currentUser = null;
        progress = {};

        showPage("homePage");

    } catch (error) {

        console.error(
            "Logout error:",
            error
        );

        alert(
            "ログアウトに失敗しました。"
        );
    }
}


// ============================================================
// Google Sheets ジャンル一覧取得
// ============================================================

async function loadSheets() {

    const container =
        document.getElementById(
            "sheetList"
        );

    if (container) {

        container.innerHTML =
            '<p class="loading">ジャンルを読み込んでいます...</p>';
    }

    try {

        const url =
            `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
            `?fields=sheets.properties` +
            `&key=${GOOGLE_SHEETS_API_KEY}`;

        const response =
            await fetch(url);

        if (!response.ok) {

            throw new Error(
                `Google Sheets API error: ${response.status}`
            );
        }

        const data =
            await response.json();

        SHEETS =
            (data.sheets || []).map(sheet => ({
                title:
                    sheet.properties.title,

                sheetId:
                    sheet.properties.sheetId
            }));

        renderSheetList();

    } catch (error) {

        console.error(
            "loadSheets error:",
            error
        );

        SHEETS = [];

        if (container) {

            container.innerHTML =
                "<p>ジャンルを読み込めませんでした。</p>";
        }
    }
}


// ============================================================
// シートの問題データ取得
// ============================================================

async function fetchSheetData(sheetName) {

    const range =
        `'${sheetName}'`;

    const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/` +
        `${encodeURIComponent(range)}` +
        `?key=${GOOGLE_SHEETS_API_KEY}`;

    const response =
        await fetch(url);

    if (!response.ok) {

        throw new Error(
            `Sheet data error: ${response.status}`
        );
    }

    const data =
        await response.json();

    return data.values || [];
}


// ============================================================
// 後方互換用
// ============================================================

async function fetchSheetCSV(sheetName) {
    return fetchSheetData(sheetName);
}


// ============================================================
// シートデータ解析
// ============================================================

function parseSheetData(values) {

    if (
        !values ||
        values.length < 2
    ) {
        return [];
    }

    const headers =
        values[0].map(value =>
            String(value || "")
                .trim()
                .toLowerCase()
        );


    // --------------------------------------------------------
    // 列名候補
    // --------------------------------------------------------

    const idNames = [
        "id",
        "番号",
        "単語id",
        "単語id",
        "wordid",
        "word_id"
    ];

    const frontNames = [
        "表面",
        "front",
        "word",
        "単語",
        "英語"
    ];

    const backNames = [
        "裏面",
        "back",
        "meaning",
        "意味",
        "日本語"
    ];


    function findColumn(names) {

        for (const name of names) {

            const index =
                headers.indexOf(
                    name.toLowerCase()
                );

            if (index !== -1) {
                return index;
            }
        }

        return -1;
    }


    const idIndex =
        findColumn(idNames);

    const frontIndex =
        findColumn(frontNames);

    const backIndex =
        findColumn(backNames);


    if (
        frontIndex === -1 ||
        backIndex === -1
    ) {

        console.error(
            "表面・裏面の列が見つかりません。",
            headers
        );

        return [];
    }


    // --------------------------------------------------------
    // 単語データ生成
    // --------------------------------------------------------

    const words = [];

    for (
        let i = 1;
        i < values.length;
        i++
    ) {

        const row =
            values[i];

        if (!row) {
            continue;
        }

        const front =
            String(
                row[frontIndex] ?? ""
            ).trim();

        const back =
            String(
                row[backIndex] ?? ""
            ).trim();

        if (!front || !back) {
            continue;
        }


        let id = null;

        if (idIndex !== -1) {

            const rawId =
                String(
                    row[idIndex] ?? ""
                ).trim();

            if (rawId !== "") {

                const number =
                    Number(rawId);

                if (Number.isFinite(number)) {
                    id = number;
                }
            }
        }


        words.push({
            id,
            front,
            back
        });
    }

    return words;
}


// ============================================================
// ジャンル一覧表示
// ============================================================

function renderSheetList() {

    const container =
        document.getElementById(
            "sheetList"
        );

    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (SHEETS.length === 0) {

        container.innerHTML =
            "<p>ジャンルがありません。</p>";

        return;
    }


    SHEETS.forEach(sheet => {

        const button =
            document.createElement(
                "button"
            );

        button.className =
            "sheet-button";

        button.textContent =
            sheet.title;

        button.onclick =
            () => selectSheet(sheet.title);

        container.appendChild(
            button
        );
    });
}


// ============================================================
// ジャンル選択
// ============================================================

async function selectSheet(sheetName) {

    selectedSheet =
        sheetName;

    try {

        const values =
            await fetchSheetData(
                sheetName
            );

        studyWords =
            parseSheetData(values);

        updateSelectedSheetName();

        updateFormatLabels();

        updateRangeUI();

        updateBeginStudyButton();

        if (studyWords.length === 0) {

            alert(
                "このジャンルには有効な問題がありません。"
            );

            return;
        }

        showPage("settingsPage");

    } catch (error) {

        console.error(
            "selectSheet error:",
            error
        );

        alert(
            "問題データの読み込みに失敗しました。"
        );
    }
}


// ============================================================
// HTML側のstartStudy()との互換
// ============================================================

async function startStudy() {

    if (selectedSheet) {

        showPage("settingsPage");

        return;
    }

    alert(
        "ジャンルを選択してください。"
    );
}


// ============================================================
// 設定画面のジャンル名
// ============================================================

function updateSelectedSheetName() {

    const elements = [
        document.getElementById(
            "selectedSheetName"
        ),
        document.getElementById(
            "settingsSheetName"
        ),
        document.getElementById(
            "currentSheetName"
        )
    ];

    elements.forEach(element => {

        if (element) {
            element.textContent =
                selectedSheet || "-";
        }
    });
}


// ============================================================
// 出題設定
// ============================================================

function selectSetting(button) {

    if (!button) {
        return;
    }

    const setting =
        button.dataset.setting;

    const value =
        button.dataset.value;

    if (!setting) {
        return;
    }


    studySettings[setting] =
        value;


    document
        .querySelectorAll(
            `.setting-option[data-setting="${setting}"]`
        )
        .forEach(option => {

            option.classList.toggle(
                "selected",
                option === button
            );
        });


    if (
        setting === "rangeMode"
    ) {

        updateRangeUI();
    }


    updateBeginStudyButton();
}


// ============================================================
// ID範囲入力欄
// ============================================================

function updateRangeUI() {

    const container =
        document.getElementById(
            "idRangeInputs"
        );

    if (!container) {
        return;
    }

    if (
        studySettings.rangeMode === "id"
    ) {

        container.style.display = "";

    } else {

        container.style.display =
            "none";
    }
}


// ============================================================
// 学習開始ボタン
// ============================================================

function updateBeginStudyButton() {

    const button =
        document.getElementById(
            "beginStudyButton"
        );

    if (!button) {
        return;
    }


    let disabled = false;


    if (
        !selectedSheet ||
        !studyWords ||
        studyWords.length === 0
    ) {

        disabled = true;
    }


    if (
        studySettings.rangeMode === "id"
    ) {

        const startInput =
            document.getElementById(
                "startIdInput"
            );

        const endInput =
            document.getElementById(
                "endIdInput"
            );

        const start =
            startInput
                ? Number(startInput.value)
                : NaN;

        const end =
            endInput
                ? Number(endInput.value)
                : NaN;


        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            start > end
        ) {

            disabled = true;
        }
    }


    button.disabled =
        disabled;
}


// ============================================================
// 出題形式ラベル
// ============================================================

function updateFormatLabels() {

    const frontLabel =
        document.getElementById(
            "frontToBackLabel"
        );

    const backLabel =
        document.getElementById(
            "backToFrontLabel"
        );


    if (frontLabel) {

        frontLabel.textContent =
            selectedSheet
                ? `${selectedSheet} → 裏面`
                : "表面 → 裏面";
    }


    if (backLabel) {

        backLabel.textContent =
            selectedSheet
                ? `裏面 → ${selectedSheet}`
                : "裏面 → 表面";
    }
}


// ============================================================
// 学習開始
// ============================================================

function beginStudy() {

    if (
        !studyWords ||
        studyWords.length === 0
    ) {

        alert(
            "出題できる問題がありません。"
        );

        return;
    }


    let words =
        [...studyWords];


    // ========================================================
    // ID範囲指定
    // ========================================================

    if (
        studySettings.rangeMode === "id"
    ) {

        const startInput =
            document.getElementById(
                "startIdInput"
            );

        const endInput =
            document.getElementById(
                "endIdInput"
            );


        const start =
            startInput
                ? Number(startInput.value)
                : NaN;

        const end =
            endInput
                ? Number(endInput.value)
                : NaN;


        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end)
        ) {

            alert(
                "開始IDと終了IDを入力してください。"
            );

            return;
        }


        if (start > end) {

            alert(
                "開始IDは終了ID以下にしてください。"
            );

            return;
        }


        const wordsWithId =
            words.filter(
                word =>
                    Number.isFinite(
                        word.id
                    )
            );


        if (
            wordsWithId.length === 0
        ) {

            alert(
                "このジャンルにはIDが設定された問題がありません。"
            );

            return;
        }


        words =
            words.filter(
                word =>
                    Number.isFinite(
                        word.id
                    ) &&
                    word.id >= start &&
                    word.id <= end
            );


        if (words.length === 0) {

            alert(
                `ID ${start}～${end} の範囲に問題がありません。`
            );

            return;
        }
    }


    // ========================================================
    // 学習モード
    // ========================================================

    if (
        studySettings.mode === "weak"
    ) {

        words =
            words.filter(word => {

                const p =
                    getWordProgress(word);

                if (
                    !p ||
                    Number(p.total || 0) === 0
                ) {

                    return false;
                }

                return (
                    Number(p.wrong || 0) /
                    Number(p.total || 1)
                    >=
                    0.41
                );
            });


    } else if (
        studySettings.mode === "unlearned"
    ) {

        words =
            words.filter(word => {

                const p =
                    getWordProgress(word);

                return (
                    !p ||
                    Number(p.total || 0) === 0
                );
            });


    } else if (
        studySettings.mode === "incorrect"
    ) {

        words =
            words.filter(word => {

                const p =
                    getWordProgress(word);

                return (
                    p &&
                    Number(p.wrong || 0) > 0
                );
            });
    }


    // ========================================================
    // 問題がない場合
    // ========================================================

    if (words.length === 0) {

        alert(
            "現在の条件に該当する問題がありません。"
        );

        return;
    }


    // ========================================================
    // シャッフル
    // ========================================================

    shuffleArray(words);


    // ========================================================
    // 問題数
    // ========================================================

    if (
        studySettings.count !==
        "unlimited"
    ) {

        const count =
            Number(
                studySettings.count
            );

        if (
            Number.isFinite(count)
        ) {

            words =
                words.slice(
                    0,
                    count
                );
        }
    }


    // ========================================================
    // セッション開始
    // ========================================================

    studyWords =
        words;

    currentIndex = 0;
    currentWord = null;

    sessionResults = [];
    sessionCorrect = 0;
    sessionAnswered = 0;


    showPage("studyPage");

    updateSelectedSheetName();

    updateStudyQuestionType();

    updateSessionInfo();

    showQuestion();
}


// ============================================================
// 問題表示
// ============================================================

function showQuestion() {

    if (
        !studyWords ||
        currentIndex >= studyWords.length
    ) {

        finishStudy();

        return;
    }


    currentWord =
        studyWords[currentIndex];


    updateSelectedSheetName();

    updateStudyQuestionType();


    // --------------------------------------------------------
    // 問題文
    // --------------------------------------------------------

    const question =
        document.getElementById(
            "question"
        );

    if (question) {

        question.textContent =
            studySettings.format ===
            "frontToBack"
                ? currentWord.front
                : currentWord.back;
    }


    // --------------------------------------------------------
    // 選択肢
    // --------------------------------------------------------

    const container =
        document.getElementById(
            "choices"
        );

    if (!container) {
        return;
    }

    container.innerHTML = "";


    const correctAnswer =
        studySettings.format ===
        "frontToBack"
            ? currentWord.back
            : currentWord.front;


    const candidates =
        studyWords.filter(
            word =>
                word !== currentWord
        );


    shuffleArray(
        candidates
    );


    const choices = [
        correctAnswer
    ];

    const used =
        new Set([
            correctAnswer
        ]);


    for (
        const word of candidates
    ) {

        const answer =
            studySettings.format ===
            "frontToBack"
                ? word.back
                : word.front;


        if (
            !answer ||
            used.has(answer)
        ) {
            continue;
        }


        used.add(answer);

        choices.push(answer);


        if (
            choices.length >= 4
        ) {
            break;
        }
    }


    shuffleArray(
        choices
    );


    choices.forEach(
        answer => {

            const button =
                document.createElement(
                    "button"
                );

            button.className =
                "choice";

            button.textContent =
                answer;

            button.onclick =
                () =>
                    answerQuestion(
                        answer,
                        button
                    );

            container.appendChild(
                button
            );
        }
    );


    // --------------------------------------------------------
    // 結果表示
    // --------------------------------------------------------

    const result =
        document.getElementById(
            "result"
        );

    if (result) {

        result.textContent =
            "";

        result.className =
            "";
    }


    const nextButton =
        document.getElementById(
            "nextButton"
        );

    if (nextButton) {
        nextButton.style.display =
            "none";
    }


    updateSessionInfo();
}


// ============================================================
// 問題形式表示
// ============================================================

function updateStudyQuestionType() {

    const element =
        document.getElementById(
            "questionType"
        );

    if (!element) {
        return;
    }


    if (
        studySettings.format ===
        "frontToBack"
    ) {

        element.textContent =
            "表面 → 裏面";

    } else {

        element.textContent =
            "裏面 → 表面";
    }
}


// ============================================================
// 回答
// ============================================================

async function answerQuestion(
    selectedAnswer,
    clickedButton
) {

    if (!currentWord) {
        return;
    }


    const buttons =
        document.querySelectorAll(
            "#choices .choice"
        );


    // 二重回答防止
    if (
        [...buttons].some(
            button =>
                button.disabled
        )
    ) {

        return;
    }


    buttons.forEach(
        button => {
            button.disabled = true;
        }
    );


    const correctAnswer =
        studySettings.format ===
        "frontToBack"
            ? currentWord.back
            : currentWord.front;


    const isCorrect =
        selectedAnswer ===
        correctAnswer;


    // --------------------------------------------------------
    // 集計
    // --------------------------------------------------------

    sessionAnswered++;


    if (isCorrect) {
        sessionCorrect++;
    }


    sessionResults.push({
        word: currentWord,
        correct: isCorrect
    });


    // --------------------------------------------------------
    // 選択肢表示
    // --------------------------------------------------------

    if (clickedButton) {

        clickedButton.classList.add(
            isCorrect
                ? "correct"
                : "incorrect"
        );
    }


    // 正解を強調
    buttons.forEach(
        button => {

            if (
                button.textContent ===
                correctAnswer
            ) {

                button.classList.add(
                    "correct"
                );
            }
        }
    );


    // --------------------------------------------------------
    // 結果表示
    // --------------------------------------------------------

    const result =
        document.getElementById(
            "result"
        );

    if (result) {

        if (isCorrect) {

            result.textContent =
                "正解！";

            result.className =
                "correct";

        } else {

            result.textContent =
                `不正解　正解：${correctAnswer}`;

            result.className =
                "incorrect";
        }
    }


    // --------------------------------------------------------
    // 次へボタン
    // --------------------------------------------------------

    const nextButton =
        document.getElementById(
            "nextButton"
        );

    if (nextButton) {

        nextButton.style.display =
            "";
    }


    // --------------------------------------------------------
    // Firestore保存
    // --------------------------------------------------------

    try {

        await recordAnswer(
            currentWord,
            isCorrect
        );

    } catch (error) {

        console.error(
            "recordAnswer error:",
            error
        );
    }


    updateSessionInfo();
}


// ============================================================
// 次の問題
// ============================================================

function nextQuestion() {

    currentIndex++;

    if (
        currentIndex >=
        studyWords.length
    ) {

        finishStudy();

        return;
    }


    showQuestion();
}


// ============================================================
// セッション情報
// ============================================================

function updateSessionInfo() {

    const progressElement =
        document.getElementById(
            "sessionProgress"
        );

    if (progressElement) {

        progressElement.textContent =
            `${Math.min(
                currentIndex + 1,
                studyWords.length
            )} / ${studyWords.length}`;
    }


    const accuracyElement =
        document.getElementById(
            "sessionAccuracy"
        );

    if (accuracyElement) {

        const accuracy =
            sessionAnswered > 0
                ? Math.round(
                    sessionCorrect /
                    sessionAnswered *
                    100
                )
                : 0;

        accuracyElement.textContent =
            `正答率 ${accuracy}%`;
    }
}


// ============================================================
// 学習終了
// ============================================================

function finishStudy() {

    const nextButton =
        document.getElementById(
            "nextButton"
        );

    if (nextButton) {
        nextButton.style.display =
            "none";
    }


    const reviewButton =
        document.getElementById(
            "reviewButton"
        );

    if (reviewButton) {

        const wrongCount =
            sessionResults.filter(
                result =>
                    !result.correct
            ).length;

        reviewButton.style.display =
            wrongCount > 0
                ? ""
                : "none";
    }


    const result =
        document.getElementById(
            "result"
        );

    if (result) {

        const accuracy =
            sessionAnswered > 0
                ? Math.round(
                    sessionCorrect /
                    sessionAnswered *
                    100
                )
                : 0;

        result.textContent =
            `学習終了：${sessionCorrect}/${sessionAnswered}問正解（正答率 ${accuracy}%）`;
    }


    updateSessionInfo();
}


// ============================================================
// 間違えた問題を復習
// ============================================================

function startWrongReview() {

    const wrongWords =
        sessionResults
            .filter(
                result =>
                    !result.correct
            )
            .map(
                result =>
                    result.word
            );


    if (
        wrongWords.length === 0
    ) {

        alert(
            "間違えた問題はありません。"
        );

        return;
    }


    studyWords =
        [...wrongWords];

    shuffleArray(
        studyWords
    );


    currentIndex = 0;
    currentWord = null;

    sessionResults = [];
    sessionCorrect = 0;
    sessionAnswered = 0;


    showPage("studyPage");

    updateSessionInfo();

    showQuestion();
}


// ============================================================
// 設定変更
// ============================================================

function backToSheetSelection() {

    showPage("sheetPage");
}


// ============================================================
// ジャンル変更
// ============================================================

function changeStudySheet() {

    selectedSheet = null;
    studyWords = [];

    showPage("sheetPage");
}


// ============================================================
// Firestore：進捗読み込み
// ============================================================

async function loadProgress() {

    progress = {};


    if (!currentUser) {
        return;
    }


    // 匿名ユーザーは保存しない
    if (
        currentUser.isAnonymous
    ) {

        return;
    }


    try {

        const snapshot =
            await db
                .collection("users")
                .doc(
                    currentUser.uid
                )
                .collection("progress")
                .get();


        snapshot.forEach(
            doc => {

                progress[
                    doc.id
                ] =
                    doc.data() || {};
            }
        );

    } catch (error) {

        console.error(
            "loadProgress error:",
            error
        );
    }
}


// ============================================================
// Firestore：ジャンルID
// ============================================================

function sanitizeId(value) {

    return String(value)
        .replace(
            /[\/\\?#\[\]\.\s]+/g,
            "_"
        )
        .slice(
            0,
            120
        );
}


function getProgressDocumentId(
    sheetName
) {

    return sanitizeId(
        sheetName
    );
}


// ============================================================
// 単語キー
// ============================================================

function getWordKey(word) {

    // IDがある場合はIDを使用
    if (
        word &&
        Number.isFinite(
            word.id
        )
    ) {

        return `id_${word.id}`;
    }


    // IDがない場合
    return `front_${String(
        word?.front || ""
    )}`;
}


// ============================================================
// 単語の進捗取得
// ============================================================

function getWordProgress(word) {

    if (
        !selectedSheet ||
        !word
    ) {

        return null;
    }


    const sheetProgress =
        progress[
            selectedSheet
        ];


    if (!sheetProgress) {
        return null;
    }


    const key =
        getWordKey(word);


    return (
        sheetProgress[key] ||
        null
    );
}


// ============================================================
// 回答をFirestoreに保存
// ============================================================

async function recordAnswer(
    word,
    isCorrect
) {

    if (!currentUser) {
        return;
    }


    // 匿名ユーザーは保存しない
    if (
        currentUser.isAnonymous
    ) {

        return;
    }


    if (!selectedSheet) {
        return;
    }


    const sheetId =
        getProgressDocumentId(
            selectedSheet
        );

    const wordKey =
        getWordKey(word);


    const current =
        getWordProgress(word) || {
            correct: 0,
            wrong: 0,
            total: 0
        };


    const updated = {

        correct:
            Number(
                current.correct || 0
            ) +
            (
                isCorrect
                    ? 1
                    : 0
            ),

        wrong:
            Number(
                current.wrong || 0
            ) +
            (
                isCorrect
                    ? 0
                    : 1
            ),

        total:
            Number(
                current.total || 0
            ) + 1,

        front:
            word.front,

        back:
            word.back,

        id:
            Number.isFinite(
                word.id
            )
                ? word.id
                : null,

        lastAnswered:
            firebase.firestore
                .FieldValue
                .serverTimestamp()
    };


    // --------------------------------------------------------
    // メモリ上更新
    // --------------------------------------------------------

    if (
        !progress[selectedSheet]
    ) {

        progress[selectedSheet] =
            {};
    }


    progress[selectedSheet][
        wordKey
    ] =
        updated;


    // --------------------------------------------------------
    // Firestore
    // --------------------------------------------------------

    const ref =
        db
            .collection("users")
            .doc(
                currentUser.uid
            )
            .collection("progress")
            .doc(
                sheetId
            );


    await ref.set(
        {
            [wordKey]:
                updated
        },
        {
            merge: true
        }
    );
}


// ============================================================
// 進捗ページ：ジャンル一覧
// ============================================================

function loadProgressSheetList() {

    const container =
        document.getElementById(
            "progressSheetList"
        );

    if (!container) {
        return;
    }


    container.innerHTML = "";


    if (SHEETS.length === 0) {

        container.innerHTML =
            "<p>ジャンルがありません。</p>";

        return;
    }


    SHEETS.forEach(
        sheet => {

            const button =
                document.createElement(
                    "button"
                );

            button.className =
                "progress-sheet-button";

            button.textContent =
                sheet.title;

            button.onclick =
                () =>
                    renderProgress(
                        sheet.title
                    );

            container.appendChild(
                button
            );
        }
    );
}


// ============================================================
// 進捗表示
// ============================================================

async function renderProgress(
    sheetName
) {

    try {

        selectedSheet =
            sheetName;


        const values =
            await fetchSheetData(
                sheetName
            );

        const words =
            parseSheetData(
                values
            );


        const sheetProgress =
            progress[
                sheetName
            ] || {};


        let totalQuestions = 0;
        let totalCorrect = 0;
        let totalWrong = 0;


        const wordProgressList =
            [];


        words.forEach(
            word => {

                const p =
                    sheetProgress[
                        getWordKey(word)
                    ] || {
                        correct: 0,
                        wrong: 0,
                        total: 0
                    };


                const total =
                    Number(
                        p.total || 0
                    );

                const correct =
                    Number(
                        p.correct || 0
                    );

                const wrong =
                    Number(
                        p.wrong || 0
                    );


                totalQuestions +=
                    total;

                totalCorrect +=
                    correct;

                totalWrong +=
                    wrong;


                const accuracy =
                    total > 0
                        ? correct / total
                        : null;

                const wrongRate =
                    total > 0
                        ? wrong / total
                        : null;


                wordProgressList.push({
                    word,
                    total,
                    correct,
                    wrong,
                    accuracy,
                    wrongRate
                });
            }
        );


        const overallAccuracy =
            totalQuestions > 0
                ? Math.round(
                    totalCorrect /
                    totalQuestions *
                    100
                )
                : 0;


        // ----------------------------------------------------
        // 基本統計
        // ----------------------------------------------------

        setText(
            "progressSheetName",
            sheetName
        );

        setText(
            "totalQuestions",
            totalQuestions
        );

        setText(
            "overallAccuracy",
            `${overallAccuracy}%`
        );


        // 現在の連続正解・最高連続正解
        // 現段階では0
        setText(
            "currentStreak",
            0
        );

        setText(
            "bestStreak",
            0
        );


        // ----------------------------------------------------
        // 誤答率バケット
        // ----------------------------------------------------

        const buckets = [
            0,
            0,
            0,
            0,
            0,
            0
        ];


        wordProgressList.forEach(
            item => {

                if (
                    item.total === 0
                ) {

                    buckets[5]++;

                    return;
                }


                const rate =
                    item.wrongRate *
                    100;


                if (rate <= 20) {

                    buckets[0]++;

                } else if (
                    rate <= 40
                ) {

                    buckets[1]++;

                } else if (
                    rate <= 60
                ) {

                    buckets[2]++;

                } else if (
                    rate <= 80
                ) {

                    buckets[3]++;

                } else {

                    buckets[4]++;
                }
            }
        );


        for (
            let i = 0;
            i < buckets.length;
            i++
        ) {

            setText(
                `bucket${i}`,
                `${buckets[i]}単語`
            );
        }


        // ----------------------------------------------------
        // 単語一覧
        // ----------------------------------------------------

        window.currentProgressWords =
            wordProgressList;

        renderWordProgress();

    } catch (error) {

        console.error(
            "renderProgress error:",
            error
        );

        alert(
            "学習状況の読み込みに失敗しました。"
        );
    }
}


// ============================================================
// 単語別進捗表示
// ============================================================

function renderWordProgress() {

    const container =
        document.getElementById(
            "wordProgressList"
        );

    if (!container) {
        return;
    }


    const list =
        [
            ...(window.currentProgressWords || [])
        ];


    const select =
        document.getElementById(
            "wordSortSelect"
        );


    const sortMode =
        select
            ? select.value
            : "weak";


    // --------------------------------------------------------
    // 並び替え
    // --------------------------------------------------------

    list.sort(
        (a, b) => {

            if (
                sortMode ===
                "unlearned"
            ) {

                if (
                    a.total === 0 &&
                    b.total !== 0
                ) {
                    return -1;
                }

                if (
                    a.total !== 0 &&
                    b.total === 0
                ) {
                    return 1;
                }
            }


            if (
                sortMode ===
                "accuracy"
            ) {

                const aValue =
                    a.accuracy === null
                        ? -1
                        : a.accuracy;

                const bValue =
                    b.accuracy === null
                        ? -1
                        : b.accuracy;

                return (
                    aValue -
                    bValue
                );
            }


            if (
                sortMode ===
                "questions"
            ) {

                return (
                    b.total -
                    a.total
                );
            }


            if (
                sortMode ===
                "alphabetical"
            ) {

                return String(
                    a.word.front
                ).localeCompare(
                    String(
                        b.word.front
                    ),
                    "ja"
                );
            }


            // 苦手順
            if (
                a.total === 0 &&
                b.total !== 0
            ) {

                return -1;
            }

            if (
                a.total !== 0 &&
                b.total === 0
            ) {

                return 1;
            }


            const aRate =
                a.wrongRate === null
                    ? -1
                    : a.wrongRate;

            const bRate =
                b.wrongRate === null
                    ? -1
                    : b.wrongRate;


            if (
                aRate !== bRate
            ) {

                return (
                    bRate -
                    aRate
                );
            }


            return String(
                a.word.front
            ).localeCompare(
                String(
                    b.word.front
                ),
                "ja"
            );
        }
    );


    // --------------------------------------------------------
    // HTML生成
    // --------------------------------------------------------

    container.innerHTML = "";


    list.forEach(
        item => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "word-progress-row";


            const front =
                document.createElement(
                    "div"
                );

            front.className =
                "word-progress-front";

            front.textContent =
                item.word.front;


            const back =
                document.createElement(
                    "div"
                );

            back.className =
                "word-progress-back";

            back.textContent =
                item.word.back;


            const status =
                document.createElement(
                    "div"
                );

            status.className =
                "word-progress-status";


            if (
                item.total === 0
            ) {

                status.textContent =
                    "未学習";

            } else {

                const accuracy =
                    Math.round(
                        item.accuracy *
                        100
                    );

                const wrongRate =
                    Math.round(
                        item.wrongRate *
                        100
                    );


                status.textContent =
                    `${item.total}問 / 正答率${accuracy}% / 誤答率${wrongRate}%`;
            }


            row.appendChild(
                front
            );

            row.appendChild(
                back
            );

            row.appendChild(
                status
            );


            container.appendChild(
                row
            );
        }
    );
}


// ============================================================
// 進捗リセット
// ============================================================

async function resetProgress() {

    if (!currentUser) {
        return;
    }


    if (
        currentUser.isAnonymous
    ) {

        alert(
            "匿名ユーザーの学習記録は保存されていません。"
        );

        return;
    }


    if (!selectedSheet) {

        alert(
            "ジャンルが選択されていません。"
        );

        return;
    }


    const confirmed =
        confirm(
            `「${selectedSheet}」の学習状況をすべてリセットしますか？`
        );


    if (!confirmed) {
        return;
    }


    try {

        const sheetId =
            getProgressDocumentId(
                selectedSheet
            );


        await db
            .collection("users")
            .doc(
                currentUser.uid
            )
            .collection("progress")
            .doc(
                sheetId
            )
            .delete();


        delete progress[
            selectedSheet
        ];


        await renderProgress(
            selectedSheet
        );


        alert(
            "学習状況をリセットしました。"
        );

    } catch (error) {

        console.error(
            "resetProgress error:",
            error
        );

        alert(
            "学習状況のリセットに失敗しました。"
        );
    }
}


// ============================================================
// アカウントページ
// ============================================================

function updateAccountPage() {

    const status =
        document.getElementById(
            "accountStatus"
        );

    const email =
        document.getElementById(
            "accountEmail"
        );

    const registerButton =
        document.getElementById(
            "accountRegisterButton"
        );


    if (!currentUser) {

        if (status) {
            status.textContent =
                "未ログイン";
        }

        if (email) {
            email.textContent =
                "-";
        }

        if (registerButton) {
            registerButton.style.display =
                "";
        }

        return;
    }


    if (
        currentUser.isAnonymous
    ) {

        if (status) {
            status.textContent =
                "匿名利用中";
        }

        if (email) {
            email.textContent =
                "登録なし";
        }

        if (registerButton) {
            registerButton.style.display =
                "";
        }

    } else {

        if (status) {
            status.textContent =
                "登録済み";
        }

        if (email) {
            email.textContent =
                currentUser.email ||
                "-";
        }

        if (registerButton) {
            registerButton.style.display =
                "none";
        }
    }
}


// ============================================================
// テキスト設定
// ============================================================

function setText(
    elementId,
    value
) {

    const element =
        document.getElementById(
            elementId
        );

    if (element) {

        element.textContent =
            value;
    }
}


// ============================================================
// HTMLエスケープ
// ============================================================

function escapeHtml(value) {

    return String(
        value ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


// ============================================================
// シャッフル
// ============================================================

function shuffleArray(array) {

    for (
        let i =
            array.length - 1;
        i > 0;
        i--
    ) {

        const j =
            Math.floor(
                Math.random() *
                (i + 1)
            );


        [
            array[i],
            array[j]
        ] =
        [
            array[j],
            array[i]
        ];
    }


    return array;
}
