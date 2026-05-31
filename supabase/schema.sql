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
