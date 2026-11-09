import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, LIB, CATEGORIES, libOf, searchLibrary } from '../js/library.js';
import { PHASES, WARMUP, COOLDOWN, SPRINT_WARMUP, ROUTINE, applySwap, addSwap, swapAt, swapKey, occurrencesOf, swapCandidates, exKey, results, lastResult } from '../js/strength-plan.js';

const planItems = () => [
  ...PHASES.flatMap((p) => p.units.flatMap((u) => [...u.items, ...(u.block ?? [])])),
  ...WARMUP, ...COOLDOWN, ...SPRINT_WARMUP, ...ROUTINE.flatMap((g) => g.items),
];

test('Bibliothek: eindeutige IDs, bekannte Kategorien, jede Übung hat Ausführung', () => {
  assert.equal(new Set(EXERCISES.map((x) => x.id)).size, EXERCISES.length);
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const x of EXERCISES) {
    assert.ok(cats.has(x.cat), `${x.id}: Kategorie ${x.cat}`);
    assert.ok(x.name && x.equip, x.id);
    assert.ok(x.desc.length > 40, `${x.id}: Beschreibung zu kurz`);
    assert.ok(x.cues.length >= 1 && x.why, x.id);
  }
});

test('Bibliothek: jede Übung aus dem Wintertraining hat einen Eintrag, neu sind Scapula Pull-up und Wood Chopper', () => {
  for (const it of planItems()) assert.ok(libOf(it), `${it.id} fehlt in der Bibliothek`);
  assert.ok(LIB.has('scapula-pullup') && LIB.has('woodchopper'));
  // Nur, was im Plan vorkommt, plus die zwei neuen
  const used = new Set(planItems().map((it) => it.lib ?? it.id));
  assert.deepEqual(EXERCISES.filter((x) => !used.has(x.id)).map((x) => x.id).sort(), ['scapula-pullup', 'woodchopper']);
});

test('Bibliothek: Suche ohne Groß/Klein und Akzente, Filter nach Kategorie', () => {
  assert.ok(searchLibrary('wood').some((x) => x.id === 'woodchopper'));
  assert.ok(searchLibrary('SCHULTERBLATT').some((x) => x.id === 'scapula-pullup'));
  assert.ok(searchLibrary('', 'rumpf').every((x) => x.cat === 'rumpf'));
  assert.equal(searchLibrary('gibtsnicht').length, 0);
});

test('Tauschen: ohne Zeile oder zurückgesetzt bleibt die Übung, sonst kommt die neue mit alter Vorgabe', () => {
  const bss = PHASES.find((p) => p.id === 'P2').units.find((u) => u.id === 'A').items.find((it) => it.id === 'bss');
  const row = (to, target) => addSwap(undefined, { from: 5, to, target });
  assert.equal(applySwap(bss, undefined, 6), bss);
  assert.equal(applySwap(bss, row(''), 6), bss);
  assert.equal(applySwap(bss, row('unbekannt'), 6), bss);
  const s = applySwap(bss, row('einbein-kh'), 6);
  assert.deepEqual([s.id, s.name, s.target, s.swappedFrom.id], ['einbein-kh', 'Einbeiniges Kreuzheben', bss.target, 'bss']);
  assert.equal(applySwap(bss, row('einbein-kh', '3 × 10'), 6).target, '3 × 10');
  // Kamera-Drill bringt seinen Start-Button mit
  assert.equal(applySwap(bss, row('spider'), 6).app, 'spider');
  // Kontrast-Variante auf ihre eigene Bibliotheksübung getauscht: keine Änderung
  const k = PHASES.find((p) => p.id === 'P3').units.find((u) => u.id === 'A').items.find((it) => it.id === 'sprungkniebeuge-kontrast');
  assert.equal(applySwap(k, addSwap(undefined, { from: 9, to: 'sprungkniebeuge' }), 10), k);
});

test('Tauschen: gilt erst ab der Woche, vergangene Wochen bleiben, spätere Änderungen überschreiben nur die Zukunft', () => {
  const bss = { id: 'bss', name: 'Bulgarian Split Squat', target: '3 × 8' };
  let r = addSwap(undefined, { from: 7, to: 'einbein-kh' });
  assert.equal(applySwap(bss, r, 6), bss); // W6 schon trainiert
  assert.equal(applySwap(bss, r, 7).id, 'einbein-kh');
  assert.equal(applySwap(bss, r, 7).swapFrom, 7);
  r = addSwap(r, { from: 8, to: 'hipthrust', target: '3 × 10' });
  assert.deepEqual([6, 7, 8, 9].map((w) => applySwap(bss, r, w).id), ['bss', 'einbein-kh', 'hipthrust', 'hipthrust']);
  // Zurücksetzen ab W9: W7 und W8 bleiben getauscht
  r = addSwap(r, { from: 9, to: '' });
  assert.deepEqual([7, 8, 9, 10].map((w) => applySwap(bss, r, w).id), ['einbein-kh', 'hipthrust', 'bss', 'bss']);
  // Erneut ab W8 tauschen ersetzt W8 und alles danach
  r = addSwap(r, { from: 8, to: 'kreuzheben' });
  assert.deepEqual(r.hist.map((h) => [h.from, h.to]), [[7, 'einbein-kh'], [8, 'kreuzheben']]);
  // Gleicher Stand wie davor: keine neue Stufe
  assert.equal(addSwap(r, { from: 10, to: 'kreuzheben' }).hist.length, 2);
  // Alte Zeilen ohne hist gelten ab W1
  assert.equal(swapAt({ to: 'hipthrust' }, 1).to, 'hipthrust');
});

test('Tauschen: Vorkommen im Plan und Kandidaten', () => {
  assert.deepEqual(occurrencesOf('straight-arm').map((o) => `${o.phase}${o.unit}`), ['P2A', 'P2B', 'P2C', 'P3A', 'P3B', 'P3C', 'P4A', 'P4B', 'P4C', 'P5K1', 'P5K2', 'P6E1', 'P6E2']);
  const c = swapCandidates({ id: 'pallof' }, ['deadbug']);
  assert.equal(c[0].cat, 'rumpf');
  assert.ok(!c.some((x) => x.id === 'pallof' || x.id === 'deadbug'));
  assert.ok(!c.some((x) => x.cat === 'warmup' || x.cat === 'mobil'));
  assert.equal(swapKey('P2', 'A', 'bss'), 'swap|P2|A|bss');
});

test('Tauschen: Einträge der neuen Übung laufen unter ihrer ID, "Zuletzt" findet sie über Phasen hinweg', () => {
  const a = exKey('P2', 'A', 'einbein-kh', 6);
  const c = exKey('P2', 'C', 'einbein-kh', 5);
  const all = results(new Map([[a, { id: a, value: '16 kg' }], [c, { id: c, value: '14 kg' }]]));
  assert.equal(lastResult(all, 'einbein-kh', 7, 'A').value, '16 kg');
  // Tausch-Zeilen sind keine Ergebnisse
  const sw = swapKey('P2', 'A', 'bss');
  assert.equal(results(new Map([[sw, { id: sw, to: 'einbein-kh', value: 'x' }]])).length, 0);
});
