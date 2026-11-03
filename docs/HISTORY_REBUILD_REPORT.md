# 世界史・新環境再構築のローカル準備報告

方針：旧430問の管理用12→16列本番移行を必須にせず、新管理16列・新公開13列を別ブックで準備する。旧シート・旧430問・旧Firestore履歴を削除しない。実装は既存の未コミット差分を保持した `feature/history-classification-v1` 上で実施。HEADは `8b70b2a2a5fc141aeba7f063f40176f1374aef5a` のままで、今回のコミット・pushはない。

## 実装内容

1. **厳密な全使用範囲検証**：Botはタブ全使用範囲をGETする。公開N/管理Q列の余分な非空ヘッダ・ヘッダなし余剰セル、重複ID、選択肢重複、不正分類/年代/必須値を検出して停止する。空の物理列や消去済み行は保持する。書込前のヘッダ検証不備は修正済み。
2. **新旧設定の分離**：非秘密JSONで新環境を選ぶ。新旧ID・管理/公開・環境間の接続先や接頭辞を使い回さず、不正設定から旧先へフォールバックしない。実運用接続先は未入力。既存 `history-config.js` は変更していない。
3. **未承認公開の防止**：新環境は13列CSVと固有IDを要求する。取込はdraftだけ。公開・修復・公開追記は、現在の全13項目のハッシュ、人の3確認項目、承認者/日時、approved=trueを検証する。欠落・保留・変更後の古い承認は停止する。承認者情報は公開シートへ出さない。
4. **再取得・修復**：公開追記後のタイムアウトは読戻しで成功を確認し、重複追記しない。承認を維持して修復でき、修復で管理statusを勝手に変えない。公開削除失敗時の管理元保持も維持する。
5. **候補作成**：旧9列バックアップだけから、新ID・未分類・未承認の13列候補を生成する。正解や歴史内容を自動修正しない。新IDは旧IDと本文のハッシュから決定し、ID対応表を出力する。Firestoreへは何も書かない。
6. **Web切替・復旧準備**：元の旧接続は保持し、ビルド時に公開専用4項目だけを差し替える。管理ID・承認記録・鍵は含めない。新環境の13列・ID接頭辞をアプリでも確認する。既存の世界史設定・分類フィルタ・英語/古文・履歴保存形式を維持する。

承認記録は人の内容確認を代替せず、電子署名ではない。信頼する本人が管理するローカルファイルを使う。事実として正しいか、正解が一意かは今回未レビュー。

## ローカル成果物

| 場所 | 内容 |
| --- | --- |
| `templates/history-import-13.csv` | 新規CSVヘッダのみ |
| `templates/history-management-16.csv` | 管理ヘッダのみ。J/K/L維持 |
| `templates/history-public-13.csv` | 公開ヘッダのみ |
| `config/history-environments.example.json` | 旧ID控え＋新管理/新公開＋接頭辞＋承認記録パス。IDは空で自動使用不可 |
| `config/history-public-rebuild.json` | Web用4項目。新公開IDは空で、切替ビルドは意図的に停止する |
| `dist/history-rebuild-init/` | CLIで生成した空データ・設定・承認テンプレート。管理0/公開0の照合成功 |
| `dist/history-rebuild-candidates-430/` | 旧430問の候補CSV、ID対応表、未承認記録、変換レポート |
| `dist/history-rebuild-candidates-430-repeat/` | 再実行結果。4主要ファイルがバイト一致 |
| `dist/history-rebuild-web-legacy/` | 現在の旧接続を維持する13ファイルのWeb成果物。buildId `17e4f2296f692fe6bc5f` |

候補元は、2026-11-03に取得済みのリポジトリ外公開CSVバックアップ。SHA-256 `2293a3fc1bd4b678cd2a23f2f5bc1f9da9714dfab5765db0d38fc8f4a4e0bcaf` を再確認して使用した。本タスクで本番Sheetsへ再接続していない。

430問すべてに新IDを付け、元の430 IDとの重複0。本文/source_id/選択肢/正答/解説は保持し、分類は未分類/空欄、4つの確認・承認フラグは全false、承認者・日時は空欄。承認済み0問。新Webパーサーでも430問を受理したが、候補は公開シートへ転記していない。

既存の `.env`・サービスアカウント鍵・Botトークンは読み取っていない。既存の未追跡CSV3件/Firebase設定候補2件は過去のハッシュと一致し、変更・削除していない。成果物はGit除外の新しいdist出力先で、既存のビルドやバックアップを上書きしない。

## テスト結果

| コマンド | 成功 | 失敗 |
| --- | ---: | ---: |
| `npm.cmd test` | 105 | 0 |
| Python全テスト | 90 | 0 |
| `npm.cmd run test:rules` | 6 | 0 |
| `npm.cmd run test:rules:improved` | 10 | 0 |
| ブラウザ（Chrome、375/402/1280px） | 3 | 0 |
| ブラウザ（Edge、同上） | 3 | 0 |
| **合計** | **217** | **0** |

ワークフローの未知環境入力を停止する修正後、Webビルド/手動起動制限の12テストも再実行して成功（上記件数に重複加算しない）。データ検証はモックまたはローカルCSV、Firestoreは `demo-vocab-app-security` のみ。

再現テストには、全使用範囲を返す現実的なSheets APIモック、不正ヘッダ・余剰セル・不正データでの書込未呼出し、承認なし/変更後/部分確認の停止、タイムアウト後照合・修復、候補生成の冪等性、変更後の再承認、公開専用設定の漏出防止、新旧Firestoreキーの共存を含めた。

## 今回の主な変更ファイル

- Bot：`bot/history_bot.py`、新規 `bot/history_data.py`、`bot/history_environment.py`。既存CSV/分類・照合処理は再利用。
- CLI：新規 `scripts/history-rebuild.py`。init/candidates/review/validate/public-configはすべてオフライン。
- Web：`history_questions.js` に新環境のスキーマ・IDガード。`scripts/build-web.mjs` に任意の公開設定オーバーレイ。
- 設定・テンプレート：`config/` 2ファイル、`templates/` 3ファイル、`.gitignore` に実運用設定・local-historyの除外。
- 公開準備：`.github/workflows/web-release.yml` に手動のlegacy/rebuild_v1選択。既定legacy、deploy=false。自動起動は追加していない。
- テスト：新規 `bot/tests/test_history_rebuild.py`、更新 `bot/tests/test_history_schema.py`、`tests/history-integration.test.mjs`、`tests/history-progress.test.mjs`、`tests/firestore.improved.rules.test.mjs`、`tests/web-build.test.mjs`。
- 文書：新規 `docs/HISTORY_REBUILD.md` と本報告。README、旧v1移行/監査/公開文書に新方針を案内。旧記録は削除しない。

前タスクの未コミット実装・提供された指示書と地域マスターも保持した。Firestore Rules・既存保存フィールド、英語/古文のパーサーや出題ロジック、Cloud設定は追加変更していない。

## 残る本人操作

1. 新環境で使う未使用ID接頭辞を確定する。今回の接頭辞はローカル例であり、既存Firestore全件の未使用確認はしていない。
2. 別途承認後に新管理・新公開ブックを作成し、ヘッダ・共有権限・Botのアクセス権を設定する。旧ブックは触らない。
3. 非秘密の接続JSONに新旧ID等を入力し、公開用設定を生成する。未入力の現時点では新環境へ切替できない。
4. 430候補または新規問題を人がレビューし、必要な分類・修正後に内容ハッシュ付き承認記録を作る。本文の意味を変えた公開済みIDは再利用しない。
5. Bot起動・draft取込・承認済み公開、アプリ切替、テストアカウントでの保存確認、iPhone Safari/PWAの更新・復旧を別途承認して検証する。

今回、実Google Sheetsの作成/初期化/書込、Botの本番起動、GitHub Actions実行、コミット、push、デプロイは行っていない。**新環境のローカル準備完了／本番環境は未構築・未切替**。
