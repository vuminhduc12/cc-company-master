# Phase 4: プロダクト価値拡張（銘柄汎用化 + オンボーディング）

目的: 単一銘柄（RGTI）依存を解消し、新規ユーザーが迷わず使い始められるようにする。

## コード側（このPRで実装済み）

### 1. 銘柄の汎用化
RGTIを「デモ用シード」と「ハードコードされた挙動」に切り分け、後者を解消した。

| 箇所 | 変更前 | 変更後 |
|------|--------|--------|
| [page.tsx](../src/app/page.tsx) 初期選択 | `useState("RGTI")` | `useState("")` → Watchlist先頭を自動選択 |
| [page.tsx](../src/app/page.tsx) 価格/スコア紐付け | `ticker === "RGTI"` | `ticker === jobPrimaryTicker`（AIジョブの主役銘柄） |
| [daily-job](../src/app/api/cron/daily-job/route.ts) 主役選定 | `find(RGTI) ?? first` | `successfulResults[0]` |
| [AppShell](../src/components/AppShell.tsx) ナビ | `/stocks/RGTI` 固定 | Watchlist先頭の銘柄に動的リンク |

`mock-data.ts` のRGTIは初期表示用のデモデータとして意図的に残置。

### 2. オンボーディング
[OnboardingChecklist](../src/components/OnboardingChecklist.tsx) をダッシュボード上部に追加。

- 3ステップ（①ログイン ②Watchlist追加 ③AI実行）の進捗を実状態から判定
- 進捗バー＋「次にやること」CTA
- 全完了で自動非表示、「閉じる」でlocalStorageに記録（`dfinance.onboarding.dismissed.v1`）

## 動作
- 新規/未ログインユーザー: ダッシュボード上部にチェックリストが出る
- Watchlistに銘柄があれば、ダッシュボードもナビの「Stock Detail」もその銘柄を指す
- AIジョブの主役は最初の成功銘柄（銘柄に依存しない）

## 検証手順
- [ ] 未ログイン・Watchlist空でダッシュボードにオンボーディングが表示される
- [ ] 銘柄を追加するとダッシュボードの初期選択がその銘柄になる
- [ ] ナビ「Stock Detail」がWatchlist先頭銘柄に飛ぶ
- [ ] 3ステップ完了でチェックリストが消える
- [ ] AIジョブ実行後、主役銘柄がRGTI以外でも正しく表示される

## Phase 4 では扱わない（次フェーズ候補）
- 解約前の引き止めUI（解約防止）
- Phase 5: LP/SEO、計測（アナリティクス）、紹介導線
- 銘柄サジェスト・検索体験の高度化
