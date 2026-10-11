// Freihändige Kalibrierung: Die Person stellt sich auf die Mittellinie und bleibt kurz still.
// Das Gerät steht dabei 4-6 m entfernt, deshalb gibt es keine Tasten, nur automatische Übernahme.

import { range } from './util.js';

export class Calibrator {
  constructor({ holdMs = 1500, range: r = 0.025 } = {}) {
    this.holdMs = holdMs;
    this.rangeMax = r;
    this.win = [];
    this.done = false;
    this.captured = null;
    this.cal = null;
  }

  /** s = { x, s, vh } (x normiert und gespiegelt, s = Rumpflänge in Pixeln, vh = Bildhöhe in Pixeln) oder null. */
  update(t, s) {
    const base = { progress: 0, captured: false, done: this.done };
    if (this.done) return { ...base, progress: 1, hint: 'Fertig.', cal: this.cal };
    if (!s) {
      this.win = [];
      return { ...base, hint: 'Ich sehe dich nicht. Stell dich ganz ins Bild.' };
    }
    this.win.push({ t, x: s.x, s: s.s });
    if (range(this.win.map((w) => w.x)) > this.rangeMax) this.win = [{ t, x: s.x, s: s.s }];
    const progress = Math.min(1, (t - this.win[0].t) / this.holdMs);
    if (progress < 1) return { ...base, progress, hint: 'Stell dich auf die Mittellinie und bleib kurz still.' };

    const mean = (k) => this.win.reduce((a, w) => a + w[k], 0) / this.win.length;
    this.captured = { x: mean('x'), s: mean('s') };
    this.done = true;
    this.cal = { x0: this.captured.x, s0: this.captured.s, warning: warn(this.captured, s.vh) };
    return { ...base, progress: 1, captured: true, done: true, hint: 'Gespeichert.', cal: this.cal };
  }
}

function warn(c, vh) {
  if (c.x < 0.3 || c.x > 0.7) return 'Das Gerät steht nicht mittig vor der Mittellinie. Stell es genau davor, damit du zu beiden Seiten gleich lange im Bild bleibst.';
  if (vh && c.s / vh < 0.045) return 'Du bist sehr klein im Bild. Stell das Gerät etwas näher oder nutze das Hochformat.';
  return null;
}

/** Pose-Probe -> Eingabe der Zustandsmaschinen (Rumpflängen von der Mitte, Abstandsverhältnis). */
export function makeSample(cal) {
  return (s) => ({ dx: ((s.x - cal.x0) * s.vw) / cal.s0, r: s.s / cal.s0 });
}
