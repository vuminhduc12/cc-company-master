# D Finance AI Stock Manager

RGTIをダミーデータで管理する最小構成のNext.js MVPです。

## 起動

```bash
npm install
npm run dev
```

http://localhost:3000 を開きます。

## ページ

- `/` Dashboard
- `/watchlist`
- `/stocks/RGTI`
- `/news`
- `/ai-employees`
- `/reports`
- `/settings`

## APIキー設定

`.env.example` を参考に `.env.local` を作成します。

```bash
OPENAI_API_KEY=
STOCK_API_KEY=
NEWS_API_KEY=
CRON_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- `STOCK_API_KEY`: Alpha VantageのAPIキーを想定しています。
- `NEWS_API_KEY`: News APIのAPIキーを想定しています。
- `OPENAI_API_KEY`: ニュース分析JSON生成に使います。
- `CRON_SECRET`: Vercel Cronと手動実行APIの保護に使います。

ローカル開発では `CRON_SECRET` が未設定でもSettingsから手動実行できます。APIキー未設定時の手動実行はmock-dataで動きます。

## Supabase保存

Supabaseを使う場合は、Supabase SQL Editorで `supabase/schema.sql` を実行してください。

保存されるテーブル:

- `stocks`
- `daily_prices`
- `news`
- `ai_tasks`
- `daily_reports`
- `job_runs`

Cronまたは手動実行が成功すると、最新結果は `job_runs.result` にJSONで保存されます。DashboardとAI Employeesは起動時にSupabaseの最新 `job_runs` を読み込み、なければ `localStorage`、さらに無ければ `mock-data` を表示します。

## AI社員の手動実行

`/settings` で「AI社員に今日の仕事をさせる」を押すと、`/api/cron/daily-job` にPOSTします。

実行結果はブラウザの `localStorage` に保存され、DashboardとAI Employeesに反映されます。

## Vercel Cron

`vercel.json` で毎日 `22:00 UTC` に `/api/cron/daily-job` をGET実行します。

これは日本時間の朝7:00です。

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-job",
      "schedule": "0 22 * * *"
    }
  ]
}
```

本番ではVercelのEnvironment Variablesに `CRON_SECRET` を設定してください。Cron APIは `Authorization: Bearer CRON_SECRET` または `x-cron-secret` を確認します。
