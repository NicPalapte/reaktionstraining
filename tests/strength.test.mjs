import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, weekOf, weekStart, phaseOfWeek, exKey, results, lastResult, historyOf, parseResult, resultText, exerciseList } from '../js/strength-plan.js';

test('Kraft: Wochen passen zu den Daten im Plan', () => {
  assert.equal(weekOf(new Date(2026, 9, 26)), 5); // P2 W5 26.10.
  assert.equal(weekOf(new Date(2026, 10, 1)), 5); // Sonntag gehört noch dazu
  assert.equal(weekOf(new Date(2026, 10, 23)), 9); // P3 W9 23.11.
  assert.equal(weekOf(new Date(2027, 0, 11)), 16); // P5 W16 11.01.
  assert.equal(weekOf(new Date(2027, 1, 22)), 22); // P6 W22 22.02.
  assert.deepEqual([weekStart(14).getDate(), weekStart(14).getMonth()], [28, 11]); // 28.12.
  assert.equal(phaseOfWeek(7).id, 'P2');
  assert.equal(phaseOfWeek(0).id, 'P1');
  assert.equal(phaseOfWeek(30).id, 'P6');
});

test('Kraft: Phasen lückenlos, Einheiten ohne Wochentag, Übungen je Einheit eindeutig', () => {
  const weeks = PHASES.flatMap((p) => p.weeks);
  assert.deepEqual(weeks, Array.from({ length: 22 }, (_, i) => i + 1));
  for (const p of PHASES)
    for (const u of p.units) {
      assert.doesNotMatch(`${u.title} ${u.name}`, /\b(Mo|Di|Mi|Do|Fr|Sa|So)\b/, `${p.id} ${u.title}`);
      const ids = [...u.items, ...(u.block ?? [])].map((it) => it.id);
      assert.equal(new Set(ids).size, ids.length, `${p.id} ${u.title}: doppelte Übung`);
    }
  // Schulterblatt-Block an jeder Gym-Einheit ab P2, nie beim Sprint
  for (const p of PHASES.slice(1)) for (const u of p.units) assert.equal(!!u.block, u.gym, `${p.id} ${u.title}`);
});

test('Kraft: keine eigenen Werte im Code, ohne Einträge gibt es keine Ergebnisse', () => {
  assert.deepEqual(results(new Map()), []);
  for (const p of PHASES) for (const u of p.units) for (const it of [...u.items, ...(u.block ?? [])]) assert.equal(it.seed, undefined, it.id);
});

test('Kraft: "Zuletzt" kommt über Phasen hinweg aus P1, auch wenn die Übung anders heißt', () => {
  const k = (w) => exKey('P1', 'B', 'klimmzug', w);
  const all = results(new Map([[k(3), { id: k(3), value: '20 kg', note: 'Latzug' }], [k(4), { id: k(4), value: '22 kg', note: '' }]]));
  const pull = lastResult(all, 'klimmzug', 5, 'B');
  assert.deepEqual([pull.week, pull.value], [4, '22 kg']);
  assert.equal(lastResult(all, 'klimmzug', 3, 'B'), null);
});

test('Kraft: leere Einträge zählen nicht, "Zuletzt" überspringt sie', () => {
  const k = (w) => exKey('P2', 'A', 'kniebeuge', w);
  const rows = new Map([
    [k(5), { id: k(5), value: '10 kg', note: 'sauber' }],
    [k(6), { id: k(6), value: '', reps: '', note: '' }],
  ]);
  const all = results(rows);
  assert.equal(historyOf(all, 'kniebeuge').length, 1);
  assert.equal(lastResult(all, 'kniebeuge', 7, 'A').value, '10 kg');
});

test('Kraft: Schulterblatt-Block in derselben Woche nimmt die eigene Einheit, sonst die letzte Woche', () => {
  const k = (u, w) => exKey('P2', u, 'straight-arm', w);
  const rows = new Map([
    [k('A', 5), { id: k('A', 5), value: '10 kg' }],
    [k('C', 5), { id: k('C', 5), value: '12 kg' }],
  ]);
  const all = results(rows);
  assert.equal(lastResult(all, 'straight-arm', 6, 'C').value, '12 kg');
  assert.equal(lastResult(all, 'straight-arm', 6, 'A').value, '10 kg');
  assert.equal(lastResult(all, 'straight-arm', 5, 'B'), null);
});

test('Kraft: Zahlen fürs Diagramm aus der Freitext-Eingabe', () => {
  const p = (value, reps = '') => parseResult({ value, reps });
  assert.deepEqual(p('12,5 kg', '3 × 8'), { kg: 12.5, reps: 8, s: null, cm: null });
  assert.equal(p('50 - 45 kg').kg, 50); // Absteigend: oberstes Gewicht zählt
  assert.equal(p('20 kg', '8, 8, 6').reps, (8 + 8 + 6) / 3);
  assert.equal(p('12 Wdh').reps, 12);
  assert.equal(p('6,12 s').s, 6.12);
  assert.equal(p('1,8 m').cm, 180);
  assert.deepEqual(p('Stange'), { kg: null, reps: null, s: null, cm: null });
  assert.equal(resultText({ value: '40 kg', reps: '8', note: 'sauber' }), '40 kg × 8 · sauber');
});

test('Kraft: Übungsliste fürs Diagramm nimmt den neuesten Namen, jede Übung einmal', () => {
  const list = exerciseList();
  assert.equal(new Set(list.map((x) => x.id)).size, list.length);
  assert.equal(list.find((x) => x.id === 'boxsprung').name, 'Boxsprung');
  assert.equal(list.find((x) => x.id === 'sprungkniebeuge-kontrast').name, 'Sprungkniebeuge o. Last (Kontrast)');
  assert.equal(new Set(list.map((x) => x.name)).size, list.length, 'kein Name doppelt');
  // Gruppen nach Einheit, Schulterblatt-Block zuletzt
  assert.equal(list.find((x) => x.id === 'kniebeuge').group.label, 'A · Beine & Rumpf');
  assert.equal(list.find((x) => x.id === 'klimmzug').group.id, 'B');
  assert.equal(list[list.length - 1].group.label, 'Schulterblatt-Block');
});

import { compareResult, sessionsOf, weeksOf, physioDays, streaks, dayKey } from '../js/strength-plan.js';

test('Fortschritt: Vergleich mit dem letzten Mal', () => {
  assert.deepEqual(compareResult({ value: '40 kg', reps: '8' }, { value: '42,5 kg', reps: '6' }), { dir: 1, text: '+2,5 kg' });
  assert.deepEqual(compareResult({ value: '40 kg', reps: '8' }, { value: '40 kg', reps: '10' }), { dir: 1, text: '+2 Wdh' });
  assert.equal(compareResult({ value: '40 kg', reps: '8' }, { value: '40 kg', reps: '8' }).dir, 0);
  assert.equal(compareResult({ value: '5,40 s' }, { value: '5,30 s' }, { time: true }).dir, 1);
  assert.equal(compareResult({ value: '40 s' }, { value: '30 s' }).dir, -1); // Halten: länger ist besser
  assert.equal(compareResult(null, { value: '40 kg' }).dir, null);
  assert.equal(compareResult({ value: 'locker' }, { value: 'gut' }).dir, null);
});

test('Fortschritt: Einheiten und Wochen, verpasste Wochen ohne Gym', () => {
  const r = (phase, unit, ex, week, value, created_at) => [exKey(phase, unit, ex, week), { id: exKey(phase, unit, ex, week), value, created_at }];
  const rows = new Map([
    r('P1', 'A', 'kniebeuge', 1, '40 kg', '2026-09-29T08:00:00Z'),
    r('P1', 'A', 'kniebeuge', 3, '45 kg', '2026-10-13T08:00:00Z'),
    r('P1', 'B', 'rudern', 3, '30 kg', '2026-12-01T08:00:00Z'), // nachgetragen: ohne Tag
  ]);
  const s = sessionsOf(rows);
  assert.equal(s.length, 3);
  assert.equal(s[0].date.getDate(), 29);
  const a3 = s.find((x) => x.week === 3 && x.unit === 'A');
  assert.deepEqual([a3.up, a3.entries[0].cmp.text], [1, '+5 kg']);
  assert.equal(s.find((x) => x.unit === 'B').date, null);
  const w = weeksOf(s, 3);
  assert.deepEqual(w.map((x) => x.gymDone), [1, 0, 2]);
  assert.equal(w[2].up, 1);
});

test('Physio-Tracker: Tage und Serien', () => {
  const ids = ['a', 'b'];
  const d = (m, day) => new Date(2026, m, day);
  const rows = new Map();
  const done = (date, id) => rows.set(dayKey(date, id), { id: dayKey(date, id), done: true });
  for (const day of [1, 2, 3, 5, 6]) for (const id of ids) done(d(10, day), id);
  done(d(10, 7), 'a'); // heute halb
  const days = physioDays(rows, ids);
  assert.equal(days.get('2026-11-07'), 1);
  const full = (x) => days.get(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`) === 2;
  assert.deepEqual(streaks(full, d(10, 7), d(9, 28)), { current: 2, best: 3 });
});
