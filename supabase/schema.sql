create extension if not exists "pgcrypto";

create table if not exists public.stocks (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  company_name text not null,
  sector text,
  exchange text,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_prices (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks(id) on delete cascade,
  date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume bigint,
  change_percent numeric,
  volume_average20 numeric,
  volume_ratio numeric,
  intraday_range_percent numeric,
  rsi numeric,
  macd numeric,
  macd_signal numeric,
  macd_histogram numeric,
  macd_direction text,
  ma5 numeric,
  ma20 numeric,
  ma50 numeric,
  score numeric,
  pattern text,
  source text,
  created_at timestamptz not null default now(),
  unique (stock_id, date)
);

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid references public.stocks(id) on delete set null,
  title text not null,
  url text,
  source text,
  published_at text,
  summary text,
  sentiment text,
  impact_score numeric,
  risk text,
  opportunity text,
  ai_comment text,
  created_at timestamptz not null default now()
);

alter table public.news add column if not exists url text;

delete from public.news a
using public.news b
where a.id > b.id
  and a.stock_id is not distinct from b.stock_id
  and a.published_at is not distinct from b.published_at
  and a.title = b.title
  and a.source is not distinct from b.source;

create unique index if not exists news_stock_published_title_source_key
  on public.news (stock_id, published_at, title, source);

create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  task text,
  status text,
  last_run text,
  next_run text,
  result text,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  market text,
  watchlist text,
  news text,
  decision text,
  tomorrow text,
  created_at timestamptz not null default now()
);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  mode text not null,
  last_run text,
  next_run text,
  data_freshness text,
  ai_market_score numeric,
  error text,
  warning text,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists job_runs_created_at_idx
  on public.job_runs (created_at desc);

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'local-user',
  feature text not null,
  ticker text,
  model text,
  prompt_version text,
  status text not null,
  error_code text,
  error_message text,
  used_cache boolean not null default false,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_user_created_idx
  on public.ai_usage_logs (user_id, created_at desc);

create index if not exists ai_usage_logs_status_created_idx
  on public.ai_usage_logs (status, created_at desc);

create index if not exists ai_usage_logs_feature_created_idx
  on public.ai_usage_logs (feature, created_at desc);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  market text not null default 'us',
  item jsonb,
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create index if not exists watchlist_items_user_ticker_idx
  on public.watchlist_items (user_id, ticker);

alter table public.watchlist_items enable row level security;

drop policy if exists "watchlist_items_select_own" on public.watchlist_items;
create policy "watchlist_items_select_own"
  on public.watchlist_items for select
  using (auth.uid() = user_id);

drop policy if exists "watchlist_items_insert_own" on public.watchlist_items;
create policy "watchlist_items_insert_own"
  on public.watchlist_items for insert
  with check (auth.uid() = user_id);

drop policy if exists "watchlist_items_update_own" on public.watchlist_items;
create policy "watchlist_items_update_own"
  on public.watchlist_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "watchlist_items_delete_own" on public.watchlist_items;
create policy "watchlist_items_delete_own"
  on public.watchlist_items for delete
  using (auth.uid() = user_id);

create table if not exists public.user_news_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  preference_type text not null check (preference_type in ('hidden', 'seen')),
  news_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, preference_type, news_key)
);

create index if not exists user_news_preferences_user_type_idx
  on public.user_news_preferences (user_id, preference_type, updated_at desc);

alter table public.user_news_preferences enable row level security;

drop policy if exists "user_news_preferences_select_own" on public.user_news_preferences;
create policy "user_news_preferences_select_own"
  on public.user_news_preferences for select
  using (auth.uid() = user_id);

drop policy if exists "user_news_preferences_insert_own" on public.user_news_preferences;
create policy "user_news_preferences_insert_own"
  on public.user_news_preferences for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_news_preferences_update_own" on public.user_news_preferences;
create policy "user_news_preferences_update_own"
  on public.user_news_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_news_preferences_delete_own" on public.user_news_preferences;
create policy "user_news_preferences_delete_own"
  on public.user_news_preferences for delete
  using (auth.uid() = user_id);

create table if not exists public.user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'premium', 'unlimited')),
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_plans enable row level security;

drop policy if exists "user_plans_select_own" on public.user_plans;
create policy "user_plans_select_own"
  on public.user_plans for select
  using (auth.uid() = user_id);

-- ─── user_alerts ──────────────────────────────────────────────────────────────
-- 価格アラートをユーザーごとに永続化するテーブル。
-- client側: src/lib/price-alerts.ts の syncAlertsToDb / loadAlertsFromDb を参照。

create table if not exists public.user_alerts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alerts  jsonb   not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_alerts enable row level security;

drop policy if exists "user_alerts_select_own" on public.user_alerts;
create policy "user_alerts_select_own"
  on public.user_alerts for select
  using (auth.uid() = user_id);

drop policy if exists "user_alerts_insert_own" on public.user_alerts;
create policy "user_alerts_insert_own"
  on public.user_alerts for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_alerts_update_own" on public.user_alerts;
create policy "user_alerts_update_own"
  on public.user_alerts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_alerts_delete_own" on public.user_alerts;
create policy "user_alerts_delete_own"
  on public.user_alerts for delete
  using (auth.uid() = user_id);

-- ─── user_consents ────────────────────────────────────────────────────────────
-- 免責・利用規約・プライバシーポリシーへの同意を「誰がいつどのバージョンに」記録する。
-- 紛争時の証跡として、ローカルストレージではなくDBに保存する。

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document text not null,        -- 'disclaimer' | 'terms' | 'privacy'
  version text not null,
  agreed_at timestamptz not null default now(),
  user_agent text,
  unique (user_id, document, version)
);

create index if not exists user_consents_user_idx
  on public.user_consents (user_id, document, agreed_at desc);

alter table public.user_consents enable row level security;

drop policy if exists "user_consents_select_own" on public.user_consents;
create policy "user_consents_select_own"
  on public.user_consents for select
  using (auth.uid() = user_id);

drop policy if exists "user_consents_insert_own" on public.user_consents;
create policy "user_consents_insert_own"
  on public.user_consents for insert
  with check (auth.uid() = user_id);
