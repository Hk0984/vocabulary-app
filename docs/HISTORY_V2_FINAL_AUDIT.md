# 世界史 v2.0：正式公開前の最終監査（2026-11-03）

## 判定

**ローカルの技術監査は合格。新環境を明示選択するWeb公開は条件付きで可能。**
実行前に、本人による本番Rules・共有権限・Pages設定の最終照合、復旧用成果物の確認、コミット対象と公開操作の別途承認が必要。
今回コミット・push・デプロイ・Sheets書き込み・本番Firestore書き込みは一切行っていない。
公開用SheetsからのGETと、demoプロジェクトのエミュレータだけを使用した。

## Git状態と全変更の範囲

- ブランチ：`feature/history-classification-v1`。
- HEAD：`8b70b2a2a5fc141aeba7f063f40176f1374aef5a`。
- 監査開始時は変更済み24ファイル、未追跡48ファイル。追跡済み差分は550追加・123削除。未追跡の内容はこのdiff統計に含まれない。
- 本報告追加後は変更済み24、未追跡49、計73ファイル。うち元の未追跡5ファイルはコミット対象から除外するため、レビュー対象の候補は68ファイル。
- ステージ済み変更なし。監査でアプリ実装・接続設定・Rulesを変更せず、本報告書だけを追加。
- 元の未追跡5ファイルは、保存済みのSHA-256と全て一致。変更・削除・ステージングなし。
- 調査開始時の全ファイル一覧と検査結果は `local-history/history-v2-final-audit-inventory.json`（Git除外）。

全追跡差分、未追跡の実装・テスト・マスター・CSVテンプレート・各段階の資料を確認した。
旧移行用ツールはCSVだけのオフライン処理として残り、新Sheetsの再構築に必須ではない。
単発の実サービス検証用スクリプトは対象ID・接続先を固定した補助ツールであり、公開ワークフローから実行されない。

## 成果物・秘密情報・接続先

```powershell
npm.cmd run build:web -- --out dist/history-v2-final-audit-20261103 --history-public-config config/history-public-rebuild.json
```

ビルドID：`a1f5e4772263bed926ed`。以下の**13ファイルだけ**で、release.jsonの一覧・各ファイルのハッシュと一致。

```text
index.html
style.css
script.js
history-config.js
history_questions.js
history-classification.js
history-regions.json
pwa.js
sw.js
manifest.json
icons/icon-192.png
icons/icon-512.png
release.json
```

- 新管理用IDと本人確定の旧管理用IDは、成果物全ファイルに存在しない。
- `.env`、サービスアカウント鍵、Bot、テスト、承認記録、ローカル環境設定、監査ログ、ZIPを含まない。
- 秘密鍵、サービスアカウント、Discord/GitHub/AWSトークンの代表的形式の成果物検出は0件。パターン検査は未知形式の秘密情報まで保証するものではない。
- コミット候補の検査では2ファイルにマーカーが一致したが、`tests/web-build.test.mjs` の意図的な偽鍵テストと `scripts/migrate-history.py` の拒否用文字列であり、鍵データではない。
- 秘密ファイル名に該当するGit追跡ファイルは0件。秘密ファイルの内容は読まず、ファイル名の検査だけを実施した。
- Webに必要なFirebase/Sheetsのブラウザ用APIキーは成果物に含まれる。サービスアカウント秘密鍵とは別であり、値は報告・ログに出力していない。
- 新ビルドの世界史は新公開用 `1ooI8uDSxni_xJNkTBIrSrngq56dynRWxEvpztqzAlCI`、タブ `history_questions`、接頭辞 `hv1_rebuild1_`、13列必須。
- 英単語・古文の汎用シートID、汎用Sheetsキー、Firebase設定はHEADと一致（改行差を正規化して比較）。

元の `history-config.js` は旧接続を維持し、ビルド時だけ公開専用設定を適用する。
元ファイルのIDは本人確定の旧管理用IDと一致する一方、汎用 `script.js` のIDが本人確定の旧公開用IDと一致する。
この用途の食い違いは新環境の成果物には持ち込まれないが、**既定legacyでの公開や復旧を安全と決め付けない**。
旧接続先の実用途・共有範囲は引き続き本人の照合対象。

## APIキーの許可リファラー

本人は既存本番用の許可とSheets API制限を維持してローカル許可を追加済み。
新公開用をGETし、以下はいずれもHTTP 200、13列・1問だった。

| 確認方法 | Referer | 結果 |
|---|---|---|
| Chrome実接続 | `http://127.0.0.1:8765/` | 200 |
| Edge実接続 | `http://127.0.0.1:8765/` | 200 |
| 公開URLを指定したHTTP GET | `https://hk0984.github.io/vocabulary-app/` | 200 |
| オリジンのみを指定したHTTP GET | `https://hk0984.github.io/` | 200 |

後者2件はRefererを明示したHTTP試験で、本番ブラウザ試験ではない。Consoleの許可一覧そのものは取得していない。
記録：`local-history/history-v2-final-pages-referrer-check.json`。キーやキー付きURLは保存していない。

## Firestore・認証の互換性

- 保存先 `users/{uid}/progress/history_questions`、問題キー `history_<ID>` を維持。
- `recordAnswer`、`recordHistoryAnswer`、`getWordKey` はHEADと同じ。トランザクション保存・既存フィールドを維持し、スキーマ変更なし。
- `firestore.rules` と `firestore.improved.rules` は変更なし。
- 他ユーザーと未認証の拒否、所有者アクセス、匿名→メール連携、同時更新、読込失敗時の保存停止をエミュレータで確認。
- 両Rulesは匿名認証にも本人データへのアクセスを許可し、匿名時の保存抑止は現アプリ側の仕様。現行Rulesは所有者配下を広く許可し、improved版はprogressに限定する。今回この差を本番へ適用していない。
- 本番で現在有効なRules・認証設定はローカル試験だけでは確定できないため、Consoleで本人が照合する。

## PWA更新・旧版からの切替・復旧

- アセット内容からbuildIdと各ハッシュを生成。インストール時はAPP_SHELL全件が同じ版であることを検証してからキャッシュに保存。
- 混在レスポンス・取得失敗時はインストール失敗とし、既存の使用可能キャッシュを保持する。
- `skipWaiting` / `clients.claim` による強制切替はなく、学習中のタブを自動再読み込みしない。全タブ・PWAを閉じて開き直して切り替える。
- 現行キャッシュ欠落時は503で停止し、別版のHTML/JSをネットワークから補って混ぜない。
- キャッシュ削除は同アプリのscope接頭辞に限定。Sheets・Firebaseはキャッシュ対象外で、履歴・認証ストレージをリセットしない。
- 旧版からの実機PWA更新・Safari・iPhoneは未実施。公開後の本人確認項目として残る。
- 復旧は、保存済みの正常版のWeb専用成果物・対応するSHA/実行IDを確認し、別途承認後にWebだけを再配信する。SheetsとFirestoreは巻き戻さない。
- 正常な新方式Actionsを戻す場合は元SHA・入力を照合して `Re-run all jobs` を使う。deployジョブだけの再実行は使わない。
- 旧接続IDの用途に不一致があるため、単に `history_environment=legacy` へ戻す方法を無条件には推奨しない。旧版ZIPの保存は本人確認済みだが、今回ZIP本文は開いておらず、復旧実行もしていない。

## 全テスト結果

| 分類 | 成功 | 失敗 | スキップ |
|---|---:|---:|---:|
| JavaScript | 106 | 0 | 0 |
| Python | 115 | 0 | 0 |
| Firestore Rules | 6 | 0 | 0 |
| Firestore/認証 | 10 | 0 | 0 |
| Chrome実接続必須 | 3 | 0 | 0 |
| Chrome既存UI回帰 | 3 | 0 | 0 |
| Edge実接続必須 | 3 | 0 | 0 |
| Edge既存UI回帰 | 3 | 0 | 0 |
| **合計** | **249** | **0** | **0** |

Firestoreは `firebase.test.json` / `demo-vocab-app-security` のみ。
CLI個人設定を読まないよう `XDG_CONFIG_HOME` をGit除外のローカル領域へ指定。
テスト完了後に終了待ちとなったJavaはdemoプロジェクト引数を照合して停止した。
ブラウザは隔離headlessで、本番Firebase初期化・通信は抑止。世界史はデータ再生なし。
英単語・古文のデータとユーザーはモックで、実アカウントへの保存試験ではない。

証跡：Chrome `dist/history-v2-browser-dDK1s7/`、Edge `dist/history-v2-browser-1mBPIF/`。
既存UI：Chrome `dist/history-ui-1xalkH/`、Edge `dist/history-ui-2zHas0/`。
`git diff --check` 成功。CRLF変換予告が2件あるが、空白エラーではない。

## 本人操作と正式公開の順序（今回は実施しない）

1. **世界史の出題対象が旧430問から新環境1問へ切り替わることを了承する。** 旧問題やDB履歴は削除しないが、新IDは別履歴となり、進捗表示は新公開問題を基準にする。既存430問の候補は全て未承認のまま。
2. 本番Firebase Rules・認証、新管理用の非公開共有、新公開用の閲覧権限、APIキーのSheets API制限と本番リファラーをConsoleで照合する。
3. GitHub Pages SourceがGitHub Actionsのまま、公開経路が手動ワークフローだけ、環境がmain限定であることを本人権限で再確認する。
4. 復旧用の正常版ZIP/SHA/実行IDを照合し、旧シートIDの用途不一致を復旧判断に織り込む。
5. 下記候補ファイルだけをレビューして承認後に個別ステージング・commit/push・main反映する。元の未追跡5件やlocal-history/distは追加しない。
6. `web-release.yml` は手動起動のみ。まず **`history_environment=rebuild_v1`、`deploy=false`** で成果物を生成し、13ファイル・新公開先・buildIdを確認する。既定のlegacyをそのまま使用しない。
7. 公開を別途承認後、mainで `history_environment=rebuild_v1`、`deploy=true`、`confirmation=REPLACE_PRODUCTION`。Pages Source取得失敗やworkflow方式以外ならガードで停止する。
8. 公開後に既存URL、release.json、全タブ/PWA再起動、iPhone/Safari、専用テストアカウントでの保存を許可範囲内で確認する。

`docs/WEB_RELEASE.md` には旧版の9列・11ファイル・旧移行手順等の歴史的記載も残る。今回のv2公開では本報告と `HISTORY_REBUILD.md` を優先し、旧Sheets移行・旧方式の再公開を実行しない。
残る確認は主に本番設定・復旧・実機操作。コード上の公開阻害不具合は今回の監査では検出していない。

## コミット候補の全一覧（未ステージ）

本一覧は候補であり、今回ステージングやコミットは行わない。監査補助・旧移行資料を含むため、別コミットに分ける場合も対応テストや依存ファイルを落とさないこと。

```text
.github/workflows/web-release.yml
.gitignore
CODEX_HISTORY_V1.md
README.md
bot/csv_validation.py
bot/history_bot.py
bot/history_classification.py
bot/history_data.py
bot/history_environment.py
bot/public_questions.py
bot/sheets_write.py
bot/tests/test_csv_validation.py
bot/tests/test_history_classification.py
bot/tests/test_history_draft_preparation.py
bot/tests/test_history_migration.py
bot/tests/test_history_readonly_connection.py
bot/tests/test_history_rebuild.py
bot/tests/test_history_schema.py
bot/tests/test_history_smoke_approval.py
bot/tests/test_history_smoke_publication.py
bot/tests/test_history_smoke_registration.py
bot/tests/test_public_questions.py
bot/tests/test_public_revocation.py
config/history-environments.example.json
config/history-public-rebuild.json
docs/HISTORY_REBUILD.md
docs/HISTORY_REBUILD_REPORT.md
docs/HISTORY_V1_MIGRATION.md
docs/HISTORY_V1_PREPRODUCTION_AUDIT.md
docs/HISTORY_V1_REPORT.md
docs/HISTORY_V2_APPROVAL_RESULT.md
docs/HISTORY_V2_CONNECTION.md
docs/HISTORY_V2_DRAFT_PREPARATION.md
docs/HISTORY_V2_DRAFT_RESULT.md
docs/HISTORY_V2_FINAL_AUDIT.md
docs/HISTORY_V2_LIVE_WEB_RESULT.md
docs/HISTORY_V2_PUBLICATION_RESULT.md
docs/HISTORY_V2_REFERRER_FIX.md
docs/HISTORY_V2_WEB_VALIDATION.md
docs/WEB_RELEASE.md
history-classification.js
history-regions.json
history_questions.js
index.html
package.json
script.js
scripts/approve-history-smoke.py
scripts/build-web.mjs
scripts/check-history-sheets-readonly.py
scripts/history-rebuild.py
scripts/migrate-history.py
scripts/publish-history-smoke.py
scripts/register-history-smoke-draft.py
style.css
sw.js
templates/history-import-13.csv
templates/history-management-16.csv
templates/history-public-13.csv
tests/firestore.improved.rules.test.mjs
tests/fixtures/history-classification.json
tests/history-classification.test.mjs
tests/history-integration.test.mjs
tests/history-progress.test.mjs
tests/history-ui.browser.mjs
tests/history-v2-web.browser.mjs
tests/history_questions.test.mjs
tests/service-worker.test.mjs
tests/web-build.test.mjs
```

## 保護・除外する既存未追跡5ファイル

```text
bot/test_import_one.csv
bot/test_publish.csv
bot/test_publish_japanese.csv
firebase.improved.json
firebase.json
```

これらのJSONやCSVの内容を新たに開かず、ハッシュ一致で保護を確認した。
`local-history/`、`dist/`、秘密ファイル、ログ、外部保管ZIPもコミット・Web公開の対象外。
