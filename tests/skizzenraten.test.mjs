/**
 * Logik-Test für Skizzen-Raten – lädt games/skizzenraten/game.js direkt (ohne
 * Server) und prüft Begriffsliste, Regeln (Normalisieren, „Fast!“, Hinweise,
 * Punkte), Einstellungen, Wort-Wahl, Zeichnen mit Grenzen, Raten, Hinweise,
 * Reihenfolge, Sicht (viewFor) sowie Kommen und Gehen.
 *
 * Start:  npm run test:skizzenraten   bzw.  node tests/skizzenraten.test.mjs
 * Dauer:  < 1 Sekunde
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_ROOT, createTestRunner } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const game = require(path.join(PROJECT_ROOT, "games", "skizzenraten", "game.js"));
const { LIMITS, CHOOSE_MS, REVEAL_MS, rules, WORDS, wordPool, setRandom } = game._internals;
const { test, section, summary } = createTestRunner();

const anna = { id: "u-anna", name: "Anna" };
const ben = { id: "u-ben", name: "Ben" };
const cleo = { id: "u-cleo", name: "Cleo" };
const T0 = 1_000_000;
const ctx = (now = T0) => ({ hostId: anna.id, now });
const act = (state, player, action, now = T0) => game.handleAction(state, action, player, ctx(now)) ?? state;
const find = (state, player) => state.players.find(p => p.id === player.id);

/** Nur eigene Begriffe, damit die Wörter vorhersehbar sind (Zufall: immer der erste freie). */
const CUSTOM = ["Leuchtturm", "Gießkanne", "Hängematte", "Schneemann", "Kaktus", "Zebra", "Rakete", "Pinguin", "Kerze", "Igel", "Anker", "Wal"];

function startGame({ players = [anna, ben], rounds = 1, drawSeconds = 60, choose = 0 } = {}) {
    setRandom(() => 0);
    let state = game.createState({ players });
    state = act(state, anna, { type: "settings", rounds, drawSeconds, customWords: CUSTOM, onlyCustom: true });
    state = act(state, anna, { type: "start" });
    if (choose !== null) state = act(state, anna, { type: "choose", index: choose });
    return state;
}

// ===========================================================================

section("Begriffe und Regeln");

await test("Begriffsliste: drei Stufen, keine Doppelten, kurze Wörter", () => {
    const all = [...WORDS.leicht, ...WORDS.mittel, ...WORDS.schwer];
    for (const level of ["leicht", "mittel", "schwer"]) assert.ok(WORDS[level].length >= 100, level);
    assert.equal(new Set(all.map(rules.normalize)).size, all.length, "keine Doppelten");
    assert.ok(all.every(w => w.length >= 2 && w.length <= LIMITS.wordLength));
});

await test("Normalisieren, richtig, knapp daneben", () => {
    assert.equal(rules.normalize("Gießkanne!"), "giesskanne");
    assert.ok(rules.isCorrect("  giesskanne ", "Gießkanne"));
    assert.ok(rules.isCorrect("U Boot", "U-Boot"));
    assert.ok(!rules.isCorrect("", "Ei"));
    assert.ok(rules.isClose("Leuchturm", "Leuchtturm"), "ein Buchstabe fehlt");
    assert.ok(rules.isClose("Lauchtturn", "Leuchtturm"), "ab 8 Buchstaben zwei Fehler");
    assert.ok(!rules.isClose("Lauchturn", "Leuchtturm"), "drei Fehler zu viel");
    assert.ok(rules.isClose("Hunt", "Hund"));
    assert.ok(!rules.isClose("Hans", "Hund"), "kurze Wörter: nur ein Fehler");
    assert.ok(!rules.isClose("Hund", "Hund"), "richtig ist nicht „fast“");
});

await test("Hinweis: Unterstriche, Leerzeichen und Bindestrich sichtbar; Punkte", () => {
    assert.equal(rules.hintFor("U-Boot"), "_-____");
    assert.equal(rules.hintFor("Ebbe und Flut", [0, 9]), "E___ ___ F___");
    assert.deepEqual(rules.letterPositions("U-Boot"), [0, 2, 3, 4, 5]);
    assert.equal(rules.guesserPoints(60_000, 60_000), 100);
    assert.equal(rules.guesserPoints(30_000, 60_000), 50);
    assert.equal(rules.guesserPoints(1_000, 60_000), 20, "mindestens 20");
    assert.equal(rules.drawerPoints(2, 3), 67);
    assert.equal(rules.drawerPoints(0, 3), 0);
});

section("Einstellungen und Wort-Wahl");

await test("Einstellungen: eigene Begriffe bereinigt, „nur eigene“ ab 10, nur Host", () => {
    let state = game.createState({ players: [anna, ben] });
    state = act(state, anna, { type: "settings", customWords: "Zebra, zebra ,  Gieß kanne\nEin sehr sehr langer Begriff der zu lang ist;Kuh" });
    assert.deepEqual(state.settings.customWords, ["Zebra", "Gieß kanne", "Ein sehr sehr langer Begriff d", "Kuh"]);
    assert.throws(() => act(state, anna, { type: "settings", onlyCustom: true }), /mindestens 10/);
    assert.throws(() => act(state, anna, { type: "settings", rounds: 5 }), /Durchgängen/);
    assert.throws(() => act(state, anna, { type: "settings", drawSeconds: 30 }), /Zeichenzeit/);
    assert.throws(() => act(state, anna, { type: "settings", difficulty: "extrem" }), /Schwierigkeit/);
    assert.throws(() => act(state, ben, { type: "settings", rounds: 1 }), /Host/);
    state = act(state, anna, { type: "settings", difficulty: "leicht" });
    assert.equal(wordPool(state.settings).length, WORDS.leicht.length + 4, "Liste plus eigene Begriffe");
    assert.throws(() => act(game.createState({ players: [anna] }), anna, { type: "start" }), /mindestens 2/);
});

await test("Start: Host zeichnet zuerst, 3 Vorschläge nur für ihn; Wahl startet das Zeichnen", () => {
    let state = startGame({ choose: null });
    assert.equal(state.phase, "choosing");
    assert.equal(state.turn.drawerId, anna.id);
    assert.deepEqual(state.turn.choices, ["Leuchtturm", "Gießkanne", "Hängematte"]);
    assert.deepEqual(game.viewFor(state, ben.id).turn.choices, [], "Ben sieht die Vorschläge nicht");
    assert.equal(game.viewFor(state, anna.id).turn.choices.length, 3);
    assert.throws(() => act(state, ben, { type: "choose", index: 0 }), /Zeichner/);
    assert.throws(() => act(state, anna, { type: "choose", index: 3 }), /Ungültige/);
    state = act(state, anna, { type: "choose", index: 1 }, T0 + 2000);
    assert.equal(state.phase, "drawing");
    assert.equal(state.turn.word, "Gießkanne");
    assert.equal(state.turn.endsAt, T0 + 2000 + 60_000);
});

await test("Wählt der Zeichner nicht, nimmt der Server einen Begriff; keiner kommt doppelt", () => {
    let state = startGame({ players: [anna, ben, cleo], rounds: 3, choose: null });
    state = game.tick(state, { now: T0 + CHOOSE_MS });
    assert.equal(state.phase, "drawing");
    assert.equal(state.turn.word, "Leuchtturm");
    const words = [state.turn.word];
    let now = T0 + CHOOSE_MS;
    while (state.phase !== "finished") {
        now += 200_000;
        state = game.tick(state, { now }) ?? state;
        if (state.phase === "drawing") words.push(state.turn.word);
    }
    assert.equal(words.length, 9, "3 Durchgänge × 3 Spieler");
    assert.equal(new Set(words).size, 9, words.join(", "));
});

section("Zeichnen");

await test("Striche: nur der Zeichner, Anhängen an die id, Grenzen, Rückgängig, Leeren", () => {
    let state = startGame();
    assert.throws(() => act(state, ben, { type: "stroke", id: 1, color: 0, size: 4, points: [1, 2] }), /zeichnest gerade nicht/);
    state = act(state, anna, { type: "stroke", id: 1, color: 2, size: 10, points: [10, 10, 20, 20] });
    state = act(state, anna, { type: "stroke", id: 1, points: [30, 25, 900, -5] });
    assert.deepEqual(state.turn.strokes, [{ id: 1, c: 2, s: 10, p: [10, 10, 20, 20, 30, 25, 800, 0] }], "angehängt, auf die Fläche begrenzt");
    state = act(state, anna, { type: "stroke", id: 2, color: game._internals.COLORS.length - 1, size: 24, points: [5, 5] });
    assert.equal(state.turn.strokes.length, 2);
    assert.throws(() => act(state, anna, { type: "stroke", id: 1, color: 0, size: 4, points: [1, 1] }), /abgeschlossen/);
    assert.throws(() => act(state, anna, { type: "stroke", id: 3, color: 99, size: 4, points: [1, 1] }), /Farbe/);
    assert.throws(() => act(state, anna, { type: "stroke", id: 3, color: 0, size: 7, points: [1, 1] }), /Stiftgröße/);
    assert.throws(() => act(state, anna, { type: "stroke", id: 3, color: 0, size: 4, points: [1, 2, 3] }), /Ungültige Punkte/);
    assert.throws(() => act(state, anna, { type: "stroke", id: 3, color: 0, size: 4, points: Array(602).fill(1) }), /Zu viele/);
    state = act(state, anna, { type: "undo" });
    assert.equal(state.turn.strokes.length, 1);
    state = act(state, anna, { type: "clear" });
    assert.deepEqual(state.turn.strokes, []);
    // Gesamtgrenze
    for (let id = 10; id < 30; id++) state = act(state, anna, { type: "stroke", id, color: 0, size: 4, points: Array(600).fill(3) });
    assert.throws(() => act(state, anna, { type: "stroke", id: 99, color: 0, size: 4, points: [1, 1] }), /Bild ist voll/);
});

section("Raten");

await test("Falsch öffentlich, „Fast!“ nur privat, richtig gibt Punkte nach Restzeit; Zeichner rät nicht", () => {
    let state = startGame({ players: [anna, ben, cleo] });      // Begriff: Leuchtturm, 60 s
    assert.throws(() => act(state, anna, { type: "guess", text: "Leuchtturm" }), /Du zeichnest/);
    state = act(state, ben, { type: "guess", text: "Turm" }, T0 + 5000);
    state = act(state, cleo, { type: "guess", text: "Leuchturm" }, T0 + 6000);
    assert.deepEqual(state.turn.guesses.map(g => g.text), ["Turm", "Leuchturm"]);
    assert.equal(game.viewFor(state, cleo.id).turn.near, "Leuchturm");
    assert.equal(game.viewFor(state, ben.id).turn.near, null, "der Hinweis ist privat");
    state = act(state, ben, { type: "guess", text: "leuchtturm" }, T0 + 30_000);
    assert.deepEqual(state.turn.guessed, [{ id: ben.id, points: 50 }]);
    assert.equal(find(state, ben).score, 50);
    assert.equal(state.turn.guesses.length, 2, "der richtige Tipp erscheint nicht in der Liste");
    assert.match(state.log.at(-1), /Ben hat es erraten/);
    assert.throws(() => act(state, ben, { type: "guess", text: "x" }), /schon erraten/);
    assert.equal(game.viewFor(state, ben.id).turn.word, "Leuchtturm", "wer es hat, sieht den Begriff");
    assert.equal(game.viewFor(state, cleo.id).turn.word, null);
    assert.equal(game.viewFor(state, cleo.id).turn.hint, "__________");
    assert.equal(state.phase, "drawing", "Cleo rät noch");
    state = act(state, cleo, { type: "guess", text: "Leuchtturm" }, T0 + 45_000);
    assert.equal(state.phase, "reveal", "alle haben es → Auflösung");
    assert.equal(find(state, anna).score, 100, "Zeichner: 2 von 2");
    assert.equal(state.turn.ending, "all");
    assert.equal(game.viewFor(state, cleo.id).turn.word, "Leuchtturm");
});

await test("Hinweise bei 50 % und 75 % der Zeit, Zeitablauf → Auflösung → nächster Zeichner", () => {
    let state = startGame({ drawSeconds: 60 });
    assert.equal(game.tick(state, { now: T0 + 29_999 }), undefined);
    state = game.tick(state, { now: T0 + 30_000 });
    assert.equal(state.turn.revealed.length, 1);
    assert.equal(game.viewFor(state, ben.id).turn.hint, "L_________");
    state = game.tick(state, { now: T0 + 45_000 });
    assert.equal(state.turn.revealed.length, 2);
    state = game.tick(state, { now: T0 + 60_000 });
    assert.equal(state.phase, "reveal");
    assert.equal(find(state, anna).score, 0, "niemand hat es → keine Zeichner-Punkte");
    state = game.tick(state, { now: T0 + 60_000 + REVEAL_MS });
    assert.equal(state.phase, "choosing");
    assert.equal(state.turn.drawerId, ben.id);
});

await test("Ende nach allen Durchgängen: placements nach Punkten; Host überspringt", () => {
    let state = startGame({ rounds: 1 });
    state = act(state, ben, { type: "guess", text: "Leuchtturm" }, T0 + 6_000);   // 90 Punkte
    state = game.tick(state, { now: T0 + 100_000 });
    assert.equal(state.turn.drawerId, ben.id);
    assert.throws(() => act(state, ben, { type: "skip" }), /Host/);
    state = act(state, anna, { type: "skip" }, T0 + 101_000);
    assert.equal(state.phase, "reveal");
    state = game.tick(state, { now: T0 + 200_000 });
    assert.equal(state.phase, "finished");
    assert.deepEqual(state.result.placements, [anna.id, ben.id], "Anna: 100 als Zeichnerin, Ben: 90 als Rater");
    assert.equal(find(state, ben).score, 90);
    assert.equal(state.result.outcome, "finished");
    state = act(state, anna, { type: "new-match" });
    assert.equal(state.phase, "setup");
});

section("Kommen und Gehen");

await test("Neuzugang rät sofort mit und zeichnet im selben Durchgang", () => {
    let state = startGame({ rounds: 1 });
    state = game.onPlayerJoin(state, cleo);
    state = act(state, cleo, { type: "guess", text: "Leuchtturm" }, T0 + 1000);
    assert.ok(find(state, cleo).score > 0);
    state = act(state, ben, { type: "guess", text: "Leuchtturm" }, T0 + 2000);
    assert.equal(state.phase, "reveal");
    const drawers = [];
    let now = T0 + 2000;
    while (state.phase !== "finished") {
        now += 200_000;
        state = game.tick(state, { now }) ?? state;
        if (state.phase === "choosing") drawers.push(state.turn.drawerId);
    }
    assert.deepEqual(drawers, [ben.id, cleo.id]);
});

await test("Zeichner geht → Auflösung; zu wenige Spieler → Abbruch", () => {
    let state = startGame({ players: [anna, ben, cleo] });
    state = game.onPlayerLeave(state, anna);
    assert.equal(state.phase, "reveal");
    assert.equal(state.turn.ending, "left");
    state = game.tick(state, { now: Date.now() + REVEAL_MS + 10 });
    assert.equal(state.turn.drawerId, ben.id);
    state = game.onPlayerLeave(state, cleo);
    assert.equal(state.phase, "finished");
    assert.equal(state.result.outcome, "aborted");
});

await test("viewFor: Zeiten als Restzeit, interne Listen weg", () => {
    const state = startGame();
    const view = game.viewFor(state, ben.id);
    assert.equal(view.usedWords, undefined);
    assert.equal(view.turn.endsAt, undefined);
    assert.ok(view.turn.remainingMs <= 60_000);
    assert.equal(view.turn.letters, 10);
    assert.equal(JSON.stringify(view).includes("Leuchtturm"), false, "Begriff verrät nichts");
    assert.deepEqual(view.settings.customWords, [], "eigene Begriffe nur für den, der sie eingetragen hat");
    assert.equal(view.settings.customCount, CUSTOM.length);
    assert.equal(game.viewFor(state, anna.id).settings.customWords.length, CUSTOM.length);
});

setRandom(null);
process.exit(summary());
