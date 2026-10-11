// Platz-Drill "Kreuzvorhaben" (Täuschungen): Zustandsmaschine auf Basis der Richtungsbefehle.
//
// Nach dem Bereitstehen kommt ein Pfeil:
//   go    grün: loslaufen und zurück in die Mitte (Reaktionszeit wird geschätzt)
//   stop  rot: stehen bleiben (richtig, wenn du die Haltezeit stehen bleibst)
//   flip  grün, kippt nach kurzer Zeit auf rot: sofort stoppen
//
// Eingabe pro Kamerabild: update(t, s) mit s = { dx, r } oder null, wie bei CommandEngine.
// Ereignisse: state, signal {type, command}, flip, result {type, command, correct, reaction_ms, reason}, round, timeout

import { CommandEngine, COMMAND_DEFAULTS } from './command-engine.js';
import { ShuffleEngine, SHUFFLE_DEFAULTS } from './shuffle-engine.js';
import { median } from './util.js';

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
};

const TYPES = ['go', 'stop', 'flip'];

export class DecoyEngine extends CommandEngine {
  constructor({ params = {}, rand = Math.random, onEvent = () => {} } = {}) {
    super({ params: { ...DECOY_DEFAULTS, ...params }, rand, onEvent });
    this.typeHistory = [];
    this.type = null;
    this.stats = { go: [0, 0], stop: [0, 0], flip: [0, 0] }; // [richtig, gesamt]
  }

  start() {
    this.stats = { go: [0, 0], stop: [0, 0], flip: [0, 0] };
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

  fire(t) {
    const list = this.p.commands.length ? this.p.commands : ['left', 'right', 'front'];
    const cmd = list[Math.floor(this.rand() * list.length)];
    this.type = this.pickType();
    this.typeHistory.push(this.type);
    this.issued += 1;
    this.tArrow = t;
    this.tCommand = t;
    this.cmd = cmd;
    this.dir = cmd === 'left' ? -1 : cmd === 'right' ? 1 : 0;
    this.ref = median(this.buf.since(t - 300).map((i) => i.v));
    this.awaySince = null;
    this.flipped = false;
    this.tFlip = this.type === 'flip' ? t + this.p.flipMinMs + this.rand() * (this.p.flipMaxMs - this.p.flipMinMs) : null;
    this.setState('command');
    this.emit('signal', { type: this.type, command: cmd, issued: this.issued });
  }

  finish(t, correct, reason, reaction = null) {
    const k = this.stats[this.type];
    k[1] += 1;
    if (correct) k[0] += 1;
    this.emit('result', { type: this.type, command: this.cmd, correct, reaction_ms: reaction, reason });
  }

  /** Zurück zur Bereitschaft; nach einem Lauf zählt die Runde erst, wenn man wieder in der Mitte steht. */
  toReturn() {
    this.returning = true;
    this.readySince = null;
    this.setState('away');
  }

  update(t, s) {
    if (this.state !== 'command') return super.update(t, s);
    const p = this.p;
    const lost = s == null;
    if (lost) {
      if (this.lostSince == null) this.lostSince = t;
    } else {
      this.lostSince = null;
      this.buf.push(t, s.dx);
    }
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
