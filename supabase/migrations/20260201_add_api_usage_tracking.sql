-- =========================
-- API usage tracking: raw events + daily rollup (Rainforest, SP-API, cache, optional OpenAI)
-- Idempotency key prevents double-counting on retries.
-- =========================

-- =========================
-- 1) RAW EVENTS
-- =========================
create table if not exists public.api_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  provider text not null,              -- 'rainforest' | 'spapi' | 'cache' | 'openai'
  operation text not null,             -- e.g. 'rainforest.product', 'spapi.fees_estimate', 'cache.asin_enrichment'
  endpoint text,                       -- e.g. 'type=product', '/products/fees/v0/items/{asin}/feesEstimate'

  cache_status text not null default 'none', -- 'hit' | 'miss' | 'none'
  credits_used integer not null default 0,   -- rainforest credits
  http_status integer,                        -- optional
  duration_ms integer,                        -- optional

  asin text,
  keyword text,
  marketplace_id text,
  amazon_domain text,

  meta jsonb not null default '{}'::jsonb,

  idempotency_key text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists api_usage_events_idempotency_key_key
  on public.api_usage_events(idempotency_key);

create index if not exists api_usage_events_user_time_idx
  on public.api_usage_events(user_id, created_at desc);

create index if not exists api_usage_events_provider_time_idx
  on public.api_usage_events(provider, created_at desc);

create index if not exists api_usage_events_asin_idx
  on public.api_usage_events(asin);


-- =========================
-- 2) DAILY ROLLUP
-- =========================
create table if not exists public.api_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  provider text not null,
  operation text not null,

  calls integer not null default 0,
  cache_hits integer not null default 0,
  cache_misses integer not null default 0,
  credits_used integer not null default 0,

  updated_at timestamptz not null default now(),
  primary key (user_id, day, provider, operation)
);

create index if not exists api_usage_daily_user_day_idx
  on public.api_usage_daily(user_id, day desc);

-- =========================
-- 3) ROLLUP TRIGGER
-- =========================
create or replace function public._api_usage_rollup_trigger()
returns trigger
language plpgsql
as $$
declare
  v_day date := (new.created_at at time zone 'utc')::date;
  v_hit int := case when new.cache_status = 'hit' then 1 else 0 end;
  v_miss int := case when new.cache_status = 'miss' then 1 else 0 end;
begin
  insert into public.api_usage_daily (
    user_id, day, provider, operation,
    calls, cache_hits, cache_misses, credits_used, updated_at
  )
  values (
    new.user_id, v_day, new.provider, new.operation,
    1, v_hit, v_miss, new.credits_used, now()
  )
  on conflict (user_id, day, provider, operation) do update set
    calls = api_usage_daily.calls + 1,
    cache_hits = api_usage_daily.cache_hits + v_hit,
    cache_misses = api_usage_daily.cache_misses + v_miss,
    credits_used = api_usage_daily.credits_used + new.credits_used,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists api_usage_events_rollup on public.api_usage_events;
create trigger api_usage_events_rollup
after insert on public.api_usage_events
for each row execute function public._api_usage_rollup_trigger();


-- =========================
-- 4) RLS
-- (1) Insert is service-role-only: authenticated has SELECT only; no INSERT policy for users.
-- (5) Rollup trigger runs as inserting role (service_role); ON CONFLICT in trigger avoids failures.
-- =========================
alter table public.api_usage_events enable row level security;
alter table public.api_usage_daily enable row level security;

drop policy if exists "Users read own api usage events" on public.api_usage_events;
create policy "Users read own api usage events"
on public.api_usage_events for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users read own api usage daily" on public.api_usage_daily;
create policy "Users read own api usage daily"
on public.api_usage_daily for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Service role manages api usage events" on public.api_usage_events;
create policy "Service role manages api usage events"
on public.api_usage_events for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages api usage daily" on public.api_usage_daily;
create policy "Service role manages api usage daily"
on public.api_usage_daily for all
to service_role
using (true)
with check (true);
