# Changelog

Alle wichtigen Änderungen an AfterWork Arcade werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/):
`MAJOR.MINOR.PATCH` – MINOR für neue Funktionen, PATCH für Fehlerbehebungen.

---

## [0.5.1] – 2026-11-19

### Geändert
- Schocken: Das **Laden** (erste Runde, ein Wurf pro Spieler) wird im Spiel klarer erklärt –
  laut Regeln zählt es bereits und der tiefste Wurf bekommt Deckel. Statuszeile
  („Laden (1 Wurf, zählt schon)“), Zughinweis, Setup-Dialog und Regel-Kurzfassung weisen darauf
  hin; die Auswertung meldet „Laden beendet – ab jetzt bis zu 3 Würfe, X beginnt.“
  Die Spiellogik ist unverändert.
- UI-Test prüft den Lade-Hinweis und die Zeile in der Auswertung.

---

## [0.5.0] – 2026-11-19

### Hinzugefügt
- **Dunkles Design (Dark-Mode)** für die gesamte Seite inkl. aller Spiele:
  - Kleiner runder Schalter oben rechts in der Kopfzeile (🌙 / ☀️), auch vor dem Login sichtbar.
    Umschalten wirkt sofort, auch während eines laufenden Spiels.
  - Die Wahl wird pro Browser gemerkt (`localStorage`, Schlüssel `awa-theme`); ohne
    gespeicherte Wahl gilt die Systemeinstellung. Kein helles Aufblitzen beim Laden.
  - Neues Modul `public/js/theme.js`; Design per `data-theme` am `<html>`-Element, Event
    `awa-themechange` für Spiele mit Canvas.
  - Risiko-Würfel: hellere Akzentfarben im Dunklen, Würfel bleiben weiß.
    Revierkampf: Karte unverändert, Umgebung dunkel. Schocken: Tisch und Würfel unverändert,
    Auswertung, eigener Bereich, Ereignisse und Regeln dunkel.
- Tests: UI-Test prüft Dark-Mode-Schalter, Speicherung nach Reload und die dunkle Darstellung
  von Revierkampf und Schocken (Screenshots 12–14) sowie den Schocken-Setup-Dialog (15).

### Geändert
- Basis-Styles: bisher feste Farben (Eingabefelder, Zweit-Buttons, Chat-Hintergrund, Dialog,
  Kopfzeile) laufen jetzt über CSS-Variablen.
- Schocken: Das Spielfeld (`.sk-table`) ist höher und wächst mit der Bildschirmhöhe
  (400–600 px) – der Setup-Dialog mit der Bot-Auswahl passt ohne Scrollen.

---

## [0.4.0] – 2026-11-18

### Hinzugefügt
- **Neues Spiel „Schocken“** – Kneipen-Würfelspiel nach den Regeln von schockfreunde.de
  („Jennie“ heißt hier „General“), klassische Rangfolge Schock Aus > Schock 6…2 > General >
  Straße > Zahlen:
  - Becher-Mechanik: Nach dem Wurf bleibt der Becher zu, auch für den Werfer. Aufdecken zeigt
    die Würfel allen; blind weiterwürfeln oder verdeckt beenden ist möglich.
  - Nur aufgedeckte Einsen dürfen herausgelegt werden; Sechsen drehen (2 → eine Eins,
    3 → zwei Einsen, nicht im letzten Wurf); General/Straße nur „aus der Hand“.
  - Der Erste gibt Wurfzahl und Spielweise vor – deckt er auf, müssen alle anderen beim
    Beenden ebenfalls aufdecken.
  - 13 Deckel: erst aus dem Topf, dann zwischen den Spielern; Schock Aus = alle Deckel.
    Laden, eine Hälfte oder komplett (zwei Hälften + Finale) – vom Host wählbar.
  - 0–5 Bots (spielen als Erster gelegentlich blind), Zugtimer 30 s.
  - Auswertung bleibt bis zu 30 s stehen, „Weiter“ ab 75 % der Spieler.
  - Ressourcenschonende Optik: Filztisch, CSS-Würfel mit Sprung-/Dreh-Animation beim Wurf
    und Umklappen beim Aufdecken, Deckel-Stapel, Zeitbalken als CSS-Animation (keine
    Animationsschleife, kein Canvas). Regel-Kurzfassung unter dem Spielfeld.
- **Spielerspezifische Sicht für Spiele (`viewFor`)**: Spiele können optional
  `viewFor(state, userId)` exportieren. `server/sync.js` schickt dann jedem Mitglied nur seine
  gefilterte Sicht (auch nach Reload) – geheime Informationen verlassen den Server nicht.
  Bestehende Spiele ohne `viewFor` funktionieren unverändert.
- Tests: `tests/schocken.test.mjs` (25 Prüfungen), Schocken im API-Test (Sichtbarkeit per SSE,
  „Weiter“) und im UI-Test (verdeckte Würfel, laufende Würfelanimation, Aufdecken, Herauslegen
  nur von Einsen, „Weiter“). Neues Skript `npm run test:schocken`.

### Geändert
- Vorlage `games/_vorlage/game.js` dokumentiert den `viewFor`-Hook.

### Getestet
- Alle automatisierten Prüfungen bestanden (68 API, 23 Revierkampf, 25 Schocken, 4 Reconnect, 31 UI).

---

## [0.3.1] – 2026-11-18

### Behoben
- Der Browser bietet nach Eingabe eines Lobby-Passworts nicht mehr an, es zu speichern.
  Die beiden Passwortfelder (Lobby erstellen, Beitritts-Dialog) sind keine Browser-Passwortfelder
  mehr; die Eingabe wird per CSS (`-webkit-text-security`) verdeckt. Zusätzlich werden
  Passwort-Manager-Erweiterungen per `data-1p-ignore` / `data-lpignore` ferngehalten.
  Browser ohne diese CSS-Eigenschaft erhalten automatisch wieder ein echtes Passwortfeld.

### Getestet
- Alle automatisierten Prüfungen bestanden (63 API, 23 Revierkampf, 4 Reconnect, 27 UI),
  inkl. neuer Prüfung „kein Browser-Passwortfeld, Eingabe verdeckt“.

---

## [0.3.0] – 2026-11-18

### Hinzugefügt
- **Neues Spiel „Revierkampf“** – Echtzeit-Gebietseroberung auf einer Zufallskarte mit Seen:
  - Vorbereitung durch den Host (0–8 Bots), Startphase von 10 s mit frei wählbarem Startpunkt.
  - Truppen wachsen ständig; Angriffe mit einstellbarer Stärke (10–100 %) erobern Feld für Feld
    neutrales Land oder gegnerische Gebiete. Gegenseitige Angriffe heben sich auf.
  - Einfache Bots, Rangliste, Ereignis-Log, Sieg bei 70 % des Landes oder als Letzter.
  - Canvas-Darstellung mit Namen und Truppen je Revier, passt sich Spielmodus und Handy an.
- **Spiel-Takt für Echtzeitspiele:** Spiele können optional `tick(state, { now, dtMs, hostId })`
  und `meta.tickMs` angeben (`server/game-ticker.js`, ein gemeinsamer Timer für alle Lobbys).
- Spiele erhalten zusätzliche Infos: `createState({ players, hostId, now })` und
  `handleAction(state, action, player, { hostId, now })` – z. B. für Host-Einstellungen.
  Bestehende Spiele funktionieren unverändert.
- Tests: `tests/revierkampf.test.mjs` (23 Prüfungen), Revierkampf und Spiel-Takt im API-Test,
  eine Revierkampf-Runde im UI-Test; `npm run test:revierkampf`.

### Geändert
- Vorlage `games/_vorlage` und Dokumentation (Abschnitt 7) um `tick` und den Kontext-Parameter ergänzt.
- Dokumentation: Abschnitt 8 beschreibt jetzt beide Spiele.

### Getestet
- Alle automatisierten Prüfungen bestanden (63 API, 23 Revierkampf, 4 Reconnect, 26 UI), Edge headless.
- Lasttest Revierkampf mit 16 Teilnehmern: Ø ca. 2 ms pro Tick, Zustand ≤ 16 KB.

---

## [0.2.0] – 2026-11-18

### Hinzugefügt
- **Spielmodus:** Sobald der Host ein Spiel startet, werden die Lobby-Elemente kompakt an die
  Seitenränder angedockt und das Spiel nutzt die volle Bildschirmhöhe in der Mitte.
  - Links: Lobby-Kopf, Mitglieder, Einladungslink. Rechts: Lobby-Chat, Online-Liste, globaler Chat.
  - Online-Liste und globaler Chat sind im Spielmodus eingeklappt und per Klick aufklappbar.
  - Beide Leisten lassen sich per Schalter einklappen; der Zustand wird pro Browser gemerkt.
  - Roter Hinweis-Punkt bei neuen Nachrichten in eingeklappten Bereichen.
  - Unter 900 px Breite: Spiel oben, Lobby-Elemente darunter.
  - Nach „Spiel beenden“ erscheint wieder die gewohnte Lobby-Ansicht.
- UI-Tests für den Spielmodus (Anordnung, Einklappen, Hinweis-Punkte, Mobilansicht).

### Geändert
- Versionierungs-Ablauf in `dokumentation.md` (Abschnitt 11) auf den `_dev`-Ablauf aus
  `README_claude-code.txt` umgestellt: Änderungen erfolgen in einer Kopie `_dev`, erst nach der
  Freigabe wird `_stable` → `vX.Y.Z` und `_dev` → `_stable` umbenannt.

### Getestet
- Alle automatisierten Prüfungen bestanden (57 API, 4 Reconnect, 20 UI), Edge headless.

---

## [0.1.0] – 2026-11-17

Erste Version des Lobby-Systems. Der bisher eigenständige Risiko-Würfel ist jetzt
ein Spiel innerhalb des Lobby-Systems.

### Hinzugefügt
- **Lobby-System** auf Basis von Node.js ohne externe Abhängigkeiten (kein `npm install` nötig).
- **Anmeldung per Username** (2–20 Zeichen, eindeutig, ohne Account/Passwort).
  Die Sitzung übersteht einen Reload der Seite (Token im `localStorage`, 30 s Grace-Period).
- **Lobbys erstellen und beitreten**
  - Sichtbarkeit *offen* (in der Übersicht gelistet) oder *privat* (nur per Code/Link).
  - Optionales Passwort (gespeichert als scrypt-Hash).
  - 6-stelliger Lobby-Code und Einladungslink `/?join=CODE`.
  - Automatische Host-Übergabe, wenn der Host die Lobby verlässt; leere Lobbys werden gelöscht.
  - Maximal 8 Mitglieder pro Lobby (konfigurierbar).
- **Globaler Chat** und **Lobby-Chat** mit Verlauf (letzte 50 Nachrichten) und Systemnachrichten.
- **Online-Liste** aller angemeldeten User.
- **Spiel-Plugin-System**: Spiele liegen als eigene Ordner unter `games/` und werden beim
  Serverstart automatisch erkannt. Vorlage unter `games/_vorlage/`.
- **Host-Steuerung**: Spiel auswählen und für alle starten, jederzeit beenden.
- **Risiko-Würfel als Plugin** mit Kampfauswertung:
  - Würfel werden absteigend sortiert und paarweise verglichen, Gleichstand gewinnt der Verteidiger.
  - Anzeige der Verluste beider Seiten und Rundenzähler.
  - Anzeige, wer gewürfelt hat.
- Verbindungsanzeige in der Kopfzeile, automatische Wiederverbindung.
- Startmeldung zeigt Version und Netzwerkadressen des Servers an.
- Versionsnummer in der Kopfzeile, Favicon.
- Einladungslinks verwenden die LAN-Adresse, wenn die Seite über `localhost` geöffnet wurde.
- Endpunkt `GET /api/info` (Version, LAN-Adressen).
- `dokumentation.md` und `changelog.md`.

### Geändert
- Risiko-Würfel: Der Verteidiger darf nur noch 1–2 Würfel werfen (vorher 1–3).
- Risiko-Würfel: Die bedeutungslose Augensumme wurde durch die Kampfauswertung ersetzt.
- Risiko-Würfel: Jede Seite darf pro Runde nur einmal würfeln.
- Aufgeteilte Code-Struktur (`server/`, `public/`, `games/`) statt einer einzelnen Server-Datei.

### Behoben
- Nachzügler und Reloads sehen jetzt sofort den aktuellen Stand (vorher leere Anzeige bis zum nächsten Wurf).
- Echtzeit-Verbindung sendet alle 25 s einen Heartbeat, damit Proxys sie nicht schließen.
- Statische Dateien: Query-Strings (z. B. `?v=2`) führen nicht mehr zu 404, und der Pfad wird
  zuverlässig auf den erlaubten Ordner beschränkt.
- Größenlimit (16 KB) für Request-Bodys.

- **Automatisierte Tests** unter `tests/` (ohne npm-Pakete):
  - `npm test` – API-/Event-Test (57 Prüfungen)
  - `npm run test:reconnect` – Grace-Period bei Verbindungsabbrüchen (4 Prüfungen)
  - `npm run test:ui` – Browser-Test mit zwei Spielern in headless Edge/Chrome (17 Szenarien)
  - `npm run test:all` – alle Tests
- `RECONNECT_GRACE_MS` lässt sich per Umgebungsvariable setzen (verkürzt den Reconnect-Test).

### Getestet
- Alle 78 automatisierten Prüfungen bestanden (mehrfach wiederholt, Node.js 26, Edge 157).

---

## [0.0.1]

Ausgangsbasis: eigenständiger Risiko-Würfel (`v0.0.1/Risiko-Wuerfel`).
- Angreifer und Verteidiger würfeln mit 1–3 Würfeln, Ergebnis wird live an alle Browser verteilt.
- Anzeige der Augensumme.
