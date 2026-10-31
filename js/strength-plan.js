// Krafttraining: Wintertraining 26/27 als Daten, dazu reine Hilfsfunktionen (ohne DOM, testbar).
// Einheiten stehen bewusst ohne Wochentag (A, B, C, Sprint, Kraft 1/2, Erhalt 1/2).
// Physio und Dehnen an Nicht-Gym-Tagen ist eine eigene Kategorie (ROUTINE) mit Tagen.
// Übungs-IDs verbinden dieselbe Übung über Phasen hinweg ("Zuletzt"-Hinweis, Verlauf).

const x = (id, name, target, opts = {}) => ({ id, name, target, ...opts });

const SB = [
  x('straight-arm', 'Straight-Arm Pulldown', '3 × 12, Schultern runter'),
  x('y-raise', 'Y-Raise Bauchlage/Schrägbank', '3 × 10–12 leicht, Schulterblatt unten/hinten'),
];

// Gym-Tage: Tennisball + Außenrotation als Aufwärmen vorher, Seitlage + Dehnen nach der Einheit.
export const WARMUP = [
  { id: 'tennisball', name: 'Tennisball Schulterblatt (Wand/Boden)', target: '1–2 min/Seite, harte Punkte 20 s halten' },
  { id: 'aussenrot', name: 'Außenrotation beidarmig Band', target: 'Ellb am Körper, nach außen ziehen, 3 × 15' },
];
export const COOLDOWN = [
  { id: 'seitlage', name: 'Seitlage-Dehnung', target: 'Arm gestreckt nach hinten oben, 2 × 40 s/Seite' },
  { id: 'brust', name: 'Brust Türrahmen', target: '1 × 40 s/Seite' },
  { id: 'unterarm', name: 'Unterarm', target: '1 × 40 s/Seite' },
  { id: 'trizeps-dehnen', name: 'Trizeps', target: '1 × 40 s/Seite, nur schmerzfrei' },
];

const A = 'Beine & Rumpf';
const B = 'Oberkörper + Trizeps';
const C = 'Hinge & Ganzkörper + Trizeps';

export const PHASES = [
  {
    id: 'P2',
    name: 'Aufbau',
    weeks: [5, 6, 7, 8],
    dl: 8,
    goal: 'Volumen aufbauen: saubere Wiederholungen im mittleren Bereich',
    details: [
      ['Hauptübungen', '4 × 8–10 @ RPE 7–8, Pause 2 min'],
      ['Nebenübungen', '3 × 8–12'],
      ['Sprünge', 'Boxsprung höher als in P1, Pogo seitlich, Skater und Standweitsprung'],
      ['Ellbogen', 'E2 Pushdown 3-0-3, sonst E1 Iso. Weiter zu E3 erst nach 3 Wo ohne Folgetag'],
      ['Ausdauer', 'Spinning oder Lauf locker, 40–50 min'],
      ['Sprint', 'Aufwärmen, 20 m 6–8 ×, 5-10-5 4–6 ×, Spider 3 ×, Abbremsen 5 ×, bester Shuttle notieren'],
      ['Deload W8', 'Gleiche Gewichte, ~40 % weniger Sätze, Sprünge halbiert'],
    ],
    weekExtra: 'Ausdauer',
    units: [
      {
        id: 'A', title: 'A', name: A, gym: true,
        items: [
          x('boxsprung', 'Boxsprung', '3 × 5, höher als P1'),
          x('pogo', 'Pogo seitlich', '2 × 10'),
          x('kniebeuge', 'Kniebeuge', '4 × 8–10'),
          x('bss', 'Bulgarian Split Squat', '3 × 8–10/Bein'),
          x('beinbeuger', 'Beinbeuger', '3 × 8–12'),
          x('wadenheben', 'Wadenheben', '3 × 12–15'),
          x('pallof', 'Pallof Press', '3 × 10/Seite'),
          x('seitstuetz', 'Seitstütz + Bein', '3 × 30–40 s'),
        ],
      },
      {
        id: 'B', title: 'B', name: B, gym: true,
        items: [
          x('klimmzug', 'Klimmzug/Latzug', '4 × 6–10'),
          x('rudern', 'Rudern', '4 × 8–12'),
          x('landmine', 'Landmine Press', '3 × 8–12 langsam'),
          x('facepulls', 'Face Pulls', '3 × 12–15'),
          x('trizeps-pushdown', 'Trizeps E2 Pushdown', '3–4 × 8–10, 3-0-3'),
          x('deadbug', 'Deadbug', '3 × 10/Seite'),
        ],
      },
      {
        id: 'C', title: 'C', name: C, gym: true,
        items: [
          x('skater', 'Skater-Sprung', '3 × 5/Seite'),
          x('standweitsprung', 'Standweitsprung', '3 × 3'),
          x('kreuzheben', 'Kreuzheben/RDL', '4 × 8–10'),
          x('hipthrust', 'Hip Thrust', '3 × 8–12'),
          x('einbein-kh', 'Einbein. Kreuzheben', '3 × 8/Bein'),
          x('khbank', 'KH-Bank/Floor Press', '3 × 8–12 langsam'),
          x('trizeps-pushdown', 'Trizeps E2 Pushdown', '3 × 8–10, 3-0-3'),
          x('unterarm', 'Unterarm/Griff', '3 × 15'),
        ],
      },
      {
        id: 'S', title: 'Sprint', name: '', gym: false,
        intro: 'Aufwärmen · 20 m 6–8 × · 5-10-5 4–6 × · Spider 3 × · Abbremsen 5 ×',
        items: [x('shuttle', 'Shuttle bester', 's', { shuttle: true })],
      },
    ],
  },
  {
    id: 'P3',
    name: 'Maximalkraft',
    weeks: [9, 10, 11, 12, 13],
    dl: 13,
    goal: 'Schwer und explosiv: Maximalkraft mit Kontrastsprüngen',
    details: [
      ['Beine/Zug', '4–5 × 4–6 @ RPE 8, Pause 3 min'],
      ['Drücken/Trizeps', '8–12 Wdh, ab W11 ggf. 6–8'],
      ['Kontrast', 'Nach jedem schweren Satz direkt 3 Sprünge (Sprungkniebeuge o. Last bzw. Standweitsprung)'],
      ['Ellbogen', 'E3 Überkopf-Strecken, sonst Pushdown. E4 Medball-Würfe ab W12, wenn 2 Wo schmerzfrei'],
      ['Ausdauer', 'Lauf 45–60 min'],
      ['Sprint', 'Wie P2 plus Reaktionsdrill 4–6 ×. Bei Glätte Halle, Schlitten oder Skierg. W13 halb'],
      ['Deload W13', 'Gleiche Gewichte, ~40 % weniger Sätze, Sprünge halbiert'],
    ],
    weekExtra: 'Ausdauer',
    units: [
      {
        id: 'A', title: 'A', name: A, gym: true,
        items: [
          x('einbein-huepfen-vor', 'Einbein. Hüpfen vorwärts', '3 × 4/Bein'),
          x('kniebeuge', 'Kniebeuge', '4–5 × 4–6'),
          x('sprungkniebeuge-kontrast', '+ Sprungkniebeuge o. Last', '3 nach jedem Satz'),
          x('bss', 'Bulgarian Split Squat', '3 × 6–8/Bein'),
          x('beinbeuger', 'Beinbeuger', '3 × 6–10'),
          x('wadenheben', 'Wadenheben', '3 × 10–12 schwer'),
          x('pallof', 'Pallof Press', '3 × 10/Seite'),
          x('seitstuetz', 'Seitstütz + Bein', '3 × 40 s'),
        ],
      },
      {
        id: 'B', title: 'B', name: B, gym: true,
        items: [
          x('klimmzug', 'Klimmzug (+Gewicht)', '4 × 4–6'),
          x('rudern', 'Rudern', '4 × 6–8'),
          x('landmine', 'Landmine Press', '3 × 8–12'),
          x('facepulls', 'Face Pulls', '3 × 12–15'),
          x('trizeps-pushdown', 'Trizeps E2 Pushdown', '4 × 8–10, 3-0-3'),
          x('deadbug', 'Deadbug', '3 × 10/Seite'),
        ],
      },
      {
        id: 'C', title: 'C', name: C, gym: true,
        items: [
          x('einbein-huepfen-seit', 'Einbein. Hüpfen seitlich', '3 × 4/Bein'),
          x('kreuzheben', 'Kreuzheben', '4–5 × 4–6'),
          x('standweitsprung-kontrast', '+ Standweitsprung', '3 nach jedem Satz'),
          x('hipthrust', 'Hip Thrust', '3 × 6–10'),
          x('einbein-kh', 'Einbein. Kreuzheben', '3 × 8/Bein'),
          x('khbank', 'KH-Bank/Floor Press', '3 × 8–12'),
          x('trizeps-ueberkopf', 'Trizeps E3 Überkopf', '3 × 8–10 (sonst Pushdown)'),
          x('medball-rotation', 'Medball Rotation', '4 × 6/Seite'),
          x('medball-ueberkopf', 'E4 Medball Überkopf', '3 × 6, 2 kg, ab W12', { from: 12 }),
          x('unterarm', 'Unterarm/Griff', '3 × 12–15'),
        ],
      },
      {
        id: 'S', title: 'Sprint', name: '', gym: false,
        intro: 'Wie P2 + Reaktionsdrill 4–6 × · bei Glätte: Halle/Schlitten/Skierg · W13 halb',
        items: [x('shuttle', 'Shuttle bester', 's', { shuttle: true })],
      },
    ],
  },
  {
    id: 'P4',
    name: 'Übertrag',
    weeks: [14, 15],
    dl: null,
    goal: 'Kraft halten, Schnelligkeit auf den Platz übertragen',
    details: [
      ['Kraft', 'Wenige schwere Sätze: Kniebeuge und Kreuzheben 3 × 3–5, Rest 2–3 Sätze'],
      ['Sprünge', 'Frisch vor der Hauptübung: Sprungkniebeuge mit 20–30 % Last, reaktive Niedersprünge, Boxsprung max'],
      ['Ellbogen', 'E4: Medball Überkopf 3 kg, dann einarmig. Aufschläge ab W16, wenn 2 Wo Würfe ok'],
      ['Ausdauer', 'Lauf 30–40 min'],
      ['Sprint', '35 min: 6 × 10-m-Start, Reaktion 6 ×, Seil einbeinig, Abbremsen 5 ×'],
    ],
    weekExtra: 'Ausdauer',
    units: [
      {
        id: 'A', title: 'A', name: A, gym: true,
        items: [
          x('sprungkniebeuge', 'Sprungkniebeuge', '4 × 4, 20–30 % Last'),
          x('niedersprung', 'Niedersprung 30 cm', '3 × 4 reaktiv'),
          x('kniebeuge', 'Kniebeuge', '3 × 3–5'),
          x('bss', 'Bulgarian Split Squat', '2 × 8'),
          x('beinbeuger', 'Beinbeuger', '2 × 8'),
          x('pallof', 'Pallof Press', '2 × 10'),
        ],
      },
      {
        id: 'B', title: 'B', name: B, gym: true,
        items: [
          x('klimmzug', 'Klimmzug', '3 × 5–6'),
          x('rudern', 'Rudern', '3 × 8'),
          x('landmine', 'Landmine Press', '3 × 8'),
          x('facepulls', 'Face Pulls', '2 × 15'),
          x('trizeps-ueberkopf', 'Trizeps E3 Überkopf', '3 × 8'),
          x('medball-ueberkopf', 'E4 Medball Überkopf', '4 × 5, 3 kg → einarmig'),
        ],
      },
      {
        id: 'C', title: 'C', name: C, gym: true,
        items: [
          x('seitsprung-rw', 'Seitsprung Richtungswechsel', '3 × 4/Seite'),
          x('boxsprung-max', 'Boxsprung max', '3 × 4'),
          x('kreuzheben', 'Kreuzheben', '3 × 3–5'),
          x('hipthrust', 'Hip Thrust', '2 × 8'),
          x('khbank', 'KH-Bank/Floor Press', '3 × 8'),
          x('medball-rotation', 'Medball Rotation', '4 × 6/Seite'),
          x('unterarm', 'Unterarm/Griff', '2 × 15'),
        ],
      },
      {
        id: 'S', title: 'Sprint', name: '35 min', gym: false,
        intro: '6 × 10-m-Start · Reaktion 6 × · Seil einbeinig · Abbremsen 5 ×',
        items: [x('shuttle', 'Shuttle bester', 's', { shuttle: true })],
      },
    ],
  },
  {
    id: 'P5',
    name: 'Rückkehr',
    weeks: [16, 17, 18, 19],
    dl: null,
    goal: 'Zurück auf den Platz: zwei Krafteinheiten, Tennis, Aufschläge stufenweise',
    details: [
      ['Woche', '2 Krafteinheiten und 2 × Tennis. Kein Sprint, dafür 10 min Beinarbeit vorm Tennis'],
      ['Vorm Tennis', 'Trizeps-Iso 2 × 40 s'],
      ['Aufschläge', 'W16 Schatten + 20 @ 50 % · W17 30–40 @ 60–70 % · W18 40–50 @ 70–80 % + Kick · W19 50–60, volle Serien bis 10'],
      ['Notieren', 'Pro Woche Aufschläge und wie der Arm am Folgetag war'],
      ['Ellbogen', 'Folgetag schlechter → eine Stufe zurück'],
    ],
    weekExtra: 'Aufschläge/Folgetag',
    units: [
      {
        id: 'K1', title: 'Kraft 1', name: '', gym: true,
        items: [
          x('sprungkniebeuge', 'Sprungkniebeuge', '3 × 4, 20–30 %'),
          x('kniebeuge', 'Kniebeuge', '3 × 3–5'),
          x('rudern', 'Rudern', '3 × 8'),
          x('landmine', 'Landmine Press', '3 × 8'),
          x('trizeps-ueberkopf', 'Trizeps Überkopf', '3 × 8–10'),
          x('pallof', 'Pallof Press', '3 × 10'),
        ],
      },
      {
        id: 'K2', title: 'Kraft 2', name: '', gym: true,
        items: [
          x('seitsprung-rw', 'Seitsprung Richtungswechsel', '3 × 4/Seite'),
          x('kreuzheben', 'Kreuzheben', '3 × 3–5'),
          x('medball-ueberkopf', 'Medball Überkopf einarmig', '4 × 5'),
          x('medball-rotation', 'Medball Rotation', '3 × 6/Seite'),
          x('klimmzug', 'Klimmzug', '3 × 6–8'),
          x('hipthrust', 'Hip Thrust', '3 × 8'),
          x('facepulls', 'Face Pulls', '3 × 15'),
        ],
      },
    ],
  },
  {
    id: 'P6',
    name: 'Turnierprep',
    weeks: [20, 21, 22],
    dl: null,
    goal: 'Kraft erhalten, Matchhärte aufbauen, frisch ins Turnier',
    details: [
      ['Woche', '2 kurze Erhalt-Einheiten, 2 × Tennis und ein Match'],
      ['Matches', 'W20 1 Satz · W21 2 Sätze · W22 Taper (weniger Umfang, frisch bleiben)'],
      ['Kraft', '2–3 Sätze mit wenigen Wiederholungen'],
      ['Turnier', 'Nur wenn alle drei Kriterien unten erfüllt sind'],
    ],
    check: ['2 Wo volle Aufschläge ok', '2-Satz-Match ok', 'Ellb ≤1/10'],
    weekExtra: 'Aufschläge/Folgetag',
    units: [
      {
        id: 'E1', title: 'Erhalt 1', name: '', gym: true,
        items: [
          x('sprungkniebeuge', 'Sprungkniebeuge', '3 × 4'),
          x('kniebeuge', 'Kniebeuge', '2–3 × 3'),
          x('rudern', 'Rudern', '2 × 8'),
          x('trizeps-ueberkopf', 'Trizeps Überkopf', '2 × 10'),
          x('pallof', 'Pallof Press', '2 × 10'),
        ],
      },
      {
        id: 'E2', title: 'Erhalt 2', name: '', gym: true,
        items: [
          x('skater-reaktiv', 'Skater reaktiv', '2 × 4/Seite'),
          x('kreuzheben', 'Kreuzheben', '2–3 × 3'),
          x('medball-ueberkopf', 'Medball Überkopf einarmig', '3 × 5'),
          x('klimmzug', 'Klimmzug', '2 × 6'),
          x('facepulls', 'Face Pulls', '2 × 15'),
          x('seitstuetz', 'Seitstütz', '2 × 30 s'),
        ],
      },
    ],
  },
];

// P1 (W1–4) liegt vor dem Start der App. Eigene Werte stehen nicht im Code (Repo ist öffentlich),
// sondern kommen über Einstellungen → Krafttraining → Importieren in die eigenen Daten.
PHASES.unshift({
  id: 'P1',
  name: 'Grundlage',
  weeks: [1, 2, 3, 4],
  dl: null,
  goal: 'Grundlage: Technik, Landungen, Ellbogen schonen',
  details: [
    ['Werte', 'Eigene Werte aus W1–4 über Einstellungen → Krafttraining importieren oder direkt eintragen'],
    ['Sprünge', 'Niedrige Box und Hüpfer mit Landung halten'],
    ['Ellbogen', 'E1 Isometrie Kabel 90°. Weiter zu E2 nach 2 Wo ≤2/10 + Physio'],
  ],
  weekExtra: 'Ausdauer',
  units: [
    {
      id: 'A', title: 'A', name: A, gym: true,
      items: [
        x('boxsprung', 'Sprung auf niedrige Box, Landung 2 s halten', ''),
        x('pogo', 'Pogo-Sprünge (Fußgelenk, kurzer Kontakt)', ''),
        x('kniebeuge', 'Kniebeuge (Back Squat)', ''),
        x('bss', 'Bulgarian Split Squat', ''),
        x('beinbeuger', 'Beinbeuger (Leg Curl / Nordic)', ''),
        x('wadenheben', 'Wadenheben stehend', ''),
        x('pallof', 'Pallof Press', ''),
        x('seitstuetz', 'Seitstütz mit Beinheben', ''),
      ],
    },
    {
      id: 'B', title: 'B', name: B, gym: true,
      items: [
        x('klimmzug', 'Latzug (oder Klimmzug)', ''),
        x('landmine', 'Landmine Press einarmig', ''),
        x('facepulls', 'Face Pulls', ''),
        x('trizeps-iso', 'Trizeps E1: Isometrie Kabel 90°', ''),
        x('deadbug', 'Deadbug', ''),
      ],
    },
    {
      id: 'C', title: 'C', name: C, gym: true,
      items: [
        x('standweitsprung', 'Standweitsprung, Landung halten', ''),
        x('einbein-huepfer', 'Einbeiniger Hüpfer auf der Stelle, Landung halten', ''),
        x('kreuzheben', 'Rumänisches Kreuzheben', ''),
        x('hipthrust', 'Hip Thrust', ''),
        x('einbein-kh', 'Einbeiniges Kreuzheben', ''),
        x('khbank', 'KH-Bankdrücken oder Floor Press', ''),
        x('trizeps-iso', 'Trizeps E1: Isometrie Kabel 90°', ''),
        x('unterarm', 'Unterarm: Handgelenk-Strecker/-Beuger', ''),
      ],
    },
    {
      id: 'S', title: 'Sprint', name: '', gym: false,
      items: [x('shuttle', 'Sprint: bester Shuttle-Wert', 's', { shuttle: true })],
    },
  ],
});

// Schulterblatt-Block (Physio): am Ende jeder Gym-Einheit ab P2.
for (const p of PHASES) if (p.id !== 'P1') for (const u of p.units) if (u.gym) u.block = SB;

/** Physio und Dehnen an den übrigen Tagen. Tage: 1 = Mo … 7 = So. */
export const ROUTINE = [
  {
    title: 'Täglich · Physio',
    target: '6 min, Pflicht',
    days: [1, 2, 3, 4, 5, 6, 7],
    items: [
      { id: 'seitlage', name: 'Seitlage-Dehnung', target: 'Arm gestreckt nach hinten oben, 2 × 40 s/Seite' },
      { id: 'tennisball', name: 'Tennisball Schulterblatt (Wand/Boden)', target: '1–2 min/Seite, harte Punkte 20 s halten' },
      { id: 'aussenrot', name: 'Außenrotation beidarmig Band', target: 'Ellb am Körper, nach außen ziehen, 3 × 15' },
    ],
  },
  {
    title: 'Trizeps-Iso',
    target: '',
    days: [1, 2, 4, 6],
    items: [{ id: 'trizeps-iso', name: 'Trizeps-Iso Band 90°', target: '3 × 40 s' }],
  },
  {
    title: 'Dehnen',
    target: 'je 1 × 40 s/Seite, ca. 3 min',
    days: [2, 4, 6],
    items: [
      { id: 'hueftbeuger', name: 'Hüftbeuger', target: '' },
      { id: 'beinbeuger-dehnen', name: 'Beinbeuger', target: '' },
      { id: 'hocke', name: 'Tiefe Hocke', target: '' },
    ],
  },
];

export const ROUTINE_NOTES = [
  'An Gym-Tagen ist das im Workout: Tennisball und Außenrotation als Aufwärmen, Seitlage und Dehnen (Brust, Unterarm, Trizeps) nach der Einheit.',
  'Stress-Tag: nur den Physio-Block.',
];

/** Zusätze je Phase für Physio & Dehnen. */
export const ROUTINE_PHASE = {
  P5: ['Vorm Tennis: Trizeps-Iso 2 × 40 s', 'Schulterblatt-Block zum 3. Mal: Sa morgens mit Band'],
  P6: ['Schulterblatt-Block zum 3. Mal: Fr morgens mit Band'],
};

export const INFO = [
  ['Ellb-Ampel', 'Schmerz ≤3/10 ok · Folgetag schlechter → Arm 1 Stufe zurück'],
  ['DL = Deload', 'Gleiche Gewichte, ~40 % weniger Sätze, Sprünge halbiert'],
  ['E1 → E2', 'Iso → Pushdown 3-0-3 (2 Wo ≤2/10 + Physio)'],
  ['E2 → E3', 'Überkopf-Strecken (3 Wo ohne Folgetag)'],
  ['E3 → E4', 'Medball-Würfe (2 Wo schmerzfrei, ab W12)'],
  ['E4 → Aufschläge', 'ab W16 (2 Wo Würfe ok)'],
  ['Lauf', 'P2 40–50 · P3 45–60 · P4 30–40 min'],
];

// ---------- Kalender: W1 beginnt am Montag, 28.09.2026 ----------
const W1 = Date.UTC(2026, 8, 28);
const DAY = 86400000;
const utcDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/** Trainingswoche zu einem Datum (kann < 1 oder > 22 sein). */
export const weekOf = (date) => Math.floor((utcDay(date) - W1) / DAY / 7) + 1;

/** Montag der Woche als lokales Datum. */
export function weekStart(n) {
  const d = new Date(W1 + (n - 1) * 7 * DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const fmtDate = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;

/** Phase, in der die Woche liegt; davor P1, danach P6. */
export function phaseOfWeek(n) {
  return PHASES.find((p) => p.weeks.includes(n)) ?? (n < 1 ? PHASES[0] : PHASES[PHASES.length - 1]);
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
        map.set(it.id, { id: it.id, name: it.name.startsWith('+') ? `${it.name.replace(/^\+\s*/, '')} (Kontrast)` : it.name, shuttle: !!it.shuttle, order: prev?.order ?? map.size, group: prev?.group ?? g() });
      }
  return [...map.values()].sort((a, b) => a.group.order - b.group.order || a.order - b.order);
}

/** Alle Ergebnisse einer Übung, älteste zuerst. */
export const historyOf = (all, ex) => all.filter((e) => e.ex === ex).sort((a, b) => a.week - b.week || a.unit.localeCompare(b.unit));
