// Spider-Drill mit Kamera: fünf Hütchen im Halbkreis um die Mitte, nach jedem Hütchen zurück durch die Mitte.
//
// Aufbau: Gerät steht vor der Mitte (wie beim 5-10-5), "vorne" ist Richtung Gerät.
// Ziele: left, front-left, front, front-right, right. Klassisch in dieser Reihenfolge, optional zufällig
// (dann ist es zusätzlich ein Reaktionstraining: das nächste Ziel kommt erst, wenn du durch die Mitte bist).
//
// Eingabe pro Kamerabild: update(t, s) mit s = { dx, r } oder null, wie bei ShuffleEngine.
//   dx = seitlich in Rumpflängen (rechts positiv), r = Abstandsverhältnis (> 1 = näher am Gerät)
// Ein Weg zählt als "am Hütchen", wenn du weit genug in die richtige Richtung gelaufen bist
// oder in diese Richtung aus dem Bild verschwindest. Danach zählt die Rückkehr in die Mittelzone.
// Gemessen wird vom ersten Pfeil bis zur Rückkehr nach dem fünften Hütchen.
//
// Ereignisse: state, target {target, leg, of}, leg {leg, target, ms}, result {...}, abort {reason}

import { Ring, median, range } from './util.js';

export const SPIDER_TARGETS = ['left', 'front-left', 'front', 'front-right', 'right'];

export const SPIDER_DEFAULTS = {
  readyDx: 1.0,
  readyLo: 0.8,
  readyHi: 1.25,
  stableMs: 1000,
  stableRange: 0.5,
  minDelayMs: 1500,
  maxDelayMs: 3500,
  falseStartDx: 1.5,
  falseStartR: 0.2,
  random: true,
  sideDx: 2.0, // seitlich (ca. 1 m) weg = Hütchen links/rechts erreicht
  diagDx: 1.0, // schräg: seitlich weniger, die Tiefe ist im Bild ungenau
  frontR: 1.3, // vorne: so viel näher am Gerät
  lostSideDx: 0.5, // verschwindet die Person ab hier seitlich, zählt das als "dort"
  lostFrontR: 1.12, // oder nach vorne (zu nah am Gerät)
  lostMs: 250,
  wrongDx: 1.5, // so weit in die falsche Richtung = falsch gelaufen
  centerDx: 1.0, // Mittelzone für die Rückkehr
  centerLo: 0.8,
  centerHi: 1.15, // nach vorne enger: r wächst schnell, 1,15 sind bei 6 m Abstand ca. 0,8 m
  legTimeoutMs: 7000,
  lostRunMs: 5000,
  minLegMs: 600, // schneller ist kein echter Weg zum Hütchen und zurück
  resultHoldMs: 4000,
  noticeMs: 2500,
};

const side = (target) => (target.includes('left') ? -1 : target.includes('right') ? 1 : 0);

export class SpiderEngine {
  constructor({ params = {}, rand = Math.random, onEvent = () => {} } = {}) {
    this.p = { ...SPIDER_DEFAULTS, ...params };
    this.rand = rand;
    this.emit = onEvent;
    this.buf = new Ring(3000);
    this.state = 'idle';
    this.t = 0;
    this.clear();
  }

  clear() {
    this.readySince = null;
    this.lostSince = null;
    this.last = null;
    this.planned = null;
    this.order = [];
    this.leg = 0;
    this.legs = [];
    this.tStart = null;
    this.tLeg = null;
    this.reached = false;
    this.holdUntil = null;
    this.start0 = null;
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

  /** Reihenfolge eines Durchgangs: klassisch oder zufällig (jedes Hütchen genau einmal). */
  makeOrder() {
    const o = [...SPIDER_TARGETS];
    if (!this.p.random) return o;
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [o[i], o[j]] = [o[j], o[i]];
    }
    return o;
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
    const running = this.state === 'out' || this.state === 'back';
    if (running && t - this.tLeg > p.legTimeoutMs) return this.abort(this.reached ? 'Nicht zurück in die Mitte' : 'Hütchen nicht erreicht');
    if (s == null) {
      this.lostSince ??= t;
      this.readySince = null;
      if (this.state === 'out' && t - this.lostSince >= p.lostMs && this.lostToTarget()) this.toBack(t);
      if (running && t - this.lostSince > p.lostRunMs) this.abort('Person nicht mehr erkannt');
      else if (this.state === 'countdown' && t - this.lostSince > 1000) this.abort('Person nicht mehr erkannt');
      return;
    }
    this.lostSince = null;
    this.last = s;
    this.buf.push(t, s.dx);
    switch (this.state) {
      case 'wait_center':
        return this.onWait(t, s);
      case 'countdown':
        if (Math.abs(s.dx - this.start0.dx) > p.falseStartDx || Math.abs(s.r - this.start0.r) > p.falseStartR) return this.abort('Fehlstart');
        if (t >= this.planned) {
          this.tStart = t;
          this.order = this.makeOrder();
          this.nextLeg(t);
        }
        return;
      case 'out':
        return this.onOut(t, s);
      case 'back':
        if (Math.abs(s.dx) <= p.centerDx && s.r >= p.centerLo && s.r <= p.centerHi) this.onCenter(t);
        return;
      default:
    }
  }

  onWait(t, s) {
    const p = this.p;
    const ready = Math.abs(s.dx) <= p.readyDx && s.r >= p.readyLo && s.r <= p.readyHi;
    if (!ready) {
      this.readySince = null;
      return;
    }
    this.readySince ??= t;
    if (t - this.readySince < p.stableMs) return;
    if (range(this.buf.since(t - p.stableMs).map((i) => i.v)) > p.stableRange) return;
    this.start0 = { dx: median(this.buf.since(t - p.stableMs).map((i) => i.v)), r: s.r };
    this.planned = t + p.minDelayMs + this.rand() * (p.maxDelayMs - p.minDelayMs);
    this.setState('countdown');
  }

  nextLeg(t) {
    this.tLeg = t;
    this.reached = false;
    const target = this.order[this.leg];
    this.setState('out');
    this.emit('target', { target, leg: this.leg + 1, of: this.order.length });
  }

  get target() {
    return this.order[this.leg];
  }

  onOut(t, s) {
    const p = this.p;
    const dir = side(this.target);
    const lat = s.dx * dir;
    if (dir === 0) {
      if (s.r >= p.frontR) return this.toBack(t);
      if (Math.abs(s.dx) >= p.sideDx + 0.5) return this.wrong();
    } else {
      if (lat <= -p.wrongDx) return this.wrong();
      const need = this.target.startsWith('front') ? p.diagDx : p.sideDx;
      if (lat >= need) return this.toBack(t);
    }
  }

  /** Aus dem Bild verschwunden: in Richtung des Hütchens? */
  lostToTarget() {
    const s = this.last;
    if (!s) return false;
    const dir = side(this.target);
    if (dir === 0) return s.r >= this.p.lostFrontR;
    return s.dx * dir >= this.p.lostSideDx || (this.target.startsWith('front') && s.r >= this.p.lostFrontR && s.dx * dir >= 0);
  }

  toBack() {
    this.reached = true;
    this.setState('back');
  }

  onCenter(t) {
    const ms = Math.round(t - this.tLeg);
    this.legs.push({ target: this.target, ms });
    this.emit('leg', { leg: this.leg + 1, target: this.target, ms });
    this.leg += 1;
    if (this.leg < this.order.length) return this.nextLeg(t);
    const total = Math.round(t - this.tStart);
    const fast = this.legs.find((l) => l.ms < this.p.minLegMs);
    this.emit('result', {
      valid: !fast,
      reason: fast ? 'Zeit unplausibel kurz' : null,
      total_ms: total,
      legs: this.legs,
      order: this.order,
      random: !!this.p.random,
    });
    this.hold(this.p.resultHoldMs);
  }

  wrong() {
    this.emit('result', { valid: false, reason: 'Falsche Richtung', total_ms: null, legs: this.legs, order: this.order, random: !!this.p.random });
    this.hold(this.p.noticeMs);
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
