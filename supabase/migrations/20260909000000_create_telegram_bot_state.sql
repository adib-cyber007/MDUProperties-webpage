create table if not exists public.telegram_bot_state (
  owner_id text primary key,
  conversation jsonb,
  last_update_id bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.telegram_bot_state enable row level security;

revoke all on table public.telegram_bot_state from public, anon, authenticated;
grant select, insert, update, delete on table public.telegram_bot_state to service_role;
