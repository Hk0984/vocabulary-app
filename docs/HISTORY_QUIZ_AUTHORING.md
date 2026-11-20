# 世界史一問一答の作問仕様

対象は「世界史一問一答」の4択。回答前は地理問題に白地図を表示する。回答後は正解の解説を表示し、誤答時は選んだ選択肢の解説も表示する。地図は正解と選んだ誤答を表示し、国は範囲、都市などはピンで示す。

[作問用22列テンプレート](../templates/history-quiz-pilot-22.csv)・[サンプル3問](../templates/history-quiz-pilot.sample.csv)・[既存13列のテンプレート](../templates/history-import-13.csv)

## 作問用ChatGPTへの依頼文

以下と、サンプルCSV・作問対象の原資料を渡す。既存問題に解説を加える場合は、対象の13列CSVも渡す。

> 添付の世界史一問一答CSVから、指定した問題IDの行を新しい22列形式へ変換してください。対象IDの指定がなければ、まず先頭10問を対象にしてください。サンプルと同じヘッダ・列順のUTF-8 CSVにし、1問を1レコードにしてください。カンマや引用符を含むセルはCSVの規則に従って囲ってください。
>
> 元の13列は文字列として読み込み、IDの先頭ゼロ、設問、選択肢の順序、正答番号、補足、分類を含めてそのまま写してください。追加するのは末尾の9列です。既存問題に誤りや曖昧さが見つかった場合は、問題IDと修正案を確認リストに記載してください。
>
> `explanation1`〜`explanation4` は同じ番号の選択肢に対応します。全4欄に簡潔な日本語で1〜2文ずつ書いてください。正解には史実に基づく根拠を、誤答には誤りの理由と、その選択肢に関する正しい事実を記載します。既存の `explanation` は問題全体の補足用です。
>
> 選択肢が現在の国で、国境表示が適切なときは `map_kind` に `country`、`place1`〜`place4` に対応するISO 3166-1 alpha-3国コード（例 `FRA`）を入れてください。都市・史跡など地点を問うときは `point` とし、全4欄を「緯度|経度」（例 `41.0086|28.9802`）で指定してください。年代や人物など、地点や国が選択肢になっていない問題は、地図の5欄をすべて空にしてください。
>
> 歴史上の領域をそのまま示す問題では、現代の国境を当てはめないでください。代表地点が正答として妥当な設問なら `point` を使えます。複数の候補を一意に区別できる座標・国コードを確認できない場合は、地図の5欄を空欄にし、問題IDと理由を確認リストに記載してください。史実や正答の根拠を確認できない行は、CSVの出力対象から外し、確認リストにIDと理由を記載してください。
>
> 最後に、元の13列が対象行とセル単位で一致し、追加した解説と位置が各選択肢番号に対応していることを確認してください。変換したCSVと、対象件数・出力件数・確認待ちIDを記した確認リストを別々に返してください。

既存の時代・世紀・地域の詳しい仕様は [世界史分類](HISTORY_V1_MIGRATION.md#形式と互換性) と [地域コード](../history-regions.json)。地図は Natural Earth 1:10m v4.1.0 を加工した QGIS の world_map.gpkg の国データを簡略化したもの。国ポリゴンは収録済みのコードを利用できる。[地図データの由来](https://github.com/qgis/QGIS/blob/master/resources/data/README_world_map.md)

完全な新規問題を作る場合は、正答が一意になる4択とし、`answer` に半角の1〜4を指定する。時代・地域が未確認なら `unclassified`、世紀・年代が未確認なら空欄。単年は `1919..1919` の形式。IDは対象環境の接頭辞で発行する。

## ローカルで検証する

作問CSVから既存の取込用13列を切り出す場合は、第2引数に新しいファイルを指定する。試験画面はサンプルCSVの問題をモックの公開シートとして読み込む。

```sh
node scripts/history-quiz-details.mjs templates/history-quiz-pilot.sample.csv
node scripts/history-quiz-details.mjs draft.csv draft-import-13.csv
node scripts/build-iphone-preview.mjs iphone-review-history templates/history-quiz-pilot.sample.csv
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist/iphone-review-history
```

ブラウザで `http://127.0.0.1:8000/` を開き、トップの「世界史一問一答を学ぶ」から「登録順」を選んで開始する。自分の問題を試すときは、ビルドのCSVを差し替えて新しい出力名を使う。

既存の公開問題に解説を付けた試験用ビルドは、対象の公開設定と `--history-quiz-csv` を指定して作成する。

```sh
npm run build:web -- --out dist/history-pilot --history-public-config config/history-public-rebuild.json --history-quiz-csv draft.csv
```

ビルドに渡した22列CSVの追加情報は、問題ID・設問・元の順番での4択・正答番号が公開問題と完全一致したときに表示される。作問中の教材はモックプレビューで確認する。公開を承認した行だけを `config/history-quiz-reviewed.csv` に用意すると、`rebuild_v1` の公開用ビルドが読み込む。追加情報のCSVはUTF-8で10 MBまで。ビルドは追加情報を専用の配信ファイルにし、世界史一問一答を開いたときに読み込む。ファイルがない問題やデータが取得できなかった場合も、公開シートの既存13列で出題する。新規問題の13列取込・承認は [既存運用](HISTORY_REBUILD.md) に従う。
