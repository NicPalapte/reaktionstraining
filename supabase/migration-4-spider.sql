-- Spider-Drill: erlaubt die neue Übung 'spider_drill'. Einmal im SQL Editor ausführen; mehrfaches Ausführen schadet nicht.
-- Ohne diese Migration bleiben Spider-Zeiten nur auf dem Gerät (der Abgleich überspringt sie).

alter table public.trials   drop constraint if exists trials_exercise_check;
alter table public.trials   add  constraint trials_exercise_check
  check (exercise in ('shuffle_5_10_5', 'commands', 'decoy_court', 'decoy_couch', 'spider_drill'));

alter table public.sessions drop constraint if exists sessions_exercise_check;
alter table public.sessions add  constraint sessions_exercise_check
  check (exercise in ('shuffle_5_10_5', 'commands', 'decoy_court', 'decoy_couch', 'spider_drill'));
