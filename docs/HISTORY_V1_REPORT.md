# 世界史一問一答v1 ローカル実装報告

後続作業で新規Sheetsによる再構築へ方針変更した。現在の手順は [HISTORY_REBUILD.md](HISTORY_REBUILD.md)。この文書はv1互換実装時点の記録で、旧管理シートの本番移行を必須とするものではない。

作業ブランチ：`feature/history-classification-v1`。起点SHA：`8b70b2a2a5fc141aeba7f063f40176f1374aef5a`。コミット・push・デプロイ・本番Sheets読書き・Bot本番起動・Firestore本番書込みは未実施。既存の未追跡CSV3件とFirebase設定候補2件は変更していない。提供された指示書・地域JSONは原本のまま保持した。

## Phase別の結果

| Phase | 状態 | 内容 |
| --- | --- | --- |
| A | ローカル完了 | ベースラインJS70/Python58成功。JS/Python共通fixtures、92件DAG、年代境界、完全タグ集合、3集合交差、公開9/13列の互換パーサー |
| B | ローカル完了 | 仮想ジャンル、共通設定導線、4学習モード、分類複数チェック、件数、非ログイン学習、専用問題に基づく進捗。既存保存先・トランザクション・Rulesを維持 |
| C | ローカル完了 | CSV9/13互換、管理16・公開13のI/Oと全列照合。J/K/L固定。ヘッダ不一致は書込前停止。公開削除を確認できなければ管理元を保持する既存処理を維持 |
| D | ローカル完了 | オフライン変換・照合・冪等性・手動移行/復旧手順。ライブ書込機能は実装しない |

現行コードとの差は指示書の想定どおりで、前回のUI改修が既にmainに含まれていた。その共通UIを再利用した。独立した歴史出題数設定は撤去し、リンクも学習設定へ向けた。世紀一覧はデータに明示登録された世紀から構成する。語彙と世界史の設定値を別に保持し、英語・古文の既存設定を維持する。

## 受入チェック

| 要件 | ローカル確認 |
| --- | --- |
| 世界史仮想ジャンルが1件、通常シートの有無から独立 | JS統合テスト |
| 設定経由、通常/苦手/間違い/未学習、10/20/30/50/全件/母集団不足 | JS統合・出題テスト |
| 軸内OR・軸間AND、同じ年代での交差、空世紀の除外 | 共通fixturesとJS/Python純粋関数テスト |
| 親→子孫だけ、ロシアDAG、全チェックと無指定の違い | JS/Python純粋関数・Chrome/Edgeテスト |
| 特殊値と通常地域の混在禁止、未分類の限定検索除外 | JS/Python検証テスト |
| 旧9列、新13列、混在/私的ヘッダ拒否、末尾空欄 | JSパーサー・Python CSV/Sheetsモックテスト |
| ゼロ埋めID、本文・選択肢・正答、J/K/L、行順の保持 | CSV・Bot I/O・移行テスト |
| 読込失敗/同時更新/別アカウント/遅いレスポンス | 既存履歴保護テスト＋新ジャンル/進捗競合テスト |
| Firestoreの保存先・キー・フィールド不変 | 実クライアント関数を使うエミュレータテスト |
| 公開・修復の分類4列相違も衝突扱い、削除失敗で管理元保持 | Botモックテスト |
| 375px/402px/1280px、階層全展開、正誤色、解説 | Chrome/Edgeの隔離プロファイル、HTTP(S)遮断下で検証 |
| 英語の主要スタイルと従来の学習機能、古文パーサー/設定 | 既存テスト、CSS基準SHA比較、新しい古文回帰テスト |
| 許可リスト/PWAのマスター追加、ハッシュ検証、Bot除外 | ビルド・Workerテスト、最終成果物照合 |

## 最終テスト

| コマンド | 成功 | 失敗 |
| --- | ---: | ---: |
| `npm.cmd test` | 99 | 0 |
| `bot/.venv/Scripts/python.exe -B -m unittest discover -s bot/tests` | 72 | 0 |
| `npm.cmd run test:rules` | 6 | 0 |
| `npm.cmd run test:rules:improved` | 10 | 0 |
| `node --test tests/history-ui.browser.mjs`（Chrome） | 3 | 0 |
| 同上（UI_BROWSERでEdgeを指定） | 3 | 0 |
| **合計** | **193** | **0** |

開発途中の失敗は修正済み。新しい仮想ジャンル追加で変わる一覧件数、旧UIの期待値、テストfixtureの世紀/列インデックス、設定復元時の数値/文字列の期待値を新仕様に合わせて修正した。元の既存テストを削除して成功扱いにはしていない。

エミュレータは `firebase.test.json` と `demo-vocab-app-security` のみ。ブラウザはモック問題・マスターを使い本番SDKを初期化しない。Botをimportしただけで `.env` を読まないよう、dotenv読込を明示起動の `__main__` へ移した。実サービスへの書込を伴うテストは実施しない。

`npm.cmd run build:web -- --out dist/history-v1-web-final` は13ファイルを生成。buildId `4f68078d83f52f6dd3db`。既存 `dist/web/` は上書きしていない。許可リストはWeb12ファイル＋release.jsonで、コード/地域マスター双方のハッシュをWorkerに埋め込む。

合成CSVでCLIを実行し、`dist/history-v1-migration-review/` に管理3行・公開2行を変換。`dist/history-v1-migration-review-repeat/` への再変換も確認。元セル・ゼロ埋めID・行順を維持し、同じCSVとなる。これらは実データのバックアップや移行結果ではない。

## 変更ファイル

- Web：`index.html`, `style.css`, `script.js`, `history_questions.js`, 新規 `history-classification.js`。提供済み `history-regions.json` を単一マスターとして使用（内容変更なし）。
- 公開/PWA：`scripts/build-web.mjs`, `sw.js`, `package.json`。新マスターと分類JSを追加し、公開許可リストを11→13に変更。
- Bot：`bot/csv_validation.py`, `bot/history_bot.py`, `bot/public_questions.py`, `bot/sheets_write.py`, 新規 `bot/history_classification.py`。
- 移行：新規 `scripts/migrate-history.py`。
- JSテスト：新規 `tests/history-classification.test.mjs`, `tests/history-integration.test.mjs`, `tests/fixtures/history-classification.json`。更新 `tests/history_questions.test.mjs`, `tests/history-progress.test.mjs`, `tests/history-ui.browser.mjs`, `tests/web-build.test.mjs`, `tests/service-worker.test.mjs`。
- Pythonテスト：新規 `bot/tests/test_history_classification.py`, `bot/tests/test_history_schema.py`, `bot/tests/test_history_migration.py`。更新 `bot/tests/test_csv_validation.py`, `bot/tests/test_public_questions.py`, `bot/tests/test_public_revocation.py`。
- 文書：`README.md`, `docs/WEB_RELEASE.md`, 新規 `docs/HISTORY_V1_MIGRATION.md`, 本報告。

## 判断・上限・残作業

数値・サイズ制限、分類の解釈、匿名利用、先行Web公開、バックアップ・保守時間帯・列追加・PWA対策・復旧の詳細は [HISTORY_V1_MIGRATION.md](HISTORY_V1_MIGRATION.md) を参照。年0は作らず、年代を推測して付け足さない。旧問題は未分類で全範囲学習にだけ含め、実際の分類付けは本人が別途レビューする。

未実施：本番データでのドライラン、実シートの16/13列化、Bot本番再起動とDiscord操作、Web公開、iPhone実機Safari/PWAの更新・旧キャッシュ残存試験、macOS/Linuxでのブラウザテスト。いずれも資格情報や本番アクセスが必要、または実機が必要なため、今回の作業範囲外。無停止移行を保証しない。

Firestoreのスキーマ・Rulesと `history-config.js` の接続設定には差分がない。Cloud対応の追加作業も行っていない。変更は未コミット・未ステージでレビュー可能な状態に保持している。
