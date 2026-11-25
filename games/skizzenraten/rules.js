"use strict";

/**
 * Skizzen-Raten – Regeln als reine Funktionen.
 *
 * normalize(text)          Vergleichsform: klein, ä→ae, ß→ss, ohne Satzzeichen/Leerzeichen
 *                          (wie bei Stadt-Land-Fluss; Spiele binden sich nicht gegenseitig ein)
 * isCorrect(guess, word)   richtig geraten?
 * isClose(guess, word)     knapp daneben (Tippfehler): Abstand ≤ 1, ab 8 Buchstaben ≤ 2
 * hintFor(word, revealed)  Hinweis: "_" je Buchstabe, Leerzeichen/Bindestriche sichtbar,
 *                          aufgedeckte Positionen als Buchstabe
 * letterPositions(word)    Positionen, die aufgedeckt werden können
 * guesserPoints / drawerPoints
 */

const UMLAUTS = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

function normalize(text) {
    return String(text ?? "")
        .toLowerCase()
        .replace(/[äöüß]/g, ch => UMLAUTS[ch])
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

const isCorrect = (guess, word) => normalize(guess) !== "" && normalize(guess) === normalize(word);

/** Levenshtein-Abstand (klein, Wörter sind kurz). */
function distance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = row;
    }
    return prev[b.length];
}

function isClose(guess, word) {
    const g = normalize(guess);
    const w = normalize(word);
    if (!g || g === w) return false;
    return distance(g, w) <= (w.length >= 8 ? 2 : 1);
}

const isLetter = ch => /[\p{L}\p{N}]/u.test(ch);

function letterPositions(word) {
    return [...word].map((ch, i) => (isLetter(ch) ? i : -1)).filter(i => i >= 0);
}

function hintFor(word, revealed = []) {
    return [...word].map((ch, i) => (!isLetter(ch) ? ch : revealed.includes(i) ? ch : "_")).join("");
}

/** Rater: je schneller, desto mehr (100 … 20). */
function guesserPoints(remainingMs, totalMs) {
    if (totalMs <= 0) return 20;
    return Math.max(20, Math.round(100 * Math.max(0, remainingMs) / totalMs));
}

/** Zeichner: Anteil der Rater, die es erraten haben (0 … 100). */
function drawerPoints(correct, guessers) {
    return guessers > 0 ? Math.round(100 * correct / guessers) : 0;
}

module.exports = { normalize, isCorrect, isClose, distance, letterPositions, hintFor, guesserPoints, drawerPoints };
