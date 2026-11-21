/**
 * Logik-Test für Bomben-Labyrinth – lädt games/bombenlabyrinth/game.js direkt
 * (ohne Server) und prüft Arena, Bewegung, Bomben, Explosionen, Power-ups,
 * Schrumpfen, Runden, Partie-Ende, Bots und die Sicht für den Client.
 *
 * Start:  npm run test:bombenlabyrinth   bzw.  node tests/bombenlabyrinth.test.mjs
 * Dauer:  ca. 2 Sekunden
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "bombenlabyrinth", "game.js"));
const {
    WIDTH, HEIGHT, WALL, CRATE, EMPTY, TICK_MS, COUNTDOWN_MS, ROUND_PAUSE_MS, STEP_TICKS, FUSE_TICKS, FLAME_TICKS,
    SUDDEN_DEATH_TICKS, SHRINK_EVERY_TICKS, ROUND_MAX_TICKS, MAX_RANGE, MAX_SPEED, SPAWNS, SPIRAL, indexOf, isPillar
} = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const NOW = 1_000_000;
const ctx = (now = NOW) => ({ hostId: anna.id, now });
const act = (state, player, action, now = NOW) => game.handleAction(state, action, player, ctx(now)) ?? state;
const find = (state, player) => state.players.find(p => p.id === player.id);
const cellAt = (state, x, y) => state.grid[indexOf(x, y)];

/** Uhr für die Tests: jeder Tick schiebt die Zeit um TICK_MS weiter. */
let clock = NOW;
const tick = state => {
    clock += TICK_MS;
    return game.tick(state, { now: clock }) ?? state;
};
const ticks = (state, count) => {
    for (let i = 0; i < count; i++) state = tick(state);
    return state;
};

function startMatch({ players = [anna, ben], bots = 0, wins = 3 } = {}) {
    let state = game.createState({ players, hostId: anna.id });
    state = act(state, anna, { type: "settings", bots, wins });
    return act(state, anna, { type: "start" });
}

/** Partie starten und den Countdown ablaufen lassen. */
function running(options) {
    clock = NOW + COUNTDOWN_MS;
    return game.tick(startMatch(options), { now: clock });
}

/** Arena ohne Kisten; Spieler frei platzieren ([{x, y}] in Reihenfolge von state.players), extra Felder setzen. */
function arena(state, spots, extra = {}) {
    const cells = [];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) cells.push(isPillar(x, y) ? WALL : EMPTY);
    for (const [key, value] of Object.entries(extra)) {
        const [x, y] = key.split(",").map(Number);
        cells[indexOf(x, y)] = value;
    }
    state.grid = cells.join("");
    state.hidden = {};
    state.bombs = [];
    state.flames = [];
    state.players.forEach((player, i) => {
        Object.assign(player, { x: spots[i][0], y: spots[i][1], held: null, cooldown: 0, alive: true, diedAt: null });
    });
    return state;
}

// ===========================================================================
section("Arena und Start");
// ===========================================================================
await test("Arena: Rand und Säulen sind Wände, Startbereiche frei", async () => {
    for (let n = 2; n <= 8; n++) {
        const players = [anna];
        const state = startMatch({ players, bots: n - 1 });
        assert.equal(state.grid.length, WIDTH * HEIGHT);
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (isPillar(x, y)) assert.equal(cellAt(state, x, y), WALL, `Wand bei ${x},${y}`);
                else assert.notEqual(cellAt(state, x, y), WALL);
            }
        }
        for (const p of state.players) {
            for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const c = cellAt(state, p.x + dx, p.y + dy);
                assert.ok(c === EMPTY || c === WALL, `um ${p.name} frei`);
            }
        }
        assert.equal(new Set(state.players.map(p => `${p.x},${p.y}`)).size, n, "verschiedene Startplätze");
        for (const index of Object.keys(state.hidden)) assert.equal(state.grid[index], CRATE, "Power-ups nur unter Kisten");
    }
    assert.ok(SPAWNS.every(([x, y]) => !isPillar(x, y)));
});
await test("Partie startet mit Countdown, Bots mit Namen", async () => {
    const state = startMatch({ bots: 2 });
    assert.equal(state.phase, "countdown");
    assert.equal(state.players.length, 4);
    assert.ok(state.players.filter(p => p.bot).every(p => p.name.startsWith("🤖 ")));
    assert.ok([...state.grid].filter(c => c === CRATE).length > 30, "viele Kisten");
    assert.equal(game.tick(state, { now: NOW + COUNTDOWN_MS - 1 }), undefined);
    assert.equal(game.tick(state, { now: NOW + COUNTDOWN_MS }).phase, "running");
});
await test("Einstellungen und Start nur für den Host, Grenzen geprüft", async () => {
    const state = game.createState({ players: [anna, ben], hostId: anna.id });
    assert.throws(() => game.handleAction(state, { type: "start" }, ben, ctx()), /Host/);
    assert.throws(() => game.handleAction(state, { type: "settings", bots: 8 }, anna, ctx()), /Bots/);
    assert.throws(() => game.handleAction(state, { type: "settings", wins: 0 }, anna, ctx()), /Siege/);
    const alone = game.createState({ players: [anna], hostId: anna.id });
    const noBots = act(alone, anna, { type: "settings", bots: 0 });
    assert.throws(() => game.handleAction(noBots, { type: "start" }, anna, ctx()), /mindestens 2/);
    assert.throws(() => game.handleAction(state, { type: "fly" }, anna, ctx()), /Unbekannte Aktion/);
});
await test("Im Countdown: keine Bomben, aber Richtung wird gemerkt", async () => {
    let state = startMatch();
    assert.equal(game.handleAction(state, { type: "bomb" }, anna, ctx()), undefined);
    state = act(state, anna, { type: "move", dir: "right" });
    assert.equal(find(state, anna).held, "right");
    assert.throws(() => game.handleAction(state, { type: "move", dir: "diagonal" }, anna, ctx()), /Richtung/);
});

// ===========================================================================
section("Bewegung");
// ===========================================================================
await test("Taste halten: sofort ein Feld, dann alle STEP_TICKS ein Feld; Loslassen stoppt", async () => {
    let state = arena(running(), [[1, 1], [13, 11]]);
    state = act(state, anna, { type: "move", dir: "right" });
    state = tick(state);
    assert.equal(find(state, anna).x, 2, "erster Schritt sofort");
    state = ticks(state, STEP_TICKS[0] - 1);
    assert.equal(find(state, anna).x, 2);
    state = tick(state);
    assert.equal(find(state, anna).x, 3, "nach STEP_TICKS das nächste Feld");
    state = act(state, anna, { type: "move", dir: null });
    state = ticks(state, 20);
    assert.equal(find(state, anna).x, 3, "steht nach dem Loslassen");
    assert.equal(find(state, anna).facing, "right");
});
await test("Wände, Kisten und fremde Bomben blockieren", async () => {
    let state = arena(running(), [[1, 1], [3, 3]], { "1,2": CRATE });
    state = act(state, anna, { type: "move", dir: "up" });
    state = ticks(state, 8);
    assert.deepEqual([find(state, anna).x, find(state, anna).y], [1, 1], "Randwand");
    state = act(state, anna, { type: "move", dir: "down" });
    state = ticks(state, 8);
    assert.equal(find(state, anna).y, 1, "Kiste");
    // Ben legt eine Bombe auf (3,3), geht weg; Anna kommt nicht hindurch
    state = act(state, ben, { type: "bomb" });
    state = act(state, ben, { type: "move", dir: "down" });
    state = ticks(state, 2);
    assert.equal(find(state, ben).y, 4, "Ben verlässt seine eigene Bombe");
    state = act(state, ben, { type: "move", dir: "up" });
    state = ticks(state, 8);
    assert.equal(find(state, ben).y, 4, "zurück auf die Bombe geht nicht");
});
await test("Tempo-Power-up verkürzt den Schrittabstand", async () => {
    let state = arena(running(), [[1, 1], [13, 11]], { "2,1": "s" });
    state = act(state, anna, { type: "move", dir: "right" });
    state = tick(state);
    assert.equal(find(state, anna).speed, 1, "eingesammelt");
    assert.equal(cellAt(state, 2, 1), EMPTY, "Power-up weg");
    state = ticks(state, STEP_TICKS[0]);
    assert.equal(find(state, anna).x, 3, "der laufende Schritt hat noch das alte Tempo");
    state = ticks(state, STEP_TICKS[1] - 1);
    assert.equal(find(state, anna).x, 3);
    state = tick(state);
    assert.equal(find(state, anna).x, 4, "danach der kürzere Abstand");
});

// ===========================================================================
section("Bomben und Explosionen");
// ===========================================================================
await test("Bombe legen: höchstens so viele wie erlaubt, nicht zwei auf ein Feld", async () => {
    let state = arena(running(), [[1, 1], [13, 11]]);
    state = act(state, anna, { type: "bomb" });
    assert.equal(state.bombs.length, 1);
    assert.equal(game.handleAction(state, { type: "bomb" }, anna, ctx()), undefined, "Limit 1");
    find(state, anna).bombs = 2;
    assert.equal(game.handleAction(state, { type: "bomb" }, anna, ctx()), undefined, "Feld schon belegt");
    find(state, anna).x = 2;
    state = act(state, anna, { type: "bomb" });
    assert.equal(state.bombs.length, 2);
});
await test("Explosion nach der Zündschnur: Reichweite, Wände stoppen, Kiste stoppt und verschwindet", async () => {
    let state = arena(running(), [[13, 11], [13, 9]], { "5,3": CRATE, "7,3": CRATE });
    state.hidden[indexOf(5, 3)] = "r";
    state.bombs.push({ x: 3, y: 3, owner: anna.id, range: 3, fuse: FUSE_TICKS });
    state = ticks(state, FUSE_TICKS - 1);
    assert.equal(state.bombs.length, 1, "noch nicht explodiert");
    state = tick(state);
    assert.equal(state.bombs.length, 0);
    const burning = new Set(state.flames.flatMap(f => f.cells));
    for (const [x, y] of [[3, 3], [4, 3], [5, 3], [2, 3], [1, 3], [3, 4], [3, 5], [3, 6], [3, 2], [3, 1]]) {
        assert.ok(burning.has(indexOf(x, y)), `Flamme bei ${x},${y}`);
    }
    assert.ok(!burning.has(indexOf(6, 3)), "Kiste stoppt den Strahl");
    assert.ok(!burning.has(indexOf(0, 3)), "Wand wird nicht entflammt");
    assert.ok(!burning.has(indexOf(4, 4)), "nicht diagonal");
    assert.equal(cellAt(state, 5, 3), "r", "verstecktes Power-up aufgedeckt");
    assert.equal(cellAt(state, 7, 3), CRATE, "Kiste dahinter bleibt");
    assert.equal(state.hidden[indexOf(5, 3)], undefined);
    state = ticks(state, FLAME_TICKS);
    assert.equal(state.flames.length, 0, "Flammen verglühen");
});
await test("Kettenreaktion: getroffene Bombe explodiert sofort mit", async () => {
    let state = arena(running(), [[13, 11], [13, 9]]);
    state.bombs.push({ x: 1, y: 1, owner: anna.id, range: 2, fuse: 5 });
    state.bombs.push({ x: 3, y: 1, owner: ben.id, range: 2, fuse: FUSE_TICKS });
    state = ticks(state, 5);
    assert.equal(state.bombs.length, 0, "beide explodiert");
    assert.ok(state.flames.flatMap(f => f.cells).includes(indexOf(5, 1)), "Strahl der zweiten Bombe");
});
await test("Liegende Power-ups verbrennen in der Explosion", async () => {
    let state = arena(running(), [[13, 11], [13, 9]], { "3,1": "b" });
    state.bombs.push({ x: 1, y: 1, owner: anna.id, range: 3, fuse: 1 });
    state = tick(state);
    assert.equal(cellAt(state, 3, 1), EMPTY);
    assert.ok(!state.flames.flatMap(f => f.cells).includes(indexOf(4, 1)), "Power-up stoppt den Strahl");
});
await test("Wer in der Flamme steht oder hineinläuft, scheidet aus – Letzter gewinnt die Runde", async () => {
    let state = arena(running({ players: [anna, ben, cleo] }), [[1, 1], [5, 1], [13, 11]]);
    state.bombs.push({ x: 2, y: 1, owner: cleo.id, range: 1, fuse: 1 });
    state = tick(state);
    assert.equal(find(state, anna).alive, false, "Anna steht im Strahl");
    assert.deepEqual(find(state, anna).diedAt, { x: 1, y: 1 });
    assert.equal(find(state, ben).alive, true);
    // Ben läuft in die noch brennende Flamme (3,1)
    state = act(state, ben, { type: "move", dir: "left" });
    state = ticks(state, STEP_TICKS[0] * 2 + 1);
    assert.equal(find(state, ben).alive, false, "in die Flamme gelaufen");
    assert.equal(state.phase, "roundOver");
    assert.equal(state.roundWinner, cleo.id);
    assert.equal(find(state, cleo).wins, 1);
});
await test("Gleichzeitig erwischt → Unentschieden", async () => {
    let state = arena(running(), [[1, 1], [3, 1]]);
    state.bombs.push({ x: 2, y: 1, owner: anna.id, range: 1, fuse: 1 });
    state = tick(state);
    assert.equal(state.phase, "roundOver");
    assert.equal(state.roundWinner, null);
    assert.ok(state.players.every(p => p.wins === 0));
});

// ===========================================================================
section("Power-ups");
// ===========================================================================
await test("Reichweite und Bomben steigen bis zum Maximum", async () => {
    let state = arena(running(), [[1, 1], [13, 11]]);
    const me = find(state, anna);
    me.range = MAX_RANGE;
    me.speed = MAX_SPEED;
    state.grid = state.grid.slice(0, indexOf(2, 1)) + "r" + "b" + "s" + state.grid.slice(indexOf(5, 1));
    state = act(state, anna, { type: "move", dir: "right" });
    state = ticks(state, 12);
    const after = find(state, anna);
    assert.equal(after.range, MAX_RANGE, "Reichweite gedeckelt");
    assert.equal(after.bombs, 2, "eine Bombe mehr");
    assert.equal(after.speed, MAX_SPEED, "Tempo gedeckelt");
    assert.ok(!/[rbs]/.test(state.grid), "alle eingesammelt");
});

// ===========================================================================
section("Schrumpfen, Zeitlimit und Partie");
// ===========================================================================
await test("Nach SUDDEN_DEATH_TICKS schrumpft die Arena spiralförmig – wer dort steht, scheidet aus", async () => {
    assert.equal(new Set(SPIRAL).size, SPIRAL.length);
    assert.ok(SPIRAL.every(i => !isPillar(i % WIDTH, Math.floor(i / WIDTH))));
    assert.equal(SPIRAL[0], indexOf(1, 1), "beginnt außen oben links");
    let state = arena(running({ players: [anna, ben, cleo] }), [[1, 1], [5, 5], [7, 7]]);
    state.roundTicks = SUDDEN_DEATH_TICKS - 1;
    state = tick(state);
    assert.equal(state.grid[SPIRAL[0]], WALL);
    assert.equal(find(state, anna).alive, false, "Anna stand auf dem ersten Feld");
    assert.ok(state.log.some(l => l.includes("schrumpft")));
    state = ticks(state, SHRINK_EVERY_TICKS);
    assert.equal(state.grid[SPIRAL[1]], WALL, "nächstes Feld");
    assert.equal(state.grid[SPIRAL[2]], EMPTY, "noch nicht");
});
await test("Zeitlimit → Unentschieden", async () => {
    let state = arena(running(), [[7, 5], [7, 7]]);
    state.roundTicks = ROUND_MAX_TICKS - 1;
    state.shrinkIndex = SPIRAL.length; // Schrumpfen überspringen
    state = tick(state);
    assert.equal(state.phase, "roundOver");
    assert.equal(state.roundWinner, null);
});
await test("Nach der Pause neue Runde; wer zuerst die Siege hat, gewinnt die Partie", async () => {
    let state = arena(running({ wins: 2 }), [[1, 1], [5, 1]]);
    state.bombs.push({ x: 1, y: 1, owner: anna.id, range: 1, fuse: 1 });
    state = tick(state);
    assert.equal(state.roundWinner, ben.id);
    clock += ROUND_PAUSE_MS;
    state = tick(state);
    assert.equal(state.phase, "countdown");
    assert.equal(state.round, 2);
    assert.ok(state.players.every(p => p.alive && p.bombs === 1 && p.range === 2 && p.speed === 0), "Power-ups zurückgesetzt");
    clock += COUNTDOWN_MS;
    state = tick(state);
    state = arena(state, [[1, 1], [5, 1]]);
    state.bombs.push({ x: 1, y: 1, owner: anna.id, range: 1, fuse: 1 });
    state = tick(state);
    assert.equal(state.phase, "finished");
    assert.deepEqual(state.result, { winnerId: ben.id, placements: [ben.id, anna.id] });
    assert.throws(() => game.handleAction(state, { type: "new-match" }, ben, ctx()), /Host/);
    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
    assert.equal(state.players.length, 0);
});

// ===========================================================================
section("Bots");
// ===========================================================================
await test("Bot sprengt eine Kiste und bringt sich vor der eigenen Bombe in Sicherheit", async () => {
    let state = running({ players: [anna], bots: 1 });
    const bot = state.players.find(p => p.bot);
    state = arena(state, [[13, 11], [1, 1]], { "3,1": CRATE, "1,3": CRATE, "1,4": CRATE, "4,1": CRATE });
    state = ticks(state, FUSE_TICKS + 30);
    assert.equal(cellAt(state, 3, 1) === CRATE && cellAt(state, 1, 3) === CRATE, false, "mindestens eine Kiste gesprengt");
    assert.equal(state.players.find(p => p.id === bot.id).alive, true, "Bot lebt");
});
await test("Bot flieht vor einer fremden Bombe", async () => {
    let state = running({ players: [anna], bots: 1 });
    const bot = state.players.find(p => p.bot);
    state = arena(state, [[13, 11], [5, 5]]);
    state.bombs.push({ x: 5, y: 3, owner: anna.id, range: 4, fuse: 20 });
    state = ticks(state, 30);
    assert.equal(state.players.find(p => p.id === bot.id).alive, true);
});
await test("Nur-Bot-Runden: Bots überleben lange, keine Ausnahmen, Ticks schnell", async () => {
    const started = performance.now();
    let totalTicks = 0;
    for (let round = 0; round < 3; round++) {
        let state = running({ players: [anna], bots: 7, wins: 1 });
        state = game.onPlayerLeave(structuredClone(state), { id: "niemand" }); // ändert nichts
        let n = 0;
        while (state.phase === "running" && n < ROUND_MAX_TICKS + 10) {
            state = tick(state);
            n++;
        }
        totalTicks += n;
        assert.notEqual(state.phase, "running", "Runde endet");
        assert.ok(n > 200, `Runde dauert ${n} Ticks – Bots sprengen sich nicht sofort selbst`);
    }
    const perTick = (performance.now() - started) / totalTicks;
    assert.ok(perTick < 5, `${perTick.toFixed(2)} ms pro Tick`);
});

// ===========================================================================
section("Verlassen und Sicht");
// ===========================================================================
await test("Spieler verlässt das Spiel → scheidet aus, Partie endet ohne Menschen", async () => {
    let state = running({ players: [anna, ben, cleo] });
    state = game.onPlayerLeave(state, cleo);
    assert.equal(find(state, cleo).alive, false);
    assert.equal(find(state, cleo).left, true);
    assert.equal(state.phase, "running");
    state = game.onPlayerLeave(state, ben);
    assert.equal(state.phase, "finished", "nur noch 1 Teilnehmer");
});
await test("viewFor: keine versteckten Power-ups, Restzeiten statt Zeitstempel", async () => {
    const counting = startMatch();
    const view = game.viewFor(counting, anna.id);
    assert.equal(view.hidden, undefined);
    assert.equal(view.rng, undefined);
    assert.equal(view.phaseEndsAt, undefined);
    assert.ok(view.countdownMs >= 0 && view.countdownMs <= COUNTDOWN_MS);
    const run = game.viewFor(running(), anna.id);
    assert.equal(run.suddenDeathInMs, (SUDDEN_DEATH_TICKS - run.roundTicks) * TICK_MS);
    assert.ok(run.players.every(p => !("cooldown" in p) && p.stepMs === STEP_TICKS[0] * TICK_MS));
    assert.doesNotThrow(() => JSON.stringify(run));
});

process.exit(summary());
