/**
 * Logik-Test für Turmwacht – lädt games/turmwacht/game.js direkt (ohne Server)
 * und prüft Karte, Bauen/Upgraden/Verkaufen, Wirtschaft (Verteilung, Schenken,
 * Verlassen), Kampf (Zielwahl, Fläche, Frost, Blitz, Panzerung), Ablauf,
 * Wellen, Wertung und Sicht.
 *
 * Start:  npm run test:turmwacht   bzw.  node tests/turmwacht.test.mjs
 * Dauer:  ca. 5 Sekunden
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "turmwacht", "game.js"));
const mapLib = require(path.join(PROJECT_ROOT, "games", "turmwacht", "map.js"));
const {
    TOWERS, TOWER_IDS, ENEMIES, MAX_LEVEL, SELL_RATE, START_GOLD, START_LIVES, BUILD_TICKS, FIRST_BUILD_TICKS,
    EARLY_BONUS_PER_SECOND, upgradeCost, waveHp, waveList, waveBonus, armorFor, sim, distribute, hooksFor
} = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const ctx = { hostId: anna.id };
const act = (state, player, action) => game.handleAction(state, action, player, ctx) ?? state;
const tick = state => game.tick(state) ?? state;
const find = (state, player) => state.players.find(p => p.id === player.id);

function startGame({ players = [anna], difficulty = "mittel", waves = 20, seed = 7 } = {}) {
    let state = game.createState({ players });
    state.rng = seed;
    state = act(state, anna, { type: "new-map" });
    state = act(state, anna, { type: "settings", difficulty, waves });
    return act(state, anna, { type: "start" });
}

/** Freie Felder, nach Abstand zum Pfad sortiert (nah zuerst). */
function freeCells(state) {
    const cells = [];
    for (let y = 0; y < state.map.rows; y++) {
        for (let x = 0; x < state.map.cols; x++) {
            if (state.map.grid[y * state.map.cols + x] !== "." || state.towers.some(t => t.x === x && t.y === y)) continue;
            const near = Math.min(...state.map.path.map(([px, py]) => Math.hypot(px - x, py - y)));
            cells.push({ x, y, near });
        }
    }
    return cells.sort((a, b) => a.near - b.near);
}

function build(state, player, tower, cell = freeCells(state)[0]) {
    return act(state, player, { type: "build", x: cell.x, y: cell.y, tower });
}

const noHooks = { damage() {}, kill() {}, leak() {}, spawn() {} };

/** Gegner direkt neben einen Turm stellen. */
function enemyAt(state, type, x, y, d, hp = 1000) {
    const enemy = { id: `e${state.nextId++}`, type, hp, maxHp: hp, armor: armorFor(type, state.wave || 1), bounty: 3, d, x, y, slow: 0, slowT: 0 };
    state.enemies.push(enemy);
    return enemy;
}

/** Einfacher, gieriger Test-Bauer: baut mit bester Pfadabdeckung, sonst Upgrade. */
function greedy(state, players) {
    const mix = ["pfeil", "kanone", "pfeil", "frost", "blitz", "fernrohr", "kanone", "pfeil"];
    for (const pl of players) {
        for (let guard = 0; guard < 4; guard++) {
            const p = find(state, pl);
            const want = mix[state.towers.length % mix.length];
            const weakest = state.towers.filter(t => t.level < MAX_LEVEL).sort((a, b) => a.level - b.level)[0];
            if (state.towers.length >= 6 + state.wave / 3 && weakest && p.gold >= upgradeCost(weakest.type, weakest.level)) {
                state = act(state, pl, { type: "upgrade", towerId: weakest.id });
            } else if (p.gold >= TOWERS[want].cost) {
                const range = TOWERS[want].levels[0].range;
                const best = freeCells(state).map(c => ({ ...c, cover: state.map.path.filter(([px, py]) => Math.hypot(px - c.x, py - c.y) <= range).length }))
                    .sort((a, b) => b.cover - a.cover)[0];
                if (!best) break;
                state = build(state, pl, want, best);
            } else break;
        }
    }
    return state;
}

function play(state, players, maxTicks = 100000) {
    for (let n = 0; state.phase !== "finished" && n < maxTicks; n++) {
        if (n % 5 === 0) state = greedy(state, players);
        if (state.phase === "build") state = act(state, anna, { type: "call-wave" });
        state = tick(state);
    }
    return state;
}

// ===========================================================================

section("Karte");

await test("200 Seeds: Pfad verbunden von links nach rechts, ohne Berührung, mit Mindestlänge und 3–8 Kurven", () => {
    for (let seed = 1; seed <= 200; seed++) {
        const map = mapLib.generateMap(seed * 2654435761);
        const { path: cells } = map;
        assert.equal(cells[0][0], 0);
        assert.equal(cells.at(-1)[0], mapLib.COLS - 1);
        assert.ok(cells.length >= mapLib.MIN_CELLS, `Seed ${seed}: nur ${cells.length} Felder`);
        for (let i = 1; i < cells.length; i++) {
            assert.equal(Math.abs(cells[i][0] - cells[i - 1][0]) + Math.abs(cells[i][1] - cells[i - 1][1]), 1, "Schritt um genau ein Feld");
        }
        assert.equal(mapLib.touchesItself(cells), false);
        const turns = mapLib.turnsOf(cells);
        assert.ok(turns >= mapLib.MIN_TURNS && turns <= mapLib.MAX_TURNS, `Seed ${seed}: ${turns} Kurven`);
        assert.equal(map.grid.split("").filter(c => c === "#").length, cells.length);
        assert.ok(map.grid.split("").filter(c => c === "r" || c === "t").length >= 6, "Deko-Felder");
        assert.ok(Math.abs(map.length - map.cum.at(-1)) < 1e-9);
    }
});

await test("gleicher Seed → gleiche Karte, Position auf dem Pfad läuft vom Eingang zum Ausgang", () => {
    assert.deepEqual(mapLib.generateMap(123), mapLib.generateMap(123));
    assert.notEqual(mapLib.generateMap(123).grid, mapLib.generateMap(124).grid);
    const map = mapLib.generateMap(99);
    assert.ok(mapLib.positionAt(map, 0).x < 0);
    assert.ok(mapLib.positionAt(map, map.length).x > mapLib.COLS);
    const mid = mapLib.positionAt(map, map.length / 2);
    assert.ok(mid.x >= 0 && mid.x <= mapLib.COLS && mid.y >= 0 && mid.y <= mapLib.ROWS);
});

await test("„Neue Karte“: nur Host, nur im Setup", () => {
    let state = game.createState({ players: [anna, ben] });
    const before = state.map.seed;
    state = act(state, anna, { type: "new-map" });
    assert.notEqual(state.map.seed, before);
    assert.throws(() => act(state, ben, { type: "new-map" }), /Host/);
    state = act(state, anna, { type: "start" });
    assert.throws(() => act(state, anna, { type: "new-map" }), /vor dem Start/);
});

section("Einstellungen und Start");

await test("Einstellungen nur für den Host; Wellenzahl 10/20/30/endlos", () => {
    let state = game.createState({ players: [anna, ben] });
    assert.throws(() => act(state, ben, { type: "settings", waves: 10 }), /Host/);
    assert.throws(() => act(state, anna, { type: "settings", waves: 15 }), /Wellenzahl/);
    assert.throws(() => act(state, anna, { type: "settings", difficulty: "brutal" }), /Schwierigkeit/);
    state = act(state, anna, { type: "settings", waves: 0, difficulty: "schwer" });
    assert.deepEqual(state.settings, { difficulty: "schwer", waves: 0 });
});

await test("Start: Startgold gleichmäßig verteilt, 20 Leben, erste Bauphase", () => {
    const solo = startGame();
    assert.equal(solo.phase, "build");
    assert.equal(solo.lives, START_LIVES);
    assert.equal(solo.buildT, FIRST_BUILD_TICKS);
    assert.equal(find(solo, anna).gold, START_GOLD);
    const trio = startGame({ players: [anna, ben, cleo] });
    const total = trio.players.reduce((sum, p) => sum + p.gold + p.frac, 0);
    assert.ok(Math.abs(total - START_GOLD) < 1e-6, `Summe ${total}`);
    assert.deepEqual(trio.players.map(p => p.gold), [83, 83, 83]);
});

await test("höchstens 4 Spieler; weitere schauen zu", () => {
    const extra = { id: "u-dan", name: "Dan" };
    const eve = { id: "u-eve", name: "Eve" };
    const state = startGame({ players: [anna, ben, cleo, extra, eve] });
    assert.equal(state.players.length, 4);
    assert.throws(() => build(state, eve, "pfeil"), /zu/);
});

section("Bauen, Upgraden, Verkaufen");

await test("Bauen nur auf freien Feldern, Gold wird abgezogen", () => {
    let state = startGame();
    const [px, py] = state.map.path[3];
    assert.throws(() => act(state, anna, { type: "build", x: px, y: py, tower: "pfeil" }), /Kein Bauplatz/);
    const deco = state.map.grid.split("").findIndex(c => c === "r" || c === "t");
    assert.throws(() => act(state, anna, { type: "build", x: deco % 16, y: Math.floor(deco / 16), tower: "pfeil" }), /Kein Bauplatz/);
    assert.throws(() => act(state, anna, { type: "build", x: 99, y: 0, tower: "pfeil" }), /Ungültiges Feld/);
    assert.throws(() => build(state, anna, "laser"), /Unbekannter Turm/);
    const cell = freeCells(state)[0];
    state = build(state, anna, "pfeil", cell);
    assert.equal(find(state, anna).gold, START_GOLD - TOWERS.pfeil.cost);
    assert.equal(state.towers[0].ownerId, anna.id);
    assert.throws(() => build(state, anna, "pfeil", cell), /belegt/);
});

await test("nicht genug Gold → Fehler", () => {
    const state = startGame();
    find(state, anna).gold = 40;
    assert.throws(() => build(state, anna, "pfeil"), /Nicht genug Gold/);
});

await test("Upgrade bis Stufe 4, nicht weiter; jeder darf upgraden", () => {
    let state = startGame({ players: [anna, ben] });
    for (const p of state.players) p.gold = 2000;
    state = build(state, anna, "kanone");
    const id = state.towers[0].id;
    state = act(state, ben, { type: "upgrade", towerId: id });
    assert.equal(state.towers[0].level, 2);
    assert.equal(find(state, ben).gold, 2000 - upgradeCost("kanone", 1));
    state = act(state, anna, { type: "upgrade", towerId: id });
    state = act(state, anna, { type: "upgrade", towerId: id });
    assert.equal(state.towers[0].level, MAX_LEVEL);
    assert.throws(() => act(state, anna, { type: "upgrade", towerId: id }), /höchste Stufe/);
    assert.deepEqual([1, 2, 3].map(level => upgradeCost("kanone", level)), [55, 80, 115]);
});

await test("Verkaufen: nur der Erbauer; in derselben Bauphase volle Erstattung, sonst 70 % je Geldgeber", () => {
    let state = startGame({ players: [anna, ben] });
    for (const p of state.players) p.gold = 1000;
    state = build(state, anna, "pfeil");
    const id = state.towers[0].id;
    assert.throws(() => act(state, ben, { type: "sell", towerId: id }), /Erbauer/);
    state = act(state, anna, { type: "sell", towerId: id });
    assert.equal(find(state, anna).gold, 1000, "volle Erstattung in derselben Bauphase");

    state = build(state, anna, "pfeil");
    const second = state.towers[0].id;
    state = act(state, anna, { type: "call-wave" });
    state = act(state, ben, { type: "upgrade", towerId: second }); // während der Welle
    const annaGold = find(state, anna).gold;
    const benGold = find(state, ben).gold;
    state = act(state, anna, { type: "sell", towerId: second });
    assert.equal(find(state, anna).gold, annaGold + Math.floor(TOWERS.pfeil.cost * SELL_RATE));
    assert.equal(find(state, ben).gold, benGold + Math.floor(upgradeCost("pfeil", 1) * SELL_RATE));
    assert.equal(state.towers.length, 0);
});

section("Wirtschaft");

await test("Einkommen gleich verteilt und unabhängig von der Spielerzahl – ohne Rundungsverlust", () => {
    for (const players of [[anna], [anna, ben], [anna, ben, cleo]]) {
        const state = startGame({ players });
        for (const p of state.players) { p.gold = 0; p.frac = 0; }
        for (let i = 0; i < 37; i++) distribute(state, 7);
        const total = state.players.reduce((sum, p) => sum + p.gold + p.frac, 0);
        assert.ok(Math.abs(total - 259) < 1e-6, `${players.length} Spieler: ${total}`);
        const golds = state.players.map(p => p.gold);
        assert.ok(Math.max(...golds) - Math.min(...golds) <= 1);
    }
});

await test("Kopfgeld und Wellenbonus gehen an alle", () => {
    let state = startGame({ players: [anna, ben] });
    state = act(state, anna, { type: "call-wave" });
    for (const p of state.players) { p.gold = 0; p.frac = 0; }
    state.spawn = [];
    const enemy = enemyAt(state, "laeufer", 5, 5, 3, 1);
    const tower = { id: "tx", type: "pfeil", x: 5, y: 5, level: 1, ownerId: anna.id, invest: { [anna.id]: 50 }, spent: 50, fresh: null, cd: 0, damage: 0 };
    sim.applyDamage(state, tower, enemy, 10, false, hooksFor(state));
    assert.equal(state.players.reduce((s, p) => s + p.gold + p.frac, 0), enemy.bounty);
    const before = state.players.map(p => p.gold + p.frac);
    state.enemies = [];
    state = tick(state);
    assert.equal(state.phase, "build");
    const gained = state.players.map((p, i) => p.gold + p.frac - before[i]);
    assert.ok(Math.abs(gained[0] - waveBonus(1) / 2) < 1e-6 && Math.abs(gained[1] - waveBonus(1) / 2) < 1e-6);
});

await test("Schenken: geht ins Log, mehr als die eigene Kasse geht nicht", () => {
    let state = startGame({ players: [anna, ben] });
    state = act(state, anna, { type: "gift", to: ben.id, amount: 25 });
    assert.equal(find(state, anna).gold, 100);
    assert.equal(find(state, ben).gold, 150);
    assert.equal(find(state, anna).stats.gifted, 25);
    assert.match(state.log.at(-1), /schenkt Ben 25 Gold/);
    assert.throws(() => act(state, anna, { type: "gift", to: ben.id, amount: 101 }), /So viel Gold/);
    assert.throws(() => act(state, anna, { type: "gift", to: anna.id, amount: 5 }), /Mitspieler/);
    assert.throws(() => act(state, anna, { type: "gift", to: ben.id, amount: 1.5 }), /Betrag/);
});

await test("Verlassen: Gold geht an die anderen, Türme werden herrenlos und bleiben", () => {
    let state = startGame({ players: [anna, ben, cleo] });
    state = build(state, ben, "pfeil");
    const benGold = find(state, ben).gold + find(state, ben).frac;
    const others = find(state, anna).gold + find(state, anna).frac + find(state, cleo).gold + find(state, cleo).frac;
    state = game.onPlayerLeave(state, ben);
    assert.equal(find(state, ben).left, true);
    assert.equal(find(state, ben).gold, 0);
    const now = find(state, anna).gold + find(state, anna).frac + find(state, cleo).gold + find(state, cleo).frac;
    assert.ok(Math.abs(now - (others + benGold)) < 1e-6);
    assert.equal(state.towers[0].ownerId, null);
    state = act(state, cleo, { type: "sell", towerId: state.towers[0].id }); // herrenlos: jeder darf
    assert.equal(state.towers.length, 0);
    state = game.onPlayerLeave(state, anna);
    state = game.onPlayerLeave(state, cleo);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "aborted");
});

section("Kampf");

await test("Zielwahl: vorderster Gegner in Reichweite", () => {
    const state = startGame();
    const tower = { id: "t1", type: "fernrohr", x: 5, y: 5, level: 1, ownerId: anna.id, invest: { [anna.id]: 140 }, spent: 140, cd: 0, damage: 0 };
    const back = enemyAt(state, "laeufer", 6, 5.5, 4);
    const front = enemyAt(state, "laeufer", 4, 5.5, 9);
    enemyAt(state, "laeufer", 15, 9, 20); // außer Reichweite
    sim.fireTower(state, tower, noHooks);
    assert.equal(front.hp, 1000 - TOWERS.fernrohr.levels[0].damage);
    assert.equal(back.hp, 1000);
    assert.equal(tower.cd, TOWERS.fernrohr.levels[0].cd);
    sim.fireTower(state, tower, noHooks); // nachladen
    assert.equal(front.hp, 1000 - TOWERS.fernrohr.levels[0].damage);
});

await test("Pfeil Stufe 4 schießt zwei Pfeile", () => {
    const state = startGame();
    const tower = { id: "t1", type: "pfeil", x: 5, y: 5, level: 4, ownerId: anna.id, invest: {}, spent: 1, cd: 0, damage: 0 };
    const a = enemyAt(state, "laeufer", 5.5, 4.5, 9);
    const b = enemyAt(state, "laeufer", 5.5, 6.5, 8);
    const c = enemyAt(state, "laeufer", 6.5, 5.5, 7);
    sim.fireTower(state, tower, noHooks);
    assert.deepEqual([a.hp, b.hp, c.hp], [1000 - 36, 1000 - 36, 1000]);
});

await test("Kanone trifft alle im Flächenradius", () => {
    const state = startGame();
    const tower = { id: "t1", type: "kanone", x: 5, y: 5, level: 1, ownerId: anna.id, invest: {}, spent: 1, cd: 0, damage: 0 };
    const target = enemyAt(state, "laeufer", 6.5, 5.5, 9);
    const near = enemyAt(state, "laeufer", 7.0, 5.9, 8);
    const far = enemyAt(state, "laeufer", 8.0, 7.0, 7);
    sim.fireTower(state, tower, noHooks);
    assert.equal(target.hp, 1000 - 16);
    assert.equal(near.hp, 1000 - 16);
    assert.equal(far.hp, 1000);
});

await test("Frost verlangsamt alle in Reichweite – beim Koloss nur halb so stark", () => {
    const state = startGame();
    const tower = { id: "t1", type: "frost", x: 5, y: 5, level: 4, ownerId: anna.id, invest: {}, spent: 1, cd: 0, damage: 0 };
    const walker = enemyAt(state, "laeufer", 6, 5.5, 9);
    const boss = enemyAt(state, "koloss", 4.5, 6, 8);
    sim.fireTower(state, tower, noHooks);
    assert.equal(walker.slow, 0.55);
    assert.equal(boss.slow, 0.55);
    const d0 = [walker.d, boss.d];
    sim.moveEnemies(state, noHooks);
    const speed = type => ENEMIES[type].speed * 0.1;
    assert.ok(Math.abs(walker.d - d0[0] - speed("laeufer") * 0.45) < 1e-9);
    assert.ok(Math.abs(boss.d - d0[1] - speed("koloss") * (1 - 0.275)) < 1e-9);
});

await test("Blitz springt auf mehrere Ziele und ignoriert Panzerung; Panzerung mindert Pfeilschaden", () => {
    const state = startGame();
    state.wave = 1;
    const zap = { id: "t1", type: "blitz", x: 5, y: 5, level: 1, ownerId: anna.id, invest: {}, spent: 1, cd: 0, damage: 0 };
    const tank = enemyAt(state, "panzer", 6, 5.5, 9);
    const second = enemyAt(state, "laeufer", 7, 5.5, 8);
    const third = enemyAt(state, "laeufer", 8, 5.5, 7);
    const fourth = enemyAt(state, "laeufer", 9, 5.5, 6);
    sim.fireTower(state, zap, noHooks);
    assert.equal(tank.hp, 1000 - 16, "Panzerung ignoriert");
    assert.ok(Math.abs(second.hp - (1000 - 16 * 0.85)) < 1e-9);
    assert.ok(third.hp < 1000);
    assert.equal(fourth.hp, 1000, "Stufe 1: nur 3 Ziele");
    const arrow = { id: "t2", type: "pfeil", x: 5, y: 5, level: 1, ownerId: anna.id, invest: {}, spent: 1, cd: 0, damage: 0 };
    const before = tank.hp;
    sim.fireTower(state, arrow, noHooks);
    assert.equal(before - tank.hp, Math.max(9 * 0.25, 9 - tank.armor));
});

await test("Schaden wird anteilig nach Investition gutgeschrieben, Abschuss dem Erbauer", () => {
    let state = startGame({ players: [anna, ben] });
    state = act(state, anna, { type: "call-wave" });
    state.spawn = [];
    const tower = { id: "t1", type: "pfeil", x: 5, y: 5, level: 2, ownerId: anna.id, invest: { [anna.id]: 50, [ben.id]: 30 }, spent: 80, cd: 0, damage: 0 };
    const enemy = enemyAt(state, "laeufer", 6, 5.5, 9, 40);
    sim.applyDamage(state, tower, enemy, 40, false, hooksFor(state));
    assert.equal(find(state, anna).stats.damage, 25);
    assert.equal(find(state, ben).stats.damage, 15);
    assert.equal(find(state, anna).stats.kills, 1);
    assert.equal(tower.damage, 40);
});

section("Ablauf");

await test("Bauphase endet, wenn alle bereit sind (mit Bonus) oder der Countdown abläuft", () => {
    let state = startGame({ players: [anna, ben] });
    state = act(state, anna, { type: "ready" });
    assert.equal(state.phase, "build");
    state = act(state, anna, { type: "ready" }); // zurücknehmen
    assert.equal(find(state, anna).ready, false);
    state = act(state, anna, { type: "ready" });
    const before = find(state, anna).gold + find(state, anna).frac + find(state, ben).gold + find(state, ben).frac;
    state = act(state, ben, { type: "ready" });
    assert.equal(state.phase, "wave");
    assert.equal(state.wave, 1);
    const after = find(state, anna).gold + find(state, anna).frac + find(state, ben).gold + find(state, ben).frac;
    assert.equal(after - before, Math.floor(FIRST_BUILD_TICKS / 10) * EARLY_BONUS_PER_SECOND);

    let solo = startGame();
    for (let i = 0; i < FIRST_BUILD_TICKS; i++) solo = tick(solo);
    assert.equal(solo.phase, "wave");
    assert.equal(find(solo, anna).gold, START_GOLD, "kein Bonus ohne frühen Start");
});

await test("„Welle rufen“ nur für den Host", () => {
    const state = startGame({ players: [anna, ben] });
    assert.throws(() => act(state, ben, { type: "call-wave" }), /Host/);
    assert.equal(act(state, anna, { type: "call-wave" }).phase, "wave");
});

await test("Gegner am Ziel kosten Leben (Koloss 5), 0 Leben = Niederlage", () => {
    let state = startGame();
    state = act(state, anna, { type: "call-wave" });
    state.spawn = [];
    enemyAt(state, "laeufer", 0, 0, 0.5); // hält die Welle am Laufen
    enemyAt(state, "laeufer", 16, 5, state.map.length - 0.01);
    enemyAt(state, "koloss", 16, 5, state.map.length - 0.01);
    state = tick(state);
    assert.equal(state.lives, START_LIVES - 6);
    state.lives = 1;
    enemyAt(state, "laeufer", 16, 5, state.map.length - 0.01);
    state = tick(state);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "defeat");
    assert.equal(state.result.wave, 1);
});

await test("Endlos: läuft über Welle 30 hinaus, Ende heißt „endless“", () => {
    let state = startGame({ waves: 0 });
    state.wave = 31;
    state = act(state, anna, { type: "call-wave" });
    state.spawn = [];
    state = tick(state);
    assert.equal(state.phase, "build");
    assert.equal(state.wave, 32);
    state.lives = 1;
    state = act(state, anna, { type: "call-wave" });
    state.spawn = [];
    enemyAt(state, "laeufer", 16, 5, state.map.length - 0.01);
    state = tick(state);
    assert.equal(state.result.outcome, "endless");
    assert.equal(state.result.wave, 33);
});

await test("letzte Welle besiegt = Sieg", () => {
    let state = startGame({ waves: 10 });
    state.wave = 9;
    state = act(state, anna, { type: "call-wave" });
    state.spawn = [];
    state = tick(state);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "victory");
});

await test("Tempo ×2: nur Host, zwei Schritte je Tick", () => {
    let state = startGame({ players: [anna, ben] });
    assert.throws(() => act(state, ben, { type: "speed" }), /Host/);
    state = act(state, anna, { type: "speed" });
    assert.equal(state.speed, 2);
    state = act(state, anna, { type: "call-wave" });
    state.spawn = [];
    const enemy = enemyAt(state, "laeufer", 0, 0, 5);
    state = tick(state);
    assert.ok(Math.abs(state.enemies.find(e => e.id === enemy.id).d - (5 + 2 * ENEMIES.laeufer.speed * 0.1)) < 1e-9);
});

section("Wellen");

await test("Lebenspunkte steigen von Welle zu Welle, Koloss jede 10. Welle, Schwierigkeit skaliert", () => {
    for (let wave = 2; wave <= 60; wave++) assert.ok(waveHp(wave, "mittel") > waveHp(wave - 1, "mittel"));
    assert.ok(waveHp(40, "mittel") / waveHp(39, "mittel") > waveHp(20, "mittel") / waveHp(19, "mittel"), "Endlos wird schneller härter");
    for (let wave = 1; wave <= 40; wave++) assert.equal(waveList(wave).includes("koloss"), wave % 10 === 0, `Welle ${wave}`);
    assert.ok(waveList(1).every(t => t === "laeufer"));
    assert.ok(waveList(12).includes("schwarm"));
    assert.ok(waveList(13).includes("panzer"));
    assert.ok(waveList(14).includes("flitzer"));
    assert.ok(waveHp(10, "leicht") < waveHp(10, "mittel") && waveHp(10, "mittel") < waveHp(10, "schwer"));
});

await test("Gegner erscheinen nacheinander mit den Lebenspunkten der Welle", () => {
    let state = startGame();
    state = act(state, anna, { type: "call-wave" });
    const total = state.spawn.length;
    for (let i = 0; i < 40; i++) state = tick(state);
    assert.ok(state.enemies.length > 1 && state.enemies.length < total);
    assert.equal(state.enemies[0].maxHp, Math.round(waveHp(1, "mittel")));
});

section("Wertung, Sicht und Simulation");

await test("placements nach Schaden, Sieger = meister Schaden", () => {
    let state = startGame({ players: [anna, ben, cleo] });
    find(state, anna).stats.damage = 100;
    find(state, ben).stats.damage = 300;
    find(state, cleo).stats.damage = 200;
    state.lives = 1;
    state = act(state, anna, { type: "call-wave" });
    state.spawn = [];
    enemyAt(state, "laeufer", 16, 5, state.map.length - 0.01);
    state = tick(state);
    assert.deepEqual(state.result.placements, [ben.id, cleo.id, anna.id]);
    assert.equal(state.result.winnerId, ben.id);
    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
    assert.equal(state.towers.length, 0);
});

await test("viewFor ohne rng und Bruchteile, mit Vorschau der nächsten Welle und Erstattung", () => {
    let state = startGame();
    state = build(state, anna, "pfeil");
    const view = game.viewFor(state, anna.id);
    assert.equal(view.rng, undefined);
    assert.equal(view.players[0].frac, undefined);
    assert.equal(view.towers[0].invest, undefined);
    assert.equal(view.towers[0].refund, TOWERS.pfeil.cost);
    assert.deepEqual(view.upcoming, { laeufer: waveList(1).length });
    assert.ok(JSON.stringify(view).length < 20000);
});

await test("Test-Bauer schafft „leicht“ mit 10 Wellen; auf „mittel“ kommt der erste Koloss nicht durch; < 2 ms pro Tick", () => {
    let easy = startGame({ difficulty: "leicht", waves: 10, seed: 3 });
    const t0 = performance.now();
    let n = 0;
    for (; easy.phase !== "finished" && n < 60000; n++) {
        if (n % 5 === 0) easy = greedy(easy, [anna]);
        if (easy.phase === "build") easy = act(easy, anna, { type: "call-wave" });
        easy = tick(easy);
    }
    const perTick = (performance.now() - t0) / n;
    assert.equal(easy.result?.outcome, "victory");
    assert.ok(perTick < 2, `${perTick.toFixed(2)} ms pro Tick`);
    const medium = play(startGame({ difficulty: "mittel", waves: 10, seed: 3 }), [anna]);
    assert.equal(medium.result?.outcome, "victory");
    assert.equal(medium.lives, START_LIVES, "Koloss in Welle 10 wird besiegt");
});

process.exit(summary());
