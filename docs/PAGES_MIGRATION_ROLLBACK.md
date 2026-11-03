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

1. 復旧方式を決める。保存済みZIPを使う方式ではそのSHA-256と `snapshot.json`、`rollback-web/release.json` を検証する。下記の固定旧版方式では指定Git SHAと旧ビルダーのハッシュを使用し、生成後の `verification.json` / `web/release.json` で検証する。両方式のbuildId・資産数を混同しない。
2. 独立した修正ブランチで、下記の固定旧コミット用ビルド手順を使う。旧10資産を新しい13ファイル用ビルダーへ渡さない。生成済み `rollback-web/sw.js` をソースにコピーせず、Bot・Rules・履歴データは復元しない。
3. 旧コミットの10資産と、そのコミット自身のビルダーで11ファイルを生成する。復旧用の世界史接続先は明示指定し、HTTP 200かつ公開9列ヘッダーであることを確認したものだけを使用する。接続先を明示するため、過去バックアップのbuildId・全ファイルとの一致を要求せず、今回生成した `verification.json` と `web/release.json` のハッシュで検証する。
4. 原本ZIP由来の古い版には履歴保護・認証切替の弱点が戻る可能性がある。下記で固定したv2直前のコミットは履歴保護を含むが、分類機能などv2の変更は戻る。復旧版の差分と必要な回帰試験を確認し、失敗を抑制せず退行として報告して、復旧可否を本人が判断する。
5. 復旧差分・テスト結果をレビューし、commit/push/main反映とデプロイをそれぞれ承認された後だけ手動公開する。公開用修正コミットでは、ワークフローのビルドを下記の固定旧版ビルドに変更し、レビュー成果物・Pages成果物の両アップロード先を `dist/rollback-release/web` に揃える。既存のリポジトリ/main限定・Pages Source確認・deploy既定false・確認文字列・環境承認のガードは維持する。通常の新方式ビルドや `history_environment=legacy` を選ぶだけではこの復旧成果物にはならない。reset/force pushやデータ巻き戻しは使わない。
6. PC/iPhoneの全タブ・ホーム画面PWAを閉じて開き直す。待機中SWがあれば終了後の再起動を案内する。必要時のみ本人確認後に対象scopeのSW登録・Cache Storageを復旧する。localStorage/IndexedDBを一括消去する手順にはしない。新旧が混在していないこと、復旧buildIdを確認する。

以前保管した復旧候補の説明：原本indexへ更新通知領域と `pwa.js` 読込みを追加し、`sw.js` をscope限定・全資源ハッシュ照合のWorkerに置換していた。以下の固定旧版方式はそのZIPの再配信とは別方式で、既に安全なPWA/履歴保存を持つ旧コミットのWebへ戻す。実ブラウザ/PWAの切替と、旧版の現在のバックエンドへの互換性は公開前後の許可された確認が必要。Firestore、Sheets、Authのデータを戻す手順は含めない。

### 固定旧版ビルドのローカル再現（デプロイなし）

対象旧コミットは `8b70b2a2a5fc141aeba7f063f40176f1374aef5a`。現在のv2の直前で、10資産用ビルダー・scope限定ハッシュ検証PWA・既存の履歴保護を含む。
`scripts/build-rollback-web.mjs` は、このSHAからWeb10資産と同じ版のビルダーだけを取り出し、新しい `dist` ディレクトリで処理する。通常Webソース・現在の接続設定は上書きしない。

```powershell
# 上記SHAがローカルGit履歴にあること。浅いcloneでは本人確認後に対象SHAをfetchする。
# OLD_PUBLIC_HISTORY_SHEETは、本人が公開用として確認したIDをローカルで指定する。
node scripts/build-rollback-web.mjs --public-sheet "$env:OLD_PUBLIC_HISTORY_SHEET" --out dist/rollback-release
node --test tests/rollback-build.test.mjs
```

キーは固定旧コミットのブラウザ設定から内部的に継承し、表示しない。CLIが行う外部操作は指定タブの**1行目だけのGET**。HTTP 200と9列の完全一致を要求し、12/16列の管理用や新13列は拒否する。問題本文・承認記録・認証ファイルは読み取らない。
現物確認では、旧シートの管理/公開のラベルがローカル設定資料と逆だったため、ラベルだけで判断せず、このヘッダー検査で公開先を確定する。既存ローカル環境JSONは自動変更しない。

出力は `source/`（旧10資産）、`builder/`（固定旧版ビルダー）、`web/`（配信用11ファイル）、`verification.json`。**配信対象はweb/だけ**。新管理用ID・秘密情報の検査と、世界史設定のIDが指定した公開用と一致することを公開前に再確認する。英単語・古文の汎用シート設定は旧コミットのまま保持する。
11ファイルの中身・ハッシュは二重生成で再現性を確認できる。既存出力は上書きしないので、再生成には別の新規 `--out` を使う。

注意：旧管理用12列のタブが、既存の英単語・古文と同じブックにあることが確認された。世界史の復旧先には使わないが、汎用シートIDを勝手に変更すると既存機能へ影響するため、ブック共有・管理データ分離は本人の別途確認事項。復旧ツールはその共有設定を変更しない。

正常な新方式での公開実績ができた後は、その実行ID/ソースSHAを記録する。同じSHAの成功した手動実行を利用できる場合は、対象を確認し **Re-run all jobs** で再ビルド・公開できる。復旧承認は別途必要。デプロイジョブだけの再実行は試行番号付き成果物を欠くので使用しない。

参考：[GitHub Pagesの公開元設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[カスタムPagesワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Service Workerのライフサイクル](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)。
