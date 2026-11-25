/**
 * Logik-Test für Stadt-Land-Fluss – lädt games/stadtlandfluss/game.js direkt
 * (ohne Server) und prüft Regeln (Normalisieren, Anfangsbuchstabe, Mehrheit,
 * Punkte), Einstellungen, Buchstaben, Schreiben/Stopp/Nachfrist, verdeckte
 * Antworten, Anzweifeln, Auswertung, Rundenfolge, Neuzugänge und Verlassen.
 *
 * Start:  npm run test:stadtlandfluss   bzw.  node tests/stadtlandfluss.test.mjs
 * Dauer:  < 1 Sekunde
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "stadtlandfluss", "game.js"));
const { COUNTDOWN_MS, GRACE_MS, REVIEW_MS, data, rules, evaluate, setRandom } = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const T0 = 1_000_000;
const ctx = (now = T0) => ({ hostId: anna.id, now });
const act = (state, player, action, now = T0) => game.handleAction(state, action, player, ctx(now)) ?? state;
const find = (state, player) => state.players.find(p => p.id === player.id);

/** Buchstaben-Index vorgeben (Index in den noch freien Buchstaben). */
const pickFirst = () => setRandom(() => 0);   // → A, B, D, …

function startGame({ players = [anna, ben], categories = ["Stadt", "Land", "Tier"], rounds = 3, roundSeconds = 60 } = {}) {
    pickFirst();
    let state = game.createState({ players });
    state = act(state, anna, { type: "settings", categories, rounds, roundSeconds });
    state = act(state, anna, { type: "start" });
    return game.tick(state, { now: T0 + COUNTDOWN_MS });   // Countdown vorbei → Schreiben
}

function write(state, player, answers) {
    answers.forEach((text, category) => { state = act(state, player, { type: "answer", category, text }); });
    return state;
}

/** Bis in die Auswertung: alle schreiben, Anna ruft Stopp, Nachfrist läuft ab. */
function toReview(state, byPlayer) {
    for (const [player, answers] of byPlayer) state = write(state, player, answers);
    state = act(state, byPlayer[0][0], { type: "stop" }, T0 + 10_000);
    return game.tick(state, { now: T0 + 10_000 + GRACE_MS });
}

// ===========================================================================

section("Regeln");

await test("Normalisieren und Anfangsbuchstabe (Umlaute, ß, Akzente, Satzzeichen)", () => {
    assert.equal(rules.normalize("  Köln-Süd "), "koelnsued");
    assert.equal(rules.normalize("Straße"), rules.normalize("strasse"));
    assert.equal(rules.normalize("Café"), "cafe");
    assert.equal(rules.initialOf("Ägypten"), "A");
    assert.equal(rules.initialOf("  übersee"), "U");
    assert.equal(rules.initialOf("Élysée"), "E");
    assert.equal(rules.initialOf("123"), "");
    assert.equal(rules.autoInvalid("", "A"), "empty");
    assert.equal(rules.autoInvalid(" - ", "A"), "empty");
    assert.equal(rules.autoInvalid("Berlin", "A"), "letter");
    assert.equal(rules.autoInvalid("Aachen", "A"), null);
});

await test("Mehrheit: mehr als die Hälfte der anderen", () => {
    assert.equal(rules.isRejected(1, 1), true, "2 Spieler: ein Zweifel reicht");
    assert.equal(rules.isRejected(1, 2), false, "3 Spieler: einer reicht nicht");
    assert.equal(rules.isRejected(2, 2), true);
    assert.equal(rules.isRejected(2, 4), false, "5 Spieler: zwei reichen nicht");
    assert.equal(rules.isRejected(3, 4), true);
    assert.equal(rules.isRejected(0, 0), false);
});

await test("Punkte: 20 einzige gültige, 10 einmalig, 5 doppelt, 0 ungültig", () => {
    assert.deepEqual(rules.scoreCategory([{ id: "a", text: "Aachen", valid: true }, { id: "b", text: "", valid: false }]), { a: 20, b: 0 });
    assert.deepEqual(rules.scoreCategory([{ id: "a", text: "Aachen", valid: true }, { id: "b", text: "Augsburg", valid: true }]), { a: 10, b: 10 });
    assert.deepEqual(rules.scoreCategory([
        { id: "a", text: "Aachen", valid: true }, { id: "b", text: "aachen!", valid: true }, { id: "c", text: "Ulm", valid: true }
    ]), { a: 5, b: 5, c: 10 });
});

section("Einstellungen und Start");

await test("Kategorien 3–10, eigene gekürzt und ohne Doppelte; nur Host, nur im Setup", () => {
    let state = game.createState({ players: [anna, ben] });
    assert.deepEqual(state.settings.categories, data.DEFAULT_CATEGORIES);
    state = act(state, anna, { type: "settings", categories: ["Stadt", " stadt ", "Land", "Lieblingsessen meiner Oma und so weiter", ""] });
    assert.deepEqual(state.settings.categories, ["Stadt", "Land", "Lieblingsessen meiner Om"]);
    assert.throws(() => act(state, anna, { type: "settings", categories: ["A", "B"] }), /3 bis 10/);
    assert.throws(() => act(state, anna, { type: "settings", categories: Array.from({ length: 11 }, (_, i) => `K${i}`) }), /3 bis 10/);
    assert.throws(() => act(state, anna, { type: "settings", rounds: 4 }), /Rundenzahl/);
    assert.throws(() => act(state, anna, { type: "settings", roundSeconds: 30 }), /Zeit/);
    assert.throws(() => act(state, ben, { type: "settings", rounds: 3 }), /Host/);
    assert.throws(() => act(game.createState({ players: [anna] }), anna, { type: "start" }), /mindestens 2/);
});

await test("Start: Countdown mit verdecktem Buchstaben, dann Schreiben mit Zeitlimit", () => {
    pickFirst();
    let state = game.createState({ players: [anna, ben] });
    state = act(state, anna, { type: "settings", roundSeconds: 60 });
    state = act(state, anna, { type: "start" });
    assert.equal(state.phase, "countdown");
    assert.equal(state.round.letter, "A");
    assert.equal(game.viewFor(state, ben.id).round.letter, null, "Buchstabe im Countdown verdeckt");
    assert.throws(() => act(state, anna, { type: "answer", category: 0, text: "Aachen" }), /nichts eingetragen/);
    assert.equal(game.tick(state, { now: T0 + COUNTDOWN_MS - 1 }), undefined);
    state = game.tick(state, { now: T0 + COUNTDOWN_MS });
    assert.equal(state.phase, "writing");
    assert.equal(state.round.endsAt, T0 + COUNTDOWN_MS + 60_000);
});

await test("Buchstaben: nie C, Q, X, Y und keine Wiederholung in einer Partie", () => {
    setRandom(null);
    for (const l of ["C", "Q", "X", "Y"]) assert.ok(!data.LETTERS.includes(l));
    // Runden schnell durchspielen: Zeit ablaufen lassen, Auswertung läuft ab
    let state = startGame({ rounds: 8 });
    setRandom(null);
    const seen = [state.round.letter];
    let now = T0 + COUNTDOWN_MS;
    while (state.phase !== "finished") {
        now += 200_000;
        state = game.tick(state, { now }) ?? state;
        if (state.phase === "countdown") seen.push(state.round.letter);
    }
    assert.equal(seen.length, 8);
    assert.equal(new Set(seen).size, 8, seen.join(""));
});

section("Schreiben, Stopp und Sicht");

await test("Antworten: gespeichert, gekürzt; Stopp erst mit allen Feldern; Nachfrist, dann gesperrt", () => {
    let state = startGame();
    state = write(state, anna, ["Aachen", "Argentinien"]);
    assert.throws(() => act(state, anna, { type: "stop" }), /alle Felder/);
    state = act(state, anna, { type: "answer", category: 2, text: "A".repeat(60) });
    assert.equal(find(state, anna) && state.round.answers[anna.id][2].length, 40);
    assert.throws(() => act(state, anna, { type: "answer", category: 3, text: "x" }), /Kategorie/);
    state = act(state, anna, { type: "stop" }, T0 + 5000);
    assert.equal(state.phase, "grace");
    assert.equal(state.round.stoppedBy, anna.id);
    state = act(state, ben, { type: "answer", category: 0, text: "Augsburg" }, T0 + 6000);
    assert.equal(state.round.answers[ben.id][0], "Augsburg", "in der Nachfrist geht es noch");
    state = game.tick(state, { now: T0 + 5000 + GRACE_MS });
    assert.equal(state.phase, "review");
    assert.throws(() => act(state, ben, { type: "answer", category: 1, text: "Albanien" }), /nichts eingetragen/);
});

await test("Zeit abgelaufen ohne Stopp → Auswertung", () => {
    let state = startGame({ roundSeconds: 60 });
    state = game.tick(state, { now: T0 + COUNTDOWN_MS + 60_000 });
    assert.equal(state.phase, "review");
    assert.match(state.log.at(-1), /Zeit ist um/);
});

await test("viewFor: fremde Antworten beim Schreiben verdeckt, nur Fortschritt; im Review offen", () => {
    let state = startGame();
    state = write(state, anna, ["Aachen", "Algerien"]);
    const view = game.viewFor(state, ben.id);
    assert.equal(view.round.answers, null);
    assert.deepEqual(view.round.mine, ["", "", ""]);
    assert.equal(view.round.progress[anna.id], 2);
    assert.equal(JSON.stringify(view).includes("Aachen"), false, "nichts verrät Annas Antwort");
    assert.equal(view.usedLetters, undefined);
    assert.deepEqual(game.viewFor(state, anna.id).round.mine, ["Aachen", "Algerien", ""]);
    state = toReview(state, [[anna, ["Aachen", "Algerien", "Affe"]]]);
    const open = game.viewFor(state, ben.id);
    assert.equal(open.round.answers[anna.id][0], "Aachen");
    assert.ok(open.round.evaluation);
    assert.ok(open.round.remainingMs <= REVIEW_MS);
});

section("Auswertung");

await test("Automatisch ungültig, Doppelte 5, einzige 20 – Anzweifeln mit Mehrheit ändert die Punkte", () => {
    let state = startGame({ players: [anna, ben] });
    state = toReview(state, [
        [anna, ["Aachen", "Argentinien", "Affe"]],
        [ben, ["aachen", "Berlin", "Ameise"]]
    ]);
    let ev = evaluate(state);
    const entry = (c, p) => ev.categories[c].entries.find(e => e.id === p.id);
    assert.equal(entry(0, anna).points, 5, "Aachen doppelt");
    assert.equal(entry(0, anna).duplicate, true);
    assert.equal(entry(1, ben).auto, "letter");
    assert.equal(entry(1, anna).points, 20, "einzige gültige");
    assert.equal(entry(2, anna).points, 10);
    assert.throws(() => act(state, ben, { type: "doubt", playerId: ben.id, category: 2 }), /Eigene/);
    assert.throws(() => act(state, anna, { type: "doubt", playerId: ben.id, category: 1 }), /ohnehin nicht/);
    // Ben zweifelt Annas Affe an (2 Spieler: ein Zweifel reicht) → Bens Ameise ist einzige gültige
    state = act(state, ben, { type: "doubt", playerId: anna.id, category: 2 });
    ev = evaluate(state);
    assert.equal(entry(2, anna).rejected, true);
    assert.equal(entry(2, anna).points, 0);
    assert.equal(entry(2, ben).points, 20);
    state = act(state, ben, { type: "doubt", playerId: anna.id, category: 2 });
    ev = evaluate(state);
    assert.equal(entry(2, anna).points, 10, "Zweifel zurückgenommen");
});

await test("Mehrheit bei 3 Spielern: ein Zweifel reicht nicht, zwei schon", () => {
    let state = startGame({ players: [anna, ben, cleo] });
    state = toReview(state, [
        [anna, ["Aue", "Andorra", "Alpaka"]],
        [ben, ["Ahlen", "Armenien", "Aal"]],
        [cleo, ["Aalen", "Angola", "Adler"]]
    ]);
    state = act(state, ben, { type: "doubt", playerId: anna.id, category: 0 });
    assert.equal(evaluate(state).categories[0].entries[0].valid, true);
    state = act(state, cleo, { type: "doubt", playerId: anna.id, category: 0 });
    assert.equal(evaluate(state).categories[0].entries[0].valid, false);
});

await test("Bereit: alle fertig → Punkte gutgeschrieben, nächste Runde; Zweifeln setzt Bereit zurück", () => {
    let state = startGame();
    state = toReview(state, [[anna, ["Aachen", "Albanien", "Affe"]], [ben, ["Aue", "", "Ameise"]]]);
    state = act(state, anna, { type: "ready" });
    assert.deepEqual(state.round.ready, [anna.id]);
    state = act(state, ben, { type: "doubt", playerId: anna.id, category: 0 });
    assert.deepEqual(state.round.ready, [], "nach einem Zweifel neu bestätigen");
    state = act(state, anna, { type: "ready" });
    state = act(state, ben, { type: "ready" }, T0 + 20_000);
    assert.equal(state.phase, "countdown");
    assert.equal(state.round.number, 2);
    // Anna: Aachen abgelehnt (0) + Albanien 20 + Affe 10 = 30; Ben: Aue 20 + 0 + Ameise 10 = 30
    assert.equal(find(state, anna).score, 30);
    assert.equal(find(state, ben).score, 30);
    assert.deepEqual(find(state, anna).roundScores, [{ round: 1, letter: "A", points: 30 }]);
    assert.equal(state.round.letter, "B", "nächster Buchstabe, ohne Wiederholung");
});

await test("Host beendet Auswertung, Zeitablauf auch; nach der letzten Runde: Ergebnis", () => {
    let state = startGame({ rounds: 3 });
    state = toReview(state, [[anna, ["Aachen", "Albanien", "Affe"]]]);
    assert.throws(() => act(state, ben, { type: "end-review" }), /Host/);
    state = act(state, anna, { type: "end-review" });
    assert.equal(state.round.number, 2);
    let now = T0;
    const next = () => { now += 200_000; state = game.tick(state, { now }) ?? state; };
    next();                                   // Countdown vorbei
    next();                                   // Zeit um
    assert.equal(state.phase, "review");
    next();                                   // Auswertung läuft ab
    assert.equal(state.round.number, 3);
    next();
    next();
    state = act(state, anna, { type: "end-review" });
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "finished");
    assert.deepEqual(state.result.placements, [anna.id, ben.id]);
    assert.equal(state.result.winnerId, anna.id);
    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
});

section("Kommen und Gehen");

await test("Neuzugang spielt ab der nächsten Runde mit 0 Punkten mit", () => {
    let state = startGame();
    state = game.onPlayerJoin(state, cleo);
    assert.throws(() => act(state, cleo, { type: "answer", category: 0, text: "Aue" }), /nächsten Runde/);
    state = toReview(state, [[anna, ["Aachen", "Albanien", "Affe"]]]);
    assert.ok(!evaluate(state).categories[0].entries.some(e => e.id === cleo.id));
    state = act(state, anna, { type: "end-review" });
    assert.equal(find(state, cleo).score, 0);
    assert.ok(state.round.participants.includes(cleo.id));
});

await test("Verlassen: Antworten und Zweifel zählen nicht mehr; ohne Spieler Abbruch", () => {
    let state = startGame({ players: [anna, ben, cleo] });
    state = toReview(state, [[anna, ["Aachen", "Albanien", "Affe"]], [ben, ["Aachen", "Andorra", "Aal"]], [cleo, ["Aue", "Angola", "Adler"]]]);
    state = act(state, ben, { type: "doubt", playerId: anna.id, category: 2 });
    state = act(state, cleo, { type: "doubt", playerId: anna.id, category: 2 });
    assert.equal(evaluate(state).categories[2].entries[0].valid, false);
    state = game.onPlayerLeave(state, ben);
    let ev = evaluate(state);
    assert.equal(ev.categories[2].entries.length, 2, "Bens Antworten sind raus");
    assert.equal(ev.categories[2].entries[0].valid, false, "Cleo ist jetzt allein die Mehrheit der anderen");
    assert.equal(ev.categories[0].entries.find(e => e.id === anna.id).points, 10, "Aachen ist ohne Ben nicht mehr doppelt");
    state = act(state, anna, { type: "ready" });
    state = act(state, cleo, { type: "ready" });
    assert.equal(state.phase, "countdown", "alle verbliebenen bereit");
    state = game.onPlayerLeave(state, anna);
    state = game.onPlayerLeave(state, cleo);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "aborted");
});

setRandom(null);
process.exit(summary());
