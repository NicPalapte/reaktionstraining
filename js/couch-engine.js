// Couch-Spiel "Kreuzvorhaben": Spielregeln ohne Kamera, nur mit Tippen.
//
// Ein Pfeil erscheint (links, rechts oder vorne):
//   go    grün: tippe die passende Seite, so schnell du kannst
//   stop  rot: nicht tippen, bis die Zeit um ist
//   flip  grün, kippt nach kurzer Zeit auf rot: nicht tippen (wer sofort tippt, ist reingefallen)
//   fake  blau: Fake-Signal, ignorieren. Danach folgt oft gleich der echte grüne Pfeil.
// 3 Leben. Alle 8 Runden steigt das Level: schnellere Pfeile, kürzere Zeit, mehr Täuschungen.
//
// Zeitquelle: update(t) und tap(t, dir) bekommen dieselbe Uhr (Millisekunden).
// Ereignisse: state, signal {type, command, level}, flip, result {type, command, ok, reaction_ms, points, reason, streak},
//             score {score, level, lives, streak}, over {score, level, rounds}

export const COUCH = {
  lives: 3,
  roundsPerLevel: 8,
  feedbackMs: 900,
  holdMs: 1100, // so lange nicht tippen bei rot
  flipMinMs: 250,
  flipMaxMs: 420,
  fakeFeedbackMs: 150, // nach einem Fake kaum Pause, damit der echte Pfeil überrascht
};

/** Spielparameter je Level (ab 1). */
export function levelParams(level) {
  const l = Math.max(1, level);
  return {
    waitMin: Math.max(350, 1100 - (l - 1) * 90),
    waitMax: Math.max(900, 2300 - (l - 1) * 150),
    timeout: Math.max(650, 1600 - (l - 1) * 90), // so lange hat man zum Tippen
    pStop: l < 2 ? 0 : Math.min(0.3, 0.15 + (l - 2) * 0.03),
    pFlip: l < 3 ? 0 : Math.min(0.3, 0.12 + (l - 3) * 0.03),
    flipMin: Math.max(180, COUCH.flipMinMs - (l - 1) * 8),
    flipMax: Math.max(260, COUCH.flipMaxMs - (l - 1) * 12),
    pFake: l < 2 ? 0 : Math.min(0.25, 0.12 + (l - 2) * 0.03),
    fakeMs: Math.max(450, 800 - (l - 2) * 40), // so lange steht der Fake da
    chainWait: [Math.max(250, 600 - l * 30), Math.max(500, 1000 - l * 50)], // Pause bis zum echten Pfeil danach
  };
}

export class CouchGame {
  constructor({ rand = Math.random, onEvent = () => {}, commands = ['left', 'right', 'front'] } = {}) {
    this.rand = rand;
    this.emit = onEvent;
    this.commands = commands;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.score = 0;
    this.level = 1;
    this.lives = COUCH.lives;
    this.streak = 0;
    this.rounds = 0; // abgeschlossene Runden
    this.hits = 0; // richtige Runden (bestimmen das Level)
    this.bestStreak = 0;
    this.history = [];
    this.chain = false; // nach einem Fake kommt als Nächstes ein echtes Go
    this.type = null;
    this.cmd = null;
    this.next = null;
    this.tSignal = null;
    this.tFlip = null;
    this.flipped = false;
  }

  setState(s) {
    this.state = s;
    this.emit('state', { state: s });
  }

  start(t) {
    this.reset();
    this.emit('score', this.snap());
    this.scheduleWait(t, 900);
  }

  snap() {
    return { score: this.score, level: this.level, lives: this.lives, streak: this.streak };
  }

  scheduleWait(t, fixed = null) {
    const lp = levelParams(this.level);
    if (this.chain && fixed == null) this.next = t + lp.chainWait[0] + this.rand() * (lp.chainWait[1] - lp.chainWait[0]);
    else this.next = t + (fixed ?? lp.waitMin + this.rand() * (lp.waitMax - lp.waitMin));
    this.setState('wait');
  }

  pickType() {
    const lp = levelParams(this.level);
    const h = this.history;
    if (this.chain) return 'go';
    const r = this.rand();
    let type = r < lp.pStop ? 'stop' : r < lp.pStop + lp.pFlip ? 'flip' : r < lp.pStop + lp.pFlip + lp.pFake ? 'fake' : 'go';
    if (type !== 'go' && h.length >= 2 && h[h.length - 1] !== 'go' && h[h.length - 2] !== 'go') type = 'go';
    return type;
  }

  /** Die Uhr läuft weiter: Signal auslösen, Kippen, Zeitüberschreitung, Ende der Rückmeldung. */
  update(t) {
    switch (this.state) {
      case 'wait':
        if (t >= this.next) this.fire(t);
        return;
      case 'signal': {
        const lp = levelParams(this.level);
        if (this.type === 'flip' && !this.flipped && t >= this.tFlip) {
          this.flipped = true;
          this.emit('flip', { command: this.cmd });
        }
        if (this.type === 'go') {
          if (t - this.tSignal > lp.timeout) this.fail(t, 'Zu langsam');
        } else if (this.type === 'fake') {
          if (t - this.tSignal >= lp.fakeMs) this.hit(t, null, 'fake');
        } else {
          const from = this.type === 'flip' ? this.tFlip : this.tSignal;
          if (t - from >= COUCH.holdMs) this.hit(t, null, 'held');
        }
        return;
      }
      case 'feedback':
        if (t >= this.next) {
          if (this.lives <= 0) {
            this.setState('over');
            this.emit('over', { score: this.score, level: this.level, rounds: this.rounds, bestStreak: this.bestStreak });
          } else {
            this.scheduleWait(t);
          }
        }
        return;
      default:
    }
  }

  fire(t) {
    this.type = this.pickType();
    this.history.push(this.type);
    this.chain = false;
    this.cmd = this.commands[Math.floor(this.rand() * this.commands.length)];
    const lp = levelParams(this.level);
    this.tSignal = t;
    this.flipped = false;
    this.tFlip = this.type === 'flip' ? t + lp.flipMin + this.rand() * (lp.flipMax - lp.flipMin) : null;
    this.setState('signal');
    this.emit('signal', { type: this.type, command: this.cmd, level: this.level });
  }

  /** Antippen von links/rechts/vorne zum Zeitpunkt t. */
  tap(t, dir) {
    if (this.state === 'wait') return this.fail(t, 'Zu früh getippt', true);
    if (this.state !== 'signal') return;
    if (this.type === 'fake') return this.fail(t, 'Fake-Signal');
    if (this.type === 'go') {
      if (dir !== this.cmd) return this.fail(t, 'Falsche Seite');
      return this.hit(t, Math.max(0, Math.round(t - this.tSignal)), 'tap');
    }
    return this.fail(t, this.type === 'flip' ? 'Reingefallen' : 'Nicht tippen');
  }

  hit(t, reaction, how) {
    const lp = levelParams(this.level);
    this.streak += 1;
    this.hits += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const mult = 1 + 0.1 * Math.min(this.streak - 1, 10);
    const base = how === 'tap' ? Math.max(10, Math.round(100 * (1 - reaction / lp.timeout))) : how === 'fake' ? 40 : 60;
    if (how === 'fake') this.chain = this.rand() < 0.7; // meist folgt gleich der echte Pfeil
    const points = Math.round(base * mult);
    this.score += points;
    this.rounds += 1;
    this.closeRound(t, { ok: true, reaction_ms: reaction, points, reason: null });
  }

  fail(t, reason, early = false) {
    this.lives -= 1;
    this.streak = 0;
    this.rounds += early ? 0 : 1;
    this.closeRound(t, { ok: false, reaction_ms: null, points: 0, reason }, early);
  }

  closeRound(t, res, early = false) {
    const type = early ? null : this.type;
    const cmd = early ? null : this.cmd;
    this.emit('result', { type, command: cmd, ...res, streak: this.streak, lives: this.lives });
    if (res.ok && this.hits % COUCH.roundsPerLevel === 0) {
      this.level += 1;
      this.emit('level', { level: this.level });
    }
    this.emit('score', this.snap());
    this.next = t + (res.ok && this.type === 'fake' && !early ? COUCH.fakeFeedbackMs : COUCH.feedbackMs);
    this.setState('feedback');
  }

  stop() {
    this.state = 'idle';
  }
}
