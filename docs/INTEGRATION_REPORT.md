# 歴史4択統合・Cloud準備 完了報告

確認日: 2026-11-02。コミット・push・デプロイ・Cloud環境公開・本番データ操作は未実施です。

## 1. 調査で判明した実装済み機能

- `history_questions.js` に公開Google Sheetsの取得、9列ヘッダー確認、不正行・重複ID排除、4択描画、1問1回答、正誤と解説、次問・終了操作がありました。
- `index.html` の歴史セクションと `style.css` は、英単語と共通の問題ボックス・ボタン・2列グリッド・正誤クラスを使用していました。600px以下のスマートフォン用CSSも実装済みで、そのまま使用しています。
- 英単語の出題は `script.js` の `beginStudy` → `showQuestion` → 回答処理 → `finishStudy`。ID範囲、問題数、通常/高難易度、表裏の反転、同義・類似綴りの候補除外が実装済みでした。
- 既存履歴は `users/{uid}/progress/{ジャンル}` に問題キーごとの `correct, wrong, total, front, back, id, lastAnswered` を保存します。匿名/未ログインは保存しません。Firebase認証・既存学習状況表示を実装済みでした。
- 英単語のシート一覧は `history_questions` を除外します。歴史の公開シートは独立しています。
- Botの未コミット実装に公開シートへの9列転記、書込後の読戻し、曖昧な失敗時の照合、公開済み補完、単一起動ロックがありました。これらは保持しました。
- 元の削除処理は管理シートだけを削除し、公開先が残る問題がありました。

## 2. 今回の追加・修正

- 学習開始時に問題・選択肢をFisher–Yatesでシャッフル。各選択肢の正解フラグを一緒に移動し、表示番号に依存せず採点します。
- 出題数10/20/30/50/全問。英単語側の既存10/20/50/無制限の設定・処理は保持し、歴史にも同じ数の選択を用意しました。問題不足時は有効な件数だけを出題します。
- 回答済み件数、正答率、最終の出題・正解・不正解数を表示。二重回答と二重終了を防止し、古い取得応答が再開始後の状態を上書きしないようにしました。
- 空の解説をフロント・CSV取込・公開検証で許可。その他の必須列の検証は継続します。公開シートに管理用status列が混入した場合は読み込みを拒否します。
- 既存履歴保存関数にジャンル引数を追加し、歴史を予約済みの `history_questions` ドキュメント、`history_<ID>` キーへ保存します。既存英単語の呼出し方、保存フィールド、認証処理、Firestoreルールは変更していません。スキーマ変更はありません。
- 履歴保存失敗を表示し、その場の成績は維持します。英単語用の学習状況一覧には歴史を追加していません。
- Bot削除は、公開先の選択IDをA:Iのセルクリアで除去し、読戻しで不在を確認してから管理データを削除します。空行の位置を保持してタイムアウト時に照合します。途中で止まった公開処理を考慮し、draft削除でも公開先を確認します。
- 公開先と管理用に同じスプレッドシートを設定した場合はBot側で拒否します。公開処理の既存順序と9列形式は維持します。
- Service Workerのキャッシュ版を更新し、既存歴史スクリプトをアプリシェルに追加しました。
- Cloud用手順、作業ルール、セットアップスクリプト、テスト専用Firebase設定、Git除外設定を整備しました。

## 3. 今回変更したファイル

| 分類 | ファイル |
| --- | --- |
| アプリ | `history_questions.js`, `index.html`, `script.js`, `sw.js` |
| Bot | `bot/history_bot.py`, `bot/public_questions.py`, `bot/csv_validation.py`, `bot/README.md` |
| テスト | `tests/history_questions.test.mjs`, `tests/history-progress.test.mjs`, `tests/firestore.rules.test.mjs`, `tests/firestore.improved.rules.test.mjs`, `bot/tests/test_public_revocation.py`, `bot/tests/test_csv_validation.py` |
| 開発設定 | `.gitattributes`, `.gitignore`, `package.json`, `firebase.test.json`, `scripts/setup-cloud.sh`, `AGENTS.md` |
| 文書 | `README.md`, `docs/CODEX_CLOUD.md`, `docs/INTEGRATION_REPORT.md` |

`style.css` と `history-config.js` は調査のみで変更していません。`bot/public_questions.py`・`package.json`・ルールテスト等は作業開始時から未追跡でした。今回の編集を既存のローカル実装に重ねています。

開始時からの未コミット変更は `bot/.env.example`, `bot/.gitignore`, `bot/README.md`, `bot/audit_log.py`, `bot/history_bot.py`, `bot/tests/test_audit_log.py`, `bot/tests/test_history_bot_async.py`。未追跡の単一起動・公開処理とテスト、CSVサンプル、Firebase設定/ルール、Node manifest/lockもありました。今回無関係な変更は取り消していません。

## 4. テスト結果

| コマンド | 成功 | 失敗 |
| --- | ---: | ---: |
| `npm.cmd test` | 26 | 0 |
| `bot/.venv/Scripts/python.exe -m unittest discover -s bot/tests` | 58 | 0 |
| `npm.cmd run test:rules` | 6 | 0 |
| `npm.cmd run test:rules:improved` | 8 | 0 |
| 合計 | 98 | 0 |

変更前はJavaScript18件・Python51件が成功しました。追加検証では、決定的な乱数による問題/選択肢順変更、シャッフル後の正解対応、重複ID、件数不足、管理用列の拒否、不正行、解説、単一回答、正答率50%/100%、取得失敗/再取得競合、履歴保存失敗とID分離を確認しました。

英単語は表→裏・裏→表、通常/高難易度、同義選択肢除外、ID範囲/問題数、既存履歴、画面の認証制御を確認しました。Auth Emulatorで匿名アカウントからメール認証へのUID維持、Firestoreで所有者/他人/未認証とパスのアクセス制限を検証しました。

Botは実Sheets・Discordへ書き込まず、モックで公開/削除順序、draft/published/deleted検証、公開除去失敗時の管理データ保持、タイムアウト後の読戻し、空行の位置、空解説を検証しました。`node --check` と `git diff --check` も成功しています。

途中でWindowsのnpm.ps1実行制限、CLI設定へのsandbox制限、終了後に残るJavaによるポート衝突が発生しました。npm.cmd、許可されたエミュレータ実行、今回のプロセスだけの停止と専用ポートで解消して再実行しました。解説必須の旧テストは今回の任意仕様に合わせ、残る8必須列それぞれの拒否を検証するよう修正しました。最終の失敗は0件です。Discord依存の非推奨警告、および失敗を模擬した監査ログ/期限切れ操作のログはテスト失敗ではありません。

## 5. 未解決・未確認

- iPhone実機での表示、タップ操作、PWA更新は未確認です。共通CSSと既存レスポンシブ設定の再利用をコードとテストで確認しました。
- 本番Google Sheetsの権限・キー制限・実データ、本番Firebase認証は今回接続していません。
- 修正前に削除した問題が公開シートに残っている可能性があります。現在の9列公開データだけから元の削除状態は判定できないため、運用者がIDを照合してください。今回、過去データの削除や自動修復はしていません。
- 公開/削除は単一Botプロセスが前提です。Sheetsの手動同時編集や別マシンからの同時運用は避けてください。
- 歴史の累積履歴一覧画面はありません。履歴は既存形式で保存し、今回の進捗/成績を歴史画面に表示します。
- CloudのLinux環境でのセットアップ実行、GitHub接続、iPhoneからの利用可否は未確認です。

## 6. Git・秘密情報・Cloud準備

`git ls-remote` によるGitHub mainとローカルHEADの比較は一致（`3751cba02602daa030e1ff71278329ccf98678fa`）。未コミット差分はGitHubに未反映です。

Git管理中28ファイルについて、秘密ファイル名の該当0件、秘密鍵/service_accountの代表的な内容シグネチャ0件。Git履歴のファイル名にも該当の秘密ファイル名は検出されませんでした。秘密値は出力していません。この確認は全履歴の任意の秘密文字列を保証するものではありません。`.env`・`bot/.env`・サービスアカウントJSON・Firebase管理者鍵の代表名が `git check-ignore` で除外されることを確認しました。

依存関係は既存 `package-lock.json` と `bot/requirements.lock` を再利用します。Node24.12以降、Python3.14、Java21以降でのセットアップを文書化しました。CloudにBotトークンや管理者鍵を渡す必要はありません。Cloud導入手順と現在の公式資料は [CODEX_CLOUD.md](CODEX_CLOUD.md) に記載しました。

## 7. 手動操作とGitHub反映前の確認

1. 差分をレビューし、既存の未コミット作業と今回の変更を含める範囲を選択する。特に未追跡の公開処理、単一起動ロック、Node依存関係、テストを漏らさない。
2. `.env`・サービスアカウント鍵・管理者鍵・ローカル監査ログを含めない。CSVサンプルを反映するか判断する。Firebaseルール改善案は本番未反映の別差分として確認する。
3. 公開先と管理用の分離、公開APIキー制限、過去の削除ID残存を運用者が確認する。
4. iPhoneで英単語/歴史の表示と操作、PWA更新を確認する。
5. 明示承認後にコミット・pushを別作業で実施し、本人がGitHubをCloudへ接続する。
6. Cloudでセットアップ/テスト結果を確認し、本人の承認後に環境を公開する。アプリの本番デプロイはさらに別途承認する。

## 8. GitHub反映前の最終レビュー（2026-11-02）

結論: 下記の修正後、レビュー範囲でGitHubへのコード反映を妨げる不具合や秘密情報混入は見つかっていません。ステージ済みファイルは0件です。コミット・push・デプロイ・本番データ操作は行っていません。反映するファイルの選定と本人承認が必要です。

### 発見して修正した点

- Botの公開先除去だけのロックでは、その後の管理データ削除前に別の公開・補完操作が割り込めました。`import`・`publish`・`repair-publish`・`delete` の読み取りから管理データ更新までを単一の非同期ロックで直列化しました。Discordへの初期応答はロック待機前に行います。同時実行テストで、管理削除が完了するまで補完が待機することを確認しました。
- 公開先除去失敗時の管理データ保持テストを、照合失敗に加えてタイムアウト・権限エラーにも拡張しました。
- Bot READMEの「英単語側のAPIキーを使わない」という記載を修正しました。接続設定ファイルは別ですが、現在のブラウザ用APIキーは共有しています。値は変更していません。
- Cloudスクリプトの改行を `.gitattributes` でLFに指定し、文書に「セットアップでJS/Pythonテスト、ルールテストは別実行」という実際の範囲を明記しました。

### 確認範囲・結果

- 追跡済み28ファイルと未追跡25ファイルの合計53ファイルを秘密情報検査の候補として確認しました。秘密ファイル名、秘密鍵・service_account・GitHub/Discordトークンの代表的な形式の検出は0件。秘密ファイルの内容や検出対象の値は出力していません。任意の秘密文字列や全Git履歴までの完全保証ではありません。
- `.env`、`.env.local`、`bot/.env`、サービスアカウント鍵、秘密鍵、Firebase管理者鍵、secretsディレクトリの代表名はGit除外対象です。`.env.example` は変数名・テンプレートとして確認しました。
- Node manifestとlockの開発依存関係は一致。lock内のパッケージ取得先ホストは `registry.npmjs.org` のみでした。依存関係の脆弱性監査を実施したという意味ではありません。
- 歴史の正解フラグ・選択肢対応、シャッフル、ID分離、保存フィールド、英単語の既定引数維持を確認しました。歴史/英単語の関連JavaScriptテスト26件、Bot全体58件を今回再実行し、84件成功・失敗0件でした。
- Firestore/認証の14件は前段階で成功済みです。今回、認証・履歴・ルール・ルールテストは変更していないため再実行していません。上の98件は今回再実行84件と前段階の14件の合計です。
- `bash -n scripts/setup-cloud.sh`、`git diff --check` は成功。未追跡ファイルについても末尾空白・空白のみの末尾行を別途検査しました。CloudのLinux上でインストール・セットアップを完走させたわけではありません。
- CSVサンプル3件はいずれも1問の有効な9列データでした。

### 全変更ファイル一覧（追跡済み変更14、未追跡25）

| 区分 | ファイル |
| --- | --- |
| アプリ | `history_questions.js`, `index.html`, `script.js`, `sw.js` |
| Botコード・設定・文書 | `bot/.env.example`, `bot/.gitignore`, `bot/README.md`, `bot/audit_log.py`, `bot/csv_validation.py`, `bot/history_bot.py`, `bot/instance_lock.py`, `bot/public_questions.py` |
| Botテスト | `bot/tests/test_audit_log.py`, `bot/tests/test_csv_validation.py`, `bot/tests/test_history_bot_async.py`, `bot/tests/test_instance_lock.py`, `bot/tests/test_public_questions.py`, `bot/tests/test_public_revocation.py` |
| CSVサンプル | `bot/test_import_one.csv`, `bot/test_publish.csv`, `bot/test_publish_japanese.csv` |
| JavaScript/ルールテスト | `tests/history_questions.test.mjs`, `tests/history-progress.test.mjs`, `tests/firestore.rules.test.mjs`, `tests/firestore.improved.rules.test.mjs` |
| Firebase設定・ルール | `firebase.json`, `firebase.improved.json`, `firebase.test.json`, `firestore.rules`, `firestore.improved.rules` |
| 開発・Cloud設定 | `.gitattributes`, `.gitignore`, `AGENTS.md`, `package.json`, `package-lock.json`, `scripts/setup-cloud.sh` |
| 文書 | `README.md`, `docs/CODEX_CLOUD.md`, `docs/INTEGRATION_REPORT.md` |

### 残る手動確認・セキュリティ上の制約

上記の未確認事項は継続します。iPhoneの実表示/PWA更新、Cloud接続・Linuxセットアップ、Google側の公開範囲/APIキー制限、修正前の削除IDの残存を本人が確認してください。複数マシン/別コピーのBotやSheets手動編集は非同期ロックの保護外です。Firebaseルール改善案は別途レビュー対象であり、GitHub反映の承認は本番ルール変更の承認を意味しません。匿名ユーザーの保存抑止は現在アプリ側で行い、提示済みルール自体は匿名認証も本人として扱います。
