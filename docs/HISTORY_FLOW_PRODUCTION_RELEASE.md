# 世界史の流れ 本番公開検証（2026-11-12）

対象は既存の `https://hk0984.github.io/vocabulary-app/`。世界史一問一答は `rebuild_v1` を維持します。

## 公開前の検証

- `history-flow-config.js` を専用公開シートのSheetsモードに変更。既存の制限付きブラウザキーを参照し、管理用ID・資格情報は追加していません。
- Web131件・Bot146件成功。GitHub Actionsが実行する許可リストのビルド・Service Workerテストも含みます。
- `dist/flow-production-review`：19ファイル、buildId `c5545ce03d96dbdddd05`。新しいJS/JSONは許可リスト・ハッシュ検証対象です。
- 本番URLのオリジンでローカル成果物を表示する隔離Chromeから、公開Sheetsへの実GETが成功。取得済みデータの再生や認証による迂回はしていません。
- 61問（同時代判定31・並び替え30）、全問の出題・ID採点・解説、シャッフル、時代・世紀・地域フィルタ、390px幅の表示を確認。各形式1問を意図的に誤答にして集計も検証。
- 既存一問一答991問（`hv1_rebuild1_`）と通常単語ジャンルの読み込み・4択表示を確認。Firebase起動・認証・書込みは検証ブラウザで遮断しました。
- 本番オリジンからのSheetsアクセスは成功。他サイトRefererは `API_KEY_HTTP_REFERRER_BLOCKED`、Drive APIは再検証で `API_KEY_SERVICE_BLOCKED`（いずれも403）を確認。Cloudコンソールの許可リスト自体の管理操作は行っていません。
- 実際のデプロイ済みファイルとService Worker有効化はデプロイ後に同じ検証スクリプトのliveモードで確認します。

## 公開履歴と教材の分離

61問の授業プリント由来CSVはユーザー指定で非公開です。ファイルはローカルに維持し、Git追跡・公開ブランチの履歴から除外します。
元の未公開コミットは `backup/local-flow-private-20261112` にローカル保管し、このブランチはpushしません。公開する作業ブランチは最新origin/mainを親とする整理済みの履歴にします。
CIでは `tests/fixtures/flow-admin.synthetic.csv` の架空61問を使用し、実教材ファイルが存在しなくても全テストが動作します。
`.env`・資格情報JSON・ローカルバックアップ・監査ログ・授業プリントPDFはGit/Pagesに含めません。無関係な未追跡ファイルは保持します。

## 公開手順

1. 作業ブランチをpushしてPRを作成し、差分・テスト結果を確認。
2. 既存 `web-release.yml` を `deploy=false, history_environment=rebuild_v1` で起動し、レビュー成果物の19ファイル・SHA-256・公開用設定を検証。
3. PRをmainへマージし、mainから `deploy=true, history_environment=rebuild_v1, confirmation=REPLACE_PRODUCTION` で既存Pagesを更新。
4. `tests/flow-release.browser.mjs` のliveモードで、実際の本番ファイル、61問、既存モード、Service WorkerのbuildId・キャッシュを再検証。

Sheetsの問題内容・Firestore・Botプロセスは変更しません。最終のPR・コミット・Actions実行URLと公開後の結果は完了報告に記録します。
