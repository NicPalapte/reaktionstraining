import { store, newSessionId } from './storage.js';
import { loadSettings, saveSettings, loadCalibration, saveCalibration, DEFAULT_SETTINGS } from './settings.js';
import { ShuffleEngine } from './shuffle-engine.js';
import { CommandEngine } from './command-engine.js';
import { DecoyEngine } from './decoy-engine.js';
import { initCouch } from './couch-ui.js';
import { Calibrator, makeSample } from './calibration.js';
import { PoseTracker } from './pose.js';
import { SimTracker } from './sim-tracker.js';
import * as audio from './audio.js';
import { drawChart } from './chart.js';
import { cloud } from './cloud.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const EX_SHUFFLE = 'shuffle_5_10_5';
const EX_COMMANDS = 'commands';
const EX_DECOY = 'decoy_court';
const EX_COUCH = 'decoy_couch';

let settings = loadSettings();
let session = null;

// ---------- Formatierung ----------
const fmtSec = (ms) => (ms / 1000).toFixed(2).replace('.', ',');
const fmtS = (ms) => `${fmtSec(ms)} s`;
const fmtMs = (ms) => `${Math.round(ms)} ms`;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const dayKey = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const dirLabel = { left: 'links', right: 'rechts', front: 'vorne' };
const fmtDur = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
};

// ---------- Navigation ----------
function show(name) {
  for (const id of ['home', 'history', 'settings', 'session', 'couch']) $(`#screen-${id}`).hidden = id !== name;
  document.body.classList.toggle('in-session', name === 'session' || name === 'couch');
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  if (name === 'home') refreshHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') refreshSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

async function refreshHome() {
  const trials = (await store.listTrials(EX_SHUFFLE)).filter((t) => t.valid && t.run_ms != null);
  $('#meta-shuffle').textContent = trials.length
    ? `Bestzeit ${fmtS(Math.min(...trials.map((t) => t.run_ms)))} · ${trials.length} Durchgänge`
    : 'Noch keine Zeiten';
  const all = await store.listSessions();
  const dec = all.filter((x) => x.exercise === EX_DECOY);
  const splitNote = settings.splitStep ? ' · mit Splitstep' : '';
  $('#meta-decoy').textContent = (dec.length ? `${dec.length} Einheiten` : 'Noch keine Einheiten') + splitNote;
  const cou = all.filter((x) => x.exercise === EX_COUCH);
  $('#meta-couch').textContent = cou.length ? `Highscore ${Math.max(...cou.map((x) => x.meta?.score ?? 0))} · ${cou.length} Spiele` : 'Noch kein Spiel';
}

// ---------- Einstellungen ----------
function refreshSettings() {
  document.querySelectorAll('[data-key]').forEach((el) => {
    const v = settings[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });
  const c = loadCalibration();
  $('#cal-info').textContent = c ? 'Eine Kalibrierung ist gespeichert. Sie gilt nur, solange Gerät und Linien an derselben Stelle stehen.' : 'Noch keine gespeichert.';
}
document.querySelectorAll('[data-key]').forEach((el) => {
  el.addEventListener('change', () => {
    const key = el.dataset.key;
    if (el.type === 'checkbox') settings[key] = el.checked;
    else {
      const n = Number(el.value);
      settings[key] = Number.isFinite(n) && el.value !== '' ? n : DEFAULT_SETTINGS[key];
    }
    if (settings.maxDelay <= settings.minDelay) settings.maxDelay = settings.minDelay + 0.5;
    saveSettings(settings);
    refreshSettings();
  });
});
$('#btn-forget-cal').addEventListener('click', () => {
  try {
    localStorage.removeItem('tennis-reaktion-calibration-v1');
  } catch {
    /* ignorieren */
  }
  refreshSettings();
});

// ---------- Wake Lock ----------
let wake = null;
async function lockScreen() {
  try {
    wake = await navigator.wakeLock?.request('screen');
  } catch {
    /* nicht verfügbar: Bildschirm kann ausgehen */
  }
}
function unlockScreen() {
  wake?.release?.().catch(() => {});
  wake = null;
}
document.addEventListener('visibilitychange', () => {
  if (session && document.visibilityState === 'visible') lockScreen();
});

// ---------- Training ----------
class Session {
  constructor(kind) {
    this.kind = kind;
    this.exercise = kind === 'shuffle' ? EX_SHUFFLE : kind === 'decoy' ? EX_DECOY : EX_COMMANDS;
    this.decoyReact = [];
    this.sessionId = newSessionId();
    this.phase = 'loading';
    this.trials = [];
    this.setStart = Date.now();
    this.best = null;
    this.cal = null;
    this.eng = null;
    this.stopped = false;
    this.saved = false;
    this.cmdCounts = { left: 0, right: 0, front: 0 };
  }

  async start() {
    show('session');
    this.resetHud();
    this.setLoading('Kamera wird gestartet', 'Erlaube den Kamerazugriff, wenn Safari fragt.');
    lockScreen();
    const prior = (await store.listTrials(EX_SHUFFLE)).filter((t) => t.valid && t.run_ms != null);
    this.best = prior.length ? Math.min(...prior.map((t) => t.run_ms)) : null;

    try {
      if (!SIM && !navigator.mediaDevices?.getUserMedia) {
        const e = new Error('insecure');
        e.name = 'InsecureContext';
        throw e;
      }
      this.tracker = SIM ? new SimTracker() : new PoseTracker();
      this.tracker.onSample = (t, s) => this.onSample(t, s);
      this.tracker.onResize = () => this.fitFrame();
      await this.tracker.start($('#cam'), (msg) => this.setLoading('Bitte warten', msg));
    } catch (err) {
      return this.fail(err);
    }
    if (this.stopped) {
      this.tracker.stop();
      return;
    }
    this.fitFrame();
    $('#loading').hidden = true;
    this.askCalibration();
  }

  fitFrame() {
    const vw = this.tracker?.vw || 1280;
    const vh = this.tracker?.vh || 720;
    $('#frame').style.setProperty('--ar', String(vw / vh));
    $('#frame').dataset.portrait = vh > vw ? '1' : '0';
  }

  setLoading(title, text) {
    $('#loading-title').textContent = title;
    $('#loading-text').textContent = text;
    $('#loading-actions').hidden = true;
    $('#loading').hidden = false;
  }

  fail(err) {
    console.error(err);
    let msg;
    if (err?.name === 'NotAllowedError') msg = 'Der Kamerazugriff ist nicht erlaubt. Erlaube die Kamera in den Safari-Einstellungen für diese Seite und starte neu.';
    else if (err?.name === 'NotFoundError') msg = 'Es wurde keine Kamera gefunden.';
    else if (err?.name === 'InsecureContext') msg = 'Die Kamera funktioniert nur über eine HTTPS-Adresse. Öffne die App über die veröffentlichte Adresse.';
    else if (/fetch|import|network|load/i.test(String(err?.message))) msg = 'Die Erkennung konnte nicht geladen werden. Beim ersten Start wird eine Internetverbindung gebraucht.';
    else msg = `Unerwarteter Fehler: ${err?.message || err}`;
    $('#loading-title').textContent = 'Das hat nicht geklappt';
    $('#loading-text').textContent = msg;
    $('#loading-actions').hidden = false;
    $('#loading').hidden = false;
  }

  resetHud() {
    this.hideSignal();
    $('#result').hidden = true;
    $('#summary').hidden = true;
    $('#hud-big').textContent = '';
    $('#hud-sub').textContent = '';
    $('#hud-count').textContent = '';
    $('#cal-meter').hidden = true;
    $('#btn-use-cal').hidden = true;
    $('#hud').dataset.mode = '';
    $('#sim').hidden = !SIM;
  }

  hud(big, sub = '', mode = '') {
    $('#hud-big').textContent = big;
    $('#hud-sub').textContent = sub;
    $('#hud').dataset.mode = mode;
  }

  /** Kamerabild nach der Kalibrierung ausblenden (läuft unsichtbar weiter); Punkt zeigt, ob die Person erkannt wird. */
  applyCamera(running) {
    const hide = running && !settings.showCamera;
    $('#frame').classList.toggle('cam-off', hide);
    $('#track-dot').hidden = !hide;
  }

  // ----- Kalibrierung -----
  askCalibration() {
    this.calibrator = new Calibrator();
    this.phase = 'calibrate';
    this.applyCamera(false);
    $('#cal-meter').hidden = false;
    const saved = loadCalibration();
    const btn = $('#btn-use-cal');
    btn.hidden = !saved?.x0 || !saved?.s0;
    btn.onclick = () => {
      btn.hidden = true;
      this.useCal(saved, false);
    };
    if (SIM && $('#sim-auto').checked) this.tracker.autoCalibrate();
  }

  stepCalibration(t, s) {
    const r = this.calibrator.update(t, s ? { x: s.x, s: s.s, vh: s.vh } : null);
    this.hud(r.done ? 'Fertig' : 'Mitte', r.hint, 'cal');
    $('#cal-bar').style.width = `${Math.round(r.progress * 100)}%`;
    if (r.captured && settings.sound) audio.beep(988, 140);
    if (r.done) this.useCal(r.cal, true);
  }

  useCal(cal, fresh) {
    if (this.phase !== 'calibrate') return;
    this.cal = cal;
    this.phase = 'run';
    if (fresh) saveCalibration(cal);
    this.applyCamera(true);
    $('#cal-meter').hidden = true;
    $('#btn-use-cal').hidden = true;
    this.toSample = makeSample(cal);
    this.createEngine();
    const delay = cal.warning ? 3500 : 600;
    this.hud(cal.warning ? 'Achtung' : 'Los geht’s', cal.warning || '', cal.warning ? 'notice' : '');
    if (cal.warning && settings.sound) audio.beep(220, 250);
    setTimeout(() => {
      if (!this.stopped && this.eng) this.startSet();
    }, delay);
  }

  createEngine() {
    const minDelayMs = settings.minDelay * 1000;
    const maxDelayMs = Math.max(settings.maxDelay, settings.minDelay + 0.5) * 1000;
    if (this.kind === 'shuffle') {
      this.eng = new ShuffleEngine({
        params: { minDelayMs, maxDelayMs },
        onEvent: (n, d) => this.onShuffleEvent(n, d),
      });
    } else if (this.kind === 'decoy') {
      const commands = [settings.cmdLeft && 'left', settings.cmdRight && 'right', settings.cmdFront && 'front'].filter(Boolean);
      const weights = { go: 0.55, stop: settings.decoyStop ? 0.25 : 0, flip: settings.decoyFlip ? 0.2 : 0 };
      this.split = settings.splitStep;
      this.eng = new DecoyEngine({
        params: {
          commands: commands.length ? commands : ['left', 'right', 'front'],
          weights,
          splitGapMs: this.split ? Math.round(settings.splitGap * 1000) : 0,
          minDelayMs: Math.min(minDelayMs, 2000),
          maxDelayMs: Math.min(maxDelayMs, 3500),
        },
        onEvent: (n, d) => this.onDecoyEvent(n, d),
      });
    } else {
      const commands = [settings.cmdLeft && 'left', settings.cmdRight && 'right', settings.cmdFront && 'front'].filter(Boolean);
      this.eng = new CommandEngine({
        params: { commands: commands.length ? commands : ['left', 'right', 'front'], minDelayMs: Math.min(minDelayMs, 2000), maxDelayMs: Math.min(maxDelayMs, 3500) },
        onEvent: (n, d) => this.onCommandEvent(n, d),
      });
    }
  }

  startSet() {
    this.trials = [];
    this.cmdCounts = { left: 0, right: 0, front: 0 };
    this.decoyReact = [];
    this.setStart = Date.now();
    this.saved = false;
    this.updateCount();
    this.eng.start();
  }

  updateCount() {
    if (this.kind === 'shuffle') $('#hud-count').textContent = `${this.trials.length} / ${settings.rounds}`;
    else if (this.kind === 'decoy') $('#hud-count').textContent = `${this.eng?.rounds ?? 0} / ${settings.decoyRounds}`;
    else $('#hud-count').textContent = `${this.eng?.issued ?? 0} / ${settings.commandRounds}`;
  }

  // ----- Kamerabild -----
  onSample(t, s) {
    this.drawOverlay(s);
    if (this.phase === 'run') $('#track-dot').dataset.on = s ? '1' : '0';
    if (this.phase === 'calibrate') this.stepCalibration(t, s);
    else if (this.phase === 'run' && this.eng) {
      this.eng.update(t, s ? this.toSample(s) : null);
    }
  }

  drawOverlay(s) {
    const c = $('#overlay');
    const frame = $('#frame');
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const ball = '#d6f24a';
    const white = '#eef2ec';
    const line = (x, col, dash, lw = 3) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x * w, 0);
      ctx.lineTo(x * w, h);
      ctx.stroke();
    };
    const x0 = this.cal?.x0 ?? this.calibrator?.captured?.x;
    if (x0 != null) line(x0, ball, [], 4); // die kalibrierte Mittellinie
    if (s) {
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(238,242,236,0.85)';
      for (const p of s.pts) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = ball;
      ctx.strokeStyle = '#0d1b24';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    }
  }

  // ----- Signale -----
  showSignal(direction, kind = '') {
    $('#signal').dataset.kind = kind;
    const svg = $('#signal-arrow');
    svg.toggleAttribute('hidden', kind === 'split');
    svg.setAttribute('class', direction === 'left' ? 'left' : direction === 'front' ? 'front' : '');
    $('#signal-label').textContent = kind === 'split' ? 'SPLIT!' : kind === 'stop' ? 'STEHEN' : direction === 'left' ? 'LINKS' : direction === 'right' ? 'RECHTS' : 'VORNE';
    $('#result').hidden = true;
    $('#signal').hidden = false;
    if (settings.sound) audio.beep(kind === 'split' ? 784 : 1046, kind === 'split' ? 120 : 160);
    if (kind === 'split') {
      if (settings.voice) audio.speak('Split');
      return;
    }
    if ((this.kind === 'commands' || (this.kind === 'decoy' && kind === 'go')) && settings.voice) audio.speak(dirLabel[direction]);
    // Zeitpunkt, an dem der Pfeil wirklich auf dem Bildschirm stand
    const eng = this.eng;
    requestAnimationFrame(() => requestAnimationFrame(() => eng?.confirmArrow?.(performance.now())));
  }

  hideSignal() {
    $('#signal').hidden = true;
    $('#signal').dataset.kind = '';
  }

  notice(reason, sub = 'Zurück in die Mitte.') {
    this.hideSignal();
    $('#result').hidden = true;
    this.hud(reason, sub, 'notice');
    if (settings.sound) audio.beep(220, 260);
  }

  // ----- 5-10-5 -----
  onShuffleEvent(name, d) {
    switch (name) {
      case 'state':
        return this.renderShuffleState(d.state);
      case 'arrow':
        this.hud('', '', 'go'); // Statustext weg, damit nur der Pfeil zu sehen ist
        this.showSignal(d.direction);
        if (SIM && $('#sim-auto').checked) this.tracker.runShuffle(d.direction === 'left' ? -1 : 1, { reactS: 0.22 + Math.random() * 0.15 });
        return;
      case 'result':
        return this.onResult(d);
      case 'abort':
        return this.notice(d.reason);
      default:
    }
  }

  renderShuffleState(state) {
    if (state === 'wait_center') {
      this.hideSignal();
      $('#result').hidden = true;
      this.hud('Mitte', 'Stell dich auf die Mittellinie.', 'wait');
    } else if (state === 'countdown') {
      this.hud('Bereit', 'Ruhig stehen bleiben.', 'ready');
    } else if (state === 'to_a') {
      this.hideSignal();
      this.hud('', '', 'run');
    }
  }

  onResult(r) {
    this.hideSignal();
    const rec = {
      exercise: EX_SHUFFLE,
      session_id: this.sessionId,
      direction: r.direction,
      reaction_ms: r.reaction_ms,
      run_ms: r.run_ms,
      total_ms: r.total_ms,
      split_a_ms: r.split_a_ms,
      split_b_ms: r.split_b_ms,
      valid: r.valid,
      reason: r.reason,
    };
    store.addTrial(rec).then(() => cloud.scheduleSync()).catch((e) => console.warn('Speichern fehlgeschlagen', e));
    let isBest = false;
    if (r.valid) {
      this.trials.push(rec);
      if (this.best == null || r.run_ms < this.best) {
        isBest = this.best != null;
        this.best = r.run_ms;
      }
    }
    this.updateCount();
    this.hud('', '', 'result');

    const main = $('#result-main');
    const grid = $('#result-grid');
    const tag = $('#result-tag');
    if (r.valid) {
      $('#result-label').textContent = `Laufzeit nach ${r.direction === 'left' ? 'links' : 'rechts'} gestartet`;
      main.textContent = fmtS(r.run_ms);
      main.classList.remove('bad');
      grid.innerHTML = `<div><b>${fmtMs(r.reaction_ms)}</b><span>Reaktion</span></div><div><b>${fmtS(r.total_ms)}</b><span>Pfeil bis Ziel</span></div>`;
      tag.hidden = !isBest;
      tag.textContent = 'Neue Bestzeit';
    } else {
      $('#result-label').textContent = 'Nicht gewertet';
      main.textContent = r.reason;
      main.classList.add('bad');
      grid.innerHTML = r.reaction_ms != null ? `<div><b>${fmtMs(r.reaction_ms)}</b><span>Reaktion</span></div>` : '';
      tag.hidden = true;
      if (settings.sound) audio.beep(220, 260);
    }
    $('#result').hidden = false;

    if (r.valid && this.trials.length >= settings.rounds) {
      this.eng.stop();
      setTimeout(() => !this.stopped && this.finishSet(), 3200);
    }
  }

  // ----- Kreuzvorhaben (Täuschungen) -----
  onDecoyEvent(name, d) {
    switch (name) {
      case 'state': {
        const fb = this.fb;
        if (d.state === 'wait_ready') {
          this.hideSignal();
          this.hud(fb?.big ?? 'Mitte', fb?.sub ?? 'Stell dich hin und bleib kurz ruhig.', fb ? 'run' : 'wait');
        } else if (d.state === 'countdown') {
          this.hideSignal();
          const rules = settings.decoyStop || settings.decoyFlip ? 'Grün: los. Rot: stehen bleiben.' : 'Gleich kommt ein Pfeil.';
          this.hud('Bereit', this.split ? `Erst „Split!“, dann die Richtung. ${rules}` : rules, 'ready');
        } else if (d.state === 'away') {
          this.hideSignal();
          this.hud(fb?.big ?? 'Zurück', fb?.sub ?? 'Zurück in die Mitte.', 'run');
        }
        this.fb = null;
        return;
      }
      case 'split':
        this.hud('', '', 'command');
        this.showSignal(null, 'split');
        return;
      case 'signal':
        this.hud('', '', 'command');
        this.showSignal(d.command, d.type === 'stop' ? 'stop' : 'go');
        if (SIM && $('#sim-auto').checked && d.type === 'go') this.tracker.runCommand(d.command);
        return;
      case 'flip':
        // gleicher Pfeil, aber jetzt rot: bitte stoppen
        $('#signal').dataset.kind = 'stop';
        $('#signal-label').textContent = 'STEHEN';
        if (settings.sound) audio.beep(330, 220);
        return;
      case 'result': {
        this.hideSignal();
        const tag = { go: 'laufen', stop: 'stehen', flip: 'kippen' }[d.type];
        store
          .addTrial({
            exercise: EX_DECOY,
            session_id: this.sessionId,
            direction: d.command,
            reaction_ms: d.reaction_ms,
            run_ms: null,
            total_ms: null,
            split_a_ms: null,
            split_b_ms: null,
            valid: d.correct,
            reason: d.correct ? d.type : `${d.type}:${d.reason}`,
          })
          .then(() => cloud.scheduleSync())
          .catch((e) => console.warn('Speichern fehlgeschlagen', e));
        if (d.correct && d.reaction_ms != null) this.decoyReact.push(d.reaction_ms);
        if (d.correct) {
          this.fb = { big: d.type === 'go' ? (d.reaction_ms != null ? `${d.reaction_ms} ms` : 'Gut') : 'Richtig!', sub: d.type === 'go' ? 'Zurück in die Mitte.' : tag === 'kippen' ? 'Stark: nicht reingefallen.' : 'Gut gehalten.' };
          if (settings.sound) audio.beep(1318, 90);
        } else {
          this.fb = { big: d.reason, sub: d.type === 'go' ? 'Zurück in die Mitte.' : 'Rot heißt: stehen bleiben. Zurück in die Mitte.' };
          if (settings.sound) audio.beep(220, 260);
        }
        this.updateCount();
        return;
      }
      case 'timeout':
        return this.notice('Keine Bewegung erkannt', 'Ich warte, bis du wieder bereit stehst.');
      case 'round':
        this.updateCount();
        if (d.rounds >= settings.decoyRounds) {
          this.eng.stop();
          this.finishSet();
        }
        return;
      default:
    }
  }

  // ----- Befehle -----
  onCommandEvent(name, d) {
    switch (name) {
      case 'state':
        if (d.state === 'wait_ready') {
          this.hideSignal();
          this.hud('Mitte', 'Stell dich hin und bleib kurz ruhig.', 'wait');
        } else if (d.state === 'countdown') {
          this.hideSignal();
          this.hud('Bereit', '', 'ready');
        } else if (d.state === 'away') {
          this.hideSignal();
          this.hud('Zurück', 'Zurück in die Mitte.', 'run');
        }
        return;
      case 'command':
        this.cmdCounts[d.command] += 1;
        this.updateCount();
        this.hud('', '', 'command');
        this.showSignal(d.command);
        if (SIM && $('#sim-auto').checked) this.tracker.runCommand(d.command);
        return;
      case 'timeout':
        return this.notice('Keine Bewegung erkannt', 'Ich warte, bis du wieder bereit stehst.');
      case 'round':
        if (d.rounds >= settings.commandRounds) {
          this.eng.stop();
          this.finishSet();
        }
        return;
      default:
    }
  }

  // ----- Satzende -----
  async saveSession() {
    if (this.saved) return;
    if (this.kind === 'shuffle') {
      if (!this.trials.length) return;
      const runs = this.trials.map((t) => t.run_ms);
      await store.addSession({
        exercise: EX_SHUFFLE,
        session_id: this.sessionId,
        rounds: this.trials.length,
        duration_ms: Date.now() - this.setStart,
        best_run_ms: Math.min(...runs),
        avg_run_ms: Math.round(avg(runs)),
        avg_reaction_ms: Math.round(avg(this.trials.map((t) => t.reaction_ms))),
      });
    } else if (this.kind === 'decoy') {
      const done = this.eng?.rounds ?? 0;
      if (!done) return;
      await store.addSession({
        exercise: EX_DECOY,
        session_id: this.sessionId,
        rounds: done,
        duration_ms: Date.now() - this.setStart,
        avg_reaction_ms: this.decoyReact.length ? Math.round(avg(this.decoyReact)) : null,
        meta: { ...this.eng.stats, split: !!this.split },
      });
    } else {
      const done = this.eng?.rounds ?? 0;
      if (!done) return;
      await store.addSession({
        exercise: EX_COMMANDS,
        session_id: this.sessionId,
        rounds: done,
        duration_ms: Date.now() - this.setStart,
        meta: { ...this.cmdCounts },
      });
    }
    this.saved = true;
    cloud.scheduleSync();
  }

  async finishSet() {
    this.hideSignal();
    $('#result').hidden = true;
    this.hud('', '', '');
    await this.saveSession().catch((e) => console.warn(e));
    const box = $('#summary-stats');
    if (this.kind === 'shuffle') {
      const runs = this.trials.map((t) => t.run_ms);
      const side = (d) => avg(this.trials.filter((t) => t.direction === d).map((t) => t.run_ms));
      const l = side('left');
      const r = side('right');
      $('#summary-title').textContent = 'Satz beendet';
      box.innerHTML = [
        ['Beste Zeit', fmtS(Math.min(...runs))],
        ['Ø Laufzeit', fmtS(avg(runs))],
        ['Ø Reaktion', fmtMs(avg(this.trials.map((t) => t.reaction_ms)))],
        ['Ø links / rechts', `${l != null ? fmtSec(l) : '–'} / ${r != null ? fmtSec(r) : '–'}`],
      ]
        .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
        .join('');
    } else if (this.kind === 'decoy') {
      $('#summary-title').textContent = 'Einheit beendet';
      const st = this.eng.stats;
      const okAll = st.go[0] + st.stop[0] + st.flip[0];
      const totAll = st.go[1] + st.stop[1] + st.flip[1];
      const dOk = st.stop[0] + st.flip[0];
      const dTot = st.stop[1] + st.flip[1];
      box.innerHTML = [
        ['Richtig', `${okAll} / ${totAll}`],
        ['Ø Reaktion (Laufen)', this.decoyReact.length ? fmtMs(avg(this.decoyReact)) : '–'],
        ['Täuschungen bestanden', dTot ? `${dOk} / ${dTot}` : '–'],
        ['Dauer', fmtDur(Date.now() - this.setStart)],
      ]
        .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
        .join('');
    } else {
      $('#summary-title').textContent = 'Einheit beendet';
      const c = this.cmdCounts;
      box.innerHTML = [
        ['Befehle', String(this.eng.rounds)],
        ['Dauer', fmtDur(Date.now() - this.setStart)],
        ['Links / Rechts', `${c.left} / ${c.right}`],
        ['Vorne', String(c.front)],
      ]
        .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
        .join('');
    }
    $('#summary').hidden = false;
  }

  again() {
    $('#summary').hidden = true;
    this.sessionId = newSessionId();
    this.startSet();
  }

  async end() {
    if (this.stopped) return;
    this.stopped = true;
    this.eng?.stop?.();
    await this.saveSession().catch(() => {});
    this.tracker?.stop();
    unlockScreen();
    try {
      speechSynthesis?.cancel();
    } catch {
      /* ignorieren */
    }
    session = null;
    show('home');
  }
}

function startSession(kind) {
  audio.unlock();
  session = new Session(kind);
  window.__session = session;
  session.start();
}

$('#start-shuffle').addEventListener('click', () => startSession('shuffle'));
$('#start-decoy').addEventListener('click', () => startSession('decoy'));
const couch = initCouch({ store, cloud, audio, exCouch: EX_COUCH, settings: () => settings, onExit: () => show('home') });
$('#start-couch').addEventListener('click', () => {
  audio.unlock();
  show('couch');
  couch.open();
});
$('#btn-stop').addEventListener('click', () => session?.end());
$('#btn-again').addEventListener('click', () => session?.again());
$('#btn-done').addEventListener('click', () => session?.end());
$('#btn-error-back').addEventListener('click', () => session?.end());

if (SIM) {
  $('#sim-u').addEventListener('input', (e) => {
    $('#sim-auto').checked = false;
    session?.tracker?.setM?.(Number(e.target.value));
  });
  $('#sim-present').addEventListener('change', (e) => {
    if (session?.tracker) session.tracker.present = e.target.checked;
  });
}

// ---------- Verlauf ----------
let histEx = EX_SHUFFLE;
let histMetric = 'run_ms';

document.querySelectorAll('.seg [data-ex]').forEach((b) =>
  b.addEventListener('click', () => {
    histEx = b.dataset.ex;
    renderHistory();
  }),
);
document.querySelectorAll('#metric-seg button').forEach((b) =>
  b.addEventListener('click', () => {
    histMetric = b.dataset.metric;
    renderHistory();
  }),
);
window.addEventListener('resize', () => !$('#screen-history').hidden && renderHistory());

async function renderHistory() {
  document.querySelectorAll('.seg [data-ex]').forEach((b) => b.classList.toggle('on', b.dataset.ex === histEx));
  document.querySelectorAll('#metric-seg button').forEach((b) => b.classList.toggle('on', b.dataset.metric === histMetric));
  $('#hist-shuffle').hidden = histEx !== EX_SHUFFLE;
  $('#hist-commands').hidden = true;
  $('#hist-games').hidden = histEx !== EX_DECOY && histEx !== EX_COUCH;
  $('#store-note').textContent = cloud.user ? 'Gespeichert auf diesem Gerät und in deinem Konto.' : 'Gespeichert nur auf diesem Gerät.';

  if (histEx === EX_SHUFFLE) {
    const all = await store.listTrials(EX_SHUFFLE);
    const valid = all.filter((t) => t.valid && t.run_ms != null);
    const last10 = valid.slice(-10);
    const stat = (v, k) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`;
    $('#hist-stats').innerHTML = valid.length
      ? [
          stat(fmtS(Math.min(...valid.map((t) => t.run_ms))), 'Bestzeit'),
          stat(fmtS(avg(last10.map((t) => t.run_ms))), 'Ø letzte 10'),
          stat(fmtMs(Math.min(...valid.map((t) => t.reaction_ms))), 'Beste Reaktion'),
          stat(fmtMs(avg(last10.map((t) => t.reaction_ms))), 'Ø Reaktion, letzte 10'),
        ].join('')
      : '<p class="empty">Noch keine gültigen Durchgänge.</p>';

    const pts = valid.slice(-60).map((t) => ({
      v: t[histMetric],
      label: `${dayKey(t.created_at)} ${t.direction === 'left' ? 'links' : 'rechts'}`,
    }));
    drawChart($('#hist-chart'), $('#hist-tip'), pts, { fmt: histMetric === 'run_ms' ? fmtS : fmtMs });

    const byDay = new Map();
    for (const t of valid) {
      const k = dayKey(t.created_at);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(t);
    }
    const rows = [...byDay.entries()].reverse().slice(0, 30);
    $('#hist-days').innerHTML = rows.length
      ? rows
          .map(([day, ts]) => {
            const runs = ts.map((t) => t.run_ms);
            return `<div class="row"><span class="d">${day}</span><span>${ts.length}×</span><span>Best ${fmtS(Math.min(...runs))} · Ø ${fmtS(avg(runs))}</span></div>`;
          })
          .join('')
      : '<p class="empty">Noch keine Sätze.</p>';
  } else if (histEx === EX_DECOY || histEx === EX_COUCH) {
    const sessions = (await store.listSessions()).filter((s) => s.exercise === histEx || (histEx === EX_DECOY && s.exercise === EX_COMMANDS)).reverse();
    $('#hist-games-title').textContent = histEx === EX_DECOY ? 'Einheiten Reaktionsdrill' : 'Reaktionsspiel';
    const ok = (m) => (m ? ['go', 'stop', 'flip'].reduce((a, k) => a + (m[k]?.[0] ?? 0), 0) : null);
    const tot = (m) => (m ? ['go', 'stop', 'flip'].reduce((a, k) => a + (m[k]?.[1] ?? 0), 0) : null);
    $('#hist-games-list').innerHTML = sessions.length
      ? sessions
          .slice(0, 40)
          .map((x) => {
            const react = x.avg_reaction_ms != null ? ` · Ø ${fmtMs(x.avg_reaction_ms)}` : '';
            if (histEx === EX_COUCH) return `<div class="row"><span class="d">${dayKey(x.created_at)}</span><span>${x.meta?.score ?? 0} Punkte</span><span>Level ${x.meta?.level ?? 1}${react}</span></div>`;
            if (x.exercise === EX_COMMANDS) return `<div class="row"><span class="d">${dayKey(x.created_at)}</span><span>${x.rounds} Befehle</span><span>${fmtDur(x.duration_ms)}</span></div>`;
            const sp = x.meta?.split ? ' · Split' : '';
            return `<div class="row"><span class="d">${dayKey(x.created_at)}</span><span>${ok(x.meta)} / ${tot(x.meta)} richtig${sp}</span><span>${fmtDur(x.duration_ms)}${react}</span></div>`;
          })
          .join('')
      : '<p class="empty">Noch nichts gespielt.</p>';
  } else {
    const sessions = (await store.listSessions()).filter((s) => s.exercise === EX_COMMANDS).reverse();
    $('#hist-cmd-list').innerHTML = sessions.length
      ? sessions
          .slice(0, 40)
          .map((s) => `<div class="row"><span class="d">${dayKey(s.created_at)}</span><span>${s.rounds} Befehle</span><span>${fmtDur(s.duration_ms)}</span></div>`)
          .join('')
      : '<p class="empty">Noch keine Einheiten.</p>';
  }
}

$('#btn-export').addEventListener('click', async () => {
  const csv = await store.exportCSV();
  const name = `reaktionstraining-${new Date().toISOString().slice(0, 10)}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

$('#btn-delete').addEventListener('click', async () => {
  const msg = cloud.user ? 'Alle gespeicherten Zeiten auf diesem Gerät UND in deinem Konto löschen? Das lässt sich nicht rückgängig machen.' : 'Alle gespeicherten Zeiten auf diesem Gerät löschen? Das lässt sich nicht rückgängig machen.';
  if (!confirm(msg)) return;
  if (cloud.user) {
    try {
      await cloud.deleteRemote();
    } catch (e) {
      alert('Die Cloud-Daten konnten nicht gelöscht werden (' + (e?.message || e) + '). Lokal wurde nichts gelöscht.');
      return;
    }
  }
  await store.deleteAll();
  renderHistory();
});

// ---------- Konto (optional) ----------
function renderAccount() {
  const inn = !!cloud.user;
  $('#acc-out').hidden = inn;
  $('#acc-in').hidden = !inn;
  if (inn) {
    const t = cloud.syncing ? 'Abgleich läuft …' : cloud.lastSync ? `Zuletzt abgeglichen um ${cloud.lastSync.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.` : '';
    $('#acc-who').textContent = `Angemeldet als ${cloud.user.email}. ${t}`;
  }
  if (cloud.lastError) $('#acc-msg').textContent = cloud.lastError;
}
async function accAction(fn, busy) {
  const msg = $('#acc-msg');
  msg.textContent = busy;
  try {
    await fn();
    if (!$('#screen-history').hidden) renderHistory();
  } catch (e) {
    msg.textContent = e.message || String(e);
  }
}
$('#acc-login').addEventListener('click', () => {
  const email = $('#acc-email').value.trim();
  const pass = $('#acc-pass').value;
  if (!email || !pass) return ($('#acc-msg').textContent = 'Bitte E-Mail und Passwort eingeben.');
  accAction(async () => {
    await cloud.signIn(email, pass);
    $('#acc-pass').value = '';
    $('#acc-msg').textContent = '';
  }, 'Anmelden …');
});
$('#acc-register').addEventListener('click', () => {
  const email = $('#acc-email').value.trim();
  const pass = $('#acc-pass').value;
  if (!email || pass.length < 6) return ($('#acc-msg').textContent = 'Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen eingeben.');
  accAction(async () => {
    const now = await cloud.signUp(email, pass);
    $('#acc-pass').value = '';
    $('#acc-msg').textContent = now ? '' : 'Fast geschafft: Bestätige die E-Mail, die wir dir geschickt haben, und melde dich dann an.';
  }, 'Konto wird angelegt …');
});
$('#acc-logout').addEventListener('click', () => accAction(() => cloud.signOut(), ''));
$('#acc-sync').addEventListener('click', () => accAction(() => cloud.sync(), 'Abgleich läuft …'));
cloud.onChange(() => {
  renderAccount();
  if (!cloud.syncing && !$('#screen-history').hidden) renderHistory();
  if (!cloud.lastError && !cloud.syncing) $('#acc-msg').textContent = $('#acc-msg').textContent.startsWith('Abgleich') ? '' : $('#acc-msg').textContent;
});
cloud.init();
window.addEventListener('online', () => cloud.sync());
renderAccount();

// ---------- Start ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !params.has('nosw')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker nicht registriert', e));
}
window.__app = { store, show, get session() { return session; } };
show('home');
