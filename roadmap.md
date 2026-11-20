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
- Was passiert mit Spielen ohne klares Ergebnis, z. B. Risiko-Würfel als reines Hilfsmittel?
- Spieler, die mitten in der Session beitreten oder gehen: Punkte behalten, oder steigen sie mit 0 ein?
- Darf der Host Spiele überspringen oder die Session abbrechen?

---

## Ideen

### Weitere Spiele (Recherche 2026-11-20)

**Ziel:** Spiele, die einfach sind und schnell zu lernen. Gewünschte Richtung: Worms, Bomberman, Forts.

**Grundsatz:** Wir bauen eigene Spiele im jeweiligen Genre, mit eigenem Namen, eigener Grafik und eigenen Regeln. Die Vorbilder werden nicht nachgebaut.

**Was die Plattform technisch kann:**
- **Rundenbasierte Spiele** passen perfekt: Aktion per POST, Zustand per SSE (wie Schocken und Risiko).
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
| 1 | **Bomben-Labyrinth** | Bomberman-Genre | Rasterarena, Bomben legen, Kisten sprengen, Power-ups (Reichweite, Anzahl, Tempo). Wer zuletzt steht, gewinnt. | 1 min | 2–8 + Bots | mittel | Tick 100 ms, Raster 15×13, Pfeiltasten/WASD |
| 2 | **Artillerie-Duell** | Worms-/Scorched-Earth-Genre | Rundenbasiert: Winkel, Kraft und Wind, zerstörbares Gelände. Der Server berechnet die Flugbahn, der Client spielt sie als Animation ab. Wenige Waffen (Granate, Splitter, Bohrer). | 2 min | 2–6 + Bots | mittel–hoch | rundenbasiert, Gelände als Bitmap-Text wie die Revierkampf-Karte |
| 3 | **Burgen-Duell** | Forts-Genre (vereinfacht) | Bauphase (60 s): Mauern und Kanonen auf der eigenen Seite bauen. Schussphase: abwechselnd feuern. Wer den gegnerischen Kern trifft, gewinnt. | 3 min | 2–8 (2 Teams) | hoch | baut auf dem Artillerie-Duell auf, später als **Modus davon** |

#### Schnelle Gewinne mit kleinem Aufwand

| # | Arbeitstitel | Kurzidee | Lernzeit | Spieler | Aufwand | Wiederverwendung |
|---|---|---|---|---|---|---|
| 4 | **Mäxchen (Meiern)** | Traditionelles Bluff-Würfelspiel: verdeckt würfeln, ansagen, man darf lügen. Der Nächste glaubt oder deckt auf. | 1 min | 2–10 + Bots | klein | Schocken: Becher, Würfel, `viewFor`, Bots |
| 5 | **Lichtrenner** | Lichtspur-Genre: Alle fahren gleichzeitig und ziehen eine Spur. Wer eine Wand oder Spur trifft, scheidet aus. | 30 s | 2–8 + Bots | klein | Revierkampf: Canvas, Tick, Bots |
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
1. **Mäxchen:** schnell gebaut dank der Schocken-Bausteine. Es liefert ein klares Ergebnis für die spätere Spiel-Session.
2. **Lichtrenner:** das einfachste Echtzeitspiel. Es testet schnellen Tick und Tastatursteuerung für das Bomben-Labyrinth.
3. **Bomben-Labyrinth:** das Highlight aus den gewünschten Genres.
4. **Artillerie-Duell,** danach **Burgen-Duell** als Modus davon.
5. Partyspiele (Stadt-Land-Fluss, Skizzen-Raten) je nach Rundengröße.

**Gemeinsame Vorarbeit für Echtzeitspiele:** ein Baustein für die Steuerung.
- Tastatur (Pfeiltasten/WASD), aktiv nur, solange der Fokus nicht in einem Eingabefeld wie dem Chat liegt.
- Touch-Steuerung mit einem Steuerkreuz für Handys.
- Neue Spiele nutzen diesen Baustein gemeinsam.

### Spielauswahl bei vielen Spielen
- Kategorien/Tags pro Spiel (`meta.tags`, z. B. „Würfel“, „Echtzeit“, „Karten“, „Strategie“) als Filter-Chips im Auswahl-Dialog.
- Eine Suche nach Titel und Beschreibung gibt es bereits; sie erscheint automatisch ab 7 Spielen.
- Optional: geschätzte Spieldauer (`meta.duration`) auf der Kachel.
