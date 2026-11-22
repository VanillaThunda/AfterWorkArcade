/**
 * Logik-Test für Feierabend-Fäuste – lädt games/feierabend-faeuste/game.js
 * direkt (ohne Server) und prüft Figurenwahl, Bewegung, Kamera, Wellen, Kampf,
 * Gegner-KI, Kisten, K.-o./Aufhelfen, Boss, Wertung, Bot-Mitstreiter und Sicht.
 *
 * Start:  npm run test:feierabend-faeuste   bzw.  node tests/feierabend-faeuste.test.mjs
 * Dauer:  ca. 5 Sekunden
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "feierabend-faeuste", "game.js"));
const {
    VIEW_W, DEPTH, FIGURES, FIGURE_IDS, ENEMIES, DIFFICULTIES, SECTIONS, INPUT_BUFFER, REVIVE_TICKS, SELF_REVIVE_TICKS,
    FOOD_HEAL, CRATE_HITS, DYING_TICKS, TRANSITION_TICKS, combat, ai, groupScale, spawnEnemy, loadSection
} = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const ctx = { hostId: anna.id };
const act = (state, player, action) => game.handleAction(state, action, player, ctx) ?? state;
const tick = state => game.tick(state) ?? state;
const ticks = (state, count) => {
    for (let i = 0; i < count; i++) state = tick(state);
    return state;
};
const find = (state, player) => state.players.find(p => p.id === player.id);

/** Spiel starten; Intro überspringen; optional mit festem Zufall. */
function startGame({ players = [anna], allies = 0, difficulty = "mittel", picks = {}, seed = 1 } = {}) {
    let state = game.createState({ players });
    state.rng = seed;
    state = act(state, anna, { type: "settings", allies, difficulty });
    for (const [id, figure] of Object.entries(picks)) state = act(state, players.find(p => p.id === id), { type: "pick", figure });
    state = act(state, anna, { type: "start" });
    state.intro = 0;
    return state;
}

/** Leeres Feld zum Testen: keine Gegner, keine Kisten, Spieler an festen Stellen. */
function arena(state, spots) {
    state.enemies = [];
    state.crates = [];
    state.pickups = [];
    state.projectiles = [];
    state.lock = true; // keine Wellen auslösen
    state.players.forEach((p, i) => Object.assign(p, { x: spots[i][0], z: spots[i][1], h: 0, kx: 0, facing: 1, state: "idle", lock: 0, invuln: 0, attack: null }));
    return state;
}

/** Gegner, der still steht (ohne KI-Angriffe). */
function dummy(state, type, x, z) {
    const enemy = spawnEnemy(state, type, x, z);
    enemy.ai.cooldown = 99999;
    enemy.ai.specialCd = 99999;
    enemy.ai.frozen = true;
    enemy.entered = true;
    return enemy;
}

// ===========================================================================
section("Einstellungen und Figurenwahl");
// ===========================================================================
await test("Figurenwahl: jede Figur nur einmal, Einstellungen nur für den Host", async () => {
    let state = game.createState({ players: [anna, ben] });
    state = act(state, anna, { type: "pick", figure: "hausmeister" });
    assert.throws(() => game.handleAction(state, { type: "pick", figure: "hausmeister" }, ben, ctx), /vergeben/);
    assert.throws(() => game.handleAction(state, { type: "pick", figure: "drache" }, ben, ctx), /Unbekannte Figur/);
    state = act(state, ben, { type: "pick", figure: "kurierin" });
    state = act(state, anna, { type: "pick", figure: "monteurin" });
    assert.deepEqual(state.picks, { [anna.id]: "monteurin", [ben.id]: "kurierin" }, "Wechsel erlaubt");
    assert.throws(() => game.handleAction(state, { type: "settings", allies: 1 }, ben, ctx), /Host/);
    assert.throws(() => game.handleAction(state, { type: "settings", allies: 4 }, anna, ctx), /Bot-Mitstreiter/);
    assert.throws(() => game.handleAction(state, { type: "settings", difficulty: "albtraum" }, anna, ctx), /Schwierigkeit/);
    assert.throws(() => game.handleAction(state, { type: "start" }, ben, ctx), /Host/);
});
await test("Start: Wunschfiguren, Bot-Mitstreiter bekommen freie Figuren, höchstens 4 Teilnehmer", async () => {
    const state = startGame({ players: [anna, ben, cleo], allies: 3, picks: { [ben.id]: "lagerist" } });
    assert.equal(state.phase, "playing");
    assert.equal(state.players.length, 4, "3 Menschen + 1 Bot");
    assert.equal(find(state, ben).figure, "lagerist");
    assert.equal(new Set(state.players.map(p => p.figure)).size, 4, "alle verschieden");
    const bot = state.players.find(p => p.bot);
    assert.ok(bot.name.startsWith("🤖 "));
    assert.equal(bot.hp, FIGURES[bot.figure].hp);
    assert.equal(state.sectionId, SECTIONS[0].id);
});

// ===========================================================================
section("Bewegung und Kamera");
// ===========================================================================
await test("Laufen: Tempo je Figur, Tiefe begrenzt, nicht aus dem Bild", async () => {
    let state = arena(startGame({ players: [anna, ben], picks: { [anna.id]: "kurierin", [ben.id]: "hausmeister" } }), [[100, 50], [100, 70]]);
    state = act(state, anna, { type: "move", dx: 1, dz: 0 });
    state = act(state, ben, { type: "move", dx: 1, dz: 0 });
    state = ticks(state, 20); // 1 s
    assert.ok(Math.abs(find(state, anna).x - (100 + FIGURES.kurierin.speed)) < 8, `Kurierin ~${FIGURES.kurierin.speed}/s`);
    assert.ok(find(state, anna).x > find(state, ben).x + 30, "Kurierin schneller als Hausmeister");
    state = act(state, anna, { type: "move", dx: 0, dz: 1 });
    state = ticks(state, 80);
    assert.equal(find(state, anna).z, DEPTH, "vorne begrenzt");
    state = act(state, anna, { type: "move", dx: 1, dz: 0 });
    state = ticks(state, 100);
    assert.ok(find(state, anna).x <= state.camX + VIEW_W - 8, "bleibt im Bild (Kamera gesperrt)");
    assert.throws(() => game.handleAction(state, { type: "move", dx: 2, dz: 0 }, anna, ctx), /Richtung/);
});
await test("Kamera folgt der Spitze, Welle sperrt sie, nach der Welle geht es weiter", async () => {
    let state = startGame({ seed: 5 });
    state = act(state, anna, { type: "move", dx: 1, dz: 0 });
    let camBefore = state.camX;
    for (let i = 0; i < 200 && !state.lock; i++) {
        state = tick(state);
        assert.ok(state.camX >= camBefore, "Kamera läuft nie zurück");
        camBefore = state.camX;
    }
    const wave = SECTIONS[0].waves[0];
    assert.equal(state.lock, true, "Welle ausgelöst");
    assert.equal(state.camX, wave.at);
    assert.ok(state.enemies.length >= 1);
    state = ticks(state, 40);
    assert.equal(state.camX, wave.at, "Kamera bleibt stehen");
    for (const enemy of state.enemies) enemy.hp = 0, enemy.state = "dying", enemy.dyingT = DYING_TICKS;
    state = tick(state);
    assert.deepEqual([state.lock, state.go, state.waveIndex], [false, true, 1], "„Weiter →“");
});
await test("Gruppengröße skaliert Wellen und Boss", async () => {
    assert.ok(groupScale(4).wave > groupScale(2).wave && groupScale(2).wave > groupScale(1).wave);
    assert.ok(groupScale(4).boss > groupScale(1).boss);
    const small = startGame({ allies: 0 });
    const big = startGame({ allies: 3 });
    loadSection(small, 3);
    loadSection(big, 3);
    assert.ok(big.enemies[0].maxHp > small.enemies[0].maxHp * 2, "Boss zu viert deutlich zäher");
});

// ===========================================================================
section("Kampf");
// ===========================================================================
await test("Schlag trifft nur in Reichweite und passender Tiefe – jedes Ziel einmal", async () => {
    let state = arena(startGame({ picks: { [anna.id]: "lagerist" } }), [[100, 50]]);
    const front = dummy(state, "schlaeger", 130, 52);
    const deep = dummy(state, "schlaeger", 130, 80);
    const behind = dummy(state, "schlaeger", 70, 50);
    state = act(state, anna, { type: "attack" });
    state = ticks(state, 10);
    const hp = id => state.enemies.find(e => e.id === id).hp;
    assert.equal(hp(front.id), front.maxHp - FIGURES.lagerist.damage[0], "genau ein Treffer");
    assert.equal(hp(deep.id), deep.maxHp, "andere Tiefe");
    assert.equal(hp(behind.id), behind.maxHp, "hinter dem Spieler");
    assert.equal(find(state, anna).stats.hits, 1);
    assert.equal(find(state, anna).stats.damage, FIGURES.lagerist.damage[0]);
});
await test("Kombo: dritter Schlag wirft um, Reichweite der Monteurin größer", async () => {
    let state = arena(startGame({ picks: { [anna.id]: "lagerist" } }), [[100, 50]]);
    const enemy = dummy(state, "schlaeger", 128, 50);
    enemy.maxHp = enemy.hp = 500;
    for (let i = 0; i < 3; i++) {
        state = act(state, anna, { type: "attack" });
        state = ticks(state, 6);
    }
    const target = state.enemies.find(e => e.id === enemy.id);
    assert.equal(target.hp, 500 - FIGURES.lagerist.damage.reduce((a, b) => a + b, 0));
    assert.ok(["down", "getup"].includes(target.state), `umgeworfen (${target.state})`);

    let far = arena(startGame({ picks: { [anna.id]: "monteurin" } }), [[100, 50]]);
    const distant = dummy(far, "schlaeger", 155, 50);
    far = act(far, anna, { type: "attack" });
    far = ticks(far, 10);
    assert.ok(far.enemies.find(e => e.id === distant.id).hp < distant.maxHp, "Monteurin erreicht 55 Einheiten");
});
await test("Sprung und Sprungtritt, Spezialangriff kostet Lebenspunkte und trifft ringsum", async () => {
    let state = arena(startGame({ picks: { [anna.id]: "lagerist" } }), [[100, 50]]);
    const front = dummy(state, "schlaeger", 125, 50);
    state = act(state, anna, { type: "jump" });
    state = ticks(state, 3);
    assert.ok(find(state, anna).h > 10, "in der Luft");
    state = act(state, anna, { type: "attack" });
    state = ticks(state, 20);
    assert.equal(find(state, anna).h, 0, "gelandet");
    assert.equal(find(state, anna).state, "idle");
    assert.ok(["down", "getup"].includes(state.enemies.find(e => e.id === front.id).state), "Sprungtritt wirft um");

    state = arena(state, [[200, 50]]);
    const left = dummy(state, "schlaeger", 165, 50);
    const right = dummy(state, "schlaeger", 235, 55);
    const hpBefore = find(state, anna).hp;
    state = act(state, anna, { type: "special" });
    state = ticks(state, 10);
    assert.equal(find(state, anna).hp, hpBefore - Math.ceil(FIGURES.lagerist.hp * combat.SPECIAL_COST));
    for (const id of [left.id, right.id]) assert.ok(state.enemies.find(e => e.id === id).hp < ENEMIES.schlaeger.hp, "beide Seiten getroffen");
});
await test("Kein Friendly Fire; gepanzerte Gegner unterbricht nur der Abschluss", async () => {
    let state = arena(startGame({ players: [anna, ben], picks: { [anna.id]: "hausmeister" } }), [[100, 50], [130, 50]]);
    const brocken = dummy(state, "brocken", 128, 52);
    state = act(state, anna, { type: "attack" });
    state = ticks(state, 12);
    assert.equal(find(state, ben).hp, find(state, ben).maxHp, "Ben unverletzt");
    const hit = state.enemies.find(e => e.id === brocken.id);
    assert.ok(hit.hp < hit.maxHp);
    assert.notEqual(hit.state, "hurt", "gepanzert: kein Zurückzucken");
    hit.state = "idle";
    state = act(state, anna, { type: "special" });
    state = ticks(state, 6);
    assert.equal(state.enemies.find(e => e.id === brocken.id).state, "down", "Spezial wirft auch den Brocken um");
});
await test("Kein Dauer-Festhalten: nach 4 Treffern in Folge geht ein Gegner zu Boden", async () => {
    const target = { id: "x", x: 0, z: 0, h: 0, hp: 500, armored: false, juggle: 0, juggleT: 0, state: "idle", lock: 0 };
    for (let i = 0; i < combat.JUGGLE_LIMIT - 1; i++) {
        combat.applyHit(target, 1, { facing: 1 });
        assert.equal(target.state, "hurt");
        target.state = "idle";
    }
    combat.applyHit(target, 1, { facing: 1 });
    assert.equal(target.state, "down");
});

// ===========================================================================
section("Gegner");
// ===========================================================================
await test("Angriffs-Tickets begrenzen gleichzeitige Angreifer", async () => {
    let state = arena(startGame({ difficulty: "mittel" }), [[240, 55]]);
    for (let i = 0; i < 6; i++) spawnEnemy(state, "schlaeger", 160 + i * 30, 20 + i * 12).entered = true;
    find(state, anna).hp = find(state, anna).maxHp = 99999;
    const max = Math.max(1, Math.round(DIFFICULTIES.mittel.tickets * groupScale(1).tickets));
    for (let i = 0; i < 120; i++) {
        state = tick(state);
        const attackers = state.enemies.filter(e => e.ai.ticket).length;
        assert.ok(attackers <= max, `${attackers} > ${max} Angreifer`);
    }
});
await test("Werfer halten Abstand und bleiben im Bild; Flaschen treffen", async () => {
    let state = arena(startGame(), [[200, 55]]);
    find(state, anna).hp = find(state, anna).maxHp = 99999;
    const thrower = spawnEnemy(state, "werfer", 230, 55);
    thrower.entered = true;
    state = ticks(state, 80);
    const t = state.enemies.find(e => e.id === thrower.id);
    assert.ok(Math.abs(t.x - find(state, anna).x) > 90, "Abstand");
    assert.ok(t.x >= state.camX && t.x <= state.camX + VIEW_W, "im Bild");
    state = ticks(state, 80);
    assert.ok(find(state, anna).hp < 99999, "von einer Flasche getroffen");
});
await test("Schwierigkeit skaliert Lebenspunkte der Gegner", async () => {
    const easy = startGame({ difficulty: "leicht" });
    const hard = startGame({ difficulty: "schwer" });
    assert.ok(spawnEnemy(hard, "schlaeger", 0, 0).maxHp > spawnEnemy(easy, "schlaeger", 0, 0).maxHp * 1.5);
});

// ===========================================================================
section("Kisten, K.-o. und Aufhelfen");
// ===========================================================================
await test("Kiste zerschlagen → Essen heilt", async () => {
    let state = arena(startGame({ picks: { [anna.id]: "lagerist" } }), [[100, 50]]);
    state.crates = [{ id: "c1", x: 130, z: 50, h: 0, hp: CRATE_HITS, item: "food" }];
    for (let i = 0; i < CRATE_HITS; i++) {
        state = act(state, anna, { type: "attack" });
        state = ticks(state, 12);
    }
    assert.equal(state.crates.length, 0);
    assert.equal(state.pickups.length, 1);
    find(state, anna).hp = 20;
    state = act(state, anna, { type: "move", dx: 1, dz: 0 });
    state = ticks(state, 8);
    assert.equal(find(state, anna).hp, 20 + FOOD_HEAL);
    assert.equal(state.pickups.length, 0);
});
await test("K.-o.: Mitspieler hilft nach 1,5 s auf, sonst nach 10 s selbst; alle am Boden → verloren", async () => {
    let state = arena(startGame({ players: [anna, ben] }), [[100, 50], [118, 52]]);
    game._internals.hitPlayer(state, null, find(state, anna), 9999, { facing: 1 });
    assert.equal(find(state, anna).state, "ko");
    assert.equal(find(state, anna).stats.downs, 1);
    state = ticks(state, REVIVE_TICKS + 1);
    assert.notEqual(find(state, anna).state, "ko", "Ben hilft auf");
    assert.equal(find(state, anna).hp, Math.round(find(state, anna).maxHp * 0.4));

    state = arena(state, [[100, 50], [300, 90]]);
    game._internals.hitPlayer(state, null, find(state, anna), 9999, { facing: 1 });
    state = ticks(state, SELF_REVIVE_TICKS - 5);
    assert.equal(find(state, anna).state, "ko", "noch am Boden");
    state = ticks(state, 10);
    assert.notEqual(find(state, anna).state, "ko", "selbst aufgestanden");

    state = arena(state, [[100, 50], [300, 90]]);
    for (const p of state.players) game._internals.hitPlayer(state, null, p, 9999, { facing: 1 });
    state = tick(state);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "defeat");
});

// ===========================================================================
section("Ablauf, Boss und Wertung");
// ===========================================================================
await test("Abschnitt geschafft → Überblendung → nächster Abschnitt", async () => {
    let state = startGame();
    state.waveIndex = SECTIONS[0].waves.length;
    state.camX = SECTIONS[0].width - VIEW_W;
    find(state, anna).x = SECTIONS[0].width - 20;
    state = tick(state);
    assert.ok(state.transition > 0, "Überblendung");
    state = ticks(state, TRANSITION_TICKS);
    assert.equal(state.sectionId, SECTIONS[1].id);
    assert.equal(state.camX, 0);
    assert.ok(find(state, anna).x < 100, "links aufgestellt");
});
await test("Boss: Phasen nach Lebenspunkten, ruft Verstärkung, Sieg mit Wertung nach Schaden", async () => {
    let state = startGame({ players: [anna, ben] });
    loadSection(state, SECTIONS.length - 1);
    state.intro = 0;
    const boss = state.enemies.find(e => e.type === "boss");
    assert.ok(boss && state.lock, "Boss-Arena gesperrt");
    assert.equal(ai.bossPhase(boss), 1);
    boss.hp = Math.round(boss.maxHp * 0.5);
    assert.equal(ai.bossPhase(boss), 2);
    boss.hp = Math.round(boss.maxHp * 0.3);
    state = tick(state);
    assert.ok(state.enemies.filter(e => e.type === "schlaeger").length >= 1, "Verstärkung bei Phase 3");
    find(state, ben).stats.damage = 500;
    find(state, anna).stats.damage = 200;
    for (const enemy of state.enemies) enemy.hp = 0, enemy.state = "dying", enemy.dyingT = DYING_TICKS;
    state = tick(state);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "victory");
    assert.deepEqual(state.result.placements, [ben.id, anna.id]);
    assert.equal(state.result.winnerId, ben.id, "Mitarbeiter des Abends");
    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
});
await test("Auch bei Niederlage gibt es einen Sieger der Gruppe", async () => {
    let state = arena(startGame({ players: [anna, ben] }), [[100, 50], [300, 50]]);
    find(state, anna).stats.damage = 10;
    find(state, ben).stats.damage = 90;
    for (const p of state.players) game._internals.hitPlayer(state, null, p, 9999, { facing: 1 });
    state = tick(state);
    assert.equal(state.result.outcome, "defeat");
    assert.equal(state.result.winnerId, ben.id);
});
await test("Bot-Mitstreiter schaffen das Level auf „leicht“, Ticks schnell", async () => {
    let state = startGame({ allies: 2, difficulty: "leicht", seed: 42 });
    find(state, anna).bot = true; // Anna spielt wie ein Bot
    const started = performance.now();
    let n = 0;
    while (state.phase === "playing" && n < 20 * 60 * 10) {
        state = tick(state);
        n++;
    }
    const perTick = (performance.now() - started) / n;
    assert.equal(state.result?.outcome, "victory", `Ergebnis ${state.result?.outcome} nach ${(n / 20).toFixed(0)} s`);
    assert.ok(perTick < 3, `${perTick.toFixed(2)} ms pro Tick`);
});

// ===========================================================================
section("Verlassen und Sicht");
// ===========================================================================
await test("viewFor ohne Interna; letzter Mensch geht → Spiel beendet", async () => {
    let state = startGame({ players: [anna, ben], allies: 1 });
    spawnEnemy(state, "schlaeger", 300, 50);
    const view = game.viewFor(state, anna.id);
    assert.equal(view.rng, undefined);
    assert.ok(view.players.every(p => !("input" in p)));
    assert.ok(view.enemies.every(e => !("ai" in e)));
    assert.doesNotThrow(() => JSON.stringify(view));
    assert.ok(game.meta.description.length > 20 && FIGURE_IDS.length === 4 && INPUT_BUFFER > 0);
    state = game.onPlayerLeave(state, ben);
    assert.equal(state.phase, "playing");
    assert.equal(find(state, ben).left, true);
    state = game.onPlayerLeave(state, anna);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "aborted");
});

process.exit(summary());
