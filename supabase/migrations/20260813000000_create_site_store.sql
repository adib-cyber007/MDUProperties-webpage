create table if not exists public.site_store (
  id text primary key check (id = 'primary'),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.site_store enable row level security;

revoke all on table public.site_store from public, anon, authenticated;
grant select, insert, update on table public.site_store to service_role;
