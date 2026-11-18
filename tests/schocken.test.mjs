/**
 * Logik-Test für Schocken – lädt games/schocken/game.js direkt
 * (ohne Server) und prüft Wertung, Züge, Deckel, Hälften, Sichtbarkeit und Bots.
 *
 * Start:  npm run test:schocken   bzw.  node tests/schocken.test.mjs
 * Dauer:  ca. 1 Sekunde
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "schocken", "game.js"));
const { classify, compareEntries, setRandom, TOTAL_CHIPS, TURN_MS, REVEAL_MS } = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const NOW = 1_000_000;
const ctx = (now = NOW) => ({ hostId: anna.id, now });

/** Würfel fest vorgeben: die Werte werden der Reihe nach "gewürfelt". */
function scriptDice(...values) {
    const queue = [...values];
    setRandom(() => {
        if (queue.length === 0) throw new Error("Keine Würfel mehr im Skript");
        return queue.shift();
    });
}

const act = (state, player, action, now = NOW) => game.handleAction(state, action, player, ctx(now));

/** Partie starten; Laden wird mit festen Würfeln erledigt, Ergebnis: Runde 2 läuft. */
function startMatch({ players = [anna, ben], bots = 0, mode = "full" } = {}) {
    let state = game.createState({ players, hostId: anna.id });
    state = act(state, anna, { type: "settings", bots, mode });
    state = act(state, anna, { type: "start" });
    return state;
}

/** Spieler am Zug. */
const current = state => state.round.order[state.round.turnIndex];
const byId = id => [anna, ben, cleo].find(p => p.id === id);

/** Spielt eine Runde: jeder würfelt einmal mit den angegebenen Würfen (optional aufgedeckt). */
function playRound(state, throwsById, { look = false } = {}) {
    while (state.round.stage === "turns") {
        const id = current(state);
        scriptDice(...throwsById[id]);
        state = act(state, byId(id), { type: "roll" });
        if (look) state = act(state, byId(id), { type: "look" });
        state = act(state, byId(id), { type: "finish" });
    }
    return state;
}

/** Nach der Auswertung weiter (tick nach der Pause). */
function nextRound(state) {
    return game.tick(state, { now: state.nextRoundAt }) ?? state;
}

const chipsOf = (state, id) => state.participants.find(p => p.id === id).chips;

// ===========================================================================
section("Wertung");
// ===========================================================================
await test("Wurfarten und Deckelwerte", async () => {
    assert.deepEqual(pick(classify([1, 1, 1], false)), ["schock-aus", TOTAL_CHIPS, "Schock Aus"]);
    assert.deepEqual(pick(classify([1, 6, 1], false)), ["schock", 6, "Schock 6"]);
    assert.deepEqual(pick(classify([2, 1, 1], false)), ["schock", 2, "Schock 2"]);
    assert.deepEqual(pick(classify([4, 4, 4], true)), ["general", 3, "General (4er)"]);
    assert.deepEqual(pick(classify([5, 3, 4], true)), ["strasse", 2, "Straße 3-4-5"]);
    assert.deepEqual(pick(classify([1, 2, 3], true)), ["strasse", 2, "Straße 1-2-3"]);
    assert.deepEqual(pick(classify([6, 4, 5], true)), ["strasse", 2, "Straße 4-5-6"]);
    assert.deepEqual(pick(classify([2, 6, 5], true)), ["zahlen", 1, "6-5-2"]);
});
await test("General und Straße nur aus der Hand", async () => {
    assert.equal(classify([4, 4, 4], false).kind, "zahlen");
    assert.equal(classify([3, 4, 5], false).kind, "zahlen");
    assert.equal(classify([1, 1, 5], false).kind, "schock"); // Schock darf gebaut werden
});
await test("Klassische Rangfolge", async () => {
    const order = [
        classify([1, 1, 1], false), classify([1, 1, 6], false), classify([1, 1, 2], false),
        classify([6, 6, 6], true), classify([2, 2, 2], true), classify([4, 5, 6], true),
        classify([1, 2, 3], true), classify([6, 6, 5], true), classify([6, 5, 4], false), classify([3, 2, 1], false)
    ];
    for (let i = 1; i < order.length; i++) {
        assert.ok(order[i - 1].rank > order[i].rank, `${order[i - 1].label} > ${order[i].label}`);
    }
});
await test("Gleichstand: weniger Würfe, dann frühere Position", async () => {
    const a = { rank: 803, throws: 2, order: 0 };
    const b = { rank: 803, throws: 1, order: 1 };
    const c = { rank: 803, throws: 1, order: 2 };
    assert.deepEqual([a, b, c].sort(compareEntries), [b, c, a]);
});

function pick(result) {
    return [result.kind, result.chips, result.label];
}

// ===========================================================================
section("Laden und Züge");
// ===========================================================================
await test("Laden: jeder nur ein Wurf, Verlierer bekommt Deckel aus dem Topf", async () => {
    let state = startMatch();
    assert.equal(state.round.laden, true);
    const first = current(state);
    scriptDice(6, 5, 4);
    state = act(state, byId(first), { type: "roll" });
    assert.throws(() => act(state, byId(first), { type: "roll" }), /einmal/);
    state = act(state, byId(first), { type: "look" });
    state = act(state, byId(first), { type: "finish" });
    assert.equal(state.round.firstOpen, true, "Erster hat aufgedeckt");
    const second = current(state);
    scriptDice(3, 2, 2);
    state = act(state, byId(second), { type: "roll" });
    state = act(state, byId(second), { type: "finish" });
    assert.equal(state.round.stage, "reveal");
    assert.equal(state.reveal.loserId, second);
    assert.equal(chipsOf(state, second), 2); // Straße 4-5-6 = 2 Deckel
    assert.equal(state.match.pot, TOTAL_CHIPS - 2);
    state = nextRound(state);
    assert.equal(current(state), second, "Verlierer beginnt");
    assert.equal(state.round.laden, false);
});

await test("Nicht am Zug / Herauslegen / Vorgabe der Wurfanzahl", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    const first = current(state);
    const second = state.round.order[1];
    assert.throws(() => act(state, byId(second), { type: "roll" }), /nicht an der Reihe/);

    scriptDice(1, 4, 5);
    state = act(state, byId(first), { type: "roll" });
    assert.throws(() => act(state, byId(first), { type: "roll", aside: [0] }), /erst aufdecken/);
    state = act(state, byId(first), { type: "look" });
    assert.throws(() => act(state, byId(first), { type: "look" }), /schon aufgedeckt/);
    assert.throws(() => act(state, byId(first), { type: "roll", aside: [1] }), /Nur Einsen/);
    scriptDice(1, 3);
    state = act(state, byId(first), { type: "roll", aside: [0] });
    assert.deepEqual(state.round.turns[first].dice, [1, 1, 3]);
    assert.equal(state.round.turns[first].open, false, "nach dem Wurf ist der Becher wieder zu");
    assert.equal(state.round.turns[first].result.label, "Schock 3");
    state = act(state, byId(first), { type: "finish" });
    assert.equal(state.round.maxThrows, 2, "Vorgabe = 2 Würfe");
    assert.equal(state.round.firstOpen, false, "Erster hat verdeckt beendet");

    scriptDice(2, 3, 4);
    state = act(state, byId(second), { type: "roll" });
    scriptDice(2, 2, 2);
    state = act(state, byId(second), { type: "roll" });
    assert.throws(() => act(state, byId(second), { type: "roll" }), /Mehr als 2/);
});

await test("Sechsen drehen: zwei Sechsen → eine Eins, dann muss neu gewürfelt werden", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    const first = current(state);
    scriptDice(6, 6, 2);
    state = act(state, byId(first), { type: "roll" });
    assert.throws(() => act(state, byId(first), { type: "turn-sixes" }), /erst aufdecken/);
    state = act(state, byId(first), { type: "look" });
    state = act(state, byId(first), { type: "turn-sixes" });
    const turn = state.round.turns[first];
    assert.deepEqual(turn.dice, [1, 6, 2]);
    assert.deepEqual(turn.aside, [true, false, false]);
    assert.throws(() => act(state, byId(first), { type: "finish" }), /noch einmal/);
    assert.throws(() => act(state, byId(first), { type: "turn-sixes" }), /Sechsen drehen/);
    scriptDice(1, 4);
    state = act(state, byId(first), { type: "roll" });
    assert.equal(state.round.turns[first].result.label, "Schock 4");
});

await test("Drei Sechsen → zwei Einsen; nicht im letzten Wurf", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    const first = current(state);
    scriptDice(6, 6, 6);
    state = act(state, byId(first), { type: "roll" });
    state = act(state, byId(first), { type: "look" });
    state = act(state, byId(first), { type: "turn-sixes" });
    assert.deepEqual(state.round.turns[first].dice, [1, 1, 6]);
    scriptDice(5);
    state = act(state, byId(first), { type: "roll" });
    state = act(state, byId(first), { type: "finish" }); // Vorgabe: 2 Würfe

    const second = current(state);
    scriptDice(4, 4, 1);
    state = act(state, byId(second), { type: "roll" });
    state = act(state, byId(second), { type: "look" });
    scriptDice(6, 6);
    state = act(state, byId(second), { type: "roll", aside: [2] }); // letzter erlaubter Wurf
    state = act(state, byId(second), { type: "look" });
    assert.throws(() => act(state, byId(second), { type: "turn-sixes" }), /letzten Wurf/);
});

// ===========================================================================
section("Deckel und Hälften");
// ===========================================================================
await test("Topf leer: Bester gibt Deckel an Verlierer", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    // Zustand konstruieren: Topf leer, Anna 7, Ben 6
    state.match.pot = 0;
    state.participants.find(p => p.id === anna.id).chips = 7;
    state.participants.find(p => p.id === ben.id).chips = 6;
    state = playRound(state, { [anna.id]: [1, 1, 5], [ben.id]: [6, 4, 2] });
    assert.equal(chipsOf(state, anna.id), 2);
    assert.equal(chipsOf(state, ben.id), 11);
    assert.equal(state.reveal.halfLoserId, null);
});

await test("Schock Aus: Verlierer bekommt alle Deckel, Hälfte endet", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    state = playRound(state, { [anna.id]: [1, 1, 1], [ben.id]: [6, 4, 2] });
    assert.equal(chipsOf(state, ben.id), TOTAL_CHIPS);
    assert.equal(chipsOf(state, anna.id), 0);
    assert.equal(state.reveal.halfLoserId, ben.id);
    state = nextRound(state);
    assert.equal(state.match.stage, "half2");
    assert.equal(state.match.pot, TOTAL_CHIPS);
    assert.equal(state.participants.find(p => p.id === ben.id).marker, true);
    assert.equal(current(state), ben.id, "Verlierer beginnt die 2. Hälfte");
});

await test("Gleicher Verlierer beider Hälften verliert die Partie", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    state = nextRound(playRound(state, { [anna.id]: [1, 1, 1], [ben.id]: [6, 4, 2] }));
    state = nextRound(playRound(state, { [anna.id]: [1, 1, 1], [ben.id]: [6, 4, 2] }));
    assert.equal(state.phase, "finished");
    assert.equal(state.result.loserId, ben.id);
});

await test("Verschiedene Verlierer → Finale nur zwischen den beiden", async () => {
    let state = startMatch({ players: [anna, ben, cleo] });
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5], [cleo.id]: [6, 6, 5] }));
    state = nextRound(playRound(state, { [anna.id]: [1, 1, 1], [ben.id]: [6, 4, 2], [cleo.id]: [6, 5, 4] }));
    assert.equal(state.match.stage, "half2");
    state = nextRound(playRound(state, { [anna.id]: [6, 4, 2], [ben.id]: [1, 1, 1], [cleo.id]: [6, 5, 4] }));
    assert.equal(state.match.stage, "finale");
    assert.deepEqual([...state.match.active].sort(), [anna.id, ben.id].sort());
    assert.equal(current(state), ben.id, "Verlierer der 1. Hälfte beginnt das Finale");
    assert.ok(!state.round.order.includes(cleo.id));
    state = nextRound(playRound(state, { [anna.id]: [1, 1, 1], [ben.id]: [6, 4, 2] }));
    assert.equal(state.phase, "finished");
    assert.equal(state.result.loserId, ben.id);
});

await test("Modus „Eine Hälfte“: Partie endet nach der Hälfte", async () => {
    let state = startMatch({ mode: "half" });
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    state = nextRound(playRound(state, { [anna.id]: [1, 1, 1], [ben.id]: [6, 4, 2] }));
    assert.equal(state.phase, "finished");
    assert.equal(state.result.loserId, ben.id);
});

// ===========================================================================
section("Sichtbarkeit, Timer, Verlassen");
// ===========================================================================
await test("viewFor: Becher zu → niemand sieht die Würfel, auch nicht der Werfer", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    const first = current(state);
    const other = state.round.order[1];
    scriptDice(1, 4, 5);
    state = act(state, byId(first), { type: "roll" });
    for (const viewer of [first, other]) {
        const turn = game.viewFor(state, viewer).round.turns[first];
        assert.deepEqual(turn.dice, [0, 0, 0], `Sicht von ${viewer}`);
        assert.equal(turn.result, null);
    }

    state = act(state, byId(first), { type: "look" });
    for (const viewer of [first, other]) {
        assert.deepEqual(game.viewFor(state, viewer).round.turns[first].dice, [1, 4, 5], "aufgedeckt → alle sehen es");
    }

    scriptDice(3, 2);
    state = act(state, byId(first), { type: "roll", aside: [0] });
    for (const viewer of [first, other]) {
        assert.deepEqual(game.viewFor(state, viewer).round.turns[first].dice, [1, 0, 0], "nur die herausgelegte Eins");
    }
    assert.ok(!JSON.stringify(game.viewFor(state, first)).includes('"dice":[1,3,2]'));
});

await test("Blind weiterwürfeln ist erlaubt (ohne Aufdecken, ohne Herauslegen)", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    const first = current(state);
    scriptDice(2, 4, 5);
    state = act(state, byId(first), { type: "roll" });
    scriptDice(1, 1, 1);
    state = act(state, byId(first), { type: "roll" });
    assert.equal(state.round.turns[first].throws, 2);
    assert.equal(state.round.turns[first].result.label, "Schock Aus");
    assert.equal(state.round.turns[first].hand, true);
});

await test("Verdeckt gelassen bleibt verdeckt bis zur Auswertung", async () => {
    let state = startMatch();
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] }));
    const first = current(state);
    const other = state.round.order[1];
    scriptDice(5, 5, 2);
    state = act(state, byId(first), { type: "roll" });
    state = act(state, byId(first), { type: "finish" });
    assert.deepEqual(game.viewFor(state, other).round.turns[first].dice, [0, 0, 0]);
    assert.deepEqual(game.viewFor(state, first).round.turns[first].dice, [0, 0, 0], "auch für den Werfer");
    scriptDice(3, 3, 2);
    state = act(state, byId(other), { type: "roll" });
    state = act(state, byId(other), { type: "finish" });
    assert.equal(state.round.stage, "reveal");
    assert.deepEqual(game.viewFor(state, other).round.turns[first].dice, [5, 5, 2]);
});

await test("Erster deckt auf → die anderen müssen beim Beenden aufdecken", async () => {
    let state = startMatch({ players: [anna, ben, cleo] });
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5], [cleo.id]: [6, 6, 5] }));
    const [first, second, third] = state.round.order;
    scriptDice(5, 4, 2);
    state = act(state, byId(first), { type: "roll" });
    state = act(state, byId(first), { type: "look" });
    state = act(state, byId(first), { type: "finish" });
    assert.equal(state.round.firstOpen, true);

    scriptDice(3, 3, 2);
    state = act(state, byId(second), { type: "roll" });
    state = act(state, byId(second), { type: "finish" }); // "verdeckt" beendet → wird aufgedeckt
    assert.equal(state.round.turns[second].open, true);
    assert.deepEqual(game.viewFor(state, first).round.turns[second].dice, [3, 3, 2]);

    // Timer-Ablauf bei Aufdeck-Pflicht deckt ebenfalls auf
    scriptDice(6, 2, 2);
    state = game.tick(state, { now: state.round.turnEndsAt });
    assert.equal(state.round.turns[third].open, true);
});

await test("Erster verdeckt → die anderen dürfen verdeckt bleiben", async () => {
    let state = startMatch({ players: [anna, ben, cleo] });
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5], [cleo.id]: [6, 6, 5] }));
    const [first, second] = state.round.order;
    scriptDice(5, 4, 2);
    state = act(state, byId(first), { type: "roll" });
    state = act(state, byId(first), { type: "finish" });
    assert.equal(state.round.firstOpen, false);
    scriptDice(3, 3, 2);
    state = act(state, byId(second), { type: "roll" });
    state = act(state, byId(second), { type: "finish" });
    assert.equal(state.round.turns[second].open, false);
});

await test("„Weiter“: Schwelle 75 %, Doppelklick zählt nicht, Bots zählen nicht", async () => {
    assert.deepEqual([1, 2, 3, 4, 5, 8].map(game._internals.ackThreshold), [1, 2, 3, 3, 4, 6]);

    let state = startMatch();
    state = playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] });
    assert.equal(state.reveal.acks.length, 0);
    state = act(state, anna, { type: "continue" });
    assert.equal(state.round.stage, "reveal", "1 von 2 reicht nicht");
    assert.equal(act(state, anna, { type: "continue" }), undefined, "Doppelklick wird ignoriert");
    state = act(state, ben, { type: "continue" });
    assert.equal(state.round.stage, "turns", "2 von 2 → nächste Runde");
    assert.equal(act(state, ben, { type: "continue" }), undefined, "Klick nach der Auswertung wird ignoriert");

    // 1 Mensch + Bot: ein Klick reicht
    setRandom(null);
    let solo = startMatch({ players: [anna], bots: 1 });
    let now = NOW;
    while (solo.round.stage === "turns") {
        now += 1000;
        if (current(solo) === anna.id) {
            solo = act(solo, anna, { type: "roll" }, now);
            solo = act(solo, anna, { type: "finish" }, now);
        } else {
            solo = game.tick(solo, { now }) ?? solo;
        }
    }
    solo = act(solo, anna, { type: "continue" }, now);
    assert.equal(solo.round.stage, "turns");
});

await test("Auswertung: Restzeit wird übertragen, interner Zeitstempel nicht", async () => {
    let state = startMatch();
    state = playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] });
    const view = game.viewFor(state, anna.id);
    assert.equal(view.nextRoundAt, undefined);
    assert.ok(view.revealRemainingMs === 0 || view.revealRemainingMs > 0);
});

await test("Zugtimer: ohne Wurf wird automatisch gewürfelt und weitergegeben", async () => {
    let state = startMatch();
    const first = current(state);
    scriptDice(4, 4, 2);
    assert.equal(game.tick(state, { now: NOW + TURN_MS - 1 }), undefined);
    state = game.tick(state, { now: NOW + TURN_MS });
    assert.equal(state.round.turns[first].done, true);
    assert.equal(state.round.turns[first].throws, 1);
    assert.notEqual(current(state), first);
});

await test("Spieler verlässt während seines Zugs → Deckel in den Topf, nächster ist dran", async () => {
    let state = startMatch({ players: [anna, ben, cleo] });
    state = nextRound(playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5], [cleo.id]: [6, 6, 5] }));
    const first = current(state);
    const chipsBefore = chipsOf(state, first);
    const potBefore = state.match.pot;
    state = game.onPlayerLeave(state, byId(first));
    assert.equal(state.phase, "playing");
    assert.ok(!state.round.order.includes(first));
    assert.notEqual(current(state), first);
    assert.equal(state.match.pot, potBefore + chipsBefore);
});

await test("Nur noch ein Mensch ohne Bots → Partie beendet", async () => {
    let state = startMatch();
    state = game.onPlayerLeave(state, ben);
    assert.equal(state.phase, "finished");
});

// ===========================================================================
section("Bots");
// ===========================================================================
await test("Bots spielen eine komplette Partie bis zum Ende", async () => {
    setRandom(null); // echter Zufall
    for (let run = 0; run < 20; run++) {
        let state = startMatch({ players: [anna], bots: 4 });
        let now = NOW;
        let steps = 0;
        while (state.phase === "playing" && steps < 20000) {
            // Anna verhält sich passiv → der Zugtimer erledigt ihre Züge.
            const annasTurn = state.round.stage === "turns" && current(state) === anna.id;
            now += annasTurn ? TURN_MS : 1000;
            state = game.tick(state, { now }) ?? state;
            steps++;
            const total = state.match ? state.match.pot + state.participants.reduce((s, p) => s + p.chips, 0) : TOTAL_CHIPS;
            assert.equal(total, TOTAL_CHIPS, "Deckel bleiben erhalten");
        }
        assert.equal(state.phase, "finished", `Lauf ${run}: Partie nach ${steps} Schritten nicht beendet`);
        assert.ok(state.result.loserId);
        JSON.stringify(state); // muss serialisierbar sein
    }
});

await test("Auswertungs-Pause dauert REVEAL_MS", async () => {
    let state = startMatch();
    state = playRound(state, { [anna.id]: [6, 5, 3], [ben.id]: [2, 3, 5] });
    assert.equal(state.nextRoundAt, NOW + REVEAL_MS);
    assert.equal(game.tick(state, { now: NOW + REVEAL_MS - 1 }), undefined);
});

setRandom(null);
process.exit(summary());
