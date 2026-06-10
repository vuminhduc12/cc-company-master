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
- `/margin-simulator` 信用買いシミュレーター
- `/settings`

## 信用買いシミュレーター

`/margin-simulator` で、Excel資料「信用買いシミュレーター」の計算をWeb上で確認できます。

- 保証金、買値、目標売値、損切り価格、保有日数を入力
- 最大株数、建玉金額、追証ライン、10%ラインを自動計算
- 株価シナリオごとの評価損益、手取り損益、保証金率を表示
- 株数を抑えた場合の建玉比較と注文前チェックを表示
- 銘柄検索から直近価格、AIスコア、信用買い/信用売り/見送り判定、利確到達率目安を表示

計算は概算です。実際の注文前には、証券会社の建玉画面、保証金率、金利、手数料、個別銘柄規制を必ず確認してください。

## APIキー設定

`.env.example` を参考に `.env.local` を作成します。

```bash
OPENAI_API_KEY=
STOCK_DATA_PROVIDER=yahoo
STOCK_API_KEY=
NEWS_API_KEY=
CRON_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- `STOCK_DATA_PROVIDER`: 株価取得元です。未設定または `yahoo` ならYahoo Financeを優先し、`alpha_vantage` ならAlpha Vantageを優先します。
- `STOCK_API_KEY`: Alpha Vantageを使う場合のAPIキーです。Yahoo Finance優先運用ではフォールバック用の任意設定です。
- `NEWS_API_KEY`: News APIのAPIキーを想定しています。
- `OPENAI_API_KEY`: ニュース分析JSON生成に使います。
- `CRON_SECRET`: Vercel Cronと手動実行APIの保護に使います。

株価取得はYahoo Finance、Alpha Vantage、ローカル履歴データの順にフォールバックします。ローカル開発では `CRON_SECRET` が未設定でもSettingsから手動実行できます。AI/ニュースAPIキー未設定時の手動実行はmock-dataまたはルールベース分析で動きます。

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
