// Platz-Drill "Kreuzvorhaben" (Täuschungen): Zustandsmaschine auf Basis der Richtungsbefehle.
//
// Nach dem Bereitstehen kommt ein Pfeil:
//   go    grün: loslaufen und zurück in die Mitte (Reaktionszeit wird geschätzt)
//   stop  rot: stehen bleiben (richtig, wenn du die Haltezeit stehen bleibst)
//   flip  grün, kippt nach kurzer Zeit auf rot: sofort stoppen
//   brake grün, im Lauf kommt "STOPP": so schnell wie möglich abbremsen und stehen (Stopp-Drill).
//         Gemessen: Reaktion auf den Pfeil, Bremszeit (STOPP bis Stand) und Bremsweg. Nur links/rechts,
//         das Stopp-Signal kommt nach 0,4–0,6 m. Läufst du nach STOPP aus dem Bild (Ansage über Kopfhörer),
//         zählt die Aufgabe als gestoppt, aber ohne Messung (brake_ms = null, measured = false).
// Optional (splitGapMs > 0): vorher kommt "Split!", der Pfeil folgt nach kurzer Pause. Wer in der Pause
// schon losläuft, hat einen Fehlstart. Gemessen wird immer ab dem Pfeil.
//
// Eingabe pro Kamerabild: update(t, s) mit s = { dx, r } oder null, wie bei CommandEngine.
// Ereignisse: state, split, signal {type, command}, flip, brake, result {type, command, correct, reaction_ms, reason,
//             brake_ms, brake_cm}, round, timeout

import { CommandEngine, COMMAND_DEFAULTS } from './command-engine.js';
import { ShuffleEngine, SHUFFLE_DEFAULTS } from './shuffle-engine.js';
import { median, range } from './util.js';

export const DECOY_DEFAULTS = {
  ...COMMAND_DEFAULTS,
  restThreshold: SHUFFLE_DEFAULTS.restThreshold,
  fitLow: SHUFFLE_DEFAULTS.fitLow,
  onsetFit: 0.8, // ab dieser Auslenkung (Rumpflängen) gilt die Bewegung als erkannt
  minDelayMs: 1200,
  maxDelayMs: 3200,
  weights: { go: 0.55, stop: 0.25, flip: 0.2 },
  flipMinMs: 220, // Zeit zwischen grünem Pfeil und Wechsel auf rot
  flipMaxMs: 380,
  holdMs: 1500, // so lange muss man bei rot stehen bleiben
  stopAwayDx: 0.9, // Auslenkung, ab der "stehen bleiben" gescheitert ist
  minReactionMs: 100,
  brakeMinDx: 0.8, // STOPP kommt zufällig zwischen diesen Auslenkungen (Rumpflängen, ca. 0,4–0,6 m),
  brakeMaxDx: 1.2, // früh genug, dass du bei 5–6 m Abstand noch im Bild zum Stehen kommst
  standMs: 300, // so lange (fast) ohne Bewegung = steht
  standRange: 0.3,
  maxBrakeDx: 6, // im Bild weiter als ca. 3 m nach STOPP = zu spät gestoppt
  brakeTimeoutMs: 3000,
  torsoM: 0.5,
  splitGapMs: 0, // 0 = ohne Splitstep; sonst mittlere Pause zwischen "Split!" und Pfeil (zufällig 0,8x bis 1,2x)
};

const TYPES = ['go', 'stop', 'flip', 'brake'];
const newStats = () => ({ go: [0, 0], stop: [0, 0], flip: [0, 0], brake: [0, 0] }); // [richtig, gesamt]

export class DecoyEngine extends CommandEngine {
  constructor({ params = {}, rand = Math.random, onEvent = () => {} } = {}) {
    super({ params: { ...DECOY_DEFAULTS, ...params }, rand, onEvent });
    this.typeHistory = [];
    this.type = null;
    this.stats = newStats();
  }

  start() {
    this.stats = newStats();
    this.typeHistory = [];
    super.start();
  }

  pickType() {
    const w = this.p.weights;
    const h = this.typeHistory;
    let pool = TYPES.filter((t) => (w[t] ?? 0) > 0);
    if (!pool.length) pool = ['go'];
    // nie dreimal derselbe Typ hintereinander, nach zwei Stopp-Aufgaben wieder Laufen
    if (h.length >= 2 && h[h.length - 1] === h[h.length - 2] && pool.length > 1) pool = pool.filter((t) => t !== h[h.length - 1]);
    const sum = pool.reduce((a, t) => a + w[t], 0);
    let x = this.rand() * sum;
    for (const t of pool) {
      x -= w[t];
      if (x <= 0) return t;
    }
    return pool[pool.length - 1];
  }

  /** Aufgabe wählen; mit Splitstep zuerst "Split!", sonst gleich der Pfeil. */
  fire(t) {
    const list = this.p.commands.length ? this.p.commands : ['left', 'right', 'front'];
    this.cmd = list[Math.floor(this.rand() * list.length)];
    // nie dreimal dieselbe Richtung hintereinander
    const h = this.history;
    if (list.length > 1 && h.length >= 2 && h[h.length - 1] === this.cmd && h[h.length - 2] === this.cmd) {
      const others = list.filter((c) => c !== this.cmd);
      this.cmd = others[Math.floor(this.rand() * others.length)];
    }
    this.type = this.pickType();
    if (this.type === 'brake' && this.cmd === 'front') {
      // Abbremsen nur seitlich (nach vorne fehlt die Tiefe im Bild)
      const lr = list.filter((c) => c !== 'front');
      if (lr.length) this.cmd = lr[Math.floor(this.rand() * lr.length)];
      else this.type = 'go';
    }
    this.typeHistory.push(this.type);
    h.push(this.cmd);
    this.issued += 1;
    this.dir = this.cmd === 'left' ? -1 : this.cmd === 'right' ? 1 : 0;
    this.awaySince = null;
    this.tCommand = t;
    if (this.p.splitGapMs > 0) {
      this.ref0 = median(this.buf.since(t - 300).map((i) => i.v));
      this.splitAt = t + this.p.splitGapMs * (0.8 + 0.4 * this.rand());
      this.setState('split');
      this.emit('split', { issued: this.issued, gap_ms: Math.round(this.splitAt - t) });
    } else {
      this.signal(t);
    }
  }

  signal(t) {
    this.tArrow = t;
    this.tCommand = t;
    this.ref = median(this.buf.since(t - 300).map((i) => i.v));
    this.awaySince = null;
    this.flipped = false;
    this.braked = false;
    this.tOnset = null;
    this.reaction = null;
    this.brakeAt = this.p.brakeMinDx + this.rand() * (this.p.brakeMaxDx - this.p.brakeMinDx);
    this.tFlip = this.type === 'flip' ? t + this.p.flipMinMs + this.rand() * (this.p.flipMaxMs - this.p.flipMinMs) : null;
    this.setState('command');
    this.emit('signal', { type: this.type, command: this.cmd, issued: this.issued });
  }

  finish(t, correct, reason, reaction = null, extra = {}) {
    const k = this.stats[this.type];
    k[1] += 1;
    if (correct) k[0] += 1;
    this.emit('result', { type: this.type, command: this.cmd, correct, reaction_ms: reaction, reason, ...extra });
  }

  /** Abbremsen: loslaufen, nach STOPP so schnell wie möglich stehen. */
  updateBrake(t, s) {
    const p = this.p;
    const fail = (reason) => {
      this.finish(t, false, reason, this.reaction);
      this.toReturn();
    };
    if (s == null) {
      if (t - this.lostSince < p.lostAwayMs) return;
      if (this.tOnset == null) return fail('Aus dem Bild gelaufen');
      if (!this.braked) {
        // schon vor dem STOPP aus dem Bild: STOPP sofort geben (kommt per Ansage), Bremsung nicht messbar
        this.braked = true;
        this.tBrake = t;
        this.emit('brake', { command: this.cmd });
      }
      this.finish(t, true, null, this.reaction, { brake_ms: null, brake_cm: null, measured: false });
      this.toReturn();
      return;
    }
    const d = (s.dx - this.ref) * this.dir;
    if (!this.braked) {
      if (this.tOnset == null) {
        if (d <= -p.onsetFit) return fail('Falsche Richtung');
        if (d >= p.onsetFit) {
          ShuffleEngine.prototype.estimateOnset.call(this, t);
          this.reaction = Math.round(this.tOnset - this.tArrow);
          if (this.reaction < p.minReactionMs) return fail('Zu früh');
        }
      }
      if (this.tOnset != null && d >= this.brakeAt) {
        this.braked = true;
        this.tBrake = t;
        this.dBrake = d;
        this.emit('brake', { command: this.cmd });
      } else if (t - this.tCommand > p.commandTimeoutMs) {
        this.emit('timeout', {});
        this.readySince = null;
        this.setState('wait_ready');
      }
      return;
    }
    if (d - this.dBrake > p.maxBrakeDx) return fail('Zu spät gestoppt');
    const win = this.buf.since(t - p.standMs).filter((i) => i.t >= this.tBrake);
    if (win.length >= 4 && t - win[0].t >= p.standMs - 40 && range(win.map((i) => i.v)) <= p.standRange) {
      const tStand = win[0].t;
      const dStand = (median(win.map((i) => i.v)) - this.ref) * this.dir;
      this.finish(t, true, null, this.reaction, {
        brake_ms: Math.round(Math.max(0, tStand - this.tBrake)),
        brake_cm: Math.round(Math.max(0, dStand - this.dBrake) * p.torsoM * 100),
        measured: true,
      });
      this.toReturn();
      return;
    }
    if (t - this.tBrake > p.brakeTimeoutMs) fail('Nicht zum Stehen gekommen');
  }

  /** Pause zwischen "Split!" und Pfeil: still bleiben (Hüpfen am Ort ist erlaubt). */
  updateSplit(t, s) {
    const p = this.p;
    const lost = s == null;
    if (lost) this.lostSince ??= t;
    else {
      this.lostSince = null;
      this.buf.push(t, s.dx);
    }
    const away =
      (lost && t - this.lostSince >= p.lostAwayMs) || (!lost && (Math.abs(s.dx - this.ref0) > p.stopAwayDx || s.r < p.awayLo || s.r > p.awayHi));
    if (away) this.awaySince ??= t;
    else this.awaySince = null;
    if (this.awaySince != null && t - this.awaySince >= 200) {
      this.type = 'go';
      this.typeHistory[this.typeHistory.length - 1] = 'go';
      this.finish(t, false, 'Zu früh gestartet');
      this.toReturn();
      return;
    }
    if (t >= this.splitAt) this.signal(t);
  }

  /** Zurück zur Bereitschaft; nach einem Lauf zählt die Runde erst, wenn man wieder in der Mitte steht. */
  toReturn() {
    this.returning = true;
    this.readySince = null;
    this.setState('away');
  }

  update(t, s) {
    if (this.state === 'split') return this.updateSplit(t, s);
    if (this.state !== 'command') return super.update(t, s);
    const p = this.p;
    const lost = s == null;
    if (lost) {
      if (this.lostSince == null) this.lostSince = t;
    } else {
      this.lostSince = null;
      this.buf.push(t, s.dx);
    }
    if (this.type === 'brake') return this.updateBrake(t, s);
    const away =
      (lost && t - this.lostSince >= p.lostAwayMs) ||
      (!lost && (Math.abs(s.dx - this.ref) > (this.type === 'go' ? p.awayDx : p.stopAwayDx) || s.r < p.awayLo || s.r > p.awayHi));
    if (away) this.awaySince ??= t;
    else this.awaySince = null;
    const awayFor = this.awaySince == null ? 0 : t - this.awaySince;

    if (this.type === 'flip' && !this.flipped && t >= this.tFlip) {
      this.flipped = true;
      this.emit('flip', { command: this.cmd });
    }

    if (this.type === 'go') {
      if (awayFor >= p.awayDebounceMs) {
        let reaction = null;
        if (this.dir !== 0) {
          // Bewegungsbeginn wie beim Shuffle schätzen (Auslenkung quadratisch in der Zeit)
          ShuffleEngine.prototype.estimateOnset.call(this, t);
          reaction = Math.round(this.tOnset - this.tArrow);
        }
        if (reaction != null && reaction < p.minReactionMs) {
          this.finish(t, false, 'Zu früh', reaction);
          this.toReturn();
        } else {
          this.finish(t, true, null, reaction);
          this.toReturn();
        }
        return;
      }
    } else {
      const holdFrom = this.type === 'flip' ? this.tFlip : this.tCommand;
      if (awayFor >= 120 && (this.type === 'stop' || this.flipped)) {
        this.finish(t, false, this.type === 'flip' ? 'Nicht gestoppt' : 'Losgelaufen');
        this.toReturn();
        return;
      }
      if ((this.type === 'stop' || this.flipped) && t - holdFrom >= p.holdMs) {
        this.finish(t, true, null);
        this.rounds += 1;
        this.emit('round', { rounds: this.rounds, issued: this.issued });
        if (this.state === 'idle') return;
        this.readySince = null;
        this.setState('wait_ready');
        return;
      }
      // Wer vor dem Wechsel schon weit weg ist (flip), hat sich täuschen lassen
      if (this.type === 'flip' && !this.flipped && awayFor >= 120) {
        this.finish(t, false, 'Reingefallen');
        this.toReturn();
        return;
      }
    }
    if (t - this.tCommand > p.commandTimeoutMs) {
      this.emit('timeout', {});
      this.readySince = null;
      this.setState('wait_ready');
    }
  }
}
