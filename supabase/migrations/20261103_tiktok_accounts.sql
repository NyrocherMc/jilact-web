-- Jilact TikTok OAuth connection records.
-- Run once in Supabase Dashboard > SQL Editor. Tokens are only accessed by Edge Functions.
create table if not exists public.tiktok_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  open_id text not null,
  display_name text,
  avatar_url text,
  encrypted_refresh_token text not null,
  token_iv text not null,
  scopes text[] not null default '{}',
  refresh_expires_at timestamptz,
  connected_at timestamptz not null default now()
);

alter table public.tiktok_accounts enable row level security;
revoke all on public.tiktok_accounts from anon, authenticated;
-- Edge Functions use the service role. No browser-facing table access is granted.
