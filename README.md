# vocabulary-app

現在の世界史方針は **新しい別Sheets環境での再構築**です。[docs/HISTORY_REBUILD.md](docs/HISTORY_REBUILD.md) に初期化・候補化・承認・新旧切替と復旧をまとめています。旧430問の管理シート移行は必須ではありません。

世界史分類v1のローカル実装・13列移行準備は [docs/HISTORY_V1_MIGRATION.md](docs/HISTORY_V1_MIGRATION.md) を参照してください。Sheets移行・Bot再起動・公開は別途承認後です。

既存URLを更新する公開準備・成果物の許可リスト・公開後の検証手順は [docs/WEB_RELEASE.md](docs/WEB_RELEASE.md) を参照してください。`npm run build:web` はローカル成果物だけを作成し、デプロイしません。

英単語学習と、Discord Botから公開した世界史4択問題を扱う静的Webアプリです。

## ローカル確認

Node.js 24.12以降、Python 3.14、ルールテストにはJava 21以降を使用します。

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r bot/requirements.lock
npm test
.venv/bin/python -m unittest discover -s bot/tests
npm run test:rules
npm run test:rules:improved
```

Windowsでは既存の `bot/.venv/Scripts/python.exe` と `npm.cmd` を利用できます。テストはモックとローカルエミュレータを使用し、Botの起動や本番認証情報は不要です。画面確認用のサーバーは `python3 -m http.server 8000 --bind 127.0.0.1` で起動できます。実アプリは既存の本番Firebase設定を読むため、書き込みを避ける場合はログインせず確認してください。

## 世界史4択

`history-config.js` の公開専用シートを取得します。管理用シートのURL・サービスアカウント鍵をブラウザに設定しないでください。9列のヘッダーを厳密に確認し、不正行・重複IDを除外します。末尾の解説は空欄でも利用できます。

問題順と選択肢順は学習開始時にシャッフルします。問題数は10・20・30・50・全問から選択し、在庫が少なければその件数で終了します。英単語と共通のボタン・2列表示・正誤CSSを使用し、正答率と回答済み件数、終了時の正解・不正解数を表示します。

ログイン済みの非匿名ユーザーは既存の履歴形式で `users/{uid}/progress/history_questions` に保存します。英単語の `id_*` と区別した `history_<ID>` キーを使います。匿名・未ログインでは保存しません。現在の「学習状況」ジャンル一覧は英単語用のため、歴史の累積履歴一覧は表示しません。歴史の画面には今回の進捗と結果を表示します。

Botの公開・削除は [bot/README.md](bot/README.md)、Cloudの手動接続と再現手順は [docs/CODEX_CLOUD.md](docs/CODEX_CLOUD.md)、今回の調査・検証結果は [docs/INTEGRATION_REPORT.md](docs/INTEGRATION_REPORT.md) を参照してください。

属性ラベル・世界史の流れのデータ形式、CSVテンプレート、2形式の架空サンプル、検証・教材追加手順は[データ作成者向け仕様書](docs/STUDY_DATA_SPEC.md)を参照してください。

世界史の流れ専用のDiscord `/flow` 管理コマンド、23列CSV、独立した管理・公開Google Sheets、接続CLI、安全な承認・復旧手順は[連携仕様書](docs/HISTORY_FLOW_SHEETS_BOT.md)を参照してください。既定は静的JSONのままで、本番シートへの接続・投入は別途承認が必要です。
