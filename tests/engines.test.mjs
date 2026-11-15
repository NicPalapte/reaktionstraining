import test from 'node:test';
import assert from 'node:assert/strict';
import { ShuffleEngine } from '../js/shuffle-engine.js';
import { CommandEngine } from '../js/command-engine.js';
import { Calibrator, makeSample } from '../js/calibration.js';
import { shuffleTrajectory, commandTrajectory } from '../js/sim-trajectory.js';

// Deterministischer Zufall und Rauschen
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

const FPS = 30;
const HALF_M = 4.57; // eine Seite beim 5-10-5
const OUT_M = 2.4; // Hochformat bei 5 m: darüber hinaus ist die Person nicht im Bild
const TORSO_M = 0.5;

/** Simulierter Lauf im Hochformat: Person verschwindet außerhalb von ±2,4 m aus dem Bild. */
function runShuffle({ reactS = 0.28, seed = 1, noise = 0.06, fps = FPS, wrongStart = false, a = 9, shortRun = false, inFrame = null, lagMs = 0, ghost = null }) {
  const rand = lcg(seed);
  const events = [];
  const eng = new ShuffleEngine({ rand: lcg(seed + 100), onEvent: (n, d) => events.push([n, d]) });
  eng.start();
  let traj = null;
  let tArrowTrue = null;
  const dt = 1000 / fps;
  let visSince = null;
  for (let step = 0; step < fps * 40; step++) {
    const t = step * dt + (rand() - 0.5) * 6;
    let m = 0;
    if (traj) {
      let u = traj.u((t - tArrowTrue) / 1000);
      if (shortRun) u = Math.max(-0.25, Math.min(0.25, u)); // kehrt nach ca. 1 m um
      m = u * HALF_M;
    }
    const limit = inFrame ?? OUT_M;
    const inside = Math.abs(m) <= limit;
    visSince = inside ? (visSince ?? t) : null;
    const seen = inside && t - visSince >= lagMs; // Wiedererkennung am Bildrand braucht lagMs
    let sample = seen ? { dx: m / TORSO_M + gauss(rand) * noise, r: 1 + gauss(rand) * 0.01 } : null;
    // Fehlerkennung (z. B. Person im Hintergrund, Gegenlicht), solange der Läufer außerhalb des Bildes ist
    if (ghost && traj && !sample) sample = ghost((t - tArrowTrue) / 1000, Math.sign(m), traj) ?? null;
    eng.update(t, sample);
    const arrow = events.find((e) => e[0] === 'arrow');
    if (arrow && !traj) {
      tArrowTrue = t;
      traj = shuffleTrajectory({ dir: wrongStart ? -arrow[1].dir : arrow[1].dir, reactS, a });
    }
    if (events.some((e) => e[0] === 'result' || e[0] === 'abort')) break;
  }
  return { events, traj };
}

test('Shuffle: Reaktions- und Laufzeit liegen nahe an der Wahrheit (Läufer verlässt das Bild)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const reactS = 0.2 + (seed % 5) * 0.06;
    const { events, traj } = runShuffle({ reactS, seed });
    const res = events.find((e) => e[0] === 'result');
    assert.ok(res, `Seed ${seed}: kein Ergebnis (${JSON.stringify(events.find((e) => e[0] === 'abort'))})`);
    const r = res[1];
    assert.equal(r.valid, true, `Seed ${seed}: ungültig (${r.reason})`);
    const eReact = Math.abs(r.reaction_ms - traj.truth.reactS * 1000);
    const eRun = Math.abs(r.run_ms - traj.truth.runS * 1000);
    assert.ok(eReact < 110, `Seed ${seed}: Reaktion ${r.reaction_ms} vs ${traj.truth.reactS * 1000}`);
    assert.ok(eRun < 130, `Seed ${seed}: Laufzeit ${r.run_ms} vs ${(traj.truth.runS * 1000).toFixed(0)}`);
    assert.ok(r.split_a_ms > 0 && r.split_a_ms < r.run_ms, 'erste Querung liegt zwischen Start und Ziel');
    assert.equal(r.total_ms, r.reaction_ms + r.run_ms);
  }
});

test('Shuffle: sehr schmales Bild (Rand nur ca. 0,7 m von der Mitte) – Läufer verlässt es vor der Starterkennung', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const reactS = 0.2 + (seed % 5) * 0.06;
    const { events, traj } = runShuffle({ reactS, seed, inFrame: 0.7 });
    const res = events.find((e) => e[0] === 'result');
    assert.ok(res, `Seed ${seed}: kein Ergebnis (${JSON.stringify(events.find((e) => e[0] === 'abort'))})`);
    const r = res[1];
    assert.equal(r.valid, true, `Seed ${seed}: ungültig (${r.reason})`);
    assert.ok(Math.abs(r.reaction_ms - traj.truth.reactS * 1000) < 150, `Seed ${seed}: Reaktion ${r.reaction_ms}`);
    assert.ok(Math.abs(r.run_ms - traj.truth.runS * 1000) < 150, `Seed ${seed}: Laufzeit ${r.run_ms}`);
  }
});

test('Shuffle: auch ohne Verlassen des Bildes (breites Bild) wird gemessen', () => {
  const { events, traj } = runShuffle({ seed: 5, inFrame: 99 });
  const r = events.find((e) => e[0] === 'result')[1];
  assert.equal(r.valid, true);
  assert.ok(Math.abs(r.run_ms - traj.truth.runS * 1000) < 130);
});

test('Shuffle: spätes Wiedererkennen am Bildrand verfälscht die Zielzeit nicht', () => {
  for (const lagMs of [200, 300, 500]) {
    for (let seed = 1; seed <= 10; seed++) {
      const { events, traj } = runShuffle({ seed, lagMs });
      const res = events.find((e) => e[0] === 'result');
      assert.ok(res, `Lag ${lagMs}, Seed ${seed}: kein Ergebnis`);
      const err = Math.abs(res[1].run_ms - traj.truth.runS * 1000);
      assert.ok(err < 130, `Lag ${lagMs}, Seed ${seed}: Fehler ${err.toFixed(0)} ms`);
    }
  }
});

test('Shuffle: Fehlerkennungen, während der Läufer auf Seite A außerhalb des Bildes ist, beenden den Lauf nicht', () => {
  const cases = {
    // kleine Person im Hintergrund (anderer Platz) in der Mitte
    hintergrund: (tS, side, traj) => (tS > traj.truth.reactS + 0.6 && tS < traj.truth.turnAS + 0.3 ? { dx: 0.3, r: 0.4 } : null),
    // einzelnes Geisterbild auf der Gegenseite
    gegenseite: (tS, side, traj) => (Math.abs(tS - (traj.truth.reactS + 0.8)) < 0.02 ? { dx: -side * 1.5, r: 1 } : null),
    // zwei Geisterbilder in der Mitte
    mitte: (tS, side, traj) => (Math.abs(tS - (traj.truth.turnAS - 0.1)) < 0.035 ? { dx: 0, r: 1.05 } : null),
  };
  for (const [name, ghost] of Object.entries(cases)) {
    for (let seed = 1; seed <= 10; seed++) {
      const { events, traj } = runShuffle({ seed, ghost });
      const res = events.find((e) => e[0] === 'result');
      assert.ok(res, `${name}, Seed ${seed}: kein Ergebnis (${JSON.stringify(events.find((e) => e[0] === 'abort'))})`);
      assert.equal(res[1].valid, true, `${name}, Seed ${seed}: ${res[1].reason}`);
      const err = Math.abs(res[1].run_ms - traj.truth.runS * 1000);
      assert.ok(err < 130, `${name}, Seed ${seed}: ${res[1].run_ms} statt ${(traj.truth.runS * 1000).toFixed(0)} ms`);
    }
  }
});

test('Shuffle: beide Richtungen werden gewürfelt und gemessen', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const res = runShuffle({ seed }).events.find((e) => e[0] === 'result');
    if (res) seen.add(res[1].direction);
  }
  assert.deepEqual([...seen].sort(), ['left', 'right']);
});

test('Shuffle: nie mehr als 2-mal hintereinander dieselbe Seite, im Satz ausgeglichen', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const eng = new ShuffleEngine({ rand: lcg(seed) });
    eng.start();
    const dirs = [];
    for (let k = 0; k < 30; k++) {
      eng.fire(k * 1000);
      dirs.push(eng.dir);
      const n = dirs.filter((d) => d === 1).length;
      assert.ok(Math.abs(2 * n - dirs.length) <= 2, `Seed ${seed}: unausgeglichen ${dirs.join(',')}`);
    }
    for (let k = 2; k < dirs.length; k++) assert.ok(!(dirs[k] === dirs[k - 1] && dirs[k] === dirs[k - 2]), `Seed ${seed}: 3× gleich ${dirs.join(',')}`);
  }
});

test('Shuffle: falsche Richtung wird als ungültig markiert', () => {
  const res = runShuffle({ wrongStart: true, seed: 3 }).events.find((e) => e[0] === 'result');
  assert.equal(res[1].valid, false);
  assert.equal(res[1].reason, 'Falsche Richtung');
});

test('Shuffle: zu kurz gelaufen (Umkehr nach ca. 1 m) wird nicht gewertet', () => {
  const { events } = runShuffle({ seed: 4, shortRun: true });
  assert.ok(!events.some((e) => e[0] === 'result'), 'es darf kein Ergebnis geben');
  const ab = events.find((e) => e[0] === 'abort');
  assert.ok(ab && /kurz|Mitte|Gegenseite/.test(ab[1].reason), JSON.stringify(ab));
});

test('Shuffle: Fehlstart vor dem Pfeil bricht ab, ohne Ergebnis', () => {
  const ev = [];
  const eng = new ShuffleEngine({ rand: () => 0.9, onEvent: (n, d) => ev.push([n, d]) });
  eng.start();
  let t = 0;
  for (; t < 1200; t += 33) eng.update(t, { dx: 0, r: 1 });
  assert.equal(eng.state, 'countdown');
  for (let k = 0; k < 12; k++, t += 33) eng.update(t, { dx: 0.5 * k, r: 1 });
  assert.ok(ev.some((e) => e[0] === 'abort' && e[1].reason === 'Fehlstart'));
  assert.ok(!ev.some((e) => e[0] === 'result'));
});

test('Shuffle: Person fehlt schon vor dem Start -> Abbruch', () => {
  const ev = [];
  const eng = new ShuffleEngine({ rand: () => 0.5, onEvent: (n, d) => ev.push([n, d]) });
  eng.start();
  let t = 0;
  for (; t < 6000 && eng.state !== 'go'; t += 33) eng.update(t, { dx: 0, r: 1 });
  assert.equal(eng.state, 'go');
  for (let k = 0; k < 60; k++, t += 33) eng.update(t, null);
  assert.ok(ev.some((e) => e[0] === 'abort'));
});

test('Shuffle: nach dem Ergebnis startet die nächste Runde von selbst', () => {
  const eng = new ShuffleEngine({ rand: () => 0.5 });
  eng.start();
  let t = 0;
  for (; t < 6000 && eng.state !== 'go'; t += 33) eng.update(t, { dx: 0, r: 1 });
  eng.finishTrial({ valid: true, reaction_ms: 250, run_ms: 5000 });
  assert.equal(eng.state, 'hold');
  for (let k = 0; k < 150; k++, t += 33) eng.update(t, { dx: 0, r: 1 });
  assert.ok(['wait_center', 'countdown'].includes(eng.state));
});

test('Shuffle: wird im Ergebnis-Handler gestoppt (Satz voll), bleibt die Erkennung aus', () => {
  let eng;
  eng = new ShuffleEngine({ rand: () => 0.5, onEvent: (n) => n === 'result' && eng.stop() });
  eng.start();
  let t = 0;
  for (; t < 6000 && eng.state !== 'go'; t += 33) eng.update(t, { dx: 0, r: 1 });
  eng.finishTrial({ valid: true, reaction_ms: 250, run_ms: 5000 });
  for (let k = 0; k < 300; k++, t += 33) eng.update(t, { dx: 0, r: 1 });
  assert.equal(eng.state, 'idle');
});

test('Shuffle: nach einem gelaufenen Durchgang Pause, überspringbar; nach Fehlstart keine', () => {
  const run = (res, skipAt = null) => {
    const eng = new ShuffleEngine({ rand: () => 0.5, params: { restMs: 30000 } });
    eng.start();
    let t = 0;
    for (; t < 6000 && eng.state !== 'go'; t += 33) eng.update(t, { dx: 0, r: 1 });
    const t0 = t;
    eng.finishTrial(res);
    for (; t < t0 + 40000 && eng.state === 'hold'; t += 33) {
      if (skipAt != null && t - t0 >= skipAt) eng.skipRest();
      eng.update(t, { dx: 0, r: 1 });
    }
    return t - t0;
  };
  const rest = run({ valid: true, reaction_ms: 250, run_ms: 5000 });
  assert.ok(rest >= 30000 && rest < 30200, `Pause ${rest}`);
  assert.ok(run({ valid: true, reaction_ms: 250, run_ms: 5000 }, 5000) < 5200, 'überspringen');
  assert.ok(run({ valid: false, reason: 'Falsche Richtung', reaction_ms: null, run_ms: null }) < 4000, 'keine Pause nach Fehlstart');
});

test('Kalibrierung: Mitte wird freihändig übernommen, Sample in Rumpflängen', () => {
  const cal = new Calibrator();
  let r;
  for (let t = 0; t < 2000; t += 33) r = cal.update(t, { x: 0.5, s: 72, vh: 1280 });
  assert.ok(r.done && r.cal.warning === null);
  assert.ok(Math.abs(r.cal.x0 - 0.5) < 1e-9);
  const sample = makeSample(r.cal)({ x: 0.5 + 0.1, s: 72, vw: 720 }); // 0,1 Bildbreite = 72 px = 1 Rumpflänge (ca. 0,5 m)
  assert.ok(Math.abs(sample.dx - 1) < 0.01 && Math.abs(sample.r - 1) < 1e-9, JSON.stringify(sample));
});

test('Kalibrierung: Unruhe setzt den Fortschritt zurück, Warnung bei schiefem Gerät', () => {
  const cal = new Calibrator();
  let r;
  for (let t = 0; t < 1200; t += 33) r = cal.update(t, { x: 0.5, s: 72, vh: 1280 });
  r = cal.update(1300, { x: 0.6, s: 72, vh: 1280 });
  assert.ok(r.progress < 0.1 && !r.done);
  const c2 = new Calibrator();
  for (let t = 0; t < 2000; t += 33) r = c2.update(t, { x: 0.15, s: 72, vh: 1280 });
  assert.match(r.cal.warning, /mittig/);
});

test('Befehle: Schleife bereit -> Befehl -> weg -> zurück -> bereit', () => {
  const ev = [];
  const eng = new CommandEngine({ rand: lcg(7), onEvent: (n, d) => ev.push([n, d]) });
  eng.start();
  let t = 0;
  let traj = null;
  let tCmd = 0;
  let seen = 0;
  for (let step = 0; step < 30 * 120 && eng.rounds < 6; step++, t += 33) {
    const s = traj ? traj.sample((t - tCmd) / 1000) : { dx: 0, r: 1 };
    const inp = s.r > 1.7 || Math.abs(s.dx) * TORSO_M > OUT_M ? null : s; // außerhalb des Bildes: Pose verloren
    eng.update(t, inp);
    const c = ev.filter((e) => e[0] === 'command');
    if (c.length > seen && !traj) {
      seen = c.length;
      tCmd = t;
      traj = commandTrajectory({ command: c[c.length - 1][1].command });
    }
    if (traj && (t - tCmd) / 1000 > traj.endS + 0.5 && eng.state !== 'command') traj = null;
  }
  assert.equal(eng.rounds, 6);
  const cmds = new Set(ev.filter((e) => e[0] === 'command').map((e) => e[1].command));
  assert.ok(cmds.has('left') && cmds.has('right') && cmds.has('front'));
});

test('Befehle: kein neuer Befehl, solange die Person nicht zurück ist', () => {
  const ev = [];
  const eng = new CommandEngine({ rand: () => 0.1, onEvent: (n, d) => ev.push([n, d]) });
  eng.start();
  let t = 0;
  for (; t < 5000 && eng.state !== 'command'; t += 33) eng.update(t, { dx: 0, r: 1 });
  assert.equal(eng.state, 'command');
  for (let k = 0; k < 60; k++, t += 33) eng.update(t, { dx: 3, r: 1 });
  assert.equal(eng.state, 'away');
  assert.equal(ev.filter((e) => e[0] === 'command').length, 1);
});
