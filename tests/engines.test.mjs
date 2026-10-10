import test from 'node:test';
import assert from 'node:assert/strict';
import { ShuffleEngine } from '../js/shuffle-engine.js';
import { CommandEngine } from '../js/command-engine.js';
import { Calibrator, makeU, makeCommandSample } from '../js/calibration.js';
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

function runShuffle({ dir, reactS = 0.28, seed = 1, noise = 0.01, fps = FPS, wrongStart = false, a = 9 }) {
  const rand = lcg(seed);
  const events = [];
  const eng = new ShuffleEngine({ rand: lcg(seed + 100), onEvent: (n, d) => events.push([n, d]) });
  eng.start();
  let t = 0;
  let traj = null;
  let tArrowTrue = null;
  const dt = 1000 / fps;
  for (let step = 0; step < fps * 40; step++) {
    t = step * dt + (rand() - 0.5) * 6;
    let u;
    if (!traj) u = gauss(rand) * noise * 0.5;
    else u = traj.u((t - tArrowTrue) / 1000) + gauss(rand) * noise;
    eng.update(t, u);
    const arrow = events.find((e) => e[0] === 'arrow');
    if (arrow && !traj) {
      tArrowTrue = t;
      const d = wrongStart ? -arrow[1].dir : arrow[1].dir;
      traj = shuffleTrajectory({ dir: d, reactS: reactS, a });
    }
    if (events.some((e) => e[0] === 'result' || e[0] === 'abort')) break;
  }
  return { events, traj, tArrowTrue };
}

test('Shuffle: Reaktions- und Laufzeit liegen nahe an der Wahrheit', () => {
  for (let seed = 1; seed <= 12; seed++) {
    for (const dir of [0]) {
      const reactS = 0.2 + (seed % 5) * 0.06;
      const { events, traj } = runShuffle({ dir, reactS, seed });
      const res = events.find((e) => e[0] === 'result');
      assert.ok(res, `Seed ${seed}: kein Ergebnis`);
      const r = res[1];
      assert.equal(r.valid, true, `Seed ${seed}: ungültig (${r.reason})`);
      const eReact = Math.abs(r.reaction_ms - traj.truth.reactS * 1000);
      const eRun = Math.abs(r.run_ms - traj.truth.runS * 1000);
      assert.ok(eReact < 90, `Seed ${seed}: Reaktion ${r.reaction_ms} vs ${traj.truth.reactS * 1000} (Fehler ${eReact.toFixed(0)} ms)`);
      assert.ok(eRun < 120, `Seed ${seed}: Laufzeit ${r.run_ms} vs ${(traj.truth.runS * 1000).toFixed(0)} (Fehler ${eRun.toFixed(0)} ms)`);
      assert.ok(r.split_a_ms > 0 && r.split_b_ms > r.split_a_ms);
    }
  }
});

test('Shuffle: beide Richtungen werden gewürfelt und gemessen', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const { events } = runShuffle({ dir: 0, seed });
    const res = events.find((e) => e[0] === 'result');
    if (res) seen.add(res[1].direction);
  }
  assert.deepEqual([...seen].sort(), ['left', 'right']);
});

test('Shuffle: falsche Richtung wird als ungültig markiert', () => {
  const { events } = runShuffle({ dir: 0, wrongStart: true, seed: 3 });
  const res = events.find((e) => e[0] === 'result');
  assert.equal(res[1].valid, false);
  assert.equal(res[1].reason, 'Falsche Richtung');
});

test('Shuffle: Fehlstart vor dem Pfeil bricht ab, ohne Ergebnis', () => {
  const eng = new ShuffleEngine({ rand: () => 0.9 });
  const ev = [];
  eng.emit = (n, d) => ev.push([n, d]);
  eng.start();
  let t = 0;
  for (; t < 1200; t += 33) eng.update(t, 0);
  assert.equal(eng.state, 'countdown');
  for (let k = 0; k < 10; k++, t += 33) eng.update(t, 0.1 * k);
  assert.ok(ev.some((e) => e[0] === 'abort' && e[1].reason === 'Fehlstart'));
  assert.ok(!ev.some((e) => e[0] === 'result'));
});

test('Shuffle: Person verschwindet im Lauf -> Abbruch nach Timeout', () => {
  const eng = new ShuffleEngine({ rand: () => 0.5 });
  const ev = [];
  eng.emit = (n, d) => ev.push([n, d]);
  eng.start();
  let t = 0;
  for (; t < 6000 && eng.state !== 'go'; t += 33) eng.update(t, 0);
  assert.equal(eng.state, 'go');
  for (let k = 0; k < 60; k++, t += 33) eng.update(t, null);
  assert.ok(ev.some((e) => e[0] === 'abort'));
});

test('Shuffle: nach dem Ergebnis startet die nächste Runde von selbst', () => {
  const eng = new ShuffleEngine({ rand: () => 0.5 });
  eng.start();
  let t = 0;
  for (; t < 6000 && eng.state !== 'go'; t += 33) eng.update(t, 0);
  eng.finishTrial({ valid: true, reaction_ms: 250, run_ms: 5000 });
  assert.equal(eng.state, 'hold');
  for (let k = 0; k < 150; k++, t += 33) eng.update(t, 0);
  assert.ok(['wait_center', 'countdown'].includes(eng.state));
});

test('Kalibrierung: Mitte, links, rechts werden freihändig erkannt', () => {
  const cal = new Calibrator();
  const stand = (x, ms, t0) => {
    let last;
    for (let t = t0; t < t0 + ms; t += 33) last = cal.update(t, { x, s: 70 });
    return last;
  };
  let r = stand(0.5, 2500, 0);
  assert.equal(cal.i, 1);
  r = stand(0.5, 1200, 2600); // rechts stehen bleiben darf noch nichts speichern
  assert.equal(cal.i, 1);
  stand(0.15, 2600, 4000);
  assert.equal(cal.i, 2);
  stand(0.85, 2600, 7000);
  assert.ok(cal.done);
  assert.ok(Math.abs(cal.cal.x0 - 0.5) < 0.01 && Math.abs(cal.cal.xL - 0.15) < 0.01 && Math.abs(cal.cal.xR - 0.85) < 0.01);
  const u = makeU(cal.cal);
  assert.ok(Math.abs(u(0.15) + 1) < 0.02 && Math.abs(u(0.85) - 1) < 0.02 && Math.abs(u(0.5)) < 0.02);
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
    const inp = s.r > 1.7 ? null : s; // ganz vorn an der Kamera: Pose verloren
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
  for (let k = 0; k < 60; k++, t += 33) eng.update(t, { dx: 3, r: 1 }); // weit weg und bleibt dort
  assert.equal(eng.state, 'away');
  assert.equal(ev.filter((e) => e[0] === 'command').length, 1);
});
