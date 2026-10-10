// Freihändige Kalibrierung: Die Person stellt sich nacheinander an die Mitte,
// die linke und die rechte Linie und bleibt dort kurz still. Das Gerät steht dabei
// 4-6 m entfernt, deshalb gibt es keine Tasten, nur automatische Übernahme.

import { range } from './util.js';

const HINTS = {
  center: 'Stell dich auf die Mittellinie und bleib kurz still.',
  left: 'Geh zur linken Linie und bleib kurz still.',
  right: 'Geh zur rechten Linie und bleib kurz still.',
};

export class Calibrator {
  constructor({ steps = ['center', 'left', 'right'], holdMs = 1500, range: r = 0.025, minSep = 0.1, pauseMs = 900 } = {}) {
    this.steps = steps;
    this.holdMs = holdMs;
    this.rangeMax = r;
    this.minSep = minSep;
    this.pauseMs = pauseMs;
    this.i = 0;
    this.win = [];
    this.pauseUntil = 0;
    this.acc = {};
    this.done = false;
  }

  /** s = { x, s } (x normiert und gespiegelt, s = Rumpflänge in Pixeln) oder null. */
  update(t, s) {
    const step = this.steps[this.i];
    const base = { step, index: this.i, total: this.steps.length, progress: 0, captured: false, done: this.done };
    if (this.done) return { ...base, hint: 'Fertig.', cal: this.cal };
    if (t < this.pauseUntil) return { ...base, hint: 'Gespeichert.', progress: 1 };
    if (!s) {
      this.win = [];
      return { ...base, hint: 'Ich sehe dich nicht. Stell dich ganz ins Bild.' };
    }
    const x0 = this.acc.center?.x;
    if (step === 'left' && s.x > x0 - this.minSep) {
      this.win = [];
      return { ...base, hint: 'Weiter nach links, bis zur linken Linie.' };
    }
    if (step === 'right' && s.x < x0 + this.minSep) {
      this.win = [];
      return { ...base, hint: 'Weiter nach rechts, bis zur rechten Linie.' };
    }
    this.win.push({ t, x: s.x, s: s.s });
    if (range(this.win.map((w) => w.x)) > this.rangeMax) {
      this.win = [{ t, x: s.x, s: s.s }];
    }
    const progress = Math.min(1, (t - this.win[0].t) / this.holdMs);
    if (progress < 1) return { ...base, progress, hint: HINTS[step] };

    const xs = this.win.map((w) => w.x);
    const ss = this.win.map((w) => w.s);
    this.acc[step] = { x: xs.reduce((a, b) => a + b, 0) / xs.length, s: ss.reduce((a, b) => a + b, 0) / ss.length };
    this.win = [];
    this.i += 1;
    this.pauseUntil = t + this.pauseMs;
    if (this.i >= this.steps.length) {
      this.done = true;
      this.cal = {
        x0: this.acc.center.x,
        s0: this.acc.center.s,
        xL: this.acc.left?.x ?? null,
        xR: this.acc.right?.x ?? null,
      };
      this.cal.warning = edgeWarning(this.cal);
    }
    return { ...base, progress: 1, captured: true, done: this.done, hint: 'Gespeichert.', cal: this.cal };
  }
}

function edgeWarning(cal) {
  if (cal.xL != null && cal.xL < 0.05) return 'Die linke Linie liegt fast am Bildrand. Stell das Gerät weiter weg oder nutze das Querformat.';
  if (cal.xR != null && cal.xR > 0.95) return 'Die rechte Linie liegt fast am Bildrand. Stell das Gerät weiter weg oder nutze das Querformat.';
  return null;
}

/** x (normiert, gespiegelt) -> u: Mitte 0, linke Linie -1, rechte Linie +1. */
export function makeU(cal) {
  return (x) => (x >= cal.x0 ? (x - cal.x0) / (cal.xR - cal.x0) : (x - cal.x0) / (cal.x0 - cal.xL));
}

/** Pose-Probe -> Eingabe der Befehls-Zustandsmaschine. */
export function makeCommandSample(cal) {
  return (s) => ({ dx: ((s.x - cal.x0) * s.vw) / cal.s0, r: s.s / cal.s0 });
}
