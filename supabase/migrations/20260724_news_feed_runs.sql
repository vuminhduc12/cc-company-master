-- Run once in Supabase SQL editor if news_feed_runs does not exist yet.
create table if not exists public.news_feed_runs (
  run_key text primary key,
  ran_at timestamptz not null,
  found integer not null default 0,
  scanned integer not null default 0,
  failed integer not null default 0,
  updated_at timestamptz not null default now()
);
