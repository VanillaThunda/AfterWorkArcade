/**
 * API-Test (End-to-End): startet den Server und simuliert mehrere User
 * über HTTP-Anfragen und SSE-Streams.
 *
 * Start:  npm test        bzw.  node tests/api.test.mjs
 * Dauer:  wenige Sekunden
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, startServer, createTestRunner, apiCall, openEventStream, sleep } from "./helpers.mjs";

const server = await startServer(3456, { HOST: "127.0.0.1" });
const BASE = server.baseUrl;
const call = (method, urlPath, body, token) => apiCall(BASE, method, urlPath, body, token);
const { test, section, summary } = createTestRunner();

// ===========================================================================
section("Statische Dateien");
// ===========================================================================
await test("index.html", async () => {
    const r = await call("GET", "/");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
});
await test("Query-String wird ignoriert", async () => {
    const r = await call("GET", "/js/main.js?v=2");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /javascript/);
});
await test("Path-Traversal ../server.js → 404", async () => {
    assert.equal((await call("GET", "/../server.js")).status, 404);
});
await test("Path-Traversal %2e%2e → 404", async () => {
    assert.equal((await call("GET", "/%2e%2e/server.js")).status, 404);
});
await test("Path-Traversal ..%2f → 404", async () => {
    assert.equal((await call("GET", "/css/..%2f..%2fserver.js")).status, 404);
});
await test("game.js (Server-Teil) nicht abrufbar", async () => {
    assert.equal((await call("GET", "/games/risiko-wuerfel/game.js")).status, 404);
});
await test("Spiel-Traversal → 404", async () => {
    assert.equal((await call("GET", "/games/risiko-wuerfel/..%2fgame.js")).status, 404);
});
await test("client.js abrufbar", async () => {
    assert.equal((await call("GET", "/games/risiko-wuerfel/client.js")).status, 200);
});
await test("Vorlage (_vorlage) wird nicht geladen", async () => {
    assert.equal((await call("GET", "/games/_vorlage/client.js")).status, 404);
});
await test("Ordner → 404", async () => {
    assert.equal((await call("GET", "/js")).status, 404);
});
await test("POST auf statische Datei → 405", async () => {
    assert.equal((await call("POST", "/index.html")).status, 405);
});

// ===========================================================================
section("API-Grundlagen");
// ===========================================================================
await test("Server-Info", async () => {
    const r = await call("GET", "/api/info");
    assert.match(r.data.version, /^\d+\.\d+\.\d+$/);
    assert.ok(Array.isArray(r.data.lanUrls));
});
await test("Spieleliste", async () => {
    const r = await call("GET", "/api/games");
    assert.ok(r.data.games.some(game => game.id === "risiko-wuerfel"));
});
await test("Unbekannter Endpunkt → 404", async () => {
    assert.equal((await call("GET", "/api/xyz")).status, 404);
});
await test("Ohne Token → 401", async () => {
    const r = await call("GET", "/api/me");
    assert.equal(r.status, 401);
    assert.equal(r.data.code, "UNAUTHORIZED");
});
await test("Ungültiges JSON → 400", async () => {
    const response = await fetch(BASE + "/api/login", { method: "POST", body: "{kaputt" });
    assert.equal(response.status, 400);
});
await test("Zu großer Body → 413", async () => {
    assert.equal((await call("POST", "/api/login", { name: "x".repeat(20000) })).status, 413);
});
await test("Name zu kurz → 400", async () => {
    assert.equal((await call("POST", "/api/login", { name: "a" })).status, 400);
});
await test("Name mit < > → 400", async () => {
    assert.equal((await call("POST", "/api/login", { name: "<script>" })).status, 400);
});
await test("SSE mit falschem Token → 401", async () => {
    assert.equal((await call("GET", "/events?token=falsch")).status, 401);
});

// ===========================================================================
section("Login und globaler Chat");
// ===========================================================================
const anna = (await call("POST", "/api/login", { name: "  Anna  " })).data;
const ben = (await call("POST", "/api/login", { name: "Ben" })).data;
const carla = (await call("POST", "/api/login", { name: "Carla Ü" })).data;

await test("Login liefert Token und bereinigten Namen", async () => {
    assert.ok(anna.token);
    assert.equal(anna.user.name, "Anna");
});
await test("Doppelter Name (Groß-/Kleinschreibung egal) → 409", async () => {
    assert.equal((await call("POST", "/api/login", { name: "anna" })).status, 409);
});
await test("/api/me", async () => {
    assert.equal((await call("GET", "/api/me", undefined, anna.token)).data.user.name, "Anna");
});

const streamAnna = openEventStream(BASE, anna.token);
const streamBen = openEventStream(BASE, ben.token);
const streamCarla = openEventStream(BASE, carla.token);

await test("Voller Zustand beim Verbinden", async () => {
    await streamAnna.waitFor(e => e.type === "online-users" && e.data.length === 3, "online-users");
    await streamAnna.waitFor(e => e.type === "lobbies", "lobbies");
    await streamAnna.waitFor(e => e.type === "chat-history" && e.data.scope === "global", "chat-history");
    // "lobby" ist das letzte Event des Anfangszustands → danach sind alle Streams sicher verbunden.
    for (const stream of [streamAnna, streamBen, streamCarla]) {
        await stream.waitFor(e => e.type === "lobby" && e.data === null, "lobby = null");
    }
});
await test("Globaler Chat kommt bei allen an", async () => {
    const received = streamBen.next(e => e.type === "chat" && e.data.text === "Hallo zusammen", "Chat bei Ben");
    assert.equal((await call("POST", "/api/chat/send", { scope: "global", text: " Hallo zusammen " }, anna.token)).status, 200);
    const event = await received;
    assert.equal(event.data.userName, "Anna");
    assert.equal(event.data.scope, "global");
});
await test("Leere Nachricht → 400", async () => {
    assert.equal((await call("POST", "/api/chat/send", { scope: "global", text: "   " }, anna.token)).status, 400);
});
await test("Lobby-Chat ohne Lobby → 409", async () => {
    assert.equal((await call("POST", "/api/chat/send", { scope: "lobby", text: "hi" }, anna.token)).status, 409);
});

// ===========================================================================
section("Offene Lobby mit Passwort");
// ===========================================================================
let openLobby;
await test("Lobby erstellen", async () => {
    const lobbyEvent = streamAnna.next(e => e.type === "lobby" && e.data, "Lobby für Anna");
    const listEvent = streamBen.next(e => e.type === "lobbies" && e.data.length === 1, "Liste bei Ben");
    const r = await call("POST", "/api/lobby/create", { name: "Freitag", visibility: "public", password: "geheim" }, anna.token);
    assert.equal(r.status, 200);

    openLobby = (await lobbyEvent).data;
    assert.equal(openLobby.hostId, anna.user.id);
    assert.equal(openLobby.hasPassword, true);
    assert.equal(openLobby.code.length, 6);

    const list = (await listEvent).data;
    assert.equal(list[0].name, "Freitag");
    assert.equal(list[0].hasPassword, true);
    assert.equal(JSON.stringify(list).includes("salt"), false, "Passwort-Hash darf nicht rausgehen");
});
await test("Ungültige Sichtbarkeit → 400", async () => {
    assert.equal((await call("POST", "/api/lobby/create", { visibility: "egal" }, ben.token)).status, 400);
});
await test("Beitritt ohne Passwort → PASSWORD_REQUIRED", async () => {
    const r = await call("POST", "/api/lobby/join", { lobbyId: openLobby.id }, ben.token);
    assert.equal(r.data.code, "PASSWORD_REQUIRED");
});
await test("Falsches Passwort → WRONG_PASSWORD", async () => {
    const r = await call("POST", "/api/lobby/join", { lobbyId: openLobby.id, password: "nein" }, ben.token);
    assert.equal(r.data.code, "WRONG_PASSWORD");
});
await test("Richtiges Passwort → Beitritt und Systemnachricht", async () => {
    const lobbyEvent = streamBen.next(e => e.type === "lobby" && e.data, "Lobby bei Ben");
    const systemMessage = streamAnna.next(e => e.type === "chat" && e.data.system && e.data.text.includes("Ben"), "Systemnachricht");
    assert.equal((await call("POST", "/api/lobby/join", { lobbyId: openLobby.id, password: "geheim" }, ben.token)).status, 200);
    assert.equal((await lobbyEvent).data.members.length, 2);
    await systemMessage;
});
await test("Lobby-Chat nur für Mitglieder", async () => {
    const carlaEventCount = streamCarla.events.length;
    const received = streamBen.next(e => e.type === "chat" && e.data.text === "nur lobby", "Lobby-Chat bei Ben");
    await call("POST", "/api/chat/send", { scope: "lobby", text: "nur lobby" }, anna.token);
    assert.equal((await received).data.scope, "lobby");
    await sleep(150);
    assert.equal(streamCarla.events.slice(carlaEventCount).some(e => e.type === "chat"), false);
});

// ===========================================================================
section("Private Lobby");
// ===========================================================================
let privateLobby;
await test("Private Lobby ist nicht in der Liste", async () => {
    const lobbyEvent = streamCarla.next(e => e.type === "lobby" && e.data, "Lobby für Carla");
    await call("POST", "/api/lobby/create", { name: "Geheim", visibility: "private" }, carla.token);
    privateLobby = (await lobbyEvent).data;
    await sleep(100);
    const lastList = streamAnna.events.filter(e => e.type === "lobbies").at(-1).data;
    assert.equal(lastList.some(lobby => lobby.name === "Geheim"), false);
});
await test("Private Lobby nicht per ID beitretbar", async () => {
    assert.equal((await call("POST", "/api/lobby/join", { lobbyId: privateLobby.id }, ben.token)).status, 404);
});
await test("Falscher Code → 404", async () => {
    assert.equal((await call("POST", "/api/lobby/join", { code: "ZZZZZZ" }, ben.token)).status, 404);
});

// ===========================================================================
section("Spiel: Risiko-Würfel");
// ===========================================================================
await test("Nicht-Host darf kein Spiel starten → 403", async () => {
    assert.equal((await call("POST", "/api/game/select", { gameId: "risiko-wuerfel" }, ben.token)).status, 403);
});
await test("Unbekanntes Spiel → 404", async () => {
    assert.equal((await call("POST", "/api/game/select", { gameId: "gibtsnicht" }, anna.token)).status, 404);
});
await test("Aktion ohne laufendes Spiel → 409", async () => {
    assert.equal((await call("POST", "/api/game/action", { action: { type: "roll" } }, ben.token)).status, 409);
});
await test("Host startet Risiko → alle bekommen game-state", async () => {
    const stateAnna = streamAnna.next(e => e.type === "game-state" && e.data, "game-state Anna");
    const stateBen = streamBen.next(e => e.type === "game-state" && e.data, "game-state Ben");
    const lobbyEvent = streamBen.next(e => e.type === "lobby" && e.data?.game, "Lobby mit Spiel");
    assert.equal((await call("POST", "/api/game/select", { gameId: "risiko-wuerfel" }, anna.token)).status, 200);

    const state = (await stateBen).data.state;
    await stateAnna;
    assert.equal(state.round, 1);
    assert.deepEqual(state.maxDice, { attacker: 3, defender: 2 });
    assert.equal((await lobbyEvent).data.game.name, "Risiko-Würfel");
});
await test("Zweites Spiel starten → 409", async () => {
    assert.equal((await call("POST", "/api/game/select", { gameId: "risiko-wuerfel" }, anna.token)).status, 409);
});
await test("Verteidiger mit 3 Würfeln → 400", async () => {
    const r = await call("POST", "/api/game/action", { action: { type: "roll", side: "defender", count: 3 } }, ben.token);
    assert.equal(r.status, 400);
});
await test("Ungültige Seite → 400", async () => {
    const r = await call("POST", "/api/game/action", { action: { type: "roll", side: "x", count: 1 } }, ben.token);
    assert.equal(r.status, 400);
});
await test("Ohne action → 400", async () => {
    assert.equal((await call("POST", "/api/game/action", {}, ben.token)).status, 400);
});
await test("Angreifer würfelt → sortiert, noch keine Auswertung", async () => {
    const stateEvent = streamBen.next(e => e.type === "game-state" && e.data?.state.attacker.dice.length === 3, "Angreifer-Wurf");
    await call("POST", "/api/game/action", { action: { type: "roll", side: "attacker", count: 3 } }, anna.token);
    const state = (await stateEvent).data.state;
    assert.deepEqual(state.attacker.dice, [...state.attacker.dice].sort((a, b) => b - a));
    assert.equal(state.attacker.rolledBy, "Anna");
    assert.equal(state.result, null);
});
await test("Angreifer würfelt doppelt → 400", async () => {
    const r = await call("POST", "/api/game/action", { action: { type: "roll", side: "attacker", count: 1 } }, anna.token);
    assert.equal(r.status, 400);
});
await test("Verteidiger würfelt → Auswertung korrekt", async () => {
    const stateEvent = streamAnna.next(e => e.type === "game-state" && e.data?.state.result, "Auswertung");
    await call("POST", "/api/game/action", { action: { type: "roll", side: "defender", count: 2 } }, ben.token);
    const state = (await stateEvent).data.state;

    assert.equal(state.result.comparisons.length, 2);
    state.result.comparisons.forEach((comparison, i) => {
        assert.equal(comparison.attacker, state.attacker.dice[i]);
        assert.equal(comparison.defender, state.defender.dice[i]);
        assert.equal(comparison.winner, comparison.attacker > comparison.defender ? "attacker" : "defender");
    });
    assert.equal(state.result.attackerLosses + state.result.defenderLosses, 2);
});
await test("Nächster Wurf startet neue Runde", async () => {
    const stateEvent = streamAnna.next(e => e.type === "game-state" && e.data?.state.round === 2, "Runde 2");
    await call("POST", "/api/game/action", { action: { type: "roll", side: "defender", count: 1 } }, ben.token);
    const state = (await stateEvent).data.state;
    assert.equal(state.attacker.dice.length, 0);
    assert.equal(state.defender.dice.length, 1);
    assert.equal(state.result, null);
});
await test("Regeln über 500 Runden (Gleichstand → Verteidiger)", async () => {
    // Spielmodul direkt testen, ohne Server
    const require = createRequire(import.meta.url);
    const game = require(path.join(PROJECT_ROOT, "games", "risiko-wuerfel", "game.js"));

    let state = game.createState({ players: [] });
    for (let i = 0; i < 500; i++) {
        const attackerCount = 1 + (i % 3);
        const defenderCount = 1 + (i % 2);
        state = game.handleAction(state, { type: "roll", side: "attacker", count: attackerCount }, { name: "A" });
        state = game.handleAction(state, { type: "roll", side: "defender", count: defenderCount }, { name: "V" });

        assert.equal(state.result.comparisons.length, Math.min(attackerCount, defenderCount));
        for (const comparison of state.result.comparisons) {
            if (comparison.attacker === comparison.defender) assert.equal(comparison.winner, "defender");
        }
    }
});
await test("Reload: neue Verbindung bekommt Lobby und Spielstand", async () => {
    const reloaded = openEventStream(BASE, ben.token);
    await reloaded.waitFor(e => e.type === "lobby" && e.data?.id === openLobby.id, "Lobby");
    await reloaded.waitFor(e => e.type === "chat-history" && e.data.scope === "lobby" && e.data.messages.length > 0, "Lobby-Verlauf");
    await reloaded.waitFor(e => e.type === "game-state" && e.data?.state.round === 2, "Spielstand");
    reloaded.close();
});
await test("Host beendet Spiel → game-state null", async () => {
    const stateEvent = streamBen.next(e => e.type === "game-state" && e.data === null, "Spiel beendet");
    await call("POST", "/api/game/end", {}, anna.token);
    await stateEvent;
});

// ===========================================================================
section("Spiel: Revierkampf (Echtzeit mit tick)");
// ===========================================================================
const gameAction = (action, token) => call("POST", "/api/game/action", { action }, token);

await test("Revierkampf in der Spieleliste", async () => {
    const { games } = (await call("GET", "/api/games")).data;
    assert.ok(games.some(game => game.id === "revierkampf" && game.name === "Revierkampf"));
});
await test("Start → Setup-Phase mit Mitgliedern", async () => {
    const stateEvent = streamBen.next(e => e.type === "game-state" && e.data?.gameId === "revierkampf", "Revierkampf-Zustand");
    assert.equal((await call("POST", "/api/game/select", { gameId: "revierkampf" }, anna.token)).status, 200);
    const state = (await stateEvent).data.state;
    assert.equal(state.phase, "setup");
    assert.ok(state.members.some(m => m.name === "Ben"));
});
await test("Nur der Host darf Bots einstellen (Host-Info aus dem Kontext)", async () => {
    const r = await gameAction({ type: "settings", bots: 2 }, ben.token);
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Host/);
    const stateEvent = streamBen.next(e => e.type === "game-state" && e.data?.state.settings.bots === 2, "Bots = 2");
    assert.equal((await gameAction({ type: "settings", bots: 2 }, anna.token)).status, 200);
    await stateEvent;
});
await test("Rundenstart: Ticker schickt den Countdown ohne weitere Aktion", async () => {
    const spawnEvent = streamBen.next(e => e.type === "game-state" && e.data?.state.phase === "spawn", "Startphase");
    assert.equal((await gameAction({ type: "start" }, anna.token)).status, 200);
    const start = (await spawnEvent).data.state;
    assert.equal(start.players.filter(p => p.bot).length, 2);

    // Nach ca. 1 s muss der Server von selbst einen neuen Countdown-Stand schicken.
    const tickEvent = await streamBen.next(
        e => e.type === "game-state" && e.data?.state.spawnSecondsLeft < start.spawnSecondsLeft, "Tick-Update", 2500);
    assert.equal(tickEvent.data.state.phase, "spawn");
});
await test("Startpunkt per API setzen, Wasser → 400", async () => {
    const { state } = streamBen.events.filter(e => e.type === "game-state" && e.data).at(-1).data;
    const water = state.grid.indexOf("~");
    const waterResult = await gameAction({ type: "spawn", x: water % state.width, y: Math.floor(water / state.width) }, ben.token);
    assert.equal(waterResult.status, 400);

    // Gültiges Feld weit weg von den Bots suchen
    const botSpawns = state.players.filter(p => p.spawn).map(p => p.spawn);
    let spot = null;
    for (let i = 0; i < state.grid.length && !spot; i++) {
        const x = i % state.width;
        const y = Math.floor(i / state.width);
        if (state.grid[i] === "." && botSpawns.every(s => Math.hypot(s.x - x, s.y - y) > 15)) spot = { x, y };
    }
    const stateEvent = streamAnna.next(e => e.type === "game-state" && e.data?.state.players.find(p => p.name === "Ben")?.spawn, "Bens Startpunkt");
    assert.equal((await gameAction({ type: "spawn", ...spot }, ben.token)).status, 200);
    assert.deepEqual((await stateEvent).data.state.players.find(p => p.name === "Ben").spawn, spot);
});
await test("Spiel beenden → keine Ticks mehr", async () => {
    const ended = streamBen.next(e => e.type === "game-state" && e.data === null, "Spiel beendet");
    await call("POST", "/api/game/end", {}, anna.token);
    await ended;
    const countBefore = streamBen.events.length;
    await sleep(1200);
    const later = streamBen.events.slice(countBefore).filter(e => e.type === "game-state");
    assert.equal(later.length, 0, "keine game-state-Events nach Spielende");
});

// ===========================================================================
section("Spiel: Schocken (spielerspezifische Sicht mit viewFor)");
// ===========================================================================
const players = { [anna.user.id]: anna, [ben.user.id]: ben };
const streams = { [anna.user.id]: streamAnna, [ben.user.id]: streamBen };

await test("Schocken starten (ohne Bots)", async () => {
    const selected = streamBen.next(e => e.type === "game-state" && e.data?.gameId === "schocken", "Schocken-Zustand");
    assert.equal((await call("POST", "/api/game/select", { gameId: "schocken" }, anna.token)).status, 200);
    assert.equal((await selected).data.state.phase, "setup");
    assert.equal((await gameAction({ type: "settings", bots: 0, mode: "half" }, anna.token)).status, 200);
    const started = streamBen.next(e => e.type === "game-state" && e.data?.state.phase === "playing", "Partie läuft");
    assert.equal((await gameAction({ type: "start" }, anna.token)).status, 200);
    const state = (await started).data.state;
    assert.equal(state.round.laden, true);
    assert.equal(state.round.order.length, 2);
});
await test("Becher zu: Würfel werden an niemanden übertragen, auch nicht an den Werfer", async () => {
    const { state } = streamBen.events.filter(e => e.type === "game-state" && e.data).at(-1).data;
    const firstId = state.round.order[0];
    const otherId = state.round.order[1];

    const ownEvent = streams[firstId].next(e => e.type === "game-state" && e.data?.state.round.turns[firstId].throws === 1, "eigener Wurf");
    const otherEvent = streams[otherId].next(e => e.type === "game-state" && e.data?.state.round.turns[firstId].throws === 1, "fremder Wurf");
    assert.equal((await gameAction({ type: "roll" }, players[firstId].token)).status, 200);

    for (const event of [await ownEvent, await otherEvent]) {
        const turn = event.data.state.round.turns[firstId];
        assert.deepEqual(turn.dice, [0, 0, 0], "Würfel verborgen");
        assert.equal(turn.result, null);
    }

    // Falscher Spieler → 400
    assert.equal((await gameAction({ type: "roll" }, players[otherId].token)).status, 400);
});
await test("Aufdecken zeigt die Würfel allen, Auswertung deckt alles auf", async () => {
    const { state } = streamBen.events.filter(e => e.type === "game-state" && e.data).at(-1).data;
    const firstId = state.round.order[0];
    const otherId = state.round.order[1];

    const ownLook = streams[firstId].next(e => e.type === "game-state" && e.data?.state.round.turns[firstId].open, "eigenes Aufdecken");
    const otherLook = streams[otherId].next(e => e.type === "game-state" && e.data?.state.round.turns[firstId].open, "fremdes Aufdecken");
    assert.equal((await gameAction({ type: "look" }, players[firstId].token)).status, 200);
    const own = (await ownLook).data.state.round.turns[firstId];
    const foreign = (await otherLook).data.state.round.turns[firstId];
    assert.ok(own.dice.every(v => v >= 1 && v <= 6), "eigene Würfel sichtbar");
    assert.deepEqual(foreign.dice, own.dice, "Mitspieler sieht dieselben Würfel");
    assert.equal(foreign.result.label, own.result.label);

    // Erster beendet, Zweiter würfelt blind und beendet verdeckt → Auswertung zeigt alles
    assert.equal((await gameAction({ type: "finish" }, players[firstId].token)).status, 200);
    const revealEvent = streams[otherId].next(e => e.type === "game-state" && e.data?.state.round.stage === "reveal", "Auswertung");
    assert.equal((await gameAction({ type: "roll" }, players[otherId].token)).status, 200);
    assert.equal((await gameAction({ type: "finish" }, players[otherId].token)).status, 200);
    const revealed = (await revealEvent).data.state;
    assert.ok(revealed.round.turns[otherId].dice.every(v => v >= 1), "verdeckter Wurf nach der Auswertung sichtbar");
    assert.equal(revealed.reveal.entries.length, 2);
    assert.ok(revealed.revealRemainingMs > 20000, "Auswertung bleibt ca. 30 s stehen");
});
await test("„Weiter“ von beiden Spielern startet die nächste Runde sofort", async () => {
    const acked = streamBen.next(e => e.type === "game-state" && e.data?.state.reveal?.acks.length === 1, "1 Klick");
    assert.equal((await gameAction({ type: "continue" }, anna.token)).status, 200);
    assert.equal((await acked).data.state.round.stage, "reveal");
    const nextRound = streamBen.next(e => e.type === "game-state" && e.data?.state.round.stage === "turns", "nächste Runde");
    assert.equal((await gameAction({ type: "continue" }, ben.token)).status, 200);
    await nextRound;
});
await test("Reload bekommt ebenfalls die gefilterte Sicht", async () => {
    const reloaded = openEventStream(BASE, ben.token);
    const event = await reloaded.waitFor(e => e.type === "game-state" && e.data?.gameId === "schocken", "Schocken nach Reload");
    assert.equal(event.data.state.round.turnEndsAt, undefined, "interne Zeitstempel werden nicht übertragen");
    reloaded.close();
    const ended = streamBen.next(e => e.type === "game-state" && e.data === null, "Spiel beendet");
    await call("POST", "/api/game/end", {}, anna.token);
    await ended;
});

// ===========================================================================
section("Host-Wechsel, Lobby löschen, Beitritt per Code");
// ===========================================================================
await test("Host verlässt Lobby → Ben wird Host", async () => {
    const newHost = streamBen.next(e => e.type === "lobby" && e.data && e.data.hostId === ben.user.id, "neuer Host");
    const annaLeft = streamAnna.next(e => e.type === "lobby" && e.data === null, "Anna ohne Lobby");
    await call("POST", "/api/lobby/leave", {}, anna.token);
    await newHost;
    await annaLeft;
});
await test("Beitritt zur privaten Lobby per Code (kleingeschrieben)", async () => {
    const lobbyEvent = streamAnna.next(e => e.type === "lobby" && e.data?.id === privateLobby.id, "private Lobby");
    const r = await call("POST", "/api/lobby/join", { code: privateLobby.code.toLowerCase() }, anna.token);
    assert.equal(r.status, 200);
    await lobbyEvent;
});
await test("Letztes Mitglied verlässt → Lobby gelöscht", async () => {
    const emptyList = streamAnna.next(e => e.type === "lobbies" && e.data.length === 0, "leere Liste");
    await call("POST", "/api/lobby/leave", {}, ben.token);
    await emptyList;
});
await test("Neue Lobby erstellen verlässt die alte", async () => {
    const carlaAlone = streamCarla.next(
        e => e.type === "lobby" && e.data?.members.length === 1 && e.data.hostId === carla.user.id,
        "Carla allein"
    );
    await call("POST", "/api/lobby/create", { name: "Neu", visibility: "public" }, anna.token);
    await carlaAlone;
});

// ===========================================================================
section("Lobby voll");
// ===========================================================================
await test("9. Mitglied → 409", async () => {
    const created = await call("POST", "/api/lobby/create", { name: "Voll", visibility: "public" }, ben.token);
    const tokens = [];
    for (let i = 0; i < 7; i++) {
        const user = (await call("POST", "/api/login", { name: "Spieler" + i })).data;
        const r = await call("POST", "/api/lobby/join", { lobbyId: created.data.lobbyId }, user.token);
        assert.equal(r.status, 200, "Spieler" + i);
        tokens.push(user.token);
    }

    const extra = (await call("POST", "/api/login", { name: "Extra" })).data;
    assert.equal((await call("POST", "/api/lobby/join", { lobbyId: created.data.lobbyId }, extra.token)).status, 409);

    for (const token of [...tokens, extra.token]) await call("POST", "/api/logout", {}, token);
});

// ===========================================================================
section("Logout");
// ===========================================================================
await test("Logout → Token ungültig, User aus Online-Liste", async () => {
    const carlaGone = streamAnna.next(e => e.type === "online-users" && !e.data.some(u => u.name === "Carla Ü"), "Carla weg");
    await call("POST", "/api/logout", {}, carla.token);
    await carlaGone;
    assert.equal((await call("GET", "/api/me", undefined, carla.token)).status, 401);
});

// ---------------------------------------------------------------------------
streamAnna.close();
streamBen.close();
streamCarla.close();
server.stop();

const exitCode = summary();
if (/Error/.test(server.getLog())) console.log("\nServer-Log:\n" + server.getLog());
process.exit(exitCode);
