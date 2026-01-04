-- Add sourcing_model column to seller_profiles
-- This enables margin intelligence by tracking how sellers source products

alter table public.seller_profiles
add column if not exists sourcing_model text;

-- Set default for existing rows
update public.seller_profiles
set sourcing_model = coalesce(sourcing_model, 'not_sure')
where sourcing_model is null;

-- Make column NOT NULL
alter table public.seller_profiles
alter column sourcing_model set not null;

-- Add check constraint
alter table public.seller_profiles
add constraint seller_profiles_sourcing_model_check
check (sourcing_model in ('private_label','wholesale_arbitrage','retail_arbitrage','dropshipping','not_sure'));







