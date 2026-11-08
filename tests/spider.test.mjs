import test from 'node:test';
import assert from 'node:assert/strict';
import { SpiderEngine, SPIDER_TARGETS } from '../js/spider-engine.js';
import { spiderLegTrajectory } from '../js/sim-trajectory.js';

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const OUT_M = 2.4;

/** Läufer: bei jedem Ziel einen Weg laufen. pick(target) -> Ziel, das wirklich gelaufen wird. */
function runSpider({ seed = 1, random = true, n = 1, pick = (x) => x, reactS = 0.25 } = {}) {
  const ev = [];
  const eng = new SpiderEngine({ params: { random }, rand: lcg(seed), onEvent: (name, d) => ev.push([name, d]) });
  eng.start();
  const noise = lcg(seed + 5);
  let traj = null;
  let tLeg = 0;
  let truthT = 0; // Wahrheit: Summe der Wege seit dem ersten Pfeil
  const truths = [];
  for (let t = 0; t < 120000 && ev.filter((e) => e[0] === 'result').length < n; t += 33) {
    const s = traj ? traj.sample((t - tLeg) / 1000) : { dx: 0, r: 1, m: 0 };
    const inp = s.r > 1.7 || Math.abs(s.m) > OUT_M ? null : { dx: s.dx + (noise() - 0.5) * 0.06, r: s.r + (noise() - 0.5) * 0.02 };
    const before = ev.length;
    eng.update(t, inp);
    for (const [name, d] of ev.slice(before)) {
      if (name === 'target') {
        if (d.leg === 1) truthT = 0;
        tLeg = t;
        traj = spiderLegTrajectory({ target: pick(d.target), reactS });
        // Wahrheit: Eintritt in die Mittelzone auf dem Rückweg (ohne Rauschen)
        const tr = traj;
        const inZone = (x) => {
          const q = tr.sample(x);
          return Math.abs(q.dx) <= eng.p.centerDx && q.r >= eng.p.centerLo && q.r <= eng.p.centerHi;
        };
        let x = tr.truth.centerS;
        while (x > 0 && inZone(x)) x -= 0.001;
        truthT += x * 1000;
      }
      if (name === 'result') truths.push(truthT);
      if (name === 'result' || name === 'abort') traj = null;
    }
    if (traj && (t - tLeg) / 1000 > traj.truth.centerS + 2) traj = null;
  }
  return { ev, results: ev.filter((e) => e[0] === 'result').map((e) => e[1]), truths };
}

test('Spider: klassische Reihenfolge, alle fünf Hütchen, Gesamtzeit nahe an der Wahrheit', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const { ev, results, truths } = runSpider({ seed, random: false });
    assert.equal(results.length, 1, JSON.stringify(ev.filter((e) => e[0] !== 'state')));
    const r = results[0];
    assert.equal(r.valid, true, JSON.stringify(r));
    assert.deepEqual(r.order, SPIDER_TARGETS);
    assert.equal(r.legs.length, 5);
    assert.ok(Math.abs(r.total_ms - truths[0]) < 250, `Gesamt ${r.total_ms} vs ${Math.round(truths[0])}`);
    assert.equal(r.legs.reduce((a, l) => a + l.ms, 0), r.total_ms);
  }
});

test('Spider: zufällige Reihenfolge nutzt jedes Hütchen genau einmal', () => {
  const orders = new Set();
  for (let seed = 1; seed <= 5; seed++) {
    const { results } = runSpider({ seed, random: true });
    assert.equal(results[0].valid, true, JSON.stringify(results[0]));
    assert.deepEqual([...results[0].order].sort(), [...SPIDER_TARGETS].sort());
    orders.add(results[0].order.join());
  }
  assert.ok(orders.size > 1, 'Reihenfolge ändert sich');
});

test('Spider: falsche Seite wird erkannt, danach geht es mit einem neuen Durchgang weiter', () => {
  const flip = { left: 'right', right: 'left', 'front-left': 'front-right', 'front-right': 'front-left', front: 'front' };
  const { results } = runSpider({ seed: 2, random: false, pick: (x) => flip[x] });
  assert.equal(results[0].valid, false);
  assert.equal(results[0].reason, 'Falsche Richtung');
  const two = runSpider({ seed: 3, random: false, n: 2, pick: (x) => flip[x] });
  assert.equal(two.results.length, 2, 'zweiter Durchgang startet nach der Pause');
});

test('Spider: Losrennen vor dem ersten Pfeil ist ein Fehlstart', () => {
  const ev = [];
  const eng = new SpiderEngine({ rand: lcg(1), onEvent: (n, d) => ev.push([n, d]) });
  eng.start();
  let t = 0;
  for (; eng.state !== 'countdown'; t += 33) eng.update(t, { dx: 0, r: 1 });
  for (let k = 0; k < 20; k++, t += 33) eng.update(t, { dx: -k * 0.2, r: 1 });
  assert.ok(ev.some(([n, d]) => n === 'abort' && d.reason === 'Fehlstart'));
  assert.ok(!ev.some(([n]) => n === 'target'));
});
