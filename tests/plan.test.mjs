import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, PLAN, setPlan, validatePlan, phaseOfWeek, weekOf, exportPlan, planConflicts, buildImport, applySwap, swapKey, LAST_WEEK } from '../js/strength-plan.js';
import { readPlan, loadPlan } from './plan-fixture.mjs';

const unitOf = (phase, unit) => PHASES.find((p) => p.id === phase).units.find((u) => u.id === unit);

test('Plan: Vorlagen sind gültig und verweisen nur auf die Bibliothek', () => {
  for (const name of ['wintertraining-26-27', 'wintertraining-26-27-alt']) assert.deepEqual(validatePlan(readPlan(name)), [], name);
});

test('Plan: ungültige Dateien werden abgelehnt', () => {
  const doc = readPlan('wintertraining-26-27');
  assert.match(validatePlan({ ...doc, format: undefined })[0], /Kein Trainingsplan/);
  const bad = structuredClone(doc);
  bad.phases[1].units[0].items.push({ ex: 'gibtsnicht' });
  assert.ok(validatePlan(bad).some((e) => /gibtsnicht/.test(e)));
  const dupWeek = structuredClone(doc);
  dupWeek.phases[2].weeks.push(5);
  assert.ok(validatePlan(dupWeek).some((e) => /W5/.test(e)));
  const dupItem = structuredClone(doc);
  dupItem.phases[1].units[0].items.push({ ex: 'kniebeuge' });
  assert.ok(validatePlan(dupItem).some((e) => /kniebeuge doppelt/.test(e)));
  assert.throws(() => setPlan(bad));
});

test('Plan: Vorlage Wintertraining mit Home-Wochen, P3 W10–12, Block nur an A und C', () => {
  loadPlan('wintertraining-26-27');
  assert.equal(LAST_WEEK, 22);
  assert.deepEqual(PHASES.flatMap((p) => p.weeks).sort((a, b) => a - b), Array.from({ length: 22 }, (_, i) => i + 1));
  assert.deepEqual([9, 10, 12, 13, 14, 15].map((w) => phaseOfWeek(w).id), ['H', 'P3', 'P3', 'H', 'H', 'P4']);
  assert.equal(weekOf(new Date(2026, 10, 23)), 9);
  assert.equal(unitOf('P2', 'B').block, undefined);
  assert.equal(unitOf('P2', 'A').block[0].id, 'scapula-pullup');
  // Name aus dem Plan, Zeitmessung und Kamera-Drill aus der Bibliothek
  const holz = unitOf('P2', 'A').items.find((it) => it.id === 'woodchopper');
  assert.equal(holz.name, 'Holzhacker Kabel diagonal');
  const shuttle = unitOf('P2', 'S').items.find((it) => it.id === 'shuttle');
  assert.deepEqual([shuttle.app, shuttle.time, shuttle.shuttle], ['shuffle', true, true]);
  // Band-Varianten laufen unter eigener ID, damit "Zuletzt" nicht die Gym-Werte zeigt
  assert.ok(unitOf('H', 'K').items.some((it) => it.id === 'rudern-band' && it.lib === 'rudern'));
});

test('Plan: Export mit Tauschen, erneuter Import ohne Rückfrage', () => {
  loadPlan('wintertraining-26-27');
  const id = swapKey('P3', 'A', 'kniebeuge');
  const rows = new Map([[id, { id, hist: [{ from: 11, to: 'bss', target: '4 × 6' }] }]]);
  const doc = exportPlan(rows);
  const it = doc.phases.find((p) => p.id === 'P3').units.find((u) => u.id === 'A').items.find((x) => x.ex === 'kniebeuge');
  assert.equal(it.hist[0].to, 'bss');
  assert.deepEqual(validatePlan(doc), []);
  assert.deepEqual(planConflicts(rows, doc, 10), []);
  const { plan, swaps } = buildImport(doc, [], 10);
  assert.deepEqual(swaps.get(id), [{ from: 11, to: 'bss', target: '4 × 6' }]);
  assert.ok(JSON.stringify(plan).indexOf('"hist"') < 0);
});

test('Plan: Import alt → neu fragt bei abweichenden Übungen, Antwort für alle oder zukünftige Wochen', () => {
  loadPlan('wintertraining-26-27-alt');
  const rows = new Map();
  const doc = readPlan('wintertraining-26-27');
  const conflicts = planConflicts(rows, doc, 8);
  const pallof = conflicts.find((c) => c.phase.id === 'P2' && c.unit.id === 'A' && c.local.id === 'pallof');
  assert.ok(pallof, 'Pallof ↔ Holzhacker wird über die Reihenfolge zugeordnet');
  assert.equal(pallof.item.id, 'woodchopper');
  assert.deepEqual([pallof.past, pallof.future], [true, true]);
  assert.ok(conflicts.some((c) => c.phase.id === 'P2' && c.unit.id === 'A' && c.local.id === 'straight-arm' && c.item.id === 'scapula-pullup'));

  const old = PLAN;
  const build = (pick, scope) => {
    const { plan, swaps } = buildImport(doc, [{ conflict: pallof, pick, scope }], 8);
    setPlan(plan);
    const u = unitOf('P2', 'A');
    const row = { hist: swaps.get(swapKey('P2', 'A', u.items[6].id)) ?? [] };
    const at = (w) => applySwap(u.items[6], row, w).id;
    setPlan(old);
    return [u.items[6].id, at(5), at(7), at(8), applySwap(u.items[6], row, 8).name];
  };
  const H = 'Holzhacker Kabel diagonal';
  assert.deepEqual(build('file', 'all'), ['woodchopper', 'woodchopper', 'woodchopper', 'woodchopper', H]);
  // ab jetzt: als Tausch mit dem Namen aus der Datei
  assert.deepEqual(build('file', 'future'), ['pallof', 'pallof', 'pallof', 'woodchopper', H]);
  assert.deepEqual(build('local', null), ['pallof', 'pallof', 'pallof', 'pallof', 'Pallof Press']);
});

test('Plan: ohne Plan keine Phasen', () => {
  setPlan(null);
  assert.equal(PHASES.length, 0);
  assert.equal(phaseOfWeek(5), null);
  loadPlan();
});

test('Plan: eigene Übungen mit Beschreibung kommen mit dem Plan in die Bibliothek', async () => {
  const lib = await import('../js/library.js'); // Namensraum: EXERCISES ist ein Live-Binding
  const { LIB, searchLibrary } = lib;
  const doc = readPlan('wintertraining-26-27');
  doc.phases[1].units[0].items.push({ ex: 'farmers-walk', target: '3 × 30 m' });
  assert.ok(validatePlan(doc).some((e) => /farmers-walk/.test(e) && /exercises/.test(e)));
  doc.exercises = [{ id: 'farmers-walk', name: 'Farmer’s Walk' }];
  assert.ok(validatePlan(doc).some((e) => /Beschreibung/.test(e)), 'ohne Ausführung abgelehnt');
  doc.exercises[0].desc = 'Zwei schwere Kurzhanteln seitlich tragen, aufrecht gehen, Schultern unten, kurze schnelle Schritte.';
  doc.exercises[0].cues = ['Aufrecht', 'Schultern unten'];
  assert.deepEqual(validatePlan(doc), []);
  setPlan(doc);
  assert.equal(LIB.get('farmers-walk').cat, 'eigen');
  assert.ok(lib.EXERCISES.some((x) => x.id === 'farmers-walk'));
  assert.ok(searchLibrary('farmer').length === 1);
  assert.equal(unitOf('P2', 'A').items.at(-1).name, 'Farmer’s Walk');
  // Eingebaute IDs lassen sich nicht überschreiben
  setPlan({ ...doc, exercises: [...doc.exercises, { id: 'kniebeuge', name: 'X', desc: 'x'.repeat(30) }] });
  assert.equal(LIB.get('kniebeuge').name, 'Kniebeuge');

  // Neuer Plan ohne die Übung: behaltene Stelle nimmt die eigene Übung mit
  const next = readPlan('wintertraining-26-27');
  next.phases[1].units[0].items.push({ ex: 'kniebeuge', id: 'kb2', target: '1 × 5' });
  const c = planConflicts(new Map(), next, 6).find((x) => x.local.id === 'farmers-walk');
  assert.ok(c);
  const { plan } = buildImport(next, [{ conflict: c, pick: 'local', scope: null }], 6);
  assert.deepEqual(plan.exercises.map((x) => x.id), ['farmers-walk']);
  assert.deepEqual(validatePlan(plan), []);
  // Ohne eigene Übungen verschwindet sie wieder aus der Bibliothek
  loadPlan();
  assert.equal(LIB.has('farmers-walk'), false);
});
