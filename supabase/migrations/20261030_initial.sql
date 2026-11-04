-- Jilact: minimum secure schema for the first connected release.
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mon espace',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create or replace function public.is_workspace_member(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.workspace_members m where m.workspace_id=target and m.user_id=auth.uid()) $$;
create or replace function public.can_edit_workspace(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.workspace_members m where m.workspace_id=target and m.user_id=auth.uid() and m.role in ('owner','admin','editor')) $$;

-- A personal workspace is provisioned on account creation. No user-controlled role is trusted.
create or replace function public.create_default_workspace()
returns trigger language plpgsql security definer set search_path = public
as $$ declare wid uuid; begin
  insert into public.workspaces(name,owner_id) values ('Studio créateur',new.id) returning id into wid;
  insert into public.workspace_members(workspace_id,user_id,role) values(wid,new.id,'owner');
  return new;
end $$;
drop trigger if exists on_auth_user_create_workspace on auth.users;
create trigger on_auth_user_create_workspace after insert on auth.users
for each row execute function public.create_default_workspace();

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  caption text not null check (char_length(caption) <= 2200),
  networks text[] not null default '{}',
  scheduled_at timestamptz not null,
  expires_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','action','paused','published','failed')),
  media_path text,
  youtube_video_id text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists posts_workspace_schedule_idx on public.posts(workspace_id,scheduled_at);
create table if not exists public.youtube_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  channel_id text,
  channel_title text,
  encrypted_refresh_token text not null,
  token_iv text not null,
  connected_at timestamptz not null default now()
);
create table if not exists public.oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  expires_at timestamptz not null
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.posts enable row level security;
alter table public.youtube_accounts enable row level security;
alter table public.oauth_states enable row level security;

drop policy if exists workspace_member_read on public.workspaces;
create policy workspace_member_read on public.workspaces for select to authenticated using (public.is_workspace_member(id));
drop policy if exists member_list_members on public.workspace_members;
create policy member_list_members on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists workspace_posts_read on public.posts;
create policy workspace_posts_read on public.posts for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists workspace_posts_insert on public.posts;
create policy workspace_posts_insert on public.posts for insert to authenticated with check (public.can_edit_workspace(workspace_id) and created_by=auth.uid());
drop policy if exists workspace_posts_update on public.posts;
create policy workspace_posts_update on public.posts for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
drop policy if exists workspace_posts_delete on public.posts;
create policy workspace_posts_delete on public.posts for delete to authenticated using (public.can_edit_workspace(workspace_id));
-- OAuth secrets/state are only accessed from Edge Functions using the service role.
revoke all on public.youtube_accounts, public.oauth_states from anon, authenticated;

grant select on public.workspaces, public.workspace_members to authenticated;
grant select,insert,update,delete on public.posts to authenticated;

-- Private media bucket; object path starts with workspace UUID. Policies enforce membership.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('jilact-media','jilact-media',false,536870912,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public=false,file_size_limit=536870912;
drop policy if exists jilact_media_read on storage.objects;
create policy jilact_media_read on storage.objects for select to authenticated using (bucket_id='jilact-media' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
drop policy if exists jilact_media_insert on storage.objects;
create policy jilact_media_insert on storage.objects for insert to authenticated with check (bucket_id='jilact-media' and public.can_edit_workspace((storage.foldername(name))[1]::uuid));
drop policy if exists jilact_media_update on storage.objects;
create policy jilact_media_update on storage.objects for update to authenticated using (bucket_id='jilact-media' and public.can_edit_workspace((storage.foldername(name))[1]::uuid));
drop policy if exists jilact_media_delete on storage.objects;
create policy jilact_media_delete on storage.objects for delete to authenticated using (bucket_id='jilact-media' and public.can_edit_workspace((storage.foldername(name))[1]::uuid));
