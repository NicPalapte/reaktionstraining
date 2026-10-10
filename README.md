# Tennis Reaktionstraining

PWA für das iPhone. Die Frontkamera erkennt, wann du in der Mitte bereit stehst, und gibt dann ein Signal.
Alles läuft im Browser, die Kamerabilder verlassen das Gerät nicht. Keine Build-Schritte, keine Abhängigkeiten.

## Übungen

**5-10-5 Shuffle.** Du stehst in der Mitte. Nach einer zufälligen Pause erscheint ein Pfeil nach links oder rechts.
Du läufst zu dieser Seite, dann zur Gegenseite (über die Mitte) und zurück in die Mitte. Gespeichert werden
Reaktionszeit (Pfeil bis Bewegungsbeginn), Laufzeit (Bewegungsbeginn bis Ziel), Gesamtzeit (Pfeil bis Ziel),
Zwischenzeiten an den Wendepunkten und die Richtung. Fehlstarts, falsche Richtung und geratene Starts
(Reaktion unter 100 ms) werden nicht gewertet.

**Richtungsbefehle.** Links, rechts oder vorne, jeweils nach einer zufälligen Pause. Der nächste Befehl kommt erst,
wenn du wieder ruhig in der Mitte stehst. Keine Zeitmessung, gespeichert werden nur Anzahl und Dauer der Einheit.

## Aufbau

- Gerät auf Hüfthöhe, Bildschirm zu dir, Querformat. Du musst an beiden Linien noch ganz im Bild sein.
  Bei 5 Yards (4,6 m) pro Seite brauchst du je nach iPhone etwa 5 bis 6 m Abstand. Die Kalibrierung warnt, wenn
  eine Linie zu nah am Bildrand liegt. Du kannst die Linien auch näher setzen, die App misst relativ zu deiner Kalibrierung.
- Kalibrierung ohne Tasten: Mitte, linke Linie, rechte Linie, jeweils 1,5 s still stehen. Ein Ton bestätigt jeden Schritt.
- Bildschirm bleibt an (Wake Lock). Gerät nicht sperren.

## Ausprobieren

1. **Ohne Kamera am Rechner:** `python3 -m http.server 8000` im Ordner, dann `http://localhost:8000/?sim=1` öffnen.
   Der Simulationsmodus lässt einen virtuellen Athleten laufen und zeigt die komplette Bedienung.
2. **Auf dem iPhone:** Die Kamera geht nur über HTTPS. Am einfachsten den Ordner veröffentlichen:
   - Netlify: `app.netlify.com/drop`, den Ordner hineinziehen. Fertig.
   - oder GitHub Pages: Ordner in ein Repository, unter Settings > Pages aktivieren.
   - oder nur zum Testen: `cloudflared tunnel --url http://localhost:8000` gibt eine temporäre HTTPS-Adresse.
3. Adresse in Safari öffnen, Teilen > „Zum Home-Bildschirm". Danach startet sie wie eine App.
   Beim ersten Start lädt die App die Erkennung (ca. 10 MB), danach läuft sie auch offline.

Optional für maximale Robustheit: `pose_landmarker_lite.task` von
`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
nach `models/` legen. Dann wird das Modell von deiner eigenen Adresse geladen.

## Tests

`node --test tests/*.test.mjs` (Node 20 oder neuer). Die Tests lassen simulierte Läufe mit Rauschen durch die
Zustandsmaschinen laufen und prüfen Reaktionszeit, Laufzeit, Fehlstart, falsche Richtung, Kalibrierung und die Befehlsschleife.

## Genauigkeit

- Die Erkennung arbeitet mit ca. 30 Bildern pro Sekunde. In der Simulation liegt der Fehler bei typischen Läufen
  bei etwa ±70 ms, in schlechten Fällen (langsamer Antritt, starkes Rauschen) bei bis zu 150 ms.
- Der Bewegungsbeginn wird aus dem Beschleunigungsverlauf zurückgerechnet und ist die unsicherste Größe.
  Reaktions- und Laufzeit verschieben sich dabei gegenläufig, die **Gesamtzeit (Pfeil bis Ziel)** ist deshalb am genauesten.
- Die Reaktionszeit enthält die Latenz von Kamera und Erkennung (grob 50 bis 100 ms). Für den Vergleich über die Zeit
  ist das unproblematisch, mit Stoppuhr-Werten oder Lichtschranken lässt sie sich nicht direkt vergleichen.
- Das Ziel wird beim Erreichen der Mittellinie gemessen, mit leichter Rückrechnung, falls du durchläufst.
  Die Erkennung selbst ist mit echter Kamera noch nicht getestet: Beleuchtung, Abstand und Kleidung beeinflussen sie.
  Wenn etwas hakt, zuerst Abstand, Licht und die Anzeige der Linien im Bild prüfen.

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
js/calibration.js      freihändige Kalibrierung
js/pose.js             Kamera + MediaPipe Pose Landmarker
js/storage.js          IndexedDB, CSV-Export
js/chart.js            Verlaufsdiagramm
js/sim-*.js            Simulationsmodus (?sim=1) und Test-Läufe
tests/                 Logiktests
```
