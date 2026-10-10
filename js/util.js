// Kleine Hilfsfunktionen ohne Abhängigkeiten.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);

/** Lineare Regression y = k * (x - mx) + my. */
export function regress(xs, ys) {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  return { k: sxx > 0 ? sxy / sxx : 0, mx, my };
}

/** Ringpuffer der letzten maxMs Millisekunden: Einträge {t, v}. */
export class Ring {
  constructor(maxMs) {
    this.maxMs = maxMs;
    this.items = [];
  }
  push(t, v) {
    this.items.push({ t, v });
    while (this.items.length && t - this.items[0].t > this.maxMs) this.items.shift();
  }
  since(t0) {
    return this.items.filter((i) => i.t >= t0);
  }
  clear() {
    this.items.length = 0;
  }
}

export const range = (vals) => (vals.length ? Math.max(...vals) - Math.min(...vals) : Infinity);
