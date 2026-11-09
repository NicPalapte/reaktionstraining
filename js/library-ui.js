// Oberfläche Bibliothek: Suche, Kategorie-Filter, Übungen mit Ausführung, Merkpunkten und Nutzen für Tennis.

import { CATEGORIES, EXERCISES, searchLibrary } from './library.js';
import { PHASES } from './strength-plan.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const APP_LABEL = { shuffle: '5-10-5 mit Kamera', spider: 'Spider mit Kamera', brake: 'Stopp-Drill mit Kamera', decoy: 'Reaktionsdrill mit Kamera' };

/** Wo die Übung im Wintertraining vorkommt (inkl. Varianten über item.lib), z. B. "P2 A, P3 A". */
function usage(id) {
  const out = [];
  for (const p of PHASES)
    for (const u of p.units) if ([...u.items, ...(u.block ?? [])].some((it) => (it.lib ?? it.id) === id)) out.push(`${p.id} ${u.title}`);
  return out;
}

/** Ausführung, Merkpunkte und Nutzen einer Übung (auch im Krafttraining verwendet). */
export function exerciseDetail(x) {
  return `
    <p>${esc(x.desc)}</p>
    ${x.cues?.length ? `<ul class="lib-cues">${x.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${x.why ? `<p class="lib-why"><b>Für Tennis:</b> ${esc(x.why)}</p>` : ''}`;
}

export function initLibrary({ onRun }) {
  let cat = null;
  let q = '';
  let open = null; // aufgeklappte Übung bleibt beim Filtern offen

  function render() {
    $('#lib-count').textContent = `${EXERCISES.length} Übungen mit Ausführung`;
    $('#lib-cats').innerHTML = [{ id: null, label: 'Alle' }, ...CATEGORIES]
      .map((c) => `<button type="button" data-cat="${c.id ?? ''}" class="${c.id === cat ? 'on' : ''}">${esc(c.label)}</button>`)
      .join('');
    const hits = searchLibrary(q, cat);
    $('#lib-list').innerHTML = hits.length
      ? CATEGORIES.filter((c) => hits.some((x) => x.cat === c.id))
          .map(
            (c) => `<div class="card"><h2>${esc(c.label)}</h2>${hits
              .filter((x) => x.cat === c.id)
              .map((x) => {
                const used = usage(x.id);
                return `<details class="lib-ex" data-id="${x.id}" ${open === x.id ? 'open' : ''}>
                  <summary><span class="lib-name">${esc(x.name)}</span><span class="muted lib-equip">${esc(x.equip)}${used.length ? ' · im Plan' : ''}</span></summary>
                  <div class="lib-body">
                    ${exerciseDetail(x)}
                    ${used.length ? `<p class="muted lib-used">Im Wintertraining: ${esc(used.join(', '))}</p>` : ''}
                    ${x.app ? `<button type="button" class="btn small" data-run="${x.app}">${APP_LABEL[x.app]}</button>` : ''}
                  </div>
                </details>`;
              })
              .join('')}</div>`,
          )
          .join('')
      : '<p class="empty">Keine Übung gefunden.</p>';
  }

  $('#lib-q').addEventListener('input', (e) => {
    q = e.target.value;
    render();
  });
  $('#lib-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat || null;
    render();
  });
  $('#lib-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-run]');
    if (b) onRun(b.dataset.run);
  });
  // toggle blubbert nicht, darum in der Capture-Phase
  $('#lib-list').addEventListener(
    'toggle',
    (e) => {
      const d = e.target.closest?.('.lib-ex');
      if (d) open = d.open ? d.dataset.id : open === d.dataset.id ? null : open;
    },
    true,
  );

  return { render };
}
