# Tennis Reaktionstraining

PWA für das iPhone. Die Frontkamera erkennt, wann du in der Mitte bereit stehst, und gibt dann ein Signal.
Alles läuft im Browser, die Kamerabilder verlassen das Gerät nicht. Keine Build-Schritte, keine Abhängigkeiten.

## Übungen

**5-10-5 Shuffle.** Du stehst auf der Mittellinie. Nach einer zufälligen Pause erscheint ein Pfeil nach links oder rechts.
Du läufst zu dieser Seite, dann zur Gegenseite und zurück durch die Mitte. Die Zeit stoppt, wenn du **zum zweiten Mal
die Mitte querst**. Du darfst dabei aus dem Bild laufen. Gespeichert werden Reaktionszeit (Pfeil bis Bewegungsbeginn),
Laufzeit (Bewegungsbeginn bis Ziel), Gesamtzeit (Pfeil bis Ziel), die Zeit bis zur ersten Querung und die Richtung.
Nicht gewertet werden Fehlstart, falsche Richtung, geratene Starts (Reaktion unter 100 ms) und Läufe, bei denen du
auf einer Seite nicht mindestens ca. 1,5 m von der Mitte weg warst.

**Richtungsbefehle.** Links, rechts oder vorne, jeweils nach einer zufälligen Pause. Der nächste Befehl kommt erst,
wenn du wieder ruhig in der Mitte stehst. Keine Zeitmessung, gespeichert werden nur Anzahl und Dauer der Einheit.

## Aufbau

- iPhone im **Hochformat** auf Hüfthöhe, Bildschirm zu dir, genau vor der Mittellinie, etwa 5 m entfernt.
  Die Mitte der Linie muss gut zu sehen sein. Die äußeren Linien müssen nicht im Bild sein.
- Kalibrierung ohne Tasten: auf der Mittellinie 1,5 s still stehen, ein Ton bestätigt. Die App misst in Rumpflängen
  (ca. 0,5 m) und funktioniert daher bei verschiedenen Abständen. Sie warnt, wenn das Gerät nicht mittig steht
  oder du sehr klein im Bild bist.
- Markiere Mitte und beide Linien auf dem Platz. Die App prüft die Wendepunkte nicht genau, die Strecke bestimmst du.
- Bildschirm bleibt an (Wake Lock). Gerät nicht sperren. Gute Beleuchtung, nicht gegen die Sonne filmen.

## Ausprobieren

1. **Ohne Kamera am Rechner:** `python3 -m http.server 8000` im Ordner, dann `http://localhost:8000/?sim=1` öffnen.
   Der Simulationsmodus lässt einen virtuellen Athleten laufen und zeigt die komplette Bedienung.
2. **Auf dem iPhone:** Die Kamera geht nur über HTTPS, zum Beispiel über GitHub Pages
   (Settings > Pages > Branch `main`, Ordner `/ (root)`).
3. Adresse in Safari öffnen, Teilen > „Zum Home-Bildschirm". Danach startet sie wie eine App.
   Beim ersten Start lädt die App die Erkennung (ca. 10 MB), danach läuft sie auch offline.

Optional für maximale Robustheit: `pose_landmarker_lite.task` von
`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
nach `models/` legen. Dann wird das Modell von deiner eigenen Adresse geladen.

## Tests

`node --test tests/*.test.mjs` (Node 20 oder neuer). Die Tests lassen simulierte Läufe mit Rauschen durch die
Zustandsmaschinen laufen: Reaktions- und Laufzeit, Läufer außerhalb des Bildes, späte Wiedererkennung am Bildrand,
Fehlstart, falsche Richtung, zu kurze Läufe, Kalibrierung und die Befehlsschleife.

## Genauigkeit

- Die Erkennung arbeitet mit ca. 30 Bildern pro Sekunde. In der Simulation liegt der Fehler typischerweise bei
  ±50 bis 70 ms, bei langsamem Antritt oder starkem Rauschen bei bis zu etwa 100 ms.
- Der Bewegungsbeginn wird aus dem Beschleunigungsverlauf zurückgerechnet und ist die unsicherste Größe. Reaktions- und
  Laufzeit verschieben sich dabei gegenläufig, die **Gesamtzeit (Pfeil bis Ziel)** ist deshalb am genauesten.
- Kritisch ist die zweite Querung: Du kommst aus dem Bild zurück, und die Erkennung muss dich am Rand wiederfinden.
  Die App schätzt den Durchgang dann aus den ersten Bildern nach dem Wiederauftauchen, in der Simulation bleibt der
  Fehler dabei auch bei 500 ms Verzögerung unter etwa 70 ms. Wie schnell die echte Erkennung dich am Rand wiederfindet,
  zeigt sich nur auf dem Gerät.
- Die Reaktionszeit enthält die Latenz von Kamera und Erkennung (grob 50 bis 100 ms). Für den Vergleich über die Zeit
  ist das unproblematisch, mit Stoppuhr-Werten oder Lichtschranken lässt sie sich nicht direkt vergleichen.
- Die Erkennung selbst ist mit echter Kamera noch nicht getestet: Beleuchtung, Abstand und Kleidung beeinflussen sie.

## Supabase später

`supabase/schema.sql` enthält Tabellen und Row-Level-Security (jeder sieht nur seine Zeilen). Dazu kommen ein
`SupabaseStore` in `js/storage.js` mit derselben Schnittstelle wie `LocalStore` (addTrial, addSession, listTrials,
listSessions, deleteAll, exportCSV) und eine Login-Seite (Magic Link). Die Oberfläche bleibt unverändert.

## Dateien

```
index.html, styles.css, manifest.webmanifest, sw.js
js/app.js              Oberfläche, Ablauf, Verlauf
js/shuffle-engine.js   Zustandsmaschine 5-10-5 (Zeitmessung)
js/command-engine.js   Zustandsmaschine Richtungsbefehle
js/calibration.js      freihändige Kalibrierung der Mitte
js/pose.js             Kamera + MediaPipe Pose Landmarker
js/storage.js          IndexedDB, CSV-Export
js/chart.js            Verlaufsdiagramm
js/sim-*.js            Simulationsmodus (?sim=1) und Test-Läufe
tests/                 Logiktests
```

## Konto und Cloud-Abgleich (optional)

Unter Einstellungen → Konto kann man sich mit E-Mail und Passwort anmelden (Supabase). Die App arbeitet weiter zuerst lokal;
mit Konto werden Zeiten zusätzlich hochgeladen und Zeiten anderer Geräte geladen (Abgleich über die Zeilen-ID, `js/cloud.js`).
Projekt-URL und publishable Key stehen in `js/config.js` (dürfen öffentlich sein, Schutz über Row Level Security,
Tabellen siehe `supabase/schema.sql`). „Alles löschen“ löscht bei angemeldetem Konto auch in der Cloud.

## Reaktionsdrill, Splitstep und Reaktionsspiel

- **Reaktionsdrill** (Platz, mit Kamera, `js/decoy-engine.js`, ersetzt Richtungsbefehle und Kreuzvorhaben): Pfeil links/rechts/vorne = loslaufen
  und zurück (Reaktionszeit wird geschätzt), rot = nichts tun, optional kippt Grün nach 0,2–0,4 s auf Rot (Fake). Rote Aufgaben,
  Fake-Signale und Splitstep lassen sich in den Einstellungen schalten. **Splitstep:** erst „Split!“ (Ton, Sprache, Anzeige), nach kurzer
  Pause der Pfeil; gemessen wird ab dem Pfeil, Losrennen vor dem Pfeil ist ein Fehlstart.
  Das Kamerabild ist nach der Kalibrierung ausgeblendet (Einstellung „Kamerabild im Drill anzeigen“), ein Punkt zeigt die Erkennung. Gespeichert wird pro Aufgabe richtig/falsch
  (`reason` = `go`, `stop`, `flip` bzw. `typ:fehler`).
- **Reaktionsspiel** (Couch, ohne Kamera, `js/couch-engine.js`): links/rechts/vorne antippen. Grün = tippen, Rot = nicht tippen,
  Grün-zu-Rot = nicht reinfallen, Blau = Fake (ignorieren, danach kommt oft gleich der echte Pfeil). 3 Leben, Punkte mit Serien-Bonus,
  alle 8 Treffer ein Level (schneller, mehr Täuschungen). Interne Übungsnamen: `decoy_court`, `decoy_couch`.
- Supabase: Wer `schema.sql` schon vorher ausgeführt hat, führt einmal `supabase/migration-2-spiele.sql` aus.
