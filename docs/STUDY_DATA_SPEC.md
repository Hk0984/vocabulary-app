# 属性ラベル・世界史の流れ：データ作成者への引き継ぎ

本番教材の作成は別担当です。この実装は問題の自動生成・既存教材の自動分類を行いません。
`templates/` の例は架空教材で、Web成果物には含まれません。

## 属性ラベル（確定仕様）

既存Sheetsの `ID・表面・裏面` を維持し、任意の `front_tags`、`back_tags` 列を追加します。
空欄・列なしは従来どおり。世界史一問一答の公開シートには追加しません。
ラベルは `category/subcategory`（大分類/小分類）のちょうど2階層のみ。各区分は小文字ASCII英字で始まる英数字・アンダースコアです。複数は `;` 区切り。
大分類単独（`number` など）や3階層以上（`number/mass/kg`、`concept/a/b/c` など）は不正として拒否します。空欄は未ラベルとして有効です。
空要素・重複・前後空白は禁止。1セル2048文字、最大32ラベルです。

例：`language/verb`、`number/percent`、`concept/academic;language/noun`。

推奨大分類と例：

| 大分類 | 例 |
|---|---|
| number | number/calendar_year、number/percent、number/mass_kg、number/money_yen |
| person | person/politician、person/thinker、person/scientist |
| geography | geography/country、geography/city、geography/region |
| institution | institution/law、institution/policy |
| organization | organization/government、organization/company |
| substance | substance/nutrient、substance/compound、substance/material |
| phenomenon | phenomenon/natural、phenomenon/social |
| concept | concept/academic、concept/theory |
| language | language/noun、language/verb、language/adjective |

分類名は閉じた列挙ではなく上記構文で追加可能です。教材全体で同じ語彙を使ってください。
表面→裏面は `back_tags`、逆方向は `front_tags` を参照します。数値以外は同じ大分類を必須とし、同じ小分類の候補を優先した後、既存の類似度・重複判定を適用します。
数値は2階層が完全一致するラベルを必須とします。数値の種類・単位は小分類に含めてください。`number/percent` と `number/calendar_year`、`number/mass_kg` と `number/mass_g` は一致しません。
正答側・候補側のどちらかに数値ラベルがある場合、補助的な `concept/academic` などの一致だけでは候補を採用しません。人物と地理など、大分類が異なる回答形式も混ぜません。ラベルは回答形式を正しく表すものを付与してください。
複数ラベルはOR条件です。互換性のない数値単位を同じセルに併記しないでください。
ラベル付き問題には無ラベル候補を混ぜません。2〜3択に縮小し、誤答ゼロならスキップを案内します。
不正な非空ラベルは候補を選ばない安全側の扱いです。投入前に必ず検証してください。
高難易度の表示訳を選ぶ前のカード単位で属性を比較するため、同じカードの複数の訳には共通する属性を付けてください。

### ラベル投入手順

1. 対象の通常単語シートをCSVで書き出し、ローカル照合用に `genre,id,front,back,front_tags,back_tags` の見出しへ揃える（genreは正確なシート名）。
2. 安定した既存IDを使い、本文を変更せずラベルを作成する。IDがない教材は先に管理者が安定IDを整備する。行番号をIDの代わりに使わない。
3. [CSVテンプレート](../templates/attribute-tags.csv) に従い、追加対象だけのCSVを作成する。UTF-8、CSV標準の引用符に対応。
4. `node scripts/validate-study-data.mjs labels labels.csv baseline.csv` で照合する。
5. ジャンルとIDの重複、本文不一致、未知ID、既存ラベルの上書き・空欄消去は拒否される。ツールは書き込みをしない。意図した既存ラベル修正は管理者が差分を別途レビューする。
6. 管理者が承認した差分だけをID照合でSheetsのラベル列に反映する。既存3列を上書きしない。本作業では本番投入を実行していない。

検証は既存CSV・追加CSVの両方のラベルを確認し、不正な階層を検出しても自動変換・消去しません。Sheetsに設定済みの2階層ラベルはそのまま利用できます。

ブラウザ側のID解釈と進捗キーは変更していません。通常教材の既存の数値IDをそのまま維持してください。

## 世界史の流れJSON（確定仕様 1.0）

本番ファイルは `history-flow-data.json`。初期値は空の `questions` 配列です。
専用Google Sheets・Discord Bot連携を使用する場合は [連携仕様・運用手順](HISTORY_FLOW_SHEETS_BOT.md) を参照してください。`history-flow-config.js` で静的JSONか専用公開シートを明示選択し、両方を混在させません。
ルートは `{"schema_version":"1.0","questions":[]}`。
既存 `history_questions`・公開9列シート・管理シートには接続しません。

| 項目 | 型・制約 |
|---|---|
| id | 英字で始まる英数字・`_`・`-`、1〜80文字。全問題で一意、更新時にも保持 |
| type | `contemporary`（同時代判定）または `ordering`（年代順） |
| question / explanation | 必須、空白のみ不可、各10000文字以内 |
| choices | contemporary専用、ちょうど4項目 |
| events | ordering専用、3〜4項目 |
| answer | contemporaryは正解項目ID文字列。orderingは全出来事IDの正解順配列 |
| period_codes | 必須文字列。既存時代コードを `;` 区切り |
| century_codes | 必須文字列。`ce_12`、`bce_05` 等、複数は `;`。不明は空文字 |
| area_codes | 必須文字列。既存地域マスターのコードを `;` 区切り |
| time_ranges | 必須文字列。`1101..1200`。複数は `;`。不明は空文字 |
| source | 任意の非空文字列、10000文字以内。公開できる出典のみ |

各choices/events項目は `{"id":"a","text":"出来事の文"}`。
項目IDも上記のID構文に従い、問題内で一意。textは非空、10000文字以内、正規化後の重複も不可。
各項目に任意の `time_ranges` 文字列を追加できます。採点には年代を使わず、指定したanswerだけを使います。
形式の異なるchoices/events混在、未知フィールド、欠落項目、正解IDの欠落・重複を拒否します。
重複した問題IDは先勝ちにせず全件除外します。不正な問題だけ除外し、設定画面の「データ検証結果」に行位置・ID・理由を表示します。
JSON構文不正やルート不正は読み込みエラーを表示します。

分類は `history-classification.js` と `history-regions.json` の既存マスターを使用します。
時代：`prehistoric` / `ancient` / `medieval` / `early_modern` / `modern` / `contemporary`。
地域：マスターの `geo.*` または `global` / `unclassified` / `unspecified`。
分類不明は時代・地域を `unclassified`、世紀・年代を空文字としてください。
未分類は分類フィルタ選択時に除外されます。`global` は特定の地域の下位には入りません。
地域親コードのフィルタは子孫を含みます。複数選択は同軸でOR、軸間でANDです。
年代は-100000〜100000の整数、紀元前は負数、0年なし。紀元前後を跨ぐ場合は `-5..-1;1..5` のように分割します。
年代・世紀・時代の整合性も既存検証に従って検査します。

### サンプル・追加・更新

動作する2形式の例：[history-flow.sample.json](../templates/history-flow.sample.json)。架空教材で、製品データに自動追加されません。

```powershell
node scripts/validate-study-data.mjs flow templates/history-flow.sample.json
node scripts/validate-study-data.mjs flow history-flow-data.json
npm.cmd test
npm.cmd run build:web -- --out dist/study-review
```

別担当がサンプルを複製して史実を確認した問題を作成し、検証を通した後、管理者が `history-flow-data.json` の questions に反映してください。
問題追加にJavaScript修正は不要。公開・更新には別途承認が必要です。
静的JSON方式では教材をWebビルドに含めて更新します。Sheets方式では実装済みの専用21列読み取りアダプターを通して同じJSON形式へ変換します。
本番前に問題内容・正解・解説・分類の人手レビュー、ローカル検証、全テスト、PC/スマートフォンの確認を実施し、承認後に既存の公開手順へ進みます。
Service Workerには新しいJSとJSONを含めており、ビルド時にハッシュ検証対象になります。テンプレート・検証スクリプト・Botファイルは含みません。

## 成績と制限

新モードの成績はセッション内のみ。画面に保存されない旨を明示し、既存Firestoreドキュメント・ルール・認証は変更しません。
並び替えはタップで選択、ひとつ取り消す、やり直す、回答確定。回答後は操作を無効化し、正解順と解説を表示します。
終了時は出題数・正解数・不正解数・正答率・再挑戦・設定変更を表示します。
将来の複数空欄形式、永続履歴、Sheetsへの自動書き込みは今回の対象外です。
