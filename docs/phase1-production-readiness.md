# Phase 1: 本番で「まず動かす」実装計画

目的: D Finance AI Stock Manager を **本番でAIとリアルタイムデータが実際に動く** 状態にし、**AI利用量の計測・コスト上限を信頼できる形にする**。

ライブ確認時の問題（2026-06-22）:
- AI Job が一度も実行されず（`未実行`）、Data Freshness が約3週間前
- すべてのデータソースが `Fallback`（mock-data / ローカル履歴）
- 本番にAPIキー未投入、利用量ログがメモリ依存でサーバーレスで欠損

---

## 全体像

Phase 1 は2層に分かれる。

```mermaid
flowchart TD
    subgraph manual [あなたが行う手動オペ]
        A[Supabaseプロジェクト作成 + schema.sql実行]
        B[Twelve Data / OpenAI / News APIキー取得]
        C[CRON_SECRET生成]
        D[Vercel Environment Variablesに投入]
        E[再デプロイ]
    end
    subgraph code [コード側・実装済み]
        F[利用量ログのawait化]
        G[canUseAiのfail-closed]
        H[/api/health 疎通確認]
    end
    A --> D
    B --> D
    C --> D
    D --> E
    E --> H
    F --> E
    G --> E
    H --> V{readyになるまで繰り返し}
```

---

## パート1: 手動オペ（あなたしかできない）

### 1-1. Supabase
1. https://supabase.com で新規プロジェクト作成
2. SQL Editor で [`supabase/schema.sql`](../supabase/schema.sql) を実行（`ai_usage_logs`・`job_runs`・`user_plans` 等を作成）
3. Project Settings > API から以下を控える
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（**サーバー専用・公開厳禁**）

### 1-2. 株価データ（推奨）
- https://twelvedata.com で無料登録 → `TWELVE_DATA_KEY`
- `STOCK_DATA_PROVIDER=twelve_data`

### 1-3. AI / ニュース（AI機能を動かすなら必須）
- https://platform.openai.com → `OPENAI_API_KEY`
- ニュース: `NEWS_API_KEY`（NewsAPIは本番有料。NewsData.io等の代替も可）

### 1-4. Cron認証（必須）
```bash
openssl rand -hex 32
```
生成値を `CRON_SECRET` に設定（空だと自動更新が全て401）。

### 1-5. Vercelに投入して再デプロイ
Vercel > Settings > Environment Variables に上記をすべて設定 → Redeploy。
詳細キー一覧は [`.env.example`](../.env.example) を参照。

---

## パート2: コード側（このPRで実装済み）

### 2-1. 利用量ログの欠損防止（[`src/lib/ai-usage.ts`](../src/lib/ai-usage.ts)）
- `recordAiUsage` / `recordAiCacheHit` を `async` 化し、Supabaseへの書き込みを **await**。
  以前は `void saveAiUsageLogToSupabase(log)` の fire-and-forget で、Vercelのサーバーレスがレスポンス後に実行を凍結するとログが欠損していた。
- 呼び出し元（[daily-job](../src/app/api/cron/daily-job/route.ts) / [spot-simulator](../src/app/api/spot-simulator/ai-comment/route.ts)）も `await` に更新。

### 2-2. コスト保護の fail-closed（`canUseAi`）
- Supabaseが構成済み（URL + サービスロール）なのに利用量取得に失敗した場合、
  従来は空のメモリにフォールバックして**上限が事実上無効**になり、OpenAIコストが青天井だった。
- 既定で **fail-closed**（AI実行を一時停止）に変更。`AI_FAIL_CLOSED=false` で旧挙動に戻せる。

### 2-3. 疎通確認エンドポイント（[`/api/health`](../src/app/api/health/route.ts)）
- 秘密情報を出さず、各環境変数の構成状態（boolean）とSupabase到達性・最新ジョブ鮮度を返す。
- `ready: true` で 200、未充足なら 503。

---

## 検証手順（Phase 1 完了判定）

### ステップ1: health確認
```bash
curl -s https://<your-domain>/api/health | jq
```
期待: `"ready": true`、`config` の各キーが `true`、`checks.supabaseReachable: true`。

### ステップ2: 手動ジョブ実行
`/settings` の「AI社員に今日の仕事をさせる」を押す（またはCronを待つ）。

### ステップ3: ダッシュボード確認
- AI Job Status が `Completed`
- Data Freshness が当日
- データソースが `Fallback` でなく実データ

### ステップ4: 利用量計測確認
```bash
curl -s "https://<your-domain>/api/ai-usage/summary" -H "authorization: Bearer <user_access_token>" | jq
```
期待: `billableCalls` が増加し、`estimatedCostUsd` が記録される。

### 完了チェックリスト
- [ ] `supabase/schema.sql` 実行済み
- [ ] Vercelに環境変数投入＋再デプロイ
- [ ] `/api/health` が `ready: true`
- [ ] 手動ジョブで `Completed`・当日鮮度
- [ ] `ai_usage_logs` に行が増える（Supabaseで確認）
- [ ] AIコスト上限が効く（上限到達で `limit_exceeded`）

---

## コスト・運用メモ
- OpenAI: モデル別単価は [`ai-usage.ts`](../src/lib/ai-usage.ts) の `openAiTokenRates` で見積り。
- Vercel Hobby の Cron は1日1回まで。30分間隔の価格更新は [GitHub Actions](../.github/workflows/price-refresh.yml) を使用。
- 90日ログ保持は `AI_USAGE_RETENTION_DAYS`（既定90）で調整。

## Phase 1 では扱わない（Phase 2以降）
- Stripe課金フロー（収益化）
- ログイン必須化（`local-user` 共有問題の解消）
- プラン上限の逆転修正（Free `monthlyAiCalls` 1000 > Pro 300。[`plans.ts`](../src/lib/plans.ts)）
- 同意記録のDB化・規約/特商法ページ
