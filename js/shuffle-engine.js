// Zustandsmaschine für die 5-10-5-Shuffle-Übung (nur Mittellinie, Hochformat).
//
// Eingabe pro Kamerabild: update(t, s)
//   t = Zeitstempel in ms
//   s = { dx, r } oder null (keine Person im Bild)
//   dx = seitliche Abweichung von der Mitte in Rumpflängen (rechts positiv, aus Sicht der Person)
//   r  = aktuelle Rumpflänge im Bild / Rumpflänge bei der Kalibrierung
//
// Ablauf: Mitte -> Pfeil -> Seite A (aus dem Bild) -> 1. Querung der Mitte -> Seite B (aus dem Bild)
//         -> 2. Querung der Mitte = Ziel.
// Reaktionszeit = Pfeil bis Bewegungsbeginn, Laufzeit = Bewegungsbeginn bis 2. Querung.
// Eine Rumpflänge entspricht ca. 0,5 m.

import { Ring, median, regress, range } from './util.js';

export const SHUFFLE_DEFAULTS = {
  readyDx: 1.0, // "in der Mitte": innerhalb von ca. 0,5 m
  readyLo: 0.8, // und etwa im kalibrierten Abstand zur Kamera
  readyHi: 1.25,
  stableMs: 1000,
  stableRange: 0.5, // maximale Schwankung währenddessen (Rumpflängen)
  minDelayMs: 1500, // zufällige Wartezeit bis zum Pfeil
  maxDelayMs: 3500,
  falseStartDx: 2.7, // Bewegung vor dem Pfeil = Fehlstart
  restThreshold: 0.25, // darunter gilt als "noch in Ruhe"
  fitLow: 0.4, // Fenster für die Schätzung des Bewegungsbeginns
  onsetFit: 1.0, // ab hier gilt der Start als erkannt (Schätzung erfolgt rückwirkend)
  minReactionMs: 100, // schneller ist nicht reaktiv, sondern geraten
  reactTimeoutMs: 4000,
  awayDx: 3.0, // so weit (ca. 1,5 m) musst du auf jeder Seite von der Mitte weg gewesen sein
  lossSideDx: 0.5,
  lossSideMs: 300, // so lange muss die Person fehlen, bevor das Verschwinden als "Seite erreicht" zählt // Verschwindest du ab hier aus dem Bild, zählt das als "auf dieser Seite"
  finishZone: 0.8, // Zielzone um die Mitte
  maxExtrapolateMs: 300,
  runTimeoutMs: 15000,
  lostPoseMs: 1000, // vor dem Start darf die Person nicht so lange fehlen
  lostRunMs: 8000, // im Lauf ist Fehlen normal (außerhalb des Bildes)
  minRunMs: 2500,
  maxRunMs: 15000,
  resultHoldMs: 3500,
  noticeMs: 2500,
  gapMs: 150, // länger ohne Person im Bild = Lücke (nicht darüber hinweg interpolieren)
};

const RUN = ['to_a', 'to_b', 'return'];

export class ShuffleEngine {
  constructor({ params = {}, rand = Math.random, onEvent = () => {} } = {}) {
    this.p = { ...SHUFFLE_DEFAULTS, ...params };
    this.rand = rand;
    this.emit = onEvent;
    this.buf = new Ring(4000);
    this.state = 'idle';
    this.lastDirs = [];
    this.t = 0;
    this.clear();
  }

  clear() {
    this.readySince = null;
    this.lostSince = null;
    this.lastDx = null;
    this.lastVisT = null;
    this.segStartT = null;
    this.dir = 0;
    this.tArrow = null;
    this.tOnset = null;
    this.tCross = null;
    this.planned = null;
    this.dxStart = 0;
    this.ref = 0;
    this.excA = false;
    this.holdUntil = null;
  }

  setState(s) {
    this.state = s;
    this.emit('state', { state: s });
  }

  start() {
    this.buf.clear();
    this.clear();
    this.setState('wait_center');
  }

  stop() {
    this.clear();
    this.setState('idle');
  }

  /** Die UI meldet, wann der Pfeil tatsächlich sichtbar war (genauer als der Bildzeitstempel). */
  confirmArrow(tPaint) {
    if (this.state === 'go' && tPaint > this.tArrow && tPaint - this.tArrow < 200) this.tArrow = tPaint;
  }

  update(t, s) {
    this.t = t;
    const p = this.p;
    if (this.state === 'idle') return;
    if (this.state === 'hold') {
      if (t >= this.holdUntil) {
        this.buf.clear();
        this.clear();
        this.setState('wait_center');
      }
      return;
    }
    if (RUN.includes(this.state) && t - this.tOnset > p.runTimeoutMs) {
      return this.abort(this.timeoutReason());
    }
    if (s == null) {
      if (this.lostSince == null) {
        this.lostSince = t;
        this.onLossStart();
      }
      this.readySince = null;
      if (t - this.lostSince >= p.lossSideMs) this.lossSideCheck();
      const inRun = RUN.includes(this.state);
      if ((inRun || this.state === 'countdown' || this.state === 'go') && t - this.lostSince > (inRun ? p.lostRunMs : p.lostPoseMs)) {
        this.abort('Person nicht mehr erkannt');
      }
      return;
    }
    this.lostSince = null;
    this.lastDx = s.dx;
    if (this.lastVisT == null || t - this.lastVisT > p.gapMs) this.segStartT = t; // neuer zusammenhängender Abschnitt
    this.lastVisT = t;
    this.buf.push(t, s.dx);
    switch (this.state) {
      case 'wait_center':
        return this.onWait(t, s);
      case 'countdown':
        if (Math.abs(s.dx - this.dxStart) > p.falseStartDx) return this.abort('Fehlstart');
        if (t >= this.planned) this.fire(t);
        return;
      case 'go':
        return this.onGo(t, s.dx);
      case 'to_a': {
        const away = s.dx * this.dir;
        if (away >= p.awayDx) this.excA = true;
        if (this.excA && away <= 0) {
          // 1. Querung der Mitte: von der Pfeilseite kommend
          this.tCross = this.cross((v) => v * this.dir, 0);
          this.setState('to_b');
        }
        return;
      }
      case 'to_b':
        if (-s.dx * this.dir >= p.awayDx) this.setState('return');
        return;
      case 'return':
        if (-s.dx * this.dir <= p.finishZone) this.onFinish();
        return;
      default:
    }
  }

  timeoutReason() {
    if (this.state === 'to_a') return this.excA ? 'Mitte nicht gequert' : 'Zu kurz gelaufen';
    return 'Gegenseite nicht erreicht';
  }

  /** Aus dem Bild verschwunden: Seite aus der letzten Position ableiten. */
  onLossStart() {
    const dx = this.lastDx;
    if (this.state === 'go' && dx != null && (dx - this.ref) * this.dir >= 0.6) {
      // Aus dem Bild gelaufen, bevor der Start erkannt wurde: Start aus den letzten Bildern schätzen
      const tl = this.lastVisT;
      this.estimateOnset(tl);
      const reaction = this.tOnset - this.tArrow;
      if (reaction < this.p.minReactionMs) {
        return this.finishTrial({ valid: false, reason: 'Zu früh gestartet', reaction_ms: Math.round(reaction), run_ms: null });
      }
      this.setState('to_a');
      if (Math.abs(dx) >= this.p.lossSideDx) this.excA = true;
      return;
    }
  }

  /** Fehlt die Person länger als lossSideMs, gilt die zuletzt gesehene Seite als erreicht. */
  lossSideCheck() {
    const dx = this.lastDx;
    if (dx == null || Math.abs(dx) < this.p.lossSideDx) return;
    const side = Math.sign(dx);
    if (this.state === 'to_a' && side === this.dir) this.excA = true;
    else if (this.state === 'to_b' && side === -this.dir) this.setState('return');
  }

  onWait(t, s) {
    const p = this.p;
    const ready = Math.abs(s.dx) <= p.readyDx && s.r >= p.readyLo && s.r <= p.readyHi;
    if (!ready) {
      this.readySince = null;
      return;
    }
    if (this.readySince == null) this.readySince = t;
    if (t - this.readySince < p.stableMs) return;
    const vals = this.buf.since(t - p.stableMs).map((i) => i.v);
    if (range(vals) > p.stableRange) return;
    this.dxStart = median(vals);
    this.planned = t + p.minDelayMs + this.rand() * (p.maxDelayMs - p.minDelayMs);
    this.setState('countdown');
  }

  fire(t) {
    let dir = this.rand() < 0.5 ? -1 : 1;
    const l = this.lastDirs;
    if (l.length >= 2 && l[l.length - 1] === l[l.length - 2] && l[l.length - 1] === dir) dir = -dir;
    this.lastDirs.push(dir);
    this.dir = dir;
    this.tArrow = t;
    this.ref = median(this.buf.since(t - 300).map((i) => i.v));
    this.excA = false;
    this.setState('go');
    this.emit('arrow', { dir, direction: dir < 0 ? 'left' : 'right' });
  }

  onGo(t, dx) {
    const p = this.p;
    const d = (dx - this.ref) * this.dir;
    if (d <= -p.onsetFit) {
      return this.finishTrial({ valid: false, reason: 'Falsche Richtung', reaction_ms: null, run_ms: null });
    }
    if (d >= p.onsetFit) {
      this.estimateOnset(t);
      const reaction = this.tOnset - this.tArrow;
      if (reaction < p.minReactionMs) {
        return this.finishTrial({ valid: false, reason: 'Zu früh gestartet', reaction_ms: Math.round(reaction), run_ms: null });
      }
      this.setState('to_a');
      return;
    }
    if (t - this.tArrow > p.reactTimeoutMs) this.abort('Keine Reaktion');
  }

  /**
   * Bewegungsbeginn schätzen. Bei konstanter Beschleunigung gilt d = a/2 * (t - t0)^2,
   * also ist sqrt(d) linear in t. Der Schnittpunkt mit der Zeitachse ist t0.
   * Fällt die Schätzung aus, wird das letzte Bild in Ruhe verwendet.
   */
  estimateOnset(t) {
    const p = this.p;
    const ds = this.buf.items
      .filter((i) => i.t <= t && i.t >= this.tArrow - 1000)
      .map((i) => ({ t: i.t, d: (i.v - this.ref) * this.dir }));
    let idx = -1;
    for (let i = ds.length - 1; i >= 0; i--) {
      if (ds[i].d <= p.restThreshold) {
        idx = i;
        break;
      }
    }
    const lastRest = idx >= 0 ? ds[idx].t : ds[0].t;
    const fallback = idx >= 0 && idx < ds.length - 1 ? (ds[idx].t + ds[idx + 1].t) / 2 : lastRest;
    const fit = ds.filter((x, i) => i > idx && x.d >= p.fitLow && x.d <= p.onsetFit + 0.9);
    let tOnset = fallback;
    if (fit.length >= 3) {
      const { k, mx, my } = regress(
        fit.map((x) => x.t),
        fit.map((x) => Math.sqrt(x.d)),
      );
      if (k > 0) tOnset = Math.min(t, Math.max(lastRest - 150, mx - my / k));
    }
    this.tOnset = tOnset;
  }

  /** Zeitpunkt, an dem fn(dx) den Wert level erreicht, linear zwischen den letzten zwei sichtbaren Bildern
   *  (auch über eine kurze Lücke hinweg). */
  cross(fn, level) {
    const it = this.buf.items;
    const b = it[it.length - 1];
    const a = it[it.length - 2];
    if (!a || b.t - a.t > this.p.gapMs) return b.t; // keine Interpolation über Lücken
    const fa = fn(a.v);
    const fb = fn(b.v);
    if (fb === fa) return b.t;
    const f = Math.min(1, Math.max(0, (level - fa) / (fb - fa)));
    return a.t + f * (b.t - a.t);
  }

  onFinish() {
    const p = this.p;
    const fn = (v) => -v * this.dir;
    const it = this.buf.items;
    const b = it[it.length - 1];
    const a = it[it.length - 2];
    const direct = a && b.t - a.t <= p.gapMs && fn(a.v) > p.finishZone;
    let tLine;
    if (direct) {
      // Der Eintritt in die Zielzone liegt genau zwischen zwei aufeinanderfolgenden Bildern.
      if (fn(b.v) <= 0) {
        tLine = this.cross(fn, 0);
      } else {
        const tZone = this.cross(fn, p.finishZone);
        const last = it.filter((i) => i.t >= this.segStartT).slice(-4); // nur Bilder seit dem Wiederauftauchen
        const { k } = regress(
          last.map((i) => i.t),
          last.map((i) => fn(i.v)),
        );
        const vel = -k; // Annäherung an die Mitte pro ms
        const ext = vel > 1e-5 ? Math.min(p.finishZone / vel, p.maxExtrapolateMs) : 0;
        tLine = tZone + ext;
      }
    } else {
      // Die Person wurde erst in oder hinter der Zielzone wiedererkannt (z. B. am Bildrand zu spät).
      // Der Durchgang liegt vor dem ersten Bild: aus den ersten Bildern des Abschnitts zurückrechnen.
      const seg = it.filter((i) => i.t >= this.segStartT);
      if (seg.length < 4) return; // noch zu wenige Bilder für eine Geschwindigkeit
      const first = seg.slice(0, 4);
      const { k, mx, my } = regress(
        first.map((i) => i.t),
        first.map((i) => fn(i.v)),
      );
      tLine = k < 0 ? Math.max(first[0].t - 400, mx - my / k) : first[0].t;
    }
    const run = tLine - this.tOnset;
    const reaction = this.tOnset - this.tArrow;
    let valid = true;
    let reason = null;
    if (run < p.minRunMs) {
      valid = false;
      reason = 'Zeit unplausibel kurz';
    } else if (run > p.maxRunMs) {
      valid = false;
      reason = 'Zeit unplausibel lang';
    }
    this.finishTrial({
      valid,
      reason,
      reaction_ms: Math.round(reaction),
      run_ms: Math.round(run),
      total_ms: Math.round(reaction) + Math.round(run), // Pfeil bis Ziel
      split_a_ms: Math.round(this.tCross - this.tOnset), // bis zur 1. Querung der Mitte
      split_b_ms: null,
    });
  }

  finishTrial(res) {
    const result = {
      direction: this.dir < 0 ? 'left' : 'right',
      split_a_ms: null,
      split_b_ms: null,
      total_ms: null,
      ...res,
    };
    this.emit('result', result);
    this.hold(this.p.resultHoldMs);
  }

  abort(reason) {
    this.emit('abort', { reason });
    this.hold(this.p.noticeMs);
  }

  hold(ms) {
    this.holdUntil = this.t + ms;
    this.setState('hold');
  }
}
