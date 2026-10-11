// Oberfläche des Couch-Spiels (Regeln stehen in couch-engine.js). Kein Kamerazugriff.

import { CouchGame } from './couch-engine.js';
import { newSessionId } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const LABEL = { left: 'LINKS', right: 'RECHTS', front: 'VORNE' };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function initCouch({ store, cloud, audio, exCouch, settings, onExit }) {
  let game = null;
  let raf = 0;
  let sessionId = null;
  let startedAt = 0;
  let reacts = [];
  let saved = false;
  let levelMsg = null;

  const arena = $('#couch-arena');
  const arrow = $('#couch-arrow');
  const big = $('#couch-big');
  const sub = $('#couch-sub');
  const beep = (f, ms) => settings().sound && audio.beep(f, ms);

  function view({ kind = '', text = '', hint = '', dir = null }) {
    arena.dataset.kind = kind;
    big.textContent = text;
    sub.textContent = hint;
    arrow.toggleAttribute('hidden', !dir);
    if (dir) arrow.setAttribute('class', dir === 'left' ? 'left' : dir === 'front' ? 'front' : '');
  }

  function setScore({ score, level, lives }) {
    $('#couch-score').textContent = String(score);
    $('#couch-level').textContent = `Level ${level}`;
    $('#couch-lives').textContent = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives));
  }

  function onEvent(name, d) {
    switch (name) {
      case 'state':
        if (d.state === 'wait') view({ text: '…', hint: levelMsg ?? '' });
        if (d.state === 'wait') levelMsg = null;
        return;
      case 'signal':
        view({ kind: d.type === 'stop' ? 'stop' : d.type === 'fake' ? 'fake' : 'go', text: d.type === 'stop' ? 'STEHEN' : LABEL[d.command], dir: d.command });
        beep(d.type === 'stop' ? 523 : d.type === 'fake' ? 784 : 1046, 140);
        return;
      case 'flip':
        view({ kind: 'stop', text: 'STEHEN', dir: game?.cmd });
        beep(330, 200);
        return;
      case 'result': {
        const type = d.type ?? 'early';
        store
          .addTrial({
            exercise: exCouch,
            session_id: sessionId,
            direction: d.command,
            reaction_ms: d.reaction_ms,
            run_ms: null,
            total_ms: null,
            split_a_ms: null,
            split_b_ms: null,
            valid: d.ok,
            reason: d.ok ? type : `${type}:${d.reason}`,
          })
          .then(() => cloud.scheduleSync())
          .catch((e) => console.warn('Speichern fehlgeschlagen', e));
        if (d.ok && d.reaction_ms != null) reacts.push(d.reaction_ms);
        if (d.ok && d.type === 'fake') {
          view({ kind: 'ok', text: 'Fake!', hint: `+${d.points}` });
          beep(988, 70);
        } else if (d.ok) {
          view({ kind: 'ok', text: `+${d.points}`, hint: d.reaction_ms != null ? `${d.reaction_ms} ms${d.streak >= 3 ? ` · ${d.streak}er Serie` : ''}` : 'Nicht reingefallen!' });
          beep(1318, 80);
        } else {
          view({ kind: 'bad', text: d.reason, hint: d.lives > 0 ? `Noch ${d.lives} ${d.lives === 1 ? 'Leben' : 'Leben'}` : '' });
          beep(220, 260);
        }
        return;
      }
      case 'level':
        levelMsg = `Level ${d.level}: schneller und mehr Täuschungen`;
        return;
      case 'score':
        setScore(d);
        return;
      case 'over':
        return gameOver(d);
      default:
    }
  }

  async function save() {
    if (saved || !game || !game.rounds) return;
    saved = true;
    await store
      .addSession({
        exercise: exCouch,
        session_id: sessionId,
        rounds: game.rounds,
        duration_ms: Date.now() - startedAt,
        avg_reaction_ms: reacts.length ? Math.round(avg(reacts)) : null,
        meta: { score: game.score, level: game.level, bestStreak: game.bestStreak },
      })
      .catch((e) => console.warn('Speichern fehlgeschlagen', e));
    cloud.scheduleSync();
  }

  async function gameOver(d) {
    cancelAnimationFrame(raf);
    const prev = (await store.listSessions()).filter((x) => x.exercise === exCouch).map((x) => x.meta?.score ?? 0);
    const record = d.score > 0 && d.score > Math.max(0, ...prev);
    await save();
    $('#couch-over-title').textContent = record ? 'Neuer Highscore!' : 'Spiel vorbei';
    $('#couch-over-stats').innerHTML = [
      ['Punkte', String(d.score)],
      ['Level', String(d.level)],
      ['Beste Serie', String(d.bestStreak)],
      ['Ø Reaktion', reacts.length ? `${Math.round(avg(reacts))} ms` : '–'],
    ]
      .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
      .join('');
    $('#couch-over').hidden = false;
  }

  function loop() {
    game?.update(performance.now());
    raf = requestAnimationFrame(loop);
  }

  function begin() {
    $('#couch-over').hidden = true;
    $('#couch-start').hidden = true;
    sessionId = newSessionId();
    startedAt = Date.now();
    reacts = [];
    saved = false;
    levelMsg = null;
    game = new CouchGame({ onEvent });
    game.start(performance.now());
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  async function leave() {
    cancelAnimationFrame(raf);
    await save();
    game = null;
    onExit();
  }

  function open() {
    cancelAnimationFrame(raf);
    game = null;
    $('#couch-over').hidden = true;
    $('#couch-start').hidden = false;
    setScore({ score: 0, level: 1, lives: 3 });
    view({ text: 'Bereit?', hint: 'Grün: tippe die Richtung. Rot: nicht tippen. Blau: Fake, ignorieren. Manchmal kippt Grün auf Rot.' });
  }

  document.querySelectorAll('#couch-pads .pad').forEach((b) =>
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const t = performance.now();
      b.classList.add('hit');
      setTimeout(() => b.classList.remove('hit'), 120);
      if (game && (game.state === 'wait' || game.state === 'signal')) game.tap(t, b.dataset.dir);
    }),
  );
  $('#couch-start').addEventListener('click', begin);
  $('#couch-again').addEventListener('click', begin);
  $('#couch-done').addEventListener('click', leave);
  $('#couch-exit').addEventListener('click', leave);

  window.__couch = { open, begin, get game() { return game; } };
  return { open };
}
