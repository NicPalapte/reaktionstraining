// Oberfläche Krafttraining (Plan und Hilfsfunktionen stehen in strength-plan.js).
// Workouts: Phase → Woche → Einheit, je Übung Wert und Notiz. Physio & Dehnen: Tagesliste mit Wochentagen.

import {
  PHASES, WARMUP, COOLDOWN, ROUTINE, ROUTINE_NOTES, ROUTINE_PHASE, INFO,
  weekOf, weekStart, fmtDate, phaseOfWeek, isoDay,
  exKey, weekKey, checkKey, dayKey, results, lastResult, historyOf, resultText, parseResult, exerciseList,
  swapKey, applySwap, occurrencesOf, swapCandidates,
} from './strength-plan.js';
import { LIB, libOf, catLabel, searchLibrary } from './library.js';
import { exerciseDetail } from './library-ui.js';
import { drawProgress } from './chart.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ELLB_OK = 3; // Ellb-Ampel: Schmerz ≤3/10 ok

// Start-Buttons der App-Drills im Sprint-Block
const APP_LABEL = { shuffle: '5-10-5 mit Kamera', spider: 'Spider mit Kamera', brake: 'Stopp-Drill mit Kamera', decoy: 'Reaktionsdrill mit Kamera' };
const fmtS = (ms) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

export function initStrength({ store, cloud, ex, onRun }) {
  const rows = new Map();
  const now = new Date();
  const curWeek = Math.min(22, Math.max(1, weekOf(now)));
  let view = 'workout';
  let phase = phaseOfWeek(curWeek);
  let week = phase.weeks.includes(curWeek) ? curWeek : phase.weeks[0];
  let unit = phase.units[0].id;
  let loaded = false;
  let descOpen = false; // Phasenbeschreibung aufgeklappt (bleibt beim Wechsel erhalten)
  const timers = new Map();

  const row = (id) => rows.get(id) ?? {};

  async function load() {
    rows.clear();
    for (const r of await store.listStrength()) rows.set(r.id, r);
    loaded = true;
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
      <h2>${phase.id} ${esc(phase.name)} <span class="muted">· W${phase.weeks[0]}–${phase.weeks[phase.weeks.length - 1]} · ${fmtDate(first)}–${fmtDate(last)}</span></h2>
      <details class="kr-desc" ${descOpen ? 'open' : ''}>
        <summary>${esc(phase.goal)}</summary>
        <dl class="kr-info">${phase.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </details>
      ${check ? `<p class="kr-sub">Turnier nur wenn</p>${check}` : ''}`;
  }

  function renderWeekCard() {
    const id = weekKey(phase.id, week);
    const w = row(id);
    const ellb = Number(String(w.ellb ?? '').replace(',', '.'));
    $('#kr-weekcard').innerHTML = `
      <h2>Woche W${week} <span class="muted">· ab ${fmtDate(weekStart(week))}${week === phase.dl ? ' · Deload' : ''}</span></h2>
      <label class="field"><span>Morgen-Routine</span><span class="kr-of"><input type="number" min="0" max="7" inputmode="numeric" data-week="morgen" value="${esc(w.morgen)}"> /7</span></label>
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
    const orig = it.swappedFrom ?? it;
    return `
      <div class="kr-ex" data-ex="${id}">
        <div class="kr-head">
          <div class="kr-name">${esc(it.name)}${it.target ? ` <span class="muted">· ${esc(it.target)}</span>` : ''}${
            it.swappedFrom ? `<span class="kr-swapped">statt ${esc(it.swappedFrom.name)}</span>` : ''}</div>
          <button type="button" class="kr-swap" data-swap="${esc(orig.id)}" data-swap-unit="${esc(u.id)}" aria-label="${esc(it.name)} tauschen" title="Tauschen">⇄</button>
        </div>
        <div class="kr-inputs">
          <input type="text" data-field="value" value="${esc(r.value)}" placeholder="${esc(it.ph ?? (it.shuttle ? '5,41 s' : '40 kg'))}" aria-label="${esc(it.name)}: Wert">
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
    const u = swapped(phase, u0);
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

  /** Einheit mit allen Tauschen dieser Phase. */
  function swapped(p, u) {
    const sw = (it) => applySwap(it, rows.get(swapKey(p.id, u.id, it.id)));
    return { ...u, items: u.items.map(sw), block: u.block?.map(sw) };
  }

  // ---------- Übung tauschen ----------
  let swapCtx = null; // { item, unit, occ }

  function openSwap(itemId, unitId) {
    const u = phase.units.find((x) => x.id === unitId);
    const item = [...u.items, ...(u.block ?? [])].find((it) => it.id === itemId);
    const cur = rows.get(swapKey(phase.id, u.id, item.id));
    const shown = applySwap(item, cur);
    const occ = occurrencesOf(item.id).filter((o) => !(o.phase === phase.id && o.unit === u.id));
    swapCtx = { item, unit: u, occ, shown };
    $('#swap-title').textContent = `${shown.name} tauschen`;
    $('#swap-from').innerHTML = shown.swappedFrom
      ? `Im Plan steht <b>${esc(item.name)}</b>. <button type="button" class="btn small ghost" id="swap-reset">Zurück zu ${esc(item.name)}</button>`
      : `Gilt für ${phase.id} ${esc(u.title)} in allen Wochen. Einträge der neuen Übung laufen unter ihrem eigenen Namen.`;
    $('#swap-target').value = cur?.target ?? '';
    $('#swap-target').placeholder = item.target || 'z. B. 3 × 8–10';
    $('#swap-all-wrap').hidden = !occ.length;
    $('#swap-all').checked = false;
    $('#swap-all-label').textContent = `Auch in ${occ.map((o) => `${o.phase} ${PHASES.find((p) => p.id === o.phase).units.find((x) => x.id === o.unit).title}`).join(', ')}`;
    $('#swap-q').value = '';
    renderSwapList();
    $('#swap-sheet').hidden = false;
  }

  function renderSwapList() {
    const { item, unit: u, shown } = swapCtx;
    // Schon in der Einheit vorhandene Übungen nicht anbieten, sonst landen zwei Einträge unter derselben ID
    const taken = swapped(phase, u).items.concat(swapped(phase, u).block ?? []).map((it) => it.id).filter((id) => id !== shown.id);
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
    const { item, unit: u, occ } = swapCtx;
    const target = $('#swap-target').value.trim();
    // In anderen Einheiten nur tauschen, wo die neue Übung nicht schon vorkommt
    const has = (o) => {
      const p = PHASES.find((x) => x.id === o.phase);
      const s = swapped(p, p.units.find((x) => x.id === o.unit));
      return [...s.items, ...(s.block ?? [])].some((it) => it.id === to && it.id !== item.id);
    };
    const places = [{ phase: phase.id, unit: u.id }, ...($('#swap-all').checked ? occ.filter((o) => !to || !has(o)) : [])];
    for (const o of places) save(swapKey(o.phase, o.unit, item.id), { to, target: to ? target : '' });
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
    const physio = ROUTINE[0].items;
    let doneDays = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      if (physio.every((it) => row(dayKey(d, it.id)).done)) doneDays++;
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
      <div class="card">${[...extra, ...ROUTINE_NOTES].map((n) => `<p class="hint">${esc(n)}</p>`).join('')}</div>`;
  }

  // ---------- Steuerung ----------
  async function render() {
    if (!loaded) await load();
    document.querySelectorAll('#kr-view button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    $('#kr-workout').hidden = view !== 'workout';
    $('#kr-routine').hidden = view !== 'routine';
    if (view === 'workout') renderWorkout();
    else renderRoutine();
  }

  // toggle blubbert nicht, darum in der Capture-Phase
  $('#screen-strength').addEventListener('toggle', (e) => e.target.classList?.contains('kr-desc') && (descOpen = e.target.open), true);

  $('#kr-info').innerHTML = INFO.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

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
    } else return;
    render();
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

  async function renderHistory() {
    if (!loaded || !timers.size) await load(); // Abgleich kann Neues gebracht haben; ungespeicherte Eingaben nicht verwerfen
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

  // ---------- Sichern und Importieren (eigene Werte stehen nicht im öffentlichen Code) ----------
  const ID = /^(ex|week|chk|day|swap)\|[^|]+(\|[^|]+)*$/;
  const TEXT = ['value', 'reps', 'note', 'morgen', 'ellb', 'extra', 'to', 'target'];
  const ts = (v) => Date.parse(v) || 0;

  $('#kr-export').addEventListener('click', async () => {
    await load();
    const data = { app: 'reaktionstraining', kind: 'strength', version: 1, exported_at: new Date().toISOString(), rows: [...rows.values()] };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `krafttraining-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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
    }
  });

  async function importFile(file) {
    const msg = $('#kr-backup-msg');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      msg.textContent = 'Die Datei ist kein gültiges JSON.';
      return;
    }
    if (data?.kind !== 'strength' || !Array.isArray(data.rows)) {
      msg.textContent = 'Das ist keine Krafttraining-Datei dieser App.';
      return;
    }
    await load();
    let added = 0;
    let skipped = 0;
    for (const raw of data.rows) {
      if (typeof raw?.id !== 'string' || !ID.test(raw.id)) continue;
      // Nur bekannte Felder übernehmen
      const r = { id: raw.id, created_at: raw.created_at ?? new Date().toISOString(), updated_at: raw.updated_at ?? new Date().toISOString() };
      for (const k of TEXT) if (raw[k] != null) r[k] = String(raw[k]).slice(0, 200);
      if (raw.done != null) r.done = !!raw.done;
      const cur = rows.get(r.id);
      if (cur && ts(cur.updated_at) >= ts(r.updated_at)) {
        skipped++;
        continue;
      }
      rows.set(r.id, r);
      await store.putStrength(r);
      added++;
    }
    cloud.scheduleSync();
    msg.textContent = `${added} Einträge übernommen${skipped ? `, ${skipped} übersprungen (hier schon neuer)` : ''}.`;
  }

  return { render, renderHistory };
}
