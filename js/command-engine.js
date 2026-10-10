// Zustandsmaschine für Feature 2: Richtungsbefehle ohne Zeitmessung.
//
// Eingabe pro Kamerabild: update(t, s)
//   s = { dx, r } oder null (keine Person erkannt)
//   dx = seitliche Abweichung von der Mitte in Rumpflängen (rechts positiv)
//   r  = aktuelle Rumpflänge im Bild / Rumpflänge bei der Kalibrierung (>1 = näher an der Kamera)
//
// Ablauf: bereit in der Mitte -> zufällige Pause -> Befehl -> losgelaufen -> zurück -> bereit ...

import { Ring, range } from './util.js';

export const COMMAND_DEFAULTS = {
  readyDx: 0.6,
  readyLo: 0.85,
  readyHi: 1.18,
  awayDx: 1.0,
  awayLo: 0.78,
  awayHi: 1.3,
  stableMs: 800,
  stableRange: 0.35,
  minDelayMs: 1000,
  maxDelayMs: 3000,
  awayDebounceMs: 200,
  lostAwayMs: 250,
  notReadyMs: 400,
  commandTimeoutMs: 12000,
  commands: ['left', 'right', 'front'],
};

export class CommandEngine {
  constructor({ params = {}, rand = Math.random, onEvent = () => {} } = {}) {
    this.p = { ...COMMAND_DEFAULTS, ...params };
    this.rand = rand;
    this.emit = onEvent;
    this.buf = new Ring(3000);
    this.state = 'idle';
    this.issued = 0;
    this.rounds = 0;
    this.history = [];
    this.clear();
  }

  clear() {
    this.readySince = null;
    this.notReadySince = null;
    this.awaySince = null;
    this.lostSince = null;
    this.planned = null;
    this.tCommand = null;
    this.returning = false;
  }

  setState(s) {
    this.state = s;
    this.emit('state', { state: s });
  }

  start() {
    this.buf.clear();
    this.clear();
    this.issued = 0;
    this.rounds = 0;
    this.setState('wait_ready');
  }

  stop() {
    this.clear();
    this.setState('idle');
  }

  update(t, s) {
    if (this.state === 'idle') return;
    const p = this.p;
    const lost = s == null;
    if (lost) {
      if (this.lostSince == null) this.lostSince = t;
    } else {
      this.lostSince = null;
      this.buf.push(t, s.dx);
    }
    const ready = !lost && Math.abs(s.dx) <= p.readyDx && s.r >= p.readyLo && s.r <= p.readyHi;
    const away =
      (lost && t - this.lostSince >= p.lostAwayMs) ||
      (!lost && (Math.abs(s.dx) > p.awayDx || s.r < p.awayLo || s.r > p.awayHi));

    switch (this.state) {
      case 'wait_ready':
      case 'away':
        if (!ready) {
          this.readySince = null;
          return;
        }
        if (this.readySince == null) this.readySince = t;
        if (t - this.readySince < p.stableMs) return;
        if (range(this.buf.since(t - p.stableMs).map((i) => i.v)) > p.stableRange) return;
        if (this.returning) {
          this.returning = false;
          this.rounds += 1;
          this.emit('round', { rounds: this.rounds, issued: this.issued });
          if (this.state === 'idle') return;
        }
        this.planned = t + p.minDelayMs + this.rand() * (p.maxDelayMs - p.minDelayMs);
        this.notReadySince = null;
        this.setState('countdown');
        return;
      case 'countdown':
        if (!ready) {
          if (this.notReadySince == null) this.notReadySince = t;
          if (t - this.notReadySince >= p.notReadyMs) {
            this.readySince = null;
            this.setState('wait_ready');
          }
          return;
        }
        this.notReadySince = null;
        if (t >= this.planned) this.fire(t);
        return;
      case 'command':
        if (away) {
          if (this.awaySince == null) this.awaySince = t;
          if (t - this.awaySince >= p.awayDebounceMs) {
            this.returning = true;
            this.readySince = null;
            this.setState('away');
          }
        } else {
          this.awaySince = null;
        }
        if (this.state === 'command' && t - this.tCommand > p.commandTimeoutMs) {
          this.emit('timeout', {});
          this.readySince = null;
          this.setState('wait_ready');
        }
        return;
      default:
    }
  }

  fire(t) {
    const list = this.p.commands.length ? this.p.commands : ['left', 'right', 'front'];
    let cmd = list[Math.floor(this.rand() * list.length)];
    const h = this.history;
    if (list.length > 1 && h.length >= 2 && h[h.length - 1] === cmd && h[h.length - 2] === cmd) {
      const others = list.filter((c) => c !== cmd);
      cmd = others[Math.floor(this.rand() * others.length)];
    }
    h.push(cmd);
    this.issued += 1;
    this.tCommand = t;
    this.awaySince = null;
    this.setState('command');
    this.emit('command', { command: cmd, issued: this.issued });
  }
}
