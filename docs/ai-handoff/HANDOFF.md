# ChatGPT ⇔ Codex 次の会話への引き継ぎ

最終更新は2026-11-18 JST。対象は `codex/ai-handoff-integration`、追補前 `f6685d5`、[Draft PR #4](https://github.com/Hk0984/vocabulary-app/pull/4)。

- 数値25問のうち、書式解析不能だった7問は解釈可能。10問を救済し、15問は原資料・境界条件・重複範囲の確認待ち。表→裏の同一971問でスキップ25→15、2〜3択39→47、4択907→909。 [4択候補の比較](CHOICE-AUDIT.md)
- 追補でWeb・Botの空欄入力の正規化差、欠けた回答の消費、辞書内の範囲重複検査を修正した。Web151、Bot136、デモFirebase16、モックUI8、旧版ビルド3件と合成プレビューのループバック試験が成功。 [公開前レビュー](PRE-RELEASE-REVIEW.md)
- 開発CLIだけを15.36.0に更新。npmは高10・中14、本番用npm依存は0件。配信用ローカルビルド `cfc2ccbe90cd029c1e4a`、本番Pages `5957273ee0652f2e2dbe`。 [依存関係監査](DEPENDENCY-AUDIT.md)・[状態](STATUS.md)
- 合成プレビューをテスト専用の別オリジンHTTPSでホストする承認を得て、Safariとホーム画面PWAの実機確認を行う。実機未実施のため、mainマージ・本番公開の判定は保留。 [実機チェックリスト](IPHONE-CHECKLIST.md)
- 世界史の原資料と旧430・440問の版照合は保留。公開1,551問の構造は再検査済み。B-1、D-2、E、F、G、J-1の凍結を継続する。 [原資料チェックリスト](HISTORY-SOURCES.md)

検証環境の配信、mainマージ、本番Pages公開、本番設定・教材・学習履歴への変更には個別承認が必要。
