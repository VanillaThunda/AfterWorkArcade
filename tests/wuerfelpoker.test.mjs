/**
 * Logik-Test für Fünf-Würfel-Poker – lädt games/wuerfelpoker/game.js direkt
 * (ohne Server) und prüft Punkte aller Felder, Bonus, Würfel-Regeln, gleichzeitiges
 * und reihum Spielen, Straßen nur aus einem Wurf, Zeitlimit, Bots, Wertung und Verlassen.
 *
 * Start:  npm run test:wuerfelpoker   bzw.  node tests/wuerfelpoker.test.mjs
 * Dauer:  ca. 3 Sekunden
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "wuerfelpoker", "game.js"));
const { MAX_ROLLS, TURN_MS, BOT_STEP_MS, BOT_STEP_SEQ_MS, BOT_JITTER_MS, scoring, bots, setRandom } = game._internals;
const { scoreFor, totals, emptySheet, potentials, CATEGORIES } = scoring;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const T0 = 1_000_000;
const ctx = (now = T0) => ({ hostId: anna.id, now });
const act = (state, player, action, now = T0) => game.handleAction(state, action, player, ctx(now)) ?? state;
const find = (state, player) => state.players.find(p => p.id === player.id);

/** Würfel der Reihe nach vorgeben. */
function script(...values) {
    const queue = [...values];
    setRandom(() => {
        if (queue.length === 0) throw new Error("Keine gescripteten Würfel mehr.");
        return queue.shift();
    });
}

function startGame({ players = [anna], bots: botCount = 0, botLevel = "mittel", mode = "gleichzeitig" } = {}) {
    let state = game.createState({ players });
    state = act(state, anna, { type: "settings", bots: botCount, botLevel, mode });
    return act(state, anna, { type: "start" });
}

/** Einen ganzen Zettel per gescripteter Würfel auffüllen (immer 1-1-1-1-1, Felder der Reihe nach). */
function fillSheet(state, player, except = []) {
    for (const category of CATEGORIES) {
        if (except.includes(category) || find(state, player).sheet[category] !== null) continue;
        if (state.phase !== "playing") break;
        script(1, 1, 1, 1, 1);
        state = act(state, player, { type: "roll" });
        state = act(state, player, { type: "score", category });
    }
    return state;
}

// ===========================================================================

section("Punkte");

await test("alle Felder mit Grenzfällen", () => {
    const cases = [
        ["ones", [1, 1, 2, 3, 1], 3], ["sixes", [6, 6, 6, 2, 6], 24], ["fours", [1, 2, 3, 5, 6], 0],
        ["three", [3, 3, 3, 1, 2], 12], ["three", [3, 3, 2, 1, 2], 0], ["three", [5, 5, 5, 5, 5], 25],
        ["four", [2, 2, 2, 2, 6], 14], ["four", [2, 2, 2, 6, 6], 0],
        ["fullHouse", [2, 2, 3, 3, 3], 25], ["fullHouse", [4, 4, 4, 4, 4], 0], ["fullHouse", [2, 2, 3, 3, 1], 0],
        ["smallStraight", [1, 2, 3, 4, 4], 30], ["smallStraight", [3, 4, 5, 6, 1], 30], ["smallStraight", [1, 2, 3, 5, 6], 0],
        ["smallStraight", [2, 3, 4, 5, 6], 30],
        ["largeStraight", [5, 4, 3, 2, 1], 40], ["largeStraight", [2, 3, 4, 5, 6], 40], ["largeStraight", [1, 2, 3, 4, 6], 0],
        ["fiver", [6, 6, 6, 6, 6], 50], ["fiver", [6, 6, 6, 6, 5], 0],
        ["chance", [1, 2, 3, 4, 6], 16]
    ];
    for (const [category, dice, expected] of cases) assert.equal(scoreFor(category, dice), expected, `${category} ${dice}`);
    // Straßen nur aus einem Wurf (fresh = false: beim letzten Wurf war etwas gehalten)
    assert.equal(scoreFor("smallStraight", [1, 2, 3, 4, 4], false), 0);
    assert.equal(scoreFor("largeStraight", [2, 3, 4, 5, 6], false), 0);
    assert.equal(scoreFor("chance", [2, 3, 4, 5, 6], false), 20);
});

await test("oberer Bonus ab 63, Gesamtsumme mit Extra-Fünferpasch", () => {
    const sheet = emptySheet();
    Object.assign(sheet, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 17 });
    assert.equal(totals(sheet).bonus, 0, "62 reichen nicht");
    sheet.sixes = 18;
    assert.deepEqual(totals(sheet, 50), { upper: 63, bonus: 35, lower: 0, extra: 50, total: 148 });
    assert.deepEqual(Object.keys(potentials({ ...emptySheet(), ones: 2 }, [1, 1, 1, 1, 1])).length, 12);
});

section("Regeln");

await test("Start: Bots dazu, alle Zettel leer, Zeitlimit nur für Menschen", () => {
    const state = startGame({ players: [anna, ben], bots: 2 });
    assert.equal(state.phase, "playing");
    assert.equal(state.players.length, 4);
    assert.ok(state.players.slice(2).every(p => p.bot && p.name.startsWith("🤖")));
    assert.equal(find(state, anna).turnEndsAt, T0 + TURN_MS);
    assert.equal(state.players[2].turnEndsAt, null);
    assert.throws(() => act(game.createState({ players: [anna, ben] }), ben, { type: "start" }), /Host/);
    assert.throws(() => act(game.createState({ players: [anna] }), anna, { type: "settings", bots: 8 }), /0 bis 7/);
});

await test("Würfeln: erster Wurf alle, gehaltene Würfel bleiben, höchstens 3 Würfe", () => {
    let state = startGame();
    assert.throws(() => act(state, anna, { type: "score", category: "chance" }), /Erst würfeln/);
    assert.throws(() => act(state, anna, { type: "hold", held: [true, false, false, false, false] }), /Erst würfeln/);
    script(2, 2, 5, 6, 1);
    state = act(state, anna, { type: "roll", held: [true, true, true, true, true] }); // beim ersten Wurf zählt Halten nicht
    assert.deepEqual(find(state, anna).turn.dice, [2, 2, 5, 6, 1]);
    state = act(state, anna, { type: "hold", held: [true, true, false, false, false] });
    assert.deepEqual(find(state, anna).turn.held, [true, true, false, false, false]);
    script(2, 3, 4);
    state = act(state, anna, { type: "roll", held: [true, true, false, false, false] });
    assert.deepEqual(find(state, anna).turn.dice, [2, 2, 2, 3, 4]);
    assert.throws(() => act(state, anna, { type: "roll", held: [true, true, true, true, true] }), /Alle Würfel sind gehalten/);
    script(2, 2);
    state = act(state, anna, { type: "roll", held: [true, true, true, false, false] });
    assert.equal(find(state, anna).turn.rolls, MAX_ROLLS);
    assert.throws(() => act(state, anna, { type: "roll", held: [false, false, false, false, false] }), /Mehr als 3/);
    assert.throws(() => act(state, anna, { type: "roll", held: [true] }), /Ungültige/);
});

await test("Eintragen: Punkte, neuer Zug, belegtes Feld wird abgelehnt, Streichen gibt 0", () => {
    let state = startGame();
    script(6, 6, 6, 6, 6);
    state = act(state, anna, { type: "roll" });
    state = act(state, anna, { type: "score", category: "fiver" }, T0 + 5000);
    const me = find(state, anna);
    assert.equal(me.sheet.fiver, 50);
    assert.deepEqual(me.turn, { dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false], rolls: 0, fresh: false });
    assert.equal(me.turnEndsAt, T0 + 5000 + TURN_MS, "neues Zeitlimit je Feld");
    script(1, 2, 3, 4, 6);
    state = act(state, anna, { type: "roll" });
    assert.throws(() => act(state, anna, { type: "score", category: "fiver" }), /schon belegt/);
    assert.throws(() => act(state, anna, { type: "score", category: "joker" }), /Unbekanntes Feld/);
    state = act(state, anna, { type: "score", category: "fullHouse" });
    assert.equal(find(state, anna).sheet.fullHouse, 0);
});

await test("Straße zählt nur, wenn alle fünf Würfel im selben Wurf fielen", () => {
    let state = startGame();
    script(2, 3, 4, 1, 1);
    state = act(state, anna, { type: "roll" });
    assert.equal(find(state, anna).turn.fresh, true);
    script(5, 6);
    state = act(state, anna, { type: "roll", held: [true, true, true, false, false] });
    assert.deepEqual(find(state, anna).turn.dice, [2, 3, 4, 5, 6]);
    assert.equal(find(state, anna).turn.fresh, false);
    assert.equal(game.viewFor(state, anna.id).players[0].potentials.largeStraight, 0);
    state = act(state, anna, { type: "score", category: "largeStraight" });
    assert.equal(find(state, anna).sheet.largeStraight, 0, "mit gehaltenen Würfeln keine Straße");
    script(6, 6, 6, 6, 6, 1, 2, 3, 4, 5);
    state = act(state, anna, { type: "roll" });
    state = act(state, anna, { type: "roll", held: [false, false, false, false, false] });
    assert.equal(find(state, anna).turn.fresh, true, "alle neu gewürfelt zählt wieder");
    state = act(state, anna, { type: "score", category: "smallStraight" });
    assert.equal(find(state, anna).sheet.smallStraight, 30);
});

await test("Extra-Fünferpasch: +50, wenn das Feld schon 50 hat – nicht nach einer gestrichenen 0", () => {
    let state = startGame({ players: [anna, ben] });
    script(4, 4, 4, 4, 4);
    state = act(state, anna, { type: "roll" });
    state = act(state, anna, { type: "score", category: "fiver" });
    script(4, 4, 4, 4, 4);
    state = act(state, anna, { type: "roll" });
    state = act(state, anna, { type: "score", category: "fours" });
    assert.equal(find(state, anna).extra, 50);
    assert.equal(find(state, anna).sheet.fours, 20);
    script(1, 2, 3, 5, 6);
    state = act(state, ben, { type: "roll" });
    state = act(state, ben, { type: "score", category: "fiver" });
    script(3, 3, 3, 3, 3);
    state = act(state, ben, { type: "roll" });
    state = act(state, ben, { type: "score", category: "threes" });
    assert.equal(find(state, ben).extra, 0);
});

await test("gleichzeitig: jeder würfelt unabhängig; Ende, wenn alle Zettel voll sind", () => {
    let state = startGame({ players: [anna, ben] });
    script(1, 1, 1, 1, 1);
    state = act(state, ben, { type: "roll" });
    assert.equal(find(state, anna).turn.rolls, 0, "Annas Zug bleibt unberührt");
    state = fillSheet(state, anna);
    assert.equal(state.phase, "playing", "Ben ist noch nicht fertig");
    assert.throws(() => act(state, anna, { type: "roll" }), /schon voll/);
    state = fillSheet(state, ben);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "finished");
});

await test("nacheinander: nur wer dran ist würfelt, danach der Nächste; Ende nach allen Zetteln", () => {
    assert.throws(() => act(game.createState({ players: [anna] }), anna, { type: "settings", mode: "chaos" }), /Spielmodus/);
    let state = startGame({ players: [anna, ben], mode: "nacheinander" });
    assert.equal(state.mode, "nacheinander");
    assert.equal(state.currentId, anna.id);
    assert.equal(find(state, anna).turnEndsAt, T0 + TURN_MS);
    assert.equal(find(state, ben).turnEndsAt, null, "Ben hat noch keine Uhr");
    assert.throws(() => act(state, ben, { type: "roll" }), /nicht dran/);
    script(3, 3, 3, 2, 2);
    state = act(state, anna, { type: "roll" });
    state = act(state, anna, { type: "score", category: "fullHouse" }, T0 + 4000);
    assert.equal(state.currentId, ben.id);
    assert.deepEqual(find(state, anna).turn.dice, [3, 3, 3, 2, 2], "Annas Würfel bleiben liegen");
    assert.equal(find(state, anna).turnEndsAt, null);
    assert.equal(find(state, ben).turnEndsAt, T0 + 4000 + TURN_MS);
    assert.throws(() => act(state, anna, { type: "roll" }), /nicht dran/);
    script(1, 1, 1, 1, 1);
    state = act(state, ben, { type: "roll" });
    state = act(state, ben, { type: "score", category: "ones" });
    assert.equal(state.currentId, anna.id);
    assert.equal(find(state, anna).turn.rolls, 0, "neuer Zug beginnt leer");
    for (let round = 0; round < 12; round++) {
        for (const player of [anna, ben]) {
            const category = CATEGORIES.find(c => find(state, player).sheet[c] === null);
            script(1, 1, 1, 1, 1);
            state = act(state, player, { type: "roll" });
            state = act(state, player, { type: "score", category });
        }
    }
    assert.equal(state.phase, "finished");
    assert.equal(state.currentId, null);
});

await test("nacheinander: Bots nur in ihrem Zug, Verlassen gibt den Zug weiter", () => {
    setRandom(null);
    let state = startGame({ players: [anna, ben], bots: 1, mode: "nacheinander" });
    const bot = state.players[2];
    assert.equal(bot.nextBotAt, null, "Bot wartet");
    assert.equal(game.tick(state, { now: T0 + 60_000 }), undefined);
    state = game.onPlayerLeave(state, anna);
    assert.equal(state.currentId, ben.id);
    script(2, 2, 2, 2, 2);
    state = act(state, ben, { type: "roll" }, T0 + 1000);
    state = act(state, ben, { type: "score", category: "twos" }, T0 + 1000);
    assert.equal(state.currentId, bot.id);
    assert.equal(find(state, bot).nextBotAt >= T0 + 1000 + BOT_STEP_SEQ_MS, true);
    setRandom(null);
    let now = T0 + 1000;
    for (let i = 0; state.currentId === bot.id && i < 20; i++) {
        now += BOT_STEP_SEQ_MS + BOT_JITTER_MS;
        state = game.tick(state, { now }) ?? state;
    }
    assert.equal(state.currentId, ben.id, "nach dem Bot ist wieder Ben dran");
    assert.equal(scoring.filledCount(find(state, bot).sheet), 1);
    // Zeitlimit im Zug von Ben
    state = game.tick(state, { now: now + TURN_MS + 10 }) ?? state;
    assert.equal(scoring.filledCount(find(state, ben).sheet), 2);
    assert.equal(state.currentId, bot.id);
});

section("Zeitlimit und Bots");

await test("Zeit abgelaufen: der Zug wird automatisch gewürfelt und eingetragen", () => {
    setRandom(null);
    let state = startGame();
    assert.equal(game.tick(state, { now: T0 + TURN_MS - 1 }), undefined);
    state = game.tick(state, { now: T0 + TURN_MS });
    assert.equal(scoring.filledCount(find(state, anna).sheet), 1);
    assert.equal(find(state, anna).turn.rolls, 0);
    assert.match(state.log.at(-1), /Zeit abgelaufen/);
    assert.equal(find(state, anna).turnEndsAt, T0 + 2 * TURN_MS);
});

await test("Bots handeln nach ihrer Pause und spielen eine Partie zu Ende (alle Stufen)", () => {
    setRandom(null);
    for (const botLevel of ["leicht", "mittel", "schwer"]) {
        let state = startGame({ bots: 2, botLevel });
        state = fillSheet(state, anna);
        setRandom(null);
        assert.equal(game.tick(state, { now: T0 + BOT_STEP_MS - 1 }), undefined, "noch keine Bot-Aktion");
        let now = T0;
        for (let i = 0; state.phase === "playing" && i < 2000; i++) {
            now += BOT_STEP_MS + BOT_JITTER_MS;
            state = game.tick(state, { now }) ?? state;
        }
        assert.equal(state.phase, "finished", botLevel);
        assert.ok(state.players.filter(p => p.bot).every(p => scoring.filledCount(p.sheet) === 13));
    }
});

await test("„schwer“ schlägt „leicht“ im Schnitt; Entscheidungen schnell", () => {
    setRandom(null);
    const die = () => 1 + Math.floor(Math.random() * 6);
    const play = level => {
        const sheet = emptySheet();
        let maxMs = 0;
        for (let r = 0; r < 13; r++) {
            const turn = { dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false], rolls: 0, fresh: false };
            for (;;) {
                const t0 = performance.now();
                const d = bots.decide(sheet, turn, level);
                maxMs = Math.max(maxMs, performance.now() - t0);
                if (d.type === "score") {
                    sheet[d.category] = scoreFor(d.category, turn.dice, turn.fresh);
                    break;
                }
                turn.dice = turn.dice.map((v, i) => (d.held[i] && turn.rolls > 0 ? v : die()));
                turn.fresh = turn.rolls === 0 || d.held.every(h => !h);
                turn.rolls += 1;
            }
        }
        return { total: totals(sheet).total, maxMs };
    };
    bots.warmUp();
    const avg = (level, n) => {
        let sum = 0;
        let maxMs = 0;
        for (let i = 0; i < n; i++) {
            const r = play(level);
            sum += r.total;
            maxMs = Math.max(maxMs, r.maxMs);
        }
        return { avg: sum / n, maxMs };
    };
    const easy = avg("leicht", 60);
    const hard = avg("schwer", 40);
    assert.ok(hard.avg > easy.avg + 30, `schwer ${hard.avg.toFixed(0)} vs. leicht ${easy.avg.toFixed(0)}`);
    assert.ok(hard.maxMs < 50, `${hard.maxMs.toFixed(1)} ms`);
});

await test("Bot nimmt eine fertige Große Straße und hält ein Viererpasch zusammen", () => {
    const sheet = emptySheet();
    for (const level of ["mittel", "schwer"]) {
        assert.deepEqual(bots.decide(sheet, { dice: [2, 3, 4, 5, 6], held: [], rolls: 1, fresh: true }, level), { type: "score", category: "largeStraight" });
        const notFresh = bots.decide(sheet, { dice: [2, 3, 4, 5, 6], held: [], rolls: 3, fresh: false }, level);
        assert.notEqual(notFresh.category, "largeStraight", "gehaltene Straße zählt nicht");
        const d = bots.decide(sheet, { dice: [6, 6, 2, 6, 6], held: [], rolls: 1 }, level);
        assert.equal(d.type, "roll");
        assert.deepEqual(d.held, [true, true, false, true, true], level);
    }
});

section("Wertung und Verlassen");

await test("placements nach Punkten, bei Gleichstand zählt der obere Teil", () => {
    let state = startGame({ players: [anna, ben] });
    for (const p of state.players) p.sheet = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
    find(state, anna).sheet.chance = 100;
    find(state, ben).sheet.sixes = 30;
    find(state, ben).sheet.fives = 15;
    find(state, ben).sheet.fours = 20;   // oben 65 → +35 = 100
    find(state, anna).sheet.ones = null;
    find(state, anna).sheet.chance = 100;
    script(1, 2, 3, 4, 6);
    state = act(state, anna, { type: "roll" });
    state = act(state, anna, { type: "score", category: "ones" });
    assert.equal(state.phase, "finished");
    // Anna 101 (1 + 100), Ben 100
    assert.deepEqual(state.result.placements, [anna.id, ben.id]);
    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
    assert.deepEqual(state.players, []);
});

await test("Verlassen: zählt nicht mehr; ohne Menschen endet die Partie", () => {
    let state = startGame({ players: [anna, ben], bots: 1 });
    state = fillSheet(state, anna);
    state = game.onPlayerLeave(state, ben);
    assert.equal(find(state, ben).left, true);
    assert.equal(state.phase, "playing", "der Bot spielt noch");
    state = game.onPlayerLeave(state, anna);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "aborted");
});

await test("viewFor: Summen, fertig-Flag und Restzeit statt Zeitpunkten", () => {
    const state = startGame({ bots: 1 });
    const view = game.viewFor(state, anna.id);
    const me = view.players.find(p => p.id === anna.id);
    assert.equal(me.turnEndsAt, undefined);
    assert.equal(me.nextBotAt, undefined);
    assert.equal(me.totals.total, 0);
    assert.equal(me.done, false);
    assert.equal(me.potentials, null, "vor dem Wurf keine möglichen Punkte");
    assert.ok(me.turnRemainingMs <= TURN_MS);
});

setRandom(null);
process.exit(summary());
