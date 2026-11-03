# 世界史 v2.0：実ブラウザ接続再検証（2026-11-03）

本人による許可リファラー追加後、Chrome・Edgeの両方でHTTP 200となり、従来の403は解消した。
`UI_REQUIRE_LIVE=1` で実行し、世界史データの再生・Referer偽装は使用していない。

| 項目 | Chrome | Edge |
|---|---|---|
| ページURL | `http://127.0.0.1:8765/` | 同左 |
| 実際のReferer | `http://127.0.0.1:8765/` | 同左 |
| Referrer-Policy | `strict-origin-when-cross-origin` | 同左 |
| 新公開用Sheetsの応答 | 200 | 200 |
| 問題取得 | 13列・`hv1_rebuild1_smoke_001` 1問 | 同左 |
| テスト | 3件成功・失敗0・スキップ0 | 同左 |

新環境ビルドは `dist/history-v2-live-web-20261103/` を使用。
新公開用Sheetsから実際に取得したデータで、世界史ジャンル選択→学習設定→4択出題→採点→解説→結果画面を検証した。
正答率100%、30問指定時も利用可能な1問で終了、時代・世紀・地域のフィルタを確認。
375/402/1280pxの2列×2行表示と横方向の崩れがないことも確認した。
期待値との比較に保存済みデータは使うが、ブラウザへ問題データを返す再生処理は実接続必須モードでは実行しない。

匿名状態のため履歴保存は行わない。本番Firebaseの初期化と通信は隔離テストで抑止。
英単語・古文への切替試験のみ語彙データと匿名ユーザーをモックし、本番の語彙取得・認証全体の試験とは分けている。
実ブラウザは隔離プロファイルのheadless実行であり、iPhone/Safari/PWAの実機試験は含まない。

## 証跡（Git除外）

- Chrome：`dist/history-v2-browser-5GVhvd/verification.json` と `history-375.png` / `history-402.png` / `history-1280.png`。
- Edge：`dist/history-v2-browser-3QPLYa/verification.json` と同名の画面画像。
- `requireLive: true`、`dataMode: live_without_replay`、Sheets応答200、送信Referer、外部書き込み要求0を記録。
- APIキー・認証情報・キー付きリクエストURLは記録していない。

前回の未完了だった直接接続2件は、今回いずれも成功した。
今回の再実行対象はブラウザ計6件であり、JavaScript/Python/Firestore全回帰を新たに再実行した結果ではない。
アプリ本体・テストコードの修正は不要だった。今回の変更は本報告書と過去報告への追記のみ。

旧/新Sheetsへの書き込み、本番Firestore変更、Cloud設定変更、コミット・push・デプロイは行っていない。
終了時にローカル検証サーバー・隔離ブラウザを停止した。既存公開Webの接続先は未変更。
