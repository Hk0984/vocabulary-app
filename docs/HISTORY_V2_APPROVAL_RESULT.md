# 世界史 v2.0：1問のローカル承認記録テスト

追記：その後、本人の別途承認を受け、対象1問の新Sheetsへの公開と読み戻し照合が成功した。`HISTORY_V2_PUBLICATION_RESULT.md` を参照。以下は承認記録作成時点の記録。

2026-11-03、本人による問題内容の確認と明示承認に基づき、以下の1問だけを承認した。
Sheets上の状態を変更したのではなく、既存機構が使用する**ローカル承認JSON**を更新した。

| 項目 | 結果 |
|---|---|
| 問題ID | `hv1_rebuild1_smoke_001` |
| batch_id | `7d9d156a7283` |
| 新管理用の再取得 | 接続先・タブ・16列ヘッダー正常、ID一意、登録時の全16項目と一致 |
| status | `draft`のまま。publishedへの変更なし |
| 内容ハッシュ | `efd2eaa34c094496ec8683f84c9c998e1cff1307c308dbb05c71c405e1efc534` |
| 承認日時 | `2026-11-03T09:45:08.939124+00:00`（日本時間18:45:08） |
| reviewed_by | `repository-owner (explicit chat approval)`：本人のチャット承認に基づく記録。電子署名・Googleアカウント本人認証を意味しない |
| 承認済み件数 | 1件のみ。既存430問の記録は変更せず、未承認のまま |

## 記録と検証

- 使用中の承認ファイル：`local-history/history-reviews.local.json`。
- 対象1問の `approved`、`answer_unique`、`historical_content`、`classification` をtrueとし、承認者・日時を記録した。
- SHA-256は再取得した問題の公開用13項目から既存 `question_digest` で生成した。
- 既存 `require_approved` が現在の新環境プロファイルと再取得データで成功することを確認した。
- 管理用再取得結果：`local-history/smoke-approval-20261103/management-readback.json`。
- 更新前の承認JSON全体：`local-history/smoke-approval-20261103/review-before.json`。
- 実行結果：`local-history/smoke-approval-20261103/result.json`。
- 準備時の `local-history/smoke-001-review/review-manifest.json` は未承認の控えであり、現在のプロファイルが参照するファイルではない。これを有効ファイルに上書きしない。

サービスアカウントのSDK内部認証を使い、Sheetsは `spreadsheets.readonly` スコープ・GETのみ。
`.env` の読み取り、秘密鍵・トークンの表示はなし。新公開用・旧Sheetsへのアクセスも今回はなし。
Sheetsへの書き込み、承認・公開コマンド、Botの常駐起動、Git操作による反映、Webデプロイは行っていない。

## モックテスト

追加した `bot/tests/test_history_smoke_approval.py` は本番に接続しない。
公開用13項目それぞれをメモリ上で変更し、既存 `require_approved` が承認を拒否することを確認。
別ID・別batch・published状態の承認拒否、他問題の記録保持、既存レビューと変更済み内容の不一致も検証した。
ハッシュは公開内容に結び付く仕様で、status・batch_id・created_atは公開内容ハッシュの対象ではない。
今回の承認作成前にそれらも登録時記録と完全一致を確認している。公開時にも対象batchと状態を再確認する。

- JavaScript：105件成功、0失敗。
- Python：109件成功、0失敗（新規5テストを含む）。
- Firestore・認証・Rules変更なし。エミュレータの再実行なし。

## 次の公開手順（今回は未実行）

1. **この1問の公開に対する別途承認を得る。** 今回の許可はローカル承認記録作成まで。
2. 新管理用・新公開用を再取得し、接続先・ヘッダー・ID・draft状態・batch_idが一致することを確認する。バッチ内が対象1問だけであり、公開先に同一IDや不整合がないことも確認する。
3. 再取得内容に対し、現在の `history-reviews.local.json` で承認検証を再実行する。内容が変わった場合は公開を止め、人の再確認・再承認が必要。
4. 承認された実行方法で、新環境の既存公開処理を対象batch `7d9d156a7283` に限定して実行する。新公開用へ13項目を追加し、公開成功の照合後に新管理用のstatusをpublishedへ変更する操作となる。旧Sheetsには触れない。
5. 両新Sheetsを読み戻し、1件のみ公開・全13項目一致・管理用published・重複なしを確認してバックアップする。タイムアウトや不一致なら停止し、状態確認なしで再実行・削除しない。
6. Webの接続切替・公開・ログイン後の保存試験は、それぞれの承認範囲を確認して行う。今回のローカル承認だけではWeb接続先は変わらない。

既存 `history-config.js` と本人確定の旧公開用IDの不一致は未解決のまま保持している。詳細は `HISTORY_V2_DRAFT_RESULT.md`。今回、この接続設定は変更していない。
