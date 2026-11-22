# AfterWork Arcade – Roadmap

Sammlung von Wünschen und Ideen für spätere Versionen, damit nichts verloren geht.

- **Geplant:** fest vorgesehen, Reihenfolge = grobe Priorität.
- **Ideen:** noch nicht entschieden.

Wird ein Punkt umgesetzt, wandert er beim Release in `changelog.md` und wird hier gestrichen.

---

## Geplant

### Spiel-Session: mehrere Spiele nacheinander mit Gesamt-Rangliste
*Gewünscht am 2026-11-19.*

Der Host stellt eine Abfolge aus mehreren Spielen zusammen. Die Spiele laufen nacheinander, und am Ende gibt es eine Gesamt-Rangliste der Session.

**Vorbereitet seit 0.6.0:**
- `public/js/game-picker.js` führt die Auswahl bereits als geordnete Liste (`selectedIds`).
- Mit `maxSelection > 1` sind mehrere Spiele wählbar, mit Reihenfolge-Nummer auf dem Button.
- `onConfirm` liefert schon ein Array von Spiel-IDs.

**Ideen zur Umsetzung:**
- **Server:** `lobby.session = { queue: [gameId, …], index, scores: { userId: punkte } }`.
  - Neue Endpunkte, z. B. `POST /api/session/start` mit `{ gameIds }` und `POST /api/session/next`.
  - Neues SSE-Event `session` mit Fortschritt und Zwischenstand.
- **Spiel-Schnittstelle:** neuer, optionaler Export `resultOf(state)`.
  - Liefert `null`, solange das Spiel läuft.
  - Nach Spielende liefert er die Platzierungen, z. B. `[{ userId, place }]`.
  - Spiele ohne `resultOf` sind nicht session-fähig, oder ihr Ergebnis wird manuell bestätigt.
- **Punkte nach Platzierung**, z. B. 1. Platz = Anzahl Spieler, 2. Platz = Anzahl − 1 usw. Bots zählen nicht.
- **Anzeige:**
  - Nach jedem Spiel ein Zwischenstand.
  - Ein Fortschrittsbalken „Spiel 2 von 4“.
  - Am Ende eine Gesamt-Rangliste mit Podest.

**Offene Fragen:**
- Welches Punkteschema? Feste Punkte oder abhängig von der Spielerzahl?
- Was passiert mit Spielen ohne klares Ergebnis, z. B. der Eroberungs-Würfel als reines Hilfsmittel?
- Spieler, die mitten in der Session beitreten oder gehen: Punkte behalten, oder steigen sie mit 0 ein?
- Darf der Host Spiele überspringen oder die Session abbrechen?

---

## Ideen

### Weitere Spiele (Recherche 2026-11-20)

**Ziel:** Spiele, die einfach sind und schnell zu lernen. Gewünschte Richtung: Worms, Bomberman, Forts.

**Grundsatz:** Wir bauen eigene Spiele im jeweiligen Genre, mit eigenem Namen, eigener Grafik und eigenen Regeln. Die Vorbilder werden nicht nachgebaut.

**Was die Plattform technisch kann:**
- **Rundenbasierte Spiele** passen perfekt: Aktion per POST, Zustand per SSE (wie Schocken und der Eroberungs-Würfel).
- **Echtzeit:**
  - `tick()` läuft mit mindestens 50 ms, also bis zu 20 Hz.
  - Bei jeder Änderung geht der volle Zustand an alle.
  - Im LAN reicht das für **Bewegung auf einem Raster** (z. B. 100 ms pro Feld), wie bei Revierkampf.
- **Bausteine zum Wiederverwenden:**
  - aus Revierkampf: Bots, Canvas-Karte, Farben nach Theme, Tick.
  - aus Schocken: Becher, Würfel, verdeckte Infos (`viewFor`).

#### Aus den gewünschten Genres

| # | Arbeitstitel | Genre | Kurzidee | Lernzeit | Spieler | Aufwand | Technik |
|---|---|---|---|---|---|---|---|
| 3 | **Burgen-Duell** | Forts-Genre (vereinfacht) | Bauphase (60 s): Mauern und Kanonen auf der eigenen Seite bauen. Schussphase: abwechselnd feuern. Wer den gegnerischen Kern trifft, gewinnt. | 3 min | 2–8 (2 Teams) | hoch | baut auf dem Artillerie-Duell (0.10.0) auf, als **Modus davon**: `simulateShot`, `carve`, `resolveVolley`, `settleTanks` sind dafür schon als eigenständige Funktionen angelegt. Für Mauern über Hohlräumen bräuchte es statt des Höhenprofils ein Pixel- bzw. Block-Gelände. |

#### Schnelle Gewinne mit kleinem Aufwand

| # | Arbeitstitel | Kurzidee | Lernzeit | Spieler | Aufwand | Wiederverwendung |
|---|---|---|---|---|---|---|
| 6 | **Fünf-Würfel-Poker** | Yacht-Genre: 13 Kategorien, 3 Würfe pro Zug, Punktzettel | 3 min | 1–8 | klein–mittel | Schocken-Würfel |
| 7 | **Schiffe versenken** | Traditionell: Flotte setzen, abwechselnd schießen | 1 min | 2 (bzw. Turnier) | klein | `viewFor` für die verdeckte Flotte |

#### Partyspiele für größere Runden

| # | Arbeitstitel | Kurzidee | Lernzeit | Spieler | Aufwand | Hinweis |
|---|---|---|---|---|---|---|
| 8 | **Stadt-Land-Fluss** | Buchstabe, Kategorien, Stopp-Knopf. Danach stimmen alle über zweifelhafte Antworten ab. | 1 min | 2–12 | mittel | ideal für Feierabendrunden, keine Inhalte nötig |
| 9 | **Skizzen-Raten** | Einer zeichnet einen Begriff, die anderen raten im Chat | 1 min | 3–12 | mittel | braucht eine Begriffsliste; Zeichnen per Canvas |
| 10 | **Schätzduell** | Schätzfrage („Wie hoch ist …?“), wer am nächsten liegt, bekommt Punkte | 30 s | 2–12 | klein | braucht einen Fragenkatalog (JSON-Datei) |
| 11 | **Vier in einer Reihe** | Steine einwerfen, vier in einer Reihe gewinnt | 30 s | 2 | klein | Füller für kurze Wartezeiten |

#### Eher nicht geeignet
- **Pong, Air-Hockey, Rennspiele mit freier Physik und Echtzeit-Shooter:** Sie reagieren zu empfindlich auf Verzögerung, weil bei jeder Änderung der volle Zustand per SSE verschickt wird. Dafür bräuchte es Vorhersage auf dem Client.
- **Komplexe Strategie (z. B. im Stil von Siedler):** Lernzeit und Spieldauer sind für einen Feierabend zu lang.

#### Empfohlene Reihenfolge
1. ~~**Mäxchen**~~ – umgesetzt in 0.7.0.
2. ~~**Lichtrenner**~~ – umgesetzt in 0.8.0.
3. ~~**Bomben-Labyrinth**~~ – umgesetzt in 0.9.0.
4. ~~**Artillerie-Duell**~~ – umgesetzt in 0.10.0. Als Nächstes evtl. das **Burgen-Duell** als Modus davon.
5. ~~**Koop-Prügelspiel „Feierabend-Fäuste“**~~ – umgesetzt in 0.12.0.
6. ~~**Koop-Tower-Defense „Turmwacht“**~~ – umgesetzt in 0.13.0.
7. Partyspiele (Stadt-Land-Fluss, Skizzen-Raten) je nach Rundengröße.

**Gemeinsame Vorarbeit für Echtzeitspiele:** ~~ein Baustein für die Steuerung~~ – umgesetzt in 0.8.0 als
`public/js/game-kit/controls.js` (Pfeiltasten/WASD, Touch-Steuerkreuz, Wischen). Seit 0.9.0 auch mit „Taste halten“ (`onRelease`) und Aktionsknopf (`actionButton`), genutzt vom Bomben-Labyrinth und Artillerie-Duell. Seit 0.12.0 auch mit mehreren Aktionstasten (`actionButtons`), genutzt von Feierabend-Fäuste.

### Spielauswahl bei vielen Spielen
- Kategorien/Tags pro Spiel (`meta.tags`, z. B. „Würfel“, „Echtzeit“, „Karten“, „Strategie“) als Filter-Chips im Auswahl-Dialog.
- Eine Suche nach Titel und Beschreibung gibt es bereits; sie erscheint automatisch ab 7 Spielen.
- Optional: geschätzte Spieldauer (`meta.duration`) auf der Kachel.
