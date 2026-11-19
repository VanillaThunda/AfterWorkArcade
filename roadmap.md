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

### Spielauswahl bei vielen Spielen
- Kategorien/Tags pro Spiel (`meta.tags`, z. B. „Würfel“, „Echtzeit“, „Karten“, „Strategie“) als Filter-Chips im Auswahl-Dialog.
- Eine Suche nach Titel und Beschreibung gibt es bereits; sie erscheint automatisch ab 7 Spielen.
- Optional: geschätzte Spieldauer (`meta.duration`) auf der Kachel.
