# 世界史：新規環境での再構築

旧430問の管理12→16列本番移行は必須ではない。新規の管理16列・公開13列を**別々の新規ブック**として用意する。旧シート・旧問題・旧Firestore履歴は削除・更新しない。本作業はローカルの準備・検証までで、本番Sheets作成/書込、Bot本番起動、公開実行を含まない。

## データ形式と保護

- 新規取込CSV：13列。`templates/history-import-13.csv` はヘッダだけで、公開可能なサンプル問題は入っていない。
- 管理：16列。`templates/history-management-16.csv`。status/batch_id/created_atはJ/K/L、分類はM〜P。取込は常にdraftを作り、Botが新規batch_id・created_atを発行する。旧管理データの状態や日時は推定しない。
- 公開：13列。`templates/history-public-13.csv`。管理情報や承認者情報を含めない。
- Botは全使用範囲をGETして検証する。N/Q列の余分なヘッダ、ヘッダのない余剰セルも拒否する。空の物理列・消去済み行は許容し、行位置を維持する。
- 基本文字列、ID重複、選択肢重複、必須値、セル長、時代/世紀/地域/年代は共通検証を通す。不正な対象行は書込API呼出し前に停止する。
- Firestore形式・文書ID・Rulesは維持する。新問題は環境固有のIDを使い、旧history_<id>をコピー・リセットしない。同じ文書内に旧/新の別キーとして共存する。

## ローカル初期化

次のコマンドはローカルファイルだけを生成する。ネットワークSDK・ライブ書込モードはない。出力先は存在しないディレクトリを指定する。

```powershell
bot/.venv/Scripts/python.exe -B scripts/history-rebuild.py init --prefix hv1_rebuild1_ --out dist/history-rebuild-init
bot/.venv/Scripts/python.exe -B scripts/history-rebuild.py validate --management dist/history-rebuild-init/management-empty.csv --public dist/history-rebuild-init/public-empty.csv --prefix hv1_rebuild1_
```

初期化成果物は3種類のヘッダCSV、空の承認記録、接続設定テンプレート、公開設定テンプレート。ID欄が空の設定は検証に失敗する。空環境の管理/公開件数0は正常だが、ヘッダすらないシートは初期化済みとは扱わない。

`hv1_rebuild1_` はローカル検証用の例。実運用では**過去にも他環境にも使っていない接頭辞**を本人が決める。同じ接頭辞を別の問題集合へ再利用しない。既存Firestore全件は今回読み取っていないため、全履歴に対する世界的な未使用保証ではない。

## 接続設定の分離

`config/history-environments.example.json` を、リポジトリ外またはGit除外の `local-history/` にコピーして使う。旧管理/旧公開のIDを `legacy_spreadsheet_ids` に控え、新環境の管理/公開ID、タブ名、ID接頭辞、承認JSONのパスを入力する。鍵・トークン・APIキーはこのJSONへ入れない。

新旧IDの再利用、管理と公開の同一ブック、環境間のID/接頭辞重複、未知の設定項目は拒否する。タブ名だけを変えた同一ブック運用にはしない。

```powershell
$env:HISTORY_ENVIRONMENT_FILE = 'C:\safe-location\history-environments.local.json'
$env:HISTORY_ENVIRONMENT = 'rebuild_v1'
```

この指定だけではBotを起動しない。選択名やJSONが不正なら旧設定へフォールバックせず停止する。接続JSONはBotプロセス内で固定するので、設定変更時は承認された停止・再起動が必要。承認JSONは公開/修復時に再読込する。

新セレクタを両方解除すると既存の旧接続用環境変数を参照する。ただし新Botのスキーマは16/13列なので、旧12/9列のBot運用を再開する際は旧Botコードの保存版が必要。現コードをそのまま旧12/9列へ向けて書かない。Webの旧シート読取は9/13互換のまま。

## 旧問題を再登録候補にする

保存済みの旧9列CSVを入力する。元ファイルは読み取りのみ。ID以外の旧本文・source_id・選択肢・正答・解説を維持する。

```powershell
bot/.venv/Scripts/python.exe -B scripts/history-rebuild.py candidates --input PUBLIC_BACKUP.csv --prefix hv1_rebuild1_ --out dist/history-rebuild-candidates
```

成果物：`candidates-13.csv`、`id-map.csv`、`review-manifest.json`、`report.json`。旧IDと本文のハッシュから新IDを決定し、同じ入力の別出力先への再実行では同じ候補になる。本文/正答等が変われば新IDも変わる。新ID同士と入力の旧IDとの衝突も検査する。既に新接頭辞のIDが混在する元CSVは二重再発行を防ぐため拒否する。

分類は全て未分類/空欄で補完し、内容・正解・分類の確認フラグは全てfalse、承認者・承認日時は空欄にする。旧シートに公開されていたことを新環境での承認とみなさない。全候補がneeds_reviewで、候補生成だけでは一問も公開できない。

今回の430問は2026-11-03の保存済み公開バックアップを使用した候補であり、最新のライブ全件を取り直した結果ではない。旧管理CSVや旧status/batch/createdは不要で、復元・移行したとは主張しない。

## 人による内容レビューと承認

1. 候補の問題文・正答・誤答を資料と照合し、正解が一意か確認する。年代・地域は主題に直接関連するものだけを付け、解説/誤答に現れるだけの場所は付けない。AI推測や不明年の補完はしない。
2. 分類を確認する。未確認なら未分類のまま候補に留める。世紀不明は空欄、概念上指定不要ならunspecified/globalなどの意味を確認する。未分類を承認する場合も、分類検索で出ないことを承認者が明示判断する必要がある。
3. 編集後のCSVから新しい承認ひな型を作る。既存承認は**内容が同じで全確認項目が有効な場合だけ**引き継ぐ。変更された行は全て未承認へ戻る。

```powershell
bot/.venv/Scripts/python.exe -B scripts/history-rebuild.py review --csv REVIEWED_CANDIDATES.csv --prefix hv1_rebuild1_ --previous-manifest PREVIOUS_REVIEW.json --out dist/review-next
```

初回はprevious-manifestを省略する。生成JSONの対象行に、実際の確認に基づき `answer_unique`, `historical_content`, `classification`, `approved` をtrueにし、`reviewed_by`, `reviewed_at` を記入する。sha256はツールが計算した値を使用する。全件承認コマンドは用意していない。

この記録は人の判断を代替せず、電子署名でもない。権限を持つ本人が管理するローカルファイルを信頼する設計。Bot実行者の読取権限と承認者の編集権限を管理し、公開処理中はCSV・承認記録・シートを手動変更しない。承認データ・バックアップは公開成果物/Gitへ含めない。

Botは新環境で13列とID接頭辞を確認してdraft取込を行う。`/publish` は対象バッチ全件の承認・内容ハッシュ・3確認項目・承認者/日時が揃わなければ停止する。`/repair-publish`、公開先への追記も同じ承認を要求する。古い承認で変更済み問題を公開できない。

公開成功前に管理statusを変更しない既存設計を維持する。公開追記後のタイムアウトは読戻して照合し、重複追記を避ける。status更新が失敗すると、承認済み公開行と管理draftが一時的に不一致になり得る。自動削除で直さず、状態を確認して承認済みの公開再試行で整合させる。公開削除失敗時は管理元を保持する。

## 新Sheetsの手動準備（別途承認後）

1. 旧Sheets/旧データ/旧Bot版・Web成果物を保存し、旧シートは編集しない。新規の管理/公開ブックを別々に作る。
2. 管理へ16列、公開へ13列のヘッダのみを入れる。管理は限定共有、公開は専用ブックだけを必要な閲覧範囲で共有する。サービスアカウント権限の設定は本人が行う。秘密鍵はこの作業へ渡さない。
3. 新ブックのCSVを保存し、空環境のvalidateを行う。旧IDと違う接続設定を記入し、ID接頭辞も一致させる。
4. Botの起動許可後、同じシートに1インスタンスだけで運用する。未承認候補をdraftへ取り込み、/checkと人のレビュー後、承認された対象だけを公開する。テスト用の専用ID/バッチから検証し、旧430問へ操作しない。
5. 管理/公開CSVを同時点で取得し、公開済みID集合と全13列の内容、承認記録を照合する。

```powershell
bot/.venv/Scripts/python.exe -B scripts/history-rebuild.py validate --management NEW_MANAGEMENT.csv --public NEW_PUBLIC.csv --prefix hv1_rebuild1_ --reviews REVIEW_MANIFEST.json
```

これはローカル照合のみ。公開側のdraft混入、ID/本文/分類不一致、未承認を検出したら停止する。問題を削除・再作成する自動修復は行わない。

## アプリ切替と復旧

アプリの元の `history-config.js` は旧接続として維持する。Bot用の管理接続JSONをWebへ渡さず、公開用設定だけを生成する。

```powershell
bot/.venv/Scripts/python.exe -B scripts/history-rebuild.py public-config --profiles C:\safe-location\history-environments.local.json --environment rebuild_v1 --out dist/rebuild-public-config
npm.cmd run build:web -- --out dist/rebuild-web --history-public-config dist/rebuild-public-config/public-config.json
```

公開用JSONは公開ブックID・タブ名・ID接頭辞・13列必須フラグの4項目だけ。ブラウザ用APIキーは既存Web設定からビルド時に再利用し、管理ID・レビューJSON・認証情報は成果物へコピーしない。新公開IDが旧公開IDと同じ、空、または余分な項目がある場合はビルドを停止する。新しいローカル出力先を指定する。

手動Actionsの `history_environment` は `legacy/rebuild_v1` を選択する。既定legacy、デプロイ既定false、mainと確認文字列のガードは維持する。新環境を公開するときは `rebuild_v1` を明示選択し、Git管理済みの[公開用設定](../config/history-public-rebuild.json)を使う。新公開用IDは設定済みで、新旧接続先を分離したローカル環境設定の検証も完了している。管理用IDや承認記録の実データはGit除外のローカル設定で保持し、Gitには[環境設定のひな型](../config/history-environments.example.json)だけを含める。

接続検証の記録は[実ブラウザ接続検証結果](HISTORY_V2_LIVE_WEB_RESULT.md)、公開操作は[Web公開手順](WEB_RELEASE.md)、固定旧版による復旧は[Pages移行・復旧手順](PAGES_MIGRATION_ROLLBACK.md)を参照する。Actions実行と本番公開は、それぞれ本人の別途承認を得てから行う。

切替後はPWAを全タブ終了→再起動し、buildIdと新IDの問題を確認する。旧タブが残っている間は旧データの学習が続き得る。新旧の学習履歴は別IDで保持されるが、実機Safari/PWAは別途確認する。

復旧は、Webをlegacy設定で再ビルド/手動選択して旧公開シートへ戻す。Google SheetsやFirestoreを巻き戻さない。旧履歴は残っているので旧問題IDへ戻れば再び対応する。Botは停止を調整し、新環境セレクタ解除と旧Bot保存版への復帰を承認後に行う。旧12/9列を新Botに自動移行させない。新旧データはどちらも削除しない。

新環境でもFirebase接続先・保存形式は同じ。実公開後の回答は既存本番Firestoreへ保存されるため、事前確認は匿名利用を優先し、保存試験は本人が許可したテストアカウントで行う。今回の検証はモックとdemoエミュレータのみ。
