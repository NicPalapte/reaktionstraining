-- Krafttraining (Wintertraining 26/27). Einmal im SQL Editor ausführen; mehrfaches Ausführen schadet nicht.
-- Einträge sind änderbar: Schlüssel ist (user_id, id), der Abgleich nimmt den neueren updated_at.

create table if not exists public.strength (
  id          text not null,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

alter table public.strength enable row level security;

drop policy if exists "strength: eigene lesen"    on public.strength;
drop policy if exists "strength: eigene anlegen"  on public.strength;
drop policy if exists "strength: eigene ändern"   on public.strength;
drop policy if exists "strength: eigene löschen"  on public.strength;
create policy "strength: eigene lesen"   on public.strength for select using (user_id = auth.uid());
create policy "strength: eigene anlegen" on public.strength for insert with check (user_id = auth.uid());
create policy "strength: eigene ändern"  on public.strength for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "strength: eigene löschen" on public.strength for delete using (user_id = auth.uid());
