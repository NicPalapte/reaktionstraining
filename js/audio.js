// Töne und Sprachausgabe. iOS erlaubt beides erst nach einer Berührung, deshalb unlock().
// iOS hält den Audio-Kontext nach dem Kamerastart oder beim Wechsel in den Hintergrund oft an:
// darum vor jedem Ton aufwecken und bei jeder Berührung erneut entsperren.

let ctx = null;
let warmed = false;
let muted = false;

/** Stumm (Schalter im Drill): keine Töne, keine Ansagen; eine laufende Ansage wird abgebrochen. */
export function setMuted(on) {
  muted = !!on;
  if (muted && 'speechSynthesis' in window) speechSynthesis.cancel();
}

export function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // Sprachausgabe einmal "anwärmen" (nur beim ersten Mal, sonst würde es laufende Ansagen stören)
    if (!warmed && 'speechSynthesis' in window) {
      warmed = true;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {
    /* kein Ton verfügbar */
  }
}

/** Jede Berührung entsperrt erneut; nach dem Zurückkehren in die App aufwecken. */
export function keepAlive() {
  for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, () => unlock(), { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });
}

export function beep(freq = 880, ms = 120, gain = 0.25) {
  if (!ctx || muted) return;
  try {
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + ms / 1000 + 0.02);
  } catch {
    /* ignorieren */
  }
}

let voice = null;
function pickVoice() {
  try {
    voice ??= speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('de')) ?? null;
  } catch {
    /* ignorieren */
  }
  return voice;
}

/**
 * Text ansagen. Läuft gerade eine Ansage, wird sie abgebrochen – aber nur dann: cancel() direkt vor speak()
 * verschluckt in Safari sonst manchmal die neue Ansage.
 */
export function speak(text) {
  if (muted || !('speechSynthesis' in window)) return;
  try {
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.1;
    speechSynthesis.speak(u);
    if (speechSynthesis.paused) speechSynthesis.resume(); // Safari hängt nach dem Hintergrund manchmal pausiert
  } catch {
    /* ignorieren */
  }
}

/** Zahl für die Ansage: 13,27 -> "13,3" (Komma wird deutsch gelesen). */
export const sayNum = (v, digits = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: digits });
