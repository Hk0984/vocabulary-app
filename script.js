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
let currentDisplayMeaning = "";
let currentChoiceMeanings = new Map();

let progress = {};
let progressLoad = { status: "idle", uid: null, request: 0 };
let accountGeneration = 0;
let progressRenderRequest = 0;
let progressViewContext = null;

let studySettings = {
    mode: "normal",
    meaningDisplay: "normal",
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

        auth.onAuthStateChanged(handleAuthStateChanged);

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
            await loadProgress();

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
        resetProgressLoad(null);

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
    const account = captureAccountContext();

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
        if (!isCurrentAccount(account)) return;

        SHEETS =
            (data.sheets || []).map(sheet => ({
                title:
                    sheet.properties.title,

                sheetId:
                    sheet.properties.sheetId
            }));

        renderSheetList();

    } catch (error) {

        if (!isCurrentAccount(account)) return;
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

        if (sheet.title === "history_questions") {
            return;
        }

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
    const account = captureAccountContext();

    selectedSheet =
        sheetName;

    try {

        const values =
            await fetchSheetData(
                sheetName
            );
        if (!isCurrentAccount(account)) return;

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

        if (!isCurrentAccount(account)) return;
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
    setText("studySaveStatus", "");
    if (currentUser && !currentUser.isAnonymous &&
        ["weak", "unlearned", "incorrect"].includes(studySettings.mode) &&
        (progressLoad.status !== "ready" || progressLoad.uid !== currentUser.uid)) {
        showProgressLoadStatus("履歴が読み込まれていないため、この学習モードは開始できません。履歴を再読み込みしてください。", true);
        return;
    }

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


    const nextWord = studyWords[currentIndex];

    if (nextWord !== currentWord) {
        currentWord = nextWord;
        currentDisplayMeaning =
            studySettings.meaningDisplay === "hard"
                ? pickDisplayMeaning(currentWord.back)
                : currentWord.back;
        currentChoiceMeanings = new Map([
            [currentWord, currentDisplayMeaning]
        ]);
    }


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
                : currentDisplayMeaning;
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


    const choices =
        buildAnswerChoices(
            currentWord,
            studyWords,
            studySettings.format,
            studySettings.meaningDisplay === "hard"
                ? currentDisplayMeaning
                : undefined,
            studySettings.meaningDisplay === "hard"
                ? currentChoiceMeanings
                : undefined
        );

    if (choices.length < 2) {
        const result =
            document.getElementById("result");
        const nextButton =
            document.getElementById("nextButton");

        if (result) {
            result.textContent =
                "誤答候補が不足しているため、この問題をスキップしてください。";
            result.className = "";
        }

        if (nextButton) {
            nextButton.style.display = "";
        }

        updateSessionInfo();
        return;
    }


    shuffleArray(
        choices
    );


    choices.forEach(
        answer => {
            const account = captureAccountContext();
            const displayedWord = currentWord;

            const button =
                document.createElement(
                    "button"
                );

            button.className =
                "choice";

            button.textContent =
                answer;

            button.onclick = () => {
                if (isCurrentAccount(account) && currentWord === displayedWord) {
                    answerQuestion(
                        answer,
                        button
                    );
                }
            };

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

        if (choices.length < 4) {
            result.textContent =
                `意味が重複・酷似する候補を除いたため、${choices.length}択です。`;
        }
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


function pickDisplayMeaning(value, random = Math.random) {

    const original = String(value ?? "");

    if (!hasMeaningDelimiter(original)) {
        return original;
    }

    const meanings = splitMeaningCandidates(original);

    if (meanings.length === 0) {
        return "";
    }

    if (meanings.length === 1) {
        return meanings[0];
    }

    const index = Math.min(
        meanings.length - 1,
        Math.floor(random() * meanings.length)
    );

    return meanings[index];
}


function hasMeaningDelimiter(value) {

    const text = String(value ?? "");
    let bracketDepth = 0;

    for (const character of text) {
        if (character === "〔") {
            bracketDepth++;
        } else if (character === "〕" && bracketDepth > 0) {
            bracketDepth--;
        } else if (character === "／" && bracketDepth === 0) {
            return true;
        }
    }

    return false;
}


function splitMeaningCandidates(value) {

    const text = String(value ?? "");
    const meanings = [];
    let start = 0;
    let bracketDepth = 0;

    for (let index = 0; index < text.length; index++) {
        if (text[index] === "〔") {
            bracketDepth++;
        } else if (text[index] === "〕" && bracketDepth > 0) {
            bracketDepth--;
        } else if (text[index] === "／" && bracketDepth === 0) {
            meanings.push(text.slice(start, index).trim());
            start = index + 1;
        }
    }

    meanings.push(text.slice(start).trim());
    return meanings.filter(Boolean);
}


function isCorrectMeaning(selectedAnswer, originalMeaning) {

    return splitMeaningCandidates(originalMeaning)
        .includes(String(selectedAnswer ?? "").trim());
}


function normalizeChoiceText(value) {

    return String(value ?? "")
        .normalize("NFKC")
        .trim()
        .toLocaleLowerCase()
        .replace(/[\s\u3000]+/g, " ");
}


function choiceTextSimilarity(left, right) {

    const a = [...normalizeChoiceText(left)];
    const b = [...normalizeChoiceText(right)];

    if (!a.length || !b.length) {
        return 0;
    }

    const previous = Array.from(
        { length: b.length + 1 },
        (_, index) => index
    );

    for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0];
        previous[0] = i;

        for (let j = 1; j <= b.length; j++) {
            const above = previous[j];
            previous[j] = Math.min(
                previous[j] + 1,
                previous[j - 1] + 1,
                diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            diagonal = above;
        }
    }

    return 1 - previous[b.length] / Math.max(a.length, b.length);
}


function buildAnswerChoices(
    current,
    words,
    format,
    displayedCorrectMeaning,
    displayedMeanings
) {

    const frontToBack = format === "frontToBack";
    const originalCorrectAnswer = frontToBack
        ? current.back
        : current.front;
    const correctAnswer = frontToBack && displayedCorrectMeaning !== undefined
        ? displayedCorrectMeaning
        : originalCorrectAnswer;
    const targetQuestion = frontToBack
        ? current.front
        : current.back;
    const normalizedCorrect = normalizeChoiceText(originalCorrectAnswer);
    const normalizedQuestion = normalizeChoiceText(targetQuestion);

    if (!normalizedCorrect) {
        return [];
    }

    const candidates = [];
    const seen = new Set([normalizeChoiceText(correctAnswer)]);

    for (const word of words) {
        if (word === current) {
            continue;
        }

        let answer = frontToBack ? word.back : word.front;

        if (frontToBack && displayedMeanings) {
            if (!displayedMeanings.has(word)) {
                displayedMeanings.set(
                    word,
                    pickDisplayMeaning(word.back)
                );
            }

            answer = displayedMeanings.get(word);
        }
        const normalizedAnswer = normalizeChoiceText(answer);
        const otherSide = normalizeChoiceText(
            frontToBack ? word.front : word.back
        );

        if (
            !normalizedAnswer ||
            seen.has(normalizedAnswer) ||
            normalizedAnswer === normalizedQuestion ||
            otherSide === normalizedCorrect ||
            otherSide === normalizedQuestion ||
            choiceTextSimilarity(normalizedCorrect, normalizedAnswer) >= 0.82 ||
            choiceTextSimilarity(normalizedQuestion, otherSide) >= 0.82
        ) {
            continue;
        }

        seen.add(normalizedAnswer);
        candidates.push({
            answer,
            score: Math.max(
                choiceTextSimilarity(targetQuestion, frontToBack ? word.front : word.back),
                choiceTextSimilarity(correctAnswer, answer)
            )
        });
    }

    // 正解と関連の強い候補を優先し、同点ならランダムに選ぶ。
    shuffleArray(candidates);
    candidates.sort((a, b) => b.score - a.score);

    return [
        correctAnswer,
        ...candidates.slice(0, 3).map(candidate => candidate.answer)
    ];
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
    const account = captureAccountContext();

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
        studySettings.format === "frontToBack" &&
        studySettings.meaningDisplay === "hard"
            ? isCorrectMeaning(selectedAnswer, currentWord.back)
            : selectedAnswer === correctAnswer;


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

            const isDisplayedCorrectMeaning =
                studySettings.format === "frontToBack" &&
                studySettings.meaningDisplay === "hard"
                    ? isCorrectMeaning(button.textContent, currentWord.back)
                    : button.textContent === correctAnswer;

            if (isDisplayedCorrectMeaning) {

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
                studySettings.meaningDisplay === "hard" &&
                splitMeaningCandidates(currentWord.back).length > 1
                    ? `正解！ 意味：${currentWord.back}`
                    : "正解！";

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

        if (!isCurrentAccount(account)) return;
        console.error(
            "recordAnswer error:",
            error
        );
        setText("studySaveStatus", "履歴を保存できませんでした。今回の成績は画面で確認できます。未保存の回答は自動再送されません。");
    }


    if (isCurrentAccount(account)) updateSessionInfo();
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
    const user = currentUser;
    if (!user || user.isAnonymous) {
        if (progressLoad.uid !== (user?.uid || null) || progressLoad.status !== "disabled") resetProgressLoad(user);
        return false;
    }
    if (progressLoad.uid !== user.uid) resetProgressLoad(user);
    const displayedSheet = progressViewContext?.sheetName;
    clearProgressView(true);
    const request = ++progressLoad.request;
    progressLoad.status = "loading";
    showProgressLoadStatus("履歴を読み込んでいます。読み込みが完了するまで履歴の保存を停止します。", false);
    try {
        const snapshot = await db.collection("users").doc(user.uid)
            .collection("progress").get({ source: "server" });
        if (!isCurrentProgressRequest(user, request)) return false;
        const loaded = {};
        snapshot.forEach(doc => { loaded[doc.id] = doc.data() || {}; });
        progress = loaded;
        progressLoad.status = "ready";
        showProgressLoadStatus("", false);
        if (document.getElementById("progressPage")?.style.display === "") {
            loadProgressSheetList();
            if (displayedSheet) await renderProgress(displayedSheet);
        }
        return isCurrentProgressRequest(user, request);
    } catch (error) {
        if (!isCurrentProgressRequest(user, request)) return false;
        progressLoad.status = "error";
        showProgressLoadStatus("履歴を読み込めませんでした。既存の記録を保護するため履歴の保存を停止しています。再読み込みしてください。", true);
        return false;
    }
}

function resetProgressLoad(user) {
    accountGeneration += 1;
    clearAccountViews();
    progress = {};
    progressLoad = {
        status: user && !user.isAnonymous ? "idle" : "disabled",
        uid: user?.uid || null,
        request: progressLoad.request + 1
    };
    showProgressLoadStatus("", false);
}

function captureAccountContext() {
    return { uid: currentUser?.uid || null, generation: accountGeneration };
}

async function handleAuthStateChanged(user) {
    currentUser = user;
    resetProgressLoad(user);
    const account = captureAccountContext();
    updateHeader();
    showPage(user ? "sheetPage" : "homePage");
    if (!user) {
        hideNavigation();
        return;
    }
    showNavigation();
    await loadSheets();
    if (!isCurrentAccount(account)) return;
    await loadProgress();
    if (!isCurrentAccount(account)) return;
    showPage("sheetPage");
}

function isCurrentAccount(account) {
    return account.uid === (currentUser?.uid || null) && account.generation === accountGeneration;
}

function clearProgressView(clearGenres = false) {
    progressRenderRequest += 1;
    progressViewContext = null;
    if (typeof window !== "undefined") window.currentProgressWords = [];
    if (clearGenres) setText("progressSheetList", "");
    for (const id of ["wordProgressList", "progressSheetName", "totalQuestions",
        "overallAccuracy", "currentStreak", "bestStreak", "bucket0", "bucket1", "bucket2", "bucket3", "bucket4", "bucket5"]) {
        setText(id, "");
    }
}

function clearAccountViews() {
    clearProgressView(true);
    studyWords = [];
    currentIndex = 0;
    currentWord = null;
    currentDisplayMeaning = "";
    currentChoiceMeanings = new Map();
    sessionResults = [];
    sessionCorrect = 0;
    sessionAnswered = 0;
    for (const id of ["choices", "question", "result", "studySaveStatus", "sessionProgress", "sessionAccuracy"]) setText(id, "");
    for (const id of ["nextButton", "reviewButton"]) {
        const button = document.getElementById(id);
        if (button) button.style.display = "none";
    }
    if (typeof window !== "undefined" && typeof window.resetHistoryQuiz === "function") window.resetHistoryQuiz();
}

function isCurrentProgressView(view) {
    return currentUser && isCurrentAccount(view.account) && progressLoad.request === view.loadRequest &&
        progressRenderRequest === view.renderRequest &&
        (currentUser.isAnonymous || (progressLoad.status === "ready" && progressLoad.uid === currentUser.uid));
}

function isCurrentProgressRequest(user, request) {
    return currentUser?.uid === user.uid && !currentUser.isAnonymous &&
        progressLoad.uid === user.uid && progressLoad.request === request;
}

function showProgressLoadStatus(message, retry) {
    setText("progressLoadStatus", message);
    const button = document.getElementById("retryProgressLoad");
    if (button) button.hidden = !retry;
}

function requireProgressReady(user, request) {
    if (!isCurrentProgressRequest(user, request) || progressLoad.status !== "ready") {
        if (currentUser?.uid === user.uid && !currentUser.isAnonymous && progressLoad.status === "idle") {
            showProgressLoadStatus("履歴が読み込まれていないため保存できません。履歴を再読み込みしてください。", true);
        }
        throw new Error("Progress is not ready for this account.");
    }
}

function progressCount(value) {
    const count = Number(value ?? 0);
    if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Invalid progress count; refusing to overwrite it.");
    }
    return count;
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
    if (word?.historyId) return `history_${word.historyId}`;

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

function getWordProgress(word, sheetName = selectedSheet) {

    if (
        !sheetName ||
        !word
    ) {

        return null;
    }


    const sheetProgress =
        progress[
            getProgressDocumentId(sheetName)
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

async function recordAnswer(word, isCorrect, sheetName = selectedSheet) {
    const user = currentUser;
    if (!user || user.isAnonymous || !sheetName) return false;
    const request = progressLoad.request;
    requireProgressReady(user, request);
    const sheetId = getProgressDocumentId(sheetName);
    const wordKey = getWordKey(word);
    const ref = db.collection("users").doc(user.uid).collection("progress").doc(sheetId);
    const updated = await db.runTransaction(async transaction => {
        requireProgressReady(user, request);
        const snapshot = await transaction.get(ref);
        requireProgressReady(user, request);
        const current = (snapshot.exists ? snapshot.data()?.[wordKey] : null) ?? {};
        if (typeof current !== "object" || Array.isArray(current)) {
            throw new Error("Invalid progress record; refusing to overwrite it.");
        }
        const next = {
            correct: progressCount(current.correct) + (isCorrect ? 1 : 0),
            wrong: progressCount(current.wrong) + (isCorrect ? 0 : 1),
            total: progressCount(current.total) + 1,
            front: word.front,
            back: word.back,
            id: Number.isFinite(word.id) ? word.id : null,
            lastAnswered: firebase.firestore.FieldValue.serverTimestamp()
        };
        transaction.set(ref, { [wordKey]: next }, { merge: true });
        return next;
    });
    // Never expose a failed write as saved, or copy it to another account.
    if (isCurrentProgressRequest(user, request) && progressLoad.status === "ready") {
        if (!progress[sheetId]) progress[sheetId] = {};
        progress[sheetId][wordKey] = updated;
    }
    return true;
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
    if (!currentUser) {
        clearProgressView(true);
        return;
    }

    if (currentUser && !currentUser.isAnonymous &&
        (progressLoad.status !== "ready" || progressLoad.uid !== currentUser.uid)) {
        container.textContent = "履歴が読み込まれていません。再読み込み後に学習状況を確認してください。";
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
    if (!currentUser) {
        clearProgressView();
        return;
    }
    if (currentUser && !currentUser.isAnonymous &&
        (progressLoad.status !== "ready" || progressLoad.uid !== currentUser.uid)) {
        showProgressLoadStatus("履歴が読み込まれていないため学習状況を表示できません。履歴を再読み込みしてください。", true);
        return;
    }
    clearProgressView();
    const view = { account: captureAccountContext(), loadRequest: progressLoad.request,
        renderRequest: progressRenderRequest, sheetName };

    try {

        selectedSheet =
            sheetName;


        const values =
            await fetchSheetData(
                sheetName
            );
        if (!isCurrentProgressView(view)) return;

        const words =
            parseSheetData(
                values
            );


        const sheetProgress =
            progress[
                getProgressDocumentId(sheetName)
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
        progressViewContext = view;

        renderWordProgress();

    } catch (error) {

        if (!isCurrentProgressView(view)) return;
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
    if (!progressViewContext || !isCurrentProgressView(progressViewContext)) {
        clearProgressView();
        return;
    }

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
    const account = captureAccountContext();
    const sheetName = selectedSheet;

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
                sheetName
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

        if (!isCurrentAccount(account)) return;

        delete progress[
            getProgressDocumentId(sheetName)
        ];


        await renderProgress(
            sheetName
        );

        if (!isCurrentAccount(account)) return;

        alert(
            "学習状況をリセットしました。"
        );

    } catch (error) {

        if (!isCurrentAccount(account)) return;
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

// Preserve existing progress fields; history uses its reserved genre.
async function recordHistoryAnswer(question, correct) {
    if (!currentUser || currentUser.isAnonymous) return false;
    await recordAnswer({
        historyId: question.id,
        front: question.question,
        back: question["choice" + question.answer],
        id: null
    }, correct, "history_questions");
    return true;
}
