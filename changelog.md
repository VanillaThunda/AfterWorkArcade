# Changelog

Alle wichtigen Änderungen an AfterWork Arcade werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/):
`MAJOR.MINOR.PATCH` – MINOR für neue Funktionen, PATCH für Fehlerbehebungen.

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
