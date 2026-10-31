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

/**
 * Verlauf über Trainingswochen (Krafttraining): Linie mit Punkten, x = Woche (Lücken bleiben sichtbar),
 * Phasengrenzen als feine Linien, Bestwert beschriftet. Größer ist besser, außer lowerBetter.
 * points: [{ x: Woche, v, label }], phases: [{ x: erste Woche, label }]
 */
export function drawProgress(canvas, tipEl, points, { fmt, lowerBetter = false, phases = [] } = {}) {
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
  tipEl.hidden = true;

  if (points.length < 2) {
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.fillText(points.length ? 'Ab zwei Wochen mit Werten erscheint hier der Verlauf.' : 'Noch keine Werte.', cssW / 2, cssH / 2);
    canvas.onpointermove = canvas.onpointerdown = null;
    return;
  }

  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.05, 0.5);
  lo -= pad;
  hi += pad;
  const x0 = points[0].x;
  const x1 = Math.max(points[points.length - 1].x, x0 + 1);
  const m = { l: 46, r: 14, t: 18, b: 22 };
  const w = cssW - m.l - m.r;
  const h = cssH - m.t - m.b;
  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * w;
  const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * h;

  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    ctx.beginPath();
    ctx.moveTo(m.l, Y(v));
    ctx.lineTo(cssW - m.r, Y(v));
    ctx.stroke();
    ctx.fillText(fmt(v), m.l - 6, Y(v));
  }
  // Phasengrenzen
  ctx.textAlign = 'left';
  for (const p of phases) {
    if (p.x <= x0 || p.x > x1) continue;
    const x = X(p.x - 0.5);
    ctx.beginPath();
    ctx.setLineDash([3, 4]);
    ctx.moveTo(x, m.t - 6);
    ctx.lineTo(x, m.t + h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(p.label, x + 4, m.t - 8);
  }
  ctx.textAlign = 'center';
  ctx.fillText(`W${points[0].x}`, X(x0), cssH - 8);
  ctx.fillText(`W${points[points.length - 1].x}`, X(points[points.length - 1].x), cssH - 8);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.v)) : ctx.moveTo(X(p.x), Y(p.v))));
  ctx.stroke();
  ctx.fillStyle = accent;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.v), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bestwert (bei Gleichstand der neueste)
  const target = lowerBetter ? Math.min(...vals) : Math.max(...vals);
  const bi = vals.lastIndexOf(target);
  const bp = points[bi];
  ctx.strokeStyle = surface;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(X(bp.x), Y(bp.v), 5.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  const right = X(bp.x) > m.l + w / 2;
  ctx.textAlign = right ? 'right' : 'left';
  const bx = X(bp.x) + (right ? -9 : 9);
  const by = Y(bp.v) + (Y(bp.v) > m.t + h / 2 ? -14 : 14);
  ctx.lineWidth = 5;
  ctx.strokeText(`Best ${fmt(bp.v)}`, bx, by);
  ctx.fillStyle = ink;
  ctx.fillText(`Best ${fmt(bp.v)}`, bx, by);

  const show = (ev) => {
    const px = ev.clientX - canvas.getBoundingClientRect().left;
    let p = points[0];
    for (const q of points) if (Math.abs(X(q.x) - px) < Math.abs(X(p.x) - px)) p = q;
    tipEl.hidden = false;
    tipEl.textContent = p.label;
  };
  canvas.onpointermove = show;
  canvas.onpointerdown = show;
  canvas.onpointerleave = () => (tipEl.hidden = true);
}
