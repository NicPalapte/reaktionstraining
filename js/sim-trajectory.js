// Künstliche Läufe für Tests und den Simulationsmodus (?sim=1).
// Positionen in u-Einheiten: 0 = Mitte, -1/+1 = Linien.

/** Trapezprofil über Strecke D (Beschleunigen, ggf. Konstantfahrt, Bremsen). */
export function trapezoid(D, a, vmax) {
  const tacc = vmax / a;
  const dacc = 0.5 * a * tacc * tacc;
  if (2 * dacc >= D) {
    const th = Math.sqrt(D / a);
    return {
      T: 2 * th,
      pos: (t) => (t <= 0 ? 0 : t >= 2 * th ? D : t < th ? 0.5 * a * t * t : D - 0.5 * a * (2 * th - t) ** 2),
    };
  }
  const cruise = (D - 2 * dacc) / vmax;
  const T = 2 * tacc + cruise;
  return {
    T,
    pos: (t) => {
      if (t <= 0) return 0;
      if (t >= T) return D;
      if (t < tacc) return 0.5 * a * t * t;
      if (t < tacc + cruise) return dacc + vmax * (t - tacc);
      return D - 0.5 * a * (T - t) ** 2;
    },
  };
}

/**
 * 5-10-5-Lauf. Rückgabe: u(tRel) mit tRel = Sekunden seit dem Pfeil, plus Wahrheitswerte.
 * dir = -1 links, +1 rechts.
 */
export function shuffleTrajectory({ dir, reactS = 0.28, halfRangeM = 4.57, a = 9, vmax = 6.5, dwell = 0.12, overshoot = 0.8 }) {
  const legA = trapezoid(halfRangeM, a, vmax); // 0 -> 1
  const legB = trapezoid(2 * halfRangeM, a, vmax); // 1 -> -1
  const legC = trapezoid((1 + overshoot) * halfRangeM, a, vmax); // -1 -> +overshoot
  const t1 = reactS;
  const t2 = t1 + legA.T + dwell;
  const t3 = t2 + legB.T + dwell;
  const t4 = t3 + legC.T;
  const u = (t) => {
    if (t <= t1) return 0;
    if (t <= t1 + legA.T) return dir * (legA.pos(t - t1) / halfRangeM);
    if (t <= t2) return dir;
    if (t <= t2 + legB.T) return dir * (1 - legB.pos(t - t2) / halfRangeM);
    if (t <= t3) return -dir;
    if (t <= t4) return dir * (-1 + legC.pos(t - t3) / halfRangeM);
    return dir * overshoot;
  };
  // Zeitpunkt, an dem die letzte Etappe die Mitte (u = 0) erreicht.
  let lo = t3;
  let hi = t4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (-u(mid) * dir > 0) lo = mid;
    else hi = mid;
  }
  const finishS = (lo + hi) / 2;
  return { u, endS: t4, truth: { reactS, finishS, runS: finishS - reactS, turnAS: t1 + legA.T, turnBS: t2 + legB.T } };
}

/** Befehlslauf: weg von der Mitte und zurück. Rückgabe {dx, r} (dx in Rumpflängen). */
export function commandTrajectory({ command, reactS = 0.3, distanceM = 3.5, torsoM = 0.5, a = 7, vmax = 5, pause = 0.3 }) {
  const leg = trapezoid(distanceM, a, vmax);
  const t1 = reactS;
  const t2 = t1 + leg.T + pause;
  const t3 = t2 + leg.T;
  const d = (t) => {
    if (t <= t1) return 0;
    if (t <= t1 + leg.T) return leg.pos(t - t1);
    if (t <= t2) return distanceM;
    if (t <= t3) return distanceM - leg.pos(t - t2);
    return 0;
  };
  const sample = (t) => {
    const m = d(t);
    if (command === 'front') return { dx: 0, r: 5 / Math.max(1.5, 5 - m) };
    return { dx: ((command === 'left' ? -1 : 1) * m) / torsoM, r: 1 };
  };
  return { sample, endS: t3 };
}
