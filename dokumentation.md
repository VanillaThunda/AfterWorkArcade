# AfterWork Arcade – Dokumentation

**Version:** 0.5.0 (siehe `package.json` und `changelog.md`)

AfterWork Arcade ist ein Web-basiertes Lobby-System für das lokale Netzwerk. Mitspieler rufen
eine Adresse im Browser auf, wählen einen Usernamen, erstellen oder betreten Lobbys, chatten
und spielen gemeinsam Spiele bzw. nutzen Tools – aktuell den **Risiko-Würfel**, das
Echtzeit-Strategiespiel **Revierkampf** und das Kneipen-Würfelspiel **Schocken**.

---

## Inhalt

1. [Start und Betrieb](#1-start-und-betrieb)
2. [Funktionen im Überblick](#2-funktionen-im-überblick)
3. [Architektur](#3-architektur)
4. [Ordnerstruktur](#4-ordnerstruktur)
5. [Kommunikation: API und Events](#5-kommunikation-api-und-events)
6. [Lobby-Regeln](#6-lobby-regeln)
7. [Neues Spiel hinzufügen](#7-neues-spiel-hinzufügen)
8. [Spiele: Risiko-Würfel, Revierkampf, Schocken](#8-spiele-risiko-würfel-revierkampf-schocken)
9. [Konfiguration](#9-konfiguration)
10. [Grenzen und Sicherheit](#10-grenzen-und-sicherheit)
11. [Versionierung (Ordner-basiert)](#11-versionierung-ordner-basiert)
12. [Tests](#12-tests)

---

## 1. Start und Betrieb

**Voraussetzung:** Node.js ab Version 18. Es werden **keine** npm-Pakete benötigt –
ein `npm install` ist nicht nötig.

```bash
cd AfterWorkArcade/_stable
node server.js          # alternativ: npm start
```

Die Startmeldung zeigt die erreichbaren Adressen, z. B.:

```
[Spiele] Geladen: Revierkampf (revierkampf)
[Spiele] Geladen: Risiko-Würfel (risiko-wuerfel)
[Spiele] Geladen: Schocken (schocken)
AfterWork Arcade v0.5.0 läuft auf Port 3000
  Lokal:    http://localhost:3000
  Netzwerk: http://192.168.1.20:3000
```

Mitspieler im selben Netzwerk öffnen die **Netzwerk-Adresse** im Browser.

**Auf der Synology:** Den Inhalt von `_stable` z. B. nach `/volume1/apps/afterwork-arcade`
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
- **Spielsteuerung (nur Host):** Spiel auswählen → „Spiel starten“; „Spiel beenden“ führt
  alle zurück in die Lobby-Ansicht.
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
_stable/
├─ server.js               Einstiegspunkt: HTTP-Server und Routing
├─ package.json            Name, Version, Startskript (keine Abhängigkeiten)
├─ changelog.md            Änderungen je Version
├─ dokumentation.md        diese Datei
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
│  └─ api.js               API-Endpunkte und Ablauflogik
├─ tests/                  automatisierte Tests (siehe Abschnitt 12)
├─ games/
│  ├─ _vorlage/            Kopiervorlage für neue Spiele (wird nicht geladen)
│  ├─ risiko-wuerfel/
│  │  ├─ game.js           Server-Teil (Regeln, Zustand)
│  │  └─ public/           Browser-Teil (client.js, style.css)
│  ├─ revierkampf/
│  │  ├─ game.js           Server-Teil (Karte, Truppen, Angriffe, Bots, tick)
│  │  └─ public/           Browser-Teil (Canvas-Darstellung, client.js, style.css)
│  └─ schocken/
│     ├─ game.js           Server-Teil (Würfe, Wertung, Deckel, Bots, tick, viewFor)
│     └─ public/           Browser-Teil (CSS-Würfel, client.js, style.css)
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
| GET     | `/api/games`         |  –    | –                                           | Liste der verfügbaren Spiele |
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
5. Server neu starten. In der Konsole erscheint `[Spiele] Geladen: Quiz (quiz)`, und das Spiel
   ist in jeder Lobby auswählbar.

### Server-Teil: `games/<id>/game.js`

```js
module.exports = {
    meta: {
        id: "quiz",              // Pflicht, = Ordnername
        name: "Quiz",            // Pflicht, Anzeigename
        description: "…",        // optional
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

---

## 8. Spiele: Risiko-Würfel, Revierkampf, Schocken

### 8.1 Risiko-Würfel

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
- Die erste Runde einer Partie ist das **Laden** (jeder würfelt einmal, Startspieler zufällig).
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

## 11. Versionierung (Ordner-basiert)

Es gibt (noch) keine Git-Versionierung. Stattdessen (verbindlich, siehe auch
`AfterWorkArcade/README_claude-code.txt`):

- `AfterWorkArcade/_stable/` enthält **immer die aktuelle, freigegebene Version**.
- `AfterWorkArcade/_dev/` ist die Arbeitskopie für die nächste Version (nur während der Entwicklung).
- Ältere Versionen liegen in Ordnern mit ihrer Versionsnummer, z. B. `AfterWorkArcade/v0.1.0/`.

So kann jederzeit einfach auf eine ältere Version zurückgewechselt werden.

**Ablauf für eine neue Version** – gilt für Major, Minor und Bugfix (Beispiel: von 0.1.0 auf 0.2.0):

1. Den kompletten Ordner `_stable` kopieren und die Kopie `_dev` nennen.
2. Alle Änderungen ausschließlich in `_dev` vornehmen und dort testen (`npm run test:all`).
3. In `_dev/package.json` die `version` erhöhen.
4. Ist alles in Ordnung und die Version für die Produktion freigegeben:
   - `_dev/changelog.md` um einen Abschnitt `## [0.2.0] – JJJJ-MM-TT` (oben) ergänzen,
   - `_dev/dokumentation.md` aktualisieren, falls sich Funktionsweise oder Schnittstellen geändert haben.
5. Ordner `_stable` in die bisherige Versionsnummer umbenennen, z. B. `v0.1.0`
   (steht in dessen `package.json`).
6. Ordner `_dev` in `_stable` umbenennen.

Versionsnummern nach Semantic Versioning: **MINOR** erhöhen für neue Funktionen (0.1.0 → 0.2.0),
**PATCH** für reine Fehlerbehebungen (0.1.0 → 0.1.1).

Empfehlung: Vor dem Abschluss einer Version `npm run test:all` ausführen (siehe Abschnitt 12).

---

## 12. Tests

Die Tests liegen unter `tests/` und benötigen nur Node.js – keine npm-Pakete. Jeder Test
startet einen **eigenen Server** auf einem separaten Port (3456–3459); ein bereits laufender
Server auf Port 3000 stört also nicht.

| Befehl                   | Datei                      | Dauer  | Prüft |
|--------------------------|----------------------------|--------|-------|
| `npm test`               | `tests/api.test.mjs`       | ~4 s   | API und Echtzeit-Events: Login, Chats, Lobbys, Passwörter, Host-Rechte, Risiko-Regeln, Revierkampf inkl. Spiel-Takt (Ticks ohne Aktion, Stopp bei Spielende), Schocken mit gefilterter Sicht (`viewFor`), Sicherheit der Dateiauslieferung |
| `npm run test:revierkampf` | `tests/revierkampf.test.mjs` | ~2 s | Revierkampf-Logik direkt (ohne Server): Karte, Startphase, Wachstum, Angriffe, Bots, Sieg, Verlassen |
| `npm run test:schocken`  | `tests/schocken.test.mjs`  | ~1 s   | Schocken-Logik direkt: Wertung/Rangfolge, Becher & Aufdecken, nur Einsen herauslegen, Sechsen drehen, Vorgabe, Deckel, Hälften/Finale, viewFor, Timer, „Weiter“, Bots |
| `npm run test:reconnect` | `tests/reconnect.test.mjs` | ~8 s   | Grace-Period: Reload behält die Sitzung, langer Abbruch meldet ab |
| `npm run test:ui`        | `tests/ui.test.mjs`        | ~60 s  | Echte Oberfläche mit zwei Spielern im Browser, inkl. Spielmodus (Andocken/Einklappen), Risiko-Würfel, eine Revierkampf-Runde mit Bots, Schocken (Setup-Dialog ohne Scrollen, verdeckte Würfel, Würfelanimation, Aufdecken, „Weiter“), Dark-Mode (Schalter, gemerkt nach Reload, Revierkampf/Schocken dunkel), Mobilansicht und Konsolenfehlern |
| `npm run test:all`       | `tests/run-all.mjs`        | ~90 s  | alle fünf nacheinander |

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
