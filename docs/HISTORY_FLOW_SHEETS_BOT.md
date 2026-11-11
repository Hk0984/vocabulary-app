# 世界史の流れ：Discord Bot / Google Sheets連携

この機能は既存の世界史一問一答・属性ラベル・Firestore履歴から独立しています。
初期教材はローカル専用の `materials/history-flow-handout-admin-import.csv` の61問だけです。このCSVは非公開のためGit追跡・公開履歴から除外し、CIは架空の `tests/fixtures/flow-admin.synthetic.csv` を使用します。
同時代判定31問・並び替え30問、全件draft。元CSVを変更せずコピーしました。
以前の100問は参照・投入しません。教材CSV・管理用データ・バックアップはWeb成果物に含みません。

## 構成と列仕様

管理用と公開用は**別のスプレッドシート**にしてください。タブだけの分離は認めません。
既存一問一答のID・タブ・Botコマンド・データ構造は流用しません。

管理用タブ `history_flow_admin` の23列（A:W、順序固定）：

```csv
id,type,question,item1_id,item1_text,item1_time_ranges,item2_id,item2_text,item2_time_ranges,item3_id,item3_text,item3_time_ranges,item4_id,item4_text,item4_time_ranges,answer,explanation,period_codes,century_codes,area_codes,time_ranges,source,status
```

公開用タブ `history_flow_public` の21列（A:U、順序固定）：上記の先頭21列です。
`source` と `status` は含めません。管理用シートは非公開のまま保持してください。
アプリに必要な正解・解説は公開データに含まれます。

- CSVはUTF-8（BOM可）。エクスポートはUTF-8 BOM付き。標準の引用符・セル内改行に対応。
- contemporaryは4項目必須、answerは1つの項目ID。
- orderingは3〜4項目、answerは全項目IDを正解順に `;` で連結。3項目ならitem4関連3セルはすべて空欄。
- 問題・項目IDは英字開始の英数字・`_`・`-`（1〜80文字）。IDの重複、空の必須フィールド、未知項目・分類、範囲外列を拒否。
- 問題文・項目文・解説は10000文字以内。分類・年代は既存 `history-classification.js` / `bot/history_classification.py` と `history-regions.json` を使用。
- 紀元前は負数、0年禁止。複数年代は `;`、紀元前後は別範囲。時代・世紀との一致を検証。
- statusはdraft/approved/published。CSV新規投入・更新はdraftのみ。既存IDの同一内容再投入は現在の状態を維持する冪等処理。
- 非年代セルの先頭 `= + - @`（先頭空白除去後）や不正制御文字を拒否。全書込みはRAW。読取りはFORMULA指定で既存の式も検出。
- シートは正確な見出しを事前作成し、データを連続させる。途中の空行・余剰データ・不正な状態は書込み前に停止。末尾のクリア済み行は許可。

架空教材のCSV例：[`templates/history-flow-admin.sample.csv`](../templates/history-flow-admin.sample.csv)。
既存JSON契約は1.0のままです。公開21列からchoices/events・answerを復元して既存バリデーターを通します。

## 61問の検証結果と限界

- 23列・列順、61個の一意ID、31/30の内訳、全件draftを確認。
- 項目数・項目ID・正解ID・並び替え順序の集合整合性、必須文字列・出典、分類マスターを検証。
- 年代の符号・0年禁止・範囲・世紀・時代・地域コードの検証に不備なし。
- 並び替えは明示された各出来事年代が正解順に厳密な昇順であることを検証。
- 「同じ世紀」問題は指定世紀に一致する候補が正解1件に限定されることをメタデータで検証。
- 該当不備ID：なし。本文・年代・正解の自動修正はしていません。
- **外部資料を用いた史実確認は未実施**です。元の「前.pdf」「中.pdf」「後.pdf」も今回提供されていません。正答の意味上の一意性・プリントとの対応は公開前に人手確認してください。
- 年代不足や「同じ世紀」以外の基準は検証レポートで人手確認を案内します。年代逆転・重複や同世紀の複数正答はapproveを拒否。推測で正解を生成しません。

オフライン検証（Sheets・Discordには接続しません）：

```powershell
bot/.venv/Scripts/python.exe scripts/manage-flow.py validate --csv materials/history-flow-handout-admin-import.csv
bot/.venv/Scripts/python.exe scripts/manage-flow.py import --csv materials/history-flow-handout-admin-import.csv
```

2行目は空のローカル状態に対する差分確認だけです。既存状態のCSVがある場合は `--baseline existing.csv` で照合します。
既存IDで異なる内容なら変更列を表示して拒否。`--update` を明示したドライランで旧値・新値を含む差分を確認し、その計画だけを別途適用します。

## 接続設定（本番導入の承認後に行う）

Bot/CLIのプロセス環境に次を設定します。ファイルやトークンの実値をリポジトリに追加しないでください。

| 設定名 | 用途 |
|---|---|
| FLOW_ADMIN_SPREADSHEET_ID | 新しい管理用スプレッドシートID |
| FLOW_ADMIN_SHEET_NAME | `history_flow_admin`（固定の専用タブ名） |
| FLOW_PUBLIC_SPREADSHEET_ID | 新しい公開専用スプレッドシートID |
| FLOW_PUBLIC_SHEET_NAME | `history_flow_public`（固定の専用タブ名） |
| ADMIN_USER_IDS | 既存の管理者DiscordユーザーID一覧 |
| GOOGLE_SERVICE_ACCOUNT_FILE | 既存と同じ資格情報の安全な参照方式 |

既存のDiscord Botトークン・ギルド同期設定は従来どおりです。新しいBotプロセスは追加しません。
設定不足、同じ管理・公開ID、設定済みの一問一答IDとの衝突は停止。未知の未設定IDは推測しません。
CLIは `.env` を自動読込しません。実行プロセスに必要な設定を管理者が用意してください。

管理用シートはBotのサービスアカウントと管理者だけに共有し、公開用だけをブラウザが読み取れる状態にします。
専用シートに既存データを置かず、23列・21列の見出しだけを作成してください。作成・共有設定・投入はこの開発作業では実行していません。

## Discordコマンド

すべてサーバー内のADMIN_USER_IDSに限定し、返答はephemeralです。管理者は複数サーバーで同じ制御を受けます。
一般ユーザーやDMには本文・正解・管理情報を返しません。メンションを無効化し、Markdownをエスケープします。
大きな差分は管理者だけにJSON添付で返します。

| コマンド | 使い方 |
|---|---|
| `/flow list` | page（1〜、10問/ページ）、status、question_typeで一覧を絞る |
| `/flow show question_id:...` | 問題全文・項目・正解・解説・分類・出典・状態 |
| `/flow validate file:...` | 添付23列CSVを検証。file省略時は専用シート全件を検証 |
| `/flow import file:...` | CSV全件検証後、新規問題を全件draft登録。エラー・既存IDの内容衝突があれば全件中止 |
| `/flow edit question_id:... field:explanation value:...` | 1列の更新計画。ID・statusの直接編集は禁止。整合性が保てない複数列修正はCSV更新を使用 |
| `/flow approve question_id:... reviewed:true` | 互換性のため維持。通常のDiscord公開操作では不要 |
| `/flow publish` | draft全件の件数・ID・差分・公開内容を提示し、ephemeralの確認ボタンで一括公開 |
| `/flow publish question_id:...` | 指定したdraftまたはapprovedを、同じ確認ボタンで公開・再公開 |
| `/flow unpublish question_id:...` | 公開取消し。管理状態はapprovedに戻す |
| `/flow recover` | 未完了操作のバックアップへのロールバック計画 |

通常の操作は **`/flow import file:...` → `/flow publish` →「内容を確認して公開」ボタン**の2コマンドです。新規インポートは登録まで実行し、公開は必ずボタン確認を待ちます。
`/flow import apply:false` は登録せず差分だけ表示します。既存データ更新は従来どおり `update:true` のドライランを行い、同じ引数に `apply:true plan_hash:<表示されたハッシュ>` を追加して適用します。既存IDが同一内容の場合は現在の状態を維持し、変更内容が異なる場合にupdateを省略すると全件を拒否します。
`/flow edit`・`/flow approve`・`/flow unpublish`・`/flow recover` は従来どおりドライラン後に `apply:true plan_hash:...` を指定します。
計画は操作者・接続先・前後の内容・承認記録と結び付いています。いずれかが変わった場合、古いハッシュでは適用できません。
確認ボタンは実行した管理者本人・同じサーバーでのみ有効です。180秒で期限切れとなり、キャンセル・期限切れ・使用後の再クリックでは書き込みません。確認時も権限を確認し、対象全件を再検証します。シート全体の内容・対象集合・承認記録・接続先のいずれかが確認表示後に変わっていれば中止し、再度コマンド実行が必要です。
ボタン確認は対象の公開内容を管理者が確認する操作です。プログラムによる史実の自動承認ではありません。メタデータ上の年代逆転や複数正答は従来同様に公開を拒否し、人手確認が必要な警告も差分に含めます。
公開後のeditまたは変更を伴うCSV更新は公開側を撤去してdraftへ戻します。再公開には新しい `/flow publish` の確認が必要です。
引数なしの公開対象はdraftだけです。既存publishedは追加対象にせず、内容・ID・状態を維持します。approvedの再公開はquestion_idを指定してください。すでにpublishedなら変更なしとして扱います。
確認時の本文ハッシュを従来の承認記録に保存し、監査・バックアップ・未完了ジャーナル・復旧を再利用します。2つの公開確認を同時に確定しても、後の計画は古くなるため二重公開しません。

## 接続CLI（承認後の運用例）

CLIの動作は変更していません。従来の明示ハッシュ適用・個別approve/publishを維持し、Discordだけで使う確認ボタンをCLIから省略する経路は追加していません。

```powershell
bot/.venv/Scripts/python.exe scripts/manage-flow.py import --csv materials/history-flow-handout-admin-import.csv --connected --actor <管理者ID>
# 差分を確認してから、同じ操作に次の2引数を付ける：
# --apply --plan-hash <接続ドライランで得たハッシュ>
bot/.venv/Scripts/python.exe scripts/manage-flow.py approve --id <問題ID> --reviewed --connected --actor <管理者ID>
bot/.venv/Scripts/python.exe scripts/manage-flow.py publish --id <問題ID> --connected --actor <管理者ID>
```

list/show/exportも利用可能です。`export --connected --actor ...` は管理用CSVを標準出力へ書き出すので、管理者専用の非公開保存先を使用してください。
オフラインの計画ハッシュは接続適用には使えません。接続ドライランをやり直してください。
`--apply` 単独、actor未設定・非管理者、見出し不備・照合失敗の場合、書込みません。

## 書込み・監査・復旧

- 各操作前に管理publishedのID・全公開項目と、公開シートのID・内容を全件照合します。不整合なら停止。
- 読み取った内容と書込み直前の内容を比較し、専用タブのA:WまたはA:Uの必要行だけにRAWで書きます。行削除・既存シート流用は行いません。
- 変更前後の完全バックアップと未完了ジャーナル、承認ハッシュ、操作者・ID・計画ハッシュ・時刻・結果の監査ログを `local-history/flow/` に保存します。Web・Git対象外です。
- バックアップ・intent監査を保存できなければ書込みません。正常終了にはシート再読取り・照合・承認記録・complete監査が必要です。
- 公開は管理状態の更新後に行い、公開取消しは公開側の撤去から行います。2つのスプレッドシートをまたぐため、完全な原子性はありません。
- タイムアウト・結果不明・途中失敗時は盲目的に再試行せず、ジャーナルを残して以後の変更を停止します。
- `/flow recover` または `manage-flow.py recover --connected --actor ...` で現在状態を確認し、復旧計画ハッシュを確認後にapplyします。復旧はその操作前の状態へのロールバックです。
- 現在の値がバックアップの前後いずれにも一致しない場合は自動復旧しません。管理者がバックアップ・監査と実データを確認してください。ジャーナルを手動削除して続行しないでください。
- バックアップ・承認記録はBotとCLIで共有し、永続ディスクに保管してください。バックアップには非公開の出典を含むためアクセスを制限してください。
- 既存Botの単一プロセスロックを維持し、flow操作にもシートIDごとのOSロックと既存の非同期更新ロックを使用します。**同一シートへ書くBot/CLIは単一ホストで運用し、外部編集者を停止してください。** 複数ホスト・手動編集との分散トランザクションは提供しません。

## Webの切り替え

本番の `history-flow-config.js` は `mode:'sheets'` で専用公開シートへ接続します。静的JSONは空のまま保持し、開発用の明示的な切替でのみ使用します。既存の制限付きブラウザキーを `HISTORY_QUESTIONS_CONFIG.apiKey` から参照します。
専用公開シートの作成・確認・教材審査・公開とWeb公開の承認後、管理者が次の公開用設定だけを指定します。

```javascript
window.HISTORY_FLOW_CONFIG = Object.freeze({
    mode: 'sheets',
    spreadsheetId: 'YOUR_DEDICATED_PUBLIC_SHEET_ID',
    sheetName: 'history_flow_public',
    apiKey: 'YOUR_RESTRICTED_BROWSER_API_KEY'
});
```

管理シートID・サービスアカウント・Botトークンはこのファイルに置きません。
ブラウザ用キーには既存と同様のAPI・HTTPリファラー制限を設け、公開用シートだけを共有してください。
データソースは必ず一方だけ。Sheets失敗時に静的JSONへ自動フォールバックせず、追加マージもしません。
403/404・通信失敗・公開ヘッダー不備・重複・不正問題は説明付きで出題停止します。正常な空シートは「まだ問題が登録されていません」。
既存の2形式・分類フィルタ・解説・セッション成績・再挑戦を維持し、Firestoreへの新規保存は行いません。

## テストと本番導入前の確認

```powershell
npm.cmd test
bot/.venv/Scripts/python.exe -m unittest discover -s bot/tests
node --test tests/history-flow.browser.mjs
npm.cmd run build:web -- --out dist/flow-sheets-review
```

初回連携実装時はWeb130件、Bot134件、隔離ブラウザ4件の成功を確認。今回の2コマンド化ではWeb130件・Bot146件を検証（Web・Firebase認証・Firestoreの実装は変更なし）。BotはSheetsモックのみ、ブラウザは外部通信遮断。
61問のCSV往復・公開投影・全件ロード・ID採点、権限・既存コマンド共存・変更・承認・公開・取消し・復旧、375px/1280px表示を検証しています。
進捗・認証・Firestoreルールに変更がないためルール用エミュレータテストは今回の変更では実行していません。

本番導入は、史実と出典の人手確認→専用2シートの作成・共有・ヘッダー設定→権限・資格情報・バックアップ保存先の設定→新規draftインポート→一括公開の内容確認・ボタン確定→Web設定切替・ビルド・公開承認、の順です。
本開発では本番シート作成・設定・投入・承認・公開、Bot起動/再起動、push・PR・mainマージ・デプロイは行っていません。

### 2コマンド化の変更ファイル

- `bot/flow_commands.py`：新規インポートの登録、公開確認の作成、既存更新手順の維持。
- `bot/flow_confirmation.py`：本人限定のephemeral確認、期限切れ・キャンセル・二重操作の防止。
- `bot/flow_store.py`：draft一括公開計画、全件検証・承認ハッシュ・公開同期。
- `bot/tests/test_flow_commands.py`、`bot/tests/test_flow_confirmation.py`、`bot/tests/test_flow_store.py`：61問の登録・公開・取消し・再公開、内容変更・権限・途中失敗・復旧のモック検証。
- `bot/README.md`、本書：新しい操作手順。

稼働中Botには自動反映されません。実装の反映には別途承認されたBot再起動・コマンド同期が必要です。今回の作業では実行しません。

## 変更ファイル一覧（26件）

```text
README.md
bot/README.md
bot/flow_schema.py
bot/flow_store.py
bot/flow_commands.py
bot/history_bot.py
bot/tests/test_flow_schema.py
bot/tests/test_flow_store.py
bot/tests/test_flow_commands.py
docs/STUDY_DATA_SPEC.md
docs/HISTORY_FLOW_SHEETS_BOT.md
materials/history-flow-handout-admin-import.csv
templates/history-flow-admin.sample.csv
scripts/manage-flow.py
history-flow-source.js
history-flow-config.js
history-flow-ui.js
index.html
package.json
scripts/build-web.mjs
sw.js
tests/history-flow-source.test.mjs
tests/history-flow-ui.test.mjs
tests/history-flow.browser.mjs
tests/service-worker.test.mjs
tests/web-build.test.mjs
```

データ検証・初期教材、Bot/Sheets管理、Web連携・運用仕様の3つのローカルコミットに分割しています。開始時に存在した未追跡ファイルは含めていません。
