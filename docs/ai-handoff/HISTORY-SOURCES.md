# 世界史一問一答の原資料照合

2026-11-18 JSTの公開13列データを読み取り、問題IDと公開分類を整理した。公開の世界史一問一答1,551行と世界史の流れ61問は別系列。流れ61問は同時代31問・年代順30問。

## 機械検査と重複候補

- 1,551行で重複ID、分類エラー、分類警告、正答番号・選択肢形式の異常は各0件。時代または地域が未分類の行は62件。
- 正規化した問題文が一致する候補は1組。仰韶文化の土器を問う `hv1_rebuild1_600238`（`ato_p7`）と `hv1_rebuild1_cn_history_0002`（`cn_history_0002`）の正答はともに彩陶。
- 前者の選択肢は黒陶・彩陶・縄文土器・須恵器、時代は古代。後者は彩陶・白陶・灰陶・黒陶、時代は先史と古代。解説と出典IDも異なる。両方とも中国の分類で、明示された世紀・年代範囲は空欄。元資料照合までは重複候補として保持する。

## 原資料チェックリスト

- [ ] エジプト史・西アジア史の配布原稿、版・作成日、ページ対応付け、正答表を入手する。複数の版がある場合はページ番号の対応も確認する。
- [ ] 旧430問の2026-11-03公開バックアップと、440問の元になった公開エクスポートまたはID一覧・当時の定義を入手する。履歴・削除済み・draftを含むかを確認する。
- [ ] 430・440・現行1,551の各版を問題ID・出典ID・ページ・正答で対応付ける。複数のIDが同じ出典箇所を指す場合は、出題意図と選択肢も照合する。
- [ ] 紙面のページごとに出題ID、正解、対応する時代・世紀・地域、未出題の有無を記録する。未分類62行も原資料を確認してから対象地域への追加集計を判断する。
- [ ] 仰韶文化の候補2行は出典の版・ページ・解説・時代コードを照合し、教材管理者の判断を記録する。
- [ ] 各行の判定を「一致」「要確認」「未照合」のいずれかに更新し、確認者・日時・根拠を付ける。元資料が入手できない箇所は未照合のままとする。

入力が公開シートの13列JSONなら、次のコマンドで集計とID一覧を再生成できる。

```sh
node scripts/audit-history-sources.mjs PUBLIC_SNAPSHOT.json
```

## 地域別の問題IDと出題範囲

エジプト15件、西アジアと地域マスターの下位197件。両方に入るIDは2件。以下は現行分類に基づく範囲で、原資料との照合は全件「未照合」。空欄の世紀・年代は公開分類に明示されていない。

### エジプト（15件）

地域コード別の行数は `geo.egypt` 15件、`geo.levant` 2件。複数分類の行は各分類に含める。
時代コード別の行数は `ancient` 2件、`medieval` 13件。

<details>
<summary>エジプトのID・公開出典ID・出題範囲</summary>

| 問題ID | 公開出典ID | 地域 | 時代 | 世紀 | 年代 | 原資料 |
| --- | --- | --- | --- | --- | --- | --- |
| hv1_rebuild1_300124 | mae_p4 | geo.egypt | ancient | bce_04 | -332..-332 | 未照合 |
| hv1_rebuild1_300131 | mae_p4 | geo.egypt | ancient | — | — | 未照合 |
| hv1_rebuild1_600198 | ato_p6 | geo.egypt | medieval | ce_10;ce_11;ce_12 | 909..1171 | 未照合 |
| hv1_rebuild1_600199 | ato_p6 | geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_600200 | ato_p6 | geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_600201 | ato_p6 | geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_600202 | ato_p6 | geo.egypt | medieval | ce_12;ce_13 | 1169..1250 | 未照合 |
| hv1_rebuild1_600203 | ato_p6 | geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_600204 | ato_p6 | geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_600205 | ato_p6 | geo.egypt | medieval | ce_13 | 1250..1250 | 未照合 |
| hv1_rebuild1_600206 | ato_p6 | geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_600207 | ato_p6 | geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_600208 | ato_p6 | geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_400270 | naka_p7 | geo.egypt;geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400314 | naka_p8 | geo.levant;geo.egypt | medieval | — | — | 未照合 |

</details>

### 西アジア（197件）

地域コード別の行数は `geo.anatolia` 56件、`geo.china` 1件、`geo.egypt` 2件、`geo.france` 1件、`geo.german_lands` 2件、`geo.iran_plateau` 45件、`geo.italy` 6件、`geo.levant` 72件、`geo.mesopotamia` 17件、`geo.west_asia` 10件。複数分類の行は各分類に含める。
時代コード別の行数は `ancient` 79件、`medieval` 119件。

<details>
<summary>西アジアのID・公開出典ID・出題範囲</summary>

| 問題ID | 公開出典ID | 地域 | 時代 | 世紀 | 年代 | 原資料 |
| --- | --- | --- | --- | --- | --- | --- |
| hv1_rebuild1_300260 | mae_p7 | geo.anatolia | ancient | ce_04 | 330..330 | 未照合 |
| hv1_rebuild1_300309 | mae_p8 | geo.anatolia | ancient | ce_05 | 451..451 | 未照合 |
| hv1_rebuild1_400170 | naka_p5 | geo.anatolia | medieval | ce_08 | 726..726 | 未照合 |
| hv1_rebuild1_400176 | naka_p5 | geo.anatolia | medieval | ce_11 | 1054..1054 | 未照合 |
| hv1_rebuild1_400179 | naka_p5 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400201 | naka_p5 | geo.anatolia | medieval | ce_13 | 1202..1204 | 未照合 |
| hv1_rebuild1_400260 | naka_p7 | geo.anatolia | medieval | ce_11 | 1095..1095 | 未照合 |
| hv1_rebuild1_400276 | naka_p7 | geo.anatolia | medieval | ce_13 | 1204..1204 | 未照合 |
| hv1_rebuild1_400277 | naka_p7 | geo.anatolia | medieval | ce_13 | 1204..1204 | 未照合 |
| hv1_rebuild1_400278 | naka_p7 | geo.anatolia | medieval | ce_13 | 1204..1261 | 未照合 |
| hv1_rebuild1_400279 | naka_p7 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400280 | naka_p7 | geo.anatolia | medieval | ce_13 | 1261..1261 | 未照合 |
| hv1_rebuild1_400281 | naka_p7 | geo.anatolia | medieval | ce_13 | 1204..1204 | 未照合 |
| hv1_rebuild1_400301 | naka_p8 | geo.anatolia | medieval | ce_06 | 527..565 | 未照合 |
| hv1_rebuild1_400302 | naka_p8 | geo.anatolia | medieval | ce_06 | 527..565 | 未照合 |
| hv1_rebuild1_400306 | naka_p8 | geo.anatolia | medieval | ce_06 | 527..565 | 未照合 |
| hv1_rebuild1_400307 | naka_p8 | geo.anatolia | medieval | ce_06 | 527..565 | 未照合 |
| hv1_rebuild1_400308 | naka_p8 | geo.anatolia | medieval | ce_06 | 527..565 | 未照合 |
| hv1_rebuild1_400311 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400312 | naka_p8 | geo.anatolia | medieval | ce_06 | 527..565 | 未照合 |
| hv1_rebuild1_400318 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400319 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400320 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400321 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400322 | naka_p8 | geo.anatolia | medieval | ce_07 | 610..641 | 未照合 |
| hv1_rebuild1_400323 | naka_p8 | geo.anatolia | medieval | ce_07 | 610..641 | 未照合 |
| hv1_rebuild1_400324 | naka_p8 | geo.anatolia | medieval | ce_07 | 610..641 | 未照合 |
| hv1_rebuild1_400325 | naka_p8 | geo.anatolia | medieval | ce_08 | 717..741 | 未照合 |
| hv1_rebuild1_400326 | naka_p8 | geo.anatolia | medieval | ce_08 | 717..741 | 未照合 |
| hv1_rebuild1_400327 | naka_p8 | geo.anatolia | medieval | ce_08 | 726..726 | 未照合 |
| hv1_rebuild1_400328 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400330 | naka_p8 | geo.anatolia | medieval | ce_11 | 1071..1071 | 未照合 |
| hv1_rebuild1_400331 | naka_p8 | geo.anatolia | medieval | ce_11 | 1071..1071 | 未照合 |
| hv1_rebuild1_400332 | naka_p8 | geo.anatolia | medieval | ce_11 | 1071..1071 | 未照合 |
| hv1_rebuild1_400333 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400334 | naka_p8 | geo.anatolia | medieval | ce_11;ce_12 | 1081..1118 | 未照合 |
| hv1_rebuild1_400335 | naka_p8 | geo.anatolia | medieval | ce_11;ce_12 | 1081..1118 | 未照合 |
| hv1_rebuild1_400337 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400338 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400339 | naka_p8 | geo.anatolia | medieval | ce_13 | 1204..1204 | 未照合 |
| hv1_rebuild1_400340 | naka_p8 | geo.anatolia | medieval | ce_13 | 1204..1204 | 未照合 |
| hv1_rebuild1_400341 | naka_p8 | geo.anatolia | medieval | ce_13 | 1261..1261 | 未照合 |
| hv1_rebuild1_400342 | naka_p8 | geo.anatolia | medieval | ce_15 | 1453..1453 | 未照合 |
| hv1_rebuild1_400343 | naka_p8 | geo.anatolia | medieval | ce_15 | 1453..1453 | 未照合 |
| hv1_rebuild1_400344 | naka_p8 | geo.anatolia | medieval | ce_15 | 1453..1453 | 未照合 |
| hv1_rebuild1_400345 | naka_p8 | geo.anatolia | medieval | ce_15 | 1453..1453 | 未照合 |
| hv1_rebuild1_400346 | naka_p8 | geo.anatolia | medieval | — | — | 未照合 |
| hv1_rebuild1_400310 | naka_p8 | geo.anatolia;geo.china | medieval | — | — | 未照合 |
| hv1_rebuild1_400169 | naka_p5 | geo.anatolia;geo.italy | medieval | ce_08 | 726..726 | 未照合 |
| hv1_rebuild1_400329 | naka_p8 | geo.anatolia;geo.italy | medieval | ce_11 | 1054..1054 | 未照合 |
| hv1_rebuild1_400336 | naka_p8 | geo.anatolia;geo.italy | medieval | ce_11 | 1095..1095 | 未照合 |
| hv1_rebuild1_400197 | naka_p5 | geo.anatolia;geo.levant | medieval | ce_11 | 1095..1095 | 未照合 |
| hv1_rebuild1_400256 | naka_p7 | geo.anatolia;geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400270 | naka_p7 | geo.egypt;geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400295 | naka_p7 | geo.france;geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400300 | naka_p7 | geo.german_lands;geo.levant | medieval | ce_13 | 1229..1229 | 未照合 |
| hv1_rebuild1_300031 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300032 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300033 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300034 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300035 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300036 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300037 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300038 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300039 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300040 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300041 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300042 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300043 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300044 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300070 | mae_p2 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_300250 | mae_p7 | geo.iran_plateau | ancient | ce_03 | 260..260 | 未照合 |
| hv1_rebuild1_600086 | ato_p3 | geo.iran_plateau | ancient | bce_03;bce_02;bce_01;ce_01;ce_02;ce_03 | -248..-1;1..226 | 未照合 |
| hv1_rebuild1_600087 | ato_p3 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_600088 | ato_p3 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_600089 | ato_p3 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_600092 | ato_p3 | geo.iran_plateau | ancient | ce_03 | 226..226 | 未照合 |
| hv1_rebuild1_600093 | ato_p3 | geo.iran_plateau | ancient | ce_03 | 230..230 | 未照合 |
| hv1_rebuild1_600094 | ato_p3 | geo.iran_plateau | ancient | ce_03 | 260..260 | 未照合 |
| hv1_rebuild1_600095 | ato_p3 | geo.iran_plateau | ancient | ce_03 | 260..260 | 未照合 |
| hv1_rebuild1_600096 | ato_p3 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_600097 | ato_p3 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_600100 | ato_p3 | geo.iran_plateau | ancient | — | — | 未照合 |
| hv1_rebuild1_600091 | ato_p3 | geo.iran_plateau | ancient;medieval | ce_03;ce_04;ce_05;ce_06;ce_07 | 226..651 | 未照合 |
| hv1_rebuild1_400305 | naka_p8 | geo.iran_plateau | medieval | — | — | 未照合 |
| hv1_rebuild1_600099 | ato_p3 | geo.iran_plateau | medieval | ce_06 | 531..579 | 未照合 |
| hv1_rebuild1_600101 | ato_p3 | geo.iran_plateau | medieval | ce_07 | 642..642 | 未照合 |
| hv1_rebuild1_600102 | ato_p3 | geo.iran_plateau | medieval | ce_07 | 651..651 | 未照合 |
| hv1_rebuild1_600121 | ato_p3 | geo.iran_plateau | medieval | ce_07 | 642..642 | 未照合 |
| hv1_rebuild1_600151 | ato_p4 | geo.iran_plateau | medieval | — | — | 未照合 |
| hv1_rebuild1_600173 | ato_p5 | geo.iran_plateau | medieval | ce_10 | 932..932 | 未照合 |
| hv1_rebuild1_600175 | ato_p5 | geo.iran_plateau | medieval | — | — | 未照合 |
| hv1_rebuild1_600177 | ato_p5 | geo.iran_plateau | medieval | ce_11;ce_12 | 1038..1157 | 未照合 |
| hv1_rebuild1_600178 | ato_p5 | geo.iran_plateau | medieval | ce_11 | 1038..1038 | 未照合 |
| hv1_rebuild1_600185 | ato_p5 | geo.iran_plateau | medieval | ce_11 | 1073..1092 | 未照合 |
| hv1_rebuild1_600186 | ato_p5 | geo.iran_plateau | medieval | — | — | 未照合 |
| hv1_rebuild1_600192 | ato_p5 | geo.iran_plateau | medieval | — | — | 未照合 |
| hv1_rebuild1_600193 | ato_p5 | geo.iran_plateau | medieval | ce_13;ce_14 | 1258..1353 | 未照合 |
| hv1_rebuild1_600195 | ato_p5 | geo.iran_plateau | medieval | ce_13 | 1295..1295 | 未照合 |
| hv1_rebuild1_600196 | ato_p5 | geo.iran_plateau | medieval | — | — | 未照合 |
| hv1_rebuild1_600197 | ato_p5 | geo.iran_plateau | medieval | — | — | 未照合 |
| hv1_rebuild1_400171 | naka_p5 | geo.italy;geo.anatolia | medieval | ce_08 | 726..726 | 未照合 |
| hv1_rebuild1_400175 | naka_p5 | geo.italy;geo.anatolia | medieval | ce_11 | 1054..1054 | 未照合 |
| hv1_rebuild1_400293 | naka_p7 | geo.italy;geo.anatolia;geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_300045 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300046 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300047 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300048 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300049 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300050 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300051 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300052 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300053 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300054 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300055 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300056 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300057 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300058 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300059 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300060 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300061 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300062 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300063 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300064 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300065 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300066 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300067 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300068 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300069 | mae_p2 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300264 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300265 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300266 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300267 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300268 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300269 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300270 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300271 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300272 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300273 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300274 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300275 | mae_p7 | geo.levant | ancient | — | — | 未照合 |
| hv1_rebuild1_300276 | mae_p7 | geo.levant | ancient | ce_04 | 313..313 | 未照合 |
| hv1_rebuild1_400252 | naka_p7 | geo.levant | medieval | ce_11;ce_12;ce_13 | 1096..1270 | 未照合 |
| hv1_rebuild1_400257 | naka_p7 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400261 | naka_p7 | geo.levant | medieval | ce_11 | 1096..1096 | 未照合 |
| hv1_rebuild1_400262 | naka_p7 | geo.levant | medieval | ce_11 | 1099..1099 | 未照合 |
| hv1_rebuild1_400263 | naka_p7 | geo.levant | medieval | ce_11 | 1099..1099 | 未照合 |
| hv1_rebuild1_400264 | naka_p7 | geo.levant | medieval | ce_12 | 1189..1192 | 未照合 |
| hv1_rebuild1_400265 | naka_p7 | geo.levant | medieval | ce_12 | 1189..1189 | 未照合 |
| hv1_rebuild1_400269 | naka_p7 | geo.levant | medieval | ce_12 | 1187..1187 | 未照合 |
| hv1_rebuild1_400271 | naka_p7 | geo.levant | medieval | ce_12 | 1187..1187 | 未照合 |
| hv1_rebuild1_400272 | naka_p7 | geo.levant | medieval | ce_12 | 1189..1192 | 未照合 |
| hv1_rebuild1_400274 | naka_p7 | geo.levant | medieval | ce_13 | 1202..1202 | 未照合 |
| hv1_rebuild1_400283 | naka_p7 | geo.levant | medieval | ce_13 | 1229..1229 | 未照合 |
| hv1_rebuild1_400284 | naka_p7 | geo.levant | medieval | ce_13 | 1229..1229 | 未照合 |
| hv1_rebuild1_400286 | naka_p7 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400287 | naka_p7 | geo.levant | medieval | ce_13 | 1228..1228 | 未照合 |
| hv1_rebuild1_400288 | naka_p7 | geo.levant | medieval | ce_13 | 1291..1291 | 未照合 |
| hv1_rebuild1_400289 | naka_p7 | geo.levant | medieval | ce_13 | 1291..1291 | 未照合 |
| hv1_rebuild1_400290 | naka_p7 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400291 | naka_p7 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400294 | naka_p7 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400299 | naka_p7 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_600122 | ato_p3 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_600155 | ato_p4 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_600183 | ato_p5 | geo.levant | medieval | ce_11 | 1071..1071 | 未照合 |
| hv1_rebuild1_600184 | ato_p5 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_600194 | ato_p5 | geo.levant | medieval | — | — | 未照合 |
| hv1_rebuild1_400314 | naka_p8 | geo.levant;geo.egypt | medieval | — | — | 未照合 |
| hv1_rebuild1_400282 | naka_p7 | geo.levant;geo.german_lands | medieval | ce_13 | 1228..1228 | 未照合 |
| hv1_rebuild1_600090 | ato_p3 | geo.mesopotamia | ancient | — | — | 未照合 |
| hv1_rebuild1_600157 | ato_p5 | geo.mesopotamia | medieval | ce_08;ce_09;ce_10;ce_11;ce_12;ce_13 | 750..1258 | 未照合 |
| hv1_rebuild1_600158 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600159 | ato_p5 | geo.mesopotamia | medieval | ce_08 | 750..754 | 未照合 |
| hv1_rebuild1_600160 | ato_p5 | geo.mesopotamia | medieval | ce_08 | 750..750 | 未照合 |
| hv1_rebuild1_600162 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600166 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600167 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600168 | ato_p5 | geo.mesopotamia | medieval | ce_08;ce_09 | 786..809 | 未照合 |
| hv1_rebuild1_600170 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600171 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600172 | ato_p5 | geo.mesopotamia | medieval | ce_08;ce_09 | 786..809 | 未照合 |
| hv1_rebuild1_600174 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600179 | ato_p5 | geo.mesopotamia | medieval | ce_11 | 1055..1055 | 未照合 |
| hv1_rebuild1_600180 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600187 | ato_p5 | geo.mesopotamia | medieval | — | — | 未照合 |
| hv1_rebuild1_600191 | ato_p5 | geo.mesopotamia | medieval | ce_13 | 1258..1258 | 未照合 |
| hv1_rebuild1_300121 | mae_p4 | geo.west_asia | ancient | — | — | 未照合 |
| hv1_rebuild1_300122 | mae_p4 | geo.west_asia | ancient | bce_04 | -334..-334 | 未照合 |
| hv1_rebuild1_300123 | mae_p4 | geo.west_asia | ancient | bce_04 | -333..-333 | 未照合 |
| hv1_rebuild1_300125 | mae_p4 | geo.west_asia | ancient | bce_04 | -331..-331 | 未照合 |
| hv1_rebuild1_300126 | mae_p4 | geo.west_asia | ancient | — | — | 未照合 |
| hv1_rebuild1_300127 | mae_p4 | geo.west_asia | ancient | bce_04 | -323..-323 | 未照合 |
| hv1_rebuild1_300128 | mae_p4 | geo.west_asia | ancient | — | — | 未照合 |
| hv1_rebuild1_300130 | mae_p4 | geo.west_asia | ancient | — | — | 未照合 |
| hv1_rebuild1_300132 | mae_p4 | geo.west_asia | ancient | — | — | 未照合 |
| hv1_rebuild1_300133 | mae_p4 | geo.west_asia | ancient | — | — | 未照合 |

</details>
