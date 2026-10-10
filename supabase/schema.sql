-- Schema für später (Supabase). Im SQL-Editor des Projekts ausführen.
-- Die App speichert heute lokal; storage.js bekommt dann eine SupabaseStore-Klasse mit derselben Schnittstelle.

create table if not exists public.trials (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  created_at   timestamptz not null default now(),
  exercise     text not null check (exercise in ('shuffle_5_10_5', 'commands')),
  session_id   text,
  direction    text check (direction in ('left', 'right', 'front')),
  reaction_ms  integer,
  run_ms       integer,
  total_ms     integer,
  split_a_ms   integer,
  split_b_ms   integer,
  valid        boolean not null default true,
  reason       text
);

create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  created_at       timestamptz not null default now(),
  exercise         text not null check (exercise in ('shuffle_5_10_5', 'commands')),
  session_id       text,
  rounds           integer,
  duration_ms      integer,
  best_run_ms      integer,
  avg_run_ms       integer,
  avg_reaction_ms  integer,
  meta             jsonb
);

create index if not exists trials_user_time on public.trials (user_id, created_at);
create index if not exists sessions_user_time on public.sessions (user_id, created_at);

alter table public.trials   enable row level security;
alter table public.sessions enable row level security;

-- Jeder sieht und ändert nur die eigenen Zeilen.
create policy "trials: eigene lesen"    on public.trials   for select using (user_id = auth.uid());
create policy "trials: eigene anlegen"  on public.trials   for insert with check (user_id = auth.uid());
create policy "trials: eigene löschen"  on public.trials   for delete using (user_id = auth.uid());
create policy "sessions: eigene lesen"   on public.sessions for select using (user_id = auth.uid());
create policy "sessions: eigene anlegen" on public.sessions for insert with check (user_id = auth.uid());
create policy "sessions: eigene löschen" on public.sessions for delete using (user_id = auth.uid());
