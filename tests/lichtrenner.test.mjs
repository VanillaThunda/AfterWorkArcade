/**
 * Logik-Test für Lichtrenner – lädt games/lichtrenner/game.js direkt
 * (ohne Server) und prüft Start, Bewegung, Kollisionen, Steuerung, Runden,
 * Partie-Ende, Bots und die Sicht für den Client.
 *
 * Start:  npm run test:lichtrenner   bzw.  node tests/lichtrenner.test.mjs
 * Dauer:  ca. 1 Sekunde
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "lichtrenner", "game.js"));
const { WIDTH, HEIGHT, EMPTY, OWNER_CHARS, COUNTDOWN_MS, ROUND_PAUSE_MS, ROUND_MAX_TICKS, startPositions, indexOf } = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const NOW = 1_000_000;
const ctx = (now = NOW) => ({ hostId: anna.id, now });
const act = (state, player, action, now = NOW) => game.handleAction(state, action, player, ctx(now)) ?? state;
const tick = (state, now) => game.tick(state, { now }) ?? state;
const find = (state, player) => state.players.find(p => p.id === player.id);

function startMatch({ players = [anna, ben], bots = 0, wins = 3, seed } = {}) {
    let state = game.createState({ players, hostId: anna.id });
    if (seed !== undefined) state.rng = seed; // fester Zufall → reproduzierbarer Ablauf
    state = act(state, anna, { type: "settings", bots, wins });
    return act(state, anna, { type: "start" });
}

/** Partie starten und den Countdown ablaufen lassen. */
function running(options) {
    return tick(startMatch(options), NOW + COUNTDOWN_MS);
}

/** Leere Arena, Spieler frei platzieren: [{x, y, dir}] in Reihenfolge von state.players. */
function place(state, spots) {
    const cells = new Array(WIDTH * HEIGHT).fill(EMPTY);
    state.players.forEach((player, i) => {
        Object.assign(player, spots[i], { alive: true, queue: [], crashedAt: null });
        cells[indexOf(player.x, player.y)] = OWNER_CHARS[i];
    });
    state.grid = cells.join("");
    return state;
}

// ===========================================================================
section("Start");
// ===========================================================================
await test("Startpunkte verschieden, in der Arena, Blick zur Mitte", async () => {
    for (let count = 2; count <= 8; count++) {
        const spots = startPositions(count, 0.3);
        assert.equal(new Set(spots.map(s => `${s.x},${s.y}`)).size, count);
        for (const s of spots) {
            assert.ok(s.x >= 0 && s.x < WIDTH && s.y >= 0 && s.y < HEIGHT);
            const toCenter = { x: WIDTH / 2 - s.x, y: HEIGHT / 2 - s.y };
            const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.dir];
            assert.ok(dir[0] * toCenter.x + dir[1] * toCenter.y > 0, `Richtung ${s.dir} zeigt zur Mitte`);
        }
    }
});
await test("Partie startet mit Countdown, Bots mit Namen", async () => {
    const state = startMatch({ bots: 2 });
    assert.equal(state.phase, "countdown");
    assert.equal(state.players.length, 4);
    assert.ok(state.players.filter(p => p.bot).every(p => p.name.startsWith("🤖 ")));
    assert.equal(state.grid.length, WIDTH * HEIGHT);
    assert.equal([...state.grid].filter(c => c !== EMPTY).length, 4, "nur die Startfelder belegt");
    assert.equal(tick(state, NOW + COUNTDOWN_MS - 1).phase, "countdown");
    assert.equal(tick(state, NOW + COUNTDOWN_MS).phase, "running");
});
await test("Allein ohne Bots geht nicht, nur der Host startet", async () => {
    const solo = game.createState({ players: [anna], hostId: anna.id });
    assert.throws(() => game.handleAction(act(solo, anna, { type: "settings", bots: 0 }), { type: "start" }, anna, ctx()), /mindestens 2/);
    const duo = game.createState({ players: [anna, ben], hostId: anna.id });
    assert.throws(() => game.handleAction(duo, { type: "start" }, ben, ctx()), /Host/);
    assert.throws(() => game.handleAction(duo, { type: "settings", wins: 9 }, anna, ctx()), /Siege/);
});

// ===========================================================================
section("Bewegung und Kollisionen");
// ===========================================================================
await test("1 Feld pro Tick, Spur bleibt liegen", async () => {
    let state = place(running(), [{ x: 10, y: 10, dir: "right" }, { x: 50, y: 30, dir: "left" }]);
    state = tick(state, NOW + 5000);
    assert.deepEqual([find(state, anna).x, find(state, anna).y], [11, 10]);
    assert.equal(state.grid[indexOf(10, 10)], "A", "alte Position bleibt Spur");
    assert.equal(state.grid[indexOf(11, 10)], "A");
    assert.deepEqual([find(state, ben).x, find(state, ben).y], [49, 30]);
});
await test("Wand → Crash, der andere gewinnt die Runde", async () => {
    let state = place(running(), [{ x: WIDTH - 1, y: 5, dir: "right" }, { x: 20, y: 20, dir: "left" }]);
    state = tick(state, NOW + 5000);
    assert.equal(find(state, anna).alive, false);
    assert.deepEqual(find(state, anna).crashedAt, { x: WIDTH - 1, y: 5 });
    assert.equal(state.phase, "roundOver");
    assert.equal(state.roundWinner, ben.id);
    assert.equal(find(state, ben).wins, 1);
});
await test("Fremde Spur → Crash", async () => {
    let state = place(running({ players: [anna, ben, cleo] }), [
        { x: 10, y: 10, dir: "right" }, { x: 12, y: 9, dir: "down" }, { x: 40, y: 30, dir: "left" }
    ]);
    // Tick 1: Anna → (11,10), Ben → (12,10). Tick 2: Anna fährt in Bens Spur.
    state = tick(state, NOW + 5000);
    state = tick(state, NOW + 5100);
    assert.equal(find(state, anna).alive, false, "Anna crasht");
    assert.equal(find(state, ben).alive, true, "Ben fährt weiter");
    assert.equal(state.phase, "running");
});
await test("Gleichzeitig ins selbe Feld als Letzte → Unentschieden ohne Punkt", async () => {
    let state = place(running(), [{ x: 10, y: 10, dir: "right" }, { x: 12, y: 10, dir: "left" }]);
    state = tick(state, NOW + 5000);
    assert.equal(find(state, anna).alive, false);
    assert.equal(find(state, ben).alive, false);
    assert.equal(state.roundWinner, null);
    assert.ok(state.players.every(p => p.wins === 0));
});
await test("Eigene Spur → Crash", async () => {
    let state = place(running({ players: [anna, ben, cleo] }), [
        { x: 10, y: 10, dir: "right" }, { x: 50, y: 30, dir: "left" }, { x: 50, y: 5, dir: "left" }
    ]);
    let now = NOW + 5000;
    state = tick(state, now); // (11,10)
    for (const dir of ["down", "left", "up"]) { // (11,11) → (10,11) → (10,10) = eigene Spur
        state = act(state, anna, { type: "turn", dir });
        state = tick(state, now += 100);
    }
    assert.equal(find(state, anna).alive, false, "Kreis in die eigene Spur");
});

// ===========================================================================
section("Steuerung");
// ===========================================================================
await test("Umkehr wird ignoriert, ungültige Richtung abgelehnt", async () => {
    let state = place(running(), [{ x: 10, y: 10, dir: "right" }, { x: 50, y: 30, dir: "left" }]);
    assert.equal(game.handleAction(state, { type: "turn", dir: "left" }, anna, ctx()), undefined, "Umkehr ändert nichts");
    assert.throws(() => game.handleAction(state, { type: "turn", dir: "quer" }, anna, ctx()), /Richtung/);
    state = tick(state, NOW + 5000);
    assert.equal(find(state, anna).dir, "right");
    assert.equal(find(state, anna).alive, true);
});
await test("Zwei schnelle Eingaben wirken über zwei Ticks (Doppelkurve)", async () => {
    let state = place(running(), [{ x: 10, y: 10, dir: "right" }, { x: 50, y: 30, dir: "left" }]);
    state = act(state, anna, { type: "turn", dir: "up" });
    state = act(state, anna, { type: "turn", dir: "left" }); // nach "up" erlaubt
    state = tick(state, NOW + 5000);
    assert.deepEqual([find(state, anna).x, find(state, anna).y, find(state, anna).dir], [10, 9, "up"]);
    state = tick(state, NOW + 5100);
    assert.deepEqual([find(state, anna).x, find(state, anna).y, find(state, anna).dir], [9, 9, "left"]);
});
await test("Im Countdown dreht die Startrichtung sofort", async () => {
    let state = startMatch();
    const self = find(state, anna);
    const turn = { up: "left", left: "down", down: "right", right: "up" }[self.dir];
    state = act(state, anna, { type: "turn", dir: turn });
    assert.equal(find(state, anna).dir, turn);
});

// ===========================================================================
section("Runden und Partie");
// ===========================================================================
await test("Rundenpause, dann neue Runde mit frischer Arena", async () => {
    let state = place(running(), [{ x: 0, y: 5, dir: "left" }, { x: 20, y: 20, dir: "left" }]);
    state = tick(state, NOW + 5000);
    assert.equal(state.phase, "roundOver");
    state = tick(state, NOW + 5000 + ROUND_PAUSE_MS);
    assert.equal(state.phase, "countdown");
    assert.equal(state.round, 2);
    assert.ok(state.players.every(p => p.alive));
    assert.equal([...state.grid].filter(c => c !== EMPTY).length, 2);
});
await test("Partie endet bei der eingestellten Zahl Siege", async () => {
    let state = place(running({ wins: 1 }), [{ x: 0, y: 5, dir: "left" }, { x: 20, y: 20, dir: "left" }]);
    state = tick(state, NOW + 5000);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.winnerId, ben.id);
    assert.deepEqual(state.result.placements, [ben.id, anna.id]);
    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
});
await test("Sicherheitsgrenze: nach 120 s Unentschieden", async () => {
    let state = place(running(), [{ x: 10, y: 10, dir: "right" }, { x: 50, y: 30, dir: "left" }]);
    state.roundTicks = ROUND_MAX_TICKS - 1;
    state = tick(state, NOW + 5000);
    assert.equal(state.phase, "roundOver");
    assert.equal(state.roundWinner, null);
});

// ===========================================================================
section("Bots");
// ===========================================================================
await test("Bots überleben in freier Arena mindestens 100 Ticks", async () => {
    // Feste Startwerte: Mit Zufall schneidet Anna (fährt stur geradeaus) dem Bot in
    // etwa 1 % der Läufe den Weg ab – das ist Spielgeschehen, kein Bot-Fehler.
    for (let run = 0; run < 5; run++) {
        let state = running({ players: [anna], bots: 1, seed: run + 1 });
        // Anna fährt geradeaus und crasht irgendwann – nur den Bot betrachten
        const bot = state.players.find(p => p.bot);
        let now = NOW + COUNTDOWN_MS;
        for (let i = 0; i < 100 && state.phase === "running"; i++) {
            state = tick(state, now += 100);
            if (!find(state, anna).alive) find(state, anna).alive = true, find(state, anna).x = -99; // Anna „parken“
        }
        assert.equal(state.players.find(p => p.id === bot.id).alive, true, `Bot lebt noch (Lauf ${run + 1})`);
    }
});
await test("Partie mit 1 Mensch und 4 Bots endet", async () => {
    let state = startMatch({ players: [anna], bots: 4, wins: 2 });
    let now = NOW;
    for (let i = 0; i < 20000 && state.phase !== "finished"; i++) state = tick(state, now += 100);
    assert.equal(state.phase, "finished", "Partie beendet");
    assert.equal(new Set(state.result.placements).size, 5);
});

// ===========================================================================
section("Verlassen und Sicht");
// ===========================================================================
await test("Spieler verlässt das Spiel → crasht, Runde endet ggf.", async () => {
    let state = running({ players: [anna, ben, cleo] });
    state = game.onPlayerLeave(state, cleo);
    assert.equal(find(state, cleo).alive, false);
    assert.equal(state.phase, "running");
    state = game.onPlayerLeave(state, ben);
    assert.equal(state.phase, "finished", "nur noch 1 Teilnehmer");
});
await test("viewFor: Restzeiten statt Zeitstempel, keine Warteschlange", async () => {
    const state = startMatch();
    const view = game.viewFor(state, anna.id);
    assert.equal(view.phaseEndsAt, undefined);
    assert.equal(view.rng, undefined);
    assert.ok(view.countdownMs > 0 && view.countdownMs <= COUNTDOWN_MS || view.countdownMs === 0);
    assert.ok(view.players.every(p => !("queue" in p)));
});

process.exit(summary());
