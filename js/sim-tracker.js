// Simulierter Tracker für Tests ohne Kamera: App mit ?sim=1 öffnen.
// Gleiche Schnittstelle wie PoseTracker. Per Schieberegler (oder Auto-Athlet) bewegen.

import { shuffleTrajectory, commandTrajectory } from './sim-trajectory.js';

const VW = 1280;
const VH = 720;
const S0 = 70; // Rumpflänge in Pixeln bei r = 1
const U_WIDTH = 0.35; // u = 1 entspricht 35 % der Bildbreite

export class SimTracker {
  constructor() {
    this.onSample = () => {};
    this.u = 0;
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
      this.u = v.u;
      this.r = v.r;
      if (rel > this.anim.endS) this.anim = null;
    }
    this.onSample(now, this.sample());
  }

  sample() {
    if (!this.present || this.r > 1.7) return null;
    const x = 0.5 + this.u * U_WIDTH;
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

  setU(u) {
    this.u = u;
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
        if (t <= traj.endS + 0.4) return { u: traj.u(t), r: 1 };
        const k = Math.min(1, (t - traj.endS - 0.4) / back);
        return { u: traj.u(traj.endS) * (1 - ease(k)), r: 1 };
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
        // dx in Rumpflängen -> u-Einheiten
        return { u: (s.dx * S0) / (VW * U_WIDTH), r: s.r };
      },
    };
  }

  /** Stellt sich nacheinander auf Mitte, links, rechts (für Tests). */
  autoCalibrate(steps) {
    const seq = steps.map((s) => (s === 'center' ? 0 : s === 'left' ? -1 : 1));
    let i = 0;
    const go = () => {
      if (i > seq.length) return;
      this.setU(i < seq.length ? seq[i] : 0); // zum Schluss zurück in die Mitte
      i += 1;
      setTimeout(go, 2900);
    };
    go();
  }
}
