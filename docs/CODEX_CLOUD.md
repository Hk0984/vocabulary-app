# Codex Cloud導入準備

## 現時点の状態（2026-11-02）

- 対象は `Hk0984/vocabulary-app`。GitHub mainとローカルHEADは `3751cba02602daa030e1ff71278329ccf98678fa` で一致していました（`git ls-remote` で読取確認）。
- 未コミット・未追跡のBot改善、Firebaseルール、Node設定が作業開始前からあります。今回の変更も未コミットです。Cloudにはローカル変更が自動転送されるわけではありません。
- コミット・push・Cloud環境の作成/公開・本番デプロイは行っていません。GitHub接続やアカウントの利用可否は本人による確認が必要です。

## 本人が行う接続

現在の公式手順は [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments) を参照してください。旧Cloud環境の手順とは画面が異なる場合があります。

1. 最初にローカル差分と秘密ファイル除外を確認し、GitHubへ反映するファイルを選んで承認します。`git add .` で一括登録しないでください。承認後のコミット・pushは別作業です。
2. iPhoneのChatGPT/Codexで同じアカウントにログインし、利用画面にCloudがあることを確認します。新規タスクの `Work in > Cloud` → `Select environment` → `Create environment` から進めます。UIの提供状況はアカウントによって確認してください。
3. GitHubの認証画面で本人が接続を許可し、必要な `Hk0984/vocabulary-app` だけを選択します。ローカル未コミット変更は接続だけでは取り込まれません。
4. セットアップにNode.js 24.12以降、Python 3.14、Java 21以降と `bash scripts/setup-cloud.sh` を指定します。npm/PyPIとエミュレータ取得先への通信が必要です。
5. セットアップ結果を確認し、本人の承認後に環境の `Publish` を実行します。この環境公開はWebアプリ本番デプロイとは別操作です。
6. 新規Cloudタスクで `npm test`、`.venv/bin/python -m unittest discover -s bot/tests`、`npm run test:rules`、`npm run test:rules:improved` を実行させます。変更差分と結果をレビューしてからPRやGitHub反映を承認します。

Cloud上のLinux環境での実行は今回未確認です。`setup-cloud.sh` は固定済みのNode/Python依存関係を導入し、外部書き込みのないテストを実行します。ルールテストは `firebase.test.json` の専用ポート18080/19099とdemoプロジェクトだけを使います。ポート競合時は既存プロセスを停止せず、テスト用設定のポートを変更してください。テストはエミュレータ環境変数からポートを取得します。

## 秘密情報

`setup-cloud.sh` は依存関係の導入とJavaScript/Pythonテストを実行します。エミュレータテストは手順6の2コマンドで別途実行します。`.gitattributes` でシェルスクリプトをLF改行に指定しています。ローカルでは `bash -n scripts/setup-cloud.sh` の構文確認のみを行い、Linuxでの依存関係インストール完了までは検証していません。

通常の開発・テストに環境変数や本番秘密情報は必要ありません。`.env`、Discordトークン、サービスアカウント鍵、Firebase管理者鍵はCloudへ登録・転送しないでください。`.env.example` の変数名だけを手掛かりにし、Bot運用はローカルに留めます。

`history-config.js` と `script.js` の既存ブラウザ設定は配信される公開クライアント設定です。サービスアカウントやBotトークンとは異なります。Google Sheets APIキーのHTTPリファラー/API制限と、管理用シートが非公開であることは管理画面で本人が確認してください。今回は設定値の変更や本番アクセス検証をしていません。

公式資料: [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments)。設定・認証・公開操作は利用画面の指示に従ってください。
