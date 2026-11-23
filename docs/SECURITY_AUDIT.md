# 単語帳アプリのセキュリティ監査

監査起点は `main` の `249d121af5fc982ff42509b65e3135a0176bc60a`。対象は英単語、世界史一問一答、世界史の流れ、Discord Bot、GitHub Pages。本番のGitHub設定と公開ファイル・公開Sheetsは読み取りのみで確認した。Firebase本番Rules、クラウドコンソールの設定、管理用データの本文、Botの本番動作は未確認。検証にはモックと `demo-vocab-app-security` を使用した。教材ファイル、問題ID・列構成、履歴パス・既存フィールドは維持した。

## 確認した問題とPRの対応

| 重大度 | 確認した状態 | PRの対応と影響 |
| --- | --- | --- |
| 高 | 旧Sheetの共有範囲について、所有者確認が必要なデータ分離の問題を確認した。 | Webで参照する公開ブックを、一問一答・世界史の流れのBot管理先として拒否する。管理先が該当する場合は、分離前に新版へ切り替えると起動チェックで停止する。 |
| 高 | `history-explanations-20261122.yml` が対象ファイルのmainへのpushを起点にPagesを更新した実行を確認。PRイベントは検証のみ。Pagesの公開元はGitHub Actionsで、`github-pages` 環境はmainを許可する設定だった。必須承認者・mainのブランチ保護・ルールセットは確認時点で未設定。 | 自動Workflowを読取権限のテスト・ビルド・レビュー成果物専用に変更。公開は公式リポジトリのmainから手動実行し、確認文字列と同じコミットから作ったレビュー専用実行のIDが必須。全ファイルの一致を再確認してからPages書込・OIDC権限を持つジョブに進む。GitHub側での承認者設定は別途必要。 |
| 中 | 現行 `firestore.rules` は所有者の任意の配下文書を許可。`firestore.improved.rules` は履歴ドキュメントに限定するが、どちらも匿名ユーザー自身のアクセスを許可した。他のUIDからのアクセスは拒否された。 | 両ファイルを同じRulesに統一。認証済みの本人の `users/{uid}/progress/{sheetId}` に限定し、匿名の直アクセスを拒否。公開済みアプリでも匿名中はFirestoreに履歴を保存せず、メール連携後に同じUIDを使う。既存の履歴に必須フィールドは追加しない。 |
| 中 | Botの許可ユーザー判定でサーバー指定が空の場合、利用場所の制限がなかった。 | 指定サーバーと許可リスト上のユーザーを両方必須とし、DM、他サーバー、無効な設定を拒否。コマンドの同期先を指定サーバーに限定する。 |
| 中 | Webの認証・Sheetsの例外や受信したヘッダをそのままコンソールへ出す箇所があった。 | ログを定型文に変更。表示と学習フローは維持。GitHub Actionの参照を検証済みのコミットSHAに固定した。 |
| 低 | 世界史のChromiumテストが現行mainでも合成HTMLの初期化で失敗していた。 | ネットワーク遮断を維持し、合成HTMLをChromiumに渡す方法を既存のFlowテストと揃えた。全3画面幅で合格。 |

本監査で重大に分類する確定事項はなかった。旧Sheetの共有履歴と本番Rulesは未確認。 [確認した自動デプロイ実行](https://github.com/Hk0984/vocabulary-app/actions/runs/45003734283)

## データ経路と検証

- **Firestoreとアカウント**。Firestore 6件、Auth・Firestore 10件が成功。本人以外の読み書き・一覧・削除、匿名・未認証、任意パスを拒否。匿名学習、既存UIDでのメール連携、メールでの再ログイン、既存履歴の取得、端末間の同期、同時更新、対象別リセットをエミュレータとアプリ回帰テストで確認。匿名連携前から残っていた履歴もメールに連携した同じUIDで利用できる。
- **教材の入力**。英単語・歴史・Flowの教材テキストはDOMに文字列として設定する。外部のSheets・JSONを読む経路の型、列、ID、選択肢、長さ、不正形式の回帰を確認。Web 158件、ネットワーク遮断のChromium 9件が成功。公開中の学習履歴の実ユーザーデータおよびiPhone実機は未検証。
- **Bot**。モックで138件が成功。厳密なCSV列・型・長さ、承認、公開／削除の事前照合、確認、失敗時の復旧を確認。値はSheetsに `RAW` で送る。ファイルと単一プロセスを使う保護の外から手動・他ホストが同時編集する場合、Sheetsの複数操作を一括で原子的には処理できない。既存の単一インスタンス運用と、処理中に同じブックを手動編集しない運用が必要。
- **公開・管理データの分離**。一問一答・Flow・語彙はそれぞれ専用の公開ブックを参照する。新しい一問一答の公開ヘッダは13列、Flowは21列。Webはブラウザ用Sheetsキーで公開ブックへ接続し、Botは実行機の資格情報ファイルで指定ブックへ接続する。Botの設定ファイル・管理用ID・秘密鍵をWebビルドへ渡す経路は確認されなかった。既存Sheetの共有範囲は所有者による確認が必要。
- **PWA**。配信許可リストとハッシュで静的資産をキャッシュする。Firebase認証・履歴・外部Sheetの通信はPWAのキャッシュ対象外。認証SDKのローカルセッションは同一ブラウザに残る仕様で、ログアウトとアカウント切替時は履歴表示をリセットする。現在配信中のFirebase compat CDN 11.10.0の3ファイルはSRIを実ファイルと照合済み。npm監査の対象には含まれない。
- **配信と秘密情報**。現在の配信ビルド `acefa45a79dc7068df4c` の全21ファイル、PR候補 `108e670de463abc31628` の21ファイルを各マニフェストと照合。教材検証は本番用1,536問とレビュー済み109件が成功。Gitleaksの値マスキング付き検査では、到達可能なGit履歴64コミットに7件、作業起点の追跡ファイル・現在の配信ファイル・ローカルビルドに各3件の一致があり、すべてWebで使用するGoogle/Firebaseの公開APIキーだった。Botトークン・サービスアカウントの秘密鍵の検出は0件。検査対象は取得できた参照、追跡ファイル、公開マニフェストに載るファイルおよび既知パターン。
- **公開ガード**。Pages SourceがGitHub ActionsであることをAPIで確認。GitHubが生成した `pages-build-deployment` は過去に動作した経路で、現行設定は `workflow`。既存のレビュー専用実行を許可し、実際にデプロイした実行を拒否することをGitHub APIの読取で検証。成果物の不一致・期限切れや異なるコミットはテストで確認。PRのpush・テスト以外のWorkflow起動や本番デプロイは行っていない。

## 依存関係の監査

`npm audit` は高5・中14件（脆弱性の影響を受けるパッケージ単位）。`npm audit --omit=dev` は0件。`pip-audit --no-deps --disable-pip -r bot/requirements.lock` は固定依存33個で0件。互換性を維持する `npm audit fix --package-lock-only --ignore-scripts` は差分なし。Firebase CLIの更新候補を隔離して監査しても警告数は変わらなかった。互換範囲を外れる強制更新は見送った。開発ツールはWeb成果物に含まれず、リポジトリにはgRPCサーバーの本番提供構成がない。

| 上流の重大度 | 依存と成立条件 | 残る対策 |
| --- | --- | --- |
| 高・低 | `@grpc/grpc-js`。特定構成のgRPCサーバーのmTLS証明書検証・サーバーのエラー文処理。 | Firebase SDKの依存範囲は修正版を含まない。検証用エミュレータを外部に公開せず、親SDKの対応を追う。 [高](https://github.com/advisories/GHSA-m9gg-hp2v-232j)・[低](https://github.com/advisories/GHSA-f596-whhp-79r4) |
| 中 | `@opentelemetry/core`。過大なW3C Baggageヘッダ処理。 | Firebase CLIの間接依存。親ライブラリが互換のある修正版に対応するまで追跡する。 [アドバイザリ](https://github.com/advisories/GHSA-8988-4f7v-96qf) |
| 中 | `glob` は中断後も探索、`minimatch` は複雑な検索パターンで資源消費。 | 開発ツール内部。未検証のパターンやファイル木を渡さず、親ライブラリの対応を追う。 [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)・[minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
| 中 | `uuid`。一部バージョン生成APIに明示的なバッファを渡す場合の境界検証。 | GoogleクライアントのCLI側間接依存。親ライブラリを介した修正を追う。 [アドバイザリ](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |

Dependabotのnpm・pip・Actionsの週次チェックをPRに追加。GitHub SettingsでDependabot alertsを確認し、Pythonの更新PRは `bot/requirements.lock` も更新されているか確認する。CDNのFirebase SDKは公開アドバイザリを別途確認し、更新するときは3ファイルのSRIを更新して認証・PWAを再検証する。

## 本人が確認する手順

1. **最優先。Sheetの管理情報と公開教材を分離する。** Google Sheetsの対象ブックで「共有」の一般アクセス、共有メンバー、ファイルの「ウェブに公開」を確認する。既存の教材配信を継続できるよう、管理データの制限付き別ブックへの移行と、元ブックにある管理データへの公開経路を閉じる方法を別途レビューする。移行時は行数・ID・公開中の問題との照合とバックアップを行う。非表示タブは共有権限の代わりにならない。新しい一問一答・Flowの管理ブックも一般アクセスが「制限付き」で、担当者と必要なサービスアカウントのみであることを確認する。サービスアカウントの不要なIAMロール・鍵、Botのホスト上の資格情報・監査ログ・バックアップのアクセス権を確認する。
2. **GitHubの承認を設定する。** Settings → Pages → Build and deployment の Source が GitHub Actions であることを確認。Settings → Environments → `github-pages` でmainのみと Required reviewers を設定する。別の承認者を確保できる場合は Prevent self-review も有効にする。Settings → Rules → Rulesets または Branches でmainへの反映にPRと必須の検証チェックを要求する。利用プラン・権限で項目が設定できない場合は、公開担当者と別の担当者がレビュー成果物を確認し、確認記録を残す。 [GitHubの環境保護](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
3. **Firebaseの本番設定を確認する。** Firebase Console → Firestore Database → Rulesで現在のルールを確認し、PRの履歴パス・所有者・匿名条件と照合する。テスト用プロジェクトは `demo-vocab-app-security`。本番との差分・適用の要否は別途レビューする。Authentication → Sign-in methodで匿名・メール/パスワードを確認し、SettingsのAuthorized domainsで必要なドメインを確認する。ここではPublish操作を行わない。
4. **Google Cloudの公開キー制限を確認する。** APIs & Services → Credentialsで、語彙・歴史・Flowに使うSheets用キーを Google Sheets API のみに限定し、Webサイトの制限を実際の公開元に合わせる。GitHub Pagesでブラウザが送るリファラーに合わせて、語彙・一問一答・Flowの読取を確認する。Firebase用Webキーは別キーで、利用中のFirebase APIと許可ドメインを照合する。コンソール上の制限、有効API、クォータ、使用ログは未確認。キーや資格情報の値をレビュー本文に貼り付けない。 [Google Cloudのキー制限](https://docs.cloud.google.com/docs/authentication/api-keys)・[Firebase APIキー](https://firebase.google.com/docs/projects/api-keys)
5. **Bot切替前の準備。** Discordの指定サーバーと運用者を `DISCORD_GUILD_ID`、`ADMIN_USER_IDS` に設定し、`python bot/history_bot.py --check-config` で確認する。管理・公開の共有設定が手順1に合格してから、承認を得て単一インスタンスで切り替える。旧版がグローバル登録した管理コマンドが残っていないか、Discordのサーバー連携で確認する。

### 承認後にPagesを公開する場合

1. PRの差分、GitHub設定とテストをレビューする。今回の依頼ではマージと公開を行わない。
2. 該当差分がmainへ反映された後、Actions → **Prepare web release (manual)** をmainで `deploy=false`、`history_environment=rebuild_v1` で実行する。成功した実行の `web-review-実行ID-試行番号` のファイル一覧、`release.json`、解説・地図入りデータを確認し、レビューした実行IDを記録する。レビュー成果物の保存期間は7日。
3. 公開承認を得た回のみ、同じmainコミットとデータ環境で新たに手動実行し、`deploy=true`、`confirmation=REPLACE_PRODUCTION`、`review_run_id` に手順2のIDを指定する。設定された承認者が環境の保留中デプロイを確認する。ソースまたは成果物が変わった場合は手順2からやり直す。
4. 当該配信の `release.json`、Actions実行、公開中の英単語・一問一答・Flowを確認する。Firebase Rulesの適用はPages手順の外で個別に判断する。
