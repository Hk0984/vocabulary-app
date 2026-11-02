# Pages方式移行前の記録と復旧手順

2026-11-03 JST。今回はローカル保存・検証だけ。設定変更、コミット、push、マージ、Actions実行、デプロイ、バックエンド書き込みは実施していない。

後続の本人確認：Pages Sourceは **GitHub Actionsへ変更済み**、旧版は既存URLで正常表示、バックアップZIPはリポジトリ外へ保存済み。今回のコード反映ではcommit/push/main反映を許可されているが、デプロイは未許可。以下のSourceや未確認項目はバックアップ取得時の記録であり、現在のSourceがブランチ方式という意味ではない。旧ブランチ方式へ戻す際には当時のBranch/フォルダーを本人が確認する必要がある。

## 移行前の記録

| 項目 | 記録／確認元 |
| --- | --- |
| 公開URL | https://hk0984.github.io/vocabulary-app/ |
| リモートmain | `3751cba02602daa030e1ff71278329ccf98678fa`。GitHub公開APIで取得前後に照合 |
| 現在のSource | `Deploy from a branch`。本人確認による記録 |
| 公開元ブランチ・ディレクトリ | **未確認**。Settings → Pages → Branch のブランチ名と `/ (root)` または `/docs` を本人が移行前に追記する。main/rootと推定して復元しない |
| Pages設定API | 未認証GETは404。設定値や独自ドメイン、HTTPS設定をAPIから確認できていない。画面の値を移行前に本人が控える |
| GitHub上のActions一覧 | activeの `pages-build-deployment` 1件。パス `dynamic/pages/pages-build-deployment`、ID `369302573`。ブランチ公開用のGitHub生成経路 |
| main内の独自ワークフロー | 記録SHAの再帰treeを確認、`.github/workflows/*.yml` / `*.yaml` は0件 |
| ローカルのワークフロー | `.github/workflows/web-release.yml` 1件。手動のみ、未コミット |

配信された9ファイルは全て記録mainの同名ファイルとバイト一致した。ただし、バックエンドの正常動作や公開元設定そのものをこの一致だけで証明しない。

## バックアップ

保存先：`dist/live-backup-2026-11-02T17-46-57-999Z/`（日時はUTC、JSTでは11月3日）。`dist/` はGit除外対象。

| パス | 内容・取り扱い |
| --- | --- |
| `web/` | 配信原本9ファイルを無改変保存。`index.html`, `style.css`, `script.js`, `history-config.js`, `history_questions.js`, `sw.js`, `manifest.json`, `icons/icon-192.png`, `icons/icon-512.png` |
| `snapshot.json` | main SHA、確認できた公開設定・未確認事項、各原本のサイズ/SHA-256、依存CDN、復旧候補の変更内容 |
| `rollback-source/` | 旧Web資源に現在のPWA保護を組み合わせたビルド用10ファイル。原本とは区別する |
| `rollback-web/` | 上記を現行ビルダーで生成した11ファイル。buildId `6cd89c035ee52131c75d`。`release.json` の全ハッシュを再照合済み |
| 同階層の `.zip` / `.zip.sha256` | 上記フォルダー全体の保管用アーカイブとチェックサム。Pagesへそのままアップロードしない |

HTTP GETで静的ファイルのみ取得し、取得を2回行って内容一致を検証した。認証・Firestore・SheetsのAPIや秘密情報用URLは呼び出していない。許可したWeb依存以外は収集しない。秘密鍵、サービスアカウント、代表的なGitHub/Discord/AWSトークン形式の検出0件。公開ブラウザ用APIキーは接続に必要な公開設定として保持し、値は報告しない。形式検査は任意の秘密情報の不存在を保証するものではない。

原本のFirebase CDN依存はネットワーク取得が必要なまま。バックエンドデータ・設定、ログイン状態、ブラウザキャッシュはバックアップに含めない。Git除外フォルダーはcleanや端末故障で失われ得るため、本人が信頼できる保管場所へアーカイブとチェックサムを別途コピーする。

## 手動ワークフローの制限

`web-release.yml` のトリガーは `workflow_dispatch` のみ。push、pull_request、schedule、workflow_run、repository_dispatchはない。既定 `deploy=false` はレビュー成果物作成だけ。

デプロイには正規リポジトリ、`refs/heads/main`、`deploy=true`、`confirmation=REPLACE_PRODUCTION` が全て必要。公開元を認証付きの読み取りAPIで検証し、`build_type=workflow` 以外、または照会不能なら停止する。公開物は常に `dist/web/`。権限はジョブ別に制限し、Pages書込み/OIDCはdeployジョブだけ。

このガードは旧ブランチ公開経路を停止しない。Sourceがブランチのまま、その公開元ブランチにpush・マージしてはいけない。現在の一覧は取得時点の情報なので、移行直前にActions一覧と実行中の公開ジョブを本人が再確認する。

## 変更を承認された後の移行順序

1. Source、Branch、フォルダー、独自ドメイン/HTTPS、最新公開実行、main SHAを本人が再確認し記録する。バックアップを別保管する。
2. Settings → Pages → Sourceを **GitHub Actions** に変更する。自動作成テンプレートのコミットや公開は選ばない。変更自体も別途承認後に行う。公開ジョブが動作中なら終了を確認してから次へ進む。
3. 公開元切替後の状態を記録し、既存URLを確認する。設定切替時の継続配信を保証して作業しない。競合する新規自動ワークフローがないことも再確認する。
4. 別途承認を受けてレビュー済み変更をcommit/push/mainへ反映する。手動ワークフローがdefault branchに存在することを確認する。
5. mainを対象に `deploy=false` で手動実行し、Web11ファイルだけの成果物を確認する。これは復旧候補を自動的に保存・公開する処理ではない。
6. 公開の別途承認後、mainを対象に `deploy=true` と指定確認文字列で実行する。公開後の手順は `WEB_RELEASE.md` を参照する。

## Sourceを切り替えた後の復旧

### コード公開前に設定切替だけを戻す場合

公開元ブランチの内容が移行前SHAから変わっていないことと、公開範囲の安全性を再確認してから、本人承認の下で記録したSource/Branch/フォルダーへ戻す。これは再ビルド・公開を起動し得る本番操作。ブランチに新コードが入った後にSourceだけ戻しても旧版の復旧にはならない。リポジトリ全体が再公開される危険もあるため、旧方式への復帰は原則最後の手段とする。

### 新版の公開後に旧画面・機能へ戻す場合

SourceはGitHub Actionsを維持し、Web成果物だけを復旧する。現在の `web-release.yml` は任意のローカルアーカイブを取り込めないため、**バックアップがあるだけで即座にRun workflowから復旧できる状態ではない**。

復旧が承認されたら、次の修正コミット方式を使用する：

1. 対象バックアップのSHA-256と `snapshot.json`、`rollback-web/release.json` を再検証する。原本9件も改変されていないことを確認する。
2. 独立した修正ブランチで `rollback-source/` の許可した10ファイルだけを同名Webソースへ復元する。生成済み `rollback-web/sw.js` をソースにコピーしない。Bot・Rules・履歴データ・設定・公開ワークフローは復元しない。
3. 現行ビルダーで新しい空ディレクトリへビルドし、`rollback-web/` と全11ファイルが一致することを確認する。元のSWをそのまま使わない。原本SWには他scopeのキャッシュも削除する処理があり、旧HTMLはSWを登録しないため、旧9ファイルだけの単純再配信では新版キャッシュの復旧を保証できない。
4. **旧版には今回修正した履歴保護・認証切替の弱点が戻る**。旧版を恒久運用せず、必要なら履歴機能を使用させない運用や別の修復版を先にレビューする。新版用の機能テストが旧実装で失敗した場合は抑制せず、退行として報告し、復旧可否を本人が判断する。
5. 復旧差分・テスト結果をレビューし、commit/push/main反映とデプロイをそれぞれ承認された後、現行の手動ワークフローでbuild・レビュー・公開する。reset/force pushやデータ巻き戻しは使わない。
6. PC/iPhoneの全タブ・ホーム画面PWAを閉じて開き直す。待機中SWがあれば終了後の再起動を案内する。必要時のみ本人確認後に対象scopeのSW登録・Cache Storageを復旧する。localStorage/IndexedDBを一括消去する手順にはしない。新旧が混在していないこと、復旧buildIdを確認する。

復旧候補は原本のindexへ更新通知領域と `pwa.js` 読込みを追加し、`sw.js` をscope限定・全資源ハッシュ照合のWorkerに置換した。旧 `script.js` / `history-config.js` / `history_questions.js` は原本と一致する。実ブラウザ/PWAの更新・ロールバックと、旧版の現在のバックエンドへの互換性は実機未検証。Firestore、Sheets、Authのデータを戻す手順は含めない。

正常な新方式での公開実績ができた後は、その実行ID/ソースSHAを記録する。同じSHAの成功した手動実行を利用できる場合は、対象を確認し **Re-run all jobs** で再ビルド・公開できる。復旧承認は別途必要。デプロイジョブだけの再実行は試行番号付き成果物を欠くので使用しない。

参考：[GitHub Pagesの公開元設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[カスタムPagesワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Service Workerのライフサイクル](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)。
