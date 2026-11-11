# 属性ラベル・世界史の流れ 実装報告

## 実装範囲

- `attribute-tags.js`：任意ラベルの構文検証、階層・複数ラベルの照合、数値単位の制約。
- `script.js`：通常教材の追加列読み取り、既存選択肢生成への属性照合。ID・進捗キー・保存処理は維持。
- `history-flow.js`：独立JSONの検証、不正・重複問題の除外、分類フィルタ、シャッフル、ID採点、セッション成績。
- `history-flow-ui.js` / `index.html` / `style.css`：専用設定画面、2形式の回答操作、取り消し・やり直し、解説、再挑戦・設定変更。ホームとジャンル画面から利用可能。
- `history-flow-data.json`：本番用の空データ。テスト教材の自動投入なし。
- `scripts/build-web.mjs` / `sw.js`：新しいJS・JSONを許可リストとハッシュ検証対象に追加。
- `scripts/validate-study-data.mjs`：ローカル・読み取り専用CSV照合とJSON検証。
- `templates/` / `docs/STUDY_DATA_SPEC.md`：別担当ChatGPT向けの確定仕様、CSVテンプレート、2形式の架空サンプルと投入手順。
- `tests/` / `package.json`：新規エンジン・UIテストと成果物のファイル一覧の更新。

認証、Firestoreルール・スキーマ、世界史一問一答の公開シート読み取り、Bot処理は変更していません。
本番教材・進捗への書き込み、Bot起動、push・PR・公開は実行していません。
開始時の未追跡ファイルは保持し、今回の変更には含めません。

## 検証

- `npm.cmd test`：115件成功。既存回帰とラベル・歴史の流れ・UI・Webビルド・Service Workerを含む。
- `bot/.venv/Scripts/python.exe -m unittest discover -s bot/tests`：115件成功。既存のDeprecationWarningあり。
- `node --test tests/history-flow.browser.mjs`：3件成功。隔離Chrome、外部HTTP(S)遮断、架空データのみ。375px・1280pxで並び替え、正誤表示、再挑戦、同時代判定、空データを確認。
- ラベルCSVおよび歴史JSONサンプル・空本番JSONのCLI検証成功。
- `npm.cmd run build:web -- --out dist/study-data-review-20261111`：17ファイルのローカル成果物生成成功。公開なし。
- 最終調整後の成果物：`dist/study-data-final-20261111`（17ファイル）。
- Firestoreルールテストは今回未実行（進捗保存・認証・ルールの変更なし）。新モードは保存APIを呼びません。

## 引き継ぎ・制限

データ作成前に [確定仕様](STUDY_DATA_SPEC.md) を使用してください。
本番用のラベル付与・歴史問題作成は別担当です。新モードの履歴はセッション内のみで、画面にも明示します。
本番公開前に教材の人手レビュー、データ検証、テスト、明示承認が必要です。
