-- Nur nötig, wenn schema.sql schon VOR dem Kreuzvorhaben / Couch-Spiel ausgeführt wurde.
-- Erweitert die erlaubten Übungen. Mehrfaches Ausführen schadet nicht.

alter table public.trials   drop constraint if exists trials_exercise_check;
alter table public.trials   add  constraint trials_exercise_check
  check (exercise in ('shuffle_5_10_5', 'commands', 'decoy_court', 'decoy_couch'));

alter table public.sessions drop constraint if exists sessions_exercise_check;
alter table public.sessions add  constraint sessions_exercise_check
  check (exercise in ('shuffle_5_10_5', 'commands', 'decoy_court', 'decoy_couch'));
