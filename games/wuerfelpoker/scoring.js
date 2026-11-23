"use strict";

/**
 * Fünf-Würfel-Poker – Felder und Punkte (reine Funktionen).
 *
 * Oben:  Einser … Sechser (Summe der Augenzahl), Bonus +35 ab 63 Punkten.
 * Unten: Dreierpasch / Viererpasch (Summe aller Würfel), Full House 25
 *        (drei gleiche + zwei gleiche einer anderen Zahl), Kleine Straße 30
 *        (4 in Folge), Große Straße 40 (5 in Folge), Fünferpasch 50, Chance (Summe).
 * Straßen zählen nur, wenn alle fünf Würfel im selben Wurf gefallen sind (beim
 * letzten Wurf nichts gehalten) – das beschreibt `fresh`.
 * Extra-Fünferpasch: Wer das Feld Fünferpasch schon mit 50 belegt hat, bekommt für
 * jeden weiteren Fünferpasch +50 – eingetragen wird trotzdem normal (keine Joker-Regel).
 */

const UPPER = Object.freeze(["ones", "twos", "threes", "fours", "fives", "sixes"]);
const LOWER = Object.freeze(["three", "four", "fullHouse", "smallStraight", "largeStraight", "fiver", "chance"]);
const CATEGORIES = Object.freeze([...UPPER, ...LOWER]);

const LABELS = Object.freeze({
    ones: "Einser", twos: "Zweier", threes: "Dreier", fours: "Vierer", fives: "Fünfer", sixes: "Sechser",
    three: "Dreierpasch", four: "Viererpasch", fullHouse: "Full House",
    smallStraight: "Kleine Straße", largeStraight: "Große Straße", fiver: "Fünferpasch", chance: "Chance"
});

const UPPER_BONUS_AT = 63;
const UPPER_BONUS = 35;
const FIXED = Object.freeze({ fullHouse: 25, smallStraight: 30, largeStraight: 40, fiver: 50 });
const EXTRA_FIVER = 50;

function counts(dice) {
    const c = [0, 0, 0, 0, 0, 0, 0];
    for (const d of dice) c[d] += 1;
    return c;
}

const sum = dice => dice.reduce((a, b) => a + b, 0);

function hasRun(c, length) {
    let run = 0;
    for (let v = 1; v <= 6; v++) {
        run = c[v] > 0 ? run + 1 : 0;
        if (run >= length) return true;
    }
    return false;
}

const isFiver = dice => dice.length === 5 && dice.every(d => d === dice[0] && d > 0);

/**
 * Punkte, die `dice` im Feld `category` brächten. fresh = alle fünf Würfel im
 * selben Wurf gefallen (sonst zählen Straßen nicht).
 */
function scoreFor(category, dice, fresh = true) {
    const c = counts(dice);
    const upper = UPPER.indexOf(category);
    if (upper >= 0) return c[upper + 1] * (upper + 1);
    const max = Math.max(...c);
    switch (category) {
        case "three": return max >= 3 ? sum(dice) : 0;
        case "four": return max >= 4 ? sum(dice) : 0;
        case "fullHouse": return c.includes(3) && c.includes(2) ? FIXED.fullHouse : 0;
        case "smallStraight": return fresh && hasRun(c, 4) ? FIXED.smallStraight : 0;
        case "largeStraight": return fresh && hasRun(c, 5) ? FIXED.largeStraight : 0;
        case "fiver": return max === 5 ? FIXED.fiver : 0;
        case "chance": return sum(dice);
        default: throw new Error("Unbekanntes Feld.");
    }
}

/** Mögliche Punkte für alle freien Felder. */
function potentials(sheet, dice, fresh = true) {
    const result = {};
    for (const category of CATEGORIES) if (sheet[category] === null) result[category] = scoreFor(category, dice, fresh);
    return result;
}

function emptySheet() {
    return Object.fromEntries(CATEGORIES.map(c => [c, null]));
}

/** Summen eines Zettels; extra = Bonuspunkte für weitere Fünferpasche. */
function totals(sheet, extra = 0) {
    const upper = UPPER.reduce((a, c) => a + (sheet[c] ?? 0), 0);
    const lower = LOWER.reduce((a, c) => a + (sheet[c] ?? 0), 0);
    const bonus = upper >= UPPER_BONUS_AT ? UPPER_BONUS : 0;
    return { upper, bonus, lower, extra, total: upper + bonus + lower + extra };
}

const filledCount = sheet => CATEGORIES.filter(c => sheet[c] !== null).length;

module.exports = {
    UPPER, LOWER, CATEGORIES, LABELS, UPPER_BONUS_AT, UPPER_BONUS, FIXED, EXTRA_FIVER,
    counts, scoreFor, potentials, emptySheet, totals, filledCount, isFiver
};
