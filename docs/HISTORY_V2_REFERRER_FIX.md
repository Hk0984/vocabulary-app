# ローカルSheets接続403：原因と本人操作（2026-11-03）

追記：本人の許可リファラー追加後、Chrome・Edgeの実接続必須テストは全6件成功し、403は解消した。`HISTORY_V2_LIVE_WEB_RESULT.md` を参照。以下は修正前の調査記録。

## 原因の確定範囲

Chrome・Edgeの実リクエストをCDPで採取し、下表を確認した。APIキー・キー付きURL・認証情報は記録していない。

| 項目 | Chrome | Edge |
|---|---|---|
| 検証ページURL | `http://127.0.0.1:8765/` | 同左 |
| 実際に送信したReferer | `http://127.0.0.1:8765/` | 同左 |
| リクエストのReferrer-Policy | `strict-origin-when-cross-origin` | 同左 |
| Sheets APIメソッド | GET、新公開用ブックの `history_questions` | 同左 |
| ステータス | 403 | 403 |
| Google側の理由 | `API_KEY_HTTP_REFERRER_BLOCKED` | 同左 |

HTMLのreferrerメタ設定、配信サーバーのReferrer-Policyヘッダー、fetchのreferrerPolicy上書きは指定していない。
表のポリシーはリクエストで観測したブラウザの有効値であり、API応答ヘッダーの値ではない。
実際のRefererは欠落しておらず、Google側のWebサイト制限がこの送信元を拒否している。
Consoleの許可一覧自体は今回取得していないため、「未登録」か「登録文字列の不一致」かまでは未確定。

以前のテストは `server.listen(0, '127.0.0.1')` により毎回ポートを割り当てており、過去ログには正確なポートを残していなかった。
今回は既定を **8765番固定**に変更し、実URL・Referer・ポリシー・HTTPステータスを記録するようにした。
ポート使用中なら停止し、別ポートへの自動変更はしない。テスト終了時にサーバーも停止するため、現在常駐するWebサーバーはない。
CDP用のデバッグポートは別のランダムポートで、Google Cloudの許可対象ではない。

## 使用キーの対応（値は非表示）

- 新環境ビルドの世界史ローダーは、ビルド内 `history-config.js` の `window.HISTORY_QUESTIONS_CONFIG.apiKey` を使用する。
- ビルド処理は元の `history-config.js` からそのキーを継承し、公開用IDなどだけを上書きしている。
- メモリ内の比較で、このキーは `script.js` の `GOOGLE_SHEETS_API_KEY` とも同一であることを確認した。
- したがって「どちらか別のキーが使われた」のではなく、**世界史専用設定から参照した、汎用Sheets設定と同じキー**が拒否されている。
- Firebase用キーの設定変更は不要。キーのCloud上の表示名・所属プロジェクトは本人がConsoleで照合する。

## ここで本人が行う操作

**Cloud設定は今回変更していない。次を実施してから再検証する。**

1. [Google Cloud Console → APIとサービス → 認証情報](https://console.cloud.google.com/apis/credentials) を開き、上記Web用Sheetsキーが所属するプロジェクトを選ぶ。Firebaseプロジェクトと同じだとは決め付けない。
2. 使用中のキーを本人の画面内で照合する。必要ならローカルの `history-config.js` の値と比較するが、キーをチャット・スクリーンショット・ログへ貼り付けない。
3. 現在の許可リファラーとAPI制限を控える。**既存の本番Web用項目は全て保持する。**
4. 「アプリケーションの制限」は **ウェブサイト（HTTPリファラー）** のまま、次の2項目を追加する。

```text
http://127.0.0.1:8765
http://127.0.0.1:8765/*
```

5. 「APIの制限」は **キーを制限** を維持し、**Google Sheets API (`sheets.googleapis.com`)** が許可されていることを確認する。既存の必要なAPI許可は削除せず、制限なしへ変更しない。
6. 保存し、設定の反映を待つ。新旧Sheetsの共有・セルやFirebaseの設定は変更しない。
7. キーを送らず、「対象キーに上記2項目を追加した」と知らせる。その後Chrome・Edgeを再実行する。

今回は `127.0.0.1` に固定しているため `localhost` 用の許可は不要。同じPCでも別ホスト名として扱われる。
本番URLをRefererとして偽装する回避や、Referrer-Policyを弱める変更は行わない。
ポート省略による全ポート許可や全サイトワイルドカードも使わない。

Google公式資料では、Webサイト制限にポート番号を指定でき、指定した場合はそのポートだけが一致する。
また、クロスオリジンではパスを含まないRefererになる場合があるため、観測した送信元に合わせる。
根拠：[Google Cloud：APIキーのWebサイト制限](https://docs.cloud.google.com/docs/authentication/api-keys#adding_http_referrer_restrictions)。

## ローカル専用キーを使う場合

本番キーにローカル許可を追加したくない場合は、本人が**標準APIキー**を別に作成し、
表示名の例を `history-v2-local-web`、Webサイト制限を上記2項目、API制限をGoogle Sheets APIだけにする。
サービスアカウント紐付けキーや管理者認証情報はブラウザに使わない。
Sheets APIが有効なプロジェクトで、公開データ読み取り用として用意する。

キーはGit除外の `local-history/history-web-api-key.local.txt` に本人がローカル保存し、チャットへ送らない。
現在のビルダーは別キーのファイル指定をサポートしていないため、**このファイルを置くだけでは切り替わらない**。
この方式を選ぶ場合は、次回ローカル限定の注入方法を準備・検証してから使用する。
元の `history-config.js` や生成済み成果物を手編集しない。後者はrelease.jsonやPWAのハッシュと不整合になる。
現時点では新規キーも入力ファイルも作成していない。

## 設定変更後の再実行

作業ディレクトリはリポジトリ直下。既に生成済みの新環境成果物を使い、サーバーはテストが起動・終了する。
Chrome・Edgeは隔離された実ブラウザ（headless）、本番認証とFirestore通信は無効化したまま。

```powershell
$env:UI_WEB_ARTIFACT = 'dist/history-v2-live-web-20261103'
$env:UI_PUBLIC_VALUES = 'local-history/history-v2-public-live-values.json'
$env:UI_PORT = '8765'
$env:UI_REQUIRE_LIVE = '1'
$env:UI_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test tests/history-v2-web.browser.mjs
$env:UI_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node --test tests/history-v2-web.browser.mjs
```

`UI_REQUIRE_LIVE=1` は実接続必須モード。403はスキップで成功に見せず失敗として扱い、取得済みデータの再生にはフォールバックしない。
接続成功後は、ジャンル選択時にも実際の新公開用GETを行い、13列・1問取得からフィルタ・4択・採点・解説まで試験する。
英単語・古文のデータだけは既存のモックを維持し、本番書き込みを行わない。

## 今回の結果と記録

- Chrome：実接続1件失敗（403）、後続2件は未実施。
- Edge：実接続1件失敗（403）、後続2件は未実施。
- 依頼の「設定修正後の取得・操作・未完了2件の解消」は**本人操作待ち**。
- 取得済みデータの再生で成功した前回の試験とは分けている。
- Chrome証跡：`dist/history-v2-browser-rbXGzm/verification.json`。
- Edge証跡：`dist/history-v2-browser-XuDEYN/verification.json`。
- 変更：`tests/history-v2-web.browser.mjs` と本資料のみ。アプリ本体・Web用キー・Sheets接続設定の変更なし。
- Sheets書き込み、Cloud設定変更、コミット・push・デプロイなし。
