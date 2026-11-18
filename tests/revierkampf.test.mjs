/**
 * Logik-Test für Revierkampf – lädt games/revierkampf/game.js direkt
 * (ohne Server) und prüft Regeln, Phasen und Bots.
 *
 * Start:  npm run test:revierkampf   bzw.  node tests/revierkampf.test.mjs
 * Dauer:  ca. 1–2 Sekunden
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "revierkampf", "game.js"));
const { WIDTH, HEIGHT, WATER, NEUTRAL, OWNER_CHARS, generateMap, createRng, maxTroops } = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const HOST = { hostId: anna.id, now: 1_000_000 };

/** Neuer Zustand mit festem Zufall. */
function newState(players = [anna, ben], seed = 42) {
    return { ...game.createState({ players, hostId: anna.id }), rng: seed };
}

/** Startet eine Runde (Phase spawn). */
function startRound(state, bots = 0) {
    state = game.handleAction(state, { type: "settings", bots }, anna, HOST);
    return game.handleAction(state, { type: "start" }, anna, HOST);
}

/** Findet ein Landfeld, das als Startpunkt gültig ist. */
function findSpawn(state, playerId, avoid = []) {
    for (let y = 5; y < HEIGHT - 5; y++) {
        for (let x = 5; x < WIDTH - 5; x++) {
            if (state.grid[y * WIDTH + x] !== NEUTRAL) continue;
            if (avoid.some(p => Math.hypot(p.x - x, p.y - y) < 30)) continue;
            try {
                game.handleAction(state, { type: "spawn", x, y }, { id: playerId }, HOST);
                return { x, y };
            } catch {
                // nächstes Feld
            }
        }
    }
    throw new Error("Kein Startpunkt gefunden");
}

/** Führt Ticks aus, bis die Bedingung erfüllt ist (oder maxTicks erreicht). */
function runTicks(state, count, until = () => false) {
    let now = state.spawnEndsAt ?? HOST.now;
    for (let i = 0; i < count && !until(state); i++) {
        now += 200;
        state = game.tick(state, { now, dtMs: 200, hostId: anna.id }) ?? state;
    }
    return state;
}

/** Bringt eine Runde in Phase running (Anna und Ben mit eigenen Startpunkten). */
function runningRound(bots = 0) {
    let state = startRound(newState(), bots);
    const a = findSpawn(state, anna.id);
    state = game.handleAction(state, { type: "spawn", ...a }, anna, HOST);
    const b = findSpawn(state, ben.id, [a]);
    state = game.handleAction(state, { type: "spawn", ...b }, ben, HOST);
    state = game.tick(state, { now: state.spawnEndsAt, dtMs: 200 });
    return state;
}

const countOwner = (state, playerIndex) => [...state.grid].filter(c => c === OWNER_CHARS[playerIndex]).length;

// ===========================================================================
section("Karte");
// ===========================================================================
await test("Größe und Wasseranteil", async () => {
    const cells = generateMap(createRng(7));
    assert.equal(cells.length, WIDTH * HEIGHT);
    const water = cells.filter(c => c === WATER).length / cells.length;
    assert.ok(water >= 0.2 && water <= 0.5, `Wasseranteil ${water}`);
});
await test("Alles Land ist zusammenhängend", async () => {
    for (const seed of [1, 2, 3, 99]) {
        const cells = generateMap(createRng(seed));
        const start = cells.indexOf(NEUTRAL);
        const seen = new Set([start]);
        const queue = [start];
        while (queue.length) {
            const i = queue.pop();
            const x = i % WIDTH;
            for (const n of [x > 0 ? i - 1 : -1, x < WIDTH - 1 ? i + 1 : -1, i - WIDTH, i + WIDTH]) {
                if (n >= 0 && n < cells.length && cells[n] === NEUTRAL && !seen.has(n)) {
                    seen.add(n);
                    queue.push(n);
                }
            }
        }
        assert.equal(seen.size, cells.filter(c => c === NEUTRAL).length, `Seed ${seed}`);
    }
});
await test("Gleicher Seed → gleiche Karte", async () => {
    assert.deepEqual(generateMap(createRng(5)), generateMap(createRng(5)));
});

// ===========================================================================
section("Setup und Startphase");
// ===========================================================================
await test("Startzustand", async () => {
    const state = newState();
    assert.equal(state.phase, "setup");
    assert.equal(state.members.length, 2);
    assert.doesNotThrow(() => JSON.stringify(state));
});
await test("Nur der Host darf Einstellungen ändern und starten", async () => {
    const state = newState();
    assert.throws(() => game.handleAction(state, { type: "settings", bots: 2 }, ben, HOST), /Host/);
    assert.throws(() => game.handleAction(state, { type: "start" }, ben, HOST), /Host/);
});
await test("Ungültige Bot-Anzahl → Fehler", async () => {
    assert.throws(() => game.handleAction(newState(), { type: "settings", bots: 9 }, anna, HOST), /Bots/);
    assert.throws(() => game.handleAction(newState(), { type: "settings", bots: -1 }, anna, HOST), /Bots/);
});
await test("Allein ohne Bots kann nicht gestartet werden", async () => {
    assert.throws(() => startRound(newState([anna]), 0), /mindestens 2/);
});
await test("Start: Karte, Teilnehmer, Bots haben Startpunkte", async () => {
    const state = startRound(newState(), 3);
    assert.equal(state.phase, "spawn");
    assert.equal(state.grid.length, WIDTH * HEIGHT);
    assert.equal(state.players.length, 5);
    assert.deepEqual(state.players.map(p => p.bot), [false, false, true, true, true]);
    assert.ok(state.players.filter(p => p.bot).every(p => p.spawn && p.cells > 0));
    assert.equal(state.spawnEndsAt, HOST.now + 10_000);
});
await test("Startpunkt: Wasser und zu nah → Fehler, gültig → Revier", async () => {
    let state = startRound(newState(), 0);
    const waterIndex = state.grid.indexOf(WATER);
    assert.throws(() => game.handleAction(state,
        { type: "spawn", x: waterIndex % WIDTH, y: Math.floor(waterIndex / WIDTH) }, anna, HOST), /Land/);

    const a = findSpawn(state, anna.id);
    state = game.handleAction(state, { type: "spawn", ...a }, anna, HOST);
    assert.ok(state.players[0].cells >= 20, "Revier mit Radius 3");
    assert.throws(() => game.handleAction(state, { type: "spawn", x: a.x + 2, y: a.y }, ben, HOST), /nah/);
});
await test("Startpunkt versetzen entfernt das alte Revier", async () => {
    let state = startRound(newState(), 0);
    const a = findSpawn(state, anna.id);
    state = game.handleAction(state, { type: "spawn", ...a }, anna, HOST);
    const b = findSpawn(state, anna.id, [a]);
    state = game.handleAction(state, { type: "spawn", ...b }, anna, HOST);
    assert.deepEqual(state.players[0].spawn, b);
    assert.notEqual(state.grid[a.y * WIDTH + a.x], "A");
});
await test("Countdown und automatischer Startpunkt nach 10 s", async () => {
    let state = startRound(newState(), 1);
    const halfway = game.tick(state, { now: HOST.now + 4_100, dtMs: 200 });
    assert.equal(halfway.spawnSecondsLeft, 6);
    assert.equal(game.tick(halfway, { now: HOST.now + 4_300, dtMs: 200 }), undefined, "keine Änderung");

    state = game.tick(state, { now: state.spawnEndsAt, dtMs: 200 });
    assert.equal(state.phase, "running");
    assert.ok(state.players.every(p => p.alive && p.cells > 0 && p.troops === 150), "alle platziert");
});

// ===========================================================================
section("Runde");
// ===========================================================================
await test("Truppen wachsen, aber höchstens bis zum Maximum", async () => {
    let state = runningRound();
    const before = state.players[0].troops;
    state = runTicks(state, 5);
    assert.ok(state.players[0].troops > before);
    state = runTicks(state, 3000);
    const p = state.players[0];
    assert.ok(p.troops <= maxTroops(p.cells) + 0.01, `${p.troops} ≤ ${maxTroops(p.cells)}`);
});
await test("Angriff auf neutrales Land vergrößert das Revier", async () => {
    let state = runningRound();
    const cellsBefore = state.players[0].cells;
    const troopsBefore = state.players[0].troops;
    // Neutrales Feld direkt am Revier suchen
    const index = [...state.grid].findIndex((c, i) => c === NEUTRAL &&
        [i - 1, i + 1, i - WIDTH, i + WIDTH].some(n => state.grid[n] === "A"));
    assert.ok(index >= 0, "neutrales Nachbarfeld");
    const target = { x: index % WIDTH, y: Math.floor(index / WIDTH) };

    state = game.handleAction(state, { type: "attack", ...target, percent: 50 }, anna, HOST);
    assert.equal(state.attacks.length, 1);
    assert.equal(state.players[0].troops, troopsBefore - 75);
    state = runTicks(state, 20);
    assert.ok(state.players[0].cells > cellsBefore + 20, `${cellsBefore} → ${state.players[0].cells}`);
});
await test("Angriff ohne gemeinsame Grenze → Fehler", async () => {
    const state = runningRound();
    const b = state.players[1].spawn;
    assert.throws(() => game.handleAction(state, { type: "attack", ...b, percent: 50 }, anna, HOST), /Grenz/);
});
await test("Eigenes Gebiet anklicken wird ignoriert", async () => {
    const state = runningRound();
    assert.equal(game.handleAction(state, { type: "attack", ...state.players[0].spawn, percent: 50 }, anna, HOST), undefined);
});
await test("Zuschauer und Ausgeschiedene dürfen nicht angreifen", async () => {
    const state = runningRound();
    const carla = { id: "u-carla", name: "Carla" };
    const joined = game.onPlayerJoin(state, carla);
    assert.equal(joined.members.length, 3);
    assert.equal(joined.players.length, 2, "Carla schaut zu");
    assert.throws(() => game.handleAction(joined, { type: "attack", x: 0, y: 0, percent: 50 }, carla, HOST), /nicht mit/);
});
await test("Angriff auf Gegner: Felder und Truppen wechseln", async () => {
    let state = runningRound();
    // Bens Revier direkt neben Anna legen (Karte manipulieren)
    const cells = state.grid.split("");
    const { x, y } = state.players[0].spawn;
    for (let dx = 4; dx <= 12; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
            const cx = x + dx;
            if (cx < WIDTH && y + dy >= 0 && y + dy < HEIGHT) {
                const i = (y + dy) * WIDTH + cx;
                if (cells[i] !== WATER) cells[i] = "B";
            }
        }
    }
    for (let dy = -3; dy <= 3; dy++) {
        const i = (y + dy) * WIDTH + x + 3;
        if (y + dy >= 0 && y + dy < HEIGHT && cells[i] !== WATER) cells[i] = "A";
    }
    state = { ...state, grid: cells.join("") };
    state.players = state.players.map((p, i) => ({ ...p, troops: i === 0 ? 3000 : 20 }));
    state = runTicks(state, 1);

    const benCellsBefore = countOwner(state, 1);
    const target = [...state.grid].findIndex((c, i) => c === "B" && Math.abs((i % WIDTH) - x) <= 5);
    state = game.handleAction(state, { type: "attack", x: target % WIDTH, y: Math.floor(target / WIDTH), percent: 100 }, anna, HOST);
    state = runTicks(state, 10);
    assert.ok(countOwner(state, 1) < benCellsBefore, `Ben ${benCellsBefore} → ${countOwner(state, 1)}`);
});
await test("Besiegt → ausgeschieden und Sieg", async () => {
    let state = runningRound();
    // Ben auf ein einziges Feld neben Anna reduzieren
    const cells = state.grid.split("").map(c => (c === "B" ? NEUTRAL : c));
    const { x, y } = state.players[0].spawn;
    const benCell = [x + 4, x - 4].map(cx => y * WIDTH + cx).find(i => cells[i] === NEUTRAL);
    assert.ok(benCell !== undefined, "Platz für Ben");
    cells[benCell] = "B";
    cells[benCell - Math.sign(benCell - (y * WIDTH + x))] = "A";
    state = { ...state, grid: cells.join(""), players: state.players.map((p, i) => ({ ...p, troops: i === 0 ? 5000 : p.troops })) };
    state = runTicks(state, 1);

    state = game.handleAction(state, { type: "attack", x: benCell % WIDTH, y: Math.floor(benCell / WIDTH), percent: 100 }, anna, HOST);
    state = runTicks(state, 10, s => s.phase === "finished");
    assert.equal(state.players[1].alive, false);
    assert.equal(state.phase, "finished");
    assert.equal(state.winner, 0);
    assert.ok(state.log.some(t => t.includes("Ben wurde besiegt")));
});
await test("Neue Runde → zurück zum Setup (nur Host)", async () => {
    const state = { ...runningRound(), phase: "finished" };
    assert.throws(() => game.handleAction(state, { type: "new-round" }, ben, HOST), /Host/);
    const next = game.handleAction(state, { type: "new-round" }, anna, HOST);
    assert.equal(next.phase, "setup");
    assert.equal(next.players.length, 0);
});
await test("Spieler verlässt Lobby → Felder neutral, Runde endet", async () => {
    let state = runningRound(0);
    state = game.onPlayerLeave(state, ben);
    assert.equal(countOwner(state, 1), 0);
    assert.equal(state.players[1].alive, false);
    assert.equal(state.phase, "finished", "nur noch Anna übrig");
    assert.equal(state.members.length, 1);
});
await test("Spieler verlässt während der Startphase → bekommt keinen Startpunkt", async () => {
    let state = startRound(newState(), 1);
    state = game.onPlayerLeave(state, ben);
    state = game.tick(state, { now: state.spawnEndsAt, dtMs: 200 });
    assert.equal(state.players[1].alive, false);
    assert.equal(countOwner(state, 1), 0);
});

// ===========================================================================
section("Bots");
// ===========================================================================
await test("Bots expandieren selbstständig", async () => {
    let state = runningRound(3);
    const botCells = () => state.players.filter(p => p.bot).map(p => p.cells);
    const before = botCells();
    state = runTicks(state, 150);
    const after = botCells();
    assert.ok(after.every((cells, i) => cells > before[i] || !state.players[2 + i].alive), `${before} → ${after}`);
});
await test("Lange Partie mit 8 Bots bleibt konsistent (JSON, Zählung)", async () => {
    let state = runningRound(8);
    state = runTicks(state, 1500, s => s.phase === "finished");
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(state)));
    state.players.forEach((p, i) => assert.equal(p.cells, countOwner(state, i), p.name));
    assert.ok(state.players.every(p => Number.isFinite(p.troops) && p.troops >= 0));
});

process.exit(summary());
