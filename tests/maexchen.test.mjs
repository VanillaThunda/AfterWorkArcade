/**
 * Logik-Test für Mäxchen – lädt games/maexchen/game.js direkt (ohne Server)
 * und prüft Wertung, Ansagen, Aufdecken, Leben, Sichtbarkeit, Timer und Bots.
 *
 * Start:  npm run test:maexchen   bzw.  node tests/maexchen.test.mjs
 * Dauer:  unter 1 Sekunde
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "maexchen", "game.js"));
const { VALUES, valueOf, rankOf, labelOf, setRandom, TURN_MS, BOT_STEP_MS, REVEAL_MS, PROB_AT_LEAST } = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const NOW = 1_000_000;
const ctx = (now = NOW) => ({ hostId: anna.id, now });
const people = [anna, ben, cleo];
const byId = id => people.find(p => p.id === id);

/** Würfel fest vorgeben: die Werte werden der Reihe nach "gewürfelt". */
function scriptDice(...values) {
    const queue = [...values];
    setRandom(() => {
        if (queue.length === 0) throw new Error("Keine Würfel mehr im Skript");
        return queue.shift();
    });
}

const act = (state, player, action, now = NOW) => game.handleAction(state, action, player, ctx(now));
const current = state => state.round.order[state.round.index];
const currentPlayer = state => byId(current(state));
const livesOf = (state, id) => state.participants.find(p => p.id === id).lives;

function startMatch({ players = [anna, ben], bots = 0, lives = 3 } = {}) {
    let state = game.createState({ players, hostId: anna.id });
    state = act(state, anna, { type: "settings", bots, lives });
    return act(state, anna, { type: "start" });
}

/** Aktueller Spieler würfelt (vorgegebene Würfel) und sagt `value` an. */
function rollAndAnnounce(state, dice, value) {
    scriptDice(...dice);
    const player = currentPlayer(state);
    state = act(state, player, { type: "roll" });
    return act(state, player, { type: "announce", value });
}

// ===========================================================================
section("Wertung");
// ===========================================================================
await test("Wert aus zwei Würfeln", async () => {
    assert.equal(valueOf([3, 5]), 53);
    assert.equal(valueOf([5, 3]), 53);
    assert.equal(valueOf([1, 2]), 21);
    assert.equal(valueOf([4, 4]), 44);
    assert.equal(valueOf([6, 1]), 61);
});
await test("Rangfolge: Mäxchen > Pasch > 65 > 31", async () => {
    assert.equal(VALUES.length, 21);
    assert.ok(rankOf(21) > rankOf(66));
    assert.ok(rankOf(66) > rankOf(11));
    assert.ok(rankOf(11) > rankOf(65));
    assert.ok(rankOf(65) > rankOf(54));
    assert.ok(rankOf(32) > rankOf(31));
    assert.equal(rankOf(31), 0);
    assert.equal(rankOf(12), -1, "12 gibt es nicht (heißt 21)");
    assert.equal(labelOf(21), "Mäxchen");
    assert.equal(labelOf(33), "3er-Pasch");
});
await test("Wahrscheinlichkeiten: jeder Wurf ≥ 31, Mäxchen 2/36", async () => {
    assert.equal(PROB_AT_LEAST[0], 1);
    assert.equal(PROB_AT_LEAST[rankOf(21)], 2 / 36);
});

// ===========================================================================
section("Ablauf");
// ===========================================================================
await test("Start: Teilnehmer mit Leben, Runde beginnt mit Würfeln", async () => {
    const state = startMatch({ bots: 1, lives: 2 });
    assert.equal(state.phase, "playing");
    assert.equal(state.participants.length, 3);
    assert.ok(state.participants.every(p => p.lives === 2 && !p.out));
    assert.equal(state.round.stage, "roll");
    assert.equal(state.round.announcement, null);
});
await test("Start allein ohne Bots wird abgelehnt", async () => {
    let state = game.createState({ players: [anna], hostId: anna.id });
    state = act(state, anna, { type: "settings", bots: 0 });
    assert.throws(() => act(state, anna, { type: "start" }), /mindestens 2/);
});
await test("Nur der Host stellt ein und startet", async () => {
    const state = game.createState({ players: [anna, ben], hostId: anna.id });
    assert.throws(() => act(state, ben, { type: "settings", bots: 1 }), /Host/);
    assert.throws(() => act(state, ben, { type: "start" }), /Host/);
    assert.throws(() => act(state, anna, { type: "settings", lives: 9 }), /Leben/);
});
await test("Nur wer am Zug ist, darf würfeln – Schritte in der richtigen Reihenfolge", async () => {
    let state = startMatch();
    const other = current(state) === anna.id ? ben : anna;
    assert.throws(() => act(state, other, { type: "roll" }), /nicht an der Reihe/);
    assert.throws(() => act(state, currentPlayer(state), { type: "announce", value: 31 }), /Erst würfeln/);
    scriptDice(3, 1);
    state = act(state, currentPlayer(state), { type: "roll" });
    assert.equal(state.round.stage, "announce");
    assert.throws(() => act(state, currentPlayer(state), { type: "roll" }), /Erst einen Wert ansagen/);
});
await test("Ansage muss höher sein als die vorige, ungültige Werte abgelehnt", async () => {
    let state = startMatch();
    state = rollAndAnnounce(state, [5, 4], 54);
    assert.equal(state.round.stage, "decide");
    state = act(state, currentPlayer(state), { type: "believe" });
    scriptDice(3, 2);
    state = act(state, currentPlayer(state), { type: "roll" });
    assert.throws(() => act(state, currentPlayer(state), { type: "announce", value: 54 }), /mehr als 54/);
    assert.throws(() => act(state, currentPlayer(state), { type: "announce", value: 43 }), /mehr als 54/);
    assert.throws(() => act(state, currentPlayer(state), { type: "announce", value: 77 }), /gibt es nicht/);
    state = act(state, currentPlayer(state), { type: "announce", value: 61 }); // Bluff
    assert.equal(state.round.announcement.value, 61);
});

// ===========================================================================
section("Aufdecken und Leben");
// ===========================================================================
await test("Gelogen → Ansager verliert ein Leben und beginnt die nächste Runde", async () => {
    let state = startMatch();
    const liar = current(state);
    state = rollAndAnnounce(state, [3, 1], 54); // hat 31, sagt 54
    const doubter = current(state);
    state = act(state, byId(doubter), { type: "doubt" });
    assert.equal(state.round.stage, "reveal");
    assert.equal(state.reveal.truthful, false);
    assert.equal(state.reveal.loserId, liar);
    assert.deepEqual(state.reveal.dice, [3, 1]);
    assert.equal(livesOf(state, liar), 2);
    assert.equal(livesOf(state, doubter), 3);

    state = game.tick(state, { now: NOW + REVEAL_MS });
    assert.equal(state.round.stage, "roll");
    assert.equal(current(state), liar, "Verlierer beginnt");
    assert.equal(state.round.announcement, null, "Ansagen beginnen neu");
});
await test("Wahrheit (oder höher) → Zweifler verliert", async () => {
    let state = startMatch();
    state = rollAndAnnounce(state, [6, 5], 54); // hat 65, sagt nur 54
    const doubter = current(state);
    state = act(state, byId(doubter), { type: "doubt" });
    assert.equal(state.reveal.truthful, true);
    assert.equal(state.reveal.loserId, doubter);
    assert.equal(livesOf(state, doubter), 2);
});
await test("Mäxchen echt aufgedeckt → Zweifler verliert 2 Leben", async () => {
    let state = startMatch();
    state = rollAndAnnounce(state, [2, 1], 21);
    const doubter = current(state);
    assert.throws(() => act(state, byId(doubter), { type: "believe" }), /Mäxchen/);
    state = act(state, byId(doubter), { type: "doubt" });
    assert.equal(state.reveal.loserId, doubter);
    assert.equal(state.reveal.livesLost, 2);
    assert.equal(livesOf(state, doubter), 1);
});
await test("Mäxchen gelogen → Ansager verliert 1 Leben", async () => {
    let state = startMatch();
    const liar = current(state);
    state = rollAndAnnounce(state, [6, 6], 21);
    state = act(state, currentPlayer(state), { type: "doubt" });
    assert.equal(state.reveal.loserId, liar);
    assert.equal(livesOf(state, liar), 2);
});
await test("Mäxchen hinnehmen → 1 Leben, Wurf bleibt geheim", async () => {
    let state = startMatch();
    state = rollAndAnnounce(state, [4, 3], 21);
    const accepter = current(state);
    state = act(state, byId(accepter), { type: "accept" });
    assert.equal(state.reveal.loserId, accepter);
    assert.equal(state.reveal.dice, null);
    assert.equal(livesOf(state, accepter), 2);
});
await test("Hinnehmen geht nur bei Mäxchen", async () => {
    let state = startMatch();
    state = rollAndAnnounce(state, [4, 3], 43);
    assert.throws(() => act(state, currentPlayer(state), { type: "accept" }), /nur bei einem angesagten Mäxchen/);
});
await test("Glauben: Becher geht weiter, Ansage muss überboten werden", async () => {
    let state = startMatch({ players: [anna, ben, cleo] });
    const first = current(state);
    state = rollAndAnnounce(state, [4, 2], 42);
    const second = current(state);
    state = act(state, byId(second), { type: "believe" });
    assert.equal(state.round.stage, "roll");
    assert.equal(current(state), second);
    state = rollAndAnnounce(state, [6, 2], 62);
    assert.notEqual(current(state), first);
    assert.notEqual(current(state), second);
    // Dritter zweifelt: 62 stimmt → Dritter verliert
    const third = current(state);
    state = act(state, byId(third), { type: "doubt" });
    assert.equal(state.reveal.loserId, third);
});
await test("Ausscheiden und Sieg", async () => {
    let state = startMatch({ lives: 1 });
    const liar = current(state);
    state = rollAndAnnounce(state, [3, 1], 65);
    const winner = current(state);
    state = act(state, byId(winner), { type: "doubt" });
    assert.equal(state.participants.find(p => p.id === liar).out, true);
    state = game.tick(state, { now: NOW + REVEAL_MS });
    assert.equal(state.phase, "finished");
    assert.equal(state.result.winnerId, winner);
    assert.deepEqual(state.result.placements, [winner, liar]);

    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
});

// ===========================================================================
section("Sichtbarkeit (viewFor)");
// ===========================================================================
await test("Nur der Werfer sieht seinen Wurf – beim Aufdecken alle", async () => {
    let state = startMatch();
    const roller = current(state);
    const other = roller === anna.id ? ben.id : anna.id;
    scriptDice(5, 2);
    state = act(state, byId(roller), { type: "roll" });
    assert.deepEqual(game.viewFor(state, roller).round.dice, [5, 2]);
    assert.equal(game.viewFor(state, other).round.dice, null);
    assert.equal(JSON.stringify(game.viewFor(state, other)).includes("turnEndsAt"), false);

    state = act(state, byId(roller), { type: "announce", value: 52 });
    assert.equal(game.viewFor(state, other).round.dice, null, "auch nach der Ansage verdeckt");
    assert.deepEqual(game.viewFor(state, roller).round.dice, [5, 2], "Werfer sieht ihn weiter");

    state = act(state, byId(other), { type: "doubt" });
    assert.deepEqual(game.viewFor(state, other).reveal.dice, [5, 2]);
});

// ===========================================================================
section("Zeit und Bots");
// ===========================================================================
await test("Zeit abgelaufen: würfeln, Wahrheit ansagen, glauben", async () => {
    let state = startMatch();
    const first = current(state);
    scriptDice(5, 3);
    state = game.tick(state, { now: NOW + TURN_MS });
    assert.equal(state.round.stage, "announce");
    state = game.tick(state, { now: NOW + 2 * TURN_MS });
    assert.deepEqual(state.round.announcement, { value: 53, by: first });
    state = game.tick(state, { now: NOW + 3 * TURN_MS });
    assert.equal(state.round.stage, "roll", "glaubt automatisch");
    assert.notEqual(current(state), first);
});
await test("Zeit abgelaufen mit zu niedrigem Wurf: kleinster erlaubter Wert", async () => {
    let state = startMatch();
    state = rollAndAnnounce(state, [6, 4], 64);
    state = act(state, currentPlayer(state), { type: "believe" });
    scriptDice(3, 1);
    state = act(state, currentPlayer(state), { type: "roll" });
    state = game.tick(state, { now: NOW + TURN_MS });
    assert.equal(state.round.announcement.value, 65);
});
await test("Bots spielen eine Partie bis zum Ende", async () => {
    setRandom(); // echter Zufall
    let state = startMatch({ players: [anna], bots: 3, lives: 2 });
    let now = NOW;
    for (let i = 0; i < 2000 && state.phase === "playing"; i++) {
        now += BOT_STEP_MS;
        const id = current(state);
        if (state.round.stage !== "reveal" && id === anna.id) {
            // Anna spielt simpel: würfeln, Wahrheit oder knapp drüber ansagen, immer glauben (außer Mäxchen)
            const round = state.round;
            if (round.stage === "roll") state = act(state, anna, { type: "roll" }, now);
            else if (round.stage === "announce") state = act(state, anna, { type: "announce", value: game._internals.autoAnnounceValue(round) }, now);
            else if (round.announcement.value === 21) state = act(state, anna, { type: "doubt" }, now);
            else state = act(state, anna, { type: "believe" }, now);
            continue;
        }
        state = game.tick(state, { now: state.round.stage === "reveal" ? now + REVEAL_MS : now }) ?? state;
    }
    assert.equal(state.phase, "finished", "Partie beendet");
    assert.ok(state.result.winnerId, "es gibt einen Gewinner");
    assert.equal(new Set(state.result.placements).size, state.result.placements.length);
});
await test("Spieler verlässt das Spiel: Runde beginnt neu, ohne Lebensverlust", async () => {
    let state = startMatch({ players: [anna, ben, cleo] });
    state = rollAndAnnounce(state, [5, 5], 55);
    const leaver = current(state);
    state = game.onPlayerLeave(state, byId(leaver));
    assert.equal(state.participants.find(p => p.id === leaver).out, true);
    assert.equal(state.round.stage, "roll");
    assert.equal(state.round.announcement, null);
    assert.ok(state.participants.filter(p => !p.out).every(p => p.lives === 3));
    assert.equal(state.round.order.includes(leaver), false);
});
await test("Letzter Mensch geht → Partie endet", async () => {
    let state = startMatch({ players: [anna], bots: 2 });
    state = game.onPlayerLeave(state, anna);
    assert.equal(state.phase, "finished");
});

// ===========================================================================
section("Bot-Namen (server/bot-names.js)");
// ===========================================================================
const { pickBotNames, BOT_PREFIX } = require(path.join(PROJECT_ROOT, "server", "bot-names.js"));

await test("Zufällige deutsche Vornamen mit 🤖, keine doppelten", async () => {
    const names = pickBotNames(5);
    assert.equal(names.length, 5);
    assert.equal(new Set(names).size, 5, "eindeutig");
    for (const name of names) {
        assert.ok(name.startsWith(BOT_PREFIX), name);
        assert.doesNotMatch(name, /Bot \d/);
    }
});
await test("Vornamen echter Spieler werden nicht vergeben", async () => {
    for (let i = 0; i < 200; i++) {
        const names = pickBotNames(5, ["anna", "Ben"]);
        assert.ok(!names.includes(`${BOT_PREFIX}Anna`) && !names.includes(`${BOT_PREFIX}Ben`), names.join(", "));
    }
});
await test("Bots in Mäxchen tragen die neuen Namen", async () => {
    const state = startMatch({ players: [anna], bots: 3 });
    const bots = state.participants.filter(p => p.bot);
    assert.equal(bots.length, 3);
    assert.ok(bots.every(p => p.name.startsWith(BOT_PREFIX) && p.name.length > BOT_PREFIX.length));
    assert.equal(new Set(bots.map(p => p.name)).size, 3);
});

setRandom();
process.exit(summary());
