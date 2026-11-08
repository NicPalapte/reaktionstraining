# Plan: Umbau zu „Off Season“

Ziel: eine Trainings-App speziell für die Tennis-Off-Season mit drei Säulen: **Physis, Reaktion, Mental**.
Dazu kommen Trainingswissen, eine Übungsbibliothek und ein Planbaukasten.
Grundlage ist [trainingswissen.md](trainingswissen.md).

## Leitentscheidungen

1. **PWA bleibt, App Store bleibt möglich.** Vanilla JS ohne Build-Schritt. Inhalte wie Übungen, Vorlagen und Wissen sind reine Daten und liegen getrennt von der Oberfläche.
   Später kann Capacitor die PWA in eine iOS-App packen: Kamera und MediaPipe laufen in WKWebView, IndexedDB und Supabase bleiben.
   Wake Lock, Audio und Kamerazugriff kapseln wir schon jetzt in einer dünnen Schicht `platform.js`, damit sie später gegen native Plugins austauschbar sind.
2. **Dein Plan bleibt unangetastet.** „Wintertraining 26/27“ wird ein fest eingebauter, persönlicher Plan. Bestehende Daten, Übungs-IDs und Verlauf bleiben gleich.
   Der Name der IndexedDB (`tennis-reaktion`) und die Supabase-Tabellen bleiben trotz Umbenennung bestehen, sonst gehen Daten verloren.
3. **Bibliothek vor Generator.** Zuerst stellst du Pläne selbst zusammen, Vorlagen helfen beim Start. Ein automatischer Generator kommt erst danach, falls er sich lohnt.
4. **Die Evidenz ist sichtbar.** Jede Übung und jeder Wissensartikel trägt eine Evidenzstufe (gut, mittel, schwach) und Quellen.

## Navigation (neu)

| Tab | Inhalt |
|---|---|
| **Heute** | nächste Einheit aus dem aktiven Plan, Bereitschaftscheck, Schnellstart der Kamera-Drills |
| **Pläne** | aktiver Plan, Wintertraining 26/27, Vorlagen, eigene Pläne, Planeditor |
| **Bibliothek** | Übungen filtern nach Säule, Kategorie, Ausrüstung, Phase und Ort |
| **Wissen** | Artikel zu Physis, Reaktion, Mental und Periodisierung |
| **Verlauf** | wie bisher, ergänzt um Session-RPE, Mental-Einträge und Testergebnisse |

Die Einstellungen wandern hinter ein Zahnrad.

## Datenmodell

```js
// Übung (Bibliothek, js/library/*.js)
{ id: 'bss', name: 'Bulgarian Split Squat', pillar: 'physis', cat: 'einbeinig',
  equip: ['kurzhantel', 'bank'], place: ['gym', 'zuhause'], phases: ['grundlage','kraft','power'],
  dose: { grundlage: '3 × 8–12/Bein, RPE 7–8', kraft: '4 × 4–6/Bein' },
  how: '…', cues: ['Knie über Fuß', '…'], evidence: 'mittel', sources: ['…'],
  app: null /* oder 'shuffle' | 'spider' | 'decoy' | 'brake' | 'breath' | 'imagery' … */ }

// Plan (Vorlage oder eigener Plan, gespeichert in IndexedDB + Supabase)
{ id, name, focus: ['power','reaktion'], weeks: 16, perWeek: 4, start: '2026-11-16',
  blocks: [{ name: 'Grundlage', weeks: [1,2,3,4], deload: 4, goal: '…',
             units: [{ id: 'A', title: 'Kraft A', items: [{ ex: 'bss', dose: '…' }] }] }] }
```

Das Format von Wintertraining 26/27 entspricht dem schon fast (`PHASES` → `blocks`, `units`, `items`). Es wird über einen Adapter eingelesen, statt neu geschrieben zu werden.

## Kriterien und Schwerpunkte für Pläne

Abgeleitet aus der Recherche:

- **Dauer:** 8, 12, 16 oder 20 Wochen. Die Blöcke skalieren mit, siehe Trainingswissen, Abschnitt 1.
- **Einheiten pro Woche:** 2–5. Die Wochenvorlage folgt den Regeln zu Abständen (48 h, Kraft vor Ausdauer, Reaktion frisch).
- **Ausrüstung und Ort:** Gym, Zuhause, Platz, Halle.
- **Schwerpunkt** (Gewichtung der Säulen):

  | Vorlage | Idee |
  |---|---|
  | Ausgewogen | Physis 50 / Reaktion 30 / Mental 20 |
  | Power & Aufschlag | Kraft- und Power-Blöcke länger, Medizinball, Schulter |
  | Schnelligkeit & Reaktion | Abbremsen, Richtungswechsel, reaktive Drills ≥ 3 ×/Wo, Progression in 6 Stufen |
  | Robust bleiben / Comeback | Prävention, Sehnen, niedrige Intensität, langsame Steigerung |
  | Mental-Fokus | PST-Ablauf, Imagery 3 ×/Wo, Routinen und Drucktraining |
  | Kurz & knapp | 2 × 45 min/Wo als Erhalt |

## Phasen der Umsetzung

| # | Inhalt | Ergebnis |
|---|---|---|
| 0 | Bestehende, noch nicht committete Arbeit sichern (Spider-Drill usw.) | sauberer Ausgangspunkt |
| 1 | **Umbenennung und neue Navigation:** Name, Manifest, Icons, Titel, Service-Worker-Version, README, Tabs | App heißt Off Season, alles funktioniert wie vorher |
| 2 | **Bibliothek:** Datenmodell, ca. 80–100 Übungen (Physis ca. 55, Reaktion ca. 15 inkl. Kamera-Drills, Mental ca. 15), Liste mit Filtern, Detailansicht | durchsuchbare Bibliothek |
| 3 | **Pläne:** Plan-Modell, Adapter für Wintertraining 26/27, Planeditor (Blöcke, Einheiten, Übungen aus der Bibliothek), 3–6 Vorlagen, „Heute“-Ansicht, Sync über Supabase (migration-5) | eigene Pläne zusammenstellen |
| 4 | **Wissen:** Artikel aus trainingswissen.md, kurz und mit Evidenzstufe, aus Übungen und Plänen verlinkt | Wissensbereich |
| 5 | **Mental-Werkzeuge:** Atem-Pacer, Imagery-Skripte, Selbstgesprächskarten, Routinen-Baukasten, Reflexion, MRF-3 | Mental-Säule nutzbar |
| 6 | **Steuerung:** Session-RPE, Bereitschaftscheck, Deload-Hinweise, Testauswertung mit eigenem Messfehler (5-10-5, Spider) | Belastung und Fortschritt sichtbar |
| 7 | **Reaktion schärfen:** Splitstep mit Vorsignal (150–300 ms, variabel), Stufen der Progression im Reaktionsdrill, Abbruch bei mehr als 3–5 % Leistungsabfall | Drills folgen der Methodik |
| später | App Store: Capacitor-Hülle, Prüfung des Markennamens, Datenschutzseite, native Kamera-Berechtigung | |

Jede Phase ist für sich nutzbar und wird mit Tests (`node --test`) und im Simulationsmodus geprüft.

## Offene Fragen an dich

1. Wie sollen Vorlagen und eigene Pläne entstehen? Möglich sind ein **freier Editor** oder ein **Assistent**, der aus Dauer, Einheiten, Ausrüstung und Schwerpunkt einen Entwurf baut, den du dann anpasst.
2. Bleibt Wintertraining 26/27 nur auf deinem Gerät bzw. in deinem Konto, oder soll es auch als Vorlage für andere dienen?
3. Wer soll die App nutzen: nur du, Mitspieler oder öffentlich? Das entscheidet über Konto-Pflicht, Datenschutz und den App-Store-Aufwand.
