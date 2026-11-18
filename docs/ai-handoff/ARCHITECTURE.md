# 現行アーキテクチャ

| 領域 | 主な入口とデータ |
| --- | --- |
| 通常教材 | `index.html`・`script.js`。公開Google Sheetsの `ID`・表面・裏面と任意の `front_tags` / `back_tags`。英単語・古文等は同じ出題画面と処理を使う。 `attribute-tags.js` がタグ・数値形式・辞書を検証し、`choice-dictionary.json` が候補と同義語を保管する。準拠CSVは `scripts/validate-study-data.mjs labels` で検証する。 |
| 世界史一問一答 | `history_questions.js` が公開専用9列／13列を検証し、`history-classification.js` と `history-regions.json` が時代・世紀・地域を扱う。現行Pages用の公開接続先は `config/history-public-rebuild.json`。Botの管理側には旧12列と分類付き16列がある。 |
| 世界史の流れ | `history-flow-config.js` が静的JSONまたは専用公開Sheetsを選ぶ。 `history-flow-source.js` は公開21列をv1.0／v1.1モデルに変換し、`history-flow.js` が検証・抽出・採点、`history-flow-ui.js` が画面・再挑戦を管理する。専用管理CSV／Sheetは23列。 |
| Firebase | 既存Firebase Authenticationを使用。Firestoreは `users/{uid}/progress/{ジャンル}` の進捗を使用し、通常教材は `id_*`、世界史一問一答は `history_<ID>` を使用する。世界史の流れはセッションのみ。リポジトリのRules候補と本番デプロイ状態は別管理。 |
| Discord Bot | `bot/history_bot.py` が一問一答、`bot/flow_commands.py`・`bot/flow_store.py` が流れを処理する。管理用と公開用のデータを分離し、CSV検証、管理者の承認、照合、読み戻し、復旧の手順を持つ。詳細は [Bot README](../../bot/README.md)・[流れ運用](../HISTORY_FLOW_SHEETS_BOT.md)。 |
| 公開とPWA | GitHub Pages。 `scripts/build-web.mjs` がWeb資産だけを許可リストで集め、`release.json` とService Workerのハッシュを生成する。 `.github/workflows/web-release.yml` の手動実行によるレビューと承認済みデプロイ経路を使用する。 |

## 互換性の維持

- 既存の英単語・古文・世界史一問一答・世界史の流れの入口、問題ID、CSV列、履歴のキーとパスを維持する。
- タグ列のない教材も読み込む。空欄・無効タグ、数値の完全一致、候補不足の扱いは [データ仕様](../STUDY_DATA_SPEC.md) に従う。
- 公開ブラウザの接続先は公開専用のデータに限る。アプリの公開ビルドに教材の元資料・管理Sheetデータ・Bot運用ファイル・引き継ぎ資料は含めない。
- Gitの新しいリビジョンとPagesの配置は個別に確認する。テストはモック、架空データ、必要に応じてデモエミュレータで行う。
