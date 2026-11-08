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

/**
 * Ein Weg beim Spider-Drill: von der Mitte zum Hütchen und zurück. Rückgabe {dx, r} wie commandTrajectory.
 * Das Gerät steht camM vor der Mitte; "vorne" heißt näher ans Gerät (r wächst), dx wächst mit der Nähe mit.
 * truth.centerS = Zeitpunkt, an dem die Person wieder in der Mitte ist.
 */
export function spiderLegTrajectory({ target, reactS = 0.25, radiusM = 3, camM = 6, torsoM = 0.5, a = 7, vmax = 5, dwell = 0.15 }) {
  const ang = { left: Math.PI, 'front-left': (3 * Math.PI) / 4, front: Math.PI / 2, 'front-right': Math.PI / 4, right: 0 }[target];
  const leg = trapezoid(radiusM, a, vmax);
  const t1 = reactS;
  const t2 = t1 + leg.T + dwell;
  const t3 = t2 + leg.T;
  const d = (t) => (t <= t1 ? 0 : t <= t1 + leg.T ? leg.pos(t - t1) : t <= t2 ? radiusM : t <= t3 ? radiusM - leg.pos(t - t2) : 0);
  const sample = (t) => {
    const m = d(t);
    const lat = Math.cos(ang) * m;
    const fwd = Math.sin(ang) * m;
    const r = camM / Math.max(0.8, camM - fwd);
    return { dx: (lat / torsoM) * r, r, m: lat };
  };
  return { sample, endS: t3, truth: { centerS: t3 } };
}

/**
 * Lauf mit Abbremsen: nach reactS seitlich beschleunigen, brakeAtS Sekunden nach dem Start der Bremsung
 * (Reaktion auf "STOPP" eingerechnet) mit decel abbremsen, stehen bleiben, nach holdS zurück in die Mitte.
 * tBrake wird gesetzt, sobald das Stopp-Signal kommt (setBrake). Rückgabe {dx, r}.
 */
export function brakeTrajectory({ dir, reactS = 0.28, brakeReactS = 0.2, a = 6, vmax = 4.5, decel = 8, holdS = 1.2, torsoM = 0.5 }) {
  let tBrake = null;
  const free = (t) => {
    const tt = Math.max(0, t - reactS);
    const tacc = vmax / a;
    return tt < tacc ? { x: 0.5 * a * tt * tt, v: a * tt } : { x: 0.5 * a * tacc * tacc + vmax * (tt - tacc), v: vmax };
  };
  const pos = (t) => {
    if (tBrake == null || t <= tBrake + brakeReactS) return free(t).x;
    const tb = tBrake + brakeReactS;
    const { x, v } = free(tb);
    const ts = v / decel;
    const dt = t - tb;
    if (dt <= ts) return x + v * dt - 0.5 * decel * dt * dt;
    const xs = x + (v * v) / (2 * decel);
    const back = dt - ts - holdS;
    return back <= 0 ? xs : Math.max(0, xs - 2 * back);
  };
  return {
    setBrake: (t) => (tBrake ??= t),
    sample: (t) => ({ dx: (dir * pos(t)) / torsoM, r: 1 }),
    truth: () => {
      const tb = tBrake + brakeReactS;
      const { v } = free(tb);
      return { stopS: tb + v / decel, distM: pos(tb + v / decel + 0.01) - free(tBrake).x };
    },
  };
}
