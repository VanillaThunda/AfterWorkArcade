# AfterWork Arcade – Dokumentation

**Version:** 0.13.0 (siehe `package.json` und `changelog.md`)

AfterWork Arcade ist ein Web-basiertes Lobby-System für das lokale Netzwerk. Mitspieler rufen
eine Adresse im Browser auf, wählen einen Usernamen, erstellen oder betreten Lobbys, chatten
und spielen gemeinsam Spiele bzw. nutzen Tools – aktuell den **Eroberungs-Würfel**, das
Echtzeit-Strategiespiel **Revierkampf**, das Kneipen-Würfelspiel **Schocken**, das
Bluff-Würfelspiel **Mäxchen**, das Echtzeit-Lichtspurspiel **Lichtrenner**, das
Echtzeit-Bombenspiel **Bomben-Labyrinth**, das rundenbasierte **Artillerie-Duell**, das
Koop-Prügelspiel **Feierabend-Fäuste** und das Koop-Tower-Defense **Turmwacht**.

---

## Inhalt

1. [Start und Betrieb](#1-start-und-betrieb)
2. [Funktionen im Überblick](#2-funktionen-im-überblick)
3. [Architektur](#3-architektur)
4. [Ordnerstruktur](#4-ordnerstruktur)
5. [Kommunikation: API und Events](#5-kommunikation-api-und-events)
6. [Lobby-Regeln](#6-lobby-regeln)
7. [Neues Spiel hinzufügen](#7-neues-spiel-hinzufügen)
8. [Spiele: Eroberungs-Würfel, Revierkampf, Schocken, Mäxchen, Lichtrenner, Bomben-Labyrinth, Artillerie-Duell, Feierabend-Fäuste, Turmwacht](#8-spiele-eroberungs-würfel-revierkampf-schocken-mäxchen-lichtrenner-bomben-labyrinth-artillerie-duell-feierabend-fäuste-turmwacht)
9. [Konfiguration](#9-konfiguration)
10. [Grenzen und Sicherheit](#10-grenzen-und-sicherheit)
11. [Versionierung mit Git](#11-versionierung-mit-git)
12. [Tests](#12-tests)

---

## 1. Start und Betrieb

**Voraussetzung:** Node.js ab Version 18. Es werden **keine** npm-Pakete benötigt –
ein `npm install` ist nicht nötig.

```bash
cd AfterWorkArcade/main
node server.js          # alternativ: npm start
```

Die Startmeldung zeigt die erreichbaren Adressen, z. B.:

```
[Spiele] Geladen: Revierkampf (revierkampf)
[Spiele] Geladen: Eroberungs-Würfel (eroberungs-wuerfel)
[Spiele] Geladen: Schocken (schocken)
AfterWork Arcade v0.5.1 läuft auf Port 3000
  Lokal:    http://localhost:3000
  Netzwerk: http://192.168.1.20:3000
```

Mitspieler im selben Netzwerk öffnen die **Netzwerk-Adresse** im Browser.

**Auf der Synology:** Den Inhalt von `main` (freigegebene Version, siehe Abschnitt 11) z. B. nach `/volume1/apps/afterwork-arcade`
kopieren und dort per SSH `node server.js` ausführen.

| Aktion       | Befehl                                         |
|--------------|------------------------------------------------|
| Beenden      | `Strg+C` im Terminal                           |
| Neustarten   | `Strg+C`, danach erneut `node server.js`       |
| Anderer Port | `PORT=8080 node server.js` (Linux/Synology)    |

> Hinweis: Alle Daten (User, Lobbys, Chats, Spielstände) liegen nur im Arbeitsspeicher.
> Nach einem Neustart des Servers ist alles zurückgesetzt.

---

## 2. Funktionen im Überblick

- **Anmeldung:** Username wählen (2–20 Zeichen, Buchstaben/Ziffern/Leerzeichen/`_ . -`).
  Der Name muss unter den aktuell angemeldeten Usern eindeutig sein.
- **Lobby-Übersicht:** Liste aller offenen Lobbys mit Host, Spieleranzahl und aktivem Spiel.
- **Lobby erstellen:** Name, Sichtbarkeit (offen/privat) und optionales Passwort.
- **Beitreten:** Über die Liste, per Code oder per Einladungslink `http://<server>:3000/?join=CODE`.
- **Lobby-Ansicht:** Mitglieder (👑 = Host), Einladungslink, Lobby-Chat und Spielbereich.
  Wurde die Seite über `localhost` geöffnet, enthält der Einladungslink automatisch die
  LAN-Adresse des Servers, damit andere Geräte ihn öffnen können.
- **Spielsteuerung (nur Host):** „+ Spiel auswählen“ öffnet die **Spielauswahl** (siehe unten).
  „Spiel beenden“ führt alle zurück in die Lobby-Ansicht.
- **Spielauswahl:** Dialog mit einer Kachel pro Spiel (Logik in `public/js/game-picker.js`).
  - Jede Kachel zeigt Vorschaubild, Titel, Spielerzahl und Beschreibung.
  - „Auswählen“ markiert ein Spiel, „Spiel starten“ startet es für alle. Ein Doppelklick auf eine
    Kachel startet direkt; Esc oder „Abbrechen“ schließt den Dialog.
  - Spiele, die nicht zur aktuellen Spielerzahl passen, sind ausgegraut und nennen den Grund.
  - Die Spiele sind alphabetisch sortiert. Ab 7 Spielen erscheint ein Suchfeld (Titel und Beschreibung).
  - Ist das Fenster niedrig, scrollt die Kachelliste; Kopf und Fußzeile bleiben stehen.
    Unter 600 px Breite füllt der Dialog den Bildschirm, und die Kacheln werden kompakt
    (Bild links, Text rechts, Button darunter).
  - Die Auswahl wird intern als geordnete Liste geführt (`maxSelection`, derzeit 1). Das ist die
    Vorbereitung für Spiel-Sessions mit mehreren Spielen, siehe `roadmap.md`.
- **Spielmodus:** Solange ein Spiel läuft, rückt es in den Fokus. Die Lobby-Elemente werden
  kompakt an die Seitenränder angedockt:
  - **links:** Lobby-Kopf (Name, Code, „Lobby verlassen“), Mitglieder und Einladungslink,
  - **Mitte:** das Spiel über die volle Bildschirmhöhe,
  - **rechts:** Lobby-Chat, darunter Online-Liste und globaler Chat (standardmäßig eingeklappt,
    per Klick auf die Überschrift aufklappbar).
  - Beide Leisten lassen sich über die Schalter „« Lobby“ / „Chats »“ auf einen schmalen Streifen
    einklappen. Ein roter Punkt zeigt neue Nachrichten in eingeklappten Bereichen an.
    Der Einklapp-Zustand wird pro Browser gemerkt (`localStorage`, Schlüssel `awa-dock`).
  - Unter 900 px Breite wird nicht angedockt: Das Spiel steht oben, die Lobby-Elemente darunter.
  - Nach „Spiel beenden“ erscheint wieder die gewohnte Lobby-Ansicht.
- **Hell/Dunkel-Design:** Der runde Schalter oben rechts (🌙 / ☀️) wechselt zwischen hellem und
  dunklem Design – auf der ganzen Seite inkl. aller Spiele, sofort und ohne Neuladen. Die Wahl
  wird pro Browser gemerkt (`localStorage`, Schlüssel `awa-theme`); ohne gespeicherte Wahl gilt
  die Systemeinstellung (`prefers-color-scheme`). Ein kleines Script im `<head>` setzt das
  Design schon vor dem Laden des CSS, damit nichts hell aufblitzt.
- **Globaler Chat und Online-Liste:** in der Seitenleiste, für alle angemeldeten User.
- **Wiederverbindung:** Nach einem Reload oder kurzen Verbindungsabbruch (bis 30 s) ist man
  automatisch wieder in seiner Lobby, inklusive Spielstand.

---

## 3. Architektur

```
 Browser                                            Node.js-Server
┌──────────────────────┐   POST /api/...          ┌──────────────────────────┐
│ public/js/main.js    │ ───────────────────────► │ server/api.js            │
│  ├ views/*           │   (Aktionen)             │  ├ users.js              │
│  ├ chat.js           │                          │  ├ lobbies.js            │
│  └ game-loader.js ───┼─► /games/<id>/client.js  │  ├ chat.js               │
│                      │                          │  └ game-registry.js      │
│                      │   GET /events (SSE)      │        └ games/<id>/game.js
│  EventSource      ◄──┼───────────────────────── │ server/sync.js           │
└──────────────────────┘   (Zustands-Updates)     │  └ event-hub.js          │
                                                  └──────────────────────────┘
```

**Prinzip:** Der Server ist die einzige „Quelle der Wahrheit“.

1. Der Browser schickt eine **Aktion** per `POST /api/...` (z. B. „Lobby beitreten“, „würfeln“).
2. Der Server prüft die Aktion und ändert seinen Zustand.
3. Der Server verteilt den neuen Zustand per **Server-Sent Events (SSE)** an alle
   betroffenen Browser. Die HTTP-Antwort auf die Aktion ist nur `{ ok: true }` oder ein Fehler.

**Warum SSE statt WebSockets?** SSE ist in Node.js ohne Zusatzpakete umsetzbar, Browser
verbinden sich automatisch neu, und für den Datenfluss Server → Client reicht es völlig aus.
Aktionen vom Client gehen über normale HTTP-Requests.

**Sitzungen:** Beim Login erhält der Browser ein geheimes **Token**. Es wird im `localStorage`
gespeichert und bei jeder Anfrage im Header `Authorization: Bearer <token>` mitgeschickt
(beim Event-Stream als URL-Parameter, da `EventSource` keine Header unterstützt).

---

## 4. Ordnerstruktur

```
main/  (bzw. dev/ – gleicher Aufbau, siehe Abschnitt 11)
├─ server.js               Einstiegspunkt: HTTP-Server und Routing
├─ package.json            Name, Version, Startskript (keine Abhängigkeiten)
├─ README.md               Kurzvorstellung für GitHub
├─ LICENSE                 MIT-Lizenz
├─ changelog.md            Änderungen je Version
├─ roadmap.md              geplante Funktionen und Ideen für spätere Versionen
├─ dokumentation.md        diese Datei
├─ .gitignore / .gitattributes   ignorierte Dateien (z. B. tests/output), Zeilenenden LF
├─ .githooks/              Git-Hooks: pre-commit, pre-merge-commit (siehe Abschnitt 11)
├─ scripts/
│  ├─ release.mjs          npm run release: dev → main mergen und Versions-Tag setzen
│  └─ git/                 Logik der Hooks, Release-Prüfung (release-check.mjs)
├─ server/
│  ├─ config.js            alle Einstellungen und Grenzwerte
│  ├─ http-utils.js        JSON lesen/senden, Fehlerklasse, statische Dateien
│  ├─ event-hub.js         SSE-Verbindungen, Senden an User/alle, Heartbeat
│  ├─ users.js             Anmeldung, Tokens, automatisches Abmelden
│  ├─ lobbies.js           Lobbys, Mitglieder, Host, Codes, Passwörter
│  ├─ chat.js              globaler und Lobby-Chat inkl. Verlauf
│  ├─ game-registry.js     lädt die Spiele aus games/
│  ├─ game-ticker.js       Spiel-Takt für Echtzeitspiele (ruft tick() auf)
│  ├─ sync.js              welches Event geht an wen
│  ├─ network.js           LAN-Adressen des Servers
│  ├─ bot-names.js         zufällige Bot-Namen (🤖 + deutscher Vorname) für alle Spiele
│  └─ api.js               API-Endpunkte und Ablauflogik
├─ tests/                  automatisierte Tests (siehe Abschnitt 12)
├─ games/
│  ├─ _vorlage/            Kopiervorlage für neue Spiele (wird nicht geladen)
│  ├─ eroberungs-wuerfel/
│  │  ├─ game.js           Server-Teil (Regeln, Zustand)
│  │  └─ public/           Browser-Teil (client.js, style.css, preview.webp)
│  ├─ revierkampf/
│  │  ├─ game.js           Server-Teil (Karte, Truppen, Angriffe, Bots, tick)
│  │  └─ public/           Browser-Teil (Canvas-Darstellung, client.js, style.css)
│  ├─ schocken/
│  │  ├─ game.js           Server-Teil (Würfe, Wertung, Deckel, Bots, tick, viewFor)
│  │  └─ public/           Browser-Teil (CSS-Würfel, client.js, style.css)
│  ├─ maexchen/
│  │  ├─ game.js           Server-Teil (Ansagen, Aufdecken, Leben, Bots, tick, viewFor je Spieler)
│  │  └─ public/           Browser-Teil (Becher, CSS-Würfel, client.js, style.css)
│  ├─ lichtrenner/
│  │  ├─ game.js           Server-Teil (Bewegung pro Tick, Kollisionen, Runden, Bots, viewFor)
│  │  └─ public/           Browser-Teil (Canvas-Arena, client.js, style.css)
│  ├─ bombenlabyrinth/
│  │  ├─ game.js           Server-Teil (Bewegung, Bomben, Explosionen, Power-ups, Schrumpfen, Bots, viewFor)
│  │  └─ public/           Browser-Teil (Canvas-Arena, client.js, style.css)
│  ├─ artillerie/
│  │  ├─ game.js           Server-Teil (Gelände, Flugbahn-Physik, Salven, Waffen, Bots, viewFor)
│  │  └─ public/           Browser-Teil (Canvas, Flug-Animation, Bedienleiste, client.js, style.css)
│  ├─ feierabend-faeuste/
│  │  ├─ game.js           Server-Teil (Phasen, Kamera/Wellen, Steuerung, K.-o., Boss, Wertung, viewFor)
│  │  ├─ level.js          Daten: Figuren, Gegner, Schwierigkeit, Abschnitte und Wellen
│  │  ├─ combat.js         Bewegung, Sprung, Angriffe, Treffer, Rückstoß, Panzerung
│  │  ├─ ai.js             Gegner-KI (Angriffs-Tickets), Boss, Bot-Mitstreiter
│  │  └─ public/           Browser-Teil (client.js, render.js: Kulissen und Figuren, style.css)
│  └─ turmwacht/
│     ├─ game.js           Server-Teil (Phasen, Aktionen, Koop-Wirtschaft, Wertung, viewFor)
│     ├─ map.js            Karten-Generator (Pfad, Deko), Position auf dem Pfad
│     ├─ data.js           Daten: Türme und Stufen, Gegner, Schwierigkeit, Wellen-Formel
│     ├─ sim.js            Gegner-Bewegung, Zielwahl, Schüsse, Panzerung, Effekte
│     └─ public/           Browser-Teil (client.js, render.js: Karte, Türme, Gegner, style.css)
└─ public/                 Browser-Dateien des Lobby-Systems
   ├─ index.html
   ├─ css/style.css
   └─ js/
      ├─ main.js           Start, Sitzung, Ansichtswechsel, Event-Verteilung
      ├─ api.js            fetch-Wrapper, Token, EventSource
      ├─ ui.js             Toasts, Passwort-Dialog, Verbindungsanzeige
      ├─ chat.js           Chat-Komponente (global und Lobby)
      ├─ dock.js           Spielmodus: Andocken/Einklappen der Leisten, Hinweis-Punkte
      ├─ theme.js          Hell/Dunkel-Schalter (data-theme, Event awa-themechange)
      ├─ game-loader.js    lädt/entlädt den Client-Teil eines Spiels
      ├─ game-picker.js    Spielauswahl-Dialog mit Kacheln
      ├─ game-kit/         gemeinsame Bausteine für Spiele: controls.js (Tastatur/Touch-Steuerung)
      └─ views/            login.js, lobby-list.js, lobby-room.js
```

---

## 5. Kommunikation: API und Events

### API-Endpunkte

Alle Antworten sind JSON. Erfolg: `{ "ok": true, ... }`, Fehler:
`{ "ok": false, "error": "Meldung", "code": "OPTIONALER_CODE" }`.

| Methode | Pfad                 | Login | Body                                        | Beschreibung |
|---------|----------------------|:-----:|---------------------------------------------|--------------|
| GET     | `/api/info`          |  –    | –                                           | Version und LAN-Adressen → `{ version, lanUrls }` |
| GET     | `/api/games`         |  –    | –                                           | Spiele, alphabetisch → `{ games: [{ id, name, description, minPlayers, maxPlayers, preview }] }` (`preview`: Bild-URL oder `null`) |
| POST    | `/api/login`         |  –    | `{ name }`                                  | Anmelden → `{ token, user }` |
| GET     | `/api/me`            |  ✔    | –                                           | Prüft die Sitzung → `{ user }` |
| POST    | `/api/logout`        |  ✔    | –                                           | Abmelden |
| POST    | `/api/lobby/create`  |  ✔    | `{ name, visibility, password }`            | Lobby erstellen (`visibility`: `public`/`private`) |
| POST    | `/api/lobby/join`    |  ✔    | `{ lobbyId }` oder `{ code }`, `password?`  | Lobby beitreten |
| POST    | `/api/lobby/leave`   |  ✔    | –                                           | Lobby verlassen |
| POST    | `/api/chat/send`     |  ✔    | `{ scope, text }`                           | Chat-Nachricht (`scope`: `global`/`lobby`) |
| POST    | `/api/game/select`   | Host  | `{ gameId }`                                | Spiel starten |
| POST    | `/api/game/end`      | Host  | –                                           | Spiel beenden |
| POST    | `/api/game/action`   |  ✔    | `{ action }`                                | Spielaktion (Inhalt bestimmt das Spiel) |

Fehlercodes beim Beitreten: `PASSWORD_REQUIRED` (Passwort fehlt), `WRONG_PASSWORD`.
Bei abgelaufener Sitzung: HTTP 401 mit `UNAUTHORIZED`.

### Events (Server → Browser)

Der Event-Stream wird mit `GET /events?token=<token>` geöffnet. Direkt nach dem Verbinden
sendet der Server den kompletten aktuellen Zustand.

| Event          | Daten                                   | Empfänger |
|----------------|-----------------------------------------|-----------|
| `online-users` | `[{ id, name }]`                        | alle |
| `lobbies`      | Liste der offenen Lobbys (Kurzinfo)     | alle |
| `lobby`        | Details der eigenen Lobby oder `null`   | Lobby-Mitglieder |
| `chat`         | eine Nachricht `{ scope, userName, text, system, timestamp, ... }` | alle bzw. Lobby |
| `chat-history` | `{ scope, messages }`                   | einzelner User |
| `game-state`   | `{ gameId, state }` oder `null` – bei Spielen mit `viewFor` je Mitglied gefiltert | Lobby-Mitglieder |

Zusätzlich schickt der Server alle 25 s einen SSE-Kommentar (`: ping`) als Heartbeat.

### Statische Dateien

- `/` und alle sonstigen Pfade → `public/`
- `/games/<id>/<datei>` → `games/<id>/public/<datei>` (der Server-Teil `game.js` ist **nicht** abrufbar)

---

## 6. Lobby-Regeln

- Jeder User ist in **höchstens einer** Lobby. Wer eine neue Lobby erstellt oder einer anderen
  beitritt, verlässt automatisch die bisherige.
- Der Ersteller ist **Host**. Verlässt der Host die Lobby, wird das am längsten anwesende
  Mitglied neuer Host (Systemnachricht im Lobby-Chat).
- Eine **leere** Lobby wird sofort gelöscht, ebenso ihr Chat-Verlauf.
- **Offen:** erscheint in der Übersicht. **Privat:** erscheint nicht und ist nur per Code
  bzw. Einladungslink erreichbar.
- Ein **Passwort** ist für beide Varianten optional und wird beim Beitritt abgefragt.
- Nur der Host darf ein Spiel starten und beenden. Es läuft immer höchstens ein Spiel pro Lobby;
  zum Wechseln muss das laufende Spiel zuerst beendet werden.
- Wer die Verbindung verliert, bleibt **30 Sekunden** angemeldet (Reload, WLAN-Aussetzer).
  Danach wird er automatisch abgemeldet und verlässt seine Lobby.

---

## 7. Neues Spiel hinzufügen

Ein Spiel besteht aus einem Ordner unter `games/`. **Am Lobby-System muss nichts geändert werden.**

### Schritt für Schritt

1. Ordner `games/_vorlage` kopieren und umbenennen, z. B. in `games/quiz`
   (nur Kleinbuchstaben, Ziffern und Bindestriche).
2. In `games/quiz/game.js` `meta.id` auf `"quiz"` setzen (muss dem Ordnernamen entsprechen)
   und `meta.name` anpassen.
3. Spiellogik in `createState()` und `handleAction()` schreiben.
4. Darstellung in `games/quiz/public/client.js` anpassen.
5. `meta.description` mit 1–3 Sätzen für die Kachel in der Spielauswahl füllen und ein
   **Vorschaubild** als `games/quiz/public/preview.webp` ablegen.
   - Ebenfalls möglich sind `.png`, `.jpg` oder `.svg`; gesucht wird in dieser Reihenfolge.
   - Format 16:10, empfohlen 640×400 px. Die Kachel schneidet andere Formate mittig zu.
   - Der Server erkennt das Bild beim Start. Ohne Bild zeigt die Kachel einen 🎲-Platzhalter.
6. Server neu starten. In der Konsole erscheint `[Spiele] Geladen: Quiz (quiz)`, und das Spiel
   ist in jeder Lobby auswählbar.

### Server-Teil: `games/<id>/game.js`

```js
module.exports = {
    meta: {
        id: "quiz",              // Pflicht, = Ordnername
        name: "Quiz",            // Pflicht, Anzeigename
        description: "…",        // optional, 1–3 Sätze für die Spielauswahl
        minPlayers: 2,           // optional (Standard 1)
        maxPlayers: 8,           // optional (Standard unbegrenzt)
        tickMs: 200              // optional, nur mit tick(): Takt in ms (Standard 200, min. 50)
    },

    // Pflicht: Startzustand.
    // context = { players: [{ id, name }], hostId, now }
    createState(context) { return { ... }; },

    // Pflicht: Aktion verarbeiten → neuen Zustand zurückgeben
    // (undefined = nichts geändert, es wird nichts verteilt).
    // Ungültige Aktion → throw new Error("Meldung für den Spieler")
    // context = { hostId, now } – z. B. für Host-Rechte: player.id === context.hostId
    handleAction(state, action, player, context) { return { ...state }; },

    // Optional: Spieler kommt/geht während des Spiels → neuer Zustand oder undefined
    onPlayerJoin(state, player) {},
    onPlayerLeave(state, player) {},

    // Optional für Echtzeitspiele: wird alle meta.tickMs vom Server aufgerufen,
    // solange das Spiel läuft. context = { now, dtMs, hostId }
    // Rückgabe: neuer Zustand (wird an alle verteilt) oder undefined (nichts senden).
    tick(state, context) {},

    // Optional für geheime Informationen: Sicht EINES Mitglieds auf den Zustand.
    // Den Zustand nicht verändern, sondern eine (teilweise) Kopie zurückgeben.
    viewFor(state, userId) { return { ...state, secret: undefined }; }
};
```

**Geheime Informationen (`viewFor`)**: Ohne `viewFor` bekommen alle Lobby-Mitglieder denselben,
vollständigen Zustand. Hat ein Spiel `viewFor`, ruft `server/sync.js` die Funktion für jedes
Mitglied einzeln auf (auch nach Reload/Wiederverbindung) und schickt nur deren Ergebnis.
Geheime Daten (verdeckte Würfel, Handkarten …) verlassen den Server so nie. Wirft `viewFor`
einen Fehler, wird `state: null` gesendet – nie versehentlich der volle Zustand.
Beispiel: `games/schocken/game.js` (Würfel unter dem Becher werden zu `0`).

**Echtzeitspiele (`tick`)**: Der Spiel-Takt (`server/game-ticker.js`) ist ein einziger Timer
für alle Lobbys. Er ruft `tick()` nur für Lobbys auf, in denen ein Spiel mit `tick` läuft; endet
das Spiel oder wird die Lobby gelöscht, hört der Takt automatisch auf. Weil bei jeder Rückgabe
der gesamte Zustand an alle geht, sollte `tick` nur dann einen Zustand liefern, wenn sich wirklich
etwas geändert hat, und der Zustand kompakt bleiben (Revierkampf speichert seine Karte z. B. als
Text mit einem Zeichen pro Feld, ca. 13 KB).

Wichtig:
- Der Zustand muss sich als **JSON** übertragen lassen (keine Funktionen, Maps, Klassen).
- Ohne `viewFor` wird der **gesamte** Zustand an alle Lobby-Mitglieder geschickt. Geheime
  Informationen (z. B. Handkarten) brauchen daher einen `viewFor`-Hook.
- Zufall und Regeln gehören auf den Server, damit niemand schummeln kann.
- `handleAction` sollte den alten Zustand nicht verändern, sondern einen neuen zurückgeben.

### Client-Teil: `games/<id>/public/client.js`

```js
export const stylesheets = ["style.css"];   // optional, relativ zu public/

export function mount(container, ctx) {
    // ctx.me          → { id, name } des eigenen Users
    // ctx.sendAction  → (action) => Promise<boolean>, Fehler werden automatisch angezeigt
    // ctx.getLobby()  → aktuelle Lobby-Details
    return {
        update(state) { /* neuen Zustand darstellen */ },
        destroy()     { /* aufräumen */ }
    };
}
```

Wichtig:
- Texte von Spielern immer per `textContent` einfügen, nie per `innerHTML`.
- CSS-Klassen mit einem Präfix versehen (z. B. `quiz-…`), damit sie nicht mit anderen kollidieren.
- Die CSS-Variablen des Lobby-Systems (z. B. `var(--color-muted)`) und die Button-Styles
  stehen auch im Spiel zur Verfügung.
- **Dunkles Design:** Das Design steht im Attribut `data-theme` (`"light"`/`"dark"`) am
  `<html>`-Element. Spiele verwenden für Flächen und Texte möglichst die Variablen des
  Lobby-Systems (`--color-surface`, `--color-text`, `--color-muted`, `--color-border`,
  `--color-input-bg` …) – diese werden im Dark-Mode automatisch umgestellt. Eigene feste Farben
  als spielbezogene Variablen anlegen und überschreiben, z. B.
  `:root[data-theme="dark"] .quiz { --quiz-accent: #64b5f6; }`.
  Wer per Canvas zeichnet, liest Farben per `getComputedStyle` und hört auf das Event
  `awa-themechange` am `document` (Beispiel: Revierkampf).
- **Steuerung für Echtzeitspiele:** `public/js/game-kit/controls.js` stellt Pfeiltasten/WASD,
  ein Touch-Steuerkreuz und Wischgesten bereit (Beispiel: Lichtrenner):
  ```js
  import { createDirectionalControls } from "/js/game-kit/controls.js";
  const controls = createDirectionalControls({
      onDirection: dir => ctx.sendAction({ type: "turn", dir }),   // "up" | "down" | "left" | "right"
      isActive: () => state?.phase === "running",
      swipeTarget: canvas                                          // optional
  });
  container.append(controls.element);   // Steuerkreuz, nur auf Touch-Geräten sichtbar
  // in destroy(): controls.destroy();
  ```
  Tasten werden ignoriert, solange ein Eingabefeld (z. B. der Chat) oder ein Dialog den Fokus hat.
  Behandelte Tasten scrollen die Seite nicht.

  Für Spiele mit „Taste halten“ gibt es zwei weitere Optionen (Beispiel: Bomben-Labyrinth):
  ```js
  onRelease: dir => …,                  // Taste/Knopf losgelassen, auch bei Fokusverlust des Fensters
  actionButton: {                       // Aktionstaste und runder Touch-Knopf neben dem Steuerkreuz
      label: "💣", ariaLabel: "Bombe legen",
      keys: [" ", "Enter"],             // Standard: Leertaste
      onPress: () => ctx.sendAction({ type: "bomb" })
  }
  ```

  Mehrere Aktionen (Beispiel: Feierabend-Fäuste) gehen mit `actionButtons` statt `actionButton`:
  ```js
  actionButtons: [
      { id: "attack", label: "👊", ariaLabel: "Schlag", keys: [" ", "j"], onPress: …, onRelease: … },
      { id: "jump", label: "⤴", ariaLabel: "Sprung", keys: ["k", "Shift"], onPress: … }
  ]
  ```
  Aktionstasten haben Vorrang vor WASD; Buchstaben gelten unabhängig von Groß-/Kleinschreibung.

---

## 8. Spiele: Eroberungs-Würfel, Revierkampf, Schocken, Mäxchen, Lichtrenner, Bomben-Labyrinth, Artillerie-Duell, Feierabend-Fäuste, Turmwacht

### 8.1 Eroberungs-Würfel

Ablauf einer Runde:

1. **Angreifer** wählt 1–3 Würfel, **Verteidiger** 1–2 Würfel (Reihenfolge egal).
   Jede Seite darf pro Runde einmal würfeln. Jedes Lobby-Mitglied darf für jede Seite würfeln.
2. Sobald beide gewürfelt haben, wird automatisch ausgewertet:
   - Würfel werden absteigend sortiert und paarweise verglichen (höchster gegen höchsten …).
   - Es werden so viele Paare verglichen, wie die Seite mit weniger Würfeln hat.
   - Höhere Augenzahl gewinnt, **bei Gleichstand gewinnt der Verteidiger**.
   - Angezeigt wird, wie viele Armeen jede Seite verliert.
3. Der nächste Wurf oder der Button „Neue Runde“ startet die nächste Runde.

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel |
|--------|----------|
| Würfeln | `{ "type": "roll", "side": "attacker", "count": 3 }` |
| Neue Runde | `{ "type": "new-round" }` |

### 8.2 Revierkampf

Echtzeit-Gebietseroberung auf einer zufälligen Karte (144 × 90 Felder) mit Seen.
Für 1–8 Spieler plus 0–8 Bots (höchstens 16 Teilnehmer).

**Ablauf**

1. **Vorbereitung:** Der Host wählt die Anzahl der Bots und klickt „Runde starten“.
   Es braucht mindestens 2 Teilnehmer (z. B. 1 Spieler + 1 Bot).
2. **Startphase (10 s):** Jeder klickt auf die Karte, um seinen Startpunkt zu setzen (er lässt sich
   bis zum Ende der Startphase versetzen). Startpunkte müssen an Land liegen und mindestens
   10 Felder voneinander entfernt sein. Wer nicht klickt, bekommt einen zufälligen Platz.
   Jeder startet mit einem kleinen runden Revier und 150 Truppen.
3. **Runde:**
   - Truppen wachsen ständig: `1 + Felder × 0,03 + Truppen × 0,4 %` pro Takt (200 ms),
     höchstens bis `100 + Felder × 12`. Größere Reviere wachsen also schneller und können mehr Truppen halten.
   - **Angreifen:** Den Regler „Angriffsstärke“ (10–100 %) einstellen und auf ein **benachbartes**
     Gebiet klicken (neutrales Land oder einen Gegner). Der Anteil der Truppen wird losgeschickt und
     erobert Feld für Feld, bis er aufgebraucht ist. Ein erneuter Klick auf dasselbe Ziel verstärkt
     den laufenden Angriff.
   - Ein neutrales Feld kostet 2 Truppen. Ein gegnerisches kostet `2 + Dichte × 1,2`
     (Dichte = Truppen ÷ Felder des Gegners); der Gegner verliert dabei pro Feld seine Dichte an Truppen.
     Gut gefüllte Reviere sind also teuer zu erobern.
   - Greifen sich zwei Spieler gleichzeitig gegenseitig an, heben sich die Angriffe zuerst auf.
   - Klicks auf Wasser oder das eigene Gebiet werden ignoriert.
4. **Ende:** Wer **70 % des Landes** besitzt oder als **Letzter** übrig bleibt, gewinnt.
   Die Runde endet auch, wenn kein menschlicher Spieler mehr übrig ist. Danach kann der Host
   eine neue Runde starten (neue Karte).

**Bots** prüfen etwa jede Sekunde ihre Lage: Sobald sie mindestens 35 % ihres Truppen-Maximums
haben, schicken sie 30–60 % ihrer Truppen los – bevorzugt ins neutrale Land, sonst gegen den
Nachbarn mit der geringsten Dichte.

**Später dazukommen / gehen:** Wer während der Startphase der Lobby beitritt, spielt noch mit;
später Hinzugekommene schauen zu und sind in der nächsten Runde dabei. Wer die Lobby verlässt,
scheidet aus, sein Gebiet wird neutral.

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel | Wer / wann |
|--------|----------|------------|
| Bots einstellen | `{ "type": "settings", "bots": 3 }` | Host, Vorbereitung |
| Runde starten | `{ "type": "start" }` | Host, Vorbereitung |
| Startpunkt | `{ "type": "spawn", "x": 40, "y": 25 }` | Teilnehmer, Startphase |
| Angriff | `{ "type": "attack", "x": 41, "y": 25, "percent": 50 }` | Teilnehmer, Runde |
| Neue Runde | `{ "type": "new-round" }` | Host, nach Rundenende |

Zustand (Auszug): `phase` (`setup`/`spawn`/`running`/`finished`), `grid` (Text, ein Zeichen pro
Feld: `~` Wasser, `.` neutral, `A`–`P` Teilnehmer 1–16), `players` (Name, Farbe, Truppen, Felder,
Bot ja/nein), `attacks`, `log` (letzte Ereignisse).
Die Balance-Werte stehen als Konstanten oben in `games/revierkampf/game.js`.

### 8.3 Schocken

Würfelspiel mit 3 Würfeln pro Spieler und 13 Deckeln (Strafpunkten), nach den Regeln von
schockfreunde.de. Der Wurf „Jennie“ heißt hier **General**. Für 1–8 Spieler plus 0–5 Bots
(höchstens 8 Teilnehmer, mindestens 2). Eine Kurzfassung der Regeln steht im Spiel unter dem
Spielfeld.

**Rangfolge (klassisch) und Deckel**

| Rang | Wurf | Beispiel | Deckel |
|------|------|----------|--------|
| 1 | Schock Aus | 1-1-1 | alle (Hälfte endet) |
| 2 | Schock 6 … Schock 2 | 1-1-6 … 1-1-2 | 6 … 2 |
| 3 | General | 6-6-6 … 2-2-2 | 3 |
| 4 | Straße | 4-5-6 … 1-2-3 | 2 |
| 5 | Zahlen (absteigend gelesen) | 6-6-5 … 3-2-1 | 1 |

General und Straße zählen nur „aus der Hand“, also wenn alle 3 Würfel in einem Wurf fallen;
sonst zählen sie als Zahlen. Ein Schock darf über mehrere Würfe gebaut werden.
Gleichstand: weniger Würfe gewinnt, danach wer früher an der Reihe war.

**Ablauf eines Zugs** (reihum, max. 3 Würfe; beim Laden genau 1)

1. **Würfeln.** Der Becher bleibt zu – auch der Werfer kennt seine Würfel nicht.
2. **Aufdecken ja/nein.** Wer aufdeckt, zeigt die Würfel **allen**. Blind weiterwürfeln oder
   verdeckt beenden ist erlaubt.
3. Aufgedeckt dürfen **nur Einsen** herausgelegt werden (offen, nicht mehr würfelbar).
   Zwei aufgedeckte Sechsen dürfen zu einer Eins gedreht werden (drei Sechsen → zwei Einsen),
   nicht im letzten erlaubten Wurf; die übrige Sechs muss dann neu geworfen werden.
4. Neu würfeln oder Zug beenden.

**Vorgabe des Ersten:** Seine Wurfzahl ist die Obergrenze für alle anderen. Beendet er
**aufgedeckt**, decken alle Nachfolgenden beim Beenden ihres Zugs automatisch auf; beendet er
verdeckt, entscheidet jeder selbst. Die Vorgabe steht in der Kopfzeile („Vorgabe: 2 Würfe · verdeckt“).

**Deckel und Partie**
- Der beste Wurf bestimmt die Deckelzahl, der schlechteste bekommt sie: erst aus dem Topf (13),
  ist der Topf leer, gibt der Spieler mit dem besten Wurf seine Deckel ab. Ab leerem Topf
  spielen nur noch Spieler mit Deckeln. Schock Aus: Der Verlierer bekommt sofort alle Deckel.
- Wer alle 13 Deckel hat, verliert die Hälfte. Der Rundenverlierer beginnt die nächste Runde.
- Die erste Runde einer Partie ist das **Laden** (Regel von schockfreunde.de): Jeder würfelt genau
  einmal, der Startspieler ist zufällig. Das Laden zählt bereits – der tiefste Wurf bekommt Deckel
  aus dem Topf (nach dem besten Wurf) und beginnt die erste reguläre Runde mit bis zu 3 Würfen.
  Statuszeile, Zughinweis, Auswertung und Regel-Kurzfassung weisen darauf hin.
- Umfang (Host): **Eine Hälfte** oder **Komplett** – zwei Hälften; verliert derselbe Spieler
  beide, ist die Partie vorbei, sonst folgt ein **Finale** zwischen den beiden Hälften-Verlierern
  (der Verlierer der 1. Hälfte trägt den Markierungsdeckel „M“ und beginnt das Finale).

**Zeiten**
- Zugtimer 30 s: Danach wird ggf. automatisch gewürfelt und der Zug im aktuellen Zustand beendet.
- Auswertung: bleibt bis zu 30 s stehen. Mit „Weiter“ geht es sofort weiter, sobald mindestens
  75 % der (menschlichen) Spieler geklickt haben (2 Spieler → beide, 4 Spieler → drei).

**Bots** würfeln mit etwa 0,9 s Pause pro Schritt, decken auf, legen Einsen heraus, drehen
Sechsen und hören bei einem Schock, General oder einer Straße auf. Als Erster spielen sie mit
ca. 5 % Wahrscheinlichkeit blind (1 Wurf, Becher zu). Bots nutzen nur sichtbare Informationen.

**Sichtbarkeit (`viewFor`):** Würfel unter einem geschlossenen Becher werden an **niemanden**
übertragen (Wert `0`), auch nicht an den Werfer. Herausgelegte Einsen, aufgedeckte Würfe und
die Auswertung sind für alle sichtbar. Gewürfelt wird mit `crypto.randomInt` auf dem Server.

**Später dazukommen / gehen:** Neue Lobby-Mitglieder schauen bis zur nächsten Partie zu.
Wer geht, legt seine Deckel in den Topf zurück; ist er am Zug, geht es mit dem Nächsten weiter.
Bleiben weniger als 2 Teilnehmer oder kein Mensch übrig, endet die Partie.

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel | Wer / wann |
|--------|----------|------------|
| Einstellungen | `{ "type": "settings", "bots": 2, "mode": "full" }` (`mode`: `full`/`half`) | Host, vor der Partie |
| Partie starten | `{ "type": "start" }` | Host, vor der Partie |
| Würfeln | `{ "type": "roll", "aside": [0] }` (`aside` = Einsen, die vorher herausgelegt werden) | am Zug |
| Aufdecken | `{ "type": "look" }` | am Zug |
| Sechsen drehen | `{ "type": "turn-sixes" }` | am Zug, aufgedeckt |
| Zug beenden | `{ "type": "finish" }` | am Zug |
| Weiter | `{ "type": "continue" }` | Spieler, während der Auswertung |
| Neue Partie | `{ "type": "new-match" }` | Host, nach Partieende |

Die Zeiten und Grenzwerte stehen als Konstanten oben in `games/schocken/game.js`.

### 8.4 Mäxchen

Bluff-Würfelspiel (auch „Meiern“) für 1–10 Spieler plus 0–5 Bots (höchstens 10 Teilnehmer).

**Wert eines Wurfs:** Gewürfelt wird mit 2 Würfeln. Die höhere Augenzahl ist die Zehnerstelle, aus 3 und 5 wird also 53.
Rangfolge, aufsteigend:
- 31 < 32 < 41 < 42 < 43 < 51 < … < 65
- < 1er-Pasch < … < 6er-Pasch
- < **Mäxchen (2 + 1)** als höchster Wurf.

**Ablauf:**
1. **Vorbereitung:** Der Host stellt Bots (0–5) und Leben (1–5, Standard 3) ein und startet die Partie.
   Es braucht mindestens 2 Teilnehmer. Wer beginnt, wird ausgelost.
2. **Würfeln:** Wer am Zug ist, würfelt verdeckt. Nur er selbst sieht seinen Wurf.
3. **Ansagen:** Er sagt einen Wert an, der **höher** sein muss als die vorige Ansage. Lügen ist erlaubt.
   Die Oberfläche bietet alle erlaubten Werte an und markiert den echten Wert.
4. **Der Nächste entscheidet:**
   - **Glauben:** Er übernimmt den Becher, würfelt selbst (ohne den alten Wurf zu sehen) und muss die Ansage überbieten.
   - **Anzweifeln:** Der Becher wird für alle aufgedeckt. Ist der echte Wurf **mindestens so hoch** wie die Ansage,
     verliert der Zweifler ein Leben, sonst der Ansager.
   - **Bei der Ansage Mäxchen** gibt es nur zwei Möglichkeiten:
     - Aufdecken: Ist das Mäxchen echt, verliert der Zweifler **2 Leben**; ist es gelogen, verliert der Ansager 1 Leben.
     - Hinnehmen: Er verliert 1 Leben, ohne aufzudecken.
5. **Nach dem Aufdecken:** Das Ergebnis bleibt 6 s stehen. Dann beginnt eine neue Runde ohne Ansage, und zwar
   beim Verlierer. Ist er ausgeschieden, beginnt der Nächste.
6. **Ende:** Mit 0 Leben scheidet man aus. Wer zuletzt übrig ist, gewinnt. Die Platzierungen stehen in
   `state.result.placements`, als Vorbereitung für Spiel-Sessions (siehe `roadmap.md`).

**Zeitlimit:** 30 s pro Schritt. Danach wird automatisch gehandelt:
- würfeln,
- die Wahrheit ansagen bzw. den kleinsten erlaubten Wert,
- glauben, bei Mäxchen hinnehmen.

**Bots:**
- Sie sagen meist die Wahrheit. Ist ihr Wurf zu niedrig, bluffen sie knapp darüber.
- Sie zweifeln umso eher, je unwahrscheinlicher eine Ansage ist. Ein angesagtes Mäxchen decken sie meist auf.

**Sichtbarkeit (`viewFor`):** Den Wurf unter dem Becher (`round.dice`) bekommt **nur der Werfer** (`round.holderId`).
Alle anderen erhalten `null`. Aufgedeckte Würfe stehen öffentlich in `state.reveal`.

**Später dazukommen / gehen:** Neue Lobby-Mitglieder schauen bis zur nächsten Partie zu.
Wer geht, scheidet aus, und die laufende Runde beginnt ohne Lebensverlust neu.
Bleibt nur ein Teilnehmer oder kein Mensch übrig, endet die Partie.

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel | Wer / wann |
|--------|----------|------------|
| Einstellungen | `{ "type": "settings", "bots": 2, "lives": 3 }` | Host, vor der Partie |
| Partie starten | `{ "type": "start" }` | Host, vor der Partie |
| Würfeln | `{ "type": "roll" }` | am Zug |
| Ansagen | `{ "type": "announce", "value": 53 }` (`21` = Mäxchen, `11`…`66` = Pasch) | am Zug, nach dem Würfeln |
| Glauben | `{ "type": "believe" }` | am Zug, nach einer Ansage (nicht bei Mäxchen) |
| Anzweifeln / Aufdecken | `{ "type": "doubt" }` | am Zug, nach einer Ansage |
| Hinnehmen | `{ "type": "accept" }` | am Zug, nur bei angesagtem Mäxchen |
| Neue Partie | `{ "type": "new-match" }` | Host, nach Partieende |

Die Zeiten und Grenzwerte stehen als Konstanten oben in `games/maexchen/game.js`.

### 8.5 Lichtrenner

Echtzeitspiel im Lichtspur-Genre für 1–8 Spieler plus 0–7 Bots (höchstens 8 Teilnehmer).

**Ablauf:**
1. **Vorbereitung:** Der Host stellt Bots (0–7, Standard 3) und die Zahl der Siege zum Gewinnen
   (1–5, Standard 3) ein und startet. Es braucht mindestens 2 Teilnehmer.
2. **Countdown (3 s):** Die Startpunkte liegen gleichmäßig auf einer Ellipse, jeweils mit Blick
   zur Mitte. Pfeile zeigen die Richtung, und am eigenen Startpunkt steht „Du“.
   Die Startrichtung lässt sich noch ändern, aber nicht umkehren.
3. **Runde:** Die Arena ist 64 × 40 Felder groß. Alle 100 ms (Tick) fährt jeder 1 Feld weiter und hinterlässt eine Spur,
   die bis zum Rundenende liegen bleibt.
   - Lenken mit Pfeiltasten oder WASD, auf dem Handy mit Steuerkreuz oder Wischen.
   - Eine Umkehr in die eigene Spur wird ignoriert.
   - Der Server merkt sich bis zu 2 Eingaben und übernimmt eine pro Tick. Schnelle Doppelkurven gehen also nicht verloren.
4. **Crash:** Wer gegen die Wand oder eine Spur (auch die eigene) fährt, scheidet für die Runde aus.
   Fahren zwei gleichzeitig ins selbe Feld, scheiden beide aus. Die Absturzstelle zeigt ein ✖.
5. **Rundenende:** Fährt höchstens noch einer, endet die Runde. Der Überlebende bekommt 1 Sieg;
   crashen alle gleichzeitig, ist es ein Unentschieden.
   - Nach 120 s endet eine Runde als Unentschieden.
   - Danach 3 s Pause, dann der nächste Countdown.
6. **Ende:** Wer zuerst die eingestellte Zahl Siege hat, gewinnt.
   - Die Platzierungen (nach Siegen, bei Gleichstand nach Überlebenszeit) stehen in `state.result.placements`.

**Bots** prüfen bei jedem Tick geradeaus, links und rechts:
- Sie messen per Breitensuche (bis 300 Felder), wie viel freie Fläche dahinter erreichbar ist.
- Felder direkt neben fremden Köpfen meiden sie.
- Ein wenig Zufall macht sie weniger vorhersehbar.

**Übertragung:**
- Die Arena ist ein Text mit einem Zeichen pro Feld (`.` frei, `A`–`H` Spur von Spieler 0–7, ca. 2,5 KB).
  Er geht bei jedem Tick mit.
- `viewFor` ersetzt absolute Zeitpunkte durch Restzeiten (`countdownMs`, `roundOverMs`) und lässt die
  Eingabe-Warteschlange weg.

**Später dazukommen / gehen:** Neue Lobby-Mitglieder schauen bis zur nächsten Partie zu.
Wer geht, crasht sofort. Bleibt nur ein Teilnehmer oder kein Mensch übrig, endet die Partie.

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel | Wer / wann |
|--------|----------|------------|
| Einstellungen | `{ "type": "settings", "bots": 3, "wins": 3 }` | Host, vor der Partie |
| Partie starten | `{ "type": "start" }` | Host, vor der Partie |
| Lenken | `{ "type": "turn", "dir": "up" }` (`up`/`down`/`left`/`right`) | eigene Figur, im Countdown oder in der Runde |
| Neue Partie | `{ "type": "new-match" }` | Host, nach Partieende |

Die Zeiten und Grenzwerte stehen als Konstanten oben in `games/lichtrenner/game.js`.

### 8.6 Bomben-Labyrinth

Echtzeitspiel im Bomberman-Genre (eigene Regeln und Grafik) für 1–8 Spieler plus 0–7 Bots
(höchstens 8 Teilnehmer).

**Ablauf:**
1. **Vorbereitung:** Der Host stellt Bots (0–7, Standard 3) und die Zahl der Siege zum Gewinnen
   (1–5, Standard 3) ein und startet. Es braucht mindestens 2 Teilnehmer.
2. **Arena:** 15 × 13 Felder mit festen Wänden (Rand und jedes zweite Feld als Säule) und
   zufällig verteilten Kisten (ca. 70 % der freien Felder). Startplätze sind zuerst die vier Ecken,
   dann die Randmitten; um jeden Startplatz bleibt ein Bereich von 2 Feldern frei.
3. **Countdown (3 s):** Namen über den Figuren, „Du“ über der eigenen. Eine schon gedrückte
   Richtung wird gemerkt.
4. **Runde:** Tick alle 50 ms.
   - **Laufen:** Solange eine Richtung gehalten wird, läuft die Figur Feld für Feld: der erste
     Schritt sofort, danach alle 4/3/2 Ticks (200/150/100 ms) je nach Tempo-Stufe.
     Wände, Kisten und Bomben blockieren; die eigene, gerade gelegte Bombe darf man verlassen.
   - **Bomben:** Leertaste legt eine Bombe aufs eigene Feld (Start: 1 gleichzeitig, Reichweite 2).
     Nach 2,5 s explodiert sie in alle vier Richtungen. Wände stoppen die Flamme, eine Kiste wird
     gesprengt und stoppt sie ebenfalls, ein liegendes Power-up verbrennt. Getroffene Bomben
     explodieren sofort mit (Kettenreaktion). Die Flammen brennen 0,5 s.
   - **Power-ups:** Unter ca. 30 % der Kisten liegt eines: 🔥 Reichweite (max. 6),
     💣 eine Bombe mehr (max. 5), 👟 Tempo (3 Stufen). Einsammeln durch Darüberlaufen.
   - **Ausscheiden:** Wer auf einem brennenden Feld steht oder hineinläuft, ist für die Runde raus (✖).
   - **Schrumpfen:** Nach 90 s wird alle 0,4 s ein Feld von außen nach innen (spiralförmig) zur Wand;
     wer dort steht, scheidet aus. 15 s vorher erscheint ein Hinweis.
5. **Rundenende:** Steht höchstens noch einer, endet die Runde; der Überlebende bekommt 1 Sieg.
   Scheiden alle gleichzeitig aus, ist es ein Unentschieden, ebenso nach 150 s.
   Danach 3 s Pause, dann der nächste Countdown. Power-ups gelten nur für eine Runde.
6. **Ende:** Wer zuerst die eingestellte Zahl Siege hat, gewinnt.
   - Die Platzierungen (nach Siegen, bei Gleichstand nach Überlebenszeit) stehen in `state.result.placements`.

**Bots** haben eine beim Partiestart ausgewürfelte Persönlichkeit (`traits`: Angriffslust, Gier
nach Power-ups, Zufälligkeit, Neigung zum Bombenlegen, Reaktionszeit). Vor jedem Schritt:
1. **Gefahr:** Aus allen Bomben (inkl. Kettenreaktionen) und Flammen wird berechnet, wo und wann
   es brennt. Steht der Bot in Gefahr, flieht er per Breitensuche zu einem zufälligen der
   nächstgelegenen sicheren Felder, bevorzugt ohne andere Spieler darauf.
   Fremde Bomben bemerkt er erst nach seiner Reaktionszeit (0,15–0,9 s), so macht er gelegentlich Fehler.
2. **Bombe legen**, wenn sie Kisten oder Gegner trifft und danach ein Fluchtweg existiert.
   Säße ein Gegner danach in einer Sackgasse fest, legt der Bot sie immer.
3. **Ziel** (Power-up, lohnende Sprengstelle, im Endspiel die Nähe eines Gegners) wählen und
   1–3 s beibehalten; Ziele anderer Bots werden gemieden. Ab und zu zögert ein Bot kurz.

**Darstellung:** Canvas mit eigenen Farben (in beiden Designs gleich). Die Figuren gleiten
zwischen den Feldern. Stehen mehrere Figuren auf demselben Feld, erscheinen sie als ein Kreis
mit gleich großen Stücken in ihren Farben.

**Übertragung:**
- Die Arena ist ein Text mit einem Zeichen pro Feld (`#` Wand, `x` Kiste, `.` frei,
  `r`/`b`/`s` Power-up). Er geht bei jedem Tick mit, dazu Bomben und Flammen.
- Versteckte Power-ups liegen in `state.hidden` und werden von `viewFor` nicht verschickt.
- `viewFor` ersetzt absolute Zeitpunkte durch Restzeiten (`countdownMs`, `roundOverMs`,
  `suddenDeathInMs`), ergänzt die Schrittdauer `stepMs` je Spieler und lässt Bot-Interna weg.

**Später dazukommen / gehen:** Neue Lobby-Mitglieder schauen bis zur nächsten Partie zu.
Wer geht, scheidet sofort aus. Bleibt nur ein Teilnehmer oder kein Mensch übrig, endet die Partie.

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel | Wer / wann |
|--------|----------|------------|
| Einstellungen | `{ "type": "settings", "bots": 3, "wins": 3 }` | Host, vor der Partie |
| Partie starten | `{ "type": "start" }` | Host, vor der Partie |
| Laufen / stehen bleiben | `{ "type": "move", "dir": "left" }` bzw. `{ "type": "move", "dir": null }` | eigene Figur, im Countdown oder in der Runde |
| Bombe legen | `{ "type": "bomb" }` | eigene Figur, in der Runde |
| Neue Partie | `{ "type": "new-match" }` | Host, nach Partieende |

Die Zeiten und Grenzwerte stehen als Konstanten oben in `games/bombenlabyrinth/game.js`.

### 8.7 Artillerie-Duell

Rundenbasiertes Geschützduell (Genre Worms/Scorched Earth, eigene Regeln und Grafik) für
1–6 Spieler plus 0–5 Bots (höchstens 6 Teilnehmer).

**Ablauf:**
1. **Vorbereitung:** Der Host stellt Bots (0–5, Standard 2), die **Bot-Stärke** (leicht/mittel/schwer,
   Standard mittel) und die Zahl der Siege zum Gewinnen (1–5, Standard 3) ein und startet.
2. **Runde:** Neues hügeliges Gelände (800 × 400 Einheiten, Höhenprofil mit 400 Spalten);
   die Panzer stehen gleichmäßig verteilt auf eingeebneten Plätzen. Jeder hat 100 Trefferpunkte,
   2 Splitter und 2 Bohrer. Eine Runde hat höchstens 12 Salven.
3. **Zielphase (20 s, alle gleichzeitig):**
   - Winkel (0–180°, 90 = senkrecht) und Kraft (10–100) per Regler oder Tastatur, dazu die Waffe.
   - Fahren: 10 Schritte Treibstoff pro Salve; zu steile Hänge blockieren.
   - „Feuer frei“ meldet bereit (nochmal klicken nimmt es zurück). Die Salve startet, sobald alle
     bereit sind oder die Zeit abläuft – dann mit den zuletzt eingestellten Werten.
   - Der **Wind** wird je Salve neu ausgewürfelt und oben angezeigt.
   - Was die anderen einstellen, ist bis zum Abschuss verborgen (`viewFor`).
4. **Salve:** Der Server simuliert alle Geschosse gleichzeitig (Schwerkraft, Wind, 20-ms-Schritte).
   - Einschläge sprengen sofort Krater; spätere Geschosse derselben Salve sehen das neue Gelände.
   - Schaden nimmt zum Rand der Explosion linear ab und wird am Ende der Salve abgezogen –
     wer sich gegenseitig trifft, scheidet gemeinsam aus.
   - Danach setzen sich die Panzer auf das Gelände; wer tiefer als 20 Einheiten fällt, bekommt Fallschaden.
   - Der Browser spielt die Salve als Animation ab (Schweif, Explosion, Krater, Schadenszahlen, Sturz).
5. **Rundenende:** Steht höchstens noch ein Panzer, endet die Runde. Nach der 12. Salve gewinnt, wer die
   meisten Trefferpunkte hat; bei Gleichstand oder wenn alle zerstört sind, ist es ein Unentschieden.
6. **Ende:** Wer zuerst die eingestellte Zahl Siege hat, gewinnt. Platzierung nach Siegen, dann nach
   ausgeteiltem Schaden (`state.result.placements`).

**Waffen:**

| Waffe | Wirkung | Munition |
|---|---|---|
| 💣 Granate | Krater Radius 30, bis 45 Schaden | unbegrenzt |
| ✴️ Splitter | kleiner Einschlag (Radius 18, 20 Schaden), dann 5 Splitter im Fächer (je Radius 14, 15 Schaden) | 2 pro Runde |
| 🔩 Bohrer | durchschlägt bis zu 70 Einheiten Gelände (gräbt einen Kanal), dann Explosion Radius 22, 35 Schaden | 2 pro Runde |

**Bots:**
- Wählen ein Ziel (bevorzugt angeschlagene und nahe Gegner) und suchen den Schuss per Simulation
  über Winkel und Kraft unter dem aktuellen Wind. Steht Gelände im Weg, nehmen sie den Bohrer;
  stehen Gegner dicht beieinander, den Splitter.
- **Streuung** = Bot-Stärke × Persönlichkeit (±20 %) × Einschießen (erster Schuss auf ein Ziel ×1,4,
  danach je ×0,8 bis ×0,6; nach Zielwechsel oder Fahren von vorn). Gemessene Trefferquote
  (Schüsse mit Schaden): leicht ≈ 23 %, mittel ≈ 43 %, schwer ≈ 57 %.
- Sie fahren gelegentlich, planen einer pro Tick (der Server blockiert nie lange) und melden sich nach
  1–4 s bereit.

**Physik als wiederverwendbare Funktionen** (für ein späteres Burgen-Duell): `generateTerrain`,
`restY`, `carve`, `launch`, `stepProjectile`, `simulateShot`, `resolveVolley`, `settleTanks`.

**Übertragung:**
- Das Höhenprofil (`heights`, 400 Zahlen) geht mit jedem Update mit.
- In der Flugphase enthält `state.flight` das Gelände vorher, alle Pfade (alle 40 ms ein Punkt),
  Krater, Explosionen, Treffer und Stürze (insgesamt ca. 10–20 KB, einmal pro Salve).
- `viewFor` verbirgt fremde Zielwerte in der Zielphase, ersetzt Zeitpunkte durch Restzeiten
  (`aimingMs`, `flightMs`, `roundOverMs`) und lässt Bot-Interna weg.

**Später dazukommen / gehen:** Neue Lobby-Mitglieder schauen bis zur nächsten Partie zu.
Wer geht, scheidet sofort aus. Bleibt nur ein Teilnehmer oder kein Mensch übrig, endet die Partie.

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel | Wer / wann |
|--------|----------|------------|
| Einstellungen | `{ "type": "settings", "bots": 2, "botLevel": "mittel", "wins": 3 }` | Host, vor der Partie |
| Partie starten | `{ "type": "start" }` | Host, vor der Partie |
| Zielen | `{ "type": "aim", "angle": 50, "power": 70, "weapon": "granate" }` | eigener Panzer, Zielphase, nicht bereit |
| Fahren | `{ "type": "move", "dir": -1 }` (`-1` links, `1` rechts) | eigener Panzer, Zielphase, nicht bereit |
| Feuer frei | `{ "type": "ready", "angle": 50, "power": 70, "weapon": "splitter" }` (`"ready": false` nimmt zurück) | eigener Panzer, Zielphase |
| Neue Partie | `{ "type": "new-match" }` | Host, nach Partieende |

Die Zeiten und Grenzwerte stehen als Konstanten oben in `games/artillerie/game.js`.

### 8.8 Feierabend-Fäuste

Koop-Prügelspiel im Seitenscroller (Beat-'em-up-Genre, eigene Figuren, Welt und Grafik) für
1–4 Spieler. Freie Plätze lassen sich mit 0–3 Bot-Kollegen auffüllen (höchstens 4 Teilnehmer).

**Vorbereitung:** Jeder wählt eine Figur, jede gibt es nur einmal pro Gruppe. Wer nichts wählt
(auch Bots), bekommt eine freie. Der Host stellt Bot-Kollegen, Gegner-Schwierigkeit und Bot-Stärke
ein und startet.

| Figur | Spielweise | LP | Reichweite | Kombo-Schaden |
|---|---|---|---|---|
| Kurierin | Flitzer: schnell, flinke Schläge | 90 | 34 | 6 / 6 / 11 |
| Lagerist | Allrounder | 110 | 38 | 8 / 8 / 14 |
| Hausmeister | Brecher: langsam, zäh, starker Rückstoß | 140 | 40 | 11 / 11 / 20 |
| Monteurin | Hebel: Rohrzange mit großer Reichweite | 100 | 58 | 8 / 8 / 13 |

**Ablauf:** Hinterhof → Lagerhalle → Dach (je 2–3 Gegnerwellen) → Chefetage mit dem Boss.
- Die Kamera folgt dem vordersten Spieler; Nachzügler werden am linken Bildrand mitgeschoben.
- Kommt eine Welle, bleibt die Kamera stehen, bis alle Gegner besiegt sind; dann erscheint „Weiter →“.
- Am Ende eines Abschnitts wird zum nächsten übergeblendet.
- Zerschlagbare Kisten (2 Treffer) enthalten teils Essen, das 30 Lebenspunkte heilt.

**Kampf** (Tick 50 ms):
- **Laufen** in 8 Richtungen; die Tiefe (z) geht etwas langsamer als seitwärts.
- **Schlag:** bis zu 3 Schläge hintereinander (Kombo); der dritte wirft um. Ein gedrückter Schlag
  wird 0,3 s gemerkt, die Kombo geht dann ohne Pause weiter.
- **Sprung** mit **Sprungtritt** (wirft um). Springen weicht Flaschen und dem Bodenstampfer aus.
- **Spezial:** Rundumschlag, kostet 10 % der eigenen Lebenspunkte, kurz unverwundbar, wirft alle ringsum um.
- Treffer zählen nur bei passender Tiefe (±14). Jeder Angriff trifft jedes Ziel nur einmal.
  Mitspieler kann man nicht treffen.
- Nach 4 Treffern in Folge geht ein Gegner zu Boden (kein Dauer-Festhalten) und steht kurz unverwundbar auf.

**Gegner:**

| Gegner | Verhalten |
|---|---|
| Schläger | kommt heran und schlägt zu |
| Werfer | hält Abstand (immer im Bild) und wirft Flaschen auf der Bodenebene |
| Brocken | gepanzert: einfache Schläge unterbrechen ihn nicht, nur Kombo-Ende, Sprungtritt und Spezial |
| Schichtleiter (Boss) | gepanzert, 3 Phasen nach Lebenspunkten: Ansturm quer über die Bühne (roter Streifen als Warnung), ab Phase 2 Bodenstampfer (roter Kreis), ab Phase 3 schneller und ruft Verstärkung |

- Gegner holen sichtbar aus („!“). Nur wer ein **Angriffs-Ticket** hat, greift an; die anderen kreisen.
- **Schwierigkeit** (leicht / mittel / schwer): Faktoren auf Lebenspunkte, Schaden, Tempo und
  Angriffspausen der Gegner, Zahl der gleichzeitigen Angreifer, Wellengröße und die Chance, dass
  ein Gegner beim Ausholen nicht zu unterbrechen ist.
- **Gruppengröße:** Wellen, Boss-Lebenspunkte und -Schaden, gleichzeitige Angreifer und Boss-Verstärkung
  wachsen gestaffelt mit (Tabelle `GROUP_SCALE` in `game.js`, per Simulation abgestimmt).

**Am Boden (K.-o.):** Ein Mitspieler, der 1,5 s daneben steht, hilft auf (40 % LP); sonst steht man
nach 10 s selbst auf (50 % LP). Liegen **alle** gleichzeitig am Boden, ist die Schicht verloren.

**Bot-Kollegen** setzen nur ihre Eingaben wie ein Mensch: Sie gehen auf den nächsten Gegner,
schlagen in Kombos zu, nutzen bei Gedränge den Spezialangriff, weichen Boss-Angriffen und Flaschen
aus, helfen Liegenden auf, holen bei wenig Lebenspunkten Essen und laufen mit der Kamera mit.
Die Bot-Stärke (leicht / mittel / schwer) bestimmt Reaktion, Genauigkeit und Ausweichen.

**Wertung:** Je Spieler werden Schaden, Treffer, besiegte Gegner, Schaden am Boss und eigene K.-o.s
gezählt. `result.placements` ist nach Schaden sortiert; der Erste ist „Mitarbeiter des Abends“
(`result.winnerId`) – bei Sieg **und** Niederlage. `result.outcome` ist `victory`, `defeat` oder
`aborted` (kein Mensch mehr im Spiel).

**Darstellung:** Alles wird aus Formen auf das Canvas gezeichnet (`public/render.js`): Kulissen je
Abschnitt mit Parallaxe, Figuren mit Posen (laufen, Schläge, Sprung, getroffen, am Boden …), HUD mit
Lebenspunkten und Schaden aller Spieler, Boss-Lebensbalken, Schadenszahlen. Figuren und Kamera werden
zwischen den Server-Ständen geglättet.

**Übertragung:** Voller Zustand alle 50 ms (ca. 3–9 KB). `viewFor` lässt Zufallszustand, Eingaben und
Gegner-KI weg.

**Später dazukommen / gehen:** Neue Lobby-Mitglieder schauen bis zur nächsten Schicht zu. Wer geht,
verschwindet aus dem Spiel; ist kein Mensch mehr dabei, endet es.

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel | Wer / wann |
|--------|----------|------------|
| Einstellungen | `{ "type": "settings", "allies": 1, "difficulty": "mittel", "allyLevel": "mittel" }` | Host, vor dem Start |
| Figur wählen | `{ "type": "pick", "figure": "monteurin" }` | jeder, vor dem Start |
| Start | `{ "type": "start" }` | Host, vor dem Start |
| Laufen | `{ "type": "move", "dx": 1, "dz": -1 }` (je `-1`/`0`/`1`; `0, 0` = stehen) | eigene Figur, im Spiel |
| Schlag / Sprung / Spezial | `{ "type": "attack" }`, `{ "type": "jump" }`, `{ "type": "special" }` | eigene Figur, im Spiel |
| Neue Schicht | `{ "type": "new-match" }` | Host, nach Spielende |

Werte (Figuren, Gegner, Schwierigkeit, Level) stehen in `games/feierabend-faeuste/level.js`,
Zeiten und die Gruppen-Skalierung oben in `game.js`.

### 8.9 Turmwacht

Koop-Tower-Defense (eigene Türme, Gegner und Grafik) für 1–4 Spieler, ohne Bots. Weitere
Lobby-Mitglieder schauen zu.

**Vorbereitung:** Der Host würfelt mit „🎲 Neue Karte“ eine Karte aus (Vorschau für alle sofort
sichtbar), wählt die Schwierigkeit (leicht / mittel / schwer) und die Länge (10 / 20 / 30 Wellen
oder Endlos) und startet.

**Karte** (`map.js`): Raster 16 × 10. Der Pfad läuft vom linken zum rechten Rand, nur nach rechts,
oben oder unten, mit 3–8 Kurven und mindestens 28 Feldern. Pfadfelder berühren sich nur, wenn sie
direkt aufeinander folgen; waagerechte Stücke sind mindestens 2 Felder lang, damit zwischen den
Kehren Platz für Türme bleibt. Dazu 6–10 Felsen und Bäume, die nicht bebaubar sind. Gleicher Seed
ergibt die gleiche Karte. Gegner haben eine Distanz `d` entlang des Pfads; ihre Position wird aus den
Wegpunkten berechnet.

**Ablauf:** Bauphase (vor der ersten Welle 30 s, danach 25 s) → Welle → Bauphase …
- Die Bauphase endet früher, wenn alle „Bereit“ drücken oder der Host „Welle rufen“ wählt. Die
  Gruppe bekommt dann 2 Gold je übriger Sekunde.
- **Bauen, Upgraden und Verkaufen geht jederzeit**, auch während einer Welle.
- Der Host kann auf **Tempo ×2** schalten.
- Jeder Gegner am Tor kostet gemeinsame Leben (Start: 20, Koloss: 5).
- Sieg, wenn die letzte Welle abgewehrt ist; Niederlage bei 0 Leben. Im Endlos-Modus zählt die
  erreichte Welle.

**Türme** (je 4 Stufen; ein Upgrade kostet 60 / 90 / 130 % des Grundpreises):

| Turm | Preis | Wirkung | Stufe 1 → 4 |
|---|---|---|---|
| Pfeilturm | 50 | schnell, ein Ziel | Schaden 9 → 36, Stufe 4 schießt zwei Pfeile |
| Kanone | 90 | Flächenschaden rund um das Ziel | Schaden 16 → 66, Radius 0,9 → 1,35 |
| Frostturm | 70 | Kältewelle trifft alle in Reichweite, bremst 2 s | bremst 30 → 55 % |
| Blitzturm | 120 | Kettenblitz, ignoriert Panzerung, −15 % je Sprung | 3 → 6 Ziele, Schaden 16 → 52 |
| Fernrohr | 140 | riesige Reichweite, hoher Einzelschaden | Schaden 60 → 250, Reichweite 4,5 → 6,5 |

Alle Türme zielen auf den vordersten Gegner in Reichweite. Schüsse treffen sofort; die Anzeige
(Pfeil, Explosion, Kältering, Blitz) kommt als kurze Effekte (`fx`).

**Gegner** (Lebenspunkte als Faktor auf den Grundwert der Welle):

| Gegner | LP | Tempo (Felder/s) | Besonderheit |
|---|---|---|---|
| Läufer | 1× | 1,15 | Standard |
| Flitzer | 0,5× | 2,0 | schnell |
| Panzer | 2,6× | 0,7 | Panzerung 3, alle 5 Wellen +2 |
| Schwarm | 0,3× | 1,35 | in großen Gruppen |
| Koloss (Boss) | 11× | 0,55 | jede 10. Welle; Panzerung 4, alle 10 Wellen +2; Frost wirkt nur halb; kostet 5 Leben |

Panzerung zieht festen Schaden je Treffer ab; mindestens 25 % kommen immer durch.

**Wellen** (`data.js`, feste Formel, auch endlos):
- Grund-Lebenspunkte: 30 × 1,16^(Welle − 1), ab Welle 30 zusätzlich × 1,06 je Welle.
- 8 Gegner, alle 2 Wellen einer mehr (höchstens 24).
- Wellen 1–3 bestehen nur aus Läufern, danach wechseln sich Schwarm-, Panzer-, Flitzer- und
  gemischte Wellen ab.

Die Schwierigkeit wirkt auf:

| | leicht | mittel | schwer |
|---|---|---|---|
| Lebenspunkte | 0,75 | 1 | 1,4 |
| Tempo | 0,92 | 1 | 1,08 |
| alles Gold | 1,15 | 1 | 0,85 |

Die Werte sind per Simulation mit einem gierigen Test-Bauer abgestimmt.

**Wirtschaft (Koop):**
- Startgold (250), Kopfgeld und Wellenbonus (25 + 4 × Welle) werden **gleichmäßig auf alle aktiven
  Spieler verteilt**. Bruchteile sammelt jeder intern, es geht nichts verloren. Das Einkommen der
  Gruppe hängt also nicht von der Spielerzahl ab.
- Jeder zahlt aus seiner **eigenen Kasse**. Türme gehören dem Erbauer (Rand in seiner Farbe).
- **Upgraden darf jeder**; was jemand in einen Turm steckt, wird je Turm mitgezählt.
- **Verkaufen darf nur der Erbauer** (herrenlose Türme jeder). Jeder Geldgeber bekommt seinen Anteil
  zurück: 70 %; was in derselben Bauphase investiert wurde, zu 100 %.
- **Schenken:** 🎁 25 oder 🎁 ½ (die Hälfte der eigenen Kasse) an einen Mitspieler; steht im Log.
- **Verlassen:** Das Gold geht an die übrigen Spieler, die Türme werden herrenlos und bleiben stehen.
  Ist niemand mehr da, endet das Spiel (`aborted`).

**Wertung:**
- Der Schaden eines Turms wird anteilig nach Investition gutgeschrieben, ein Abschuss dem Erbauer.
- Je Spieler zählen Schaden, Abschüsse, gebaute Türme, investiertes und verschenktes Gold.
- `result.placements` ist nach Schaden sortiert; der Erste ist „🏆 Turmmeister“ (`result.winnerId`).
- `result.outcome` ist `victory`, `defeat`, `endless` (Endlos-Modus) oder `aborted`; dazu kommt
  `result.wave`.

**Bedienung:**
- Feld antippen → Bau-Menü mit Preisen und Reichweiten-Vorschau.
- Turm antippen → Infos mit Upgrade und Verkaufen.
- Tastatur: 1–5 baut auf dem gewählten Feld, U = Upgrade, Esc hebt die Auswahl auf.
- Die Leiste zeigt Leben, Welle, Countdown, die nächste Welle und die Kasse aller Spieler.

**Übertragung:** Tick 100 ms; der volle Zustand geht bei jedem Tick raus (ca. 5–15 KB). `viewFor`
lässt Zufall, Bruchteile und Investitions-Details weg und ergänzt die Erstattung je Turm und die
Vorschau der nächsten Welle (`upcoming`).

Aktionen (`POST /api/game/action`):

| Aktion | Beispiel | Wer / wann |
|--------|----------|------------|
| Einstellungen | `{ "type": "settings", "difficulty": "mittel", "waves": 20 }` (`0` = endlos) | Host, vor dem Start |
| Neue Karte | `{ "type": "new-map" }` | Host, vor dem Start |
| Start | `{ "type": "start" }` | Host, vor dem Start |
| Bauen | `{ "type": "build", "x": 4, "y": 2, "tower": "kanone" }` | Spieler, im Spiel |
| Upgrade / Verkaufen | `{ "type": "upgrade", "towerId": "t7" }`, `{ "type": "sell", "towerId": "t7" }` | Spieler (Verkaufen: Erbauer), im Spiel |
| Schenken | `{ "type": "gift", "to": "<userId>", "amount": 25 }` | Spieler, im Spiel |
| Bereit | `{ "type": "ready" }` (umschalten) | Spieler, Bauphase |
| Welle rufen | `{ "type": "call-wave" }` | Host, Bauphase |
| Tempo | `{ "type": "speed" }` (×1 ↔ ×2) | Host, im Spiel |
| Neue Partie | `{ "type": "new-match" }` | Host, nach Spielende |

Die Werte stehen in `games/turmwacht/data.js`, die Zeiten oben in `game.js`.

### Bot-Namen (alle Spiele)

Bots heißen nach zufälligen deutschen Vornamen, mit vorangestelltem 🤖, z. B. „🤖 Lena“.
- Vergeben werden die Namen über `pickBotNames(anzahl, namenDerMenschen)` aus `server/bot-names.js`.
- In einer Partie ist jeder Name eindeutig, und Vornamen echter Mitspieler werden ausgelassen.
- Das 🤖 ist Teil des Namens. Es erscheint deshalb überall: auf den Spielerplätzen, im Protokoll, in Ranglisten und auf der Revierkampf-Karte.
- Neue Spiele mit Bots sollten die Namen ebenfalls darüber vergeben.

---

## 9. Konfiguration

Alle Einstellungen stehen in `server/config.js`:

| Einstellung               | Standard | Bedeutung |
|---------------------------|----------|-----------|
| `PORT`                    | 3000     | Port (auch per Umgebungsvariable `PORT`) |
| `HOST`                    | 0.0.0.0  | Netzwerkschnittstelle (0.0.0.0 = alle) |
| `MAX_BODY_BYTES`          | 16 KB    | maximale Größe einer Anfrage |
| `USERNAME_MIN/MAX_LENGTH` | 2 / 20   | Länge des Usernamens |
| `LOBBY_NAME_MAX_LENGTH`   | 30       | Länge des Lobby-Namens |
| `LOBBY_PASSWORD_MAX_LENGTH` | 50     | Länge des Lobby-Passworts |
| `LOBBY_MAX_MEMBERS`       | 8        | Mitglieder pro Lobby |
| `LOBBY_CODE_LENGTH`       | 6        | Länge des Lobby-Codes |
| `CHAT_MESSAGE_MAX_LENGTH` | 300      | Länge einer Chat-Nachricht |
| `CHAT_HISTORY_SIZE`       | 50       | gespeicherte Nachrichten pro Chat |
| `HEARTBEAT_INTERVAL_MS`   | 25 000   | Abstand der SSE-Pings |
| `RECONNECT_GRACE_MS`      | 30 000   | Wartezeit bis zum automatischen Abmelden (auch per Umgebungsvariable) |

---

## 10. Grenzen und Sicherheit

- **Nur für das lokale Netzwerk gedacht.** Es gibt kein HTTPS; der Server sollte nicht ins
  Internet freigegeben werden.
- **Keine Accounts:** Usernamen sind nur während der Sitzung reserviert.
- **Keine Persistenz:** Ein Neustart löscht alle Lobbys, Chats und Spielstände.
- Lobby-Passwörter werden nur als scrypt-Hash gespeichert.
- Lobby-Passwörter sind nur für eine temporäre Lobby gedacht – der Browser soll sie nicht speichern.
  Die Eingabefelder sind deshalb bewusst **kein** `type="password"`, sondern Textfelder mit
  CSS-Verdeckung (Klasse `masked-input`, `-webkit-text-security: disc`). So erscheint kein
  „Passwort speichern?“-Dialog. Browser ohne diese CSS-Eigenschaft bekommen automatisch ein
  echtes Passwortfeld (`ensureMaskedInputs()` in `public/js/main.js`).
- Chat-Texte und Namen werden im Browser nur als Text eingefügt (Schutz vor XSS).
- Statische Dateien werden nur aus `public/` bzw. `games/<id>/public/` ausgeliefert.
- Die Zwischenablage-Funktion („Kopieren“) braucht im Browser eigentlich HTTPS; über `http://`
  im LAN wird ein Fallback verwendet, notfalls den Link manuell kopieren.

---

## 11. Versionierung mit Git

Seit Version 0.5.2 wird mit **Git** versioniert. Bis 0.5.1 gab es dafür Versionsordner.
Diese Ordner wurden als Historie mit Tags `v0.0.1` … `v0.5.1` übernommen.
Seit 0.11.0 ist das Repository **öffentlich auf GitHub**:
<https://github.com/VanillaThunda/AfterWorkArcade> (MIT-Lizenz, siehe `LICENSE`).

**Aufbau:** ein Repository mit zwei Arbeitsordnern (*Git-Worktrees*), benannt wie die Branches:

```
C:\CodingProjekte\AfterWorkArcade\
├─ main\   Branch main – freigegebene Produktivversion (enthält das Repository .git)
└─ dev\    Branch dev  – Entwicklung und Tests (Worktree desselben Repositorys)
```

- `main\` zeigt **immer** die Produktivversion. Syncthing überträgt den Ordner auf die Synology,
  dort läuft der Server. In `main\` wird nie direkt gearbeitet.
- In `dev\` wird entwickelt und getestet.
- Jede Version ist ein **Annotated Tag** `vX.Y.Z` auf `main`. Die Tag-Beschreibung ist der
  Changelog-Abschnitt der Version (`git tag -n` oder `git show v0.5.2`).

**Ablauf für eine neue Version** (Major, Minor oder Patch):

1. In `dev\` entwickeln und auf Branch `dev` committen. `version` in `package.json` erhöhen
   (Semantic Versioning: **MINOR** für neue Funktionen, **PATCH** für Fehlerbehebungen).
2. `npm run test:all` ausführen und die Version testen lassen.
3. Nach der Freigabe:
   - `changelog.md` oben um `## [x.y.z] – JJJJ-MM-TT` ergänzen.
   - `dokumentation.md` aktualisieren, inklusive der Kopfzeile `**Version:** x.y.z`.
   - Beides auf `dev` committen.
4. `npm run release` im Ordner `dev\` ausführen (`scripts/release.mjs`):
   - Prüft, ob `dev\` und `main\` sauber sind.
   - Führt die Release-Prüfung aus (siehe unten) und alle Tests.
   - Führt in `main\` `git merge --no-ff dev` aus.
   - Setzt den Annotated Tag.
   - Holt `dev` per Fast-Forward auf den Stand von `main`.
   - Lädt `main`, `dev` und die Tags nach GitHub hoch (`git push origin main dev --follow-tags`),
     sofern das Remote `origin` eingerichtet ist. Scheitert das (offline, nicht angemeldet), ist das
     Release trotzdem fertig; das Skript nennt den Befehl zum Nachholen.
5. Den Server auf der Synology neu starten.

**Git-Hooks** (versioniert in `.githooks/`, aktiviert per `git config core.hooksPath .githooks`,
Logik in `scripts/git/`; bewusst ohne Husky, da das Projekt keine npm-Pakete nutzt):

| Hook | Wirkung |
|---|---|
| `pre-commit` | Verbietet direkte Commits auf `main` (außer beim Abschluss eines Merges). Prüft die Syntax gestagter `.js`/`.mjs`-Dateien (`node --check`). |
| `pre-merge-commit` | Nur auf `main`. Führt die Release-Prüfung und die schnellen Tests aus (API und die Logik-Tests aller Spiele). |

**Release-Prüfung** (`node scripts/git/release-check.mjs`):
- Die Version in `package.json` ist größer als der letzte Tag.
- `changelog.md` hat oben einen Eintrag mit Datum für diese Version.
- `dokumentation.md` nennt diese Version.

**Ältere Version verwenden:**
- **Ansehen bzw. kurz zurückwechseln:** `git -C main switch --detach v0.5.1`.
  Zurück zur aktuellen Version mit `git -C main switch main`.
- **Dauerhaft zurücknehmen:** auf `dev` per `git revert <commit>`, danach ein normales Patch-Release.
- **Unterschiede ansehen:** `git diff v0.5.1 v0.5.2 --stat`.

**Hinweise:**
- Der Ordner `.git` wird per Syncthing mitsynchronisiert und dient so als Backup.
- Auf der Synology keine Git-Befehle ausführen, weil die Worktree-Verweise Windows-Pfade enthalten.
- **GitHub:** Remote `origin` ist eingerichtet. Die Anmeldung übernimmt der Git Credential Manager
  (Teil von Git für Windows) beim ersten Push im Browser.
- Commits laufen unter der im Repository hinterlegten Identität (GitHub-Name und die anonyme
  noreply-Adresse von GitHub), damit keine private E-Mail-Adresse öffentlich wird.
- Das Repository ist öffentlich: keine Passwörter, Zugangsschlüssel oder persönlichen Daten committen.
  Spiele bekommen eigene Namen, Figuren und Grafiken (deshalb heißt der frühere „Risiko-Würfel“ seit
  0.11.0 „Eroberungs-Würfel“).

---

## 12. Tests

Die Tests liegen unter `tests/` und benötigen nur Node.js – keine npm-Pakete. Jeder Test
startet einen **eigenen Server** auf einem separaten Port (3456–3459); ein bereits laufender
Server auf Port 3000 stört also nicht.

| Befehl                   | Datei                      | Dauer  | Prüft |
|--------------------------|----------------------------|--------|-------|
| `npm test`               | `tests/api.test.mjs`       | ~4 s   | API und Echtzeit-Events: Spieleliste (Sortierung, Vorschaubilder), Login, Chats, Lobbys, Passwörter, Host-Rechte, Eroberungsregeln, Revierkampf inkl. Spiel-Takt (Ticks ohne Aktion, Stopp bei Spielende), Schocken mit gefilterter Sicht (`viewFor`), Sicherheit der Dateiauslieferung |
| `npm run test:revierkampf` | `tests/revierkampf.test.mjs` | ~2 s | Revierkampf-Logik direkt (ohne Server): Karte, Startphase, Wachstum, Angriffe, Bots, Sieg, Verlassen |
| `npm run test:schocken`  | `tests/schocken.test.mjs`  | ~1 s   | Schocken-Logik direkt: Wertung/Rangfolge, Becher & Aufdecken, nur Einsen herauslegen, Sechsen drehen, Vorgabe, Deckel, Hälften/Finale, viewFor, Timer, „Weiter“, Bots |
| `npm run test:maexchen`  | `tests/maexchen.test.mjs`  | < 1 s  | Mäxchen-Logik direkt: Werte/Rangfolge, Ansagen, Glauben/Anzweifeln, Mäxchen-Regeln, Leben/Ausscheiden, viewFor, Timer, Bots, Verlassen; Bot-Namen (`server/bot-names.js`) |
| `npm run test:lichtrenner` | `tests/lichtrenner.test.mjs` | ~1 s | Lichtrenner-Logik direkt: Startpunkte, Bewegung, Crash (Wand, Spuren, gleiches Feld), Umkehr, Doppelkurve, Runden/Siege, Zeitgrenze, Bots, Verlassen, viewFor |
| `npm run test:bombenlabyrinth` | `tests/bombenlabyrinth.test.mjs` | ~3 s | Bomben-Labyrinth-Logik direkt: Arena, Taste halten/Tempo, Blockaden, Bomben-Limit, Explosion/Reichweite/Kisten, Kettenreaktion, Ausscheiden, Power-ups, Schrumpfen, Zeitgrenze, Runden/Partie, Bots (Persönlichkeit, Flucht, Sackgasse, Duelle), Verlassen, viewFor |
| `npm run test:artillerie` | `tests/artillerie.test.mjs` | ~3 s | Artillerie-Logik direkt: Gelände, Krater, Flugbahn (Wind, Kraft, Weltrand), Rumpftreffer, Schaden und Fallschaden, Splitter, Bohrer, Munition, Fahren, Zielphase (bereit/Zeitablauf), gleichzeitige Salve, Runden/Partie, Bots (Bedenkzeit, Treffer, Bohrer, Stärke, Einschießen), Verlassen, viewFor |
| `npm run test:feierabend-faeuste` | `tests/feierabend-faeuste.test.mjs` | ~5 s | Feierabend-Fäuste-Logik direkt: Figurenwahl, Laufen und Kamera, Wellen, Treffer (Reichweite, Tiefe, einmal je Angriff), Kombo, Sprung, Spezial, kein Friendly Fire, Panzerung, Dauer-Festhalten, Angriffs-Tickets, Werfer, Schwierigkeit, Kisten/Essen, K.-o./Aufhelfen/Niederlage, Abschnittswechsel, Boss-Phasen, Wertung, Bot-Mitstreiter (Level auf „leicht“), Verlassen, viewFor |
| `npm run test:turmwacht` | `tests/turmwacht.test.mjs` | ~2 s | Turmwacht-Logik direkt: Karten-Generator (200 Seeds), neue Karte, Einstellungen, Start/Startgold, Zuschauer ab Spieler 5, Bauen/Upgraden/Verkaufen mit Erstattung, gleich verteiltes Einkommen ohne Rundungsverlust, Schenken, Verlassen, Zielwahl, Kanone/Frost/Blitz/Panzerung, Schaden nach Investition, Bereit/Welle rufen, Leben/Niederlage/Sieg/Endlos, Tempo ×2, Wellen-Formel, Wertung, viewFor, Test-Bauer (leicht/10 Sieg, erster Koloss auf mittel besiegt, Rechenzeit) |
| `npm run test:reconnect` | `tests/reconnect.test.mjs` | ~8 s   | Grace-Period: Reload behält die Sitzung, langer Abbruch meldet ab |
| `npm run test:ui`        | `tests/ui.test.mjs`        | ~60 s  | Echte Oberfläche mit zwei Spielern im Browser, inkl. Spielauswahl-Dialog (Kacheln, Vorschaubilder, Auswahl, hell/dunkel), Spielmodus (Andocken/Einklappen), Eroberungs-Würfel, eine Revierkampf-Runde mit Bots, Schocken (Setup-Dialog ohne Scrollen, verdeckte Würfel, Würfelanimation, Aufdecken, „Weiter“), Mäxchen (Wurf nur beim Werfer, Ansage, Anzweifeln), Lichtrenner (Countdown, echte Tastendrücke per CDP, kein Lenken aus dem Chatfeld, kein Scrollen), Bomben-Labyrinth (Taste halten/loslassen, Bombe per Leertaste), Artillerie-Duell (Bot-Stärke, Zielen per Taste, Kraft, Waffe, Feuer frei, Salve, Regler ohne Innenabstand), Feierabend-Fäuste (Figurenwahl, Laufen schräg per Taste halten, Schlag/Sprung/Spezial), Turmwacht (neue Karte, Bauen, Upgraden, Schenken, Bereit), Spielauswahl bei kleinem Fenster und in Handygröße, Dark-Mode (Schalter, gemerkt nach Reload, Revierkampf/Schocken dunkel), Mobilansicht und Konsolenfehlern |
| `npm run test:git`       | `tests/git.test.mjs`       | < 1 s  | Release-Prüfung: Versionsvergleich, fehlender Changelog-Eintrag, falsche Doku-Version, Changelog-Abschnitt für den Tag |
| `npm run test:all`       | `tests/run-all.mjs`        | ~150 s | alle zwölf nacheinander |

Ausgabe: je Testfall `ok` oder `FAIL` mit Grund, am Ende eine Zusammenfassung.
Der Exit-Code ist `0`, wenn alles bestanden ist.

**UI-Test:**
- Benötigt Microsoft Edge, Google Chrome oder Chromium. Der Browser wird automatisch gesucht
  und unsichtbar (headless) gestartet; ein eigener Pfad lässt sich per `BROWSER_PATH` setzen.
- Gesteuert wird er über das Chrome DevTools Protocol.
- Screenshots landen in `tests/output/` (kann jederzeit gelöscht werden).

**Hilfsfunktionen** (`tests/helpers.mjs`): `startServer`, `createTestRunner`, `apiCall`,
`openEventStream`. Für ein neues Spiel kann ein eigener Test nach dem Muster von
`api.test.mjs` angelegt werden – Spiellogik lässt sich auch direkt testen, indem man
`games/<id>/game.js` per `require` lädt und `handleAction` bzw. `tick` aufruft
(Beispiel: `tests/revierkampf.test.mjs`).

> Für den Betrieb (z. B. auf der Synology) wird der Ordner `tests/` nicht benötigt.
