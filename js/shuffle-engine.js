// Zustandsmaschine für die 5-10-5-Shuffle-Übung.
//
// Eingabe pro Kamerabild: update(t, u)
//   t = Zeitstempel in ms, u = normierte Position (null = keine Person erkannt)
//   u = 0 ist die Mitte, u = -1 die linke Linie, u = +1 die rechte Linie
//   (links/rechts aus Sicht der Person, die zur Kamera schaut).
//
// Ablauf: Mitte -> Pfeil -> Seite A -> Seite B (über die Mitte) -> Mitte (Ziel).
// Reaktionszeit = Pfeil bis Bewegungsbeginn, Laufzeit = Bewegungsbeginn bis Ziel.

import { Ring, median, regress } from './util.js';

export const SHUFFLE_DEFAULTS = {
  centerZone: 0.2, // |u| darunter gilt als "in der Mitte"
  stableMs: 1000, // so lange ruhig in der Mitte stehen
  stableRange: 0.08, // maximale Schwankung währenddessen
  minDelayMs: 1500, // zufällige Wartezeit bis zum Pfeil
  maxDelayMs: 3500,
  falseStart: 0.3, // Bewegung vor dem Pfeil = Fehlstart
  restThreshold: 0.03, // darunter gilt als "noch in Ruhe"
  fitLow: 0.04, // Fenster für die Schätzung des Bewegungsbeginns
  onsetFit: 0.2, // ab hier gilt der Start als erkannt (Schätzung erfolgt rückwirkend)
  minReactionMs: 100, // schneller ist nicht reaktiv, sondern geraten
  reactTimeoutMs: 4000,
  turnThreshold: 0.7, // Wendepunkt erreicht, wenn |u| so weit auf der Seite ist
  finishZone: 0.15, // Zielzone um die Mitte
  maxExtrapolateMs: 300,
  runTimeoutMs: 15000,
  lostPoseMs: 1000,
  minRunMs: 2500,
  maxRunMs: 15000,
  resultHoldMs: 3500,
  noticeMs: 2500,
};

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
    this.enterT = null;
    this.lostSince = null;
    this.dir = 0;
    this.tArrow = null;
    this.tOnset = null;
    this.tA = null;
    this.tB = null;
    this.planned = null;
    this.uStart = 0;
    this.uRef = 0;
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

  update(t, u) {
    this.t = t;
    const s = this.state;
    if (s === 'idle') return;
    if (s === 'hold') {
      if (t >= this.holdUntil) {
        this.buf.clear();
        this.clear();
        this.setState('wait_center');
      }
      return;
    }
    if (u == null) {
      if (this.lostSince == null) this.lostSince = t;
      this.enterT = null;
      if (['countdown', 'go', 'to_a', 'to_b', 'return'].includes(s) && t - this.lostSince > this.p.lostPoseMs) {
        this.abort('Person nicht mehr erkannt');
      }
      return;
    }
    this.lostSince = null;
    this.buf.push(t, u);
    switch (s) {
      case 'wait_center':
        return this.onWait(t, u);
      case 'countdown':
        return this.onCountdown(t, u);
      case 'go':
        return this.onGo(t, u);
      case 'to_a':
        if (t - this.tOnset > this.p.runTimeoutMs) return this.abort('Zeitlimit überschritten');
        if (u * this.dir >= this.p.turnThreshold) {
          this.tA = this.cross((v) => v * this.dir, this.p.turnThreshold);
          this.setState('to_b');
        }
        return;
      case 'to_b':
        if (t - this.tOnset > this.p.runTimeoutMs) return this.abort('Zeitlimit überschritten');
        if (-u * this.dir >= this.p.turnThreshold) {
          this.tB = this.cross((v) => -v * this.dir, this.p.turnThreshold);
          this.setState('return');
        }
        return;
      case 'return':
        if (t - this.tOnset > this.p.runTimeoutMs) return this.abort('Zeitlimit überschritten');
        if (-u * this.dir <= this.p.finishZone) this.onFinish(t);
        return;
      default:
    }
  }

  onWait(t, u) {
    const p = this.p;
    if (Math.abs(u) > p.centerZone) {
      this.enterT = null;
      return;
    }
    if (this.enterT == null) this.enterT = t;
    if (t - this.enterT < p.stableMs) return;
    const vals = this.buf.since(t - p.stableMs).map((i) => i.v);
    if (Math.max(...vals) - Math.min(...vals) > p.stableRange) return;
    this.uStart = median(vals);
    this.planned = t + p.minDelayMs + this.rand() * (p.maxDelayMs - p.minDelayMs);
    this.setState('countdown');
  }

  onCountdown(t, u) {
    if (Math.abs(u - this.uStart) > this.p.falseStart) return this.abort('Fehlstart');
    if (t >= this.planned) this.fire(t);
  }

  fire(t) {
    let dir = this.rand() < 0.5 ? -1 : 1;
    const l = this.lastDirs;
    if (l.length >= 2 && l[l.length - 1] === l[l.length - 2] && l[l.length - 1] === dir) dir = -dir;
    this.lastDirs.push(dir);
    this.dir = dir;
    this.tArrow = t;
    this.uRef = median(this.buf.since(t - 300).map((i) => i.v));
    this.setState('go');
    this.emit('arrow', { dir, direction: dir < 0 ? 'left' : 'right' });
  }

  onGo(t, u) {
    const p = this.p;
    const d = (u - this.uRef) * this.dir;
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
      .map((i) => ({ t: i.t, d: (i.v - this.uRef) * this.dir }));
    let idx = -1;
    for (let i = ds.length - 1; i >= 0; i--) {
      if (ds[i].d <= p.restThreshold) {
        idx = i;
        break;
      }
    }
    const lastRest = idx >= 0 ? ds[idx].t : ds[0].t;
    const fallback = idx >= 0 && idx < ds.length - 1 ? (ds[idx].t + ds[idx + 1].t) / 2 : lastRest;
    const fit = ds.filter((x, i) => i > idx && x.d >= p.fitLow && x.d <= p.onsetFit + 0.1);
    let tOnset = fallback;
    this.onsetMethod = 'threshold';
    if (fit.length >= 3) {
      const { k, mx, my } = regress(
        fit.map((x) => x.t),
        fit.map((x) => Math.sqrt(x.d)),
      );
      if (k > 0) {
        const t0 = mx - my / k;
        tOnset = Math.min(t, Math.max(lastRest - 150, t0));
        this.onsetMethod = 'fit';
      }
    }
    this.tOnset = tOnset;
  }

  /** Zeitpunkt, an dem fn(u) den Wert level erreicht, linear zwischen den letzten zwei Bildern. */
  cross(fn, level) {
    const it = this.buf.items;
    const b = it[it.length - 1];
    const a = it[it.length - 2];
    if (!a) return b.t;
    const fa = fn(a.v);
    const fb = fn(b.v);
    if (fb === fa) return b.t;
    const f = Math.min(1, Math.max(0, (level - fa) / (fb - fa)));
    return a.t + f * (b.t - a.t);
  }

  onFinish(t) {
    const p = this.p;
    const fn = (v) => -v * this.dir;
    const it = this.buf.items;
    const cur = fn(it[it.length - 1].v);
    let tLine;
    if (cur <= 0) {
      tLine = this.cross(fn, 0);
    } else {
      const tZone = this.cross(fn, p.finishZone);
      const last = it.slice(-4);
      const { k } = regress(
        last.map((i) => i.t),
        last.map((i) => fn(i.v)),
      );
      const vel = -k; // Annäherung an die Mitte pro ms
      const ext = vel > 1e-5 ? Math.min(p.finishZone / vel, p.maxExtrapolateMs) : 0;
      tLine = tZone + ext;
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
      total_ms: Math.round(tLine - this.tArrow),
      split_a_ms: Math.round(this.tA - this.tOnset),
      split_b_ms: Math.round(this.tB - this.tOnset),
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
