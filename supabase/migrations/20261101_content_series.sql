-- Jilact content variants and bounded recurring series.
-- Run once in Supabase Dashboard > SQL Editor after the initial migration.

alter table public.posts
  add column if not exists platform_content jsonb not null default '{}'::jsonb,
  add column if not exists series_id uuid,
  add column if not exists series_index smallint,
  add column if not exists series_total smallint;

-- YouTube descriptions may be longer than the original generic caption limit.
alter table public.posts drop constraint if exists posts_caption_check;
alter table public.posts
  add constraint posts_caption_check check (char_length(caption) <= 5000);

alter table public.posts drop constraint if exists posts_series_order_check;
alter table public.posts
  add constraint posts_series_order_check check (
    (series_id is null and series_index is null and series_total is null)
    or
    (series_id is not null and series_index between 1 and 30
      and series_total between 2 and 30 and series_index <= series_total)
  );

create index if not exists posts_series_idx
  on public.posts(workspace_id, series_id, series_index)
  where series_id is not null;
