// Minimales Liniendiagramm auf <canvas>: Einzelwerte als Punkte, gleitender Durchschnitt als Linie,
// Bestwert direkt beschriftet, Tippen/Hovern zeigt den Wert. Kleiner ist besser (Zeiten).

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function movingAverage(values, win = 5) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - win + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/**
 * points: [{ v, label }]  (v = Wert in ms)
 * fmt: v => string
 */
export function drawChart(canvas, tipEl, points, { fmt, win = 5 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const ink = cssVar('--ink');
  const muted = cssVar('--muted');
  const grid = cssVar('--grid');
  const accent = cssVar('--ball');
  const surface = cssVar('--surface');
  ctx.font = '12px ui-rounded, system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  if (points.length < 2) {
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.fillText('Ab zwei gültigen Durchgängen erscheint hier der Verlauf.', cssW / 2, cssH / 2);
    canvas.onpointermove = canvas.onpointerdown = null;
    tipEl.hidden = true;
    return;
  }

  const vals = points.map((p) => p.v);
  const avg = movingAverage(vals, win);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 50);
  lo -= pad;
  hi += pad;
  const m = { l: 46, r: 12, t: 14, b: 22 };
  const w = cssW - m.l - m.r;
  const h = cssH - m.t - m.b;
  const X = (i) => m.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * h;

  // Raster und y-Beschriftung (leise)
  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    const y = Y(v);
    ctx.beginPath();
    ctx.moveTo(m.l, y);
    ctx.lineTo(cssW - m.r, y);
    ctx.stroke();
    ctx.fillText(fmt(v), m.l - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.fillText('älter', m.l + 14, cssH - 8);
  ctx.fillText('neuer', cssW - m.r - 14, cssH - 8);

  // Einzelwerte
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.45;
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(X(i), Y(p.v), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Gleitender Durchschnitt
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  avg.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.stroke();

  // Bestwert direkt beschriften
  const bi = vals.indexOf(Math.min(...vals));
  ctx.fillStyle = accent;
  ctx.strokeStyle = surface;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(X(bi), Y(vals[bi]), 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = bi > points.length / 2 ? 'right' : 'left';
  const bx = X(bi) + (bi > points.length / 2 ? -9 : 9);
  const by = Y(vals[bi]) + (Y(vals[bi]) > m.t + h / 2 ? 14 : -14); // weg von der Linie, Richtung freier Fläche
  ctx.lineWidth = 5;
  ctx.strokeStyle = surface;
  ctx.strokeText(`Best ${fmt(vals[bi])}`, bx, by);
  ctx.fillText(`Best ${fmt(vals[bi])}`, bx, by);

  // Tippen / Hovern: nächster Punkt
  const show = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    let best = 0;
    let bd = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(X(i) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const p = points[best];
    tipEl.hidden = false;
    tipEl.textContent = `${p.label}: ${fmt(p.v)}  (Ø ${win}: ${fmt(avg[best])})`;
  };
  canvas.onpointermove = show;
  canvas.onpointerdown = show;
  canvas.onpointerleave = () => (tipEl.hidden = true);
}
