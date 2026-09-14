create table if not exists public.fx_daily_rates (
  pair text not null check (pair = 'USDJPY'),
  rate_date date not null,
  rate double precision not null check (rate > 0 and rate < 'Infinity'::double precision),
  source text not null,
  fetched_at timestamptz not null,
  primary key (pair, rate_date)
);
create table if not exists public.fx_refresh_state (
  pair text primary key check (pair = 'USDJPY'),
  attempted_at timestamptz not null,
  error text
);
alter table public.fx_daily_rates enable row level security;
alter table public.fx_refresh_state enable row level security;
revoke all on public.fx_daily_rates, public.fx_refresh_state from anon, authenticated;
grant all on public.fx_daily_rates, public.fx_refresh_state to service_role;
