// Simulierter Tracker für Tests ohne Kamera: App mit ?sim=1 öffnen.
// Gleiche Schnittstelle wie PoseTracker. Per Schieberegler (oder Auto-Athlet) bewegen.

import { shuffleTrajectory, commandTrajectory, spiderLegTrajectory, brakeTrajectory } from './sim-trajectory.js';

// Hochformat: 720 x 1280 Pixel, 5 m Bildbreite auf Höhe der Person, Rumpflänge 0,5 m = 72 Pixel.
const VW = 720;
const VH = 1280;
const S0 = 72; // Rumpflänge in Pixeln bei r = 1
const VIEW_M = 5; // sichtbare Breite in Metern
const OUT_M = 2.4; // ab hier ist die Person nicht mehr (ganz) im Bild
const HALF_RANGE_M = 4.57; // eine Seite beim 5-10-5

export class SimTracker {
  constructor() {
    this.onSample = () => {};
    this.m = 0; // seitliche Position in Metern (rechts positiv)
    this.r = 1;
    this.present = true;
    this.anim = null; // { fn(tRelS) -> {u, r}, t0, endS }
    this.timer = null;
  }

  async start(video, onStatus = () => {}) {
    onStatus('Simulationsmodus');
    this.video = video;
    this.timer = setInterval(() => this.tick(), 1000 / 30);
  }

  stop() {
    clearInterval(this.timer);
  }

  tick() {
    const now = performance.now();
    if (this.anim) {
      const rel = (now - this.anim.t0) / 1000;
      const v = this.anim.fn(rel);
      this.m = v.m;
      this.r = v.r;
      if (rel > this.anim.endS) this.anim = null;
    }
    this.onSample(now, this.sample());
  }

  sample() {
    if (!this.present || this.r > 1.7 || Math.abs(this.m) > OUT_M) return null;
    const x = 0.5 + this.m / VIEW_M;
    const s = S0 * this.r;
    const y = 0.5;
    const th = (s / VH) * 0.5;
    const pts = [
      { x: x - 0.02, y: y - th },
      { x: x + 0.02, y: y - th },
      { x: x - 0.015, y: y + th },
      { x: x + 0.015, y: y + th },
      { x, y: y - th * 1.9 },
    ];
    return { x, y, s, vw: VW, vh: VH, pts };
  }

  /** Position in Metern setzen (Schieberegler). */
  setM(m) {
    this.m = m;
    this.anim = null;
  }

  /** Läuft nach dem Pfeil automatisch einen 5-10-5-Lauf. */
  runShuffle(dir, { reactS = 0.28 } = {}) {
    const traj = shuffleTrajectory({ dir, reactS });
    const back = 1.6; // danach locker zurück in die Mitte gehen
    const ease = (x) => x * x * (3 - 2 * x);
    this.anim = {
      t0: performance.now(),
      endS: traj.endS + 0.4 + back,
      fn: (t) => {
        if (t <= traj.endS + 0.4) return { m: traj.u(t) * HALF_RANGE_M, r: 1 };
        const k = Math.min(1, (t - traj.endS - 0.4) / back);
        return { m: traj.u(traj.endS) * HALF_RANGE_M * (1 - ease(k)), r: 1 };
      },
    };
  }

  runCommand(command) {
    const traj = commandTrajectory({ command });
    this.anim = {
      t0: performance.now(),
      endS: traj.endS + 0.3,
      fn: (t) => {
        const s = traj.sample(t);
        return { m: s.dx * 0.5, r: s.r }; // Rumpflängen -> Meter
      },
    };
  }

  /** Spider: ein Weg zum Hütchen und zurück. */
  runSpiderLeg(target) {
    const traj = spiderLegTrajectory({ target, reactS: 0.2 + Math.random() * 0.15 });
    this.anim = { t0: performance.now(), endS: traj.endS + 0.2, fn: (t) => ({ m: traj.sample(t).m, r: traj.sample(t).r }) };
  }

  /** Stopp-Drill: loslaufen, auf brake() abbremsen, danach zurück in die Mitte. */
  runBrake(command) {
    const traj = brakeTrajectory({ dir: command === 'left' ? -1 : 1, reactS: 0.25 + Math.random() * 0.1, brakeReactS: 0.15 + Math.random() * 0.1 });
    const t0 = performance.now();
    this.brakeTraj = { traj, t0 };
    this.anim = { t0, endS: 8, fn: (t) => ({ m: traj.sample(t).dx * 0.5, r: 1 }) };
  }

  brake() {
    const b = this.brakeTraj;
    if (b) b.traj.setBrake((performance.now() - b.t0) / 1000);
  }

  /** Steht für die Kalibrierung in der Mitte (für Tests). */
  autoCalibrate() {
    this.setM(0);
  }
}
