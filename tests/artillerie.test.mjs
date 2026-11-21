/**
 * Logik-Test für das Artillerie-Duell – lädt games/artillerie/game.js direkt
 * (ohne Server) und prüft Gelände, Krater, Flugbahnen, Waffen, Schaden, Fahren,
 * Zielphase, gleichzeitige Salven, Runden, Partie-Ende, Bots und die Sicht.
 *
 * Start:  npm run test:artillerie   bzw.  node tests/artillerie.test.mjs
 * Dauer:  ca. 3 Sekunden
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "artillerie", "game.js"));
const {
    WIDTH, COLS, WIND_MAX, TANK_HALF, TANK_HEIGHT, START_HP, FUEL, MOVE_STEP, FALL_SAFE, WEAPONS, START_AMMO, MAX_VOLLEYS, AIM_MS,
    FLIGHT_PAD_MS, ROUND_PAUSE_MS, BOT_READY_MAX_MS,
    createRng, restY, generateTerrain, carve, simulateShot, resolveVolley, blastDamage, settleTanks, searchShot, botPlan
} = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const NOW = 1_000_000;
const ctx = (now = NOW) => ({ hostId: anna.id, now });
const act = (state, player, action, now = NOW) => game.handleAction(state, action, player, ctx(now)) ?? state;
const find = (state, player) => state.players.find(p => p.id === player.id);
const flat = (height = 100) => new Array(COLS).fill(height);

function startMatch({ players = [anna, ben], bots = 0, wins = 3 } = {}) {
    let state = game.createState({ players, hostId: anna.id });
    state = act(state, anna, { type: "settings", bots, wins });
    return act(state, anna, { type: "start" });
}

/** Flaches Gelände, Panzer an festen Stellen, kein Wind. */
function arena(state, xs, heights = flat()) {
    state.heights = heights;
    state.wind = 0;
    state.players.forEach((player, i) => Object.assign(player, { x: xs[i], y: restY(heights, xs[i]), hp: START_HP, alive: true, ready: false }));
    return state;
}

/** Kraft suchen, mit der ein Schuss unter dem Winkel möglichst nah bei targetX einschlägt. */
function powerFor(heights, tanks, tank, angle, targetX, weapon = "granate") {
    let best = { power: 50, miss: Infinity };
    for (let power = 10; power <= 100; power += 0.25) {
        const { impact } = simulateShot(heights, tanks, tank, angle, power, weapon, 0);
        if (impact && Math.abs(impact.x - targetX) < best.miss) best = { power, miss: Math.abs(impact.x - targetX) };
    }
    return best.power;
}

/** Bis zum Ende der Flugphase weiterticken. */
function finishFlight(state) {
    assert.equal(state.phase, "flight");
    return game.tick(state, { now: NOW + 10 * 60_000 }) ?? state;
}

// ===========================================================================
section("Gelände und Start");
// ===========================================================================
await test("Gelände: richtige Länge, in Grenzen, eben unter den Startplätzen", async () => {
    for (let seed = 1; seed <= 20; seed++) {
        const xs = [120, 400, 680];
        const heights = generateTerrain(createRng(seed), xs);
        assert.equal(heights.length, COLS);
        assert.ok(heights.every(h => Number.isInteger(h) && h >= 60 && h <= 300));
        for (const x of xs) assert.equal(restY(heights, x - 4), restY(heights, x + 4), "Plateau");
    }
});
await test("Partie startet in der Zielphase, Panzer stehen auf dem Boden, Wind in Grenzen", async () => {
    const state = startMatch({ bots: 2 });
    assert.equal(state.phase, "aiming");
    assert.equal(state.volley, 1);
    assert.equal(state.players.length, 4);
    assert.ok(state.players.filter(p => p.bot).every(p => p.name.startsWith("🤖 ") && p.traits));
    assert.ok(Math.abs(state.wind) <= WIND_MAX);
    for (const p of state.players) {
        assert.equal(p.y, restY(state.heights, p.x));
        assert.deepEqual(p.ammo, START_AMMO);
        assert.equal(p.fuel, p.bot ? p.fuel : FUEL, "Menschen mit vollem Tank (Bots fahren evtl. schon)");
        assert.ok(p.fuel >= 0 && p.fuel <= FUEL);
    }
    assert.equal(new Set(state.players.map(p => p.x)).size, 4);
});
await test("Einstellungen und Start nur für den Host, Grenzen geprüft", async () => {
    const state = game.createState({ players: [anna, ben], hostId: anna.id });
    assert.throws(() => game.handleAction(state, { type: "start" }, ben, ctx()), /Host/);
    assert.throws(() => game.handleAction(state, { type: "settings", bots: 6 }, anna, ctx()), /Bots/);
    assert.throws(() => game.handleAction(state, { type: "settings", wins: 9 }, anna, ctx()), /Siege/);
    const alone = act(game.createState({ players: [anna], hostId: anna.id }), anna, { type: "settings", bots: 0 });
    assert.throws(() => game.handleAction(alone, { type: "start" }, anna, ctx()), /mindestens 2/);
    assert.throws(() => game.handleAction(state, { type: "warp" }, anna, ctx()), /Unbekannte Aktion/);
});

// ===========================================================================
section("Krater und Flugbahn");
// ===========================================================================
await test("Krater: Kreis wird aus dem Gelände entfernt, Material darüber rutscht nach", async () => {
    const heights = flat(100);
    carve(heights, 400, 100, 30);
    assert.equal(heights[200], 70, "Mitte 30 tiefer");
    assert.ok(heights[212] > 70 && heights[212] < 100, "zum Rand flacher");
    assert.equal(heights[230], 100, "außerhalb unverändert");
    const high = flat(200);
    carve(high, 400, 100, 30);
    assert.equal(high[200], 140, "Säule darüber rutscht um den Kreisdurchmesser");
    const low = flat(50);
    carve(low, 400, 100, 30);
    assert.equal(low[200], 50, "Kreis über dem Boden ändert nichts");
});
await test("Flugbahn: senkrecht zurück, Wind schiebt, mehr Kraft fliegt weiter", async () => {
    const heights = flat(100);
    const tank = { id: "a", x: 400, alive: true };
    const up = simulateShot(heights, [tank], tank, 90, 50, "granate", 0);
    assert.ok(up.impact && Math.abs(up.impact.x - 400) < 2, "landet wieder am Start");
    const windy = simulateShot(heights, [tank], tank, 90, 50, "granate", WIND_MAX);
    assert.ok(windy.impact.x > 430, `Wind nach rechts: ${windy.impact.x.toFixed(0)}`);
    const short = simulateShot(heights, [], tank, 45, 40, "granate", 0);
    const long = simulateShot(heights, [], tank, 45, 60, "granate", 0);
    assert.ok(long.impact.x > short.impact.x + 50, "mehr Kraft → weiter");
    const away = simulateShot(heights, [], { id: "a", x: 780 }, 20, 100, "granate", 0);
    assert.equal(away.impact, null, "seitlich aus der Welt → weg");
});
await test("Treffer am Rumpf eines anderen Panzers", async () => {
    const heights = flat(100);
    const shooter = { id: "a", x: 200, alive: true };
    const target = { id: "b", x: 500, alive: true };
    const best = searchShot({ heights, wind: 0 }, { ...shooter, y: 100 }, { ...target, y: 100, hp: 100 }, "granate", [shooter, target]);
    assert.equal(best.miss, 0, "Suche findet einen Volltreffer");
    const { impact } = simulateShot(heights, [shooter, target], shooter, best.angle, best.power, "granate", 0);
    assert.equal(impact.tankId, "b");
});
await test("Schaden nimmt zum Rand hin ab", async () => {
    const heights = flat(100);
    const tank = { x: 400, y: 100 };
    const { radius, damage } = WEAPONS.granate;
    assert.equal(blastDamage(tank, heights, 400, 100 + TANK_HEIGHT / 2, radius, damage), damage);
    const mid = blastDamage(tank, heights, 400 + (radius + TANK_HALF) / 2, 105, radius, damage);
    assert.ok(mid > damage * 0.4 && mid < damage * 0.6, `halber Abstand ≈ halber Schaden (${mid})`);
    assert.equal(blastDamage(tank, heights, 400 + radius + TANK_HALF, 105, radius, damage), 0);
});
await test("Fallschaden erst ab FALL_SAFE", async () => {
    const heights = flat(100);
    const tanks = [{ id: "a", x: 200, y: 100 + FALL_SAFE, hp: 100 }, { id: "b", x: 600, y: 160, hp: 100 }];
    const falls = settleTanks(heights, tanks);
    assert.equal(tanks[0].hp, 100, "bis FALL_SAFE kein Schaden");
    assert.equal(tanks[1].hp, 100 - (60 - FALL_SAFE) / 2);
    assert.deepEqual(falls.map(f => [f.id, f.toY, f.damage]), [["a", 100, 0], ["b", 100, 20]]);
});

// ===========================================================================
section("Waffen");
// ===========================================================================
await test("Splitter zerplatzt in 5 Splitter, die eigene Explosionen auslösen", async () => {
    const heights = flat(100);
    const tanks = [{ id: "a", x: 200, alive: true }];
    const result = resolveVolley(heights, tanks, [{ owner: "a", angle: 60, power: 55, weapon: "splitter" }], 0);
    assert.equal(result.shots.length, 1 + WEAPONS.splitter.fragments);
    assert.equal(result.shots.filter(s => s.fragment).length, WEAPONS.splitter.fragments);
    assert.ok(result.explosions.length >= 4, `${result.explosions.length} Explosionen`);
    assert.ok(result.shots.filter(s => s.fragment).every(s => s.t0 > 0));
});
await test("Bohrer durchschlägt einen Hügel, die Granate nicht", async () => {
    const heights = flat(100);
    for (let i = 100; i < 120; i++) heights[i] = 170;     // Hügel bei x 200–240
    const shooter = { id: "a", x: 100, alive: true };
    const grenade = simulateShot(heights, [], shooter, 25, 75, "granate", 0);
    const drill = simulateShot(heights, [], shooter, 25, 75, "bohrer", 0);
    assert.ok(grenade.impact.x < 215, `Granate am Hang: ${grenade.impact.x.toFixed(0)}`);
    assert.ok(drill.impact.x > grenade.impact.x + 20, `Bohrer weiter: ${drill.impact.x.toFixed(0)}`);
    const copy = [...heights];
    const result = resolveVolley(copy, [{ ...shooter }], [{ owner: "a", angle: 25, power: 75, weapon: "bohrer" }], 0);
    assert.ok(result.carves.length > 3, "gräbt einen Kanal");
    assert.ok(copy[105] < 170, "Hügel angebohrt");
});
await test("Munition: Spezialwaffen verbrauchen sich, Granate unbegrenzt, leer → Fehler", async () => {
    let state = arena(startMatch(), [200, 600]);
    state = act(state, anna, { type: "aim", weapon: "splitter", angle: 135, power: 100 });
    state = act(state, ben, { type: "ready", weapon: "granate", angle: 45, power: 100 });
    state = act(state, anna, { type: "ready" });
    assert.equal(state.phase, "flight");
    assert.equal(find(state, anna).ammo.splitter, START_AMMO.splitter - 1);
    find(state, anna).ammo.splitter = 0;
    state = finishFlight(state);
    assert.equal(find(state, anna).weapon, "granate", "leere Waffe → zurück zur Granate");
    assert.throws(() => game.handleAction(state, { type: "aim", weapon: "splitter" }, anna, ctx()), /Munition/);
    assert.throws(() => game.handleAction(state, { type: "aim", weapon: "laser" }, anna, ctx()), /Waffe/);
});

// ===========================================================================
section("Fahren und Zielphase");
// ===========================================================================
await test("Fahren kostet Treibstoff, steile Hänge und der Weltrand stoppen", async () => {
    let state = arena(startMatch(), [400, 700]);
    state = act(state, anna, { type: "move", dir: 1 });
    assert.equal(find(state, anna).x, 400 + MOVE_STEP);
    assert.equal(find(state, anna).fuel, FUEL - 1);
    for (let i = 0; i < 20; i++) state = act(state, anna, { type: "move", dir: -1 });
    assert.equal(find(state, anna).fuel, 0, "Tank leer");
    assert.equal(game.handleAction(state, { type: "move", dir: -1 }, anna, ctx()), undefined);

    state = arena(startMatch(), [400, 700]);
    for (let i = 206; i < 230; i++) state.heights[i] = 160;     // Wand rechts
    assert.equal(game.handleAction(state, { type: "move", dir: 1 }, anna, ctx()), undefined, "zu steil");
    state = arena(startMatch(), [TANK_HALF, 700]);   // ganz links
    assert.equal(game.handleAction(state, { type: "move", dir: -1 }, anna, ctx()), undefined, "Weltrand");
    assert.throws(() => game.handleAction(state, { type: "move", dir: 3 }, anna, ctx()), /Richtung/);
});
await test("Zielphase endet, sobald alle bereit sind – oder nach Ablauf mit den letzten Werten", async () => {
    let state = arena(startMatch(), [200, 600]);
    state = act(state, anna, { type: "ready", angle: 135, power: 100 });
    assert.equal(state.phase, "aiming");
    assert.equal(game.handleAction(state, { type: "aim", angle: 10 }, anna, ctx()), undefined, "bereit → keine Änderung");
    state = act(state, anna, { type: "ready", ready: false });
    assert.equal(find(state, anna).ready, false, "Bereitschaft zurücknehmen");
    state = act(state, ben, { type: "aim", angle: 77, power: 33 });
    assert.equal(game.tick(state, { now: NOW + AIM_MS - 1 }), undefined);
    state = game.tick(state, { now: NOW + AIM_MS });
    assert.equal(state.phase, "flight", "Zeit abgelaufen");
    const shot = state.flight.shots.find(s => s.owner === ben.id);
    assert.ok(shot, "Ben schießt trotzdem");
    assert.equal(find(state, ben).angle, 77);
    state = finishFlight(state);
    assert.equal(state.phase, "aiming");
    assert.equal(state.volley, 2);
    assert.ok(state.players.every(p => !p.ready && p.fuel === FUEL));
});
await test("Flugphase dauert Animation + Pause", async () => {
    let state = arena(startMatch(), [200, 600]);
    state = act(state, anna, { type: "ready", angle: 135, power: 100 });
    state = act(state, ben, { type: "ready", angle: 45, power: 100 });
    const { durationMs } = state.flight;
    assert.ok(durationMs > 500 && durationMs < 15_000);
    assert.equal(game.tick(state, { now: NOW + durationMs + FLIGHT_PAD_MS - 1 }), undefined);
    assert.equal(game.tick(state, { now: NOW + durationMs + FLIGHT_PAD_MS }).phase, "aiming");
});

// ===========================================================================
section("Gleichzeitige Salve, Runden, Partie");
// ===========================================================================
await test("Gegenseitiger Volltreffer → beide zerstört → Unentschieden", async () => {
    let state = arena(startMatch(), [250, 550]);
    for (const p of state.players) p.hp = 10;
    const tanks = state.players.map(p => ({ id: p.id, x: p.x, y: p.y, alive: true }));
    const aimA = searchShot(state, find(state, anna), find(state, ben), "granate", tanks);
    const aimB = searchShot(state, find(state, ben), find(state, anna), "granate", tanks);
    state = act(state, anna, { type: "ready", angle: aimA.angle, power: aimA.power });
    state = act(state, ben, { type: "ready", angle: aimB.angle, power: aimB.power });
    assert.ok(state.players.every(p => !p.alive && p.hp === 0));
    state = finishFlight(state);
    assert.equal(state.phase, "roundOver");
    assert.equal(state.roundWinner, null);
});
await test("Späterer Einschlag trifft auf das schon gesprengte Gelände", async () => {
    const heights = flat(100);
    const a = { id: "a", x: 300, alive: true };
    const b = { id: "b", x: 520, alive: true };
    const fast = powerFor(heights, [], a, 45, 400);
    const slow = powerFor(heights, [], b, 105, 400);
    const result = resolveVolley(heights, [a, b], [
        { owner: "a", angle: 45, power: fast, weapon: "granate" },
        { owner: "b", angle: 105, power: slow, weapon: "granate" }
    ], 0);
    const [first, second] = [...result.explosions].sort((x, y) => x.t - y.t);
    assert.ok(second.t > first.t);
    assert.ok(second.y < 90, `zweiter Einschlag tiefer im Krater (y=${second.y})`);
});
await test("Nach der letzten Salve gewinnt, wer die meisten Trefferpunkte hat", async () => {
    let state = arena(startMatch(), [200, 600]);
    state.volley = MAX_VOLLEYS;
    find(state, anna).hp = 80;
    find(state, ben).hp = 50;
    state = act(state, anna, { type: "ready", angle: 135, power: 100 });
    state = act(state, ben, { type: "ready", angle: 45, power: 100 });
    state = finishFlight(state);
    assert.equal(state.roundWinner, anna.id);
    assert.equal(find(state, anna).wins, 1);
    assert.equal(state.phase, "roundOver");
    state = game.tick(state, { now: NOW + 10 * 60_000 + ROUND_PAUSE_MS });
    assert.equal(state.phase, "aiming");
    assert.equal(state.round, 2);
    assert.ok(state.players.every(p => p.alive && p.hp === START_HP && p.ammo.splitter === START_AMMO.splitter));
});
await test("Partie-Ende mit Platzierungen, neue Partie nur durch den Host", async () => {
    let state = arena(startMatch({ wins: 1 }), [200, 600]);
    find(state, ben).hp = 1;
    const tanks = state.players.map(p => ({ id: p.id, x: p.x, y: p.y, alive: true }));
    const aim = searchShot(state, find(state, anna), find(state, ben), "granate", tanks);
    state = act(state, anna, { type: "ready", angle: aim.angle, power: aim.power });
    state = act(state, ben, { type: "ready", angle: 45, power: 100 });
    state = finishFlight(state);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.winnerId, anna.id);
    assert.deepEqual(state.result.placements, [anna.id, ben.id]);
    assert.ok(find(state, anna).damageDealt > 0);
    assert.throws(() => game.handleAction(state, { type: "new-match" }, ben, ctx()), /Host/);
    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
});
await test("Spieler verlässt das Spiel → ausgeschieden, Partie endet ohne Gegner", async () => {
    let state = startMatch({ players: [anna, ben, cleo] });
    state = game.onPlayerLeave(state, cleo);
    assert.equal(find(state, cleo).alive, false);
    assert.equal(state.phase, "aiming");
    state = act(state, anna, { type: "ready" });
    state = game.onPlayerLeave(state, ben);
    assert.equal(state.phase, "finished");
});

// ===========================================================================
section("Bots");
// ===========================================================================
await test("Bot meldet sich nach seiner Bedenkzeit bereit", async () => {
    let state = startMatch({ players: [anna], bots: 1 });
    state = act(state, anna, { type: "ready" });
    assert.equal(state.phase, "aiming", "Bot noch nicht bereit");
    state = game.tick(state, { now: NOW + BOT_READY_MAX_MS });
    assert.equal(state.phase, "flight");
});
await test("Treffsicherer Bot trifft einen ungedeckten Gegner innerhalb von 3 Salven", async () => {
    let state = startMatch({ players: [anna], bots: 1 });
    const bot = state.players.find(p => p.bot);
    bot.traits = { accuracy: 1, aggression: 0.5, mobility: 0 };
    arena(state, [200, 600]);
    botPlan(state, bot, createRng(7));
    let now = NOW;
    for (let volley = 0; volley < 3 && find(state, anna).hp === START_HP; volley++) {
        state = act(state, anna, { type: "ready", angle: 135, power: 100 }, now);
        now += BOT_READY_MAX_MS;
        state = game.tick(state, { now });
        now += 60_000;
        state = game.tick(state, { now }) ?? state;
        state.wind = 0;
    }
    assert.ok(find(state, anna).hp < START_HP, "Anna getroffen");
});
await test("Eingegrabener Bot nimmt den Bohrer", async () => {
    let state = startMatch({ players: [anna], bots: 1 });
    const bot = state.players.find(p => p.bot);
    bot.traits = { accuracy: 1, aggression: 0.5, mobility: 0 };
    const heights = flat(100);
    for (let i = 60; i < 70; i++) heights[i] = 300;   // Wand rechts vom Bot (x 120–140)
    for (let i = 30; i < 40; i++) heights[i] = 300;   // Wand links (x 60–80)
    arena(state, [600, 100], heights);
    const started = performance.now();
    botPlan(state, bot, createRng(3));
    const ms = performance.now() - started;
    assert.equal(bot.weapon, "bohrer");
    assert.ok(ms < 150, `Bot-Planung ${ms.toFixed(0)} ms`);
});

// ===========================================================================
section("Sicht");
// ===========================================================================
await test("viewFor: fremde Zielwerte in der Zielphase verborgen, keine Interna", async () => {
    let state = arena(startMatch({ bots: 1 }), [200, 600, 400]);
    state = act(state, ben, { type: "aim", angle: 12, power: 34 });
    const view = game.viewFor(state, anna.id);
    assert.equal(view.rng, undefined);
    assert.equal(view.phaseEndsAt, undefined);
    assert.ok(view.aimingMs >= 0 && view.aimingMs <= AIM_MS);
    const viewBen = view.players.find(p => p.id === ben.id);
    assert.deepEqual([viewBen.angle, viewBen.power, viewBen.weapon], [null, null, null]);
    const own = view.players.find(p => p.id === anna.id);
    assert.equal(typeof own.angle, "number");
    assert.ok(view.players.every(p => !("traits" in p) && !("readyAt" in p) && !("planned" in p)));
    state = act(state, anna, { type: "ready" });
    state = act(state, ben, { type: "ready" });
    state = game.tick(state, { now: NOW + BOT_READY_MAX_MS });
    const flightView = game.viewFor(state, anna.id);
    assert.equal(flightView.players.find(p => p.id === ben.id).angle, 12, "in der Flugphase sichtbar");
    assert.ok(Array.isArray(flightView.flight.heightsBefore));
    assert.doesNotThrow(() => JSON.stringify(flightView));
});

process.exit(summary());
