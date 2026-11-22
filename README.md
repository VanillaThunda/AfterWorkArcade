# AfterWork Arcade

Ein Lobby-System für Multiplayer-Spiele im Browser – gedacht für Spieleabende im lokalen Netzwerk.
Einer startet den Server, alle anderen öffnen die Adresse im Browser, wählen einen Namen,
treffen sich in einer Lobby und spielen gemeinsam. Bots füllen leere Plätze auf.

- **Node.js ≥ 18, keine npm-Abhängigkeiten, kein Build-Schritt**
- Server ist die einzige Quelle der Wahrheit: Aktionen per `POST /api/...`, Zustand per Server-Sent Events
- Lobbys (offen, privat, mit Passwort), Einladungslinks, Lobby- und globaler Chat
- Hell-/Dunkel-Design, Smartphone-tauglich, automatische Wiederverbindung
- Neue Spiele als Plugin-Ordner unter `games/<id>/` (Vorlage: `games/_vorlage/`)

## Schnellstart

```sh
npm start          # Server auf Port 3000, erreichbar im ganzen LAN
```

Danach `http://localhost:3000` öffnen. Die Adresse für andere Geräte im Netzwerk zeigt der Server beim Start an.
Port und Adresse lassen sich über `PORT` und `HOST` ändern.

## Spiele

| Spiel | Art | Kurz |
|---|---|---|
| **Artillerie-Duell** | rundenbasiert, 1–6 + Bots | Alle zielen gleichzeitig mit Winkel und Kraft, dann fliegen die Granaten – Wind, zerstörbares Gelände, drei Waffen. |
| **Bomben-Labyrinth** | Echtzeit, 1–8 + Bots | Bomben legen, Kisten sprengen, Power-ups sammeln – wer zuletzt steht, gewinnt. |
| **Feierabend-Fäuste** | Koop-Echtzeit, 1–4 + Bots | Prügelspiel im Seitenscroller: drei Abschnitte, Gegnerwellen und ein Bosskampf. |
| **Eroberungs-Würfel** | Hilfsmittel, 1–8 | Würfelhelfer für Brettspiel-Abende mit automatischer Kampfauswertung. |
| **Lichtrenner** | Echtzeit, 1–8 + Bots | Alle fahren gleichzeitig und ziehen eine Leuchtspur – nicht dagegen fahren. |
| **Mäxchen** | Würfelspiel, 1–10 + Bots | Verdeckt würfeln, höher ansagen, bluffen oder anzweifeln. |
| **Revierkampf** | Echtzeit-Strategie, ab 1 + Bots | Revier aufbauen und Nachbarn erobern, bis eine Seite 70 % des Landes hält. |
| **Schocken** | Würfelspiel, 1–8 + Bots | Das Kneipen-Würfelspiel mit Bechern, Deckeln, Hälften und Finale. |
| **Turmwacht** | Koop-Tower-Defense, 1–4 | Türme am zufälligen Pfad bauen und upgraden, Gold teilen und verschenken – 10/20/30 Wellen oder endlos. |

Alle Spiele sind eigene Umsetzungen bekannter Genres bzw. traditioneller Würfelspiele – mit eigenem
Code, eigener Grafik und eigenen Namen. Es besteht keine Verbindung zu Herstellern oder Markeninhabern.

## Tests

```sh
npm run test:all   # alle Tests: API, Spiellogik, Wiederverbindung, Browser-UI (Edge/Chrome headless)
```

Einzelne Testdateien und weitere Befehle stehen in [`dokumentation.md`](dokumentation.md#12-tests).

## Weitere Dokumente

- [`dokumentation.md`](dokumentation.md) – vollständige Referenz: Architektur, API, Events, Regeln aller Spiele, eigenes Spiel hinzufügen
- [`changelog.md`](changelog.md) – Änderungen je Version
- [`roadmap.md`](roadmap.md) – Ideen und Pläne für kommende Versionen

## Lizenz

[MIT](LICENSE)
