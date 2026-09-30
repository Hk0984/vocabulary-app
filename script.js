/* =========================================================
   単語学習アプリ
   Firebase Authentication + Firestore
   Google Sheets
========================================================= */


/* =========================================================
   Firebase設定
========================================================= */

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAXflojJlDfwkAXcTcHMRSXCzeNiWICs4Y",
    authDomain: "vocab-app-f6f57.firebaseapp.com",
    projectId: "vocab-app-f6f57",
    storageBucket: "vocab-app-f6f57.firebasestorage.app",
    messagingSenderId: "167837450502",
    appId: "1:167837450502:web:afbae5b8e8dd8381c91e87"
};


/* =========================================================
   Google Sheets設定
========================================================= */

// 現在使用しているGoogle Sheets APIキーを入れてください
const GOOGLE_SHEETS_API_KEY = "AIzaSyAVnvuKTzKDq8hUcoEpIhEMveldEIdhWGQ";

// 現在使用しているスプレッドシートIDを入れてください
const SHEET_ID = "1AB15tNzU9n5yjjcHRhsYDfFZ2ftJ0CpXI2df2UetU6Q";


/* =========================================================
   Firebase
========================================================= */

let auth = null;
let db = null;
let currentUser = null;
let firebaseReady = false;


/* =========================================================
   アプリ状態
========================================================= */

let SHEETS = [];
let selectedSheet = null;
let studyWords = [];
let currentIndex = 0;
let currentWord = null;
let progress = {};

let studySettings = {
    mode: "normal",
    format: "frontToBack",
    count: 10
};

let sessionResults = [];
let sessionCorrect = 0;
let sessionAnswered = 0;

let authMode = "login";
let authPageOpenedManually = false;
let creatingAnonymousUser = false;


/* =========================================================
   初期化
========================================================= */

document.addEventListener("DOMContentLoaded", async () => {

    try {

        firebase.initializeApp(FIREBASE_CONFIG);

        auth = firebase.auth();
        db = firebase.firestore();

        /*
         * Firebaseにログイン状態を保持させる。
         * ブラウザを閉じても基本的にログイン状態が維持されます。
         */

        await auth.setPersistence(
            firebase.auth.Auth.Persistence.LOCAL
        );

        setupAuthEvents();
        setupNavigationEvents();

        auth.onAuthStateChanged(async (user) => {

            currentUser = user;

            if (user) {

                firebaseReady = true;

                updateHeader();
                updateAccountPage();

                /*
                 * ログイン済み / 匿名利用中
                 */

                if (authPageOpenedManually) {
                    authPageOpenedManually = false;
                }

                document.getElementById("authPage").style.display = "none";
                document.getElementById("mainNav").style.display = "flex";

                await initializeAppAfterLogin();

                /*
                 * 匿名ユーザーの場合も利用可能。
                 */

                showPage("sheetPage");

            } else {

                firebaseReady = false;

                updateHeader();

                document.getElementById("mainNav").style.display = "none";

                /*
                 * ログアウト後は自動で匿名アカウントを作らない。
                 *
                 * 「ログインを基本」にするため、
                 * ログアウト後はトップ画面に戻します。
                 */

                showPage("homePage");
            }

        });

    } catch (error) {

        console.error("Firebase初期化エラー:", error);

        const message =
            document.getElementById("homeMessage");

        if (message) {

            message.textContent =
                "初期化に失敗しました。Firebase設定を確認してください。";
        }
    }
});


/* =========================================================
   認証イベント
========================================================= */

function setupAuthEvents() {

    const emailInput =
        document.getElementById("emailInput");

    const passwordInput =
        document.getElementById("passwordInput");

    if (emailInput) {

        emailInput.addEventListener("keydown", (event) => {

            if (event.key === "Enter") {
                handleAuth();
            }

        });
    }

    if (passwordInput) {

        passwordInput.addEventListener("keydown", (event) => {

            if (event.key === "Enter") {
                handleAuth();
            }

        });
    }
}


/* =========================================================
   ナビゲーション
========================================================= */

function setupNavigationEvents() {

    // 現在はHTMLのonclickを使用しています。

}


/* =========================================================
   ページ切り替え
========================================================= */

function showPage(pageId) {

    const pages = [
        "homePage",
        "authPage",
        "sheetPage",
        "settingsPage",
        "studyPage",
        "progressPage",
        "accountPage"
    ];

    pages.forEach((id) => {

        const page =
            document.getElementById(id);

        if (page) {

            page.style.display =
                id === pageId ? "block" : "none";
        }

    });


    /*
     * アプリ内部ページへ移動するときは
     * ログイン状態を確認する。
     */

    const appPages = [
        "sheetPage",
        "settingsPage",
        "studyPage",
        "progressPage",
        "accountPage"
    ];

    if (appPages.includes(pageId)) {

        if (!currentUser) {

            showPage("homePage");
            return;
        }
    }


    if (pageId === "progressPage") {

        loadProgressSheetList();
    }


    if (pageId === "accountPage") {

        updateAccountPage();
    }
}


/* =========================================================
   ヘッダー
========================================================= */

function updateHeader() {

    const button =
        document.getElementById("headerAuthButton");

    if (!button) {
        return;
    }


    if (!currentUser) {

        button.textContent = "ログインする";

        button.onclick =
            openLoginPage;

        return;
    }


    if (currentUser.isAnonymous) {

        button.textContent = "アカウント登録";

        button.onclick =
            openRegisterPage;

        return;
    }


    button.textContent = "アカウント";

    button.onclick = () => {

        showPage("accountPage");

    };
}


/* =========================================================
   ヘッダーのボタン
========================================================= */

function handleHeaderAuthButton() {

    if (!currentUser) {

        openLoginPage();
        return;
    }


    if (currentUser.isAnonymous) {

        openRegisterPage();
        return;
    }


    showPage("accountPage");
}


/* =========================================================
   ログイン画面
========================================================= */

function openLoginPage() {

    authMode = "login";

    authPageOpenedManually = true;

    updateAuthUI();

    showPage("authPage");
}


/* =========================================================
   新規登録画面
========================================================= */

function openRegisterPage() {

    authMode = "register";

    authPageOpenedManually = true;

    updateAuthUI();

    showPage("authPage");
}


/* =========================================================
   認証モード切り替え
========================================================= */

function toggleAuthMode() {

    if (authMode === "login") {

        authMode = "register";

    } else {

        authMode = "login";
    }

    updateAuthUI();

    clearAuthMessage();
}


/* =========================================================
   認証画面UI
========================================================= */

function updateAuthUI() {

    const title =
        document.getElementById("authTitle");

    const button =
        document.getElementById("authButton");

    const toggle =
        document.getElementById("toggleAuthButton");

    const password =
        document.getElementById("passwordInput");


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

        if (password) {

            password.autocomplete =
                "current-password";
        }

    } else {

        if (title) {

            title.textContent = "新規登録";
        }

        if (button) {

            button.textContent =
                "アカウントを登録";
        }

        if (toggle) {

            toggle.textContent =
                "ログインはこちら";
        }

        if (password) {

            password.autocomplete =
                "new-password";
        }
    }
}


/* =========================================================
   ログイン / 新規登録
========================================================= */

async function handleAuth() {

    if (!auth) {
        return;
    }


    const email =
        document.getElementById("emailInput")
            ?.value
            .trim();

    const password =
        document.getElementById("passwordInput")
            ?.value;


    clearAuthMessage();


    if (!email || !password) {

        showAuthMessage(
            "メールアドレスとパスワードを入力してください。"
        );

        return;
    }


    if (password.length < 6) {

        showAuthMessage(
            "パスワードは6文字以上にしてください。"
        );

        return;
    }


    setAuthButtonDisabled(true);


    try {

        /* =============================================
           ログイン
        ============================================= */

        if (authMode === "login") {

            /*
             * 匿名ユーザーから既存アカウントへ
             * 切り替える場合も通常ログインです。
             *
             * 匿名アカウントの学習履歴を残したい場合は、
             * 「新規登録」を使用してください。
             */

            await auth.signInWithEmailAndPassword(
                email,
                password
            );

            showAuthMessage(
                "ログインしました。"
            );

            return;
        }


        /* =============================================
           新規登録
        ============================================= */

        /*
         * すでに匿名アカウントがある場合、
         * 新しいアカウントを作るのではなく
         * 現在の匿名UIDにメール/パスワードを紐付けます。
         *
         * これによりFirestoreの学習履歴を維持できます。
         */

        if (
            auth.currentUser &&
            auth.currentUser.isAnonymous
        ) {

            const credential =
                firebase.auth.EmailAuthProvider
                    .credential(
                        email,
                        password
                    );


            await auth.currentUser
                .linkWithCredential(credential);


            currentUser =
                auth.currentUser;


            updateHeader();
            updateAccountPage();


            showAuthMessage(
                "アカウントを登録しました。学習履歴も引き継がれています。"
            );

            return;
        }


        /*
         * 匿名ではない状態なら通常の新規登録。
         */

        await auth.createUserWithEmailAndPassword(
            email,
            password
        );


        showAuthMessage(
            "アカウントを作成しました。"
        );

    } catch (error) {

        console.error("認証エラー:", error);

        showAuthMessage(
            getAuthErrorMessage(error)
        );

    } finally {

        setAuthButtonDisabled(false);
    }
}


/* =========================================================
   認証エラーメッセージ
========================================================= */

function getAuthErrorMessage(error) {

    switch (error.code) {

        case "auth/invalid-email":

            return "メールアドレスの形式が正しくありません。";

        case "auth/user-not-found":

            return "このメールアドレスのアカウントが見つかりません。";

        case "auth/wrong-password":

            return "パスワードが正しくありません。";

        case "auth/invalid-credential":

            return "メールアドレスまたはパスワードが正しくありません。";

        case "auth/email-already-in-use":

            return "このメールアドレスはすでに使用されています。";

        case "auth/credential-already-in-use":

            return "このメールアドレスはすでに別のアカウントで使用されています。";

        case "auth/provider-already-linked":

            return "このログイン方法はすでに登録されています。";

        case "auth/weak-password":

            return "パスワードが弱すぎます。6文字以上で設定してください。";

        case "auth/operation-not-allowed":

            return "Firebase側でこのログイン方法が有効になっていません。";

        case "auth/too-many-requests":

            return "試行回数が多すぎます。しばらく時間を置いてください。";

        case "auth/network-request-failed":

            return "ネットワークエラーが発生しました。接続を確認してください。";

        default:

            return "認証に失敗しました。もう一度お試しください。";
    }
}


/* =========================================================
   認証メッセージ
========================================================= */

function showAuthMessage(message) {

    const element =
        document.getElementById("authMessage");

    if (element) {

        element.textContent =
            message;
    }
}


function clearAuthMessage() {

    const element =
        document.getElementById("authMessage");

    if (element) {

        element.textContent = "";
    }
}


function setAuthButtonDisabled(disabled) {

    const button =
        document.getElementById("authButton");

    if (button) {

        button.disabled = disabled;
    }
}


/* =========================================================
   匿名アカウントで試す
========================================================= */

async function startAsAnonymous() {

    if (!auth) {
        return;
    }


    const message =
        document.getElementById("homeMessage");


    if (message) {

        message.textContent =
            "準備しています...";
    }


    try {

        /*
         * すでにログイン済みならそのまま使う。
         */

        if (auth.currentUser) {

            currentUser =
                auth.currentUser;

            showPage("sheetPage");

            return;
        }


        await auth.signInAnonymously();

    } catch (error) {

        console.error(
            "匿名ログインエラー:",
            error
        );


        if (message) {

            message.textContent =
                "お試し利用を開始できませんでした。";
        }
    }
}


/* =========================================================
   ログアウト
========================================================= */

async function logout() {

    if (!auth) {
        return;
    }


    try {

        await auth.signOut();

        /*
         * onAuthStateChanged() が
         * 自動的にトップ画面へ移動します。
         */

    } catch (error) {

        console.error(
            "ログアウトエラー:",
            error
        );


        const message =
            document.getElementById("accountMessage");


        if (message) {

            message.textContent =
                "ログアウトに失敗しました。";
        }
    }
}


/* =========================================================
   ログイン後の初期化
========================================================= */

async function initializeAppAfterLogin() {

    try {

        await loadSheets();

        await loadProgress();

        renderSheetList();

        loadProgressSheetList();

    } catch (error) {

        console.error(
            "アプリ初期化エラー:",
            error
        );
    }
}


/* =========================================================
   Google Sheets
========================================================= */

async function loadSheets() {

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
        (data.sheets || [])
            .map(sheet => ({

                title:
                    sheet.properties.title,

                sheetId:
                    sheet.properties.sheetId

            }));


    return SHEETS;
}


/* =========================================================
   シートのデータ取得
========================================================= */

async function fetchSheetCSV(sheetName) {

    const range =
        encodeURIComponent(
            `'${sheetName}'`
        );


    const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}` +
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


/* =========================================================
   CSV / Sheetデータ解析
========================================================= */

function parseSheetData(values) {

    if (!values || values.length < 2) {

        return [];
    }


    const headers =
        values[0].map(
            header =>
                String(header || "")
                    .trim()
                    .toLowerCase()
        );


    const frontIndex =
        findColumnIndex(
            headers,
            [
                "表面",
                "front",
                "word",
                "単語",
                "英語"
            ]
        );


    const backIndex =
        findColumnIndex(
            headers,
            [
                "裏面",
                "back",
                "meaning",
                "意味",
                "日本語"
            ]
        );


    /*
     * ヘッダーが見つからない場合は
     * 1列目 → 表面
     * 2列目 → 裏面
     */

    const actualFrontIndex =
        frontIndex >= 0
            ? frontIndex
            : 0;


    const actualBackIndex =
        backIndex >= 0
            ? backIndex
            : 1;


    const words = [];


    for (
        let i = 1;
        i < values.length;
        i++
    ) {

        const row =
            values[i];


        const front =
            String(
                row[actualFrontIndex] || ""
            ).trim();


        const back =
            String(
                row[actualBackIndex] || ""
            ).trim();


        if (!front || !back) {

            continue;
        }


        words.push({

            front,
            back

        });
    }


    return words;
}


/* =========================================================
   列検索
========================================================= */

function findColumnIndex(headers, names) {

    for (const name of names) {

        const index =
            headers.indexOf(
                name.toLowerCase()
            );


        if (index >= 0) {

            return index;
        }
    }


    return -1;
}


/* =========================================================
   ジャンル一覧
========================================================= */

function renderSheetList() {

    const container =
        document.getElementById("sheetList");


    if (!container) {
        return;
    }


    if (SHEETS.length === 0) {

        container.innerHTML =
            "<p>ジャンルが見つかりません。</p>";

        return;
    }


    container.innerHTML = "";


    SHEETS.forEach((sheet) => {

        const button =
            document.createElement("button");


        button.className =
            "sheet-option";


        button.textContent =
            sheet.title;


        button.onclick = () => {

            selectSheet(sheet);
        };


        container.appendChild(
            button
        );
    });
}


/* =========================================================
   ジャンル選択
========================================================= */

async function selectSheet(sheet) {

    selectedSheet = sheet;


    const container =
        document.getElementById("sheetList");


    if (container) {

        const buttons =
            container.querySelectorAll(
                ".sheet-option"
            );


        buttons.forEach(button => {

            button.classList.toggle(
                "selected",
                button.textContent === sheet.title
            );
        });
    }


    const startButton =
        document.getElementById("startButton");


    if (startButton) {

        startButton.disabled = false;
    }
}


/* =========================================================
   学習開始前
========================================================= */

async function startStudy() {

    if (!selectedSheet) {
        return;
    }


    const message =
        document.getElementById(
            "settingsMessage"
        );


    if (message) {

        message.textContent =
            "単語を読み込んでいます...";
    }


    try {

        const values =
            await fetchSheetCSV(
                selectedSheet.title
            );


        studyWords =
            parseSheetData(values);


        if (studyWords.length === 0) {

            if (message) {

                message.textContent =
                    "このジャンルには単語がありません。";
            }

            return;
        }


        updateFormatLabels();

        updateBeginStudyButton();

        showPage("settingsPage");

    } catch (error) {

        console.error(
            "単語取得エラー:",
            error
        );


        if (message) {

            message.textContent =
                "単語の読み込みに失敗しました。";
        }
    }
}


/* =========================================================
   学習設定
========================================================= */

function selectSetting(button) {

    const setting =
        button.dataset.setting;


    const value =
        button.dataset.value;


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


    updateBeginStudyButton();
}


/* =========================================================
   学習開始ボタン
========================================================= */

function updateBeginStudyButton() {

    const button =
        document.getElementById(
            "beginStudyButton"
        );


    if (!button) {
        return;
    }


    button.disabled =
        !selectedSheet ||
        studyWords.length === 0;
}


/* =========================================================
   表面 / 裏面ラベル
========================================================= */

function updateFormatLabels() {

    const front =
        document.getElementById(
            "frontToBackLabel"
        );


    const back =
        document.getElementById(
            "backToFrontLabel"
        );


    if (front) {

        front.textContent =
            "表面 → 裏面";
    }


    if (back) {

        back.textContent =
            "裏面 → 表面";
    }
}


/* =========================================================
   学習開始
========================================================= */

async function beginStudy() {

    if (!studyWords.length) {
        return;
    }


    let words =
        [...studyWords];


    /*
     * 学習モード
     */

    if (studySettings.mode === "weak") {

        words =
            words.filter(word => {

                const data =
                    getWordProgress(word);


                if (!data.total) {
                    return false;
                }


                return (
                    data.wrong /
                    data.total
                ) >= 0.41;
            });
    }


    if (studySettings.mode === "unlearned") {

        words =
            words.filter(word => {

                const data =
                    getWordProgress(word);


                return data.total === 0;
            });
    }


    if (studySettings.mode === "incorrect") {

        words =
            words.filter(word => {

                const data =
                    getWordProgress(word);


                return data.wrong > 0;
            });
    }


    if (words.length === 0) {

        const message =
            document.getElementById(
                "settingsMessage"
            );


        if (message) {

            message.textContent =
                "条件に該当する単語がありません。";
        }


        return;
    }


    shuffleArray(words);


    /*
     * 問題数
     */

    if (studySettings.count !== "unlimited") {

        const count =
            Number(
                studySettings.count
            );


        words =
            words.slice(
                0,
                count
            );
    }


    studyWords =
        words;


    currentIndex = 0;

    sessionResults = [];

    sessionCorrect = 0;

    sessionAnswered = 0;


    const sheetName =
        document.getElementById(
            "currentSheetName"
        );


    if (sheetName) {

        sheetName.textContent =
            selectedSheet.title;
    }


    showPage("studyPage");

    showQuestion();
}


/* =========================================================
   問題表示
========================================================= */

function showQuestion() {

    if (
        currentIndex >=
        studyWords.length
    ) {

        finishStudy();

        return;
    }


    currentWord =
        studyWords[currentIndex];


    const question =
        document.getElementById(
            "question"
        );


    const questionType =
        document.getElementById(
            "questionType"
        );


    const choices =
        document.getElementById(
            "choices"
        );


    const result =
        document.getElementById(
            "result"
        );


    const nextButton =
        document.getElementById(
            "nextButton"
        );


    if (nextButton) {

        nextButton.style.display =
            "none";
    }


    if (result) {

        result.textContent = "";
    }


    if (!question || !choices) {
        return;
    }


    choices.innerHTML = "";


    const isFrontToBack =
        studySettings.format ===
        "frontToBack";


    const questionText =
        isFrontToBack
            ? currentWord.front
            : currentWord.back;


    const answerText =
        isFrontToBack
            ? currentWord.back
            : currentWord.front;


    if (questionType) {

        questionType.textContent =
            isFrontToBack
                ? "表面 → 裏面"
                : "裏面 → 表面";
    }


    question.textContent =
        questionText;


    /*
     * 正解 + 他の選択肢
     */

    const candidateWords =
        studyWords.filter(
            word =>
                word !== currentWord
        );


    shuffleArray(candidateWords);


    const otherChoices =
        candidateWords
            .slice(0, 3)
            .map(word =>
                isFrontToBack
                    ? word.back
                    : word.front
            );


    const choiceTexts =
        [
            answerText,
            ...otherChoices
        ];


    shuffleArray(choiceTexts);


    choiceTexts.forEach(
        choiceText => {

            const button =
                document.createElement(
                    "button"
                );


            /*
             * CSSの .choice と一致させる
             */

            button.className =
                "choice";


            button.textContent =
                choiceText;


            button.onclick = () => {

                answerQuestion(
                    choiceText,
                    answerText,
                    button
                );
            };


            choices.appendChild(
                button
            );
        }
    );


    updateSessionInfo();
}


/* =========================================================
   回答
========================================================= */

async function answerQuestion(
    selectedAnswer,
    correctAnswer,
    clickedButton
) {

    const choices =
        document.getElementById(
            "choices"
        );


    const buttons =
        choices
            ? choices.querySelectorAll(
                "button"
            )
            : [];


    /*
     * 回答後はすべての選択肢を無効化
     */

    buttons.forEach(
        button => {

            button.disabled = true;

        }
    );


    const isCorrect =
        selectedAnswer ===
        correctAnswer;


    sessionAnswered++;


    if (isCorrect) {

        sessionCorrect++;
    }


    sessionResults.push({

        word: currentWord,
        correct: isCorrect

    });


    /*
     * Firestoreへ保存
     */

    await recordAnswer(
        currentWord,
        isCorrect
    );


    const result =
        document.getElementById(
            "result"
        );


    if (result) {

        result.textContent =
            isCorrect
                ? "正解！"
                : `不正解。正解は「${correctAnswer}」です。`;
    }


    /*
     * 選択したボタンの色
     *
     * 正解 → correct
     * 不正解 → wrong
     */

    if (clickedButton) {

        clickedButton.classList.add(
            isCorrect
                ? "correct"
                : "wrong"
        );
    }


    /*
     * 不正解だった場合、
     * 正解の選択肢も薄緑にする。
     */

    if (!isCorrect) {

        buttons.forEach(button => {

            if (
                button.textContent ===
                correctAnswer
            ) {

                button.classList.add(
                    "correct"
                );
            }

        });
    }


    const nextButton =
        document.getElementById(
            "nextButton"
        );


    if (nextButton) {

        nextButton.style.display =
            "block";
    }


    updateSessionInfo();
}


/* =========================================================
   次の問題
========================================================= */

function nextQuestion() {

    currentIndex++;

    showQuestion();
}


/* =========================================================
   セッション情報
========================================================= */

function updateSessionInfo() {

    const progressElement =
        document.getElementById(
            "sessionProgress"
        );


    const accuracyElement =
        document.getElementById(
            "sessionAccuracy"
        );


    if (progressElement) {

        progressElement.textContent =
            `${Math.min(
                currentIndex + 1,
                studyWords.length
            )} / ${studyWords.length}問`;
    }


    const accuracy =
        sessionAnswered === 0
            ? 0
            : Math.round(
                sessionCorrect /
                sessionAnswered *
                100
            );


    if (accuracyElement) {

        accuracyElement.textContent =
            `正答率 ${accuracy}%`;
    }
}


/* =========================================================
   学習終了
========================================================= */

function finishStudy() {

    const question =
        document.getElementById(
            "question"
        );


    const choices =
        document.getElementById(
            "choices"
        );


    const result =
        document.getElementById(
            "result"
        );


    const nextButton =
        document.getElementById(
            "nextButton"
        );


    if (question) {

        question.textContent =
            "学習終了！";
    }


    if (choices) {

        choices.innerHTML = "";
    }


    if (result) {

        const accuracy =
            sessionAnswered === 0
                ? 0
                : Math.round(
                    sessionCorrect /
                    sessionAnswered *
                    100
                );


        result.textContent =
            `${sessionAnswered}問中 ${sessionCorrect}問正解（正答率 ${accuracy}%）`;
    }


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
                ? "block"
                : "none";
    }
}


/* =========================================================
   間違えた問題を復習
========================================================= */

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


    if (wrongWords.length === 0) {
        return;
    }


    studyWords =
        wrongWords;


    currentIndex = 0;

    sessionResults = [];

    sessionCorrect = 0;

    sessionAnswered = 0;


    showQuestion();
}


/* =========================================================
   ジャンル変更
========================================================= */

function changeStudySheet() {

    selectedSheet = null;

    studyWords = [];

    currentIndex = 0;


    const startButton =
        document.getElementById(
            "startButton"
        );


    if (startButton) {

        startButton.disabled =
            true;
    }


    renderSheetList();

    showPage("sheetPage");
}


/* =========================================================
   ジャンル選択へ戻る
========================================================= */

function backToSheetSelection() {

    showPage("sheetPage");
}


/* =========================================================
   Firestore：進捗取得
========================================================= */

async function loadProgress() {

    if (
        !db ||
        !currentUser ||
        currentUser.isAnonymous
    ) {

        progress = {};

        return;
    }


    try {

        const snapshot =
            await db
                .collection("users")
                .doc(currentUser.uid)
                .collection("progress")
                .get();


        progress = {};


        snapshot.forEach(
            document => {

                progress[
                    document.id
                ] =
                    document.data();

            }
        );

    } catch (error) {

        console.error(
            "進捗読み込みエラー:",
            error
        );
    }
}


/* =========================================================
   Firestore：単語の進捗取得
========================================================= */

function getProgressDocumentId(
    sheetName
) {

    return sanitizeId(
        sheetName
    );
}


function getWordKey(word) {

    return sanitizeId(
        word.front
    );
}


function sanitizeId(text) {

    return String(text)
        .replace(
            /[\/\\.#$[\]]/g,
            "_"
        )
        .replace(
            /\s+/g,
            "_"
        )
        .slice(
            0,
            120
        );
}


function getWordProgress(word) {

    if (!selectedSheet) {

        return {
            correct: 0,
            wrong: 0,
            total: 0
        };
    }


    const sheetKey =
        getProgressDocumentId(
            selectedSheet.title
        );


    const sheetProgress =
        progress[sheetKey] || {};


    return sheetProgress[
        getWordKey(word)
    ] || {

        correct: 0,
        wrong: 0,
        total: 0

    };
}


/* =========================================================
   Firestore：回答保存
========================================================= */

async function recordAnswer(
    word,
    isCorrect
) {

    if (
        !db ||
        !currentUser ||
        currentUser.isAnonymous
    ) {

        return;
    }


    const sheetKey =
        getProgressDocumentId(
            selectedSheet.title
        );


    const wordKey =
        getWordKey(word);


    const current =
        getWordProgress(word);


    const updated = {

        correct:
            current.correct +
            (isCorrect ? 1 : 0),

        wrong:
            current.wrong +
            (isCorrect ? 0 : 1),

        total:
            current.total + 1,

        lastAnswered:
            firebase.firestore
                .FieldValue
                .serverTimestamp()

    };


    if (!progress[sheetKey]) {

        progress[sheetKey] = {};
    }


    progress[sheetKey][wordKey] =
        updated;


    try {

        await db
            .collection("users")
            .doc(currentUser.uid)
            .collection("progress")
            .doc(sheetKey)
            .set(
                {
                    [wordKey]: updated
                },
                {
                    merge: true
                }
            );

    } catch (error) {

        console.error(
            "進捗保存エラー:",
            error
        );
    }
}


/* =========================================================
   学習状況：ジャンル一覧
========================================================= */

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


    SHEETS.forEach(sheet => {

        const button =
            document.createElement(
                "button"
            );


        button.className =
            "sheet-option";


        button.textContent =
            sheet.title;


        button.onclick = async () => {

            selectedSheet =
                sheet;


            await renderProgress(
                sheet
            );
        };


        container.appendChild(
            button
        );
    });
}


/* =========================================================
   学習状況表示
========================================================= */

async function renderProgress(
    sheet
) {

    selectedSheet = sheet;


    const name =
        document.getElementById(
            "progressSheetName"
        );


    if (name) {

        name.textContent =
            sheet.title;
    }


    let values;


    try {

        values =
            await fetchSheetCSV(
                sheet.title
            );

    } catch (error) {

        console.error(
            error
        );

        return;
    }


    const words =
        parseSheetData(
            values
        );


    const sheetKey =
        getProgressDocumentId(
            sheet.title
        );


    const sheetProgress =
        progress[sheetKey] || {};


    let totalQuestions = 0;

    let totalCorrect = 0;

    let currentStreak = 0;

    let bestStreak = 0;


    const buckets = [
        0,
        0,
        0,
        0,
        0,
        0
    ];


    const wordData = [];


    words.forEach(word => {

        const data =
            sheetProgress[
                getWordKey(word)
            ] || {

                correct: 0,
                wrong: 0,
                total: 0

            };


        totalQuestions +=
            data.total;


        totalCorrect +=
            data.correct;


        if (data.total === 0) {

            buckets[5]++;

        } else {

            const wrongRate =
                data.wrong /
                data.total *
                100;


            if (wrongRate <= 20) {

                buckets[0]++;

            } else if (wrongRate <= 40) {

                buckets[1]++;

            } else if (wrongRate <= 60) {

                buckets[2]++;

            } else if (wrongRate <= 80) {

                buckets[3]++;

            } else {

                buckets[4]++;
            }
        }


        wordData.push({

            word,
            ...data

        });
    });


    const overallAccuracy =
        totalQuestions === 0
            ? 0
            : Math.round(
                totalCorrect /
                totalQuestions *
                100
            );


    setText(
        "totalQuestions",
        totalQuestions
    );


    setText(
        "overallAccuracy",
        `${overallAccuracy}%`
    );


    setText(
        "currentStreak",
        currentStreak
    );


    setText(
        "bestStreak",
        bestStreak
    );


    buckets.forEach(
        (count, index) => {

            setText(
                `bucket${index}`,
                `${count}単語`
            );
        }
    );


    renderWordProgressList(
        wordData
    );
}


/* =========================================================
   単語別学習状況
========================================================= */

function renderWordProgress() {

    if (!selectedSheet) {
        return;
    }


    renderProgress(
        selectedSheet
    );
}


function renderWordProgressList(
    wordData
) {

    const container =
        document.getElementById(
            "wordProgressList"
        );


    if (!container) {
        return;
    }


    const sort =
        document.getElementById(
            "wordSortSelect"
        )?.value ||
        "weak";


    const data =
        [...wordData];


    data.sort(
        (a, b) => {

            const aTotal =
                a.total || 0;

            const bTotal =
                b.total || 0;


            const aAccuracy =
                aTotal === 0
                    ? 0
                    : a.correct /
                      aTotal;


            const bAccuracy =
                bTotal === 0
                    ? 0
                    : b.correct /
                      bTotal;


            if (sort === "weak") {

                return (
                    aAccuracy -
                    bAccuracy
                );
            }


            if (sort === "accuracy") {

                return (
                    bAccuracy -
                    aAccuracy
                );
            }


            if (sort === "questions") {

                return (
                    bTotal -
                    aTotal
                );
            }


            if (sort === "unlearned") {

                return (
                    aTotal -
                    bTotal
                );
            }


            if (sort === "alphabetical") {

                return a.word.front
                    .localeCompare(
                        b.word.front
                    );
            }


            return 0;
        }
    );


    container.innerHTML = "";


    data.forEach(item => {

        const total =
            item.total || 0;


        const correct =
            item.correct || 0;


        const wrong =
            item.wrong || 0;


        const accuracy =
            total === 0
                ? 0
                : Math.round(
                    correct /
                    total *
                    100
                );


        const div =
            document.createElement(
                "div"
            );


        div.className =
            "word-progress-item";


        div.innerHTML = `
            <div>
                <strong>${escapeHtml(item.word.front)}</strong>
                <span>${escapeHtml(item.word.back)}</span>
            </div>

            <div>
                ${
                    total === 0
                        ? "未学習"
                        : `正答率 ${accuracy}% / ${total}回`
                }
            </div>
        `;


        container.appendChild(
            div
        );
    });
}


/* =========================================================
   学習状況リセット
========================================================= */

async function resetProgress() {

    if (
        !currentUser ||
        currentUser.isAnonymous ||
        !selectedSheet
    ) {

        return;
    }


    const confirmed =
        window.confirm(
            "このジャンルの学習状況をすべてリセットしますか？"
        );


    if (!confirmed) {
        return;
    }


    const sheetKey =
        getProgressDocumentId(
            selectedSheet.title
        );


    try {

        await db
            .collection("users")
            .doc(currentUser.uid)
            .collection("progress")
            .doc(sheetKey)
            .delete();


        delete progress[sheetKey];


        await renderProgress(
            selectedSheet
        );

    } catch (error) {

        console.error(
            "進捗リセットエラー:",
            error
        );
    }
}


/* =========================================================
   アカウント画面
========================================================= */

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
                "none";
        }


        return;
    }


    if (currentUser.isAnonymous) {

        if (status) {

            status.textContent =
                "匿名アカウント（お試し利用中）";
        }


        if (email) {

            email.textContent =
                "未登録";
        }


        if (registerButton) {

            registerButton.style.display =
                "block";
        }

    } else {

        if (status) {

            status.textContent =
                "ログイン中";
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


/* =========================================================
   ユーティリティ
========================================================= */

function setText(
    id,
    value
) {

    const element =
        document.getElementById(id);


    if (element) {

        element.textContent =
            value;
    }
}


function escapeHtml(text) {

    return String(text)

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


function shuffleArray(array) {

    for (
        let i = array.length - 1;
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
        ] = [
            array[j],
            array[i]
        ];
    }


    return array;
}
