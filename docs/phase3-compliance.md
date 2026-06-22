# Phase 3: コンプライアンス & 法的整備

目的: 課金（Phase 2）に伴う法的義務を満たし、**合法的に販売できる状態**にする。

## 背景

有料オンラインサービスの提供には、日本では以下が必要:
- 特定商取引法に基づく表記（**法令上必須**）
- 利用規約・プライバシーポリシー
- 投資助言と誤認させない表示（金融商品取引法）
- 同意の証跡（紛争対応）

## コード側（このPRで実装済み）

| 項目 | 実装 |
|------|------|
| 表示文言の見直し | [status-labels.ts](../src/lib/status-labels.ts)：内部値は維持し「Strong Buy→最注目」等、注目度表記に変換。[StatusBadge](../src/components/StatusBadge.tsx) / [page](../src/app/page.tsx) に適用 |
| 利用規約 | [/legal/terms](../src/app/legal/terms/page.tsx) |
| プライバシーポリシー | [/legal/privacy](../src/app/legal/privacy/page.tsx) |
| 特定商取引法表記 | [/legal/tokushoho](../src/app/legal/tokushoho/page.tsx)（事業者情報は環境変数） |
| 同意記録のDB化 | [user_consents](../supabase/schema.sql) テーブル + [/api/consent](../src/app/api/consent/route.ts) + [DisclaimerModal](../src/components/DisclaimerModal.tsx) から記録 |
| フッター導線 | [AppShell](../src/components/AppShell.tsx) に3ページへのリンク |

### 表示文言マッピング
| 内部値（不変） | 旧表示 | 新表示 |
|---------------|--------|--------|
| Strong Buy | Strong Buy | 最注目 |
| Buy | Buy | 注目 |
| Watch | Watch | 監視 |
| Caution | Caution | 注意 |
| Sell | Sell | 警戒 |

内部の判定ロジック・データ（scoring等）は変更せず、ユーザーに見えるバッジ表記のみを変更しています。

## あなたの手動オペ

### 1. DBスキーマ更新
Supabase SQL Editor で [supabase/schema.sql](../supabase/schema.sql) を再実行（`user_consents` を追加）。

### 2. 事業者情報の設定
Vercel環境変数に以下を設定（[.env.example](../.env.example) 参照）:
```
LEGAL_BUSINESS_NAME=...
LEGAL_BUSINESS_OPERATOR=...
LEGAL_BUSINESS_ADDRESS=...
LEGAL_BUSINESS_PHONE=...
LEGAL_BUSINESS_CONTACT=...
```
未設定だと `/legal/tokushoho` に【要記入】と表示されます。

### 3. 法務レビュー（重要）
`/legal/terms`・`/legal/privacy` は**雛形**です。公開前に弁護士等のレビューを必ず受けてください。投資情報サービス特有の免責（金商法）も併せて確認してください。

## 検証手順
- [ ] `supabase/schema.sql` 再実行（`user_consents` 作成）
- [ ] `/legal/terms` `/legal/privacy` `/legal/tokushoho` が表示される
- [ ] 特商法ページに事業者情報が出る（【要記入】が消える）
- [ ] フッターと免責モーダルからリンクできる
- [ ] ログイン状態で免責に同意 → `user_consents` に行が増える
- [ ] ダッシュボードのバッジが「最注目/注目/監視/注意/警戒」表記になる

## Phase 3 では扱わない（次フェーズ候補）
- Phase 4: 銘柄のRGTI固定解消、オンボーディング、解約防止
- Phase 5: LP/SEO、計測、紹介導線
