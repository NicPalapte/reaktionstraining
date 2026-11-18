// Oberfläche Krafttraining (Plan und Hilfsfunktionen stehen in strength-plan.js).
// Workouts: Phase → Woche → Einheit, je Übung Wert und Notiz. Physio & Dehnen: Tagesliste mit Wochentagen.

import {
  PHASES, WARMUP, COOLDOWN, ROUTINE, ROUTINE_NOTES, ROUTINE_PHASE, INFO, PLAN, PLAN_NAME, PLAN_ID, LAST_WEEK, setPlan, validatePlan,
  weekOf, weekStart, fmtDate, phaseOfWeek, isoDay,
  exKey, weekKey, checkKey, dayKey, results, lastResult, historyOf, resultText, parseResult, exerciseList,
  swapKey, swapAt, addSwap, applySwap, occurrencesOf, swapCandidates,
  sessionsOf, weeksOf, physioDays, streaks, dateKey,
  exportPlan, planConflicts, buildImport, slotSummary, normHist, cleanHist,
} from './strength-plan.js';
import { LIB, libOf, catLabel, searchLibrary, setCustomExercises } from './library.js';
import { exerciseDetail } from './library-ui.js';
import { drawProgress } from './chart.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ELLB_OK = 3; // Ellb-Ampel: Schmerz ≤3/10 ok
// Vorlagen im Repo (ohne eigene Werte): der aktuelle Plan und der bisher fest eingebaute für bestehende Daten
const TEMPLATE = 'plans/wintertraining-26-27.json';
const LEGACY = 'plans/wintertraining-26-27-alt.json';

// Start-Buttons der App-Drills im Sprint-Block
const APP_LABEL = { shuffle: '5-10-5 mit Kamera', spider: 'Spider mit Kamera', brake: 'Stopp-Drill mit Kamera', decoy: 'Reaktionsdrill mit Kamera' };
const fmtS = (ms) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

export function initStrength({ store, cloud, ex, onRun }) {
  const rows = new Map();
  // Heute und aktuelle Woche: bei jedem Zeichnen neu, die App bleibt oft tagelang offen
  let now = new Date();
  let curWeek = 1;
  const refreshToday = () => {
    now = new Date();
    curWeek = Math.min(LAST_WEEK, Math.max(1, weekOf(now)));
  };
  let view = 'workout';
  let phase = null;
  let week = 1;
  let unit = null;
  let PHYSIO = []; // tägliche Physio (erste Routine-Gruppe) für den Habit-Tracker
  let planErr = '';
  let loaded = false;
  let descOpen = false; // Phasenbeschreibung aufgeklappt (bleibt beim Wechsel erhalten)
  const timers = new Map();

  const row = (id) => rows.get(id) ?? {};

  async function load() {
    rows.clear();
    for (const r of await store.listStrength()) rows.set(r.id, r);
    // Bestehende Daten ohne eigenen Plan: der bisher eingebaute Plan wird ihr Plan, damit nichts verloren geht
    if (!rows.has(PLAN_ID) && rows.size) {
      try {
        await savePlan(await (await fetch(LEGACY)).json(), '2026-09-01T00:00:00.000Z');
      } catch (e) {
        console.warn('Plan für bestehende Daten nicht geladen', e);
      }
    }
    applyPlan();
    loaded = true;
  }

  /** Gespeicherten Plan übernehmen und Ansicht darauf einstellen. */
  function applyPlan() {
    const doc = rows.get(PLAN_ID)?.plan ?? null;
    if (doc !== PLAN) {
      try {
        setPlan(doc);
        planErr = '';
      } catch (e) {
        setPlan(null);
        planErr = e.message;
      }
      phase = null;
    }
    PHYSIO = ROUTINE[0]?.items.map((it) => it.id) ?? [];
    $('#kr-lede').textContent = PLAN_NAME || 'Kein Trainingsplan';
    $('#kr-info').innerHTML = INFO.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('#kr-rules').hidden = !INFO.length;
    refreshToday();
    if (PHASES.length && (!phase || !PHASES.includes(phase))) goToday();
  }

  function goToday() {
    phase = phaseOfWeek(curWeek);
    week = phase.weeks.includes(curWeek) ? curWeek : phase.weeks[0];
    if (!phase.units.some((u) => u.id === unit)) unit = phase.units[0].id;
  }

  /** Plan speichern (sofort, nicht verzögert: danach hängt die ganze Ansicht daran). */
  async function savePlan(doc, at = new Date().toISOString()) {
    const r = { ...row(PLAN_ID), id: PLAN_ID, plan: doc, updated_at: at };
    rows.set(PLAN_ID, r);
    await store.putStrength(r);
    cloud.scheduleSync();
  }

  function save(id, data) {
    const r = { ...row(id), ...data, id, updated_at: new Date().toISOString() };
    rows.set(id, r);
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(async () => {
        timers.delete(id);
        await store.putStrength(rows.get(id));
        cloud.scheduleSync();
      }, 400),
    );
  }

  // ---------- Workouts ----------
  function seg(el, items, on, attr) {
    el.innerHTML = items
      .map((it) => `<button type="button" data-${attr}="${esc(it.key)}" class="${it.key === on ? 'on' : ''}${it.now ? ' now' : ''}">${it.label}</button>`)
      .join('');
  }

  /** "W5–8" oder bei Lücken "W9, 13, 14". */
  const weeksText = (w) => (w.at(-1) - w[0] === w.length - 1 ? (w.length > 1 ? `W${w[0]}–${w.at(-1)}` : `W${w[0]}`) : `W${w.join(', ')}`);

  function renderPhaseHead() {
    const first = weekStart(phase.weeks[0]);
    const last = weekStart(phase.weeks[phase.weeks.length - 1]);
    last.setDate(last.getDate() + 6);
    const check = (phase.check ?? [])
      .map((c, i) => {
        const id = checkKey(phase.id, '-', `turnier-${i}`, 0);
        return `<label class="kr-check"><input type="checkbox" data-chk="${id}" ${row(id).done ? 'checked' : ''}><span>${esc(c)}</span></label>`;
      })
      .join('');
    $('#kr-phase-head').innerHTML = `
      <h2>${phase.id} ${esc(phase.name)} <span class="muted">· ${weeksText(phase.weeks)} · ${fmtDate(first)}–${fmtDate(last)}</span></h2>
      <details class="kr-desc" ${descOpen ? 'open' : ''}>
        <summary>${esc(phase.goal)}</summary>
        <dl class="kr-info">${phase.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </details>
      ${check ? `<p class="kr-sub">Turnier nur wenn</p>${check}` : ''}`;
  }

  function renderWeekCard() {
    const id = weekKey(phase.id, week);
    const w = row(id);
    const physio = physioDays(rows, PHYSIO);
    let tracked = 0;
    for (let i = 0; i < 7; i++) {
      const d = weekStart(week);
      d.setDate(d.getDate() + i);
      if (physio.get(dateKey(d)) === PHYSIO.length) tracked++;
    }
    const ellb = Number(String(w.ellb ?? '').replace(',', '.'));
    $('#kr-weekcard').innerHTML = `
      <h2>Woche W${week} <span class="muted">· ab ${fmtDate(weekStart(week))}${week === phase.dl ? ' · Deload' : ''}</span></h2>
      <label class="field"><span>Morgen-Routine</span><span class="kr-of"><input type="number" min="0" max="7" inputmode="numeric" data-week="morgen" value="${esc(w.morgen)}" placeholder="${tracked}"> /7</span></label>
      <label class="field"><span>Ellbogen</span><span class="kr-of"><input type="number" min="0" max="10" inputmode="numeric" data-week="ellb" value="${esc(w.ellb)}" class="${ellb > ELLB_OK ? 'warn' : ''}"> /10</span></label>
      <label class="field col"><span>${esc(phase.weekExtra)}</span><input type="text" data-week="extra" value="${esc(w.extra)}" placeholder="z. B. 45 min locker"></label>
      ${ellb > ELLB_OK ? '<p class="hint warn-text">Über 3/10: Folgetag beachten, ggf. Arm 1 Stufe zurück.</p>' : ''}`;
  }

  function exRow(u, it, all) {
    if (it.from && week < it.from) return `<div class="kr-ex off"><div class="kr-name">${esc(it.name)}</div><div class="muted">ab W${it.from}</div></div>`;
    const id = exKey(phase.id, u.id, it.id, week);
    const r = row(id);
    const last = lastResult(all, it.id, week, u.id);
    const hist = historyOf(all, it.id);
    const multiUnit = new Set(hist.map((e) => e.unit)).size > 1;
    const lastTxt = last ? `Zuletzt W${last.week}: ${esc(resultText(last))}` : '';
    const lib = libOf(it);
    // Gewicht vom letzten Mal vorschlagen (bei Zeiten nicht: die sollen frisch gemessen werden)
    const sugg = !it.time && !it.shuttle && last?.value ? last.value : '';
    const orig = it.swappedFrom ?? it;
    return `
      <div class="kr-ex" data-ex="${id}">
        <div class="kr-head">
          <div class="kr-name">${esc(it.name)}${it.target ? ` <span class="muted">· ${esc(it.target)}</span>` : ''}${
            it.swappedFrom ? `<span class="kr-swapped">statt ${esc(it.swappedFrom.name)}${it.swapFrom > phase.weeks[0] ? ` · ab W${it.swapFrom}` : ''}</span>` : ''}</div>
          ${week < curWeek ? '' : `<button type="button" class="kr-swap" data-swap="${esc(orig.id)}" data-swap-unit="${esc(u.id)}" aria-label="${esc(it.name)} tauschen" title="Tauschen">⇄</button>`}
        </div>
        <div class="kr-inputs">
          <input type="text" data-field="value" value="${esc(r.value)}" placeholder="${esc(sugg || it.ph || (it.shuttle ? '5,41 s' : '40 kg'))}"${sugg ? ` data-sugg="${esc(sugg)}"` : ''} aria-label="${esc(it.name)}: Wert">
          <input type="text" data-field="reps" value="${esc(r.reps)}" placeholder="Wdh" inputmode="decimal" aria-label="${esc(it.name)}: Wiederholungen">
          <input type="text" data-field="note" value="${esc(r.note)}" placeholder="Notiz" aria-label="${esc(it.name)}: Notiz">
        </div>
        ${lib ? `<details class="kr-how"><summary>So geht’s</summary>${exerciseDetail(lib)}</details>` : ''}
        ${it.app ? `<div class="kr-app"><button type="button" class="btn small" data-run="${it.app}">${APP_LABEL[it.app]}</button><span data-app="${it.app}"></span></div>` : ''}
        ${lastTxt ? `<div class="kr-last">${lastTxt}</div>` : ''}
        ${hist.length
          ? `<details class="kr-hist"><summary>Verlauf (${hist.length})</summary>${hist
              .map((e) => `<div class="row"><span>W${e.week}${multiUnit ? ` · ${esc(e.unit)}` : ''}</span><span>${esc([e.value, e.reps && `× ${e.reps}`].filter(Boolean).join(' '))}</span><span class="d">${esc(e.note)}</span></div>`)
              .join('')}</details>`
          : ''}
      </div>`;
  }

  function checklist(title, items, u) {
    return `<div class="card"><h2>${title}</h2>${items
      .map((it) => {
        const id = checkKey(phase.id, u.id, it.id, week);
        return `<label class="kr-check"><input type="checkbox" data-chk="${id}" ${row(id).done ? 'checked' : ''}><span>${esc(it.name)}${it.target ? ` <span class="muted">· ${esc(it.target)}</span>` : ''}</span></label>`;
      })
      .join('')}</div>`;
  }

  async function renderUnit() {
    const u0 = phase.units.find((x) => x.id === unit) ?? phase.units[0];
    unit = u0.id;
    const u = swapped(phase, u0, week);
    const all = results(rows);
    $('#kr-unit-body').innerHTML = `
      ${u.gym ? checklist('Aufwärmen', WARMUP, u) : u.warmup ? checklist('Aufwärmen', u.warmup, u) : ''}
      <div class="card">
        <h2>${esc(u.title)}${u.name ? ` · ${esc(u.name)}` : ''}</h2>
        ${u.intro ? `<p class="hint">${esc(u.intro)}</p>` : ''}
        ${u.items.map((it) => exRow(u, it, all)).join('')}
        ${u.block ? `<p class="kr-sub">Schulterblatt-Block</p>${u.block.map((it) => exRow(u, it, all)).join('')}` : ''}
      </div>
      ${u.gym ? checklist('Nach der Einheit', COOLDOWN, u) : ''}`;
    const boxes = [...document.querySelectorAll('#kr-unit-body [data-app]')];
    if (!boxes.length) return;
    // Werte aus den App-Drills dieser Woche zum Übernehmen anbieten
    const from = weekStart(week);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const inWeek = (x) => new Date(x.created_at) >= from && new Date(x.created_at) < to;
    const take = (text, value, reps = '') =>
      `${text} <button type="button" class="btn small ghost" data-take="${esc(value)}" data-take-reps="${esc(reps)}">Übernehmen</button>`;
    for (const box of boxes) {
      const app = box.dataset.app;
      let html = '';
      if (app === 'shuffle' || app === 'spider') {
        const times = (await store.listTrials(app === 'shuffle' ? ex.shuffle : ex.spider)).filter((t) => t.valid && t.run_ms != null && inWeek(t)).map((t) => t.run_ms);
        if (times.length) html = take(`Diese Woche: <b>${fmtS(Math.min(...times))}</b> (${times.length}×)`, fmtS(Math.min(...times)), String(times.length));
      } else if (app === 'brake') {
        const tr = (await store.listTrials(ex.decoy)).filter((t) => inWeek(t) && String(t.reason).startsWith('brake'));
        const ok = tr.filter((t) => t.valid);
        const timed = ok.filter((t) => t.run_ms != null); // außerhalb des Bildes gestoppt: ohne Zeit
        if (tr.length) {
          const avg = timed.length ? fmtS(timed.reduce((a, t) => a + t.run_ms, 0) / timed.length) : null;
          html = take(`Diese Woche: ${avg ? `Ø Bremszeit <b>${avg}</b>, ` : ''}${ok.length}/${tr.length} gestoppt`, avg ? `Ø ${avg}` : `${ok.length}/${tr.length}`, String(tr.length));
        }
      } else if (app === 'decoy') {
        const ss = (await store.listSessions()).filter((x) => x.exercise === ex.decoy && inWeek(x) && x.meta?.preset !== 'brake');
        if (ss.length) {
          const sum = (k) => ss.reduce((a, x) => a + ['go', 'stop', 'flip', 'brake'].reduce((b, t) => b + (x.meta?.[t]?.[k] ?? 0), 0), 0);
          html = take(`Diese Woche: <b>${ss.length} Sätze</b>, ${sum(0)}/${sum(1)} richtig`, `${sum(0)}/${sum(1)} richtig`, String(ss.length));
        }
      }
      box.innerHTML = html;
    }
  }

  /** Einheit in einer Woche mit den dann gültigen Tauschen. */
  function swapped(p, u, w) {
    const sw = (it) => applySwap(it, rows.get(swapKey(p.id, u.id, it.id)), w);
    return { ...u, items: u.items.map(sw), block: u.block?.map(sw) };
  }

  // ---------- Übung tauschen (nur ab der aktuellen Woche, vergangene Wochen bleiben) ----------
  let swapCtx = null; // { item, unit, occ, shown, from }
  const unitTitle = (o) => `${o.phase} ${PHASES.find((p) => p.id === o.phase).units.find((x) => x.id === o.unit).title}`;

  function openSwap(itemId, unitId) {
    const from = Math.max(week, curWeek);
    const u = phase.units.find((x) => x.id === unitId);
    const item = [...u.items, ...(u.block ?? [])].find((it) => it.id === itemId);
    const cur = swapAt(rows.get(swapKey(phase.id, u.id, item.id)), from);
    const shown = applySwap(item, rows.get(swapKey(phase.id, u.id, item.id)), from);
    // Andere Stellen im Plan: nur Phasen, die ab dieser Woche noch kommen
    const occ = occurrencesOf(item.id).filter((o) => !(o.phase === phase.id && o.unit === u.id) && PHASES.find((p) => p.id === o.phase).weeks.at(-1) >= from);
    swapCtx = { item, unit: u, occ, shown, from };
    const fromTxt = from > phase.weeks[0] ? `ab W${from}` : `in allen Wochen von ${phase.id}`;
    $('#swap-title').textContent = `${shown.name} tauschen`;
    $('#swap-from').innerHTML = shown.swappedFrom
      ? `Im Plan steht <b>${esc(item.name)}</b>. <button type="button" class="btn small ghost" id="swap-reset">Zurück zu ${esc(item.name)} ${esc(fromTxt)}</button>`
      : `Gilt für ${phase.id} ${esc(u.title)} ${esc(fromTxt)}. Vergangene Wochen bleiben, wie sie waren.`;
    $('#swap-target').value = shown.swappedFrom ? cur?.target ?? '' : '';
    $('#swap-target').placeholder = item.target || 'z. B. 3 × 8–10';
    $('#swap-all-wrap').hidden = !occ.length;
    $('#swap-all').checked = false;
    $('#swap-all-label').textContent = `Auch in ${occ.map(unitTitle).join(', ')}`;
    $('#swap-q').value = '';
    renderSwapList();
    $('#swap-sheet').hidden = false;
  }

  function renderSwapList() {
    const { item, unit: u, shown, from } = swapCtx;
    // Schon in der Einheit vorhandene Übungen nicht anbieten, sonst landen zwei Einträge unter derselben ID
    const s = swapped(phase, u, from);
    const taken = [...s.items, ...(s.block ?? [])].map((it) => it.id).filter((id) => id !== shown.id);
    const hits = new Set(searchLibrary($('#swap-q').value).map((x) => x.id));
    const list = swapCandidates(shown.swappedFrom ? LIB.get(shown.id) : item, taken).filter((x) => hits.has(x.id));
    const own = libOf(item)?.cat;
    let last = null;
    $('#swap-list').innerHTML = list.length
      ? list
          .map((x) => {
            const head = x.cat !== last ? `<p class="kr-sub">${esc(catLabel(x.cat))}${x.cat === own ? ' · gleiche Kategorie' : ''}</p>` : '';
            last = x.cat;
            return `${head}<button type="button" class="swap-opt" data-to="${x.id}"><b>${esc(x.name)}</b><span class="muted">${esc(x.equip)}</span></button>`;
          })
          .join('')
      : '<p class="empty">Keine passende Übung.</p>';
  }

  function applySwapChoice(to) {
    const { item, unit: u, occ, from } = swapCtx;
    const target = $('#swap-target').value.trim();
    const places = [{ phase: phase.id, unit: u.id, from }];
    if ($('#swap-all').checked)
      for (const o of occ) {
        const p = PHASES.find((x) => x.id === o.phase);
        const f = Math.max(from, p.weeks[0]);
        // Nur dort tauschen, wo die neue Übung nicht schon in der Einheit steht
        const s = swapped(p, p.units.find((x) => x.id === o.unit), f);
        if (!to || ![...s.items, ...(s.block ?? [])].some((it) => it.id === to && it.id !== item.id)) places.push({ ...o, from: f });
      }
    for (const o of places) {
      const id = swapKey(o.phase, o.unit, item.id);
      save(id, addSwap(rows.get(id), { from: o.from, to, target }));
    }
    closeSwap();
    renderUnit();
  }

  function closeSwap() {
    $('#swap-sheet').hidden = true;
    swapCtx = null;
  }

  $('#swap-close').addEventListener('click', closeSwap);
  $('#swap-sheet').addEventListener('click', (e) => {
    if (e.target.id === 'swap-sheet') return closeSwap();
    if (e.target.id === 'swap-reset') return applySwapChoice('');
    const b = e.target.closest('[data-to]');
    if (b) applySwapChoice(b.dataset.to);
  });
  $('#swap-q').addEventListener('input', renderSwapList);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && swapCtx && closeSwap());

  function renderWorkout() {
    seg($('#kr-phase'), PHASES.map((p) => ({ key: p.id, label: p.id, now: p.weeks.includes(curWeek) })), phase.id, 'phase');
    seg($('#kr-week'), phase.weeks.map((w) => ({ key: String(w), label: `W${w}${w === phase.dl ? ' DL' : ''}`, now: w === curWeek })), String(week), 'week');
    seg($('#kr-unit'), phase.units.map((u) => ({ key: u.id, label: esc(u.title) })), unit, 'unit');
    renderPhaseHead();
    renderWeekCard();
    renderUnit();
  }

  // ---------- Physio & Dehnen ----------
  function renderRoutine() {
    const today = isoDay(now);
    const monday = weekStart(curWeek);
    const days = physioDays(rows, PHYSIO);
    const full = (d) => days.get(dateKey(d)) === PHYSIO.length;
    let doneDays = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      if (full(d)) doneDays++;
    }
    const groups = ROUTINE.map((g) => {
      const on = g.days.includes(today);
      const days = g.days.length === 7 ? 'täglich' : g.days.map((d) => DAYS[d - 1]).join(' ');
      return `<div class="card${on ? '' : ' kr-dim'}">
        <div class="card-head"><h2>${esc(g.title)}</h2><span class="kr-days">${days}</span></div>
        ${g.target ? `<p class="hint">${esc(g.target)}</p>` : ''}
        ${g.items
          .map((it) => {
            const id = dayKey(now, it.id);
            return `<label class="kr-check"><input type="checkbox" data-chk="${id}" ${row(id).done ? 'checked' : ''} ${on ? '' : 'disabled'}><span>${esc(it.name)}${it.target ? ` <span class="muted">· ${esc(it.target)}</span>` : ''}</span></label>`;
          })
          .join('')}
        ${on ? '' : '<p class="hint">Heute nicht dran.</p>'}
      </div>`;
    }).join('');
    const extra = ROUTINE_PHASE[phaseOfWeek(curWeek).id] ?? [];
    $('#kr-routine-body').innerHTML = `
      <p class="kr-today">Heute · ${DAYS[today - 1]} ${fmtDate(now)} · Physio diese Woche ${doneDays}/7</p>
      ${groups}
      ${habitCard(days, full)}
      <div class="card">${[...extra, ...ROUTINE_NOTES].map((n) => `<p class="hint">${esc(n)}</p>`).join('')}</div>`;
  }

  /** Habit-Tracker: ein Feld pro Tag seit W1, voll = alle Physio-Übungen erledigt. Antippen trägt nach. */
  function habitCard(days, full) {
    const start = weekStart(1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastWeek = Math.max(1, weekOf(today));
    const count = (n) => {
      let c = 0;
      for (let i = 0; i < n; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        if (d >= start && full(d)) c++;
      }
      return c;
    };
    const since = Math.max(1, Math.round((today - start) / 86400000) + 1);
    const total = count(since);
    const { current, best } = streaks(full, today, start);
    const stat = (v, k) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`;
    let grid = `<span></span>${DAYS.map((d) => `<span class="hb-h">${d}</span>`).join('')}`;
    for (let w = 1; w <= lastWeek; w++) {
      grid += `<span class="hb-w">W${w}</span>`;
      for (let i = 0; i < 7; i++) {
        const d = weekStart(w);
        d.setDate(d.getDate() + i);
        const n = days.get(dateKey(d)) ?? 0;
        const cls = d > today ? 'future' : n >= PHYSIO.length ? 'full' : n ? 'part' : '';
        const label = `${DAYS[i]} ${fmtDate(d)}: ${n}/${PHYSIO.length}`;
        grid += d > today
          ? `<span class="hb-c future"></span>`
          : `<button type="button" class="hb-c ${cls}${+d === +today ? ' today' : ''}" data-habit="${dateKey(d)}" title="${label}" aria-label="${label}"></button>`;
      }
    }
    return `<div class="card">
      <div class="card-head"><h2>Physio-Tracker</h2><span class="kr-days">${total}/${since} Tage</span></div>
      <div class="stats">
        ${stat(current, current === 1 ? 'Tag in Folge' : 'Tage in Folge')}
        ${stat(best, 'Beste Serie')}
        ${stat(`${count(7)}/7`, 'Letzte 7 Tage')}
        ${stat(`${Math.round((count(Math.min(30, since)) / Math.min(30, since)) * 100)} %`, `Letzte ${Math.min(30, since)} Tage`)}
      </div>
      <div class="hb-grid">${grid}</div>
      <p class="hint">Voll = alle ${PHYSIO.length} Physio-Übungen. Tag antippen, um ihn nachzutragen oder zu entfernen.</p>
    </div>`;
  }

  function toggleHabit(key) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const all = PHYSIO.every((id) => row(dayKey(date, id)).done);
    for (const id of PHYSIO) save(dayKey(date, id), { done: !all });
    renderRoutine();
  }

  // ---------- Steuerung ----------
  /**
   * @param {{today?: boolean}} opts today: zur aktuellen Woche springen (beim Öffnen des Tabs und beim Zurückkehren in die App)
   */
  async function render({ today = false } = {}) {
    if (!loaded) await load();
    refreshToday();
    const has = PHASES.length > 0;
    $('#kr-empty').hidden = has;
    $('#kr-view').hidden = !has;
    if (!has) {
      $('#kr-workout').hidden = true;
      $('#kr-routine').hidden = true;
      $('#kr-empty-msg').textContent = planErr ? `Der gespeicherte Plan ist ungültig: ${planErr}` : '';
      return;
    }
    if (today) goToday();
    document.querySelectorAll('#kr-view button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    $('#kr-workout').hidden = view !== 'workout';
    $('#kr-routine').hidden = view !== 'routine';
    if (view === 'workout') renderWorkout();
    else renderRoutine();
  }

  // toggle blubbert nicht, darum in der Capture-Phase
  $('#screen-strength').addEventListener('toggle', (e) => e.target.classList?.contains('kr-desc') && (descOpen = e.target.open), true);

  // Ohne Plan: importieren oder die Vorlage übernehmen
  $('#kr-empty-import').addEventListener('click', () => $('#kr-import').click());
  $('#kr-empty-template').addEventListener('click', async () => {
    try {
      const doc = await (await fetch(TEMPLATE)).json();
      const err = validatePlan(doc);
      if (err.length) throw new Error(err.join(' '));
      await savePlan(doc);
      applyPlan();
      render({ today: true });
    } catch (e) {
      $('#kr-empty-msg').textContent = `Vorlage nicht geladen: ${e.message}`;
    }
  });

  $('#screen-strength').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) view = b.dataset.view;
    else if (b.dataset.phase) {
      phase = PHASES.find((p) => p.id === b.dataset.phase);
      week = phase.weeks.includes(curWeek) ? curWeek : phase.weeks[0];
      if (!phase.units.some((u) => u.id === unit)) unit = phase.units[0].id;
    } else if (b.dataset.week) week = Number(b.dataset.week);
    else if (b.dataset.unit) unit = b.dataset.unit;
    else if (b.dataset.take) {
      const row = b.closest('.kr-ex');
      const input = row.querySelector('[data-field="value"]');
      input.value = b.dataset.take;
      const reps = row.querySelector('[data-field="reps"]');
      if (b.dataset.takeReps && !reps.value) reps.value = b.dataset.takeReps;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    } else if (b.dataset.run) {
      onRun(b.dataset.run);
      return;
    } else if (b.dataset.swap) {
      openSwap(b.dataset.swap, b.dataset.swapUnit);
      return;
    } else if (b.dataset.habit) {
      toggleHabit(b.dataset.habit);
      return;
    } else return;
    render();
  });

  // Leeres Gewichtsfeld antippen: letzten Wert übernehmen und markieren, Tippen überschreibt ihn
  $('#screen-strength').addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.dataset?.field !== 'value' || el.value || !el.dataset.sugg) return;
    el.value = el.dataset.sugg;
    el.select();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  $('#screen-strength').addEventListener('input', (e) => {
    const el = e.target;
    const ex = el.closest('[data-ex]');
    if (ex && el.dataset.field) {
      save(ex.dataset.ex, {
        value: ex.querySelector('[data-field="value"]').value.trim(),
        reps: ex.querySelector('[data-field="reps"]').value.trim(),
        note: ex.querySelector('[data-field="note"]').value.trim(),
      });
    } else if (el.dataset.week) {
      save(weekKey(phase.id, week), { [el.dataset.week]: el.value.trim() });
      if (el.dataset.week === 'ellb') el.classList.toggle('warn', Number(el.value.replace(',', '.')) > ELLB_OK);
    } else if (el.dataset.chk) {
      save(el.dataset.chk, { done: el.checked });
      if (view === 'routine') renderRoutine();
    }
  });

  // Nach Abgleich neu zeichnen, aber nicht mitten in einer Eingabe
  cloud.onChange(async () => {
    if ($('#screen-strength').hidden || cloud.syncing || timers.size) return;
    await load();
    if (!$('#screen-strength').contains(document.activeElement) || document.activeElement.type === 'checkbox') render();
  });

  // ---------- Verlauf: Diagramm je Übung ----------
  const METRICS = [
    { key: 'kg', label: 'Gewicht', fmt: (v) => `${fmtNum(v)} kg` },
    { key: 'reps', label: 'Wdh', fmt: (v) => fmtNum(v) },
    { key: 's', label: 'Zeit', fmt: (v) => `${fmtNum(v, v < 20 ? 2 : 1)} s` }, // Shuttle braucht Hundertstel
    { key: 'cm', label: 'Weite', fmt: (v) => `${fmtNum(v)} cm` },
  ];
  const fmtNum = (v, digits = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: digits });
  let histEx = null;
  let histMetric = null;
  let histMode = 'weeks';

  /** Name und "kleiner ist besser" je Übungs-ID (Plan und Bibliothek). */
  function exInfo() {
    const m = new Map();
    for (const x of exerciseList()) m.set(x.id, x);
    for (const [id, x] of LIB) if (!m.has(id)) m.set(id, { id, name: x.name, time: !!x.time, shuttle: !!x.shuttle });
    return m;
  }

  const arrows = (s) =>
    [s.up && `<span class="up">↑${s.up}</span>`, s.same && `<span class="eq">=${s.same}</span>`, s.down && `<span class="down">↓${s.down}</span>`].filter(Boolean).join(' ');
  const unitName = (phaseId, unitId) => {
    const u = PHASES.find((p) => p.id === phaseId)?.units.find((x) => x.id === unitId);
    return u ? [u.title, u.name].filter(Boolean).join(' · ') : unitId;
  };
  const dayTxt = (d) => (d ? `${DAYS[isoDay(d) - 1]} ${fmtDate(d)}` : '');

  function renderWeeks(sessions) {
    refreshToday();
    const weeks = weeksOf(sessions, curWeek).reverse();
    const past = weeks.filter((w) => w.week < curWeek); // laufende Woche zählt nicht als verpasst
    const noGym = past.filter((w) => !w.gymDone).length;
    const gymDone = weeks.reduce((a, w) => a + w.gymDone, 0);
    const gymPlanned = past.reduce((a, w) => a + w.gymPlanned, 0) + (weeks[0]?.gymPlanned ?? 0);
    const up = sessions.reduce((a, s) => a + s.up, 0);
    const cmp = sessions.reduce((a, s) => a + s.up + s.same + s.down, 0);
    const stat = (v, k) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`;
    $('#hs-weeks').innerHTML = `
      <div class="stats">
        ${stat(`${gymDone}/${gymPlanned}`, 'Gym-Einheiten')}
        ${stat(noGym, noGym === 1 ? 'Woche ohne Gym' : 'Wochen ohne Gym')}
        ${stat(up, 'Mal gesteigert')}
        ${stat(cmp ? `${Math.round((up / cmp) * 100)} %` : '–', 'besser als zuvor')}
      </div>
      <div class="card">
        <h2>Wochen</h2>
        <div class="rows">${weeks
          .map((w) => {
            const chips = w.units.map((u) => `<span class="wk-chip${u.done ? ' on' : ''}${u.gym ? '' : ' sprint'}" title="${esc(u.title)}">${esc(u.gym ? u.title : 'S')}</span>`).join('');
            const now = w.week === curWeek;
            const res = w.gymDone || w.units.some((u) => u.done)
              ? arrows(w) || '<span class="muted">–</span>'
              : now ? '<span class="muted">läuft</span>' : '<span class="down">kein Gym</span>';
            return `<button type="button" class="row wk-row${!w.gymDone && !now ? ' miss' : ''}" data-wk="${w.week}">
              <span><b>W${w.week}</b> <span class="d">${w.phase}${w.deload ? ' · DL' : ''} · ${fmtDate(weekStart(w.week))}</span></span>
              <span class="wk-chips">${chips}</span>
              <span class="wk-res">${res}</span>
            </button>`;
          })
          .join('')}</div>
        <p class="hint">Gefüllt = trainiert (mind. ein Eintrag). ↑ besser, = gleich, ↓ schlechter als beim letzten Mal. Woche antippen für die Einheiten.</p>
      </div>`;
  }

  let sessWeek = null; // Einheiten auf eine Woche gefiltert (aus der Wochenansicht)

  function renderSessions(sessions, info) {
    const list = [...sessions].reverse().filter((s) => sessWeek == null || s.week === sessWeek);
    const fmtVal = (e) => esc([e.value, e.reps && `× ${e.reps}`].filter(Boolean).join(' '));
    $('#hs-sessions').innerHTML = `
      ${sessWeek != null ? `<p class="kr-today">Nur W${sessWeek} <button type="button" class="btn small ghost" data-sessall>Alle Einheiten</button></p>` : ''}
      ${list.length ? '' : `<p class="empty">In W${sessWeek} keine Einheit eingetragen.</p>`}
      ${list
        .map(
          (s) => `<details class="card sess">
          <summary>
            <span class="sess-t"><b>${esc(unitName(s.phase, s.unit))}</b><span class="d">W${s.week} · ${s.phase}${s.date ? ` · ${dayTxt(s.date)}` : ''}</span></span>
            <span class="wk-res">${arrows(s) || `<span class="muted">${s.entries.length} Übungen</span>`}</span>
          </summary>
          <div class="rows">${s.entries
            .map((e) => {
              const c = e.cmp;
              const cls = c.dir === 1 ? 'up' : c.dir === -1 ? 'down' : c.dir === 0 ? 'eq' : 'muted';
              return `<div class="row sess-row">
                <span>${esc(info.get(e.ex)?.name ?? e.ex)}${e.prev ? `<span class="d sess-prev">vorher W${e.prev.week}: ${fmtVal(e.prev)}</span>` : ''}</span>
                <span>${fmtVal(e)}</span>
                <span class="${cls}">${esc(c.text)}</span>
              </div>`;
            })
            .join('')}</div>
        </details>`,
        )
        .join('')}`;
  }

  async function renderHistory() {
    if (!loaded || !timers.size) await load(); // Abgleich kann Neues gebracht haben; ungespeicherte Eingaben nicht verwerfen
    document.querySelectorAll('#hs-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === histMode));
    const any = results(rows).length > 0;
    $('#hs-mode').hidden = !any;
    $('#hs-weeks').hidden = !any || histMode !== 'weeks';
    $('#hs-sessions').hidden = !any || histMode !== 'sessions';
    if (histMode !== 'exercise' || !any) {
      $('#hs-body').hidden = true;
      $('#hs-empty').hidden = any;
      if (!any) return;
      const info = exInfo();
      const sessions = sessionsOf(rows, (id) => !!(info.get(id)?.time || info.get(id)?.shuttle));
      if (histMode === 'weeks') renderWeeks(sessions);
      else renderSessions(sessions, info);
      return;
    }
    const all = results(rows).map((e) => ({ ...e, num: parseResult(e) }));
    // Shuttle steht schon im Verlauf 5-10-5. Übungen mit nur Wdh (Pogo, Hüpfer, Deadbug) brauchen kein Diagramm.
    // Eingetauschte Übungen aus der Bibliothek, die Einträge haben, kommen als eigene Gruppe dazu
    const listed = exerciseList();
    const known = new Set(listed.map((x) => x.id));
    const extraGroup = { id: 'LIB', label: 'Getauscht', order: Infinity };
    for (const id of new Set(all.map((e) => e.ex)))
      if (!known.has(id) && LIB.has(id)) listed.push({ id, name: LIB.get(id).name, shuttle: !!LIB.get(id).shuttle, time: !!LIB.get(id).time, group: extraGroup });
    const exs = listed.filter((x) => {
      const mine = all.filter((e) => e.ex === x.id);
      const onlyReps = mine.some((e) => e.num.reps != null) && !mine.some((e) => e.num.kg != null || e.num.s != null || e.num.cm != null);
      return !x.shuttle && mine.length && !onlyReps;
    });
    const sel = $('#hs-ex');
    if (!exs.length) {
      sel.innerHTML = '';
      $('#hs-body').hidden = true;
      $('#hs-empty').hidden = false;
      return;
    }
    $('#hs-body').hidden = false;
    $('#hs-empty').hidden = true;
    if (!exs.some((x) => x.id === histEx)) histEx = (exs.find((x) => all.some((e) => e.ex === x.id && e.num.kg != null)) ?? exs[0]).id;
    const opt = (x) => `<option value="${x.id}" ${x.id === histEx ? 'selected' : ''}>${esc(x.name)}</option>`;
    sel.innerHTML = [...new Set(exs.map((x) => x.group))].map((g) => `<optgroup label="${esc(g.label)}">${exs.filter((x) => x.group === g).map(opt).join('')}</optgroup>`).join('');
    const ex = exs.find((x) => x.id === histEx);
    const list = historyOf(all, histEx);

    // Pro Woche ein Punkt: bester Wert der Woche (Schulterblatt-Block kommt in A, B und C vor)
    const avail = METRICS.filter((mt) => list.some((e) => e.num[mt.key] != null));
    if (!avail.some((mt) => mt.key === histMetric)) histMetric = avail[0]?.key ?? 'kg';
    const metric = METRICS.find((mt) => mt.key === histMetric);
    const lowerBetter = ex.time && histMetric === 's';
    const byWeek = new Map();
    for (const e of list) {
      const v = e.num[histMetric];
      if (v == null) continue;
      const cur = byWeek.get(e.week);
      if (!cur || (lowerBetter ? v < cur.v : v > cur.v)) byWeek.set(e.week, { x: e.week, v, label: `W${e.week} · ${e.phase} ${e.unit}: ${resultText(e)}` });
    }
    const pts = [...byWeek.values()].sort((a, b) => a.x - b.x);

    const seg = $('#hs-metric');
    seg.hidden = avail.length < 2;
    seg.innerHTML = avail.map((mt) => `<button type="button" data-metric="${mt.key}" class="${mt.key === histMetric ? 'on' : ''}">${mt.label}</button>`).join('');

    const stat = (v, k) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`;
    const vals = pts.map((p) => p.v);
    const best = vals.length ? (lowerBetter ? Math.min(...vals) : Math.max(...vals)) : null;
    const diff = vals.length > 1 ? vals[vals.length - 1] - vals[0] : null;
    $('#hs-stats').innerHTML = vals.length
      ? [
          stat(metric.fmt(best), lowerBetter ? 'Bestzeit' : 'Bestwert'),
          stat(metric.fmt(vals[vals.length - 1]), `Zuletzt (W${pts[pts.length - 1].x})`),
          diff != null ? stat(`${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${metric.fmt(Math.abs(diff))}`, `seit W${pts[0].x}`) : '',
          stat(String(list.length), 'Einträge'),
        ].join('')
      : '';
    const phases = PHASES.map((p) => ({ x: p.weeks[0], label: p.id }));
    drawProgress($('#hs-chart'), $('#hs-tip'), pts, { fmt: metric.fmt, lowerBetter, phases });
    $('#hs-note').textContent = vals.length
      ? lowerBetter
        ? 'Kleiner ist besser · ein Punkt pro Woche'
        : 'Ein Punkt pro Woche (bester Wert der Woche)'
      : `Für das Diagramm Zahlen eintragen, z. B. „40 kg“ und Wdh „8“.`;
    $('#hs-list').innerHTML = [...list]
      .reverse()
      .map((e) => `<div class="row"><span class="d">W${e.week} · ${e.phase} ${esc(e.unit)}</span><span>${esc([e.value, e.reps && `× ${e.reps}`].filter(Boolean).join(' '))}</span><span class="d">${esc(e.note)}</span></div>`)
      .join('');
  }

  $('#hs-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    histMode = b.dataset.mode;
    sessWeek = null;
    renderHistory();
  });
  $('#hs-weeks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wk]');
    if (!b) return;
    histMode = 'sessions';
    sessWeek = Number(b.dataset.wk);
    renderHistory();
  });
  $('#hs-sessions').addEventListener('click', (e) => {
    if (!e.target.closest('[data-sessall]')) return;
    sessWeek = null;
    renderHistory();
  });

  $('#hs-ex').addEventListener('change', (e) => {
    histEx = e.target.value;
    renderHistory();
  });
  $('#hs-metric').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric]');
    if (!b) return;
    histMetric = b.dataset.metric;
    renderHistory();
  });

  // ---------- Exportieren und Importieren (eigene Werte stehen nicht im öffentlichen Code) ----------
  // Datei (JSON): { kind: 'strength', version: 3, scope: 'plan' | 'all', plan: Plan-Dokument (Übungen mit hist), rows: [Werte] }.
  // Importieren lassen sich auch reine Plan-Dateien (format "tennis-plan") und alte Sicherungen (nur rows).
  const ID = /^(ex|week|chk|day|swap)\|[^|]+(\|[^|]+)*$/;
  const TEXT = ['value', 'reps', 'note', 'morgen', 'ellb', 'extra', 'to', 'target'];
  const ts = (v) => Date.parse(v) || 0;

  /** Rückfrage als Sheet. Ergebnis: { value, scope, rest } oder null bei Abbrechen. */
  let askDone = null;
  function ask({ title, text = '', options, scope = null, rest = '' }) {
    $('#ask-title').textContent = title;
    $('#ask-text').innerHTML = text;
    $('#ask-scope-wrap').hidden = !scope;
    let sc = scope?.[0].value ?? null;
    const drawScope = () =>
      ($('#ask-scope').innerHTML = (scope ?? []).map((s) => `<button type="button" data-scope="${s.value}" class="${s.value === sc ? 'on' : ''}">${esc(s.label)}</button>`).join(''));
    drawScope();
    $('#ask-scope').onclick = (e) => {
      const b = e.target.closest('[data-scope]');
      if (b) (sc = b.dataset.scope), drawScope();
    };
    $('#ask-opts').innerHTML = options
      .map((o) => `<button type="button" class="swap-opt" data-ask="${o.value}"><b>${esc(o.label)}</b>${o.sub ? `<span class="muted">${o.sub}</span>` : ''}</button>`)
      .join('');
    $('#ask-rest-wrap').hidden = !rest;
    $('#ask-rest').checked = false;
    $('#ask-rest-label').textContent = rest;
    $('#ask-sheet').hidden = false;
    return new Promise((resolve) => {
      askDone = (value) => {
        askDone = null;
        $('#ask-sheet').hidden = true;
        resolve(value == null ? null : { value, scope: sc, rest: !!rest && $('#ask-rest').checked });
      };
    });
  }
  $('#ask-cancel').addEventListener('click', () => askDone?.(null));
  $('#ask-sheet').addEventListener('click', (e) => {
    if (e.target.id === 'ask-sheet') return askDone?.(null);
    const b = e.target.closest('[data-ask]');
    if (b) askDone?.(b.dataset.ask);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && askDone?.(null));

  $('#kr-export').addEventListener('click', async () => {
    const a = await ask({
      title: 'Exportieren',
      text: 'Was soll in die Datei?',
      options: [
        { value: 'plan', label: 'Nur Plan', sub: 'Übungen und Vorgaben je Phase und Einheit, mit deinen Tauschen' },
        { value: 'all', label: 'Plan und Werte', sub: 'Zusätzlich alle Einträge: Gewichte, Wdh, Notizen, Haken, Physio-Tage' },
      ],
    });
    if (!a) return;
    await load();
    if (!PLAN) {
      $('#kr-backup-msg').textContent = 'Es gibt noch keinen Trainingsplan zum Exportieren.';
      return;
    }
    const data = {
      app: 'reaktionstraining', kind: 'strength', version: 3, scope: a.value, exported_at: new Date().toISOString(),
      plan: exportPlan(rows),
      rows: a.value === 'all' ? [...rows.values()].filter((r) => r.id !== PLAN_ID && !r.id.startsWith('swap|')) : [],
    };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    link.download = `krafttraining-${a.value === 'all' ? 'plan-werte' : 'plan'}-${dateKey(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    $('#kr-backup-msg').textContent = a.value === 'all' ? 'Plan und Werte exportiert.' : 'Plan exportiert.';
  });

  $('#kr-import-btn').addEventListener('click', () => $('#kr-import').click());
  let importing = false; // zwei Importe gleichzeitig sähen beide noch den alten Stand
  $('#kr-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || importing) return;
    importing = true;
    try {
      await importFile(file);
    } finally {
      importing = false;
      setCustomExercises(PLAN?.exercises ?? []); // eigene Übungen wieder genau die des gespeicherten Plans
    }
  });

  const sameValue = (a, b) => TEXT.every((k) => String(a[k] ?? '') === String(b[k] ?? '')) && !!a.done === !!b.done && JSON.stringify(a.hist ?? null) === JSON.stringify(b.hist ?? null);

  /** Abschnitte einer Stelle als Text: "Kniebeuge 4 × 8–10 · W5–6<br>Frontkniebeuge 4 × 8 · W7–8". */
  function slotText(item, hist, weeks) {
    const parts = slotSummary(item, hist, weeks);
    const wk = (p) => (p.from === p.until ? `W${p.from}` : `W${p.from}–${p.until}`);
    return parts.map((p) => `${esc(p.name)}${p.target ? ` <span>${esc(p.target)}</span>` : ''}${parts.length > 1 ? ` · ${wk(p)}` : ''}`).join('<br>');
  }

  async function importFile(file) {
    const msg = $('#kr-backup-msg');
    const show = (t) => {
      msg.textContent = t;
      if (!$('#kr-empty').hidden) $('#kr-empty-msg').textContent = t;
    };
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return show('Die Datei ist kein gültiges JSON.');
    }
    // Reine Plan-Datei (z. B. aus plans/) oder Export der App
    if (data?.format === 'tennis-plan') data = { kind: 'strength', plan: data, rows: [] };
    if (data?.kind !== 'strength' || !Array.isArray(data.rows ?? [])) return show('Das ist keine Krafttraining-Datei dieser App.');
    const doc = data.plan && !Array.isArray(data.plan) ? data.plan : null;
    if (doc) {
      const err = validatePlan(doc);
      if (err.length) return show(`Plan nicht importiert: ${err.join(' ')}`);
    }
    await load();
    refreshToday();
    // Beim Vergleichen sind die eigenen Übungen von hier und aus der Datei bekannt
    if (doc) setCustomExercises([...(doc.exercises ?? []), ...(PLAN?.exercises ?? [])]);

    // Werte: nur bekannte Felder. Tausch-Zeilen aus alten Dateien (ohne Plan) zählen wie Werte.
    const fresh = [];
    const differ = [];
    let equal = 0;
    for (const raw of data.rows ?? []) {
      if (typeof raw?.id !== 'string' || !ID.test(raw.id) || (doc && raw.id.startsWith('swap|'))) continue;
      const r = { id: raw.id, created_at: raw.created_at ?? new Date().toISOString(), updated_at: raw.updated_at ?? new Date().toISOString() };
      for (const k of TEXT) if (raw[k] != null) r[k] = String(raw[k]).slice(0, 200);
      if (raw.done != null) r.done = !!raw.done;
      if (Array.isArray(raw.hist)) r.hist = normHist(cleanHist(raw.hist));
      const cur = rows.get(r.id);
      if (!cur) fresh.push(r);
      else if (sameValue(cur, r)) equal++;
      else differ.push(r);
    }

    // Rückfragen: erst die Übungen, dann die Werte. Abbrechen ändert nichts.
    const conflicts = doc ? planConflicts(rows, doc, curWeek) : [];
    const decisions = [];
    let rest = null;
    for (const [i, c] of conflicts.entries()) {
      let a = rest;
      if (!a) {
        const left = conflicts.length - i - 1;
        a = await ask({
          title: 'Abweichende Übung',
          text: `${conflicts.length > 1 ? `${i + 1} von ${conflicts.length} · ` : ''}<b>${esc(c.phase.id)} · ${esc(c.unit.title)}</b>: Welche Übung soll gelten?${
            !c.future ? ' Die Abweichung liegt nur in vergangenen Wochen.' : ''}`,
          options: [
            { value: 'local', label: 'Hier behalten', sub: slotText(c.local, c.localHist, c.phase.weeks) },
            { value: 'file', label: 'Aus der Datei übernehmen', sub: slotText(c.item, c.hist, c.phase.weeks) },
          ],
          // Wahl auch zeigen, wenn sie erst für eine der übrigen Abweichungen zählt
          scope: (c.past && c.future) || conflicts.slice(i + 1).some((x) => x.past && x.future)
            ? [{ value: 'future', label: `Nur zukünftige (ab W${curWeek})` }, { value: 'all', label: 'Alle Wochen' }]
            : null,
          rest: left ? (left > 1 ? `Für die übrigen ${left} Abweichungen genauso` : 'Für die letzte Abweichung genauso') : '',
        });
        if (!a) return show('Import abgebrochen, nichts geändert.');
        if (a.rest) rest = a;
      }
      decisions.push({ conflict: c, pick: a.value, scope: a.scope });
    }

    let overwrite = false;
    if (differ.length) {
      const a = await ask({
        title: 'Werte überschreiben?',
        text: `${differ.length} Eintr${differ.length > 1 ? 'äge sind' : 'ag ist'} hier schon anders eingetragen als in der Datei.${
          fresh.length ? (fresh.length > 1 ? ` ${fresh.length} neue werden in jedem Fall ergänzt.` : ' 1 neuer wird in jedem Fall ergänzt.') : ''}`,
        options: [
          { value: 'keep', label: 'Nicht überschreiben', sub: 'Deine Werte hier bleiben, nur fehlende kommen dazu' },
          { value: 'overwrite', label: 'Überschreiben', sub: 'Die Werte aus der Datei ersetzen die Werte hier' },
        ],
      });
      if (!a) return show('Import abgebrochen, nichts geändert.');
      overwrite = a.value === 'overwrite';
    }

    // Schreiben. Ersetzte Zeilen bekommen die aktuelle Zeit, sonst holt der Cloud-Abgleich den alten Stand zurück.
    const nowIso = new Date().toISOString();
    const write = [...fresh, ...(overwrite ? differ.map((r) => ({ ...r, updated_at: nowIso })) : [])];
    const hadPlan = !!PLAN;
    if (doc) {
      const { plan, swaps } = buildImport(doc, decisions, curWeek);
      const err = validatePlan(plan);
      if (err.length) return show(`Plan nicht importiert: ${err.join(' ')}`);
      for (const [id, hist] of swaps) {
        const cur = rows.get(id);
        if (JSON.stringify(normHist(cur?.hist ?? (cur?.to != null ? [{ from: 1, to: cur.to, target: cur.target }] : []))) === JSON.stringify(hist)) continue;
        if (!cur && !hist.length) continue;
        write.push({ ...(cur ?? {}), id, hist, to: undefined, target: undefined, created_at: cur?.created_at ?? nowIso, updated_at: nowIso });
      }
      await savePlan(plan);
    }
    for (const r of write) {
      rows.set(r.id, r);
      await store.putStrength(r);
    }
    if (write.length) cloud.scheduleSync();
    applyPlan();
    if (!$('#screen-strength').hidden) render({ today: !hadPlan });

    const parts = [];
    if (doc) parts.push(`Plan „${PLAN_NAME}“ ${hadPlan ? 'aktualisiert' : 'übernommen'}`);
    const fromFile = decisions.filter((d) => d.pick === 'file').length;
    if (conflicts.length) parts.push(`${fromFile} von ${conflicts.length} abweichenden Übungen aus der Datei`);
    const n = (k) => `${k} ${k > 1 ? 'Werte' : 'Wert'}`;
    if (fresh.length) parts.push(`${n(fresh.length)} ergänzt`);
    if (differ.length) parts.push(`${n(differ.length)} ${overwrite ? '' : 'nicht '}überschrieben`);
    show(parts.length ? `${parts.join(', ')}.` : equal ? 'Die Werte sind schon auf diesem Stand.' : 'Die Datei enthält nichts zum Übernehmen.');
  }

  /** Plan geladen (z. B. für die Bibliothek), ohne zu zeichnen. */
  const ready = async () => {
    if (!loaded) await load();
  };

  return { render, renderHistory, ready };
}
