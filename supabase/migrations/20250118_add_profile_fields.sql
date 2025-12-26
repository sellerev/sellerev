-- Add new profile fields to seller_profiles
-- These fields allow sellers to specify their goals, risk tolerance, margin targets, and fee preferences

-- Add goals field (text, nullable)
alter table public.seller_profiles
add column if not exists goals text;

-- Add risk_tolerance field (text with constraint)
alter table public.seller_profiles
add column if not exists risk_tolerance text;

-- Add check constraint for risk_tolerance
alter table public.seller_profiles
add constraint seller_profiles_risk_tolerance_check
check (risk_tolerance is null or risk_tolerance in ('low', 'medium', 'high'));

-- Add margin_target field (numeric, nullable, percentage)
alter table public.seller_profiles
add column if not exists margin_target numeric(5, 2);

-- Add check constraint for margin_target (0-100)
alter table public.seller_profiles
add constraint seller_profiles_margin_target_check
check (margin_target is null or (margin_target >= 0 and margin_target <= 100));

-- Add max_fee_pct field (numeric, nullable, percentage)
alter table public.seller_profiles
add column if not exists max_fee_pct numeric(5, 2);

-- Add check constraint for max_fee_pct (0-100)
alter table public.seller_profiles
add constraint seller_profiles_max_fee_pct_check
check (max_fee_pct is null or (max_fee_pct >= 0 and max_fee_pct <= 100));

-- Ensure updated_at column exists (add if not present)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
    and table_name = 'seller_profiles'
    and column_name = 'updated_at'
  ) then
    alter table public.seller_profiles
    add column updated_at timestamptz default now();
  end if;
end $$;

-- Create trigger to update updated_at on row update
create or replace function update_seller_profiles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists seller_profiles_updated_at_trigger on public.seller_profiles;

create trigger seller_profiles_updated_at_trigger
before update on public.seller_profiles
for each row
execute function update_seller_profiles_updated_at();

