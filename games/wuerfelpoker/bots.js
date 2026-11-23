"use strict";

/**
 * Fünf-Würfel-Poker – Bot-Entscheidungen.
 *
 * decide(sheet, turn, level) → { type: "roll", held } | { type: "score", category }
 *
 *   leicht  hält immer die häufigste Augenzahl (ohne Blick auf Straßen o. Ä.)
 *   mittel  erkennt fertige Hände und Straßen, bewertet Felder gegen einen
 *           Richtwert (BASELINE) und achtet auf den oberen Bonus
 *   schwer  rechnet für alle Haltemuster den Erwartungswert über alle möglichen
 *           Würfe aus (bei zwei verbleibenden Würfen zweistufig) und nutzt
 *           dieselbe Feldbewertung wie „mittel“ (Feldwahl ist bei allen Stufen gleich)
 *
 * Simulation (je 400–600 Partien, Straßen nur aus einem Wurf): leicht ≈ 158, mittel ≈ 210, schwer ≈ 225 Punkte.
 */

const { UPPER, CATEGORIES, UPPER_BONUS_AT, EXTRA_FIVER, counts, scoreFor, isFiver } = require("./scoring");

const LEVELS = Object.freeze({
    leicht: { name: "Leicht" },
    mittel: { name: "Mittel" },
    schwer: { name: "Schwer" }
});

/** Richtwerte: so viel bringt ein Feld im Schnitt – Abweichung davon zählt. */
const BASELINE = Object.freeze({
    ones: 2, twos: 5, threes: 8, fours: 11, fives: 14, sixes: 17,
    three: 17, four: 9, fullHouse: 14, smallStraight: 20, largeStraight: 15, fiver: 12, chance: 22
});

/** Wie gut ist es, `score` jetzt in `category` einzutragen? */
function fieldValue(sheet, category, score) {
    let value = score - BASELINE[category];
    const face = UPPER.indexOf(category) + 1;
    if (face > 0) {
        const upper = UPPER.reduce((a, c) => a + (sheet[c] ?? 0), 0);
        if (upper < UPPER_BONUS_AT) {
            const par = 3 * face;
            // Über/unter dem Soll für den Bonus zählt zusätzlich
            value += (score - par) * 0.8;
            if (upper + score >= UPPER_BONUS_AT) value += 25;
        }
    }
    return value;
}

/** Bestes Feld für die Würfel (fresh: siehe scoring.scoreFor); liefert { category, value }. */
function bestField(sheet, dice, fresh = true) {
    let best = null;
    const extra = isFiver(dice) && sheet.fiver === 50 ? EXTRA_FIVER : 0;
    for (const category of CATEGORIES) {
        if (sheet[category] !== null) continue;
        const value = fieldValue(sheet, category, scoreFor(category, dice, fresh)) + extra;
        if (!best || value > best.value) best = { category, value };
    }
    return best;
}

// --- Halten -------------------------------------------------------------------

/** Würfel mit diesem Wert halten (alle). */
const holdValue = (dice, value) => dice.map(d => d === value);

function mostFrequent(dice, prefer = () => true) {
    const c = counts(dice);
    let best = 0;
    for (let v = 6; v >= 1; v--) {
        if (!prefer(v)) continue;
        if (best === 0 || c[v] > c[best]) best = v;
    }
    return best || mostFrequent(dice);
}

/** Längste Folge halten (jede Zahl einmal). */
function holdRun(dice) {
    const c = counts(dice);
    let bestStart = 1;
    let bestLen = 0;
    for (let start = 1; start <= 6; start++) {
        let len = 0;
        while (start + len <= 6 && c[start + len] > 0) len++;
        if (len > bestLen) {
            bestLen = len;
            bestStart = start;
        }
    }
    const used = new Set();
    const held = dice.map(d => {
        if (d >= bestStart && d < bestStart + bestLen && !used.has(d)) {
            used.add(d);
            return true;
        }
        return false;
    });
    return { held, length: bestLen };
}

function mediumHold(sheet, dice, fresh = true) {
    const c = counts(dice);
    const max = Math.max(...c);
    const free = category => sheet[category] === null;
    const made = (free("largeStraight") && scoreFor("largeStraight", dice, fresh)) ||
        (free("smallStraight") && scoreFor("smallStraight", dice, fresh)) ||
        (free("fullHouse") && scoreFor("fullHouse", dice)) || (free("fiver") && max === 5);
    if (made) return dice.map(() => true);
    // Straßen gelten nur aus einem Wurf: bei lauter Einzelwerten alles neu würfeln
    const run = holdRun(dice);
    if (max === 1 && (free("largeStraight") || free("smallStraight"))) return dice.map(() => false);
    if (run.length >= 4 && max <= 2 && (free("largeStraight") || free("smallStraight"))) return dice.map(() => false);
    // Zwei Paare → Full House versuchen
    if (free("fullHouse") && c.filter(n => n === 2).length === 2) return dice.map(d => c[d] === 2);
    const useful = v => free(UPPER[v - 1]) || free("three") || free("four") || free("fiver");
    const value = mostFrequent(dice, useful);
    if (c[value] === 1 && free("chance")) return dice.map(d => d >= 5);
    return holdValue(dice, value);
}

// --- Erwartungswert (schwer) ------------------------------------------------

/** Alle Ergebnisse von k Würfeln als Mengen mit Wahrscheinlichkeit. */
const OUTCOMES = [];
function outcomes(k) {
    if (OUTCOMES[k]) return OUTCOMES[k];
    const list = [];
    const fact = n => (n <= 1 ? 1 : n * fact(n - 1));
    const rec = (start, left, acc) => {
        if (left === 0) {
            const c = counts(acc);
            let ways = fact(acc.length);
            for (let v = 1; v <= 6; v++) ways /= fact(c[v]);
            list.push({ dice: acc.slice(), p: ways / 6 ** acc.length });
            return;
        }
        for (let v = start; v <= 6; v++) {
            acc.push(v);
            rec(v, left - 1, acc);
            acc.pop();
        }
    };
    rec(1, k, []);
    OUTCOMES[k] = list;
    return list;
}

/** Verschiedene Haltemuster als gehaltene Teil-Mengen (sortiert). */
function holdSubsets(dice) {
    const seen = new Map();
    for (let mask = 0; mask < 32; mask++) {
        const kept = dice.filter((_, i) => mask & (1 << i)).sort((a, b) => a - b);
        const key = kept.join("");
        if (!seen.has(key)) seen.set(key, { kept, mask });
    }
    return [...seen.values()];
}

// Alle 252 Würfel-Mengen und die Übergänge „halten + neu würfeln“ werden einmal
// vorberechnet (unabhängig vom Zettel). Pro Zug bleiben dann ~0,5 Mio. Rechenschritte.
const sortedKey = dice => [...dice].sort((a, b) => a - b).join("");
let TABLE = null;
function table() {
    if (TABLE) return TABLE;
    const states = outcomes(5).map(o => o.dice);
    const index = new Map(states.map((d, i) => [sortedKey(d), i]));
    // fresh: nichts gehalten → das Ergebnis darf als Straße zählen
    const moves = states.map(dice => holdSubsets(dice)
        .filter(({ kept }) => kept.length < 5)
        .map(({ kept }) => ({
            fresh: kept.length === 0,
            list: outcomes(5 - kept.length).map(({ dice: rolled, p }) => [index.get(sortedKey([...kept, ...rolled])), p])
        })));
    TABLE = { states, index, moves };
    return TABLE;
}

/**
 * Werte aller 252 Würfel-Mengen bei 0 und 1 verbleibenden Würfen für einen
 * Zettel – jeweils { fresh, held } je nachdem, ob der letzte Wurf alle fünf
 * Würfel umfasste (nur dann zählen Straßen).
 */
function valueTables(sheet) {
    const { states, moves } = table();
    const v0 = {
        fresh: states.map(dice => bestField(sheet, dice, true).value),
        held: states.map(dice => bestField(sheet, dice, false).value)
    };
    const bestMove = states.map((_, i) => {
        let best = -Infinity;
        for (const move of moves[i]) {
            const after = move.fresh ? v0.fresh : v0.held;
            let ev = 0;
            for (const [j, p] of move.list) ev += p * after[j];
            if (ev > best) best = ev;
        }
        return best;
    });
    const v1 = {
        fresh: v0.fresh.map((v, i) => Math.max(v, bestMove[i])),
        held: v0.held.map((v, i) => Math.max(v, bestMove[i]))
    };
    return [v0, v1];
}

let cache = { key: null, tables: null };
function tablesFor(sheet) {
    const key = JSON.stringify(sheet);
    if (cache.key !== key) cache = { key, tables: valueTables(sheet) };
    return cache.tables;
}

function hardHold(sheet, dice, rollsLeft, fresh = true) {
    const { index } = table();
    const tables = tablesFor(sheet);
    const after = tables[rollsLeft - 1];
    let best = { value: tables[0][fresh ? "fresh" : "held"][index.get(sortedKey(dice))], mask: 31 };
    for (const { kept, mask } of holdSubsets(dice)) {
        if (kept.length === 5) continue;
        const next = kept.length === 0 ? after.fresh : after.held;
        let ev = 0;
        for (const { dice: rolled, p } of outcomes(5 - kept.length)) ev += p * next[index.get(sortedKey([...kept, ...rolled]))];
        if (ev > best.value + 1e-9) best = { value: ev, mask };
    }
    return dice.map((_, i) => Boolean(best.mask & (1 << i)));
}

// --- Entscheidung ------------------------------------------------------------

/**
 * Nächster Schritt eines Bots. turn = { dice, held, rolls, fresh }, maxRolls = 3.
 */
function decide(sheet, turn, level, maxRolls = 3) {
    if (turn.rolls === 0) return { type: "roll", held: [false, false, false, false, false] };
    const rollsLeft = maxRolls - turn.rolls;
    const fresh = turn.fresh !== false;
    let held = null;
    if (rollsLeft > 0) {
        if (level === "leicht") {
            held = isFiver(turn.dice) ? turn.dice.map(() => true) : holdValue(turn.dice, mostFrequent(turn.dice));
        } else if (level === "schwer") {
            held = hardHold(sheet, turn.dice, rollsLeft, fresh);
        } else {
            held = mediumHold(sheet, turn.dice, fresh);
        }
        if (held.some(h => !h)) return { type: "roll", held };
    }
    const category = bestField(sheet, turn.dice, fresh).category;
    return { type: "score", category };
}

/** Tabellen vorab berechnen (~0,3 s einmal pro Serverstart), damit der erste Zug nicht hakt. */
function warmUp() {
    table();
}

module.exports = { LEVELS, warmUp, BASELINE, decide, bestField, fieldValue, outcomes, holdSubsets, mediumHold, hardHold };
