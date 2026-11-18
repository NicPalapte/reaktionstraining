// Krafttraining: der Trainingsplan ist kein Code, sondern ein Dokument je Nutzer (gespeichert als Zeile "plan",
// Import über Einstellungen → Krafttraining). Hier: Plan prüfen und laden, dazu reine Hilfsfunktionen (ohne DOM, testbar).
//
// Plan-Datei (format "tennis-plan", version 1):
//   { name, start: "JJJJ-MM-TT" (Montag von W1), info: [[k, v]], warmup: [Übung], cooldown: [Übung],
//     routine: [{ title, target, days: [1 = Mo … 7 = So], items: [Übung] }], routineNotes: [Text],
//     phases: [{ id, name, weeks: [n], dl, goal, details: [[k, v]], weekExtra, check?, routineNotes?,
//                units: [{ id, title, name, gym, intro?, warmup?: [Übung], items: [Übung], block?: [Übung] }] }] }
//   Übung: { ex: Bibliotheks-ID, target?, name?, id?, from? }. Name, Kamera-Drill und Zeitmessung kommen aus der
//   Bibliothek; name überschreibt nur die Anzeige. id trennt Varianten derselben Übung (z. B. Kontrastsprung), sonst = ex.
//   exercises?: [{ id, name, desc, cat?, equip?, cues?, why?, time?, ph? }] eigene Übungen, die nicht in der Bibliothek
//   stehen. desc (Ausführung) ist Pflicht. Sie gehören zum Plan des Nutzers und erscheinen solange in der Bibliothek.
//   Einträge laufen unter Phase|Einheit|id|Woche, so passen "Zuletzt" und Verlauf über Phasen hinweg.
// Gym-Einheiten bekommen warmup und cooldown, Sprint-Einheiten ihr eigenes warmup.

import { LIB, libOf, BUILTIN_IDS, cleanExercise, setCustomExercises, validExId } from './library.js';

export const PLAN_ID = 'plan';

// Aktueller Plan. Live-Bindings: wer importiert, sieht nach setPlan() den neuen Stand.
export let PLAN = null; // geprüftes Dokument, wie gespeichert
export let PLAN_NAME = '';
export let PHASES = [];
export let WARMUP = [];
export let COOLDOWN = [];
export let ROUTINE = [];
export let ROUTINE_NOTES = [];
export let ROUTINE_PHASE = {};
export let INFO = [];
export let LAST_WEEK = 1;

const str = (v, max = 300) => (v == null ? '' : String(v).slice(0, max));
const pairs = (v) => (Array.isArray(v) ? v.slice(0, 40).filter((p) => Array.isArray(p)).map(([k, x]) => [str(k, 80), str(x)]) : []);
const texts = (v) => (Array.isArray(v) ? v.slice(0, 40).map((t) => str(t)) : []);

/** Übung aus der Datei → Eintrag im Plan (mit Feldern aus der Bibliothek). */
export function planItem(raw, lookup = (id) => LIB.get(id)) {
  const lib = lookup(raw.ex);
  const id = str(raw.id || raw.ex, 60);
  const { app, time, shuttle, ph } = lib;
  return {
    id, ...(id !== lib.id ? { lib: lib.id } : {}),
    name: str(raw.name, 120) || lib.name, target: str(raw.target, 200),
    ...(app ? { app } : {}), ...(time ? { time } : {}), ...(shuttle ? { shuttle } : {}), ...(ph ? { ph } : {}),
    ...(Number(raw.from) > 0 ? { from: Number(raw.from) } : {}),
  };
}

/**
 * Plan-Datei prüfen.
 * @returns {string[]} Fehler (leer = in Ordnung)
 */
export function validatePlan(doc) {
  const err = [];
  if (!doc || typeof doc !== 'object' || doc.format !== 'tennis-plan') return ['Kein Trainingsplan (format "tennis-plan" fehlt).'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.start ?? '') || Number.isNaN(Date.parse(doc.start))) err.push('start fehlt oder ist kein Datum (JJJJ-MM-TT).');
  if (!Array.isArray(doc.phases) || !doc.phases.length) return [...err, 'Der Plan hat keine Phasen.'];
  if (doc.exercises != null && !Array.isArray(doc.exercises)) err.push('exercises: keine Liste.');
  for (const x of doc.exercises ?? []) {
    if (!validExId(x?.id)) err.push(`Eigene Übung "${x?.id ?? ''}": ID fehlt oder enthält "|".`);
    else if (String(x.desc ?? '').trim().length < 20) err.push(`Eigene Übung "${x.id}": Beschreibung der Ausführung (desc) fehlt.`);
  }
  const known = knownIds(doc);
  const unknown = new Set();
  const items = (list, where) => {
    if (list == null) return;
    if (!Array.isArray(list)) return err.push(`${where}: keine Liste.`);
    for (const it of list) if (!it || !known.has(it.ex)) unknown.add(it?.ex ?? '(leer)');
  };
  items(doc.warmup, 'warmup');
  items(doc.cooldown, 'cooldown');
  for (const g of doc.routine ?? []) items(g.items, `routine ${g.title}`);
  const phaseIds = new Set();
  const weeks = new Set();
  for (const p of doc.phases) {
    const pid = str(p?.id, 20);
    if (!pid || phaseIds.has(pid)) err.push(`Phase "${pid}": ID fehlt oder doppelt.`);
    phaseIds.add(pid);
    if (!Array.isArray(p.weeks) || !p.weeks.length || !p.weeks.every((w) => Number.isInteger(w) && w >= 1 && w <= 104)) err.push(`Phase ${pid}: weeks muss Wochen 1–104 enthalten.`);
    else for (const w of p.weeks) {
      if (weeks.has(w)) err.push(`W${w} steht in mehreren Phasen.`);
      weeks.add(w);
    }
    if (!Array.isArray(p.units) || !p.units.length) {
      err.push(`Phase ${pid}: keine Einheiten.`);
      continue;
    }
    const unitIds = new Set();
    for (const u of p.units) {
      const uid = str(u?.id, 20);
      if (!uid || unitIds.has(uid)) err.push(`Phase ${pid}: Einheit "${uid}" ohne ID oder doppelt.`);
      unitIds.add(uid);
      items(u.items, `${pid} ${uid}`);
      items(u.block, `${pid} ${uid} block`);
      items(u.warmup, `${pid} ${uid} warmup`);
      const ids = [...(u.items ?? []), ...(u.block ?? [])].map((it) => it?.id || it?.ex);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dup.length) err.push(`${pid} ${uid}: ${[...new Set(dup)].join(', ')} doppelt (eigene id vergeben).`);
    }
  }
  if (unknown.size)
    err.push(`Nicht in der Übungsbibliothek: ${[...unknown].join(', ')}. Eigene Übungen gehören mit id, name und Beschreibung (desc) unter "exercises".`);
  return err;
}

/** Eingebaute Übungen plus die eigenen aus dem Plan. */
const ownExercises = (doc) => new Map((doc.exercises ?? []).map(cleanExercise).filter(Boolean).map((x) => [x.id, x]));
const knownIds = (doc) => new Set([...BUILTIN_IDS, ...ownExercises(doc).keys()]);

/** Alle Übungs-IDs, auf die der Plan verweist (Übungen und Tausch-Ziele in hist). */
function referencedEx(doc) {
  const out = new Map(); // id → Name aus dem Plan (für neu angelegte Übungen)
  const add = (id, name) => typeof id === 'string' && id && !out.get(id) && out.set(id, name || '');
  const items = (l) => (Array.isArray(l) ? l : []).forEach((it) => {
    add(it?.ex, it?.name);
    for (const h of Array.isArray(it?.hist) ? it.hist : []) if (h?.to) add(h.to, h.name);
  });
  items(doc.warmup);
  items(doc.cooldown);
  for (const g of doc.routine ?? []) items(g?.items);
  for (const p of doc.phases ?? []) for (const u of p?.units ?? []) [u?.items, u?.block, u?.warmup].forEach(items);
  return out;
}

/** Geprüftes Dokument in die Form für App und Hilfsfunktionen bringen (ohne Seiteneffekte). */
export function normalizePlan(doc) {
  const own = ownExercises(doc);
  const lookup = (id) => own.get(id) ?? (BUILTIN_IDS.has(id) ? LIB.get(id) : undefined);
  const items = (l) => (Array.isArray(l) ? l.map((it) => planItem(it, lookup)) : []);
  const phases = doc.phases.map((p) => ({
    id: str(p.id, 20), name: str(p.name, 80), weeks: [...p.weeks].sort((a, b) => a - b), dl: Number(p.dl) || null,
    goal: str(p.goal), details: pairs(p.details), weekExtra: str(p.weekExtra, 80) || 'Notiz',
    ...(Array.isArray(p.check) && p.check.length ? { check: texts(p.check) } : {}),
    units: p.units.map((u) => ({
      id: str(u.id, 20), title: str(u.title, 40) || str(u.id, 20), name: str(u.name, 80), gym: !!u.gym,
      ...(u.intro ? { intro: str(u.intro) } : {}),
      ...(u.warmup?.length ? { warmup: items(u.warmup) } : {}),
      items: items(u.items),
      ...(u.block?.length ? { block: items(u.block) } : {}),
    })),
  }));
  phases.sort((a, b) => a.weeks[0] - b.weeks[0]);
  const [y, m, d] = doc.start.split('-').map(Number);
  return {
    name: str(doc.name, 80), start: Date.UTC(y, m - 1, d), phases,
    warmup: items(doc.warmup), cooldown: items(doc.cooldown),
    routine: (doc.routine ?? []).map((g) => ({ title: str(g.title, 80), target: str(g.target), days: (g.days ?? []).filter((x) => x >= 1 && x <= 7), items: items(g.items) })),
    routineNotes: texts(doc.routineNotes),
    routinePhase: Object.fromEntries(doc.phases.filter((p) => p.routineNotes?.length).map((p) => [str(p.id, 20), texts(p.routineNotes)])),
    info: pairs(doc.info),
  };
}

/** Plan setzen (null = kein Plan). Wirft bei ungültigem Dokument. */
export function setPlan(doc) {
  if (doc) {
    const err = validatePlan(doc);
    if (err.length) throw new Error(err.join(' '));
  }
  setCustomExercises(doc?.exercises ?? []);
  const n = doc ? normalizePlan(doc) : null;
  PLAN = doc ?? null;
  PLAN_NAME = n?.name ?? '';
  PHASES = n?.phases ?? [];
  WARMUP = n?.warmup ?? [];
  COOLDOWN = n?.cooldown ?? [];
  ROUTINE = n?.routine ?? [];
  ROUTINE_NOTES = n?.routineNotes ?? [];
  ROUTINE_PHASE = n?.routinePhase ?? {};
  INFO = n?.info ?? [];
  LAST_WEEK = Math.max(1, ...PHASES.flatMap((p) => p.weeks));
  W1 = n?.start ?? Date.UTC(2026, 8, 28);
}

// ---------- Kalender: W1 beginnt am Montag aus plan.start ----------
let W1 = Date.UTC(2026, 8, 28);
const DAY = 86400000;
const utcDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/** Trainingswoche zu einem Datum (kann < 1 oder > letzte Woche sein). */
export const weekOf = (date) => Math.floor((utcDay(date) - W1) / DAY / 7) + 1;

/** Montag der Woche als lokales Datum. */
export function weekStart(n) {
  const d = new Date(W1 + (n - 1) * 7 * DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const fmtDate = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;

/** Phase, in der die Woche liegt; davor die erste, danach die letzte (ohne Plan null). */
export function phaseOfWeek(n) {
  const hit = PHASES.find((p) => p.weeks.includes(n));
  if (hit || !PHASES.length) return hit ?? null;
  // Lücke oder außerhalb: Phase mit der letzten Woche davor, vor dem Start die erste
  let best = null;
  for (const p of PHASES) for (const w of p.weeks) if (w <= n && (!best || w > best.w)) best = { p, w };
  return best?.p ?? PHASES[0];
}

/** Wochentag 1 = Mo … 7 = So. */
export const isoDay = (date) => ((date.getDay() + 6) % 7) + 1;

export const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------- Einträge ----------
export const exKey = (phase, unit, ex, week) => `ex|${phase}|${unit}|${ex}|${week}`;
export const weekKey = (phase, week) => `week|${phase}|${week}`;
export const checkKey = (phase, unit, item, week) => `chk|${phase}|${unit}|${item}|${week}`;
export const dayKey = (date, item) => `day|${dateKey(date)}|${item}`;

/**
 * Alle Ergebnisse aus den gespeicherten Zeilen.
 * @param {Map<string, object>} rows gespeicherte Zeilen nach id
 * @returns {{phase, unit, ex, week, value, note}[]}
 */
export function results(rows) {
  const out = new Map();
  for (const r of rows.values()) {
    if (!r.id.startsWith('ex|')) continue;
    const [, phase, unit, ex, week] = r.id.split('|');
    out.set(r.id, { phase, unit, ex, week: Number(week), value: r.value ?? '', reps: r.reps ?? '', note: r.note ?? '' });
  }
  return [...out.values()].filter((e) => e.value || e.reps || e.note);
}

/** Letztes Ergebnis derselben Übung vor dieser Woche (in derselben Woche aus einer früheren Einheit nicht). */
export function lastResult(all, ex, week, unit) {
  let best = null;
  for (const e of all) {
    if (e.ex !== ex || e.week >= week) continue;
    if (!best || e.week > best.week || (e.week === best.week && e.unit === unit)) best = e;
  }
  return best;
}

/** Kurztext eines Ergebnisses: "40 kg × 8 · Notiz". */
export const resultText = (e) => [[e.value, e.reps && `× ${e.reps}`].filter(Boolean).join(' '), e.note].filter(Boolean).join(' · ');

const num = (t) => Number(t.replace(',', '.'));

/**
 * Zahlen aus der Freitext-Eingabe für das Diagramm.
 * Gewicht: höchste Zahl vor "kg" ("50 - 45 kg" = 50). Wdh: Feld "Wdh" (bei "3 × 8" die 8, bei "8, 8, 6" der Schnitt)
 * oder "10 Wdh" im Wert. Sonst Zeit (s) oder Weite (cm/m) aus dem Wert.
 * @returns {{kg: number|null, reps: number|null, s: number|null, cm: number|null}}
 */
export function parseResult({ value = '', reps = '' }) {
  const out = { kg: null, reps: null, s: null, cm: null };
  const v = value.replace(/(\d),(\d)/g, '$1.$2');
  const kg = v.match(/([\d.]+(?:\s*[-–\/]\s*[\d.]+)*)\s*kg/i);
  if (kg) out.kg = Math.max(...kg[1].split(/[-–\/]/).map((t) => Number(t.trim())).filter(Number.isFinite));
  const r = String(reps).trim();
  if (r) {
    const times = r.match(/[×x*]\s*(\d+(?:[.,]\d+)?)/i);
    const all = (r.match(/\d+(?:[.,]\d+)?/g) ?? []).map(num);
    out.reps = times ? num(times[1]) : all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  } else {
    const w = v.match(/([\d.]+)\s*(?:wdh|reps|x\b)/i);
    if (w) out.reps = Number(w[1]);
  }
  const sec = v.match(/([\d.]+)\s*(?:s|sek|sec)\b/i);
  if (sec) out.s = Number(sec[1]);
  const cm = v.match(/([\d.]+)\s*(cm|m)\b/i);
  if (cm) out.cm = Number(cm[1]) * (cm[2].toLowerCase() === 'm' ? 100 : 1);
  for (const k of Object.keys(out)) if (!Number.isFinite(out[k])) out[k] = null;
  return out;
}

/**
 * Übungen nach Einheit gruppiert (Einheit, in der die Übung zuerst vorkommt; Schulterblatt-Block eigene Gruppe am Ende),
 * innerhalb der Gruppe in Planreihenfolge, mit dem Namen aus der neuesten Phase.
 */
export function exerciseList() {
  const map = new Map();
  const groups = new Map();
  const group = (id, label) => {
    if (!groups.has(id)) groups.set(id, { id, label, order: id === 'SB' ? Infinity : groups.size });
    return groups.get(id);
  };
  for (const p of PHASES)
    for (const u of p.units)
      for (const [it, g] of [
        ...u.items.map((it) => [it, () => group(u.id, [u.title, u.name].filter(Boolean).join(' · '))]),
        ...(u.block ?? []).map((it) => [it, () => group('SB', 'Schulterblatt-Block')]),
      ]) {
        const prev = map.get(it.id);
        map.set(it.id, { id: it.id, name: it.name.startsWith('+') ? `${it.name.replace(/^\+\s*/, '')} (Kontrast)` : it.name, shuttle: !!it.shuttle, time: !!it.time, order: prev?.order ?? map.size, group: prev?.group ?? g() });
      }
  return [...map.values()].sort((a, b) => a.group.order - b.group.order || a.order - b.order);
}

/** Alle Ergebnisse einer Übung, älteste zuerst. */
export const historyOf = (all, ex) => all.filter((e) => e.ex === ex).sort((a, b) => a.week - b.week || a.unit.localeCompare(b.unit));

// ---------- Übungen tauschen (Plan-Editor light) ----------
// Ein Tausch gilt für eine Übung in einer Einheit einer Phase, ab einer Woche. Vergangene Wochen bleiben, wie sie
// trainiert wurden. Gespeichert als Zeile swap|Phase|Einheit|Übung mit hist = [{ from, to, target, name? }] (nach from
// sortiert, to = Bibliotheks-ID, leer = zurück zur Planübung). Einträge der getauschten Übung laufen unter ihrer
// eigenen ID, so passen "Zuletzt" und Verlauf zur neuen Übung.

export const swapKey = (phase, unit, item) => `swap|${phase}|${unit}|${item}`;

/** Tausch-Stufen einer Zeile; alte Zeilen ohne hist ({ to, target }) gelten ab W1. */
const swapHist = (row) => (Array.isArray(row?.hist) ? row.hist : row?.to != null ? [{ from: 1, to: row.to, target: row.target }] : []);

/** Für die Woche gültige Stufe oder null. */
export function swapAt(row, week) {
  let cur = null;
  for (const h of swapHist(row)) if (h.from <= week && (!cur || h.from >= cur.from)) cur = h;
  return cur;
}

/**
 * Neue Tausch-Stufe ab einer Woche. Spätere Stufen fallen weg, frühere bleiben unverändert.
 * @returns {{hist: object[]}} Felder für die gespeicherte Zeile
 */
export function addSwap(row, { from, to, target = '', name = '' }) {
  const keep = swapHist(row).filter((h) => h.from < from);
  const prev = keep.length ? keep[keep.length - 1] : null;
  // Gleicher Stand wie davor: keine neue Stufe nötig
  if ((prev?.to ?? '') === to && (!to || (prev?.target ?? '') === target)) return { hist: keep, to: undefined, target: undefined };
  return { hist: [...keep, { from, to, target: to ? target : '', ...(to && name ? { name } : {}) }], to: undefined, target: undefined };
}

/**
 * Plan-Eintrag in einer Woche nach einem Tausch.
 * @param {object} item Eintrag aus dem Plan
 * @param {object|undefined} row gespeicherte Zeile
 * @param {number} week Trainingswoche
 * @returns {object} der Eintrag selbst oder die getauschte Übung mit swappedFrom
 */
export function applySwap(item, row, week) {
  const h = swapAt(row, week);
  const to = h?.to && LIB.get(h.to);
  if (!to || to.id === (item.lib ?? item.id)) return item;
  const { id, app, time, shuttle, ph } = to;
  return { id, name: h.name?.trim() || to.name, target: h.target?.trim() || item.target, app, time, shuttle, ph, from: item.from, swappedFrom: item, swapFrom: h.from };
}

/** Wo die Übung im Plan vorkommt: [{ phase, unit }] in Planreihenfolge. */
export function occurrencesOf(itemId) {
  const out = [];
  for (const p of PHASES)
    for (const u of p.units) if ([...u.items, ...(u.block ?? [])].some((it) => it.id === itemId)) out.push({ phase: p.id, unit: u.id });
  return out;
}

/** Tauschkandidaten: gleiche Kategorie zuerst, die Übung selbst und schon in der Einheit vorhandene Übungen nicht. */
export function swapCandidates(item, taken = []) {
  const self = libOf(item);
  const skip = new Set([self?.id, ...taken]);
  const list = [...LIB.values()].filter((x) => !skip.has(x.id) && x.cat !== 'warmup' && x.cat !== 'mobil');
  return self ? [...list.filter((x) => x.cat === self.cat), ...list.filter((x) => x.cat !== self.cat)] : list;
}

// ---------- Plan exportieren und importieren ----------
// Export: das Plan-Dokument, jede Übung mit ihren Tausch-Stufen (hist). Import: der Plan aus der Datei ersetzt den
// bisherigen. Steht an einer Stelle (gleiche Phase und Einheit, gleiche id, sonst gleiche Reihenfolge) in einer Woche
// eine andere Übung oder Vorgabe, entscheidet der Nutzer: hier behalten oder aus der Datei, für alle Wochen oder ab jetzt.

/** Alle Stellen im Plan in Planreihenfolge: [{ phase, unit, item }] (item = Eintrag aus dem Plan). */
export function planSlots(phases = PHASES) {
  const out = [];
  for (const p of phases) for (const u of p.units) for (const it of [...u.items, ...(u.block ?? [])]) out.push({ phase: p, unit: u, item: it });
  return out;
}

/** Tausch-Stufen aus einer Datei: nur bekannte Felder. */
export const cleanHist = (hist) =>
  (Array.isArray(hist) ? hist : []).slice(0, 50).map((h) => ({
    from: Math.max(1, Number(h?.from) || 1), to: String(h?.to ?? '').slice(0, 60), target: String(h?.target ?? '').slice(0, 200),
    ...(h?.name ? { name: String(h.name).slice(0, 120) } : {}),
  }));

/** Tausch-Stufen bereinigt (nach from sortiert, ohne doppelte Stände). */
export function normHist(hist) {
  let row = { hist: [] };
  for (const h of [...(hist ?? [])].sort((a, b) => a.from - b.from)) row = addSwap(row, h);
  return row.hist;
}

const rawLists = (u) => [u.items ?? [], u.block ?? []];
const rawId = (it) => it.id || it.ex;

/** Plan-Dokument zum Exportieren: jede Übung mit ihren Tausch-Stufen (hist: from, to = Bibliotheks-ID, target, name?). */
export function exportPlan(rows) {
  if (!PLAN) return null;
  const doc = structuredClone(PLAN);
  for (const p of doc.phases)
    for (const u of p.units)
      for (const it of rawLists(u).flat()) {
        const hist = normHist(swapHist(rows.get(swapKey(p.id, u.id, rawId(it)))));
        delete it.hist;
        if (hist.length) it.hist = hist;
      }
  return doc;
}

/** Für die Woche gültige Übung als Vergleichsschlüssel. */
const stateAt = (item, hist, week) => {
  if (item.from && week < item.from) return '-';
  const it = applySwap(item, { hist }, week);
  return `${it.id}|${String(it.target ?? '').trim()}`;
};

/** Abschnitte einer Stelle über Wochen: [{ from, until, id, lib, name, target }]. */
export function slotSummary(item, hist, weeks) {
  const out = [];
  for (const w of weeks) {
    const it = applySwap(item, { hist }, w);
    const last = out.at(-1);
    if (last && last.id === it.id && last.target === (it.target ?? '')) last.until = w;
    else out.push({ from: w, until: w, id: it.id, lib: it.swappedFrom ? it.id : it.lib ?? it.id, name: it.name, target: it.target ?? '' });
  }
  return out;
}

/** Stellen beider Pläne zuordnen: erst gleiche id, dann übrige in Reihenfolge. Je Liste (Übungen, Block) getrennt. */
function pairItems(local, incoming) {
  const pairs = [];
  const usedL = new Set();
  const restI = [];
  incoming.forEach((it, j) => {
    const k = local.findIndex((l, n) => !usedL.has(n) && l.id === it.id);
    if (k >= 0) {
      usedL.add(k);
      pairs.push([k, j]);
    } else restI.push(j);
  });
  const restL = local.map((_, n) => n).filter((n) => !usedL.has(n));
  for (let n = 0; n < Math.min(restL.length, restI.length); n++) pairs.push([restL[n], restI[n]]);
  return pairs;
}

/**
 * Abweichungen zwischen dem Plan hier (mit Tauschen) und dem Plan aus der Datei (mit hist).
 * @param {Map<string, object>} rows gespeicherte Zeilen
 * @param {object} doc geprüfte Plan-Datei
 * @param {number} curWeek aktuelle Trainingswoche
 * @returns {object[]} je Abweichung { phase, unit, local, localHist, localRaw, item, hist, at, past, future }
 */
export function planConflicts(rows, doc, curWeek) {
  if (!PLAN) return [];
  const inc = normalizePlan(doc);
  const out = [];
  for (const p of inc.phases) {
    const lp = PHASES.find((x) => x.id === p.id);
    const rawP = doc.phases.find((x) => String(x.id) === p.id);
    const rawLP = PLAN.phases.find((x) => String(x.id) === p.id);
    if (!lp) continue;
    for (const u of p.units) {
      const lu = lp.units.find((x) => x.id === u.id);
      if (!lu) continue;
      const rawU = rawP.units.find((x) => String(x.id) === u.id);
      const rawLU = rawLP.units.find((x) => String(x.id) === u.id);
      [[lu.items, u.items], [lu.block ?? [], u.block ?? []]].forEach(([L, I], list) => {
        for (const [k, j] of pairItems(L, I)) {
          const local = L[k];
          const item = I[j];
          const localHist = normHist(swapHist(rows.get(swapKey(p.id, u.id, local.id))));
          const hist = normHist(cleanHist(rawLists(rawU)[list][j].hist));
          const diff = p.weeks.filter((w) => stateAt(local, localHist, w) !== stateAt(item, hist, w));
          if (!diff.length) continue;
          out.push({
            phase: p, unit: u, local, localHist, localRaw: rawLists(rawLU)[list][k], item, hist,
            at: { list, index: j }, past: diff.some((w) => w < curWeek), future: diff.some((w) => w >= curWeek),
          });
        }
      });
    }
  }
  return out;
}

/**
 * Neuen Plan aus der Datei und den Antworten bauen.
 * @param {object} doc geprüfte Plan-Datei (mit hist)
 * @param {{conflict: object, pick: 'local'|'file', scope: 'all'|'future'|null}[]} decisions
 * @returns {{plan: object, swaps: Map<string, object[]>}} Plan ohne hist, Tausch-Stufen je swap-Zeile
 */
export function buildImport(doc, decisions, curWeek) {
  const plan = structuredClone(doc);
  const swaps = new Map();
  for (const p of plan.phases)
    for (const u of p.units)
      for (const it of rawLists(u).flat()) {
        swaps.set(swapKey(p.id, u.id, rawId(it)), normHist(cleanHist(it.hist)));
        delete it.hist;
      }
  for (const { conflict: c, pick, scope } of decisions) {
    const fromFile = pick === 'file' && (scope !== 'future' || !c.past);
    const keep = pick === 'local' || (scope === 'future' && !c.future);
    if (fromFile && !keep) continue;
    // Stelle behält die Übung von hier, die Datei-Übung kommt höchstens als Tausch ab jetzt dazu
    const rawU = plan.phases.find((x) => String(x.id) === c.phase.id).units.find((x) => String(x.id) === c.unit.id);
    const list = c.at.list ? rawU.block : rawU.items;
    const local = structuredClone(c.localRaw);
    delete local.hist;
    list[c.at.index] = local;
    swaps.delete(swapKey(c.phase.id, c.unit.id, c.item.id));
    const key = swapKey(c.phase.id, c.unit.id, c.local.id);
    if (keep) swaps.set(key, c.localHist);
    else {
      const stages = slotSummary(c.item, c.hist, c.phase.weeks).map((s) => ({ from: s.from, to: s.lib, target: s.target, name: s.name }));
      swaps.set(key, mergeSwap(c.localHist, stages, Math.max(curWeek, c.phase.weeks[0])));
    }
  }
  // Eigene Übungen von hier, die über behaltene Übungen oder Tausche weiter gebraucht werden, mitnehmen
  const used = new Set([...referencedEx(plan).keys(), ...[...swaps.values()].flat().map((h) => h.to).filter(Boolean)]);
  const have = knownIds(plan);
  const keep = (PLAN?.exercises ?? []).filter((x) => used.has(x?.id) && !have.has(x.id));
  if (keep.length) plan.exercises = [...(plan.exercises ?? []), ...structuredClone(keep)];
  return { plan, swaps };
}

/**
 * Stand aus der Datei übernehmen. from = 1: in allen Wochen, sonst erst ab dieser Woche (davor bleibt der Stand hier).
 * @returns {object[]} neue Tausch-Stufen
 */
export function mergeSwap(local, incoming, from = 1) {
  let row = { hist: normHist(local) };
  const cur = swapAt({ hist: incoming }, from);
  row = addSwap(row, { from, to: cur?.to ?? '', target: cur?.target ?? '', name: cur?.name ?? '' });
  for (const h of normHist(incoming)) if (h.from > from) row = addSwap(row, h);
  return row.hist;
}

// ---------- Fortschritt je Einheit und Woche ----------

const fmtN = (v, d = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: d });
const signed = (v, unit, d = 1) => `${v > 0 ? '+' : '−'}${fmtN(Math.abs(v), d)}${unit}`;

/**
 * Vergleich mit dem letzten Mal: Gewicht zählt zuerst, bei gleichem Gewicht die Wdh. Zeit: kleiner ist besser.
 * @returns {{dir: 1|0|-1|null, text: string}} dir null = nicht vergleichbar
 */
export function compareResult(prev, cur, { time = false } = {}) {
  if (!prev) return { dir: null, text: 'neu' };
  const a = parseResult(prev);
  const b = parseResult(cur);
  const cmp = (x, y, lower = false) => (x === y ? 0 : (y > x) !== lower ? 1 : -1);
  if (a.kg != null && b.kg != null && a.kg !== b.kg) return { dir: cmp(a.kg, b.kg), text: signed(b.kg - a.kg, ' kg') };
  if (a.s != null && b.s != null && a.s !== b.s) return { dir: cmp(a.s, b.s, time), text: signed(b.s - a.s, ' s', 2) };
  if (a.cm != null && b.cm != null && a.cm !== b.cm) return { dir: cmp(a.cm, b.cm), text: signed(b.cm - a.cm, ' cm') };
  if (a.reps != null && b.reps != null && a.reps !== b.reps) return { dir: cmp(a.reps, b.reps), text: signed(b.reps - a.reps, ' Wdh') };
  const any = [a.kg, a.s, a.cm, a.reps].some((v) => v != null) && [b.kg, b.s, b.cm, b.reps].some((v) => v != null);
  return any ? { dir: 0, text: 'gleich' } : { dir: null, text: '' };
}

/**
 * Trainierte Einheiten (mind. ein Ergebnis), älteste zuerst, mit Vergleich je Übung zum letzten Mal.
 * Datum: frühester Eintrag der Einheit, nur wenn er in der Trainingswoche liegt (nachgetragen sonst ohne Tag).
 * @param {Map<string, object>} rows
 * @param {(ex: string) => boolean} isTime Übung mit Zeit, bei der kleiner besser ist
 */
export function sessionsOf(rows, isTime = () => false) {
  const all = results(rows);
  const map = new Map();
  for (const e of all) {
    const k = `${e.week}|${e.phase}|${e.unit}`;
    if (!map.has(k)) map.set(k, { week: e.week, phase: e.phase, unit: e.unit, date: null, entries: [] });
    const s = map.get(k);
    const c = Date.parse(rows.get(exKey(e.phase, e.unit, e.ex, e.week))?.created_at);
    if (Number.isFinite(c) && weekOf(new Date(c)) === e.week && (!s.date || c < s.date)) s.date = c;
    s.entries.push({ ...e, prev: lastResult(all, e.ex, e.week, e.unit) });
  }
  const order = (u) => (u === 'S' ? 9 : u.charCodeAt(0));
  const list = [...map.values()].sort((a, b) => a.week - b.week || (a.date ?? 0) - (b.date ?? 0) || order(a.unit) - order(b.unit));
  for (const s of list) {
    if (s.date) s.date = new Date(s.date);
    for (const e of s.entries) e.cmp = compareResult(e.prev, e, { time: isTime(e.ex) });
    s.up = s.entries.filter((e) => e.cmp.dir === 1).length;
    s.same = s.entries.filter((e) => e.cmp.dir === 0).length;
    s.down = s.entries.filter((e) => e.cmp.dir === -1).length;
  }
  return list;
}

/** Je Trainingswoche 1…bis: geplante Einheiten, trainierte Einheiten und Summe der Vergleiche. */
export function weeksOf(sessions, until) {
  const out = [];
  for (let w = 1; w <= until; w++) {
    const p = phaseOfWeek(w);
    if (!p) continue;
    const done = sessions.filter((s) => s.week === w);
    out.push({
      week: w, phase: p.id, deload: w === p.dl,
      units: p.units.map((u) => ({ id: u.id, title: u.title, gym: u.gym, done: done.some((s) => s.unit === u.id) })),
      gymDone: done.filter((s) => p.units.find((u) => u.id === s.unit)?.gym).length,
      gymPlanned: p.units.filter((u) => u.gym).length,
      up: done.reduce((a, s) => a + s.up, 0),
      same: done.reduce((a, s) => a + s.same, 0),
      down: done.reduce((a, s) => a + s.down, 0),
    });
  }
  return out;
}

// ---------- Habit-Tracker Physio ----------

/** Erledigte Physio-Übungen je Tag ("JJJJ-MM-TT" → Anzahl). */
export function physioDays(rows, ids) {
  const out = new Map();
  for (const r of rows.values()) {
    if (!r.done || !r.id.startsWith('day|')) continue;
    const [, day, item] = r.id.split('|');
    if (ids.includes(item)) out.set(day, (out.get(day) ?? 0) + 1);
  }
  return out;
}

/**
 * Serien vollständiger Tage bis heute. Ist heute noch offen, zählt die Serie bis gestern weiter.
 * @param {(d: Date) => boolean} full
 */
export function streaks(full, today, start) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let current = 0;
  if (!full(d)) d.setDate(d.getDate() - 1);
  while (d >= start && full(d)) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  let best = 0;
  let run = 0;
  for (const x = new Date(start); x <= today; x.setDate(x.getDate() + 1)) {
    run = full(x) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best };
}
