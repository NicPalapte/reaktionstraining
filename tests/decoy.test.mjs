import test from 'node:test';
import assert from 'node:assert/strict';
import { DecoyEngine } from '../js/decoy-engine.js';
import { CouchGame, levelParams, COUCH } from '../js/couch-engine.js';
import { commandTrajectory } from '../js/sim-trajectory.js';

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const TORSO_M = 0.5;
const OUT_M = 2.4;

/** Läufer für den Platz-Drill. behave(type) -> 'run' | 'still' */
function runDecoy({ weights, behave, n = 6, seed = 3, reactS = 0.3, commands }) {
  const ev = [];
  const eng = new DecoyEngine({ params: { weights, ...(commands ? { commands } : {}) }, rand: lcg(seed), onEvent: (name, d) => ev.push([name, d]) });
  eng.start();
  let t = 0;
  let traj = null;
  let tSig = 0;
  let seen = 0;
  const noise = lcg(seed + 9);
  for (let step = 0; step < 30 * 400 && ev.filter((e) => e[0] === 'result').length < n; step++, t += 33) {
    const s = traj ? traj.sample((t - tSig) / 1000) : { dx: 0, r: 1 };
    const inp = s.r > 1.7 || Math.abs(s.dx) * TORSO_M > OUT_M ? null : { dx: s.dx + (noise() - 0.5) * 0.06, r: s.r };
    eng.update(t, inp);
    const sig = ev.filter((e) => e[0] === 'signal');
    if (sig.length > seen) {
      seen = sig.length;
      tSig = t;
      const { type, command } = sig[sig.length - 1][1];
      traj = behave(type) === 'run' ? commandTrajectory({ command, reactS }) : null;
    }
    if (traj && (t - tSig) / 1000 > traj.endS + 0.5 && eng.state !== 'command') traj = null;
  }
  return { ev, eng, results: ev.filter((e) => e[0] === 'result').map((e) => e[1]) };
}

test('Platz-Drill: grün = loslaufen, Reaktionszeit nahe an der Wahrheit', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const { results } = runDecoy({ weights: { go: 1 }, behave: () => 'run', seed, reactS: 0.26, commands: ['left', 'right'] });
    assert.equal(results.length, 6);
    for (const r of results) {
      assert.equal(r.type, 'go');
      assert.equal(r.correct, true, JSON.stringify(r));
      assert.ok(Math.abs(r.reaction_ms - 260) < 120, `Reaktion ${r.reaction_ms}`);
    }
  }
});

test('Platz-Drill: rot = stehen bleiben ist richtig, Losrennen ist falsch', () => {
  const ok = runDecoy({ weights: { stop: 1 }, behave: () => 'still', n: 4 });
  assert.ok(ok.results.every((r) => r.type === 'stop' && r.correct), JSON.stringify(ok.results));
  assert.equal(ok.eng.stats.stop[0], 4);
  const bad = runDecoy({ weights: { stop: 1 }, behave: () => 'run', n: 3 });
  assert.ok(bad.results.every((r) => !r.correct && /Losgelaufen/.test(r.reason)), JSON.stringify(bad.results));
});

test('Platz-Drill: grün kippt auf rot – stehen bleiben ist richtig, Weiterlaufen falsch', () => {
  const ok = runDecoy({ weights: { flip: 1 }, behave: () => 'still', n: 4 });
  assert.ok(ok.ev.some((e) => e[0] === 'flip'));
  assert.ok(ok.results.every((r) => r.type === 'flip' && r.correct), JSON.stringify(ok.results));
  const bad = runDecoy({ weights: { flip: 1 }, behave: () => 'run', n: 3, reactS: 0.2 });
  assert.ok(bad.results.every((r) => !r.correct), JSON.stringify(bad.results));
});

test('Platz-Drill: Mischung – nie dreimal derselbe Typ, nach Stopp kommt wieder eine Runde', () => {
  const { eng, results } = runDecoy({ weights: { go: 0.5, stop: 0.3, flip: 0.2 }, behave: (t) => (t === 'go' ? 'run' : 'still'), n: 14, seed: 11 });
  assert.equal(results.length, 14);
  assert.ok(results.every((r) => r.correct), JSON.stringify(results.filter((r) => !r.correct)));
  const h = eng.typeHistory;
  for (let i = 2; i < h.length; i++) assert.ok(!(h[i] === h[i - 1] && h[i] === h[i - 2]), h.join());
  assert.ok(new Set(h).size >= 2);
});

// ---------- Couch-Spiel ----------
function play({ player, seed = 5, maxMs = 600000 }) {
  const ev = [];
  const g = new CouchGame({ rand: lcg(seed), onEvent: (n, d) => ev.push([n, d]) });
  g.start(0);
  let t = 0;
  let pending = null;
  for (; t < maxMs && g.state !== 'over'; t += 16) {
    g.update(t);
    const sig = ev.filter((e) => e[0] === 'signal').length;
    if (g.state === 'signal' && !pending) pending = player(g, t);
    if (g.state !== 'signal') pending = null;
    if (pending && t >= pending.at) {
      g.tap(t, pending.dir);
      pending = null;
    }
  }
  return { g, ev, t };
}

test('Couch: perfekter Spieler sammelt Punkte und steigt im Level auf', () => {
  const { g, ev } = play({
    maxMs: 120000,
    player: (g, t) => (g.type === 'go' ? { at: t + 350, dir: g.cmd } : null),
  });
  assert.ok(g.level >= 2, `Level ${g.level}`);
  assert.ok(g.score > 500);
  assert.equal(g.lives, COUCH.lives);
  const res = ev.filter((e) => e[0] === 'result').map((e) => e[1]);
  assert.ok(res.every((r) => r.ok));
  assert.ok(res.filter((r) => r.type === 'go').every((r) => Math.abs(r.reaction_ms - 350) < 40));
});

test('Couch: falsche Seite, zu langsam und Reinfallen kosten Leben, nach 3 ist Schluss', () => {
  const { g, ev } = play({ player: (g, t) => ({ at: t + 300, dir: g.cmd === 'left' ? 'right' : 'left' }) });
  assert.equal(g.state, 'over');
  assert.equal(g.lives, 0);
  const over = ev.find((e) => e[0] === 'over')[1];
  assert.equal(over.score, 0);
  const slow = play({ player: () => null });
  assert.equal(slow.g.state, 'over');
  assert.ok(slow.ev.some((e) => e[0] === 'result' && e[1].reason === 'Zu langsam'));
});

test('Couch: bei Rot oder Kippen tippen verliert, Stillhalten gewinnt', () => {
  const g = new CouchGame({ rand: () => 0.01, onEvent: () => {} });
  g.start(0);
  g.level = 5;
  let t = 0;
  for (; g.state !== 'signal'; t += 16) g.update(t);
  assert.ok(g.type === 'stop' || g.type === 'flip');
  g.tap(t, g.cmd);
  assert.equal(g.lives, COUCH.lives - 1);

  const g2 = new CouchGame({ rand: () => 0.01, onEvent: () => {} });
  g2.start(0);
  g2.level = 5;
  let res;
  g2.emit = (n, d) => n === 'result' && (res = d);
  for (t = 0; g2.state !== 'signal'; t += 16) g2.update(t);
  for (; res == null && t < 20000; t += 16) g2.update(t);
  assert.equal(res.ok, true);
  assert.equal(res.reaction_ms, null);
});

test('Couch: zu früh tippen kostet ein Leben, Level macht das Spiel schneller und täuschender', () => {
  const g = new CouchGame({ rand: lcg(1), onEvent: () => {} });
  g.start(0);
  g.update(100);
  g.tap(200, 'left');
  assert.equal(g.lives, COUCH.lives - 1);
  assert.ok(levelParams(8).timeout < levelParams(1).timeout);
  assert.ok(levelParams(1).pStop === 0 && levelParams(1).pFlip === 0);
  assert.ok(levelParams(6).pStop > 0 && levelParams(6).pFlip > 0);
});

test('Couch: Fake-Signal ignorieren ist richtig, Antippen kostet ein Leben, danach folgt oft ein echtes Go', () => {
  // ignorieren
  const ev = [];
  const g = new CouchGame({ rand: () => 0.99, onEvent: (n, d) => ev.push([n, d]) });
  g.start(0);
  g.level = 4;
  let t = 0;
  // erzwinge Fake: Zufallswert im Fake-Bereich
  const lp = levelParams(4);
  g.rand = () => lp.pStop + lp.pFlip + 0.001;
  for (; g.state !== 'signal'; t += 16) g.update(t);
  assert.equal(g.type, 'fake');
  for (; g.state === 'signal'; t += 16) g.update(t);
  const res = ev.filter((e) => e[0] === 'result').pop()[1];
  assert.equal(res.ok, true);
  assert.equal(g.lives, COUCH.lives);
  assert.ok(g.chain, 'nach dem Fake kommt als Nächstes ein echtes Go');
  g.rand = () => 0.5;
  for (; g.state !== 'signal'; t += 16) g.update(t);
  assert.equal(g.type, 'go');

  // antippen
  const g2 = new CouchGame({ rand: () => 0.5, onEvent: () => {} });
  g2.start(0);
  g2.level = 4;
  g2.rand = () => lp.pStop + lp.pFlip + 0.001;
  for (t = 0; g2.state !== 'signal'; t += 16) g2.update(t);
  g2.tap(t + 100, g2.cmd);
  assert.equal(g2.lives, COUCH.lives - 1);
  assert.ok(levelParams(1).pFake === 0 && levelParams(4).pFake > 0);
});
